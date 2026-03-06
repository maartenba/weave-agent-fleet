/**
 * Session Status Watcher — server-side event subscription that persists
 * busy/idle transitions for ALL sessions on each running instance.
 *
 * Unlike the callback monitor (which only tracks child sessions with
 * completion callbacks and stops monitoring after one idle transition),
 * this watcher continuously tracks status for every session so the
 * sidebar can always show accurate working/idle state.
 *
 * Architecture:
 * - One event subscription per running OpenCode instance
 * - Detects `session.status` (busy/idle) events for any session on that instance
 * - Persists status transitions to the Fleet DB
 * - The sidebar's polled `GET /api/sessions` endpoint then picks up the
 *   correct DB status even when the SDK poll returns no data (because the
 *   SDK only returns sessions with active event subscriptions — which this
 *   module ensures exist)
 *
 * Uses the globalThis singleton pattern (matching process-manager.ts) for
 * Turbopack compatibility.
 */

import {
  getSessionByOpencodeId,
  updateSessionStatus,
} from "./db-repository";
import { getInstance } from "./process-manager";
import { getClientForInstance } from "./opencode-client";
import { emitActivityStatus } from "./notification-emitter";
import { log } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstanceWatcher {
  instanceId: string;
  directory: string;
  abort: AbortController;
}

// ─── globalThis-based singletons ──────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveSessionStatusWatchers?: Map<string, InstanceWatcher>;
};

function getWatchers(): Map<string, InstanceWatcher> {
  if (!_g.__weaveSessionStatusWatchers) {
    _g.__weaveSessionStatusWatchers = new Map();
  }
  return _g.__weaveSessionStatusWatchers;
}

// ─── Event Stream Processing ──────────────────────────────────────────────────

/**
 * Process events from an instance's event stream, persisting busy/idle
 * transitions for every session on that instance.
 */
async function processEventStream(
  instanceId: string,
  eventStream: AsyncIterable<unknown>,
  abortController: AbortController,
): Promise<void> {
  try {
    for await (const rawEvent of eventStream) {
      if (abortController.signal.aborted) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = rawEvent as any;
      const type: string = event?.type ?? "unknown";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const properties: Record<string, any> = event?.properties ?? event ?? {};

      if (type === "session.status") {
        const statusType: string = properties?.status?.type ?? "";
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";

        if (!eventSessionId) continue;

        if (statusType === "idle") {
          try {
            const dbSession = getSessionByOpencodeId(eventSessionId);
            if (dbSession && dbSession.status !== "idle") {
              updateSessionStatus(dbSession.id, "idle");
              emitActivityStatus({
                sessionId: eventSessionId,
                instanceId,
                activityStatus: "idle",
              });
            }
          } catch (err) {
            log.warn("session-status-watcher", "Failed to persist idle status", {
              sessionId: eventSessionId,
              instanceId,
              err,
            });
          }
        } else if (statusType === "busy") {
          try {
            const dbSession = getSessionByOpencodeId(eventSessionId);
            if (dbSession && dbSession.status !== "active") {
              updateSessionStatus(dbSession.id, "active");
              emitActivityStatus({
                sessionId: eventSessionId,
                instanceId,
                activityStatus: "busy",
              });
            }
          } catch (err) {
            log.warn("session-status-watcher", "Failed to persist active status", {
              sessionId: eventSessionId,
              instanceId,
              err,
            });
          }
        }
      } else if (type === "session.idle") {
        // Some SDK versions emit session.idle instead of session.status
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";
        if (!eventSessionId) continue;

        try {
          const dbSession = getSessionByOpencodeId(eventSessionId);
          if (dbSession && dbSession.status !== "idle") {
            updateSessionStatus(dbSession.id, "idle");
            emitActivityStatus({
              sessionId: eventSessionId,
              instanceId,
              activityStatus: "idle",
            });
          }
        } catch (err) {
          log.warn("session-status-watcher", "Failed to persist idle status (session.idle event)", {
            sessionId: eventSessionId,
            instanceId,
            err,
          });
        }
      } else if (type.startsWith("permission.")) {
        // Permission events indicate the session is waiting for user input
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";
        if (!eventSessionId) continue;

        try {
          const dbSession = getSessionByOpencodeId(eventSessionId);
          if (dbSession && dbSession.status !== "waiting_input") {
            updateSessionStatus(dbSession.id, "waiting_input");
            emitActivityStatus({
              sessionId: eventSessionId,
              instanceId,
              activityStatus: "waiting_input",
            });
          }
        } catch (err) {
          log.warn("session-status-watcher", "Failed to persist waiting_input status", {
            sessionId: eventSessionId,
            instanceId,
            err,
          });
        }
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.warn("session-status-watcher", "Event stream errored", { instanceId, err });
    }
  } finally {
    // Stream ended — clean up watcher
    const watchers = getWatchers();
    watchers.delete(instanceId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure there is an active event subscription watching session status
 * transitions for the given instance. Idempotent — if a watcher already
 * exists for this instance, this is a no-op.
 */
export function ensureWatching(instanceId: string): void {
  const watchers = getWatchers();

  // Already watching this instance
  if (watchers.has(instanceId)) return;

  const instance = getInstance(instanceId);
  if (!instance || instance.status === "dead") {
    log.warn("session-status-watcher", "Instance is dead — cannot watch", { instanceId });
    return;
  }

  const abort = new AbortController();
  const watcher: InstanceWatcher = {
    instanceId,
    directory: instance.directory,
    abort,
  };
  watchers.set(instanceId, watcher);

  // Start event subscription (fire-and-forget)
  void (async () => {
    try {
      const client = getClientForInstance(instanceId);
      const subscribeResult = await client.event.subscribe({
        directory: instance.directory,
      });

      const eventStream =
        "stream" in subscribeResult
          ? (subscribeResult as { stream: AsyncIterable<unknown> }).stream
          : (subscribeResult as AsyncIterable<unknown>);

      await processEventStream(instanceId, eventStream, abort);
    } catch (err) {
      log.warn("session-status-watcher", "Failed to subscribe to instance events", {
        instanceId,
        err,
      });
      // Clean up on failure
      watchers.delete(instanceId);
    }
  })();
}

/**
 * Stop watching an instance. Called when an instance is terminated.
 */
export function stopWatching(instanceId: string): void {
  const watchers = getWatchers();
  const watcher = watchers.get(instanceId);
  if (watcher) {
    watcher.abort.abort();
    watchers.delete(instanceId);
  }
}

/**
 * Reset all state — for tests only.
 */
export function _resetForTests(): void {
  const watchers = getWatchers();
  for (const watcher of watchers.values()) {
    watcher.abort.abort();
  }
  watchers.clear();
}
