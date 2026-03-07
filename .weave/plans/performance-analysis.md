# Performance Analysis — Weave Agent Fleet

## TL;DR
> **Summary**: The Fleet UI suffers from ~13 distinct performance issues spanning duplicate network connections, polling without change detection, N+M API call patterns, missing React memoization, and unbounded data fetching. Together these cause compounding sluggishness as session count grows and uptime increases.
> **Estimated Effort**: Large (across multiple subsystems)

## Context

### Original Request
The user is experiencing UI slowness/sluggishness that worsens with more sessions open or longer uptime, sometimes hanging completely. A thorough performance audit was requested.

### Key Findings
The codebase has a well-structured architecture (contexts, hooks, API routes, server-side services), but performance was not a primary design constraint. The issues fall into five categories:

1. **Duplicate work** — Multiple components independently connect to the same endpoints or subscribe to the same events
2. **Polling without diffing** — State setters fire on every poll tick regardless of whether data changed, triggering unnecessary React re-render cascades
3. **Unbounded data loading** — APIs fetch ALL records then slice client-side, defeating pagination
4. **Missing memoization** — High-frequency list items lack `React.memo`, so parent re-renders propagate to every child
5. **Sequential I/O** — Health checks and API aggregation run sequentially where parallel execution is possible

---

## Issue Registry

---

### Issue 1: Duplicate SSE Connections to `/api/notifications/stream`

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Category** | Duplicate Work / Network |
| **Affected Files** | `src/contexts/sessions-context.tsx` (line ~87), `src/contexts/notifications-context.tsx` (line ~162) |
| **Estimated Effort** | Short |

#### Root Cause
Both `SessionsProvider` and `NotificationsProvider` independently create an `EventSource` to the same `/api/notifications/stream` endpoint. Every browser tab opens **2 SSE connections** instead of 1.

#### Evidence

**`src/contexts/sessions-context.tsx`** (~line 87):
```typescript
const eventSource = new EventSource('/api/notifications/stream');
eventSource.onmessage = (event) => {
  // Handles session_updated, session_created events to refresh sessions
};
```

**`src/contexts/notifications-context.tsx`** (~line 162):
```typescript
const eventSource = new EventSource('/api/notifications/stream');
eventSource.onmessage = (event) => {
  // Handles notification events, updates unread count
};
```

#### Impact
- 2x SSE connections per tab, 2x server-side memory for connection state
- Each SSE connection on the server side triggers event subscriptions in `notification-emitter.ts`
- With multiple tabs open, connection count grows linearly (2N connections for N tabs)

#### Proposed Fix
Create a **single shared SSE hook or context** (e.g., `SSEProvider`) that opens one `EventSource` and dispatches events to subscribers via an internal EventEmitter or callback registry. Both `SessionsProvider` and `NotificationsProvider` subscribe to this shared stream instead of opening their own.

#### Acceptance Criteria
- [ ] Only 1 `EventSource` connection exists per browser tab (verifiable via DevTools Network tab)
- [ ] Both sessions and notifications still receive their respective events
- [ ] No regressions in session list updates or notification delivery

---

### Issue 2: Sessions API N+M Network Calls

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Category** | API / Network |
| **Affected Files** | `src/app/api/sessions/route.ts` (lines ~192-207, ~296-327) |
| **Estimated Effort** | Medium |

#### Root Cause
The `GET /api/sessions` handler makes two rounds of network calls:
1. **Round 1 (lines ~192-207)**: `Promise.allSettled` across all instances to fetch session statuses — **N calls** (one per instance)
2. **Round 2 (lines ~296-327)**: For each session flagged as "live", calls `client.session.get()` — **M calls** (one per live session)

Total: **N + M network calls per poll** (every 5 seconds from `use-sessions.ts`).

#### Evidence

**Round 1** (~lines 192-207):
```typescript
const statusResults = await Promise.allSettled(
  instances.map(instance =>
    getClientForInstance(instance).then(client =>
      client.session.list() // one call per instance
    )
  )
);
```

**Round 2** (~lines 296-327):
```typescript
for (const session of liveSessions) {
  const client = await getClientForInstance(session.instance);
  const detail = await client.session.get(session.id); // one call per live session
}
```

#### Impact
- With 5 instances and 20 live sessions: **25 network calls every 5 seconds**
- Each call has latency + potential timeout, compounding response time
- The polling client (`use-sessions.ts`) fires the next poll even if the previous hasn't returned, risking request pile-up

#### Proposed Fix
1. **Batch Round 1**: Keep `Promise.allSettled` but cache results with a short TTL (e.g., 2-3 seconds) so rapid polls reuse cached data
2. **Eliminate Round 2**: The session list from Round 1 should already contain sufficient data; avoid per-session detail fetches unless the user navigates to a specific session
3. **Add ETag/If-None-Match**: Return a hash of the session list; clients skip re-rendering if unchanged

#### Acceptance Criteria
- [ ] `GET /api/sessions` makes at most N calls (one per instance), not N+M
- [ ] Response time for 5 instances + 20 sessions is under 500ms
- [ ] No loss of session data displayed in the sidebar

---

### Issue 3: Sessions Polling Without Change Detection

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | React / Rendering |
| **Affected Files** | `src/hooks/use-sessions.ts` (line ~31) |
| **Estimated Effort** | Quick |

#### Root Cause
`use-sessions.ts` polls `GET /api/sessions` every 5 seconds via `setInterval`. On every response, it calls `setSessions(data)` unconditionally — even if the data is identical to the current state. This triggers a full React re-render of the sessions tree on every tick.

#### Evidence

**`src/hooks/use-sessions.ts`** (~line 31):
```typescript
const data = await response.json();
setSessions(data); // Always sets, even if identical
```

#### Impact
- Every 5 seconds, the entire sidebar (all session items, workspace groups) re-renders
- Combined with missing `React.memo` on list items (Issue 7), this means every session card re-renders every 5s
- With 50+ sessions, this is hundreds of unnecessary component re-renders per tick

#### Proposed Fix
Compare incoming data with current state using a deep equality check or hash comparison before calling `setSessions`:
```typescript
const data = await response.json();
const hash = JSON.stringify(data);
if (hash !== prevHashRef.current) {
  prevHashRef.current = hash;
  setSessions(data);
}
```

#### Acceptance Criteria
- [ ] `setSessions` is only called when data actually changes
- [ ] React DevTools Profiler shows no re-renders on unchanged polls
- [ ] Session list still updates within 5s of actual changes

---

### Issue 4: Fleet Summary Polling Without Change Detection

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | React / Rendering |
| **Affected Files** | `src/hooks/use-fleet-summary.ts` (line ~31) |
| **Estimated Effort** | Quick |

#### Root Cause
Identical pattern to Issue 3. `use-fleet-summary.ts` polls every 10 seconds and always calls `setSummary(data)` regardless of whether data changed.

#### Evidence

**`src/hooks/use-fleet-summary.ts`** (~line 31):
```typescript
const data = await response.json();
setSummary(data); // Always sets
```

#### Impact
- Fleet overview page re-renders every 10s even when nothing changed
- Lower impact than Issue 3 (10s vs 5s interval, fewer child components) but still wasteful

#### Proposed Fix
Same hash-comparison guard as Issue 3.

#### Acceptance Criteria
- [ ] `setSummary` only called when data actually changes
- [ ] Fleet overview shows no unnecessary re-renders in React DevTools Profiler

---

### Issue 5: Fleet Summary Loads All Sessions Into Memory

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | API / Database |
| **Affected Files** | `src/app/api/fleet/summary/route.ts` (line ~18), `src/lib/server/db-repository.ts` |
| **Estimated Effort** | Short |

#### Root Cause
The fleet summary endpoint calls `listSessions()` which loads ALL session rows from SQLite into memory, just to count how many are active vs idle.

#### Evidence

**`src/app/api/fleet/summary/route.ts`** (~line 18):
```typescript
const sessions = await listSessions(); // loads ALL rows
const activeSessions = sessions.filter(s => s.status === 'active');
// Returns counts derived from full dataset
```

#### Impact
- With hundreds/thousands of historical sessions, this loads increasingly large arrays into memory every 10 seconds
- Memory pressure grows with uptime as session history accumulates
- SQLite can answer `SELECT COUNT(*) ... GROUP BY status` far more efficiently

#### Proposed Fix
Add a `getSessionCounts()` method to `db-repository.ts` that uses SQL aggregation:
```sql
SELECT status, COUNT(*) as count FROM sessions GROUP BY status
```

#### Acceptance Criteria
- [ ] Fleet summary endpoint does NOT load all session rows
- [ ] A SQL aggregation query is used instead
- [ ] Response data is identical to current behavior

---

### Issue 6: Per-Instance `RelativeTimestamp` Timers

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | React / Timers |
| **Affected Files** | `src/components/session/relative-timestamp.tsx` (lines ~16-18) |
| **Estimated Effort** | Short |

#### Root Cause
Each `RelativeTimestamp` component creates its own `setInterval` (every 30 seconds) to re-render the "2 minutes ago" text. With N visible timestamps, there are N independent timers.

#### Evidence

**`src/components/session/relative-timestamp.tsx`** (~lines 16-18):
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setNow(Date.now());
  }, 30_000);
  return () => clearInterval(interval);
}, []);
```

#### Impact
- With 50 session items visible in the sidebar, 50 independent `setInterval` timers run concurrently
- Each timer triggers an independent React re-render of its component
- Timers are slightly desynchronized, causing a "ripple" of re-renders across 30 seconds instead of one batch

#### Proposed Fix
Create a shared `useRelativeTime()` hook backed by a singleton timer. One `setInterval` updates a shared "tick" signal; all `RelativeTimestamp` components subscribe to it and re-render simultaneously in one batch.

Alternative: Use a React context that provides a `now` value updated every 30s. All timestamps read from context and re-render together.

#### Acceptance Criteria
- [ ] Only 1 timer exists regardless of how many `RelativeTimestamp` components are mounted
- [ ] All timestamps update simultaneously (verifiable in React DevTools)
- [ ] Timestamp display is unchanged

---

### Issue 7: Missing `React.memo` on Sidebar List Items

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | React / Rendering |
| **Affected Files** | `src/components/layout/sidebar-session-item.tsx`, `src/components/layout/sidebar-workspace-item.tsx` |
| **Estimated Effort** | Quick |

#### Root Cause
`SidebarSessionItem` and `SidebarWorkspaceItem` are plain function components without `React.memo`. When the sessions context updates (every 5s per Issue 3), ALL sidebar items re-render even if their specific props haven't changed.

#### Evidence
A codebase search for `React.memo` found usage in only:
- `src/components/session/activity-stream-v1.tsx` (MessageItem)
- `src/components/markdown-renderer.tsx`

Neither `sidebar-session-item.tsx` nor `sidebar-workspace-item.tsx` use `React.memo`.

#### Impact
- Combined with Issue 3 (5s polling always sets state), every session item re-renders every 5 seconds
- With 50 sessions: 50 component re-renders per tick x 12 ticks/minute = 600 unnecessary re-renders/minute
- Each item may have sub-components (timestamps, status badges, avatars) that also re-render

#### Proposed Fix
Wrap both components with `React.memo`:
```typescript
export const SidebarSessionItem = React.memo(function SidebarSessionItem(props: Props) {
  // existing implementation
});
```
Ensure props are stable (no inline objects/callbacks) to make memo effective.

#### Acceptance Criteria
- [ ] Both `SidebarSessionItem` and `SidebarWorkspaceItem` are wrapped in `React.memo`
- [ ] Props passed to these components are referentially stable
- [ ] React DevTools Profiler confirms items only re-render when their own props change

---

### Issue 8: Messages API Fetches ALL Then Slices

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | API / Memory |
| **Affected Files** | `src/app/api/sessions/[id]/messages/route.ts` (lines ~53, ~56) |
| **Estimated Effort** | Medium |

#### Root Cause
The messages endpoint calls the SDK's `client.session.messages()` which returns ALL messages for a session, then applies `sliceMessages()` to paginate. The full message history is loaded into memory on every request regardless of the requested page.

#### Evidence

**`src/app/api/sessions/[id]/messages/route.ts`** (~lines 53-56):
```typescript
const allMessages = await client.session.messages(sessionId); // ALL messages
const page = sliceMessages(allMessages, cursor, limit); // client-side pagination
```

#### Impact
- Long-running sessions can have thousands of messages
- Every paginated request loads the full history into Node.js memory
- Memory usage spikes proportionally to session length
- Contributes to the "hangs with longer uptime" symptom

#### Proposed Fix
1. **Short term**: Cache the full message list in memory with a TTL, so repeated pagination requests don't re-fetch
2. **Long term**: If the SDK supports cursor-based pagination, use it. If not, file an upstream feature request and implement server-side caching with LRU eviction
3. **Immediate**: At minimum, add a message count limit (e.g., last 500 messages) as a safety valve

#### Acceptance Criteria
- [ ] Messages endpoint does not re-fetch all messages on every paginated request
- [ ] Memory usage for a 1000-message session is bounded
- [ ] Pagination still works correctly from the UI

---

### Issue 9: Sequential Health Checks in Process Manager

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Backend / I/O |
| **Affected Files** | `src/lib/server/process-manager.ts` (lines ~671-712) |
| **Estimated Effort** | Quick |

#### Root Cause
The health check loop iterates instances sequentially using `for...of` with `await checkPortAlive()`. Each check has a 3-second timeout. With N instances, worst-case latency is **3N seconds**.

#### Evidence

**`src/lib/server/process-manager.ts`** (~lines 671-712):
```typescript
for (const instance of instances) {
  try {
    const alive = await checkPortAlive(instance.port, 3000); // 3s timeout each
    // update status
  } catch {
    // mark unhealthy
  }
}
```

#### Impact
- With 10 instances where several are unresponsive: up to 30 seconds for a single health check sweep
- Blocks the health check interval from running again until complete
- UI shows stale instance status during this window

#### Proposed Fix
Use `Promise.allSettled` to check all instances in parallel:
```typescript
const results = await Promise.allSettled(
  instances.map(instance => checkPortAlive(instance.port, 3000))
);
```
Worst-case latency drops from 3N to 3 seconds.

#### Acceptance Criteria
- [ ] Health checks for all instances run in parallel
- [ ] Total health check sweep completes in <= 3 seconds regardless of instance count
- [ ] Unhealthy instances are still correctly detected and marked

---

### Issue 10: Duplicate Event Subscriptions Per Instance

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | Backend / Network / Memory |
| **Affected Files** | `src/lib/server/session-status-watcher.ts` (line ~208), `src/lib/server/callback-monitor.ts` (line ~303), `src/app/api/sessions/[id]/events/route.ts` (line ~88) |
| **Estimated Effort** | Medium |

#### Root Cause
Three independent subsystems each subscribe to instance events:
1. **`session-status-watcher.ts`** (~line 208): `client.event.subscribe()` — watches for session status changes
2. **`callback-monitor.ts`** (~line 303): `client.event.subscribe()` — watches for callback events
3. **`events/route.ts`** (~line 88): `client.event.subscribe()` — per-session SSE proxy for the detail page

This means up to **3 event subscriptions per instance**, each maintaining its own connection.

#### Evidence

**`session-status-watcher.ts`** (~line 208):
```typescript
const subscription = await client.event.subscribe({
  // subscribes to all events for this instance
});
```

**`callback-monitor.ts`** (~line 303):
```typescript
const subscription = await client.event.subscribe({
  // subscribes to all events for this instance
});
```

**`events/route.ts`** (~line 88):
```typescript
const subscription = await client.event.subscribe({
  sessionId: id // per-session subscription
});
```

#### Impact
- 3x the expected number of event stream connections to each opencode instance
- Each subscription holds memory for buffers, callbacks, and connection state
- Redundant event processing — the same event may be processed 3 times

#### Proposed Fix
Create a **shared event subscription manager** that maintains one subscription per instance and multiplexes events to internal consumers. `session-status-watcher`, `callback-monitor`, and SSE proxy all register as listeners on the shared subscription rather than creating their own.

#### Acceptance Criteria
- [ ] Only 1 event subscription exists per opencode instance (plus optional per-session filtered proxies)
- [ ] All three consumers still receive their required events
- [ ] No increase in event delivery latency

---

### Issue 11: Session Detail Page Fetches All Messages on Reconnect

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | Network / Memory |
| **Affected Files** | `src/hooks/use-session-events.ts` (lines ~87-104) |
| **Estimated Effort** | Short |

#### Root Cause
When the SSE connection for a session detail page reconnects (which can happen due to network blips, tab backgrounding, or server restarts), `loadAllMessages()` fetches ALL messages from the API. The API itself (Issue 8) loads all messages from the SDK. This means a full re-fetch of potentially thousands of messages on every reconnect.

#### Evidence

**`src/hooks/use-session-events.ts`** (~lines 87-104):
```typescript
const loadAllMessages = async () => {
  const response = await fetch(`/api/sessions/${id}/messages`);
  const data = await response.json();
  setMessages(data.messages); // replaces entire message list
};

// Called on SSE reconnect
eventSource.onopen = () => {
  loadAllMessages(); // fetches everything again
};
```

#### Impact
- SSE connections can reconnect frequently (network instability, mobile browsers, tab switching)
- Each reconnect triggers a full message re-fetch, which loads ALL messages server-side
- Memory spikes on both client and server during reconnection storms
- User sees a loading flash as messages are replaced

#### Proposed Fix
1. On reconnect, only fetch messages **after** the last known message ID/timestamp
2. Append new messages to existing state rather than replacing
3. Add a `since` parameter to the messages API

#### Acceptance Criteria
- [ ] SSE reconnect only fetches messages newer than the last known message
- [ ] No full message reload on reconnect
- [ ] Message continuity is maintained (no gaps, no duplicates)

---

### Issue 12: EventEmitter Listener Leak Potential

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Backend / Memory |
| **Affected Files** | `src/lib/server/notification-emitter.ts` (line ~33) |
| **Estimated Effort** | Short |

#### Root Cause
The `NotificationEmitter` singleton sets `maxListeners` to 100. Each SSE connection from the browser adds 2 listeners (notification + activity_status). With browser tab refreshes, reconnections, and multiple users, the listener count can approach or exceed this limit.

#### Evidence

**`src/lib/server/notification-emitter.ts`** (~line 33):
```typescript
this.setMaxListeners(100);
```

Each SSE connection in `src/app/api/notifications/stream/route.ts` adds listeners:
```typescript
emitter.on('notification', handler);
emitter.on('activity_status', handler);
```

#### Impact
- With 50+ concurrent SSE connections: 100+ listeners, hitting the maxListeners cap
- Node.js emits a warning (or silently drops listeners depending on version)
- If listeners aren't properly removed on disconnect, they accumulate as a memory leak
- The `onclose` cleanup may not fire reliably in all disconnection scenarios (e.g., abrupt connection drops)

#### Proposed Fix
1. Increase `maxListeners` to a reasonable cap (e.g., 500) or use `Infinity` with monitoring
2. Add listener count monitoring/logging that warns at 80% capacity
3. Audit cleanup paths: ensure `req.signal.addEventListener('abort', cleanup)` reliably fires
4. Add a periodic sweep that removes orphaned listeners

#### Acceptance Criteria
- [ ] Listener count is monitored and logged
- [ ] Cleanup reliably removes listeners on all disconnect types
- [ ] No listener leak after 100 SSE connect/disconnect cycles (verifiable via test)

---

### Issue 13: Callback Monitor 10s Polling Loop

| Field | Value |
|-------|-------|
| **Severity** | Low-Medium |
| **Category** | Backend / Network |
| **Affected Files** | `src/lib/server/callback-monitor.ts` |
| **Estimated Effort** | Quick |

#### Root Cause
`callback-monitor.ts` runs a 10-second polling loop for each instance in addition to its event subscription (Issue 10). This polling is a fallback for missed events, but it runs unconditionally even when the event subscription is healthy.

#### Impact
- Additional network calls every 10 seconds per instance
- Redundant with the event subscription when subscription is working
- Minor but compounds with other polling (Issues 3, 4)

#### Proposed Fix
Only start the polling fallback if the event subscription disconnects. Stop polling when the subscription reconnects.

#### Acceptance Criteria
- [ ] Polling fallback only activates when event subscription is unhealthy
- [ ] Polling stops within one cycle of subscription recovery
- [ ] No missed callbacks during subscription gaps

---

## Dependency Graph

```
Issue 1 (Duplicate SSE) ──────────────────────────────┐
                                                       ├── Shared SSE Infrastructure
Issue 10 (Duplicate Event Subs) ──────────────────────┘

Issue 3 (Sessions polling no diff) ───┐
Issue 4 (Fleet polling no diff) ──────┤
                                      ├── Polling Change Detection Pattern
Issue 13 (Callback polling) ─────────┘

Issue 7 (Missing React.memo) ────────┐
Issue 6 (Per-instance timers) ───────┤
                                     ├── React Rendering Optimization
Issue 3 (triggers re-renders) ──────┘

Issue 2 (N+M API calls) ────────────┐
Issue 5 (Fleet summary loads all) ──┤
Issue 8 (Messages loads all) ───────┤── API / Data Loading Optimization
Issue 11 (Reconnect loads all) ────┘

Issue 9 (Sequential health) ────────── Standalone (no dependencies)
Issue 12 (Listener leak) ──────────── Standalone (no dependencies)
```

## Recommended Execution Order

### Phase 1: Quick Wins (Days 1-2)
These are low-risk, high-impact changes that can be done independently:

- [ ] **Issue 3**: Add change detection to sessions polling — Quick, eliminates most sidebar re-renders
- [ ] **Issue 4**: Add change detection to fleet summary polling — Quick, same pattern as Issue 3
- [ ] **Issue 7**: Add `React.memo` to sidebar items — Quick, immediately reduces re-render count
- [ ] **Issue 9**: Parallelize health checks — Quick, standalone, immediate latency improvement

### Phase 2: Connection Consolidation (Days 3-5)
Reduce duplicate connections and subscriptions:

- [ ] **Issue 1**: Unify SSE connections into a shared provider — Short, prerequisite for clean architecture
- [ ] **Issue 10**: Create shared event subscription manager — Medium, biggest backend architectural change
- [ ] **Issue 13**: Make callback polling conditional — Quick, depends on Issue 10's subscription health signal

### Phase 3: Data Loading Optimization (Days 5-8)
Fix unbounded data patterns:

- [ ] **Issue 2**: Eliminate Round 2 of sessions API calls — Medium, requires understanding which session fields are needed
- [ ] **Issue 5**: Use SQL aggregation for fleet summary — Short, straightforward DB change
- [ ] **Issue 8**: Add message caching/pagination to messages API — Medium, depends on SDK capabilities
- [ ] **Issue 11**: Incremental message loading on reconnect — Short, depends on Issue 8's `since` parameter

### Phase 4: Hardening (Days 8-10)
Prevent leaks and long-term degradation:

- [ ] **Issue 6**: Shared timer for `RelativeTimestamp` — Short, nice optimization
- [ ] **Issue 12**: EventEmitter listener monitoring and cleanup — Short, prevents long-uptime degradation

## Verification

- [ ] All existing tests pass after each phase
- [ ] No regressions in session list updates, notifications, or event delivery
- [ ] React DevTools Profiler shows <= 5 re-renders per poll tick on the sessions page (currently unbounded)
- [ ] Browser DevTools Network tab shows 1 SSE connection per tab (currently 2)
- [ ] `GET /api/sessions` response time < 500ms with 5 instances and 20 sessions
- [ ] Memory usage remains stable over 1 hour of continuous operation (no upward trend)
- [ ] Health check sweep completes in < 5 seconds regardless of instance count
- [ ] Project builds successfully with no new warnings
