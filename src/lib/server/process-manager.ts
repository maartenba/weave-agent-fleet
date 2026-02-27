/**
 * Process Manager — server-side singleton that spawns and tracks OpenCode server instances.
 *
 * Each "managed instance" maps to one `opencode serve` process bound to a directory.
 * Multiple sessions can share one instance if they target the same directory.
 *
 * Plugin deadlock prevention: config.plugin is set to [] via OPENCODE_CONFIG_CONTENT
 * (passed by the SDK as an env var to the child process). This prevents the Weave plugin
 * from loading and calling GET /skill back to the server during bootstrap.
 */

import { createOpencodeServer, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { randomUUID } from "crypto";

// Re-export for convenience
export type { OpencodeClient } from "@opencode-ai/sdk";

export interface ManagedInstance {
  id: string;
  port: number;
  url: string;
  directory: string;
  client: OpencodeClient;
  close: () => void;
  status: "running" | "dead";
  createdAt: Date;
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

/**
 * Allowed workspace base directories. Only directories under these roots can be
 * used to spawn OpenCode instances. Configurable via ORCHESTRATOR_WORKSPACE_ROOTS
 * env var (colon-separated). Falls back to the user's home directory.
 */
function getAllowedRoots(): string[] {
  const envRoots = process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  if (envRoots) {
    return envRoots.split(":").map((r) => resolve(r)).filter(Boolean);
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
    (root) => resolved === root || resolved.startsWith(root + "/")
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
  destroyAll();
  usedPorts.clear();
  directoryToInstanceId.clear();
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
    server = await createOpencodeServer({
      port,
      timeout: SPAWN_TIMEOUT_MS,
      config: {
        plugin: [],
        permission: { edit: "allow", bash: "allow" },
      },
    });
  } catch (err) {
    releasePort(port);
    throw err;
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
  for (const id of [...instances.keys()]) {
    destroyInstance(id);
  }
}

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
