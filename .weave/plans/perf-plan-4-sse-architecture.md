# Performance Plan 4: SSE Architecture — Unified EventSource

## TL;DR
> **Summary**: Create a shared `useGlobalSSE` hook backed by a module-level singleton EventSource, then migrate `SessionsProvider` and `NotificationsProvider` to share a single browser SSE connection instead of opening two independent connections to the same endpoint.
> **Estimated Effort**: Medium (2–3 days)

## Context
### Original Request
The application opens two independent `EventSource` connections to `/api/notifications/stream` — one from `SessionsProvider` (line 87 of `sessions-context.tsx`) and one from `NotificationsProvider` (line 162 of `notifications-context.tsx`). This doubles SSE connection overhead (browser connection limit, server resources, keepalive traffic).

### Key Findings
- **`sessions-context.tsx` line 87**: `new EventSource("/api/notifications/stream")` — listens only for `activity_status` events. No `onerror`/reconnection (Plan 1 Task 6 adds this).
- **`notifications-context.tsx` line 162**: `new EventSource("/api/notifications/stream")` — listens for `notification` and `activity_status` events. HAS reconnection logic (lines 188–204) with exponential backoff.
- Both connect to the **same** endpoint (`/api/notifications/stream`) but process different event types.
- The `NotificationsProvider` has mature reconnection logic that `SessionsProvider` lacks. A shared hook can provide one reconnection implementation for both.
- H4 recommends a module-level singleton (not a new React context provider) to avoid adding another context re-render source. Uses ref-counted subscriptions so the EventSource stays alive as long as at least one subscriber exists.

## Prerequisites
- **Plan 1 Tasks 5–6 must be completed first** — SSE batching and reconnection logic in `SessionsProvider`. Plan 4 replaces that implementation with the shared hook, but the patterns from Plan 1 inform the design.

## Expected Impact
- SSE connections reduced from 2 to 1 (50% reduction in browser SSE connections)
- Single reconnection implementation with exponential backoff
- Simplified provider code — both providers become thin subscribers to typed event channels

## Objectives
### Core Objective
Eliminate the duplicate SSE connection by creating a shared, ref-counted EventSource singleton.

### Deliverables
- [ ] New `useGlobalSSE` hook with module-level singleton and ref-counted lifecycle
- [ ] `SessionsProvider` migrated to use `useGlobalSSE`
- [ ] `NotificationsProvider` migrated to use `useGlobalSSE`
- [ ] Only one `EventSource` connection visible in browser Network tab

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] Browser DevTools Network tab shows exactly 1 EventSource connection to `/api/notifications/stream`
- [ ] Both activity status updates (sidebar) and notification toasts still work

### Guardrails (Must NOT)
- Must NOT create a new React context provider (use module singleton pattern)
- Must NOT change the SSE wire format or server endpoint
- Must NOT break the existing `NotificationsProvider` reconnection behavior

---

## TODOs

- [ ] 1. **Create `useGlobalSSE` hook**
  **What**: A new hook backed by a module-level singleton `EventSource`. Uses ref-counting so the connection stays alive as long as ≥1 component is subscribed, and closes when the last subscriber unmounts. Provides typed event channels via callback registration.
  **Files**: `src/hooks/use-global-sse.ts` (new file)
  **Details**:
  Architecture:
  ```
  Module-level singleton:
  ├── eventSource: EventSource | null
  ├── subscriberCount: number
  ├── listeners: Map<eventType, Set<callback>>
  ├── reconnectTimer / backoff state
  └── connect() / disconnect() / subscribe() / unsubscribe()
  ```

  Key design decisions:
  - **Module singleton, not React context**: Avoids adding a provider to the component tree and prevents context re-render cascades.
  - **Ref-counted**: `subscribe()` increments count and connects if count goes from 0→1. `unsubscribe()` decrements and disconnects if count goes from 1→0.
  - **Typed channels**: Subscribers register for specific event types (e.g., `"activity_status"`, `"notification"`). The singleton parses JSON once and dispatches to relevant callbacks.
  - **Built-in reconnection**: Exponential backoff with jitter, matching the existing `NotificationsProvider` pattern (base 1s, max 30s, reset on successful open).
  - **`requestAnimationFrame` batching**: For high-frequency events, batch dispatches per frame (carry over from Plan 1 Task 5).

  Hook API:
  ```ts
  interface SSESubscription {
    /** Register a callback for a specific event type */
    on(eventType: string, callback: (payload: unknown) => void): void;
    /** Remove a specific callback */
    off(eventType: string, callback: (payload: unknown) => void): void;
  }

  function useGlobalSSE(): SSESubscription;
  ```

  The hook:
  1. On mount: increments subscriber count, connects if needed
  2. On unmount: decrements subscriber count, disconnects if last
  3. Returns stable `on`/`off` methods (via `useRef`)

  Reconnection logic (port from `notifications-context.tsx` lines 188–204):
  ```ts
  let reconnectDelay = 1000;
  const MAX_DELAY = 30_000;

  function scheduleReconnect() {
    const delay = reconnectDelay + Math.random() * 1000; // jitter
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    reconnectTimer = setTimeout(connect, delay);
  }

  function onOpen() {
    reconnectDelay = 1000; // reset on success
  }
  ```

  **Acceptance**: Unit test showing that 2 components using `useGlobalSSE` results in 1 EventSource creation, and unmounting both results in EventSource closure.

- [ ] 2. **Migrate `SessionsProvider` to `useGlobalSSE`**
  **What**: Replace the inline `EventSource` creation in `SessionsProvider` (lines 84–113) with `useGlobalSSE`, subscribing only to `"activity_status"` events.
  **Files**: `src/contexts/sessions-context.tsx`
  **Details**:
  ```tsx
  // BEFORE (lines 84-113)
  useEffect(() => {
    isMounted.current = true;
    const es = new EventSource("/api/notifications/stream");
    es.onmessage = (e: MessageEvent<string>) => { ... };
    return () => { ... es.close(); };
  }, []);

  // AFTER
  const sse = useGlobalSSE();

  useEffect(() => {
    function handleActivityStatus(payload: unknown) {
      const data = payload as {
        sessionId: string;
        activityStatus: SessionActivityStatus;
      };
      ssePatchesRef.current = new Map(ssePatchesRef.current);
      ssePatchesRef.current.set(data.sessionId, data.activityStatus);
      // rAF batching (from Plan 1 Task 5)
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setSseGeneration(n => n + 1);
        });
      }
    }

    sse.on("activity_status", handleActivityStatus);
    return () => sse.off("activity_status", handleActivityStatus);
  }, [sse]);
  ```

  This eliminates:
  - The `new EventSource(...)` call (line 87)
  - The manual `es.close()` cleanup (line 111)
  - The reconnection logic added in Plan 1 Task 6 (now handled by the shared hook)

  **Acceptance**: `SessionsProvider` no longer creates its own `EventSource`. Activity status updates still work in the sidebar.

- [ ] 3. **Migrate `NotificationsProvider` to `useGlobalSSE`**
  **What**: Replace the inline `EventSource` creation in `NotificationsProvider` (line 162) and its reconnection logic (lines 188–204) with `useGlobalSSE`, subscribing to `"notification"` and `"activity_status"` events.
  **Files**: `src/contexts/notifications-context.tsx`
  **Details**:
  The `NotificationsProvider` currently handles two event types:
  1. `notification` — adds to notification list, shows toast
  2. `activity_status` — updates `activityStatuses` map

  Both should be registered as separate channel callbacks via `useGlobalSSE`:
  ```tsx
  const sse = useGlobalSSE();

  useEffect(() => {
    function handleNotification(payload: unknown) {
      // ... existing notification processing logic ...
    }
    function handleActivityStatus(payload: unknown) {
      // ... existing activity status processing logic ...
    }

    sse.on("notification", handleNotification);
    sse.on("activity_status", handleActivityStatus);
    return () => {
      sse.off("notification", handleNotification);
      sse.off("activity_status", handleActivityStatus);
    };
  }, [sse]);
  ```

  This eliminates:
  - The `new EventSource(...)` call (line 162)
  - The entire reconnection block (lines 188–204)
  - The `eventSourceRef`, `reconnectTimerRef`, `reconnectAttemptsRef` refs

  The `NotificationsProvider`'s `useMemo` for context value (lines 252–271) should remain — it's correctly implemented.

  **Acceptance**: `NotificationsProvider` no longer creates its own `EventSource`. Notification toasts still appear. Reconnection still works (now handled by the shared hook).

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] Browser DevTools Network tab: exactly 1 EventSource connection to `/api/notifications/stream` (not 2)
- [ ] Manual test: sidebar activity status updates still work in real-time
- [ ] Manual test: notification bell still shows new notifications in real-time
- [ ] Manual test: disconnect network for 5s, reconnect → single SSE reconnects, both providers resume receiving events
- [ ] No console errors related to SSE or EventSource
