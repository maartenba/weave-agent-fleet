# Performance Plan 6: Hardening & Long-Term Stability

## TL;DR
> **Summary**: Cap client-side message arrays, add incremental reconnect loading, make callback-monitor polling conditional, add EventEmitter listener monitoring, and outline future architectural improvements (watcher trust, session cache, SSE-triggered refetch).
> **Estimated Effort**: Large (3–5 days for Tasks 1–4; Tasks 5–7 are future/deferred)

## Context
### Original Request
After the core performance fixes (Plans 1–3) and architectural improvements (Plans 4–5), several hardening tasks remain to address long-running stability, memory management, and redundant server-side work.

### Key Findings
- **`use-session-events.ts`**: Messages array grows unboundedly. In a long session with thousands of messages, this causes increasing memory pressure and slower React diffing. Line 58: `useState<AccumulatedMessage[]>([])` — no cap.
- **`use-session-events.ts` lines 87–105**: `loadAllMessages()` fetches ALL messages on SSE reconnect. For a session with 5,000 messages, this is a large payload that could cause a visible pause. The hook already has pagination (`useMessagePagination` at line 64) for initial load, but reconnect bypasses it.
- **`callback-monitor.ts` line 390**: 10-second polling loop runs unconditionally via `setInterval`, even when no callbacks are pending. With the event subscription layer (lines 82–221) catching most transitions in real-time, the polling loop is a safety net that should only run when there's something to check.
- **`notification-emitter.ts` line 33**: `setMaxListeners(100)` — adequate for typical usage, but no monitoring or periodic cleanup of orphaned listeners. If SSE connections are dropped without proper cleanup, listeners could accumulate.
- **`sessions/route.ts` Phase 1 (lines 192–207)**: The `session.status()` polling could be eliminated once the `session-status-watcher` is proven reliable (it maintains real-time status via event subscriptions).
- **Session cache**: After parallelizing `session.get()` (Plan 3), a TTL-based cache could further reduce SDK calls.
- **SSE-triggered refetch**: The ultimate goal — replace polling entirely with SSE push events.

## Prerequisites
- **Plans 1–3 should be completed first** — these are hardening tasks that address long-tail issues.
- **Plan 4 is prerequisite for Task 7** (SSE-triggered refetch requires the unified SSE hook).

## Expected Impact
- Tasks 1–4: Improved long-running stability, reduced memory usage, reduced unnecessary server work
- Tasks 5–7: Architectural improvements that could eliminate polling entirely (future work)

## Objectives
### Core Objective
Harden the application for long-running sessions and lay groundwork for future polling elimination.

### Deliverables
- [ ] Message array capping in `useSessionEvents` (Task 1)
- [ ] Incremental message loading on SSE reconnect (Task 2)
- [ ] Conditional callback-monitor polling (Task 3)
- [ ] EventEmitter listener monitoring (Task 4)
- [ ] (Future) Trust watcher, remove Phase 1 status polling (Task 5)
- [ ] (Future) Server-side session cache with TTL (Task 6)
- [ ] (Future) SSE-triggered refetch to replace polling (Task 7)

### Definition of Done
- [ ] Tasks 1–4: `npm run build` + `npx vitest run` pass
- [ ] Tasks 5–7: Documented as future work with clear preconditions

### Guardrails (Must NOT)
- Must NOT lose messages — capping should evict oldest messages but preserve recent ones
- Must NOT break the callback-monitor's reliability — polling must still run when callbacks are pending
- Must NOT remove polling entirely until SSE-push is proven reliable (Tasks 5–7 are gated)

---

## TODOs

- [ ] 1. **Cap `useSessionEvents` message array**
  **What**: Limit the in-memory `messages` array to a maximum of 500 messages, evicting the oldest when the cap is exceeded. Users can load older messages on demand via the existing `loadOlderMessages` API.
  **Files**: `src/hooks/use-session-events.ts`
  **Details**:
  Add a constant:
  ```ts
  const MAX_MESSAGES = 500;
  ```

  Modify the `handleEvent` function's `setMessages` calls to enforce the cap. There are three places where messages grow:
  1. `mergeMessageUpdate` (line 293) — adds or updates a message
  2. `applyPartUpdate` (line 300) — updates a part within a message
  3. `applyTextDelta` (line 318–319) — appends text to a part

  For case 1 (the only one that adds new messages), add capping after the merge:
  ```ts
  // In handleEvent, "message.updated" branch (line 290-294)
  setMessages((prev) => {
    const next = mergeMessageUpdate(ensureMessage(prev, info), info);
    if (next.length > MAX_MESSAGES) {
      return next.slice(next.length - MAX_MESSAGES);
    }
    return next;
  });
  ```

  Cases 2 and 3 update existing messages in-place, so they don't increase array length.

  Also cap after `loadAllMessages` (line 99) and `loadInitialMessages` (line 116):
  ```ts
  // In loadAllMessages
  const accumulated = data.messages.map(convertSDKMessageToAccumulated);
  setMessages(accumulated.length > MAX_MESSAGES
    ? accumulated.slice(accumulated.length - MAX_MESSAGES)
    : accumulated
  );
  ```

  **Acceptance**: Open a session with >500 messages. The `messages` array never exceeds 500 entries. The UI shows the most recent 500 messages with a "Load older" button for earlier ones.

- [ ] 2. **Add incremental message loading on SSE reconnect**
  **What**: Instead of fetching ALL messages on SSE reconnect (`loadAllMessages`, line 87), fetch only messages since the last known message. This reduces payload size from potentially thousands of messages to just the gap.
  **Files**: `src/hooks/use-session-events.ts`, potentially `src/app/api/sessions/[id]/messages/route.ts`
  **Details**:
  Track the ID or timestamp of the last received message:
  ```ts
  const lastMessageIdRef = useRef<string | null>(null);

  // Update in handleEvent when a message is processed:
  // lastMessageIdRef.current = info.id;
  ```

  On reconnect (in `es.onopen` when `hasConnectedOnce.current` is true, line 136):
  ```ts
  // BEFORE
  loadAllMessages().then(...)

  // AFTER
  loadMessagesSince(lastMessageIdRef.current).then(...)
  ```

  The `loadMessagesSince` function:
  ```ts
  const loadMessagesSince = useCallback(async (afterId: string | null): Promise<void> => {
    if (!sessionId || !instanceId) return;
    if (!afterId) {
      // No reference point — fall back to full load
      return loadAllMessages();
    }
    try {
      // Fetch messages after the given ID
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages?instanceId=${encodeURIComponent(instanceId)}&after=${encodeURIComponent(afterId)}`;
      const response = await fetch(url);
      if (!response.ok) return loadAllMessages(); // fallback
      const data = await response.json() as { messages?: SDKMessage[] };
      if (!data.messages?.length) return; // no gap

      const accumulated = data.messages.map(convertSDKMessageToAccumulated);
      setMessages(prev => {
        // Append new messages, avoiding duplicates
        const existingIds = new Set(prev.map(m => m.id));
        const newMessages = accumulated.filter(m => !existingIds.has(m.id));
        const merged = [...prev, ...newMessages];
        // Apply cap
        return merged.length > MAX_MESSAGES
          ? merged.slice(merged.length - MAX_MESSAGES)
          : merged;
      });
    } catch {
      return loadAllMessages(); // fallback on error
    }
  }, [sessionId, instanceId, loadAllMessages]);
  ```

  **Server-side**: Check if the messages API route already supports an `after` parameter. If not, add one that filters messages by ID or timestamp. Check `src/app/api/sessions/[id]/messages/route.ts`.
  **Acceptance**: Reconnect after a 5-second network drop loads only the messages from the gap period, not the entire history.

- [ ] 3. **Make callback-monitor polling conditional**
  **What**: Only run the 10-second polling loop when there are actually pending callbacks to check. When no callbacks are pending, skip or pause the loop.
  **Files**: `src/lib/server/callback-monitor.ts`
  **Details**:
  The current polling loop (lines 390–470) runs unconditionally every 10 seconds. The first thing it does is check `getAllPendingCallbacks()` (line 392) and return early if empty. The optimization is to avoid the interval tick entirely when there's nothing to poll.

  **Option A (simple)**: Keep the interval but add an early-exit counter. If N consecutive polls find no pending callbacks, clear the interval. Re-start it when `startMonitoring()` is called.
  ```ts
  let consecutiveEmptyPolls = 0;
  const MAX_EMPTY_POLLS = 3;

  // In the polling loop:
  const pending = getAllPendingCallbacks();
  if (pending.length === 0) {
    consecutiveEmptyPolls++;
    if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
      clearInterval(_g.__weaveCallbackPollInterval!);
      _g.__weaveCallbackPollInterval = null;
    }
    return;
  }
  consecutiveEmptyPolls = 0;
  ```

  In `startMonitoring()`, restart the polling loop if it was stopped:
  ```ts
  if (!_g.__weaveCallbackPollInterval) {
    startCallbackPollingLoop();
  }
  ```

  **Option B (cleaner)**: Use `setTimeout` instead of `setInterval`, with the next timeout only scheduled if there are pending callbacks.

  Recommend Option A for simplicity — it's a minimal change to existing code.
  **Acceptance**: With no pending callbacks, the polling interval stops after 3 empty checks. Creating a new callback restarts it.

- [ ] 4. **Add EventEmitter listener monitoring**
  **What**: Add periodic logging of listener counts on the `NotificationEmitter` and implement cleanup of orphaned listeners.
  **Files**: `src/lib/server/notification-emitter.ts`
  **Details**:
  Add a monitoring function:
  ```ts
  const LISTENER_WARN_THRESHOLD = 50;

  export function getListenerCounts(): { notification: number; activity_status: number } {
    const emitter = getEmitter();
    return {
      notification: emitter.listenerCount("notification"),
      activity_status: emitter.listenerCount("activity_status"),
    };
  }
  ```

  Add a periodic check (e.g., every 60 seconds) that warns if listener count exceeds the threshold:
  ```ts
  let monitorInterval: ReturnType<typeof setInterval> | null = null;

  export function startListenerMonitoring(): void {
    if (monitorInterval) return;
    monitorInterval = setInterval(() => {
      const counts = getListenerCounts();
      const total = counts.notification + counts.activity_status;
      if (total > LISTENER_WARN_THRESHOLD) {
        console.warn(
          `[notification-emitter] High listener count: ${total} (notification: ${counts.notification}, activity_status: ${counts.activity_status}). Possible leak.`
        );
      }
    }, 60_000);
  }
  ```

  Call `startListenerMonitoring()` from the self-initializing section or from `process-manager.ts` post-recovery.

  **Note**: True listener cleanup is hard because we don't know which listeners are orphaned. The warning is the first step — if it triggers in production, a more aggressive cleanup strategy can be designed.
  **Acceptance**: Listener counts are logged when they exceed the threshold. The `maxListeners` value remains at 100.

---

## Future Work (Tasks 5–7)

These tasks are deferred until the core optimizations (Plans 1–5) are proven stable and metrics confirm the improvements.

- [ ] 5. **Trust watcher, remove Phase 1 status polling** (Medium effort)
  **Precondition**: Session-status-watcher has been running in production for ≥2 weeks with no missed status transitions (monitor via logging).
  **What**: Remove the `session.status()` Phase 1 calls from `GET /api/sessions` (lines 192–207 of `sessions/route.ts`). Trust that the `session-status-watcher` keeps DB session statuses up-to-date in real-time.
  **Files**: `src/app/api/sessions/route.ts`, `src/lib/server/session-status-watcher.ts` (for monitoring additions)
  **Risk**: If the watcher misses a transition, sessions will show stale status until the next poll. Mitigate by keeping a low-frequency status reconciliation (e.g., every 60s instead of every request).

- [ ] 6. **Server-side session cache with TTL** (Medium effort)
  **Precondition**: Plan 3 Task 1 (parallelized session.get) is landed.
  **What**: Cache `session.get()` results for 5 seconds (matching the client poll interval). Subsequent requests within the TTL window return cached data without SDK calls.
  **Files**: `src/lib/server/session-cache.ts` (new file), `src/app/api/sessions/route.ts`
  **Design**: Simple `Map<sessionId, { data, expiry }>` with lazy expiration.

- [ ] 7. **SSE-triggered refetch (replace polling)** (Large effort)
  **Precondition**: Plan 4 (unified SSE) is landed and stable. Task 5 (trust watcher) is validated.
  **What**: Instead of polling `GET /api/sessions` every 5 seconds, have the server emit session-change events via the SSE stream. The client only fetches when notified of a change.
  **Files**: `src/lib/server/notification-emitter.ts`, `src/contexts/sessions-context.tsx`, multiple server-side mutation points
  **Design**: Server emits `{ type: "sessions_changed" }` event whenever a session is created, updated, or deleted. Client receives this and calls `refetch()`. Polling becomes a fallback (60s interval) for resilience.

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] Tasks 1–2: Long session with >500 messages doesn't cause memory growth
- [ ] Task 3: Server logs show callback polling stops when no callbacks are pending
- [ ] Task 4: Server logs show listener count warnings when threshold exceeded
- [ ] No regressions in session events, callbacks, or notifications
