# Sidebar Real-Time Status via Global Notifications SSE

## TL;DR
> **Summary**: Augment the existing global notifications SSE stream to carry session activity status changes, so the sidebar updates session dots in real-time instead of waiting for the 5-second REST polling interval.
> **Estimated Effort**: Medium

## Context

### Original Request
Make sidebar session status indicators (busy/idle/waiting_input dots) update in real-time by piggybacking on the existing global notifications SSE stream (`/api/notifications/stream`), eliminating the 5-second polling lag visible in the sidebar while the session detail pane updates instantly.

### Key Findings

1. **Session-status-watcher already exists and is the perfect emission point.** `src/lib/server/session-status-watcher.ts` is a server-side singleton that subscribes to OpenCode SDK event streams for every running instance and persists `session.status` (busy/idle) transitions to the Fleet DB. It already handles the critical gap identified in the requirements — it runs independently of whether any session detail page is open. **However, `ensureWatching()` is never called anywhere in the codebase.** It was built but never wired in. This is the first thing to fix.

2. **The notification emitter supports ephemeral events.** The `NotificationEmitter` is a simple EventEmitter. Currently `emitNotification()` always pairs with an `insertNotification()` DB write. For activity status events, we want a lightweight "signal" approach — emit through the emitter without persisting to the notifications table (these are transient state changes, not user-facing notifications).

3. **The notifications SSE stream route already forwards everything from the emitter.** `src/app/api/notifications/stream/route.ts` subscribes via `onNotification()` and pushes `{ type: "notification", notification }` to the client. We need a second event channel on the same emitter — a new event name (e.g., `"activity_status"`) that the stream route also subscribes to.

4. **The `NotificationsProvider` already handles SSE with reconnect + polling fallback.** The client-side `notifications-context.tsx` connects to `/api/notifications/stream`, with `onerror` fallback to polling and auto-reconnect after 5 seconds. The activity status consumer can share this same EventSource connection.

5. **The sessions polling (`useSessions`) already corrects stale status.** `GET /api/sessions` in `route.ts` calls `session.status()` on each live instance and corrects DB state if it finds mismatches. This polling acts as a natural fallback if the SSE stream drops.

6. **Sidebar components need zero changes.** `sidebar-session-item.tsx` reads `activityStatus` from `SessionListItem` and renders the dot accordingly. `sidebar-workspace-item.tsx` reads `hasRunningSession` from `WorkspaceGroup`. Both derive from the `sessions` array in `SessionsContext`. We only need to patch the `sessions` state in-place when an activity status event arrives.

### Architecture Diagram (data flow after this change)

```
OpenCode SDK events (per instance)
        │
        ▼
session-status-watcher.ts (server singleton, one subscription per instance)
        │
        ├── updateSessionStatus() → Fleet DB (existing)
        │
        └── emitActivityStatus() → NotificationEmitter (NEW)
                                        │
                                        ▼
                              /api/notifications/stream SSE (existing endpoint)
                                        │
                                        ▼
                              SessionsProvider (client) patches sessions[] in-place (NEW)
                                        │
                                        ▼
                              SidebarSessionItem / SidebarWorkspaceItem re-renders (existing)
```

## Objectives

### Core Objective
Enable real-time sidebar status dot updates by emitting session activity status changes through the existing global notifications SSE stream and consuming them in the sessions context.

### Deliverables
- [x] Wire up `ensureWatching()` from session-status-watcher so it's actually called for every instance
- [x] Add ephemeral activity status emission to the notification emitter (separate from persisted notifications)
- [x] Forward activity status events through the global SSE stream
- [x] Consume activity status events in `SessionsProvider` to patch `sessions[]` in real-time
- [x] Maintain polling as a fallback (no changes to polling interval)

### Definition of Done
- [ ] When a session transitions to busy, the sidebar dot turns green+pulsing within <1 second (not 5 seconds)
- [ ] When a session transitions to idle, the sidebar dot turns grey within <1 second
- [ ] When the SSE stream disconnects, the polling fallback still works (existing behavior preserved)
- [ ] No per-session SSE connections are created for sidebar updates
- [ ] Workspace-level "has running session" dot also updates in real-time
- [ ] All existing tests pass; new tests cover the activity status emission + consumption

### Guardrails (Must NOT)
- Must NOT create one SSE connection per session for the sidebar
- Must NOT remove or slow down the existing polling — it's the fallback
- Must NOT persist activity status events to the notifications DB table (they're ephemeral signals, not user notifications)
- Must NOT change the per-session SSE proxy behavior (`/api/sessions/[id]/events`)
- Must NOT change sidebar component rendering logic — only the data source needs to update faster

## TODOs

- [x] 1. **Wire up `ensureWatching()` in process-manager**
  **What**: The `session-status-watcher.ts` module exports `ensureWatching(instanceId)` but it's never called. Call it in two places: (a) after `spawnInstance()` successfully creates/returns an instance, and (b) during `recoverInstances()` after each instance is recovered. Also call `stopWatching()` in `destroyInstance()`.
  **Files**:
  - `src/lib/server/process-manager.ts` — add import of `ensureWatching` and `stopWatching` from `./session-status-watcher`, call `ensureWatching(instanceId)` at the end of `spawnInstance()` (after line 522), call `ensureWatching(dbInst.id)` after the recovered instance is registered (after line 388), call `stopWatching(id)` at the start of `destroyInstance()` (after line 534).
  **Acceptance**: After spawning a new instance or recovering one, `getWatchers().has(instanceId)` returns true. Verify with a unit test or log statement.

- [x] 2. **Add ephemeral event channel to NotificationEmitter**
  **What**: Add a second event type `"activity_status"` to the emitter, alongside the existing `"notification"` event. Create `emitActivityStatus(payload)` and `onActivityStatus(callback)` functions. The payload shape should be `{ sessionId: string; instanceId: string; activityStatus: SessionActivityStatus }`. This is a fire-and-forget ephemeral signal — no DB insert.
  **Files**:
  - `src/lib/server/notification-emitter.ts` — add `ActivityStatusPayload` interface, `emitActivityStatus()`, and `onActivityStatus()` functions following the same pattern as the existing notification functions.
  **Acceptance**: Calling `emitActivityStatus(payload)` causes registered `onActivityStatus` callbacks to receive the payload. Verify with a unit test.

- [x] 3. **Emit activity status changes from session-status-watcher**
  **What**: In `processEventStream()` within `session-status-watcher.ts`, after each successful `updateSessionStatus()` call, also call `emitActivityStatus()` with the session's opencode session ID, instance ID, and the new activity status. Map: `"busy"` → `"busy"`, `"idle"` → `"idle"`. For the `session.idle` event type, emit `"idle"`. Do NOT emit when the DB status was already the same (the existing `if (dbSession.status !== "idle")` / `if (dbSession.status !== "active")` guards already handle this — only emit inside those guards).
  **Files**:
  - `src/lib/server/session-status-watcher.ts` — import `emitActivityStatus` from `./notification-emitter`, call it after each `updateSessionStatus()` call inside the existing guards (~3 call sites: line 84, line 97, line 116).
  **Acceptance**: When a session transitions busy→idle or idle→busy on any instance, an activity status event is emitted through the emitter.

- [x] 4. **Forward activity status events through the global SSE stream**
  **What**: In the global notifications SSE route handler, subscribe to `onActivityStatus()` in addition to the existing `onNotification()`. Send activity status events with a distinct `type` field (e.g., `{ type: "activity_status", payload: { sessionId, instanceId, activityStatus } }`) so the client can distinguish them from notification events.
  **Files**:
  - `src/app/api/notifications/stream/route.ts` — import `onActivityStatus` from `@/lib/server/notification-emitter`, add a second subscription in the `start()` function, send events with `type: "activity_status"`, clean up the subscription in the abort handler.
  **Acceptance**: When an activity status event is emitted, SSE clients receive a `data:` frame with `type: "activity_status"`.

- [x] 5. **Consume activity status events in SessionsProvider**
  **What**: The `SessionsProvider` (in `sessions-context.tsx`) currently only uses polling via `useSessions(5000)`. Add a `useEffect` that opens its own `EventSource` to `/api/notifications/stream` and listens for `activity_status` events. When one arrives, patch the corresponding session in the `sessions` state array in-place (update `activityStatus`, `sessionStatus`, and `lifecycleStatus` fields). 
  
  **Design decision — where to subscribe**: Rather than coupling this to the `NotificationsProvider` (which manages unread counts and is a separate concern), the `SessionsProvider` should manage its own EventSource connection to `/api/notifications/stream`. This avoids coupling two independent contexts and keeps the change surgical. The browser will reuse the same HTTP/2 connection, so the cost of a second EventSource to the same URL is negligible.
  
  **Alternative considered**: Sharing the same EventSource from `NotificationsProvider`. Rejected because: (a) it couples unrelated contexts, (b) `NotificationsProvider` manages its own reconnect/polling lifecycle, and (c) the activity status consumer needs a different `onmessage` filter. If connection count becomes a concern later, the two can be unified behind a shared hook.
  
  **Patch logic**: When an `activity_status` event arrives with `{ sessionId, activityStatus }`, find the matching session in `sessions[]` by `session.id === sessionId`, then update: `activityStatus` → the new value, `sessionStatus` → derive from activityStatus (`"busy"` → `"active"`, `"idle"` → `"idle"`, `"waiting_input"` → `"waiting_input"`). The next poll will overwrite with the canonical server state, which should be identical.
  **Files**:
  - `src/contexts/sessions-context.tsx` — refactor to use `useState` for sessions (instead of delegating entirely to `useSessions`), add `useEffect` for EventSource subscription, add patch logic on `activity_status` events, keep `useSessions` polling as the baseline data source, merge SSE patches on top.
  - `src/hooks/use-sessions.ts` — expose `setSessions` or add a `patchSession` callback so the context can imperatively update individual sessions. Alternative: have `useSessions` return a `ref` to the setter, or move state management up to the context. The cleanest approach: add an optional `onActivityStatusEvent` callback parameter, or simply have `useSessions` accept a `patchFn` that the context provides.
  **Acceptance**: When a session transitions, the sidebar dot updates within 1 second. When SSE disconnects, the 5-second polling still works. No extra EventSource connections per session.

- [x] 6. **Handle `waiting_input` status in session-status-watcher**
  **What**: The session-status-watcher currently only handles `session.status` (busy/idle) and `session.idle` events. It does not detect `permission.*` events that indicate a session is waiting for input. Add handling for `permission.*` events: when one is received, emit an activity status of `"waiting_input"`. When the session subsequently becomes `"busy"` again, the existing busy handler will naturally clear the waiting_input state.
  **Files**:
  - `src/lib/server/session-status-watcher.ts` — add a new branch in `processEventStream()` for `type.startsWith("permission.")` that updates DB status to `"waiting_input"` and emits activity status `"waiting_input"`.
  **Acceptance**: When a session enters a permission prompt, the sidebar shows the waiting_input indicator in real-time.

- [x] 7. **Add unit tests for the new emission path**
  **What**: Test the full emission chain: (a) `emitActivityStatus` and `onActivityStatus` in the notification emitter, (b) session-status-watcher emitting activity status when processing events, (c) the SSE stream route forwarding activity status events.
  **Files**:
  - `src/lib/server/__tests__/notification-emitter.test.ts` — add tests for `emitActivityStatus` / `onActivityStatus`
  - `src/lib/server/__tests__/session-status-watcher.test.ts` — new test file, test that `processEventStream` calls `emitActivityStatus` when status changes are detected, and does NOT emit when status is already the same
  **Acceptance**: All new tests pass. `npm test` passes with no regressions.

- [x] 8. **Add integration test for client-side patching**
  **What**: Test that the `SessionsProvider` correctly patches sessions when an activity status SSE event arrives. Mock the EventSource and verify the sessions state updates.
  **Files**:
  - `src/contexts/__tests__/sessions-context.test.tsx` — new test file (or add to existing if one exists), test that: (a) initial state comes from polling, (b) activity status event patches the correct session, (c) next poll overwrites cleanly, (d) unknown sessionId is ignored.
  **Acceptance**: Tests pass, confirming the SSE patch + polling fallback coexistence.

## Verification

- [x] All existing tests pass (`npm test`)
- [x] New tests pass for notification emitter activity status events
- [x] New tests pass for session-status-watcher emission
- [x] New tests pass for client-side patching in SessionsProvider
- [ ] Manual test: open sidebar with multiple sessions, send a prompt to one, observe the dot turns green+pulsing within <1 second
- [ ] Manual test: wait for the session to finish, observe the dot turns grey within <1 second
- [ ] Manual test: disconnect the network briefly, observe that polling recovers the correct state within 5 seconds
- [ ] Manual test: close all session detail pages, send a prompt via API, observe sidebar still updates in real-time (proves session-status-watcher works without per-session SSE)
- [ ] No regressions in notification bell behavior (existing notification types still flow correctly)
- [ ] Release build compiles (`npm run build`)

## Implementation Order & Dependencies

```
TODO 1 (wire ensureWatching) ← no dependencies, enables all subsequent work
    │
    ▼
TODO 2 (emitter channel) ← standalone, pure infra
    │
    ├──► TODO 3 (emit from watcher) ← depends on 1 + 2
    │        │
    │        └──► TODO 4 (SSE stream forwarding) ← depends on 2
    │                  │
    │                  └──► TODO 5 (client consumption) ← depends on 4
    │
    └──► TODO 6 (waiting_input) ← depends on 2, can parallel with 3-5
    
TODO 7 (server tests) ← depends on 2, 3
TODO 8 (client tests) ← depends on 5
```

## Pitfalls & Mitigations

| Pitfall | Mitigation |
|---------|------------|
| **Two EventSource connections** to the same endpoint from the same tab (one for notifications, one for sessions). | Acceptable: HTTP/2 multiplexes on a single TCP connection. If it becomes a concern, unify behind a shared `useGlobalSSE` hook later. |
| **Race between SSE patch and poll overwrite** — SSE updates `activityStatus` to "busy", then poll overwrites with stale "idle" from a slow API response. | Non-issue: the `GET /api/sessions` route now queries live SDK status and corrects mismatches. By the time the poll response arrives, the SDK will report the correct status. The SSE update just makes it faster. |
| **Session-status-watcher event stream breaks** — the SDK subscription can error/disconnect. | Already handled: `processEventStream` catches errors and removes the watcher from the map. A subsequent `ensureWatching` call (e.g., triggered by the next API request or a recovery cycle) will re-establish it. Consider adding a retry timer in a follow-up. |
| **Memory leak from EventSource in SessionsProvider** — if cleanup doesn't run. | Use `useEffect` cleanup function to close the EventSource. Follow the same pattern as `NotificationsProvider` with `isMounted` ref guard. |
| **`ensureWatching` creates duplicate SDK subscriptions** — if called twice for the same instance. | Already idempotent: `ensureWatching` checks `watchers.has(instanceId)` and returns early if already watching. |
| **Activity status events emitted for sessions not in the sidebar** — e.g., sessions that have been stopped/archived. | Harmless: the client-side patch uses `Array.find()` to locate the session — if not found, the event is silently dropped. |
