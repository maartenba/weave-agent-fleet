/**
 * Notification event emitter — in-memory pub/sub for real-time notification delivery.
 *
 * The notification service calls `emitNotification()` after inserting a notification.
 * The global SSE stream subscribes via `onNotification()` to push events to clients.
 * Uses the globalThis singleton pattern for Turbopack compatibility.
 */

import { EventEmitter } from "events";
import type { DbNotification } from "./db-repository";

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
