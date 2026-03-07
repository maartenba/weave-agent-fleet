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
import { createServer } from "net";
import { dirname, resolve, sep } from "path";
import { randomUUID } from "crypto";
import {
  insertInstance,
  updateInstanceStatus,
  getRunningInstances,
  getSessionsForInstance,
  getNonTerminalSessionsForInstance,
  updateSessionStatus,
  listWorkspaceRoots,
} from "./db-repository";
import {
  createSessionDisconnectedNotification,
} from "./notification-service";
import { ensureWatching, stopWatching } from "./session-status-watcher";
import { log } from "./logger";
import { getMergedConfig } from "./config-manager";

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
    log.warn("process-manager", `OPENCODE_BIN set to "${process.env.OPENCODE_BIN}" but file does not exist`);
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
): Promise<{ url: string; pid: number | undefined; close: () => void }> {
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
    pid: proc.pid,
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
const MAX_PORT_RETRIES = 5;

/**
 * Check if a port is actually available on the OS by attempting to bind it.
 * Returns true if the port is free, false if it's already in use.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

// ─── globalThis-based singletons ──────────────────────────────────────────────
// Next.js dev mode with Turbopack may load this module multiple times in
// separate route compilation chunks, creating distinct module-level variables.
// Using globalThis ensures all chunks share the same Maps/Sets/state.

const _g = globalThis as unknown as {
  __weaveInstances?: Map<string, ManagedInstance>;
  __weaveUsedPorts?: Set<number>;
  __weaveDirToInstance?: Map<string, string>;
  __weaveRecoveryResolve?: (() => void) | null;
  __weaveRecoveryPromise?: Promise<void>;
  __weaveCleanupRun?: boolean;
  __weaveHealthFailCounts?: Map<string, number>;
  __weaveHealthCheckInterval?: ReturnType<typeof setInterval> | null;
  __weaveInitDone?: boolean;
};

// Module-level singleton map — persists across API route invocations in one Next.js process
const instances: Map<string, ManagedInstance> = (_g.__weaveInstances ??= new Map());
// Track which ports are in use
const usedPorts: Set<number> = (_g.__weaveUsedPorts ??= new Set());
// Track which directories already have an instance
const directoryToInstanceId: Map<string, string> = (_g.__weaveDirToInstance ??= new Map());

// Recovery state — resolved once startup recovery is complete
if (!_g.__weaveRecoveryPromise) {
  _g.__weaveRecoveryPromise = new Promise<void>((resolve) => {
    _g.__weaveRecoveryResolve = resolve;
  });
}
let _recoveryCompleteResolve: (() => void) | null = _g.__weaveRecoveryResolve ?? null;
export const _recoveryComplete: Promise<void> = _g.__weaveRecoveryPromise!;

// Guard against double cleanup
let _cleanupRun: boolean = (_g.__weaveCleanupRun ??= false);

/**
 * Returns workspace roots defined by the ORCHESTRATOR_WORKSPACE_ROOTS env var
 * (or the user's home directory as default). These are "system" roots that
 * cannot be removed via the UI.
 */
export function getEnvRoots(): string[] {
  const envRoots = process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  if (envRoots) {
    const separator = process.platform === "win32" ? ";" : ":";
    return envRoots.split(separator).map((r) => resolve(r.trim())).filter(Boolean);
  }
  return [resolve(homedir())];
}

/**
 * Allowed workspace base directories. Returns the union of env-var roots,
 * user-added roots (persisted in SQLite), and the Weave workspace root
 * (where worktree/clone directories live), deduplicated by resolved path.
 * Only directories under these roots can be used to spawn OpenCode instances
 * or be opened in an editor.
 */
export function getAllowedRoots(): string[] {
  const envRoots = getEnvRoots();

  let dbRoots: string[] = [];
  try {
    dbRoots = listWorkspaceRoots().map((r) => r.path);
  } catch (err) {
    log.warn("process-manager", "Failed to read workspace roots from DB", { err });
  }

  // Always allow the Weave workspace root where worktree/clone directories
  // are created (WEAVE_WORKSPACE_ROOT or ~/.weave/workspaces by default).
  const weaveWsRoot = process.env.WEAVE_WORKSPACE_ROOT
    ? resolve(process.env.WEAVE_WORKSPACE_ROOT)
    : resolve(homedir(), ".weave", "workspaces");

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const root of [...envRoots, ...dbRoots, weaveWsRoot]) {
    const resolved = resolve(root);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      merged.push(resolved);
    }
  }
  return merged;
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
  _g.__weaveCleanupRun = false;
  destroyAll();
  // Reset again after destroyAll sets it to true, so subsequent calls work
  _cleanupRun = false;
  _g.__weaveCleanupRun = false;
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
  } catch (err) {
    log.warn("process-manager", "DB not available — skipping instance recovery", { err });
    _recoveryCompleteResolve?.();
    _recoveryCompleteResolve = null;
    _g.__weaveRecoveryResolve = null;
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

      const recoveredPid = dbInst.pid;
      const instance: ManagedInstance = {
        id: dbInst.id,
        port: dbInst.port,
        url: dbInst.url,
        directory: dbInst.directory,
        client,
        close: () => {
          // For recovered instances, kill the process by PID if available.
          if (recoveredPid) {
            try {
              process.kill(recoveredPid);
            } catch (err) {
              log.warn("process-manager", "Failed to kill recovered process — may have already exited", { pid: recoveredPid, err });
            }
          }
        },
        status: "running",
        createdAt: new Date(dbInst.created_at),
        recovered: true,
      };

      instances.set(dbInst.id, instance);
      directoryToInstanceId.set(dbInst.directory, dbInst.id);

      // Start watching session status events for recovered instance
      ensureWatching(dbInst.id);
    } else {
      // Mark as stopped in DB
      const now = new Date().toISOString();
      try {
        updateInstanceStatus(dbInst.id, "stopped", now);
      } catch (err) {
        log.warn("process-manager", "Failed to mark unreachable instance as stopped in DB", { instanceId: dbInst.id, err });
      }
      // Cascade: mark all non-terminal sessions on this dead instance as stopped.
      // This handles both scenarios:
      //   - Graceful shutdown: sessions stuck as "disconnected"
      //   - Crash: sessions stuck as "active"/"idle"/"waiting_input"
      try {
        const orphanedSessions = getNonTerminalSessionsForInstance(dbInst.id);
        for (const session of orphanedSessions) {
          updateSessionStatus(session.id, "stopped", now);
        }
        if (orphanedSessions.length > 0) {
          log.info("process-manager", `Recovered ${orphanedSessions.length} orphaned session(s) for dead instance`, { instanceId: dbInst.id });
        }
      } catch (err) {
        log.warn("process-manager", "Failed to cascade session stops during recovery", { instanceId: dbInst.id, err });
      }
    }
  }

  _recoveryCompleteResolve?.();
  _recoveryCompleteResolve = null;
  _g.__weaveRecoveryResolve = null;
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
  } catch (err) {
    log.warn("process-manager", "Port health check failed — treating as unreachable", { url, err });
    return false;
  }
}

/**
 * Build agent model config from merged WeaveConfig for a directory.
 * Returns `{ agent: { <name>: { model: "provider/model" } } }` if any agents
 * have model overrides, or an empty object if none do.
 *
 * Exported for testing.
 */
export function buildAgentModelConfig(directory: string): Record<string, unknown> {
  try {
    const weaveConfig = getMergedConfig(directory);
    const agentConfig: Record<string, { model: string }> = {};
    if (weaveConfig.agents) {
      for (const [name, cfg] of Object.entries(weaveConfig.agents)) {
        if (cfg.model) {
          agentConfig[name] = { model: cfg.model };
        }
      }
    }
    if (Object.keys(agentConfig).length > 0) {
      return { agent: agentConfig };
    }
  } catch (err) {
    log.warn("process-manager", "Failed to read agent model config — proceeding without model overrides", { directory, err });
  }
  return {};
}

/**
 * Spawn a new OpenCode server instance for the given directory.
 * Reuses an existing running instance if one already exists for that directory.
 *
 * Includes retry logic: if a port is held by a zombie/external process,
 * it releases the port and tries the next available one (up to MAX_PORT_RETRIES).
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

  // Retry loop: allocate a port, verify it's available on the OS, then spawn.
  // If the port is held by a zombie process, release it and try the next one.
  let server: { url: string; pid: number | undefined; close: () => void };
  let port: number | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
    port = allocatePort();

    // Pre-check: is the OS port actually free?
    const available = await isPortAvailable(port);
    if (!available) {
      log.warn("process-manager", `Port ${port} allocated but OS reports it in use — skipping`, { port });
      // Don't release: keep it marked as used so we don't retry it.
      // The health check loop or a restart will eventually clear it.
      continue;
    }

    try {
      server = await spawnOpencodeServer({
        port,
        timeout: SPAWN_TIMEOUT_MS,
        config: {
          plugin: [],
          permission: { edit: "allow", bash: "allow", external_directory: "allow" },
          ...buildAgentModelConfig(directory),
        },
      });
      // Success — break out of retry loop
      break;
    } catch (err) {
      lastError = err;
      // Release the port so it can be reclaimed later if the issue was transient
      releasePort(port);
      log.warn("process-manager", `Failed to spawn on port ${port} (attempt ${attempt + 1}/${MAX_PORT_RETRIES})`, { port, attempt: attempt + 1, err });
    }
  }

  if (!server! || port === undefined) {
    throw lastError ?? new Error("Failed to spawn OpenCode server: all port attempts exhausted");
  }

  // Persist to DB for recovery across restarts
  try {
    insertInstance({
      id: instanceId,
      port,
      directory,
      url: server.url,
      pid: server.pid ?? null,
    });
  } catch (err) {
    log.warn("process-manager", "Failed to persist instance to DB — running in-memory only", { instanceId, err });
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

  // Start watching session status events for this instance
  ensureWatching(instanceId);

  return instance;
}

export function getInstance(id: string): ManagedInstance | undefined {
  return instances.get(id);
}

export function listInstances(): ManagedInstance[] {
  return Array.from(instances.values());
}

export function destroyInstance(id: string): void {
  // Stop watching session status events before tearing down
  stopWatching(id);

  const instance = instances.get(id);
  if (!instance) return;

  // Update DB first so even if kill fails, the DB reflects intent
  try {
    updateInstanceStatus(id, "stopped", new Date().toISOString());
  } catch (err) {
    log.warn("process-manager", "Failed to update instance status to stopped in DB", { instanceId: id, err });
  }

  // Cascade: mark all active sessions on this instance as disconnected
  try {
    const activeSessions = getSessionsForInstance(id);
    for (const session of activeSessions) {
      updateSessionStatus(session.id, "disconnected", new Date().toISOString());
      createSessionDisconnectedNotification(
        session.opencode_session_id,
        id,
        session.title,
        { reason: "instance destroyed", directory: instance.directory }
      );
    }
  } catch (err) {
    log.warn("process-manager", "Failed to cascade session disconnections on instance destroy", { instanceId: id, err });
  }

  try {
    instance.close();
  } catch (err) {
    log.warn("process-manager", "Error while closing instance process", { instanceId: id, err });
  }
  instance.status = "dead";
  instances.delete(id);
  directoryToInstanceId.delete(instance.directory);
  releasePort(instance.port);
}

export function destroyAll(): void {
  if (_cleanupRun) return;
  _cleanupRun = true;
  _g.__weaveCleanupRun = true;

  for (const id of [...instances.keys()]) {
    destroyInstance(id);
  }
}

// Kick off recovery as soon as the module is first loaded.
// Guard: only run once across Turbopack module re-evaluations.
if (!_g.__weaveInitDone) {
  _g.__weaveInitDone = true;

  // This is intentionally fire-and-forget — callers await `_recoveryComplete` if they need to.
  recoverInstances().catch((err) => {
    log.error("process-manager", "Recovery failed", { err });
  });
}

// ─── Health Check Loop ────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_FAIL_THRESHOLD = 3;

// Track consecutive failure counts per instance (shared via globalThis)
const _healthFailCounts: Map<string, number> = (_g.__weaveHealthFailCounts ??= new Map());

/**
 * Start a periodic health check loop that verifies each managed instance
 * is still responding. After 3 consecutive failures, the instance is marked dead.
 * Called once after recovery completes.
 */
export function startHealthCheckLoop(): void {
  if (_g.__weaveHealthCheckInterval) return; // already running
  _g.__weaveHealthCheckInterval = setInterval(async () => {
    for (const [id, instance] of instances) {
      if (instance.status !== "running") continue;

      const alive = await checkPortAlive(instance.url);
      if (alive) {
        _healthFailCounts.delete(id);
      } else {
        const fails = (_healthFailCounts.get(id) ?? 0) + 1;
        _healthFailCounts.set(id, fails);
        if (fails >= HEALTH_CHECK_FAIL_THRESHOLD) {
          log.warn("process-manager", `Instance ${id} failed health check ${fails} times — marking dead`, { instanceId: id, fails });
          instance.status = "dead";
          _healthFailCounts.delete(id);
          try {
            updateInstanceStatus(id, "stopped", new Date().toISOString());
          } catch (err) {
            log.warn("process-manager", "Failed to mark dead instance as stopped in DB", { instanceId: id, err });
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
                session.title,
                { reason: `health check failed ${fails} times`, directory: instance.directory }
              );
            }
          } catch (err) {
            log.warn("process-manager", "Failed to cascade session disconnections after health check failure", { instanceId: id, err });
          }
          directoryToInstanceId.delete(instance.directory);
          releasePort(instance.port);
          instances.delete(id);
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

// Start health checks after recovery completes (guarded by startHealthCheckLoop's idempotency)
_recoveryComplete.then(() => {
  startHealthCheckLoop();
  // Ensure callback monitor is loaded — its self-initializing code starts the polling loop
  import("./callback-monitor").catch((err) => { log.warn("process-manager", "Failed to load callback monitor", { err }); });
  // Start notification cleanup (TTL-based auto-deletion)
  import("./notification-cleanup").then((m) => m.startNotificationCleanup()).catch((err) => { log.warn("process-manager", "Failed to start notification cleanup", { err }); });
}).catch((err) => { log.warn("process-manager", "Post-recovery startup tasks failed", { err }); });

// Clean up all instances when the Node.js process exits.
// Signal handlers are registered every time this module is loaded by a new Turbopack chunk,
// but destroyAll() has its own _cleanupRun guard, so duplicate invocations are harmless.
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
