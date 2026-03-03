# Issue #43: Session UX Fixes — Rename Flicker & Disconnection UX

## TL;DR
> **Summary**: Fix two UI/UX bugs: (1) workspace rename triggers a full session refetch causing screen flicker, and (2) poor disconnection/reconnection UX with status flicker, un-awaited message loads, and no circuit breaker.
> **Estimated Effort**: Medium

## Context
### Original Request
GitHub issue #43 reports two session UX bugs that degrade the user experience.

### Key Findings

**Bug 1 — Rename flicker:**
- `sidebar-workspace-item.tsx` passes `refetch` (from `useSessionsContext`) as the `onSuccess` callback to `renameWorkspace()` (line 74).
- `use-rename-workspace.ts` calls `onSuccess?.()` after PATCH succeeds (line 44), triggering `fetchSessions()` which calls `GET /api/sessions` and does `setSessions(data)`.
- This causes the entire `SessionsProvider` to re-render, which cascades through `Sidebar` → `useWorkspaces(sessions)` → all `SidebarWorkspaceItem` components re-render.
- The `InlineEdit` component renders `{value}` when not editing (line 132 of inline-edit.tsx), where `value={group.displayName}` comes from props. So when InlineEdit exits editing mode, it immediately shows `group.displayName` from the *old* sessions data, then the refetch arrives and re-renders everything with the new name. This causes a visible flash: new name → old name → new name.
- **Critical insight**: The `InlineEdit` **does NOT** persist the saved value locally — after `commit()`, it calls `onSave(trimmed)` then exits editing mode and renders `{value}` from props (which is still the old `group.displayName` until the context updates). So we need a targeted state update, not just "stop calling refetch."

**Bug 2 — Disconnection UX:**
- `use-session-events.ts` `es.onerror` immediately sets `status` to `"disconnected"` (line 170), which triggers the amber "Connection lost" banner in `activity-stream-v1.tsx` (line 293). Even a brief hiccup shows the banner.
- On first connect (`es.onopen`, line 146-152), `loadMessages()` is called but NOT awaited — `setStatus("connected")` happens before messages load, so the user briefly sees "Connected" with an empty message list.
- On reconnect (`es.onopen`, line 137-145), `loadMessages()` IS awaited (via `.then()`), and status is set to `"recovering"` then `"connected"`. This is better, but the initial transition to `"disconnected"` still causes flicker.
- `reconnectAttempt` counter increments indefinitely (line 171) — after many retries the "(attempt 47)" text looks alarming. No circuit breaker or max-retry state.
- The 5s session poll (`use-sessions.ts`) and 10s fleet summary poll (`use-fleet-summary.ts`) continue firing even when the SSE connection is down, wasting network requests on an unreachable backend.
- Polls are independent of SSE state — `SessionsProvider` doesn't know about SSE status.

## Objectives
### Core Objective
Eliminate jarring UI flicker from workspace rename and connection status transitions, and add graceful degradation for prolonged disconnections.

### Deliverables
- [ ] Workspace rename updates the sidebar instantly without a full refetch
- [ ] Connection status transitions are debounced to avoid flicker on brief hiccups
- [ ] Initial connect awaits `loadMessages()` before showing "connected"
- [ ] Circuit breaker shows a stable "unable to connect" state after N failed retries
- [ ] Polling pauses or slows when SSE is disconnected (stretch goal)

### Definition of Done
- [ ] Renaming a workspace updates the sidebar name instantly; no flash of old name
- [ ] Briefly disconnecting SSE (< 2s) does NOT show the "Connection lost" banner
- [ ] After 5+ failed reconnect attempts, a stable "Unable to connect" message is shown with manual retry
- [ ] `npm run build` passes without errors
- [ ] No regressions to existing session streaming or sidebar functionality

### Guardrails (Must NOT)
- Must NOT change the API contract or backend
- Must NOT break the 5s poll mechanism (it serves as a fallback)
- Must NOT remove the manual "Reconnect Now" button
- Must NOT change the InlineEdit component's public API
- Must NOT place side-effects (timers, I/O) inside React state updater callbacks — React Strict Mode double-invokes them

## TODOs

### Bug 1: Workspace rename flicker

- [ ] 1. Add `updateWorkspaceName` to sessions context
  **What**: Add a targeted state updater to `SessionsContextValue` that patches the `workspaceDisplayName` field on all sessions matching a given `workspaceId`, without triggering a full refetch. This avoids the full re-render cycle.
  **Files**: 
  - `src/hooks/use-sessions.ts` — Add `updateWorkspaceName` function that calls `setSessions(prev => prev.map(...))` to patch matching sessions in-place
  - `src/contexts/sessions-context.tsx` — Add `updateWorkspaceName: (workspaceId: string, displayName: string) => void` to the context value interface and wire it through
  **Details**:
  In `use-sessions.ts`, add:
  ```typescript
  const updateWorkspaceName = useCallback((workspaceId: string, displayName: string) => {
    setSessions(prev => prev.map(s => 
      s.workspaceId === workspaceId 
        ? { ...s, workspaceDisplayName: displayName } 
        : s
    ));
  }, []);
  ```
  Export it from `UseSessionsResult`. Then wire it through `SessionsProvider` and `SessionsContextValue`.
  **Acceptance**: `updateWorkspaceName` is available on the sessions context and calling it updates only the target workspace's sessions.

- [ ] 2. Use targeted update instead of refetch in rename flow
  **What**: Change `sidebar-workspace-item.tsx` to call `updateWorkspaceName` on rename success instead of `refetch`. This makes the rename instant — the sessions state updates in-place, `useWorkspaces(sessions)` recomputes with the new name, and `group.displayName` updates in the same render cycle.
  **Files**:
  - `src/components/layout/sidebar-workspace-item.tsx` — Destructure `updateWorkspaceName` from `useSessionsContext()` (line 55). Change `handleRename` (lines 71-79) to call `updateWorkspaceName(group.workspaceId, newName)` instead of passing `refetch` to `renameWorkspace`.
  **Details**:
  ```typescript
  const { refetch, updateWorkspaceName } = useSessionsContext();
  
  const handleRename = useCallback(
    async (newName: string) => {
      try {
        await renameWorkspace(group.workspaceId, newName, () => {
          updateWorkspaceName(group.workspaceId, newName);
        });
      } catch {
        // error surfaced inside useRenameWorkspace
      }
    },
    [group.workspaceId, renameWorkspace, updateWorkspaceName]
  );
  ```
  Keep `refetch` in the destructuring — it is still used in `handleTerminateAll` (line 100). Only change `handleRename` to stop passing `refetch` and instead pass the targeted updater.
  **Acceptance**: Renaming a workspace shows the new name instantly. No full-screen flicker. The next 5s poll confirms the server state.

### Bug 2: Disconnection/reconnection UX

- [ ] 3. Await `loadMessages()` on initial connect and update empty-state spinner
  **What**: On first SSE connect, await `loadMessages()` before setting status to `"connected"`. Currently (line 148-152), `setStatus("connected")` fires immediately and `loadMessages()` runs in the background — the user sees "Connected" with no messages, then messages pop in. Also update the empty-state in `activity-stream-v1.tsx` to show the spinner for `"recovering"` status (not just `"connecting"`), since initial connect now transitions through `"recovering"` while loading history.
  **Files**:
  - `src/hooks/use-session-events.ts` — Modify the `es.onopen` handler (lines 146-152)
  - `src/components/session/activity-stream-v1.tsx` — Modify empty-state condition (lines 321-331)
  **Details**:
  In `use-session-events.ts`, change the first-connect branch from:
  ```typescript
  hasConnectedOnce.current = true;
  setStatus("connected");
  setError(undefined);
  loadMessages();
  ```
  To:
  ```typescript
  hasConnectedOnce.current = true;
  setStatus("recovering"); // show spinner while loading history
  loadMessages().then(() => {
    if (isMounted.current) {
      setStatus("connected");
      setError(undefined);
    }
  });
  ```
  This matches the reconnect path (lines 138-145) which already awaits loadMessages. Using `"recovering"` during initial load is semantically correct — the UI shows a spinner instead of a false "Connected" state.

  In `activity-stream-v1.tsx`, change the empty-state condition (line 323) from:
  ```typescript
  {status === "connecting" ? (
  ```
  To:
  ```typescript
  {(status === "connecting" || status === "recovering") ? (
  ```
  And update the label to be appropriate for both states:
  ```typescript
  <span>{status === "recovering" ? "Loading…" : "Connecting…"}</span>
  ```
  Without this change, the user would see "No messages yet. Send a prompt to get started." during the brief `"recovering"` phase on initial connect, which is misleading.
  **Acceptance**: On first connect, the "Connected" status only appears after messages have loaded. The empty-state shows a spinner and "Loading…" during the history fetch. No empty-then-populated flash.

- [ ] 4. Debounce the "disconnected" status transition
  **What**: Don't immediately show the "Connection lost" banner when SSE drops. Use a short delay (e.g., 500ms) before transitioning to `"disconnected"` status. If the connection recovers within that window (which it often does on brief hiccups), the user never sees the banner.
  **Files**:
  - `src/hooks/use-session-events.ts` — Modify `es.onerror` handler (lines 166-178), cleanup (lines 189-197), `reconnect()` (lines 202-216)
  **Details**:
  Add a new ref and constant at the hook level:
  ```typescript
  const DISCONNECT_DEBOUNCE_MS = 500;
  const disconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  ```
  In `es.onerror`, replace the immediate `setStatus("disconnected")` (line 170) with a debounced version:
  ```typescript
  es.onerror = () => {
    if (!isMounted.current) return;
    es.close();
    eventSourceRef.current = null;
    
    // Debounce the disconnected status to avoid flicker on brief hiccups.
    // Do NOT set status immediately — wait DISCONNECT_DEBOUNCE_MS.
    // If onopen fires within that window, the timer is cleared (see below).
    disconnectDebounceRef.current = setTimeout(() => {
      if (isMounted.current) {
        setStatus("disconnected");
      }
      disconnectDebounceRef.current = null;
    }, DISCONNECT_DEBOUNCE_MS);
    
    setReconnectAttempt((prev) => prev + 1);

    const delay = reconnectDelay.current;
    reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    reconnectTimerRef.current = setTimeout(() => {
      if (isMounted.current) connectRef.current?.();
    }, delay);
  };
  ```
  In `es.onopen`, clear the debounce timer so that if we reconnect within the window, status goes from previous state directly to `"recovering"`/`"connected"` without ever showing `"disconnected"`:
  ```typescript
  // At the top of es.onopen, before any status changes:
  if (disconnectDebounceRef.current) {
    clearTimeout(disconnectDebounceRef.current);
    disconnectDebounceRef.current = null;
  }
  ```
  Clear the debounce timer in three additional places:
  1. The cleanup function (lines 189-197) — add alongside the existing `reconnectTimerRef` cleanup
  2. The manual `reconnect()` callback (lines 202-216) — add alongside the existing timer cleanup
  3. The circuit breaker branch in Task 5 (see below) — cancel debounce before setting `"error"` status
  **Acceptance**: Brief SSE disconnections (< 500ms) do not show the "Connection lost" banner. Sustained disconnections still show it after the delay.

- [ ] 5. Add circuit breaker for reconnection attempts
  **What**: After a configurable number of failed reconnection attempts (e.g., 5), stop auto-reconnecting and show a stable "Unable to connect" state with a manual retry button. This prevents the counter from incrementing indefinitely and alarming users.
  **Files**:
  - `src/hooks/use-session-events.ts` — Add max retry logic to `es.onerror`
  - `src/components/session/activity-stream-v1.tsx` — Add Reconnect button to the error banner
  - `src/app/sessions/[id]/page.tsx` — Add Reconnect button to the sidebar Connection section for `status === "error"`
  **Details**:
  Add a constant `MAX_RECONNECT_ATTEMPTS = 5` in `use-session-events.ts`.

  **⚠️ Critical: No side-effects inside state updaters.** React Strict Mode double-invokes functional updaters passed to `setState`. Timer scheduling (`setTimeout`) inside `setReconnectAttempt(prev => ...)` would fire twice, creating duplicate reconnect timers. All timer side-effects must remain OUTSIDE the state updater.

  **⚠️ Critical: Cancel debounce timer before circuit breaker `setStatus("error")`.** The debounce timer from Task 4 schedules a delayed `setStatus("disconnected")`. If the circuit breaker fires `setStatus("error")` first, the pending debounce would overwrite it with `"disconnected"` 500ms later. The circuit breaker branch must cancel `disconnectDebounceRef.current` before setting error status.

  Restructure the `es.onerror` handler to use a local variable for the new attempt count, keeping side-effects outside the updater:
  ```typescript
  es.onerror = () => {
    if (!isMounted.current) return;
    es.close();
    eventSourceRef.current = null;

    // Debounce the "disconnected" status (Task 4)
    disconnectDebounceRef.current = setTimeout(() => {
      if (isMounted.current) {
        setStatus("disconnected");
      }
      disconnectDebounceRef.current = null;
    }, DISCONNECT_DEBOUNCE_MS);

    // Use a ref to track the attempt count for the circuit breaker decision.
    // This avoids placing side-effects inside the state updater callback,
    // which React Strict Mode would double-invoke.
    reconnectAttemptRef.current += 1;
    const attempt = reconnectAttemptRef.current;
    setReconnectAttempt(attempt);

    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      // Circuit breaker: stop retrying, show stable error state.
      // Cancel the debounce timer to prevent it from overwriting "error" with "disconnected".
      if (disconnectDebounceRef.current) {
        clearTimeout(disconnectDebounceRef.current);
        disconnectDebounceRef.current = null;
      }
      setStatus("error");
      setError("Unable to connect after multiple attempts. Click Reconnect to try again.");
      // Do NOT schedule reconnect timer — user must click Reconnect manually.
    } else {
      // Schedule auto-reconnect with exponential backoff
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (isMounted.current) connectRef.current?.();
      }, delay);
    }
  };
  ```
  This requires adding a new ref `reconnectAttemptRef = useRef(0)` alongside the existing `reconnectAttempt` state. The ref is the source of truth for the counter (used for the circuit breaker decision); the state drives UI re-renders. Reset both in the `reconnect()` callback:
  ```typescript
  const reconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (disconnectDebounceRef.current) {
      clearTimeout(disconnectDebounceRef.current);
      disconnectDebounceRef.current = null;
    }
    reconnectDelay.current = BASE_RECONNECT_DELAY_MS;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    connectRef.current?.();
  }, []);
  ```
  Also reset `reconnectAttemptRef.current = 0` in `es.onopen` (alongside the existing `setReconnectAttempt(0)` on line 135).

  **UI changes — activity-stream-v1.tsx:** The `status === "error"` banner (lines 312-317) already exists but has no Reconnect button. Replace it:
  ```typescript
  {status === "error" && error && (
    <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{error}</span>
      {onReconnect && (
        <button
          onClick={onReconnect}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Reconnect
        </button>
      )}
    </div>
  )}
  ```

  **UI changes — page.tsx sidebar Connection section:** The sidebar (lines 591-602) only shows a Reconnect button for `status === "disconnected"`. After the circuit breaker fires `status === "error"`, the sidebar shows error text but no retry path. Add a Reconnect button for the error state too. Replace lines 600-602:
  ```typescript
  {status === "error" && (
    <>
      {error && (
        <p className="text-[10px] text-red-400/70 break-words mt-0.5">{error}</p>
      )}
      <button
        onClick={reconnect}
        className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
      >
        <RefreshCw className="h-2.5 w-2.5" />
        Reconnect
      </button>
    </>
  )}
  ```
  **Acceptance**: After 5 failed reconnect attempts, auto-reconnect stops, a red "Unable to connect" banner with Reconnect button is shown in BOTH the activity stream banner AND the sidebar Connection section. Clicking Reconnect resets the counter and tries again. No timer race between debounce and circuit breaker. No side-effects in state updaters.

- [ ] 6. Coordinate polling with browser online/offline status (stretch)
  **What**: When the browser is offline, the 5s session poll and 10s fleet summary poll are wasting requests. Guard fetches with `navigator.onLine` and refetch immediately when connectivity returns.
  **Files**:
  - `src/hooks/use-sessions.ts` — Add `navigator.onLine` guard and `online` event listener
  - `src/hooks/use-fleet-summary.ts` — Same changes
  **Details**:
  In both `use-sessions.ts` and `use-fleet-summary.ts`, wrap the fetch call in a `navigator.onLine` check:
  ```typescript
  const fetchSessions = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    // ... existing fetch logic
  }, []);
  ```
  In the `useEffect` that sets up the interval, add an `online` event listener to immediately refetch when connectivity returns, and **clean it up in the effect's return**:
  ```typescript
  useEffect(() => {
    isMounted.current = true;
    fetchSessions();
    const interval = setInterval(fetchSessions, pollIntervalMs);

    const handleOnline = () => { fetchSessions(); };
    window.addEventListener('online', handleOnline);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [fetchSessions, pollIntervalMs]);
  ```
  **⚠️ Cleanup requirement**: The `return` of the effect MUST call `window.removeEventListener('online', handleOnline)` to prevent listener leaks on component unmount or effect re-run. Using a named `handleOnline` function (not an inline arrow directly in `addEventListener`) ensures the same reference is passed to both `addEventListener` and `removeEventListener`.

  Apply the identical pattern to both hooks. The same fetch callback is reused for the listener, so no new dependencies are introduced.
  **Acceptance**: When the browser is offline, no fetch requests are made by the polling hooks. When connectivity returns, an immediate refetch occurs. No event listener leaks on unmount.

## Verification
- [ ] All tasks produce valid TypeScript — `npm run build` passes
- [ ] Rename a workspace in the sidebar → name updates instantly, no flicker, no full re-render
- [ ] Simulate brief SSE drop (e.g., throttle network in DevTools for < 500ms) → no "Connection lost" banner
- [ ] Simulate sustained SSE drop → "Connection lost" banner appears after ~500ms with attempt counter
- [ ] After 5 failed reconnects → red error banner with Reconnect button, no more auto-retry
- [ ] Reconnect button appears in BOTH the activity stream banner AND the page sidebar Connection section
- [ ] Click Reconnect → counter resets, reconnection cycle restarts
- [ ] In React Strict Mode, no duplicate timers are created (verify: no double reconnect attempts in Network tab)
- [ ] Circuit breaker `"error"` status is NOT overwritten by a stale debounce timer firing `"disconnected"`
- [ ] Initial connect shows spinner + "Loading…" in empty state, transitions to "Connected" only after messages load
- [ ] InlineEdit still supports double-click rename, Escape cancel, Enter commit
- [ ] The 5s poll still picks up rename changes from other clients
- [ ] Session detail page still streams messages correctly when connected
- [ ] No `online` event listener leaks on component unmount (verify: no console warnings)
