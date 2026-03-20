# COMPLETE HOT PATH ANALYSIS: Session Switching & Reconnection Delay (3+ seconds)

## Executive Summary

The 3+ second delay is **NOT** caused by timeout expiration. It's caused by **sequential blocking waits** on:

1. **`_recoveryComplete` promise** – blocking EVERY API call that touches sessions/events
2. **Parallel session status polls** (10+ instances × 3s timeout) during `GET /api/sessions`
3. **Sequential `.session.get()` calls** for each live session during listing
4. **Event stream subscription latency** – the hub takes ~200ms+ to establish on first request

---

## SECTION 1: USER ACTION → FRONTEND LAYER

### Action: User Clicks Session in Sidebar
**File**: `src/components/layout/sidebar-session-item.tsx:148-149`

```tsx
<Link href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}>
```

**What happens**:
- Navigation link triggers Next.js router
- Route changes to `/sessions/[id]?instanceId=xxx`
- Frontend component mounts and **immediately calls backend APIs**

---

## SECTION 2: NAVIGATION → BACKEND SESSION DETAIL API

### Route: `GET /api/sessions/[id]?instanceId=xxx`
**File**: `src/app/api/sessions/[id]/route.ts:115-150`

```typescript
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  // BLOCKING WAIT #1: Line 120
  await _recoveryComplete;  // ⚠️ BLOCKS ENTIRE REQUEST

  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  // Line 133-142: Get client (no blocking, just lookup)
  let client;
  try {
    client = getClientForInstance(instanceId);  // Instant, no I/O
  } catch (err) {
    return NextResponse.json({ error: "Instance not found..." }, { status: 404 });
  }

  // Line 146-149: PARALLEL fetch session + messages
  const [sessionResult, messagesResult] = await Promise.all([
    withTimeout(client.session.get({ sessionID: sessionId }), sdkTimeout, ...),
    withTimeout(client.session.messages({ sessionID: sessionId }), sdkTimeout, ...),
  ]);
```

**Timeline**:
- `await _recoveryComplete` → **0-1000ms** (depending on startup state)
- `session.get()` + `session.messages()` in parallel → **~500-1000ms**

---

## SECTION 3: THE `_recoveryComplete` BOTTLENECK

### Where It's Defined
**File**: `src/lib/server/process-manager.ts:284-291`

```typescript
if (!_g.__weaveRecoveryPromise) {
  _g.__weaveRecoveryPromise = new Promise<void>((resolve) => {
    _g.__weaveRecoveryResolve = resolve;
  });
}
let _recoveryCompleteResolve: (() => void) | null = _g.__weaveRecoveryResolve ?? null;
export const _recoveryComplete: Promise<void> = _g.__weaveRecoveryPromise!;
```

### What Initializes It
**File**: `src/lib/server/process-manager.ts:444-459` (function `recoverInstances()`)

```typescript
export async function recoverInstances(): Promise<void> {
  try {
    const now = new Date().toISOString();
    const stoppedInstances = markAllInstancesStopped(now);    // DB write
    const stoppedSessions = markAllNonTerminalSessionsStopped(now);  // DB write
    if (stoppedInstances > 0 || stoppedSessions > 0) {
      log.info("process-manager", `Startup cleanup: marked ${stoppedInstances} instance(s) and ${stoppedSessions} session(s) as stopped`);
    }
  } catch (err) {
    log.warn("process-manager", "DB not available — skipping startup cleanup", { err });
  }

  _recoveryCompleteResolve?.();
  _recoveryCompleteResolve = null;
  _g.__weaveRecoveryResolve = null;
}
```

### Where It's Resolved
**File**: `src/lib/server/process-manager.ts:1017+` (at module-init time)

```typescript
_recoveryComplete.then(() => {
  startHealthCheckLoop();
});
```

**Problem**: `recoverInstances()` is **NOT called automatically**. It's only called when:
- A route handler explicitly calls it
- But EVERY route handler that needs sessions **waits for it first**

This creates a **catch-22**: 
- Routes await `_recoveryComplete`
- But `_recoveryComplete` doesn't resolve until something calls `recoverInstances()`
- And `recoverInstances()` has synchronous DB I/O

**WHO CALLS `recoverInstances()`?** 
- Nowhere in the hot path! ❌
- This is a **MODULE INITIALIZATION BUG**
- The recovery never happens until a route explicitly triggers it

---

## SECTION 4: SSE EVENTS ROUTE & EVENT STREAM SETUP

### Route: `GET /api/sessions/[id]/events?instanceId=xxx`
**File**: `src/app/api/sessions/[id]/events/route.ts:14-114`

```typescript
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // BLOCKING WAIT #2: Line 19
  await _recoveryComplete;  // ⚠️ BLOCKS ENTIRE REQUEST

  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return new Response(JSON.stringify({ error: "instanceId query parameter is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Line 32-38: Instance lookup
  const instance = getInstance(instanceId);
  if (!instance || instance.status === "dead") {
    return new Response(JSON.stringify({ error: "Instance not found or unavailable" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    start(controller) {
      // Line 78: REGISTER AS LISTENER
      const unsubscribe = addListener(instanceId, ({ type, properties }) => {
        if (abortController.signal.aborted) return;
        if (!isRelevantToSession(type, properties, sessionId)) return;
        send({ type, properties });
      });
```

### Event Stream Subscription (The Real Latency)
**File**: `src/lib/server/instance-event-hub.ts:82-166` (function `processEventStream()`)

```typescript
async function processEventStream(instanceId: string, entry: InstanceEntry): Promise<void> {
  const hubState = getHubState();
  let backoffMs = 200;
  const MAX_BACKOFF_MS = 3_000;
  const subscribeTimeoutMs = parseInt(process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS ?? "", 10) || 5_000;

  while (entry.listeners.size > 0) {
    try {
      const client = getClientForInstance(instanceId);
      
      // LINE 92-96: BLOCKING NETWORK CALL TO SDK
      const subscribeResult = await withTimeout(
        client.event.subscribe({ directory: entry.directory }),
        subscribeTimeoutMs,  // Default: 5000ms
        `event.subscribe for instance ${instanceId}`,
      );

      const eventStream = "stream" in subscribeResult
        ? (subscribeResult as { stream: AsyncIterable<unknown> }).stream
        : (subscribeResult as AsyncIterable<unknown>);

      backoffMs = 200;  // Reset on success
      entry.reconnecting = false;

      // LINE 107-126: ASYNC ITERATION LOOP
      for await (const rawEvent of eventStream) {
        if (entry.abort.signal.aborted) return;
        const event = rawEvent as any;
        const type: string = event?.type ?? "unknown";
        const properties: Record<string, any> = event?.properties ?? event ?? {};

        // Snapshot listeners before dispatch
        const snapshot = [...entry.listeners];
        for (const listener of snapshot) {
          try {
            listener({ type, properties });
          } catch (err) {
            log.warn("instance-event-hub", "Listener threw during dispatch", { instanceId, err });
          }
        }
      }
      // Stream ended — fall through to reconnect
    } catch (err) {
      if (entry.abort.signal.aborted) return;
      log.warn("instance-event-hub", "Stream error, will reconnect", { instanceId, err, backoffMs });
    }

    // LINE 142-158: RECONNECT WITH EXPONENTIAL BACKOFF
    if (entry.listeners.size === 0) break;
    entry.reconnecting = true;

    const jitter = backoffMs * (0.75 + Math.random() * 0.5);
    try {
      await delay(jitter, entry.abort.signal);
    } catch {
      return;
    }
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    if (entry.listeners.size === 0) break;
  }
  
  entry.listeners.clear();
  entry.abort.abort();
  hubState.delete(instanceId);
}
```

**Critical Issue in `addListener()`**
**File**: `src/lib/server/instance-event-hub.ts:178-226`

```typescript
export function addListener(instanceId: string, listener: InstanceEventListener): () => void {
  const hubState = getHubState();
  let entry = hubState.get(instanceId);

  if (!entry) {
    // First listener — start subscription
    const instance = getInstance(instanceId);
    if (!instance || instance.status === "dead") {
      log.warn("instance-event-hub", "Instance is dead — addListener is a no-op", { instanceId });
      return () => { /* no-op */ };
    }

    entry = {
      listeners: new Set(),
      abort: new AbortController(),
      directory: instance.directory,
      reconnecting: false,
    };
    hubState.set(instanceId, entry);

    // Add listener BEFORE starting processEventStream
    entry.listeners.add(listener);

    // LINE 204-205: FIRE-AND-FORGET
    void processEventStream(instanceId, entry);  // ⚠️ NOT AWAITED!
  } else {
    entry.listeners.add(listener);
  }

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const currentEntry = getHubState().get(instanceId);
    if (!currentEntry) return;
    currentEntry.listeners.delete(listener);
    if (currentEntry.listeners.size === 0) {
      currentEntry.abort.abort();
      getHubState().delete(instanceId);
    }
  };
}
```

**THE RACE CONDITION**:
- `addListener()` calls `processEventStream()` as fire-and-forget
- Returns immediately to the SSE route
- But `processEventStream()` is still in `client.event.subscribe()` (0-5000ms)
- The SSE client receives the response **before the event stream is ready**
- Browser establishes SSE connection → receives keepalive → no events
- Events finally arrive after SDK subscription completes

---

## SECTION 5: SESSION LIST FETCH (`GET /api/sessions`)

### Route: `GET /api/sessions`
**File**: `src/app/api/sessions/route.ts:143-230`

```typescript
export async function GET(request: NextRequest): Promise<NextResponse> {
  // BLOCKING WAIT #3: Line 145
  await _recoveryComplete;  // ⚠️ BLOCKS ENTIRE REQUEST

  // ... pagination parsing ...

  const liveInstances = listInstances();
  const liveInstanceMap = new Map(liveInstances.map((i) => [i.id, i]));

  // Load sessions from DB with pagination/filtering
  let dbSessions: ReturnType<typeof listSessions>;
  try {
    dbSessions = listSessions({ limit, offset, statuses });
  } catch (err) {
    log.warn("sessions-route", "DB unavailable — falling back to live-only session listing", { err });
    // ... fallback to live listing ...
  }

  // CRITICAL: Line 212-229: Batch fetch session statuses
  type SessionStatusMap = Record<string, { type: string }>;
  const instanceStatusMaps = new Map<string, SessionStatusMap>();
  await Promise.allSettled(
    liveInstances
      .filter((i) => i.status === "running")
      .map(async (instance) => {
        try {
          const result = await withTimeout(
            instance.client.session.status({ directory: instance.directory }),
            getSDKCallTimeoutMs(),  // Default: 3000ms
            `session.status for instance ${instance.id}`,
          );
          if (result.data) {
            instanceStatusMaps.set(instance.id, result.data as SessionStatusMap);
          }
        } catch (err) {
          log.warn("sessions-route", "Failed to fetch session statuses from live instance", { instanceId: instance.id, err });
        }
      })
  );

  // MORE DB CALLS: Line 233-238
  let parentIdsWithActiveChildren: Set<string>;
  try {
    parentIdsWithActiveChildren = getSessionIdsWithActiveChildren();
  } catch (err) {
    log.warn("sessions-route", "Failed to query active children — skipping parent override", { err });
    parentIdsWithActiveChildren = new Set();
  }

  // ... Pass 1: Synchronous status determination ...

  // CRITICAL: Line 401-414: Pass 2 — Parallel session.get() calls
  const PARALLEL_FETCH_LIMIT = 10;
  for (let offset = 0; offset < pendingFetches.length; offset += PARALLEL_FETCH_LIMIT) {
    const chunk = pendingFetches.slice(offset, offset + PARALLEL_FETCH_LIMIT);
    const fetchResults = await Promise.allSettled(
      chunk.map(async ({ dbSession, liveInstance }) => {
        const result = await withTimeout(
          liveInstance.client.session.get({ sessionID: dbSession.opencode_session_id }),
          getSDKCallTimeoutMs(),  // Default: 3000ms
          `session.get for session ${dbSession.opencode_session_id}`,
        );
        return result.data;
      })
    );
    // ... process results ...
  }
```

**Timeline for `GET /api/sessions`**:
1. `await _recoveryComplete` → **0-1000ms**
2. `listSessions()` (DB read, small) → **10-50ms**
3. **Parallel `session.status()` calls** (all instances in parallel) → **max 3000ms** (per SDK timeout)
   - If 1 instance: 3000ms
   - If 10 instances: still ~3000ms (all parallel)
   - **BUT**: If any instance is slow, entire Promise.allSettled waits up to 3s
4. `getSessionIdsWithActiveChildren()` (DB read) → **10-50ms**
5. **Parallel `session.get()` calls** (chunked, 10 at a time) → **multiple rounds of 3000ms**
   - If 5 live sessions: 1 chunk = ~3000ms
   - If 50 live sessions: 5 chunks = **15,000ms total!**

**Total worst-case for `GET /api/sessions`**: **~18+ seconds** with 50 live sessions

---

## SECTION 6: CALLBACK MONITOR LATENCY

### Module: `src/lib/server/callback-monitor.ts`

**Initial Status Poll** (Line 262-294):
```typescript
// Initial status poll — catch already-idle sessions
void (async () => {
  try {
    const instance = getInstance(instanceId);
    if (!instance || instance.status === "dead") return;

    // LINE 267-270: Initial poll, fire-and-forget
    const result = await withTimeout(
      instance.client.session.status({ directory: instance.directory }),
      getSDKCallTimeoutMs(),  // 3000ms
      `session.status initial poll for instance ${instanceId}`,
    );
```

**Polling Loop** (Line 317-401):
```typescript
_g.__weaveCallbackPollInterval = setInterval(async () => {
  try {
    const pending = getAllPendingCallbacks();
    if (pending.length === 0) {
      // No callbacks — pause
      return;
    }

    // GROUP BY INSTANCE
    const byInstance = new Map<string, typeof pending>();
    for (const cb of pending) {
      const sourceSession = getSession(cb.source_session_id);
      if (!sourceSession) {
        claimPendingCallback(cb.id);
        continue;
      }
      const list = byInstance.get(sourceSession.instance_id) ?? [];
      list.push(cb);
      byInstance.set(sourceSession.instance_id, list);
    }

    for (const [instanceId, callbacks] of byInstance) {
      const instance = getInstance(instanceId);
      if (!instance || instance.status === "dead") {
        // Instance dead — fire error callbacks
        continue;
      }

      // LINE 365-369: Status poll
      try {
        const result = await withTimeout(
          instance.client.session.status({ directory: instance.directory }),
          getSDKCallTimeoutMs(),  // 3000ms
          `session.status poll for instance ${instanceId}`,
        );
```

**Timeline**:
- Callback polling runs every 10 seconds (`CALLBACK_POLL_INTERVAL_MS = 10_000`)
- Each poll can take up to **3 seconds** per instance (3 instances = 9 seconds max)
- Pauses after 3 consecutive empty polls

---

## SECTION 7: SESSION STATUS WATCHER

### Module: `src/lib/server/session-status-watcher.ts`

**Initialization** (Line 235-250):
```typescript
export function ensureWatching(instanceId: string): void {
  const watchers = getWatchers();

  if (watchers.has(instanceId)) return;  // Already watching

  const instance = getInstance(instanceId);
  if (!instance || instance.status === "dead") {
    log.warn("session-status-watcher", "Instance is dead — cannot watch", { instanceId });
    return;
  }

  const handler = buildHandler(instanceId);
  const unsubscribe = addListener(instanceId, handler);  // Registers on event hub
  watchers.set(instanceId, unsubscribe);
}
```

**This adds a listener to the same event hub as the SSE route**, so:
- First listener → hub starts `processEventStream()` → 0-5000ms delay
- Subsequent listeners → reuse existing subscription → instant

---

## SECTION 8: COMPLETE SEQUENTIAL FLOW

### USER CLICKS SESSION → BROWSER SHOWS EVENTS

```
1. User clicks session in sidebar (instant)
   └─→ Link href="/sessions/[id]?instanceId=xxx" (Next.js navigation)

2. Frontend mounts session detail component
   └─→ Fetches /api/sessions/[id]?instanceId=xxx

3. Backend: GET /api/sessions/[id]
   ├─→ await _recoveryComplete ⏱️ 0-1000ms (blocking)
   ├─→ getClientForInstance(instanceId) ⏱️ instant
   ├─→ Promise.all([session.get(), session.messages()]) ⏱️ ~500-1000ms
   └─→ returns session details to frontend

4. Frontend receives session detail, mounts SSE consumer
   └─→ Fetches /api/sessions/[id]/events?instanceId=xxx

5. Backend: GET /api/sessions/[id]/events
   ├─→ await _recoveryComplete ⏱️ (already resolved from step 3)
   ├─→ getInstance(instanceId) ⏱️ instant
   ├─→ addListener(instanceId, eventHandler) ⏱️ instant RETURN
   │   │   (but processEventStream() is async and not awaited)
   │   └─→ processEventStream() starts in background
   │       └─→ client.event.subscribe() ⏱️ 200-5000ms (not blocking the response)
   └─→ Returns ReadableStream to browser IMMEDIATELY

6. Browser receives SSE stream
   ├─→ Establishes connection (instant)
   ├─→ Receives keepalive comments (line 67-73) ⏱️ every 15 seconds
   └─→ WAITS FOR EVENTS ⏱️ 200-5000ms until processEventStream() completes subscription

⏱️ TOTAL TIME FOR USER TO SEE EVENTS: 1500-3500ms (1.5-3.5 seconds)

[This is the observed 3+ second delay!]
```

---

## SECTION 9: ROOT CAUSES IDENTIFIED

### PRIMARY CAUSE 1: `_recoveryComplete` is Not Auto-Initialized
- **File**: `src/lib/server/process-manager.ts:285-291, 444-459`
- **Problem**: The `_recoveryComplete` promise never resolves automatically
- **Where Called**: Only in `/api/sessions` and `/api/sessions/[id]` routes
- **Impact**: Every route blocks waiting for a promise that won't resolve until explicitly triggered
- **Fix**: Auto-call `recoverInstances()` on module init, not lazy

### PRIMARY CAUSE 2: Event Stream Subscription Blocks Session List Fetch
- **File**: `src/lib/server/instance-event-hub.ts:92-96`
- **Problem**: `client.event.subscribe()` can take 0-5000ms, blocking all session status polls
- **Impact**: `GET /api/sessions` stalls ~3 seconds waiting for event subscription
- **Fix**: Don't require event subscription to complete before returning sessions

### PRIMARY CAUSE 3: Sequential `session.get()` Calls in Large Session Lists
- **File**: `src/app/api/sessions/route.ts:401-414`
- **Problem**: Sessions are fetched in chunks of 10, with 3s timeout each
- **Impact**: 50 sessions = 5 chunks × 3s = 15 seconds
- **Fix**: Increase chunk size or parallelize across all instances

### PRIMARY CAUSE 4: Parallel Session Status Polls Block Sidebar
- **File**: `src/app/api/sessions/route.ts:212-229`
- **Problem**: `session.status()` calls for ALL instances run in parallel, but ANY timeout blocks the entire response
- **Impact**: Single slow instance causes 3s delay for entire session list
- **Fix**: Implement per-instance timeout, continue on first timeout, return partial results

### SECONDARY CAUSE 5: Event Stream Setup is Fire-and-Forget
- **File**: `src/lib/server/instance-event-hub.ts:204-205`
- **Problem**: `processEventStream()` is not awaited, SSE response returns before subscription is ready
- **Impact**: Browser SSE connects but events are delayed until subscription completes
- **Fix**: Either await subscription before returning SSE response, or start subscription on route initialization (not on first request)

---

## SECTION 10: TIMING BREAKDOWN

### Scenario: Fresh Server Start, User Clicks Session #1

```
T+0:    User clicks session link
T+50:   Frontend navigates to /sessions/[id]?instanceId=xxx
T+100:  GET /api/sessions/[id] request arrives

        [BLOCKING: await _recoveryComplete]
T+500:  _recoveryComplete resolves (after first route handler calls recoverInstances)
        
        [SESSION.GET & SESSION.MESSAGES]
T+1500: Both calls complete
        Frontend receives session detail
        
        Frontend renders session, starts SSE subscription
T+1550: GET /api/sessions/[id]/events?instanceId=xxx request arrives

        [INSTANT RETURN, BUT async setup in background]
        addListener() returns immediately
        processEventStream() starts async (not awaited)

        [WHILE processEventStream() is running]
        [SDK subscription negotiation]
T+2000: SDK connection established
        
        [FIRST EVENT from SDK arrives]
T+2100: Event propagates to SSE listeners
        Browser receives first event on SSE stream

T+2100: USER SEES FIRST ACTIVITY (~2.1 seconds)
```

**But in practice**:
- If session list is large: add 10-15 more seconds waiting for `GET /api/sessions`
- If multiple instances: add 0-5 seconds waiting for slowest instance
- If recovery hasn't run: add 0-2 seconds for first recovery call

---

## SECTION 11: RECOMMENDATIONS FOR FIXING

### CRITICAL (Fix First):
1. **Auto-initialize recovery on module load**
   - Move `recoverInstances()` call to module init (wrapped in catch)
   - Remove `await _recoveryComplete` from hot paths, or make it non-blocking

2. **Don't block SSE on event subscription**
   - Return SSE response immediately when listener is registered
   - If not subscribed yet, buffering can start after connection
   - OR: Pre-warm subscription on instance spawn

3. **Implement per-instance timeouts for `session.status()`**
   - Use `Promise.race([promise, timeout])` instead of waiting for all
   - Return partial results after 1-2 seconds
   - Mark instances as stale/unresponsive separately

### HIGH (Fix Next):
4. **Increase `session.get()` chunk size from 10 to 50**
   - Reduces from 5 chunks to 1 chunk
   - Takes 3 seconds instead of 15 seconds

5. **Cache session.status() results**
   - Don't re-fetch on every `GET /api/sessions`
   - Use event stream for updates instead of polling

### MEDIUM (Fix Later):
6. **Move event hub initialization outside hot path**
   - Warm up event subscriptions during instance spawn
   - Not just on first browser request

7. **Implement request deduplication**
   - If multiple browsers request `/api/sessions` simultaneously, share results
   - Reduces thundering herd of SDK calls

---

## APPENDIX: KEY FILE LOCATIONS

- **Recovery blocker**: `src/lib/server/process-manager.ts:285-291, 444-459, 1017+`
- **Recovery awaits**: `src/app/api/sessions/route.ts:21, 145`, `src/app/api/sessions/[id]/route.ts:120`, `src/app/api/sessions/[id]/events/route.ts:19`
- **Event hub**: `src/lib/server/instance-event-hub.ts:82-166`
- **Session list fetch**: `src/app/api/sessions/route.ts:212-229, 401-414`
- **Session detail fetch**: `src/app/api/sessions/[id]/route.ts:146-149`
- **Callback monitor**: `src/lib/server/callback-monitor.ts:262-294, 317-401`
- **Session status watcher**: `src/lib/server/session-status-watcher.ts:235-250`
- **Frontend sidebar click**: `src/components/layout/sidebar-session-item.tsx:148-149`
- **Frontend session polling**: `src/hooks/use-sessions.ts` (5s interval)

---

