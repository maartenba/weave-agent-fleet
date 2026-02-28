# Fix Session-Switching Performance & Memory Leaks

## TL;DR
> **Summary**: Fix progressive slowdown and memory leaks when switching sessions, caused by zombie EventSource connections, un-memoized renders, missing fetch abort controllers, and an ever-growing snapshot cache.
> **Estimated Effort**: Medium

## Context
### Original Request
When users switch between sessions, the app gets progressively slower and leaks memory. Six issues were identified through root cause analysis, ranging from critical (zombie SSE connections) to low (un-memoized reverse operations).

### Key Findings

**`src/hooks/use-session-events.ts`** — The `isMounted` ref is a shared boolean that creates a race condition during session switching. When `onerror` fires on a stale EventSource after a new effect body has already set `isMounted=true`, the stale handler passes the guard, nulls out `eventSourceRef.current` (destroying the NEW connection), and schedules a zombie reconnect. The core problem: `isMounted` cannot distinguish *which* connection's callbacks should be active.

**`src/components/session/activity-stream-v1.tsx`** — `MessageItem` (line 128) is a plain function component receiving `allMessages={messages}` (the entire array). Since the `messages` reference changes on every SSE event, every `MessageItem` instance re-renders on every delta. The `allMessages` prop is only used (line 145-149) to find `parent.createdAt` for computing `durationStr`. Additionally, `activeAgentName` (line 244-245) runs `[...messages].reverse().find(...)` on every render without memoization.

**`src/app/sessions/[id]/page.tsx`** — The metadata fetch `useEffect` (lines 54-68) lacks an `AbortController`, leaving orphaned in-flight requests during rapid session switches. Five computed values (`totalCost`, `totalTokens`, `latestTodos`, `activeAgentName`, `participatingAgents` — lines 71-97) are recomputed every render without `useMemo`.

**`src/hooks/use-persisted-state.ts`** — The module-level `snapshotCache` Map (line 37) never evicts entries. While `keyListeners` self-cleans when listeners reach zero, `snapshotCache` accumulates forever.

## Objectives
### Core Objective
Eliminate memory leaks and unnecessary re-renders during session switching so the app remains responsive over extended use.

### Deliverables
- [ ] Zombie EventSource connections are impossible via generation-counter pattern
- [ ] `MessageItem` only re-renders when its own data changes
- [ ] Session metadata fetch is properly cancelled on cleanup
- [ ] Expensive computations in the session page are memoized
- [ ] `snapshotCache` evicts entries when no subscribers remain
- [ ] Duplicate `activeAgentName` computation in `ActivityStreamV1` is memoized

### Definition of Done
- [ ] `npm run build` succeeds with no new TypeScript errors
- [ ] Switching between sessions 10+ times does not increase EventSource connection count (verify via browser DevTools Network tab — each switch should show exactly 1 active SSE connection)
- [ ] React DevTools Profiler shows `MessageItem` only re-rendering when its own `message` prop changes, not on every SSE delta

### Guardrails (Must NOT)
- Do NOT change SSE event handling logic or message accumulation behavior
- Do NOT modify the `handleEvent` function signature or semantics
- Do NOT change any API routes or backend behavior
- Do NOT introduce new dependencies

## TODOs

- [ ] 1. **Add generation counter to `useSessionEvents` to eliminate zombie EventSources**
  **What**: Replace the shared `isMounted` boolean guard with a generation counter pattern. Add a `generationRef = useRef(0)` alongside the existing `isMounted`. At the start of the main `useEffect` body (line 177), increment `generationRef.current`. In the `connect` function, capture `const gen = generationRef.current` at call time (line 117). All event handler callbacks (`onopen`, `onmessage`, `onerror`) check `if (gen !== generationRef.current) return` as their first line — this makes stale callbacks no-ops even if `isMounted` is true. The reconnect timer callback (line 166-168) also checks `gen !== generationRef.current` before calling `connectRef.current?.()`. Keep the existing `isMounted` check in the effect cleanup for the unmount case (belt-and-suspenders).

  Specific changes:
  - Line 44: Add `const generationRef = useRef(0);` after `isMounted`
  - Line 117-169 (`connect` function): Capture `const gen = generationRef.current` at start. Replace `if (!isMounted.current) return` guards in `onopen` (line 126), `onmessage` (line 148), and `onerror` (line 159) with `if (gen !== generationRef.current) return`. In `onerror`, the reconnect timer (line 166-168) should also check `if (gen !== generationRef.current) return` before calling `connectRef.current?.()`
  - **Line 133 (inside `onopen`)**: The `.then()` callback inside `loadMessages().then(() => { if (isMounted.current) { ... } })` MUST also check `if (gen !== generationRef.current) return` — this async callback can fire after a session switch and would set stale status/error state. This is a **fourth guard site** in addition to onopen/onmessage/onerror.
  - Line 177: Add `generationRef.current += 1;` as the first statement in the effect body, before `isMounted.current = true`
  - Keep `isMounted.current = false` in cleanup (line 181) and keep `isMounted` check at the very start of `connect` (line 118) — the generation counter is additional protection for the race window
  - **IMPORTANT**: `generationRef.current += 1` belongs **only** in the `useEffect` body (line 177), NEVER inside `connect()` itself. Legitimate mid-session reconnects (after transient network errors) must share the same generation as the valid connection — incrementing gen inside `connect()` would make their callbacks immediately stale and break reconnection.

  **Files**: `src/hooks/use-session-events.ts`
  **Acceptance**: After switching sessions rapidly 20 times, DevTools Network tab shows exactly 1 active EventSource connection (no zombies). No stale session data bleeds into the current view.

- [ ] 2. **Wrap `MessageItem` in `React.memo` and eliminate `allMessages` prop**
  **What**: The `allMessages` prop causes every `MessageItem` to re-render when any message changes because the array reference is new each time. Fix by computing `parentCreatedAt` upstream and passing only the relevant timestamp.

  Specific changes:
  - In `ActivityStreamV1` (around line 243, before the return): Create a `parentCreatedAtMap` using `useMemo`:
    ```
    const parentCreatedAtMap = useMemo(() => {
      const map = new Map<string, number>();
      for (const m of messages) {
        if (m.createdAt != null) map.set(m.messageId, m.createdAt);
      }
      return map;
    }, [messages]);
    ```
  - Update `MessageItemProps` interface (line 122-126): Replace `allMessages?: AccumulatedMessage[]` with `parentCreatedAt?: number`
  - Update `MessageItem` component (line 128): Destructure `parentCreatedAt` instead of `allMessages`
  - Update duration computation (lines 144-150): Replace the `allMessages.find(...)` lookup with a direct check: `if (!isUser && message.completedAt && parentCreatedAt) { durationStr = formatDuration(message.completedAt - parentCreatedAt); }`
  - Wrap the `MessageItem` function in `React.memo`: `const MessageItem = React.memo(function MessageItem({ ... }: MessageItemProps) { ... })`
  - Update the JSX where `MessageItem` is rendered (lines 280-287): Replace `allMessages={messages}` with `parentCreatedAt={message.parentID ? parentCreatedAtMap.get(message.parentID) : undefined}`
  - Add `React` to the import or use `memo` directly: Update import on line 3 to include `useMemo, memo`

  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: React DevTools Profiler shows that when a new SSE delta arrives, only the affected `MessageItem` re-renders, not all siblings.

- [ ] 3. **Add `AbortController` to metadata fetch**
  **What**: The `useEffect` that fetches session metadata (lines 54-68) creates orphaned in-flight requests during rapid session switching. Add an `AbortController` and pass `{ signal }` to `fetch()`. In the cleanup function, call `controller.abort()`.

  Specific changes:
  - Line 54-68: Restructure the effect:
    ```
    useEffect(() => {
      if (!sessionId || !instanceId) return;
      const controller = new AbortController();
      const url = `/api/sessions/...`;
      fetch(url, { signal: controller.signal })
        .then(r => r.json())
        .then((data) => { setMetadata({...}); })
        .catch(() => {/* ignore AbortError + network errors */});
      return () => { controller.abort(); };
    }, [sessionId, instanceId]);
    ```

  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Switching sessions rapidly does not result in stale metadata being displayed (verify by watching the workspace directory in the sidebar — it should always match the current session).

- [ ] 4. **Memoize expensive computations in session detail page**
  **What**: Five computed values on lines 71-97 (`totalCost`, `totalTokens`, `latestTodos`, `activeAgentName`, `participatingAgents`) run `.reduce()`, `.reverse()`, and `.find()` over the full messages array on every render. Wrap each in `useMemo`.

  Specific changes:
  - Add `useMemo` to the import on line 12 (alongside `useCallback, useEffect, useState`)
  - Lines 71-75: Wrap `totalCost` and `totalTokens` in a single `useMemo` returning `{ totalCost, totalTokens }` with dependency `[messages]`
  - Line 76: Wrap `latestTodos` in `useMemo` with dependency `[messages]`
  - Lines 79-84: Wrap `activeAgentName` and `activeAgentMeta` in `useMemo` with dependency `[messages, sessionStatus, agents]`
  - Lines 87-97: Wrap `participatingAgents` in `useMemo` with dependency `[messages, agents]`

  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: React DevTools Profiler shows these values are not recomputed when unrelated state changes (e.g., `stopConfirm` toggling).

- [ ] 5. **Evict `snapshotCache` entries when last subscriber unsubscribes**
  **What**: The module-level `snapshotCache` Map (line 37) accumulates entries for every unique localStorage key ever accessed. When the last listener for a key unsubscribes in `subscribeToKey` (lines 27-29), also delete the key from `snapshotCache`.

  Specific changes:
  - Lines 27-29: After `keyListeners.delete(key)`, add `snapshotCache.delete(key)`:
    ```
    return () => {
      listeners!.delete(callback);
      if (listeners!.size === 0) {
        keyListeners.delete(key);
        snapshotCache.delete(key);
      }
    };
    ```

  **Files**: `src/hooks/use-persisted-state.ts`
  **Acceptance**: After navigating away from a page that uses `usePersistedState`, the key is no longer present in `snapshotCache` (verify with a temporary `console.log(snapshotCache.size)` or breakpoint).

- [ ] 6. **Memoize `activeAgentName` in `ActivityStreamV1`**
  **What**: Line 244-245 runs `[...messages].reverse().find(...)` on every render. Wrap in `useMemo` with `[messages, sessionStatus]` dependency.

  Specific changes:
  - Lines 244-246: Replace with:
    ```
    const activeAgentName = useMemo(() => {
      if (sessionStatus !== "busy") return null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user" && messages[i].agent) return messages[i].agent!;
      }
      return null;
    }, [messages, sessionStatus]);
    ```
  - This also avoids the array copy (`[...messages]`) by using a reverse `for` loop
  - Ensure `useMemo` is in the import (already added in TODO 2)

  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: The `[...messages].reverse()` pattern no longer appears in `ActivityStreamV1`. The `activeAgentName` derivation only re-runs when `messages` or `sessionStatus` changes.

- [ ] 7. **Verify build compiles successfully**
  **What**: Run `npm run build` (or the project's build command) to ensure all TypeScript compiles, no import errors, and no regressions.
  **Files**: N/A (verification only)
  **Acceptance**: `npm run build` exits with code 0, no new TypeScript errors or warnings.

## Verification
- [ ] `npm run build` succeeds with zero errors
- [ ] No regressions in session viewing, message streaming, or agent switching
- [ ] Switching sessions 20+ times: exactly 1 active EventSource connection at any time
- [ ] Memory profiling (DevTools → Memory → Heap snapshot): no growing detached EventSource objects after session switches
- [ ] React Profiler: `MessageItem` re-renders are scoped to the changed message only
- [ ] `snapshotCache` does not grow unbounded (verify size stays proportional to active subscriptions)
