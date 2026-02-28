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

const DEDUP_WINDOW_SECONDS = 60;

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

export function createSessionCompletedNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string
): void {
  try {
    if (isDuplicate("session_completed", sessionId)) return;
    insertNotification({
      id: randomUUID(),
      type: "session_completed",
      session_id: sessionId,
      instance_id: instanceId,
      message: `${sessionTitle} finished`,
    });
  } catch {
    // Best-effort — never throw
  }
}

export function createSessionErrorNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string
): void {
  try {
    if (isDuplicate("session_error", sessionId)) return;
    insertNotification({
      id: randomUUID(),
      type: "session_error",
      session_id: sessionId,
      instance_id: instanceId,
      message: `${sessionTitle} encountered an error`,
    });
  } catch {
    // Best-effort — never throw
  }
}

export function createSessionDisconnectedNotification(
  sessionId: string,
  instanceId: string,
  sessionTitle: string
): void {
  try {
    if (isDuplicate("session_disconnected", sessionId)) return;
    insertNotification({
      id: randomUUID(),
      type: "session_disconnected",
      session_id: sessionId,
      instance_id: instanceId,
      message: `${sessionTitle} lost connection`,
    });
  } catch {
    // Best-effort — never throw
  }
}
