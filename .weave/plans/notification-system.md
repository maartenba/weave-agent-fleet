# Enhanced Notification System — Issue #18

## TL;DR
> **Summary**: Enhance the notification system across 5 areas: wire up `input_required` notifications from SSE events, add a global SSE stream to replace polling, enable browser push notifications (Web Notification API), add a notification preferences tab in Settings, and implement lifecycle management (TTL auto-cleanup, bulk actions).
> **Estimated Effort**: Large

## Context

### Original Request
Issue #18 identifies 5 gaps in the current notification system:
1. `input_required` type exists but is never fired
2. `use-notifications.ts` polls every 10s — should use SSE for real-time delivery
3. No browser push notifications when the tab is unfocused
4. No notification preferences UI
5. Notifications accumulate forever — need TTL cleanup and bulk actions

### Key Findings

1. **`input_required` type is defined but never created** — `NotificationType` in `src/lib/types.ts` (line 189) includes `"input_required"` and the UI in `notification-bell.tsx` (line 26) and `alerts/page.tsx` (line 22) already renders icons/badges for it. The SSE event handler in `src/app/api/sessions/[id]/events/route.ts` handles `session.status` events with `status.type` of `"busy"` and `"idle"`. The OpenCode SDK emits `session.status` events — we need to detect when status type indicates the session is waiting for input. Looking at the event handler's pattern (lines 116-137), the `session.status` event carries `properties.status.type` which can be `"busy"` or `"idle"`. **The SDK does not appear to have a dedicated "input required" event**. However, we can detect the `"idle"` status arriving *without* a preceding `"busy"` state (i.e. the session went idle without ever becoming busy, meaning it was likely waiting for input from the start), or we can look at the session's status via polling. More practically: the `isRelevantToSession` function in `event-state.ts` (line 212) already filters for `permission.*` events — these are the SDK's way of requesting user permission/input. We should fire `input_required` when a `permission.*` event is seen.

2. **Current polling architecture** — `src/hooks/use-notifications.ts` polls `GET /api/notifications/unread-count` every 10s via `setInterval`. The hook exposes `{ unreadCount, notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead }`. The `fetchNotifications` is on-demand (when dropdown opens).

3. **Per-session SSE exists** — `src/app/api/sessions/[id]/events/route.ts` subscribes to OpenCode SDK's `client.event.subscribe()` and streams filtered events. It uses `ReadableStream` with a keepalive timer. This pattern should be adapted for the global notification SSE.

4. **Notification service is server-side** — `src/lib/server/notification-service.ts` has `createSessionCompletedNotification`, `createSessionErrorNotification`, `createSessionDisconnectedNotification`. Each uses `isDuplicate()` to check for same type+session within 60s. We need to add `createInputRequiredNotification` following this pattern.

5. **Settings page** — `src/app/settings/page.tsx` uses `<Tabs>` with `TabsList variant="line"` and three tabs: Skills, Agents, About. Tab content components are in `src/components/settings/`. The pattern is: create a `NotificationsTab` component, import and add it.

6. **`usePersistedState` hook** — `src/hooks/use-persisted-state.ts` provides `[value, setValue]` backed by localStorage with `useSyncExternalStore`. Cross-tab reactivity via internal subscriber registry. Perfect for notification preferences.

7. **DB repository** — `src/lib/server/db-repository.ts` has `deleteNotification(id)`, `deleteNotificationsForSession(sessionId)`, `markAllNotificationsRead()`, `listNotifications()` already. Missing: `deleteAllNotifications()` and `deleteOldNotifications(olderThanDate)` for lifecycle management.

8. **Notification creation in SSE handler** — In `src/app/api/sessions/[id]/events/route.ts`, the `for await` loop processes events (lines 100-163). After forwarding via `send()`, it does best-effort notification creation in a try/catch block. The `input_required` detection should be added here.

9. **Callback monitor also processes events** — `src/lib/server/callback-monitor.ts` has a nearly identical event processing loop (`processEventStream`, lines 81-213) that handles `session.status`, `session.idle`, and `error` events. It does NOT need `input_required` detection since it's focused on completion callbacks, not user notifications.

10. **No global event emitter** — The codebase has no EventEmitter or pub/sub system. The global SSE endpoint will need a way to be notified when new notifications are created. Options: (a) an in-memory EventEmitter singleton (like process-manager uses globalThis), or (b) poll the DB. Option (a) is better for real-time push.

## Objectives

### Core Objective
Enhance the notification system with real-time delivery (SSE), browser push notifications, user preferences, `input_required` detection, and lifecycle management.

### Deliverables
- [ ] `input_required` notifications fired when sessions need user input
- [ ] Global SSE endpoint at `/api/notifications/stream` pushing real-time notification events
- [ ] `use-notifications.ts` subscribes to SSE stream with polling fallback
- [ ] Browser Notification API integration (when tab unfocused)
- [ ] Notifications tab in Settings with per-type toggles and browser notification permission
- [ ] Auto-cleanup of notifications older than 7 days (configurable)
- [ ] Bulk actions: "Mark all read" and "Clear all" in the UI + API
- [ ] Cleanup runs on server startup and every hour

### Definition of Done
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (including new tests)
- [ ] `input_required` notification fires when a `permission.*` SSE event is received
- [ ] Opening `/alerts` shows notifications in real-time without page refresh
- [ ] Browser notification appears when a notification fires and tab is not focused
- [ ] Settings → Notifications tab allows toggling browser notifications and per-type preferences
- [ ] Notifications older than 7 days are automatically deleted
- [ ] "Clear all" button in alerts page deletes all notifications

### Guardrails (Must NOT)
- Do NOT wire up `cost_threshold` or `pipeline_stage_complete` notification types
- Do NOT implement service worker push notifications — use the simpler Notification API only
- Do NOT add sound playback — only the preference toggle (future use)
- Do NOT add external notification services (email, Slack, webhooks)
- Do NOT change existing notification types or break existing notification creation

## TODOs

### Phase 1: Server Infrastructure (no UI dependencies)

- [ ] 1. **Add `createInputRequiredNotification` to notification service**
  **What**: Add a new function to `src/lib/server/notification-service.ts` following the existing pattern:
  ```typescript
  export function createInputRequiredNotification(
    sessionId: string,
    instanceId: string,
    sessionTitle: string
  ): void {
    try {
      if (isDuplicate("input_required", sessionId)) return;
      insertNotification({
        id: randomUUID(),
        type: "input_required",
        session_id: sessionId,
        instance_id: instanceId,
        message: `${sessionTitle} requires input`,
      });
    } catch {
      // Best-effort — never throw
    }
  }
  ```
  **Files**: `src/lib/server/notification-service.ts` (modify — add function after `createSessionDisconnectedNotification`)
  **Acceptance**: Function exists, compiles, follows the deduplication pattern.

- [ ] 2. **Fire `input_required` from SSE event handler**
  **What**: Modify `src/app/api/sessions/[id]/events/route.ts` to detect `permission.*` events and fire `input_required` notifications. In the `try` block after existing notification triggers (around line 150-162), add:
  ```typescript
  // After the existing "error" handler block:
  else if (type.startsWith("permission.")) {
    const dbSession = getSessionByOpencodeId(sessionId);
    if (dbSession) {
      createInputRequiredNotification(
        dbSession.opencode_session_id,
        instanceId,
        dbSession.title
      );
    }
  }
  ```
  Import `createInputRequiredNotification` from `@/lib/server/notification-service` (add to existing import on line 7-9).
  **Files**: `src/app/api/sessions/[id]/events/route.ts` (modify)
  **Acceptance**: When a `permission.requested` or similar event flows through the SSE proxy, an `input_required` notification is created in the DB.

- [ ] 3. **Add `deleteAllNotifications` and `deleteOldNotifications` to DB repository**
  **What**: Add two new functions to `src/lib/server/db-repository.ts`:
  ```typescript
  export function deleteAllNotifications(): number {
    const result = getDb()
      .prepare("DELETE FROM notifications")
      .run();
    return result.changes;
  }

  export function deleteOldNotifications(olderThan: string): number {
    const result = getDb()
      .prepare("DELETE FROM notifications WHERE created_at < ?")
      .run(olderThan);
    return result.changes;
  }
  ```
  The `olderThan` parameter is an ISO datetime string (e.g., `"2026-02-22 00:00:00"`). SQLite compares text dates correctly since they're in ISO format.
  **Files**: `src/lib/server/db-repository.ts` (modify — add after `deleteNotificationsForSession`)
  **Acceptance**: Functions compile and execute correct SQL.

- [ ] 4. **Create notification cleanup service**
  **What**: Create `src/lib/server/notification-cleanup.ts` — a server-side module that auto-deletes old notifications. Uses the globalThis singleton pattern (like `process-manager.ts` and `callback-monitor.ts`):
  ```typescript
  import { deleteOldNotifications } from "./db-repository";
  import { _recoveryComplete } from "./process-manager";

  const DEFAULT_TTL_DAYS = 7;
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  const _g = globalThis as unknown as {
    __weaveNotificationCleanupInterval?: ReturnType<typeof setInterval> | null;
    __weaveNotificationCleanupInit?: boolean;
  };

  function runCleanup(): void {
    try {
      const ttlDays = parseInt(process.env.WEAVE_NOTIFICATION_TTL_DAYS ?? "", 10) || DEFAULT_TTL_DAYS;
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "");
      const deleted = deleteOldNotifications(cutoff);
      if (deleted > 0) {
        console.log(`[notification-cleanup] Deleted ${deleted} notifications older than ${ttlDays} days`);
      }
    } catch (err) {
      console.error("[notification-cleanup] Cleanup failed:", err);
    }
  }

  export function startNotificationCleanup(): void {
    if (_g.__weaveNotificationCleanupInterval) return;
    runCleanup(); // Run immediately on startup
    _g.__weaveNotificationCleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  }

  export function _resetForTests(): void {
    if (_g.__weaveNotificationCleanupInterval) {
      clearInterval(_g.__weaveNotificationCleanupInterval);
      _g.__weaveNotificationCleanupInterval = null;
    }
    _g.__weaveNotificationCleanupInit = false;
  }

  // Self-initializing startup (after recovery)
  if (!_g.__weaveNotificationCleanupInit) {
    _g.__weaveNotificationCleanupInit = true;
    _recoveryComplete
      .then(() => { startNotificationCleanup(); })
      .catch(() => { /* non-fatal */ });
  }
  ```
  **Files**: `src/lib/server/notification-cleanup.ts` (create)
  **Acceptance**: Module loads on server startup, runs cleanup immediately, then every hour. Configurable via `WEAVE_NOTIFICATION_TTL_DAYS` env var.

- [ ] 5. **Import cleanup module in process-manager startup chain**
  **What**: The cleanup module self-initializes on import, but we need to ensure it's loaded. In `src/lib/server/process-manager.ts`, in the `_recoveryComplete.then()` block (lines 570-574), add an import for the cleanup module alongside the existing `callback-monitor` import:
  ```typescript
  _recoveryComplete.then(() => {
    startHealthCheckLoop();
    import("./callback-monitor").catch(() => {/* non-fatal */});
    import("./notification-cleanup").catch(() => {/* non-fatal */});
  }).catch(() => {/* non-fatal */});
  ```
  **Files**: `src/lib/server/process-manager.ts` (modify — line 573, add one import line)
  **Acceptance**: Notification cleanup starts after server recovery.

- [ ] 6. **Create global notification event emitter**
  **What**: Create `src/lib/server/notification-emitter.ts` — an in-memory EventEmitter singleton (using Node.js `events` module) that notification-service calls after inserting a notification. SSE stream subscribers listen to this emitter.
  ```typescript
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

  export function onNotification(callback: (notification: DbNotification) => void): () => void {
    const emitter = getEmitter();
    emitter.on("notification", callback);
    return () => { emitter.off("notification", callback); };
  }
  ```
  **Files**: `src/lib/server/notification-emitter.ts` (create)
  **Acceptance**: Module exports `emitNotification` and `onNotification`. Uses globalThis for Turbopack compatibility.

- [ ] 7. **Wire notification service to emit events**
  **What**: Modify `src/lib/server/notification-service.ts` to call `emitNotification()` after each successful `insertNotification()`. Import `emitNotification` from `./notification-emitter`. In each `createXxxNotification` function, after `insertNotification(...)`, call:
  ```typescript
  emitNotification({
    id: notifId, // Store the generated UUID in a variable before passing to insertNotification
    type: "...",
    session_id: sessionId,
    instance_id: instanceId,
    pipeline_id: null,
    message: "...",
    read: 0,
    created_at: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
  });
  ```
  Each function needs to store the notification data in a local variable so it can be passed to both `insertNotification` and `emitNotification`. The `created_at` format matches SQLite's `datetime('now')` output.
  **Files**: `src/lib/server/notification-service.ts` (modify — all 4 create functions)
  **Acceptance**: When a notification is created, it's also emitted via the event emitter for real-time SSE delivery.

### Phase 2: Global SSE Endpoint (depends on Phase 1)

- [ ] 8. **Create `GET /api/notifications/stream` SSE endpoint**
  **What**: Create `src/app/api/notifications/stream/route.ts` — a global SSE endpoint that pushes notification events to connected clients. Pattern follows the per-session SSE handler:
  ```typescript
  import { NextRequest } from "next/server";
  import { _recoveryComplete } from "@/lib/server/process-manager";
  import { onNotification } from "@/lib/server/notification-emitter";

  const KEEPALIVE_INTERVAL_MS = 15_000;

  export async function GET(request: NextRequest): Promise<Response> {
    await _recoveryComplete;

    const abortController = new AbortController();
    request.signal.addEventListener("abort", () => abortController.abort());

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        function send(data: unknown) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller may be closed
          }
        }

        function sendComment(comment: string) {
          try {
            controller.enqueue(encoder.encode(`: ${comment}\n\n`));
          } catch {
            // Controller may be closed
          }
        }

        // Keepalive
        const keepalive = setInterval(() => {
          if (abortController.signal.aborted) {
            clearInterval(keepalive);
            return;
          }
          sendComment("keepalive");
        }, KEEPALIVE_INTERVAL_MS);

        // Subscribe to notification events
        const unsubscribe = onNotification((notification) => {
          if (abortController.signal.aborted) return;
          send({ type: "notification", notification });
        });

        // Cleanup on abort
        abortController.signal.addEventListener("abort", () => {
          clearInterval(keepalive);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        });
      },

      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
  ```
  **Files**: `src/app/api/notifications/stream/route.ts` (create)
  **Acceptance**: `GET /api/notifications/stream` returns a text/event-stream. When a notification is created elsewhere, connected clients receive it as an SSE event. Keepalive comments prevent connection timeout.

### Phase 3: Bulk Action APIs (depends on Phase 1, parallelizable with Phase 2)

- [ ] 9. **Add `DELETE /api/notifications` for bulk delete**
  **What**: Add a `DELETE` handler to `src/app/api/notifications/route.ts` (which already has GET). The DELETE handler calls `deleteAllNotifications()` and returns `{ deleted: number }`:
  ```typescript
  export async function DELETE(): Promise<NextResponse> {
    await _recoveryComplete;
    try {
      const deleted = deleteAllNotifications();
      return NextResponse.json({ deleted }, { status: 200 });
    } catch (err) {
      console.error("[DELETE /api/notifications] Error:", err);
      return NextResponse.json(
        { error: "Failed to delete notifications" },
        { status: 500 }
      );
    }
  }
  ```
  Import `deleteAllNotifications` from `@/lib/server/db-repository`.
  **Files**: `src/app/api/notifications/route.ts` (modify — add DELETE handler and import)
  **Acceptance**: `DELETE /api/notifications` deletes all notifications and returns count.

### Phase 4: Client-Side SSE Hook (depends on Phase 2)

- [ ] 10. **Rewrite `use-notifications.ts` to use SSE with polling fallback**
  **What**: Rewrite `src/hooks/use-notifications.ts` to subscribe to the global SSE stream at `/api/notifications/stream`. When a notification event arrives, increment `unreadCount` and prepend the notification to the local list. Keep polling as a fallback: if the SSE connection drops (EventSource `onerror`), fall back to polling `GET /api/notifications/unread-count` every 10s. When SSE reconnects, stop polling.

  Updated hook structure:
  ```typescript
  "use client";
  import { useState, useEffect, useCallback, useRef } from "react";
  import type { DbNotification } from "@/lib/server/db-repository";

  export type { DbNotification };

  export interface UseNotificationsResult {
    unreadCount: number;
    notifications: DbNotification[];
    isLoading: boolean;
    fetchNotifications: (limit?: number) => Promise<void>;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    clearAll: () => Promise<void>;
  }

  const POLL_INTERVAL_MS = 10_000;

  export function useNotifications(
    pollIntervalMs: number = POLL_INTERVAL_MS
  ): UseNotificationsResult {
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState<DbNotification[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const isMounted = useRef(true);
    const eventSourceRef = useRef<EventSource | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchUnreadCount = useCallback(async () => {
      try {
        const response = await fetch("/api/notifications/unread-count");
        if (!response.ok) return;
        const data = (await response.json()) as { count: number };
        if (isMounted.current) setUnreadCount(data.count);
      } catch { /* Non-fatal */ }
    }, []);

    const startPolling = useCallback(() => {
      if (pollIntervalRef.current) return;
      pollIntervalRef.current = setInterval(fetchUnreadCount, pollIntervalMs);
    }, [fetchUnreadCount, pollIntervalMs]);

    const stopPolling = useCallback(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }, []);

    const connectSSE = useCallback(() => {
      if (eventSourceRef.current) return;
      const es = new EventSource("/api/notifications/stream");
      eventSourceRef.current = es;

      es.onopen = () => {
        stopPolling(); // SSE connected, stop polling
      };

      es.onmessage = (e: MessageEvent<string>) => {
        if (!isMounted.current) return;
        try {
          const data = JSON.parse(e.data) as { type: string; notification: DbNotification };
          if (data.type === "notification" && data.notification) {
            setUnreadCount((prev) => prev + 1);
            setNotifications((prev) => [data.notification, ...prev].slice(0, 50));
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        if (!isMounted.current) return;
        es.close();
        eventSourceRef.current = null;
        // Fallback to polling
        fetchUnreadCount();
        startPolling();
        // Attempt reconnect after delay
        setTimeout(() => {
          if (isMounted.current && !eventSourceRef.current) connectSSE();
        }, 5000);
      };
    }, [stopPolling, startPolling, fetchUnreadCount]);

    // ... (keep existing fetchNotifications, markAsRead, markAllAsRead unchanged)
    // Add clearAll:
    const clearAll = useCallback(async () => {
      try {
        await fetch("/api/notifications", { method: "DELETE" });
        if (isMounted.current) {
          setNotifications([]);
          setUnreadCount(0);
        }
      } catch { /* Non-fatal */ }
    }, []);

    useEffect(() => {
      isMounted.current = true;
      fetchUnreadCount(); // Initial fetch
      connectSSE(); // Try SSE first
      startPolling(); // Start polling as initial fallback (SSE onopen will stop it)
      return () => {
        isMounted.current = false;
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        stopPolling();
      };
    }, [fetchUnreadCount, connectSSE, startPolling, stopPolling]);

    return { unreadCount, notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead, clearAll };
  }
  ```
  Keep all existing functions (`fetchNotifications`, `markAsRead`, `markAllAsRead`) intact. Add `clearAll`. Add SSE subscription with polling fallback.
  **Files**: `src/hooks/use-notifications.ts` (modify — significant rewrite)
  **Acceptance**: Hook connects to SSE on mount, falls back to polling on error. `clearAll` function calls `DELETE /api/notifications`. New notifications appear in real-time without polling delay.

### Phase 5: Browser Push Notifications (depends on Phase 4)

- [ ] 11. **Create `use-browser-notifications.ts` hook**
  **What**: Create `src/hooks/use-browser-notifications.ts` — a hook that manages browser Notification API permission and shows notifications:
  ```typescript
  "use client";
  import { useCallback, useEffect, useRef } from "react";
  import { usePersistedState } from "./use-persisted-state";
  import type { DbNotification } from "@/lib/server/db-repository";

  export type NotificationPermissionState = "default" | "granted" | "denied";

  export interface UseBrowserNotificationsResult {
    permission: NotificationPermissionState;
    isEnabled: boolean;
    setEnabled: (enabled: boolean) => void;
    requestPermission: () => Promise<NotificationPermissionState>;
    showNotification: (notification: DbNotification) => void;
  }

  function getNotificationTitle(type: string): string {
    switch (type) {
      case "input_required": return "Input Required";
      case "session_completed": return "Session Completed";
      case "session_error": return "Session Error";
      case "session_disconnected": return "Session Disconnected";
      default: return "Weave Fleet";
    }
  }

  export function useBrowserNotifications(): UseBrowserNotificationsResult {
    const [isEnabled, setEnabled] = usePersistedState("weave:notifications:browser-enabled", false);
    const permissionRef = useRef<NotificationPermissionState>("default");

    useEffect(() => {
      if (typeof window !== "undefined" && "Notification" in window) {
        permissionRef.current = Notification.permission as NotificationPermissionState;
      }
    }, []);

    const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
      if (typeof window === "undefined" || !("Notification" in window)) return "denied";
      const result = await Notification.requestPermission();
      permissionRef.current = result as NotificationPermissionState;
      if (result === "granted") setEnabled(true);
      return result as NotificationPermissionState;
    }, [setEnabled]);

    const showNotification = useCallback((notification: DbNotification) => {
      if (!isEnabled) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      if (document.hasFocus()) return; // Only show when tab is not focused

      try {
        new Notification(getNotificationTitle(notification.type), {
          body: notification.message,
          tag: notification.id, // Prevents duplicate OS notifications
          icon: "/favicon.ico",
        });
      } catch {
        // Notification API may fail silently in some contexts
      }
    }, [isEnabled]);

    return {
      permission: permissionRef.current,
      isEnabled,
      setEnabled,
      requestPermission,
      showNotification,
    };
  }
  ```
  **Files**: `src/hooks/use-browser-notifications.ts` (create)
  **Acceptance**: Hook manages permission state, persists enabled preference, shows browser notification only when tab is unfocused and permission is granted.

- [ ] 12. **Create `use-notification-preferences.ts` hook**
  **What**: Create `src/hooks/use-notification-preferences.ts` — a hook that manages per-type notification preferences using `usePersistedState`:
  ```typescript
  "use client";
  import { usePersistedState } from "./use-persisted-state";
  import type { NotificationType } from "@/lib/types";

  export interface NotificationPreferences {
    browserEnabled: boolean;
    soundEnabled: boolean;
    typeEnabled: Record<NotificationType, boolean>;
  }

  const DEFAULT_PREFERENCES: NotificationPreferences = {
    browserEnabled: false,
    soundEnabled: false,
    typeEnabled: {
      input_required: true,
      session_completed: true,
      session_error: true,
      session_disconnected: true,
      cost_threshold: true,
      pipeline_stage_complete: true,
    },
  };

  export function useNotificationPreferences() {
    const [preferences, setPreferences] = usePersistedState<NotificationPreferences>(
      "weave:notifications:preferences",
      DEFAULT_PREFERENCES
    );

    function setBrowserEnabled(enabled: boolean) {
      setPreferences((prev) => ({ ...prev, browserEnabled: enabled }));
    }

    function setSoundEnabled(enabled: boolean) {
      setPreferences((prev) => ({ ...prev, soundEnabled: enabled }));
    }

    function setTypeEnabled(type: NotificationType, enabled: boolean) {
      setPreferences((prev) => ({
        ...prev,
        typeEnabled: { ...prev.typeEnabled, [type]: enabled },
      }));
    }

    function isTypeEnabled(type: string): boolean {
      return preferences.typeEnabled[type as NotificationType] ?? true;
    }

    return {
      preferences,
      setBrowserEnabled,
      setSoundEnabled,
      setTypeEnabled,
      isTypeEnabled,
    };
  }
  ```
  **Files**: `src/hooks/use-notification-preferences.ts` (create)
  **Acceptance**: Hook persists preferences to localStorage under `"weave:notifications:preferences"`. Per-type toggles and global toggles work.

- [ ] 13. **Integrate browser notifications into `use-notifications.ts`**
  **What**: Modify the `use-notifications.ts` hook (from Task 10) to call `showNotification` when a new notification arrives via SSE, respecting per-type preferences. The hook should accept optional dependencies or be composed at a higher level. 

  **Approach**: Create a new wrapper hook `src/hooks/use-notifications-with-browser.ts` that composes `useNotifications`, `useBrowserNotifications`, and `useNotificationPreferences`:
  ```typescript
  "use client";
  import { useEffect, useRef } from "react";
  import { useNotifications, type UseNotificationsResult } from "./use-notifications";
  import { useBrowserNotifications } from "./use-browser-notifications";
  import { useNotificationPreferences } from "./use-notification-preferences";

  export function useNotificationsWithBrowser(): UseNotificationsResult {
    const result = useNotifications();
    const { showNotification } = useBrowserNotifications();
    const { isTypeEnabled, preferences } = useNotificationPreferences();
    const prevCountRef = useRef(result.unreadCount);

    useEffect(() => {
      // When unreadCount increases AND there are new notifications, show browser notification
      if (result.unreadCount > prevCountRef.current && result.notifications.length > 0) {
        const latest = result.notifications[0];
        if (latest && preferences.browserEnabled && isTypeEnabled(latest.type)) {
          showNotification(latest);
        }
      }
      prevCountRef.current = result.unreadCount;
    }, [result.unreadCount, result.notifications, showNotification, isTypeEnabled, preferences.browserEnabled]);

    return result;
  }
  ```
  Then update `src/components/notifications/notification-bell.tsx` and `src/components/layout/sidebar.tsx` to use `useNotificationsWithBrowser` instead of `useNotifications`.
  **Files**: 
  - `src/hooks/use-notifications-with-browser.ts` (create)
  - `src/components/notifications/notification-bell.tsx` (modify — change import)
  - `src/components/layout/sidebar.tsx` (modify — change import if it uses `useNotifications`)
  **Acceptance**: Browser notifications appear when a new notification fires and the tab is not focused. Notifications respect per-type preferences.

### Phase 6: Settings UI (depends on Phase 5 hooks, parallelizable with Phase 4 UI work)

- [ ] 14. **Create `NotificationsTab` component**
  **What**: Create `src/components/settings/notifications-tab.tsx` — a settings tab component with:
  - **Browser Notifications** section:
    - Toggle switch: "Enable browser notifications" (uses `useNotificationPreferences().setBrowserEnabled`)
    - When toggling ON, call `requestPermission()` from `useBrowserNotifications`. If denied, show a note explaining how to enable in browser settings.
    - Show current permission state as a badge
  - **Notification Types** section:
    - A list of notification types with toggle switches for each
    - Types to show: `input_required` ("Input Required"), `session_completed` ("Session Completed"), `session_error` ("Session Error"), `session_disconnected` ("Session Disconnected")
    - Do NOT show `cost_threshold` or `pipeline_stage_complete` (not implemented)
    - Each toggle uses `setTypeEnabled(type, enabled)`
  - **Sound** section:
    - Toggle: "Enable notification sounds" (persisted but not functional — for future use)
    - Small note: "Coming soon"

  Follow the pattern from `about-tab.tsx` — use `Card` + `CardContent` layout. Use shadcn `Switch` component for toggles (if available, otherwise use a checkbox-styled button).
  
  Check if `Switch` component exists:
  ```
  src/components/ui/switch.tsx
  ```
  If not, use the shadcn CLI or implement toggles with `Button` variant toggle.
  **Files**: `src/components/settings/notifications-tab.tsx` (create)
  **Acceptance**: Component renders with all preference toggles. Changes persist to localStorage.

- [ ] 15. **Add Notifications tab to Settings page**
  **What**: Modify `src/app/settings/page.tsx` to add the Notifications tab:
  - Import `NotificationsTab` from `@/components/settings/notifications-tab`
  - Add `<TabsTrigger value="notifications">Notifications</TabsTrigger>` to the `TabsList` (between "Agents" and "About")
  - Add `<TabsContent value="notifications" className="mt-4"><NotificationsTab /></TabsContent>`
  - Update the `Header` subtitle to include "notifications": `"Manage skills, agents, notifications, and configuration"`
  **Files**: `src/app/settings/page.tsx` (modify)
  **Acceptance**: Settings page shows 4 tabs: Skills, Agents, Notifications, About.

### Phase 7: Alerts Page Bulk Actions (depends on Phase 3 API + Phase 4 hook)

- [ ] 16. **Add "Clear all" button to alerts page**
  **What**: Modify `src/app/alerts/page.tsx` to add a "Clear all" button alongside the existing "Mark all as read" button. The `clearAll` function is already available from the `useNotifications` hook (added in Task 10).
  
  In the `Header` actions section (around line 102-107), add a second button:
  ```tsx
  actions={
    notifications.length > 0 ? (
      <div className="flex gap-2">
        {unread.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            Mark all as read
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleClearAll} className="text-destructive">
          Clear all
        </Button>
      </div>
    ) : undefined
  }
  ```
  Add a `handleClearAll` callback:
  ```typescript
  const handleClearAll = useCallback(async () => {
    await clearAll();
    await fetchNotifications(50);
  }, [clearAll, fetchNotifications]);
  ```
  Destructure `clearAll` from `useNotifications()`.
  **Files**: `src/app/alerts/page.tsx` (modify)
  **Acceptance**: "Clear all" button appears when there are any notifications. Clicking it deletes all notifications and refreshes the list.

### Phase 8: Tests

- [ ] 17. **Write notification cleanup tests**
  **What**: Create `src/lib/server/__tests__/notification-cleanup.test.ts`. Test:
  - `deleteOldNotifications` deletes notifications older than the cutoff date
  - `deleteOldNotifications` preserves notifications newer than the cutoff
  - `deleteAllNotifications` deletes everything and returns correct count
  - Integration: inserting notifications with backdated `created_at`, then running cleanup
  
  Follow the existing test pattern (tmpdir DB, `_resetDbForTests`).
  **Files**: `src/lib/server/__tests__/notification-cleanup.test.ts` (create)
  **Acceptance**: `npm run test` passes including new tests.

- [ ] 18. **Write notification emitter tests**
  **What**: Create `src/lib/server/__tests__/notification-emitter.test.ts`. Test:
  - `emitNotification` fires callback registered with `onNotification`
  - Unsubscribe function stops receiving events
  - Multiple subscribers all receive the event
  - Emitting with no subscribers doesn't throw
  **Files**: `src/lib/server/__tests__/notification-emitter.test.ts` (create)
  **Acceptance**: `npm run test` passes including new tests.

- [ ] 19. **Add `input_required` notification test to notification-service tests**
  **What**: Modify `src/lib/server/__tests__/notification-service.test.ts` to add tests for `createInputRequiredNotification`:
  - Creates a notification with type `"input_required"` and correct message format
  - Deduplication: calling twice within 60s for the same session creates only one notification
  **Files**: `src/lib/server/__tests__/notification-service.test.ts` (modify — add test cases)
  **Acceptance**: `npm run test` passes.

### Phase 9: Switch Component (if needed, dependency for Phase 6)

- [ ] 20. **Add shadcn Switch component if not present**
  **What**: Check if `src/components/ui/switch.tsx` exists. If not, add it using the shadcn CLI (`npx shadcn@latest add switch`) or manually create it following the shadcn pattern with Radix UI's Switch primitive. The Switch component is needed for the notification preferences toggles in the Settings tab.
  **Files**: `src/components/ui/switch.tsx` (create if not exists)
  **Acceptance**: `<Switch>` component is importable and renders a toggle switch.

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `src/lib/server/notification-service.ts` | Modify (add `createInputRequiredNotification` + emit events) | 1 |
| `src/app/api/sessions/[id]/events/route.ts` | Modify (detect `permission.*` → fire `input_required`) | 1 |
| `src/lib/server/db-repository.ts` | Modify (add `deleteAllNotifications`, `deleteOldNotifications`) | 1 |
| `src/lib/server/notification-cleanup.ts` | Create | 1 |
| `src/lib/server/process-manager.ts` | Modify (import cleanup module) | 1 |
| `src/lib/server/notification-emitter.ts` | Create | 1 |
| `src/app/api/notifications/stream/route.ts` | Create | 2 |
| `src/app/api/notifications/route.ts` | Modify (add DELETE handler) | 3 |
| `src/hooks/use-notifications.ts` | Modify (SSE subscription + `clearAll`) | 4 |
| `src/hooks/use-browser-notifications.ts` | Create | 5 |
| `src/hooks/use-notification-preferences.ts` | Create | 5 |
| `src/hooks/use-notifications-with-browser.ts` | Create | 5 |
| `src/components/notifications/notification-bell.tsx` | Modify (use wrapper hook) | 5 |
| `src/components/ui/switch.tsx` | Create (if not exists) | 9 |
| `src/components/settings/notifications-tab.tsx` | Create | 6 |
| `src/app/settings/page.tsx` | Modify (add Notifications tab) | 6 |
| `src/app/alerts/page.tsx` | Modify (add "Clear all" button) | 7 |
| `src/lib/server/__tests__/notification-cleanup.test.ts` | Create | 8 |
| `src/lib/server/__tests__/notification-emitter.test.ts` | Create | 8 |
| `src/lib/server/__tests__/notification-service.test.ts` | Modify (add input_required tests) | 8 |

## Parallelization Guide

```
Phase 1 (Server Infrastructure) ─┬─▶ Phase 2 (SSE Endpoint) ─▶ Phase 4 (SSE Hook)
                                  │                                      │
                                  ├─▶ Phase 3 (Bulk APIs) ──────────────┤
                                  │                                      │
                                  └─▶ Phase 9 (Switch component)         ▼
                                           │                    Phase 5 (Browser Push)
                                           ▼                             │
                                  Phase 6 (Settings UI) ◀───────────────┘
                                                                         │
                                                                         ▼
                                                                Phase 7 (Alerts UI)
                                                                         │
                                                                         ▼
                                                                Phase 8 (Tests)
```

**Can run in parallel:**
- Phase 2 + Phase 3 + Phase 9 (all depend only on Phase 1)
- Phase 6 can start as soon as Phase 5 hooks are done + Phase 9

## Verification

- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes — all existing + new tests
- [ ] `input_required` notification fires when a permission event flows through SSE
- [ ] SSE stream at `/api/notifications/stream` delivers notifications in real-time
- [ ] Browser notification appears when tab is not focused (after granting permission)
- [ ] Settings → Notifications tab toggles persist and are respected
- [ ] Notifications older than 7 days are cleaned up on server startup
- [ ] "Clear all" in alerts page deletes all notifications
- [ ] Polling fallback works when SSE connection drops

## Potential Pitfalls

1. **`permission.*` events may not fire in all scenarios** — The OpenCode SDK might handle permissions internally via the config (`permission: { edit: "allow", bash: "allow" }` in process-manager.ts line 402). Since all permissions are set to `"allow"`, `permission.*` events might never fire. If this is the case, `input_required` notifications won't trigger. **Mitigation**: Verify by testing with a session that triggers a permission request. If `permission.*` events don't fire, investigate alternative detection (e.g., session status staying idle with pending messages).

2. **EventSource reconnection** — The browser's native `EventSource` auto-reconnects, but our custom reconnection logic in the hook needs careful coordination. If both the native retry and our `setTimeout` retry fire, we could get duplicate connections. **Mitigation**: Always close the old EventSource before creating a new one; check `eventSourceRef.current` before connecting.

3. **SSE connections accumulate** — Each browser tab creates a new SSE connection. The emitter's `setMaxListeners(100)` should handle typical usage, but stress testing with many tabs could exhaust resources. **Mitigation**: The keepalive timer and abort controller ensure connections are cleaned up when tabs close.

4. **`emitNotification` timing** — The emitted notification's `created_at` is set in JS, not from SQLite's `datetime('now')`. There could be a slight discrepancy. **Mitigation**: This is cosmetic only — the DB value is the source of truth for list queries.

5. **Browser Notification permission denied** — Once denied, users can't re-request via the API — they must change it in browser settings. **Mitigation**: Show a helpful message in the Settings tab explaining how to enable in browser settings when permission is `"denied"`.

6. **Turbopack module re-evaluation** — The notification emitter and cleanup service both use the globalThis singleton pattern (matching process-manager and callback-monitor). This prevents duplicate instances across Turbopack re-evaluations in dev mode.
