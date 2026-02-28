/**
 * Process Manager — server-side singleton that spawns and tracks OpenCode server instances.
 *
 * Each "managed instance" maps to one `opencode serve` process bound to a directory.
 * Multiple sessions can share one instance if they target the same directory.
 *
 * Plugin deadlock prevention: config.plugin is set to [] via OPENCODE_CONFIG_CONTENT
 * (passed by the SDK as an env var to the child process). This prevents the Weave plugin
 * from loading and calling GET /skill back to the server during bootstrap.
 *
 * V2: Persists instance state to SQLite for recovery across server restarts.
 * Uses port-based recovery (not PID) since the SDK doesn't expose the child PID.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, resolve, sep } from "path";
import { randomUUID } from "crypto";
import {
  insertInstance,
  updateInstanceStatus,
  getRunningInstances,
  getSessionsForInstance,
  updateSessionStatus,
} from "./db-repository";
import {
  createSessionDisconnectedNotification,
} from "./notification-service";

// ─── OPENCODE_BIN support ─────────────────────────────────────────────────────
// If OPENCODE_BIN is set to the full path of the opencode binary, prepend its
// parent directory to PATH so `opencode` is findable by name (e.g. for
// createOpencodeClient or any other spawn sites).
if (process.env.OPENCODE_BIN) {
  const binPath = resolve(process.env.OPENCODE_BIN);
  if (existsSync(binPath)) {
    const binDir = dirname(binPath);
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${binDir}${sep}${process.env.PATH ?? ""}`;
  } else {
    console.warn(`[process-manager] OPENCODE_BIN set to "${process.env.OPENCODE_BIN}" but file does not exist`);
  }
}

// ─── OpenCode server spawn ────────────────────────────────────────────────────
// Custom implementation that replaces the SDK's createOpencodeServer().
// On Windows, Node.js child_process.spawn() uses CreateProcessW which only
// resolves .exe files on PATH — it cannot find .cmd/.bat wrappers. Using
// `shell: true` on Windows routes through cmd.exe which resolves PATHEXT
// correctly.
interface SpawnServerOptions {
  hostname?: string;
  port?: number;
  timeout?: number;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

async function spawnOpencodeServer(
  options: SpawnServerOptions
): Promise<{ url: string; close: () => void }> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 4096;
  const timeout = options.timeout ?? 5000;

  const command = process.env.OPENCODE_BIN ?? "opencode";
  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
  const config = options.config ?? {};
  if ((config as { logLevel?: string }).logLevel) {
    args.push(`--log-level=${(config as { logLevel: string }).logLevel}`);
  }

  const proc = spawn(command, args, {
    signal: options.signal,
    // On Windows, shell: true is required so cmd.exe resolves .cmd/.bat via PATHEXT
    shell: process.platform === "win32",
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
  });

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for opencode server to start after ${timeout}ms`
        )
      );
    }, timeout);

    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s\r]+)/);
          if (!match) {
            clearTimeout(id);
            reject(
              new Error(
                `Failed to parse server url from output: ${line}`
              )
            );
            return;
          }
          clearTimeout(id);
          resolve(match[1]);
          return;
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(id);
      let msg = `opencode server exited with code ${code}`;
      if (output.trim()) {
        msg += `\nServer output: ${output}`;
      }
      reject(new Error(msg));
    });

    proc.on("error", (error) => {
      clearTimeout(id);
      reject(error);
    });

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        clearTimeout(id);
        reject(new Error("Aborted"));
      });
    }
  });

  return {
    url,
    close() {
      proc.kill();
    },
  };
}

// Re-export for convenience
export type { OpencodeClient } from "@opencode-ai/sdk/v2";

export interface ManagedInstance {
  id: string;
  port: number;
  url: string;
  directory: string;
  client: OpencodeClient;
  close: () => void;
  status: "running" | "dead";
  createdAt: Date;
  /** True if this instance was recovered from DB on startup (not freshly spawned) */
  recovered: boolean;
}

const PORT_START = 4097;
const PORT_END = 4200;
const SPAWN_TIMEOUT_MS = 30_000;

// Module-level singleton map — persists across API route invocations in one Next.js process
const instances = new Map<string, ManagedInstance>();
// Track which ports are in use
const usedPorts = new Set<number>();
// Track which directories already have an instance
const directoryToInstanceId = new Map<string, string>();

// Recovery state — resolved once startup recovery is complete
let _recoveryCompleteResolve: (() => void) | null = null;
export const _recoveryComplete: Promise<void> = new Promise((resolve) => {
  _recoveryCompleteResolve = resolve;
});

// Guard against double cleanup
let _cleanupRun = false;

/**
 * Allowed workspace base directories. Only directories under these roots can be
 * used to spawn OpenCode instances. Configurable via ORCHESTRATOR_WORKSPACE_ROOTS
 * env var (colon-separated). Falls back to the user's home directory.
 */
function getAllowedRoots(): string[] {
  const envRoots = process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  if (envRoots) {
    const separator = process.platform === "win32" ? ";" : ":";
    return envRoots.split(separator).map((r) => resolve(r.trim())).filter(Boolean);
  }
  return [resolve(homedir())];
}

/**
 * Validate that a directory path is safe to use:
 * - Must be an absolute path
 * - Must resolve to a location under an allowed root
 * - Must exist and be a directory
 *
 * @throws {Error} with a safe, user-facing message on validation failure
 */
export function validateDirectory(directory: string): string {
  const resolved = resolve(directory);

  const roots = getAllowedRoots();
  const underAllowedRoot = roots.some(
    (root) => resolved === root || resolved.startsWith(root + sep)
  );
  if (!underAllowedRoot) {
    throw new Error("Directory is outside the allowed workspace roots");
  }

  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error("Path exists but is not a directory");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path exists")) throw err;
    throw new Error("Directory does not exist");
  }

  return resolved;
}

export function allocatePort(): number {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_START}–${PORT_END}`);
}

export function releasePort(port: number): void {
  usedPorts.delete(port);
}

/**
 * Reset all internal state — for tests only.
 */
export function _resetForTests(): void {
  // Reset the cleanup guard so destroyAll() actually runs
  _cleanupRun = false;
  destroyAll();
  // Reset again after destroyAll sets it to true, so subsequent calls work
  _cleanupRun = false;
  usedPorts.clear();
  directoryToInstanceId.clear();
}

/**
 * Attempt to recover instances that were running before the server restarted.
 * Reads running instances from the DB, checks if their port is still reachable,
 * and re-adds them to the in-memory Map if so. Marks unreachable instances as stopped.
 *
 * Called once on module init (lazily, on first API call that calls `ensureRecovered()`).
 */
export async function recoverInstances(): Promise<void> {
  let runningDbInstances: ReturnType<typeof getRunningInstances>;
  try {
    runningDbInstances = getRunningInstances();
  } catch {
    // DB not available — skip recovery
    _recoveryCompleteResolve?.();
    _recoveryCompleteResolve = null;
    return;
  }

  for (const dbInst of runningDbInstances) {
    // Skip if already in memory (e.g. running in-process)
    if (instances.has(dbInst.id)) continue;

    // Check if the port is still responsive
    const isAlive = await checkPortAlive(dbInst.url);

    if (isAlive) {
      // Re-register the port as in use
      usedPorts.add(dbInst.port);

      const client = createOpencodeClient({
        baseUrl: dbInst.url,
        directory: dbInst.directory,
      });

      const instance: ManagedInstance = {
        id: dbInst.id,
        port: dbInst.port,
        url: dbInst.url,
        directory: dbInst.directory,
        client,
        close: () => {
          // For recovered instances, we don't have the original close() fn.
          // Best effort: mark as dead. The process will be cleaned up
          // by the OS when the Next.js server exits.
        },
        status: "running",
        createdAt: new Date(dbInst.created_at),
        recovered: true,
      };

      instances.set(dbInst.id, instance);
      directoryToInstanceId.set(dbInst.directory, dbInst.id);
    } else {
      // Mark as stopped in DB
      try {
        updateInstanceStatus(dbInst.id, "stopped", new Date().toISOString());
      } catch {
        // Best effort
      }
    }
  }

  _recoveryCompleteResolve?.();
  _recoveryCompleteResolve = null;
}

/**
 * Check if an OpenCode server at the given URL is alive.
 * Returns true if it responds with any HTTP status.
 */
async function checkPortAlive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${url}/session`, {
        signal: controller.signal,
      });
      return response.status < 500;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/**
 * Spawn a new OpenCode server instance for the given directory.
 * Reuses an existing running instance if one already exists for that directory.
 */
export async function spawnInstance(directory: string): Promise<ManagedInstance> {
  // Reuse existing running instance for the same directory
  const existingId = directoryToInstanceId.get(directory);
  if (existingId) {
    const existing = instances.get(existingId);
    if (existing && existing.status === "running") {
      return existing;
    }
    // Dead — clean up and respawn; release the leaked port
    if (existing) {
      releasePort(existing.port);
    }
    directoryToInstanceId.delete(directory);
    instances.delete(existingId);
  }

  const instanceId = randomUUID();
  const port = allocatePort();

  let server: { url: string; close: () => void };
  try {
    server = await spawnOpencodeServer({
      port,
      timeout: SPAWN_TIMEOUT_MS,
      config: {
        plugin: [],
        permission: { edit: "allow", bash: "allow", external_directory: "allow" },
      },
    });
  } catch (err) {
    releasePort(port);
    throw err;
  }

  // Persist to DB for recovery across restarts
  try {
    insertInstance({
      id: instanceId,
      port,
      directory,
      url: server.url,
      // PID not exposed by the SDK — using port-based recovery instead
      pid: null,
    });
  } catch {
    // DB write failure is non-fatal — instance still works in-memory
    console.warn(`[process-manager] Failed to persist instance ${instanceId} to DB`);
  }

  const client = createOpencodeClient({ baseUrl: server.url, directory });

  const instance: ManagedInstance = {
    id: instanceId,
    port,
    url: server.url,
    directory,
    client,
    close: server.close,
    status: "running",
    createdAt: new Date(),
    recovered: false,
  };

  instances.set(instanceId, instance);
  directoryToInstanceId.set(directory, instanceId);

  return instance;
}

export function getInstance(id: string): ManagedInstance | undefined {
  return instances.get(id);
}

export function listInstances(): ManagedInstance[] {
  return Array.from(instances.values());
}

export function destroyInstance(id: string): void {
  const instance = instances.get(id);
  if (!instance) return;

  // Update DB first so even if kill fails, the DB reflects intent
  try {
    updateInstanceStatus(id, "stopped", new Date().toISOString());
  } catch {
    // Non-fatal
  }

  // Cascade: mark all active sessions on this instance as disconnected
  try {
    const activeSessions = getSessionsForInstance(id);
    for (const session of activeSessions) {
      updateSessionStatus(session.id, "disconnected", new Date().toISOString());
      createSessionDisconnectedNotification(
        session.opencode_session_id,
        id,
        session.title
      );
    }
  } catch {
    // Non-fatal
  }

  try {
    instance.close();
  } catch {
    // ignore errors on close
  }
  instance.status = "dead";
  instances.delete(id);
  directoryToInstanceId.delete(instance.directory);
  releasePort(instance.port);
}

export function destroyAll(): void {
  if (_cleanupRun) return;
  _cleanupRun = true;

  for (const id of [...instances.keys()]) {
    destroyInstance(id);
  }
}

// Kick off recovery as soon as the module is first loaded.
// This is intentionally fire-and-forget — callers await `_recoveryComplete` if they need to.
recoverInstances().catch((err) => {
  console.error("[process-manager] Recovery failed:", err);
});

// ─── Health Check Loop ────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_FAIL_THRESHOLD = 3;

// Track consecutive failure counts per instance
const _healthFailCounts = new Map<string, number>();

let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic health check loop that verifies each managed instance
 * is still responding. After 3 consecutive failures, the instance is marked dead.
 * Called once after recovery completes.
 */
export function startHealthCheckLoop(): void {
  if (_healthCheckInterval) return; // already running
  _healthCheckInterval = setInterval(async () => {
    for (const [id, instance] of instances) {
      if (instance.status !== "running") continue;

      const alive = await checkPortAlive(instance.url);
      if (alive) {
        _healthFailCounts.delete(id);
      } else {
        const fails = (_healthFailCounts.get(id) ?? 0) + 1;
        _healthFailCounts.set(id, fails);
        if (fails >= HEALTH_CHECK_FAIL_THRESHOLD) {
          console.warn(`[process-manager] Instance ${id} failed health check ${fails} times — marking dead`);
          instance.status = "dead";
          _healthFailCounts.delete(id);
          try {
            updateInstanceStatus(id, "stopped", new Date().toISOString());
          } catch {
            // Non-fatal
          }
          // Create disconnected notifications for all active sessions on this instance
          // and mark them as disconnected in the DB
          try {
            const activeSessions = getSessionsForInstance(id);
            for (const session of activeSessions) {
              updateSessionStatus(session.id, "disconnected", new Date().toISOString());
              createSessionDisconnectedNotification(
                session.opencode_session_id,
                id,
                session.title
              );
            }
          } catch {
            // Non-fatal
          }
          directoryToInstanceId.delete(instance.directory);
          releasePort(instance.port);
          instances.delete(id);
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

// Start health checks after recovery completes
_recoveryComplete.then(() => {
  startHealthCheckLoop();
}).catch(() => {/* non-fatal */});

// Clean up all instances when the Node.js process exits
process.on("exit", destroyAll);
process.on("SIGTERM", () => {
  destroyAll();
  process.exit(0);
});
process.on("SIGINT", () => {
  destroyAll();
  process.exit(0);
});
process.on("SIGHUP", () => {
  destroyAll();
  process.exit(0);
});
process.on("beforeExit", destroyAll);
