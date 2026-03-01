/**
 * Notification service — creates notifications for session lifecycle events.
 *
 * All functions are best-effort: they wrap DB writes in try/catch so that
 * a notification failure never breaks the calling SSE stream or health check.
 *
 * Includes a deduplication guard: the same notification type for the same
 * session will not be created more than once within 60 seconds.
 */

import { randomUUID } from "crypto";
import { insertNotification, listNotifications } from "./db-repository";
import { emitNotification } from "./notification-emitter";

const DEDUP_WINDOW_SECONDS = 60;

/** Optional context for enriching notification messages. */
export interface NotificationContext {
  /** Error message or description (for error notifications). */
  error?: string;
  /** Permission type, e.g. "file_read" (for input_required notifications). */
  permissionType?: string;
  /** Reason for disconnection, e.g. "health check failed 3 times". */
  reason?: string;
  /** Working directory of the instance. */
  directory?: string;
}

function isDuplicate(type: string, sessionId: string): boolean {
  try {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");
    const recent = listNotifications({ unreadOnly: false, limit: 20 });
    return recent.some(
      (n) =>
        n.type === type &&
        n.session_id === sessionId &&
        n.created_at >= cutoff
    );
  } catch {
    return false;
  }
}

/** Helper to build and emit a notification record. */
function createAndEmit(
  type: string,
  sessionId: string,
  instanceId: string,
  message: string
): void {
  const id = randomUUID();
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  insertNotification({
    id,
    type,
    session_id: sessionId,
    instance_id: instanceId,
    message,
  });
  emitNotification({
    id,
    type,
    session_id: sessionId,
    instance_id: instanceId,
    pipeline_id: null,
    message,
    read: 0,
    created_at: now,
  });
}

export function createSessionCompletedNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string,
  ctx?: NotificationContext
): void {
  try {
    if (isDuplicate("session_completed", sessionId)) return;
    let message = `${sessionTitle} finished`;
    if (ctx?.directory) message += ` (${ctx.directory})`;
    createAndEmit("session_completed", sessionId, instanceId, message);
  } catch {
    // Best-effort — never throw
  }
}

export function createSessionErrorNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string,
  ctx?: NotificationContext
): void {
  try {
    if (isDuplicate("session_error", sessionId)) return;
    let message = `${sessionTitle} encountered an error`;
    if (ctx?.error) message += `: ${ctx.error}`;
    createAndEmit("session_error", sessionId, instanceId, message);
  } catch {
    // Best-effort — never throw
  }
}

export function createSessionDisconnectedNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string,
  ctx?: NotificationContext
): void {
  try {
    if (isDuplicate("session_disconnected", sessionId)) return;
    let message = `${sessionTitle} lost connection`;
    if (ctx?.reason) message += ` (${ctx.reason})`;
    createAndEmit("session_disconnected", sessionId, instanceId, message);
  } catch {
    // Best-effort — never throw
  }
}

export function createInputRequiredNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string,
  ctx?: NotificationContext
): void {
  try {
    if (isDuplicate("input_required", sessionId)) return;
    let message = `${sessionTitle} is waiting for input`;
    if (ctx?.permissionType) message += `: ${ctx.permissionType.replace(/^permission\./, "")} permission`;
    createAndEmit("input_required", sessionId, instanceId, message);
  } catch {
    // Best-effort — never throw
  }
}
