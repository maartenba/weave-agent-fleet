# H4: SSE Connection & Event Volume Optimization

## TL;DR
> **Summary**: The app maintains 2–3 simultaneous EventSource connections to the same `/api/notifications/stream` endpoint plus 1 per-session EventSource. The `forceRender` counter pattern in `SessionsProvider` is **broken** (depends on the setter function identity, not the counter value), and duplicate SSE connections can occur on reconnect/StrictMode. The `useSessionEvents` message array grows unbounded during long sessions. Several targeted fixes can reduce re-renders and connection overhead.
> **Estimated Effort**: Medium

## Context

### Original Request
Investigate whether the SSE connection architecture creates performance problems as session count scales — specifically around event volume, `forceRender` counter cascades, reconnection loops, and unbounded message growth.

### Key Findings

#### Finding 1: Two independent EventSource connections to the same endpoint
- `SessionsProvider` (line 87 of `sessions-context.tsx`) opens `new EventSource("/api/notifications/stream")`.
- `NotificationsProvider` (line 162 of `notifications-context.tsx`) opens a second `new EventSource("/api/notifications/stream")`.
- Both are mounted at app root via `client-layout.tsx` (lines 17-36): `SessionsProvider` wraps `NotificationsProvider`.
- Each receives **all** events (both `notification` and `activity_status` types) even though `SessionsProvider` only cares about `activity_status` and `NotificationsProvider` only cares about `notification`.
- **Impact**: 2x SSE connections to the same endpoint, 2x event parsing overhead. Each connection occupies a browser HTTP connection slot.

#### Finding 2: `forceRender` pattern is broken/misleading
- `sessions-context.tsx` line 80: `const [, forceRender] = useState(0);`
- Line 102: `forceRender((n) => n + 1);` — correctly increments the counter.
- Line 133: `useMemo` depends on `[polledSessions, forceRender]` — but `forceRender` is the **setter function** (stable identity from `useState`), NOT the counter value. The counter value is discarded via `const [,`.
- **This means the `useMemo` dependency array never changes due to SSE events**. The `forceRender` setter has a stable identity across renders.
- **However**, calling `forceRender((n) => n + 1)` does cause a re-render (state change), and during that re-render the `useMemo` re-evaluates because React re-runs the component. The dependency array is technically wrong but the behavior accidentally works because `useMemo` runs during the re-render triggered by the state change.
- **Risk**: Future React optimizations (React Compiler) could skip the `useMemo` re-evaluation since deps haven't changed. This is a latent correctness bug.

#### Finding 3: Every `activity_status` event triggers a full component re-render
- `sessions-context.tsx` line 102: Each `activity_status` SSE event calls `forceRender((n) => n + 1)`.
- This re-renders `SessionsProvider` and re-evaluates the `useMemo` on line 117.
- The `useMemo` iterates all patches and all sessions, calling `patchActivityStatus` for each.
- All 7+ consumers of `useSessionsContext()` (sidebar, page, session-group, sidebar-workspace-item, sidebar-session-item, session-commands, page.tsx) will re-render because the context value object changes.
- **With N active sessions, a burst of status transitions (e.g., fleet dispatch starting 10 sessions) produces N×2 events (busy then idle) → N×2 full context re-renders.**

#### Finding 4: `activity_status` events are only emitted on **transitions** (already guarded)
- `session-status-watcher.ts` lines 84, 102, 126, 149: `emitActivityStatus` is only called inside guards like `if (dbSession.status !== "idle")`.
- This means duplicate events for the same status are already suppressed server-side.
- **The volume scales linearly with actual transitions**, not with polling or heartbeats. For N sessions doing work, expect ~2-4 events per session per task cycle (busy→idle, possibly with waiting_input).
- At 10 concurrent sessions, this is ~20-40 events per task cycle — manageable but still causes 20-40 full context re-renders.

#### Finding 5: No reconnection deduplication in `SessionsProvider`
- `sessions-context.tsx` lines 84-113: The `useEffect` has `[]` deps, so it runs once. Cleanup on line 109-112 closes the EventSource.
- **No reconnection logic at all** — if the SSE connection drops, it stays dead. Only the polling fallback (5s interval from `useSessions`) continues working.
- `NotificationsProvider` (lines 188-204) **does** have reconnection: on error, it closes, falls back to polling, and schedules reconnection after 5s.
- **Impact**: `SessionsProvider`'s SSE is fire-and-forget. A network hiccup permanently disables real-time status updates for the sidebar until the page is reloaded.

#### Finding 6: `NotificationsProvider` reconnection can create duplicate connections
- `notifications-context.tsx` line 161: `if (eventSourceRef.current) return;` guards against duplicate connections.
- Line 191: `eventSourceRef.current = null;` clears the ref before scheduling reconnect.
- This is correctly sequenced — the guard works.
- **However**, React StrictMode (dev) mounts → unmounts → remounts, which can cause a brief window where two effects run. The `isMounted` guard (line 170) and cleanup (lines 213-222) handle this correctly.
- **No actual duplication bug here.**

#### Finding 7: `useSessionEvents` message array grows unbounded
- `use-session-events.ts`: Messages accumulate via `setMessages` (lines 99, 293, 300, 318).
- There is **no max size or eviction** — messages grow for the lifetime of the component.
- **Pagination exists** (via `useMessagePagination`), but only for *loading older* messages. New SSE events always append.
- For a long-running session with thousands of tool calls, the messages array can grow to thousands of entries. Each `applyTextDelta` (line 318) creates a new array via spread/slice.
- **Impact**: O(N) array copies on every text delta event during streaming. With 100+ messages, each delta creates a new 100+ element array.

#### Finding 8: Per-session EventSource in `useSessionEvents` — one per viewed session
- `use-session-events.ts` line 127: `new EventSource(url)` where URL is `/api/sessions/${sessionId}/events?instanceId=${instanceId}`.
- This is only instantiated when a session detail page is open.
- Each session detail page gets its own SSE connection to a per-session proxy.
- **This is correct and proportional** — only open session pages have connections.
- Reconnection logic exists (lines 165-185): exponential backoff with MAX_RECONNECT_ATTEMPTS=5, then "abandoned" status.

#### Finding 9: Three simultaneous SSE connections at typical usage
```
Browser Tab
├── SessionsProvider        → EventSource("/api/notifications/stream")  [always]
├── NotificationsProvider   → EventSource("/api/notifications/stream")  [always]
└── SessionDetailPage       → EventSource("/api/sessions/[id]/events")  [when viewing a session]
```
- Connections 1 & 2 go to the same endpoint, receiving identical event streams.
- Connection 3 is per-session and only active when viewing a session detail page.
- Browser SSE connections count against the HTTP/1.1 6-connection limit per origin. HTTP/2 multiplexes, mitigating this.

### Event Flow Diagram

```
Server Side:
┌─────────────────────────────────────────────────────────────┐
│  OpenCode SDK Instance (per session)                        │
│    event.subscribe() → AsyncIterable<event>                 │
│         │                                                   │
│         ├──→ session-status-watcher.ts                      │
│         │    processEventStream()                           │
│         │      ├── session.status (busy/idle) detected      │
│         │      │     └── updateSessionStatus(DB)            │
│         │      │     └── emitActivityStatus() ──────────┐   │
│         │      └── permission.* detected                │   │
│         │            └── emitActivityStatus() ──────────┤   │
│         │                                               │   │
│         └──→ sessions/[id]/events/route.ts (SSE proxy)  │   │
│              isRelevantToSession() filter                │   │
│              └── forwards to browser per-session SSE     │   │
│                                                          │   │
│  notification-emitter.ts (EventEmitter singleton)  ◄─────┘   │
│    ├── "notification" events (from notification-service)     │
│    └── "activity_status" events (from status-watcher)        │
│         │                                                    │
│         └──→ /api/notifications/stream/route.ts              │
│              Sends to ALL connected SSE clients:             │
│              { type: "notification", notification }           │
│              { type: "activity_status", payload }             │
└─────────────────────────────────────────────────────────────┘

Client Side:
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  ┌── SessionsProvider (always mounted) ────────────────────┐ │
│  │  EventSource("/api/notifications/stream")               │ │
│  │  onmessage:                                             │ │
│  │    IF type === "activity_status" →                       │ │
│  │      ssePatchesRef.set(sessionId, status)               │ │
│  │      forceRender(n => n+1)  ← triggers re-render       │ │
│  │    ELSE → ignored (notifications are irrelevant here)   │ │
│  │                                                         │ │
│  │  useMemo merges polledSessions + ssePatchesRef          │ │
│  │    → new sessions array → context update                │ │
│  │    → 7+ consumers re-render                             │ │
│  │                                                         │ │
│  │  NO reconnection logic — connection loss = permanent    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌── NotificationsProvider (always mounted) ───────────────┐ │
│  │  EventSource("/api/notifications/stream")               │ │
│  │  onmessage:                                             │ │
│  │    IF type === "notification" →                          │ │
│  │      setUnreadCount(+1), setNotifications(prepend)      │ │
│  │    ELSE → ignored (activity_status is irrelevant here)  │ │
│  │                                                         │ │
│  │  Reconnection: yes (5s delay, polling fallback)         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌── useSessionEvents (when viewing a session) ────────────┐ │
│  │  EventSource("/api/sessions/[id]/events?instanceId=X")  │ │
│  │  onmessage: handleEvent() →                             │ │
│  │    session.status → setSessionStatus                    │ │
│  │    message.updated → setMessages (grow unbounded)       │ │
│  │    message.part.updated → setMessages                   │ │
│  │    message.part.delta → setMessages (per character!)     │ │
│  │                                                         │ │
│  │  Reconnection: yes (exponential backoff, max 5 retries) │ │
│  │  Messages: UNBOUNDED growth, no eviction                │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Objectives

### Core Objective
Reduce unnecessary re-renders and resource consumption from SSE event processing without breaking real-time update functionality.

### Deliverables
- [ ] Unified SSE connection for notifications stream (merge SessionsProvider + NotificationsProvider into one EventSource)
- [ ] Fix `forceRender` pattern with correct state management
- [ ] Add reconnection logic to `SessionsProvider`'s SSE subscription
- [ ] Batch/debounce `activity_status` events before triggering re-renders
- [ ] Cap `useSessionEvents` message array to prevent unbounded growth

### Definition of Done
- [ ] Only 1 EventSource to `/api/notifications/stream` per browser tab (not 2)
- [ ] `SessionsProvider`'s SSE reconnects after network interruption
- [ ] Multiple rapid `activity_status` events produce at most 1 re-render per animation frame
- [ ] `useSessionEvents` messages array does not exceed a configurable max size
- [ ] All existing tests pass: `npm run test`
- [ ] No regressions in sidebar real-time dot updates or notification badge

### Guardrails (Must NOT)
- Must NOT break the per-session EventSource in `useSessionEvents` (it's correctly scoped)
- Must NOT remove polling fallbacks (they're the safety net)
- Must NOT change the SSE server-side protocol (event types, payload shapes)
- Must NOT use SharedWorker (adds complexity, not justified for 2→1 connection savings)

## Feasibility Assessment

| Approach | Feasibility | Impact | Recommendation |
|----------|------------|--------|----------------|
| **Debounce/batch SSE events** | ✅ High — use `requestAnimationFrame` to coalesce patches before triggering render | Medium — reduces N re-renders to 1 per frame during bursts | **Do: Phase 1** |
| **Fix forceRender pattern** | ✅ High — replace with proper state (counter in deps, or useReducer) | Medium — correctness fix, prevents future breakage with React Compiler | **Do: Phase 1** |
| **Unified EventSource (merge 2→1)** | ✅ High — create shared hook, both contexts subscribe to it | High — halves SSE connections, reduces event parsing | **Do: Phase 2** |
| **Add reconnection to SessionsProvider SSE** | ✅ High — follow NotificationsProvider pattern | High — currently a silent failure mode | **Do: Phase 1** |
| **Throttle activity_status per session per second** | ⚠️ Medium — already guarded server-side by transition checks; client-side throttle adds complexity | Low — server already deduplicates, bursts are short-lived | **Skip** — the batch/debounce approach covers this more cleanly |
| **Cap message arrays with max size** | ⚠️ Medium — needs careful UX (what happens when old messages are evicted? pagination already exists) | Medium — only affects very long sessions (1000+ messages) | **Do: Phase 3** — behind a constant, non-breaking |
| **SharedWorker for SSE** | ❌ Low — adds significant complexity (worker lifecycle, message passing, error handling), only saves 1 connection in multi-tab scenario | Low — most users have 1-2 tabs | **Skip** — not worth the complexity |

## TODOs

### Phase 1: Fix correctness issues and add batching (no architecture changes)

- [ ] 1. Fix `forceRender` pattern in `SessionsProvider`
  **What**: Replace the broken `forceRender` setter-in-deps pattern with a proper state variable that `useMemo` can depend on. Option A: expose the counter value and include it in deps. Option B: use `useReducer` for a simpler force-render pattern.
  **Files**: `src/contexts/sessions-context.tsx` (lines 80, 102, 131-133)
  **Implementation**:
  - Change line 80 from `const [, forceRender] = useState(0)` to `const [patchVersion, setPatchVersion] = useState(0)`
  - Change line 102 from `forceRender((n) => n + 1)` to `setPatchVersion((n) => n + 1)`
  - Change line 133 from `}, [polledSessions, forceRender])` to `}, [polledSessions, patchVersion])`
  - Remove the eslint-disable comment on line 132
  **Acceptance**: `useMemo` correctly depends on the counter value. Sidebar dots still update in real-time when session status changes.

- [ ] 2. Batch `activity_status` SSE events with `requestAnimationFrame`
  **What**: Instead of calling `setPatchVersion` on every individual `activity_status` event, accumulate patches in the ref and schedule a single `requestAnimationFrame` callback to trigger one re-render per frame.
  **Files**: `src/contexts/sessions-context.tsx` (lines 89-106)
  **Implementation**:
  - Add a `rafIdRef = useRef<number | null>(null)` 
  - In `onmessage`, after updating `ssePatchesRef`, check if a RAF is already scheduled; if not, schedule one: `rafIdRef.current = requestAnimationFrame(() => { rafIdRef.current = null; setPatchVersion(n => n+1); })`
  - In cleanup, cancel any pending RAF: `if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)`
  **Acceptance**: Sending 10 `activity_status` events in quick succession (e.g., in a test) produces at most 1-2 re-renders instead of 10. Sidebar dots still update within 1 frame (~16ms).

- [ ] 3. Add reconnection logic to `SessionsProvider` SSE subscription
  **What**: When the EventSource errors out, close it, and schedule reconnection with the same pattern used by `NotificationsProvider` (5s delay, guard against duplicates). The polling fallback (5s via `useSessions`) already covers the gap.
  **Files**: `src/contexts/sessions-context.tsx` (lines 84-113)
  **Implementation**:
  - Add `eventSourceRef` and `reconnectTimerRef` refs (following notifications-context pattern)
  - Add `es.onerror` handler that closes the EventSource, clears the ref, and schedules reconnection after 5s
  - In cleanup, also clear the reconnect timer
  - Guard `connectSSE` with `if (eventSourceRef.current) return;` to prevent duplicates
  **Acceptance**: After manually killing the SSE connection (e.g., network offline → online), the `SessionsProvider` re-establishes its SSE subscription. Verify by watching Network tab.

### Phase 2: Unify SSE connections

- [ ] 4. Create a shared `useGlobalSSE` hook
  **What**: Extract EventSource management for `/api/notifications/stream` into a shared hook that both `SessionsProvider` and `NotificationsProvider` can subscribe to. The hook owns the single EventSource and dispatches events to registered listeners.
  **Files**: 
  - Create `src/hooks/use-global-sse.ts` (new file)
  - Modify `src/contexts/sessions-context.tsx` — replace inline EventSource with `useGlobalSSE`
  - Modify `src/contexts/notifications-context.tsx` — replace inline EventSource with `useGlobalSSE`
  **Design**:
  ```
  // use-global-sse.ts API sketch:
  type SSEListener = (data: unknown) => void;
  function useGlobalSSE(listener: SSEListener): { status: "connected" | "disconnected" }
  ```
  - The hook manages a module-level singleton EventSource (not per-component)
  - Reconnection logic lives here (consolidated from both providers)
  - Listeners are registered/unregistered via ref counting
  - When listener count drops to 0, close the EventSource
  **Acceptance**: Network tab shows exactly 1 EventSource connection to `/api/notifications/stream` instead of 2. Both notification badge and sidebar dots continue updating in real-time.

- [ ] 5. Update `SessionsProvider` to use `useGlobalSSE`
  **What**: Replace the inline `new EventSource` and reconnection logic with a call to `useGlobalSSE`. The listener filters for `activity_status` events and updates `ssePatchesRef`.
  **Files**: `src/contexts/sessions-context.tsx`
  **Acceptance**: Same behavior as before but using the shared connection.

- [ ] 6. Update `NotificationsProvider` to use `useGlobalSSE`
  **What**: Replace the inline `new EventSource`, reconnection, and polling-fallback logic with `useGlobalSSE`. The listener filters for `notification` events.
  **Files**: `src/contexts/notifications-context.tsx`
  **Acceptance**: Same behavior as before but using the shared connection. Polling fallback still activates when SSE is down.

### Phase 3: Message array capping

- [ ] 7. Add max message cap to `useSessionEvents`
  **What**: When the messages array exceeds a configurable MAX_MESSAGES (e.g., 500), drop the oldest messages from the front. Since pagination already supports loading older messages, this is safe — users can scroll up to load evicted messages.
  **Files**: `src/hooks/use-session-events.ts` (handleEvent function, lines 256-322)
  **Implementation**:
  - Add constant `const MAX_MESSAGES = 500;`
  - After any `setMessages` call that adds messages, check length and trim: `setMessages(prev => { const next = ...; return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next; })`
  - Update `hasMoreMessages` to always be true if messages were evicted (since there are definitely older messages available)
  - Consider a wrapper: `function capMessages(msgs: AccumulatedMessage[]): AccumulatedMessage[] { return msgs.length > MAX_MESSAGES ? msgs.slice(-MAX_MESSAGES) : msgs; }`
  **Acceptance**: A session with 600+ messages only keeps the latest 500 in the React state. Scrolling up triggers `loadOlderMessages` correctly. No visible UX regression for sessions with < 500 messages.

- [ ] 8. Add tests for message capping
  **What**: Unit tests verifying that messages are capped at MAX_MESSAGES, that pagination `hasMore` is correctly set when messages are evicted, and that `loadOlderMessages` can retrieve evicted messages.
  **Files**: `src/hooks/__tests__/use-session-events-capping.test.ts` (new file, or add to existing test file if one exists)
  **Acceptance**: Tests pass with `npm run test`.

## Verification
- [ ] `npm run test` — all existing tests pass
- [ ] `npm run build` — no TypeScript errors
- [ ] Manual: open Network tab, verify only 1 SSE to `/api/notifications/stream` (after Phase 2)
- [ ] Manual: start 5+ sessions simultaneously, verify sidebar dots update without visible lag
- [ ] Manual: disable network briefly, verify SSE reconnects (after Phase 1 task 3)
- [ ] Manual: open a session with 500+ messages, verify smooth scrolling and correct pagination

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `useGlobalSSE` singleton EventSource creates shared failure mode — if it breaks, both notifications and sessions lose real-time | Medium | Keep polling fallbacks in both consumers. The shared hook should have robust reconnection logic. |
| Message capping breaks scroll position — user is reading a message that gets evicted | Low | Only evict from front (oldest). Cap is high (500). Users reading recent messages are unaffected. |
| `requestAnimationFrame` batching adds 16ms latency to sidebar dot updates | Negligible | 16ms is imperceptible. The current path (setState → render → paint) already takes ~16ms through React's batching. |
| React Compiler compatibility — fixing `forceRender` is necessary prep | Medium | Phase 1 Task 1 addresses this directly. Without the fix, React Compiler could skip the `useMemo`. |
| Phase 2 refactoring scope — touching both providers simultaneously | Medium | Phase 1 is independently valuable and can ship alone. Phase 2 can be deferred if needed. |
