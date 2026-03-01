/**
 * Notification cleanup service — auto-deletes old notifications on a timer.
 *
 * Runs cleanup immediately on startup, then every hour.
 * TTL is configurable via WEAVE_NOTIFICATION_TTL_DAYS env var (default 7).
 * Uses the globalThis singleton pattern for Turbopack compatibility.
 */

import { deleteOldNotifications } from "./db-repository";

const DEFAULT_TTL_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const _g = globalThis as unknown as {
  __weaveNotificationCleanupInterval?: ReturnType<typeof setInterval> | null;
  __weaveNotificationCleanupInit?: boolean;
};

function runCleanup(): void {
  try {
    const ttlDays =
      parseInt(process.env.WEAVE_NOTIFICATION_TTL_DAYS ?? "", 10) ||
      DEFAULT_TTL_DAYS;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");
    const deleted = deleteOldNotifications(cutoff);
    if (deleted > 0) {
      console.log(
        `[notification-cleanup] Deleted ${deleted} notifications older than ${ttlDays} days`
      );
    }
  } catch (err) {
    console.error("[notification-cleanup] Cleanup failed:", err);
  }
}

export function startNotificationCleanup(): void {
  if (_g.__weaveNotificationCleanupInterval) return;
  runCleanup(); // Run immediately on startup
  _g.__weaveNotificationCleanupInterval = setInterval(
    runCleanup,
    CLEANUP_INTERVAL_MS
  );
}

export function _resetForTests(): void {
  if (_g.__weaveNotificationCleanupInterval) {
    clearInterval(_g.__weaveNotificationCleanupInterval);
    _g.__weaveNotificationCleanupInterval = null;
  }
  _g.__weaveNotificationCleanupInit = false;
}
