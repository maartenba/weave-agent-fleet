# Performance Plan 1: Context & State Foundation

## TL;DR
> **Summary**: Fix the root causes of re-render cascades — unmemoized context value, broken forceRender, unconditional poll setState, missing SSE batching, and missing SSE reconnection — all touching `sessions-context.tsx` and its hooks.
> **Estimated Effort**: Short (1–2 days)

## Context
### Original Request
The UI becomes sluggish as session count grows and uptime increases. The combined analysis identified 6 foundational issues that must be fixed before any downstream React optimizations (React.memo, useCallback) can be effective.

### Key Findings
- **`sessions-context.tsx` line 136**: `value={{ sessions, isLoading, error, refetch, summary }}` creates a new object identity on every render. All context consumers re-render on every SessionsProvider render, even when no field changed. `useMemo` is imported (line 3) but not used for the value prop.
- **`sessions-context.tsx` line 133**: `useMemo` depends on `forceRender` (the **setter function**, not the counter value). The setter has stable identity, so the dep array never truly reflects SSE-triggered counter changes. Works by accident today but will break under React Compiler.
- **`use-sessions.ts` line 31**: `setSessions(data)` is called unconditionally on every 5s poll. Even when data hasn't changed, this triggers a new array reference → re-render cascade through context.
- **`use-fleet-summary.ts` line 31**: Same pattern — `setSummary(data)` unconditional on every 10s poll.
- **`sessions-context.tsx` lines 87–113**: SSE `EventSource` has no batching — each `activity_status` event calls `forceRender` immediately, causing N re-renders for N rapid SSE events.
- **`sessions-context.tsx` lines 84–113**: No `onerror` handler, no reconnection logic. If the SSE connection drops, real-time activity status updates are permanently lost until page reload. The `NotificationsProvider` (line 188) HAS reconnection; `SessionsProvider` does not.

## Prerequisites
- None — this is the foundation all other perf plans depend on.

## Expected Impact
- Re-renders reduced from ~4,134/min to ~690/min (per H2 estimate — Tier 1 alone achieves ~83% reduction)
- SSE event bursts coalesced to at most 1 re-render per animation frame (~60/sec max)
- SSE resilience: sidebar activity status survives network hiccups without page reload

## Objectives
### Core Objective
Eliminate the root causes of unnecessary re-render cascades in the session state layer.

### Deliverables
- [ ] Memoized context value prop in `SessionsProvider`
- [ ] Fixed `forceRender` dependency to use counter value, not setter
- [ ] Structural sharing in `useSessions` poll (skip setState when data unchanged)
- [ ] Structural sharing in `useFleetSummary` poll (skip setState when data unchanged)
- [ ] `requestAnimationFrame`-based SSE event batching
- [ ] SSE reconnection with exponential backoff in `SessionsProvider`

### Definition of Done
- [ ] `npm run build` succeeds with no new warnings
- [ ] `npx vitest run` — all tests pass, including new tests for `sessionsChanged` comparator
- [ ] React DevTools Profiler: opening the fleet page with 10+ sessions shows ≤2 context-triggered re-renders per 5s poll cycle (down from ~53)

### Guardrails (Must NOT)
- Must NOT change the `SessionsContextValue` interface (no breaking API for consumers)
- Must NOT change SSE event wire format
- Must NOT introduce new context providers (that's Plan 4)

---

## TODOs

- [ ] 1. **Memoize context `value` prop**
  **What**: Wrap the context value object in `useMemo` so it only creates a new identity when its constituent values actually change.
  **Files**: `src/contexts/sessions-context.tsx`
  **Details**:
  Replace line 136's inline object:
  ```tsx
  // BEFORE (line 136)
  <SessionsContext.Provider value={{ sessions, isLoading, error, refetch, summary }}>
  ```
  With a memoized value:
  ```tsx
  const contextValue = useMemo(
    () => ({ sessions, isLoading, error, refetch, summary }),
    [sessions, isLoading, error, refetch, summary]
  );
  // ...
  <SessionsContext.Provider value={contextValue}>
  ```
  Note: `refetch` is already stable (wrapped in `useCallback` at `use-sessions.ts` line 23). `summary` comes from `useFleetSummary` which returns a new object each poll — Task 4 fixes that. Until Task 4 lands, the memoization still helps because it prevents re-renders when only the render cycle changes (not the data).
  **Acceptance**: Context value object identity is stable across renders when no field changes. Verify via React DevTools: select `SessionsContext.Provider`, observe that `value` object reference doesn't change between polls when data is unchanged.

- [ ] 2. **Fix `forceRender` broken dependency**
  **What**: The `useMemo` at line 117 depends on `forceRender` (the setter function from `useState`). The setter has stable identity, so this dependency never triggers re-computation from SSE events. Fix by exposing the counter value.
  **Files**: `src/contexts/sessions-context.tsx`
  **Details**:
  ```tsx
  // BEFORE (lines 80, 133)
  const [, forceRender] = useState(0);
  // ...
  }, [polledSessions, forceRender]);  // forceRender is the SETTER — stable identity!

  // AFTER
  const [sseGeneration, setSseGeneration] = useState(0);
  // ... (replace forceRender(n => n+1) with setSseGeneration(n => n+1) in onmessage handler at line 102)
  }, [polledSessions, sseGeneration]);  // sseGeneration is the COUNTER VALUE — changes on each SSE event
  ```
  This makes the `useMemo` correctly re-evaluate when SSE patches arrive. The variable rename (`forceRender` → `setSseGeneration`) also makes intent clear.
  **Acceptance**: After an SSE `activity_status` event arrives, the `useMemo` recomputes and the sidebar reflects the new status immediately without waiting for the next poll.

- [ ] 3. **Add structural sharing to `useSessions` poll**
  **What**: Compare incoming poll data against current state; skip `setSessions` if nothing changed. Use a field-by-field comparator (not `JSON.stringify`, which is too slow for large arrays).
  **Files**: `src/hooks/use-sessions.ts`, `src/lib/session-utils.ts`, `src/lib/__tests__/session-utils.test.ts`
  **Details**:
  Add a `sessionsChanged(prev, next)` function to `session-utils.ts`:
  ```ts
  export function sessionsChanged(
    prev: SessionListItem[],
    next: SessionListItem[]
  ): boolean {
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) {
      const a = prev[i]!, b = next[i]!;
      if (
        a.session.id !== b.session.id ||
        a.sessionStatus !== b.sessionStatus ||
        a.activityStatus !== b.activityStatus ||
        a.lifecycleStatus !== b.lifecycleStatus ||
        a.instanceStatus !== b.instanceStatus ||
        a.session.title !== b.session.title ||
        a.session.messageCount !== b.session.messageCount
      ) return true;
    }
    return false;
  }
  ```
  Fields to compare: `session.id`, `sessionStatus`, `activityStatus`, `lifecycleStatus`, `instanceStatus`, `session.title`, `session.messageCount` — these are the fields the UI actually renders. Do NOT compare deep objects like `session.messages`.

  Then in `use-sessions.ts`, change line 31:
  ```ts
  // BEFORE
  setSessions(data);

  // AFTER
  import { sessionsChanged } from "@/lib/session-utils";
  // ...
  setSessions(prev => sessionsChanged(prev, data) ? data : prev);
  ```
  React will bail out of the re-render if the updater returns the same reference.

  Add tests to `session-utils.test.ts`:
  - Returns `false` when arrays are identical (same data)
  - Returns `true` when a session's `activityStatus` changes
  - Returns `true` when array lengths differ
  - Returns `true` when session order changes (different `session.id` at same index)
  - Returns `false` for an empty array compared to another empty array
  **Acceptance**: With 10 idle sessions, the 5s poll no longer triggers a re-render cascade when data is unchanged. Verify: add `console.count("sessions-poll-setState")` inside the updater and observe it logs "skipped" when data is unchanged.

- [ ] 4. **Add structural sharing to `useFleetSummary` poll**
  **What**: Same pattern as Task 3 but simpler — `FleetSummaryResponse` has 5 numeric fields. Shallow-compare before setting state.
  **Files**: `src/hooks/use-fleet-summary.ts`
  **Details**:
  ```ts
  // BEFORE (line 31)
  setSummary(data);

  // AFTER
  setSummary(prev => {
    if (
      prev &&
      prev.activeSessions === data.activeSessions &&
      prev.idleSessions === data.idleSessions &&
      prev.totalTokens === data.totalTokens &&
      prev.totalCost === data.totalCost &&
      prev.queuedTasks === data.queuedTasks
    ) return prev;
    return data;
  });
  ```
  No need for a separate utility function — the comparison is trivial and inline.
  **Acceptance**: Fleet summary poll no longer triggers re-renders when the summary hasn't changed. Verify: React DevTools shows `SessionsProvider` does not re-render on fleet summary poll when values are stable.

- [ ] 5. **Batch SSE events via `requestAnimationFrame`**
  **What**: Coalesce rapid SSE `activity_status` events so at most one `setSseGeneration` call happens per animation frame.
  **Files**: `src/contexts/sessions-context.tsx`
  **Details**:
  Add a ref to track the pending rAF:
  ```tsx
  const rafRef = useRef<number | null>(null);
  ```
  Replace the direct `forceRender` call in `onmessage` (line 102):
  ```tsx
  // BEFORE
  forceRender((n) => n + 1);

  // AFTER
  if (rafRef.current === null) {
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setSseGeneration((n) => n + 1);
    });
  }
  ```
  Cancel in cleanup (add to the return function at line 109):
  ```tsx
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  ```
  This means if 10 SSE events arrive within 16ms, only 1 re-render occurs. The `ssePatchesRef` accumulates all patches; the single re-render picks them all up.
  **Acceptance**: Sending 20 rapid SSE events results in ≤2 re-renders (not 20). Verify via React DevTools Profiler or by counting `setSseGeneration` calls.

- [ ] 6. **Add reconnection to `SessionsProvider` SSE**
  **What**: Add `onerror` handler with exponential backoff reconnection to the `EventSource` in `SessionsProvider`, matching the pattern already used by `NotificationsProvider` (lines 188–204 of `notifications-context.tsx`).
  **Files**: `src/contexts/sessions-context.tsx`
  **Details**:
  Add reconnect refs:
  ```tsx
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  ```
  Add `onerror` handler to the EventSource (after line 107):
  ```tsx
  es.onerror = () => {
    if (!isMounted.current) return;
    es.close();
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, 30_000);
    reconnectTimerRef.current = setTimeout(() => {
      if (isMounted.current) {
        // Reconnect by re-running the effect
        // The simplest approach: increment a reconnect counter in state
        // to trigger the effect cleanup + re-run
        setSseGeneration(n => n + 1); // triggers useMemo re-eval AND effect re-run
      }
    }, delay);
  };

  es.onopen = () => {
    reconnectDelayRef.current = 1000; // reset backoff on success
  };
  ```
  Clean up timer in effect cleanup (line 109):
  ```tsx
  if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }
  ```
  **Important design choice**: The SSE reconnection needs to re-create the `EventSource`. The cleanest approach is to add a `[sseReconnectKey]` state that, when incremented, causes the `useEffect` to re-run (cleanup closes old ES, setup creates new one). This is separate from `sseGeneration` which is for useMemo. Add:
  ```tsx
  const [sseReconnectKey, setSseReconnectKey] = useState(0);
  ```
  And use it as the effect dependency. In `onerror`, call `setSseReconnectKey(n => n + 1)` after the delay.
  **Acceptance**: Simulate a network drop (DevTools > Network > Offline for 5s, then back online). The SSE connection should re-establish within the backoff window, and sidebar activity statuses should resume updating without a page reload.

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all existing tests pass
- [ ] New `sessionsChanged` tests pass
- [ ] React DevTools Profiler: fleet page with 10+ sessions shows dramatically fewer re-renders per poll cycle
- [ ] Manual test: toggle DevTools Network offline/online → SSE reconnects automatically
- [ ] No regressions in sidebar activity status updates (busy/idle/waiting_input still reflected in real-time)
