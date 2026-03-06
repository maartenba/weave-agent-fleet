/**
 * Notification event emitter — in-memory pub/sub for real-time notification delivery.
 *
 * The notification service calls `emitNotification()` after inserting a notification.
 * The global SSE stream subscribes via `onNotification()` to push events to clients.
 * Uses the globalThis singleton pattern for Turbopack compatibility.
 *
 * Also carries ephemeral activity status events (busy/idle/waiting_input) that are
 * NOT persisted to the DB — they're transient signals for real-time sidebar updates.
 */

import { EventEmitter } from "events";
import type { DbNotification } from "./db-repository";
import type { SessionActivityStatus } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityStatusPayload {
  sessionId: string;
  instanceId: string;
  activityStatus: SessionActivityStatus;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveNotificationEmitter?: EventEmitter;
};

function getEmitter(): EventEmitter {
  if (!_g.__weaveNotificationEmitter) {
    _g.__weaveNotificationEmitter = new EventEmitter();
    _g.__weaveNotificationEmitter.setMaxListeners(100); // Support many SSE connections
  }
  return _g.__weaveNotificationEmitter;
}

// ─── Notification events (persisted) ──────────────────────────────────────────

export function emitNotification(notification: DbNotification): void {
  getEmitter().emit("notification", notification);
}

export function onNotification(
  callback: (notification: DbNotification) => void
): () => void {
  const emitter = getEmitter();
  emitter.on("notification", callback);
  return () => {
    emitter.off("notification", callback);
  };
}

// ─── Activity status events (ephemeral — not persisted) ───────────────────────

export function emitActivityStatus(payload: ActivityStatusPayload): void {
  getEmitter().emit("activity_status", payload);
}

export function onActivityStatus(
  callback: (payload: ActivityStatusPayload) => void
): () => void {
  const emitter = getEmitter();
  emitter.on("activity_status", callback);
  return () => {
    emitter.off("activity_status", callback);
  };
}
