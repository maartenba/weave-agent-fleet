# Issue #43: Session Rename Refresh & Disconnection UX

## TL;DR
> **Summary**: Fix session rename triggering a full screen refresh by removing the `onSuccess`/`refetch` callback, and improve the disconnection experience by fixing a race condition, adding coordinated polling, implementing a circuit breaker, and standardizing status colors.
> **Estimated Effort**: Medium

## Context
### Original Request
GitHub Issue #43 — "UI/UX: Session rename causes full screen refresh & poor disconnection experience". Two distinct problems: (1) renaming a workspace re-fetches all sessions causing a jarring full re-render, and (2) the disconnection/reconnection experience is poor due to race conditions, uncoordinated polling, infinite retries, and inconsistent status colors.

### Key Findings
- `useRenameWorkspace` accepts an `onSuccess` callback (line 9, 22, 44) — callers pass `refetch` which triggers a full session list reload.
- `InlineEdit` already maintains local `draft` state, so the rename is visible immediately without refetch.
- `use-session-events.ts` line 137: `loadAllMessages()` is fire-and-forget (`.then()`), causing status to transition to "connected" before messages are loaded.
- `useSessions` polls every 5s (line 49) and `useFleetSummary` polls every 10s (line 49) — both independent of SSE state.
- Reconnect retries forever with exponential backoff capped at 30s — no circuit breaker.
- Three distinct UI locations render connection status with different color schemes:
  - `activity-stream-v1.tsx` status bar (line 467–489) and banner (line 325–349)
  - `page.tsx` header dot (line 274–284) and sidebar connection section (line 568–608)

## Objectives
### Core Objective
Eliminate the full-screen refresh on rename and make the disconnection experience smooth and informative.

### Deliverables
- [ ] Remove `onSuccess` callback from rename flow — no more refetch on rename
- [ ] Fix race condition: await `loadAllMessages()` before setting status to "connected"
- [ ] Add `enabled` parameter to polling hooks and wire to connection health
- [ ] Add circuit breaker with max retry count
- [ ] Standardize connection status colors across all UI locations

### Definition of Done
- [ ] Renaming a workspace updates the name inline without any visible re-render or scroll jump
- [ ] After SSE reconnection, status shows "recovering" until messages are fully loaded
- [ ] Polling pauses when SSE is disconnected/errored
- [ ] After 10 failed reconnection attempts, status shows "error" and retries stop
- [ ] All three UI locations use identical color semantics for each connection state
- [ ] `npm run build` passes with no errors

### Guardrails (Must NOT)
- Must NOT break the `handleTerminateAll` flows that legitimately use `refetch`
- Must NOT change the SSE event handling logic or message accumulation
- Must NOT remove the manual "Reconnect" button — it must always be available
- Must NOT alter the `InlineEdit` component itself

## TODOs

### Part 1: Session Rename — Remove Full Screen Refresh

- [ ] 1. Remove `onSuccess` parameter from `useRenameWorkspace`
  **What**: Remove the optional `onSuccess` parameter from both the interface (`UseRenameWorkspaceResult.renameWorkspace` signature, line 9) and the implementation (`renameWorkspace` function parameter, line 22). Remove the `onSuccess?.()` call on line 44.
  **Files**: `src/hooks/use-rename-workspace.ts`
  **Acceptance**: The `renameWorkspace` function signature is `(workspaceId: string, displayName: string) => Promise<void>` with no third parameter. The hook still sets loading/error state correctly.

- [ ] 2. Stop passing `refetch` to `renameWorkspace` in sidebar
  **What**: In `handleRename` (line 72–80), change `await renameWorkspace(group.workspaceId, newName, refetch)` to `await renameWorkspace(group.workspaceId, newName)`. Remove `refetch` from the `useCallback` dependency array (line 79). Keep the `const { refetch } = useSessionsContext()` extraction on line 55 since `handleTerminateAll` (line 100) still uses it.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`
  **Acceptance**: `handleRename` calls `renameWorkspace` with only two arguments. `refetch` is not in `handleRename`'s dependency array.

- [ ] 3. Stop passing `refetch` to `renameWorkspace` in session group
  **What**: In `handleRename` (line 67–76), change `await renameWorkspace(group.workspaceId, newName, refetch)` to `await renameWorkspace(group.workspaceId, newName)`. Remove `refetch` from the `useCallback` dependency array (line 75). Keep the `const { refetch } = useSessionsContext()` extraction on line 45 since `handleTerminateAll` (line 83) still uses it.
  **Files**: `src/components/fleet/session-group.tsx`
  **Acceptance**: `handleRename` calls `renameWorkspace` with only two arguments. `refetch` is not in `handleRename`'s dependency array.

### Part 2a: Fix Race Condition in Recovery

- [ ] 4. Await `loadAllMessages()` before setting status to "connected"
  **What**: In `use-session-events.ts`, the `es.onopen` handler (line 129–149) uses `.then()` fire-and-forget for `loadAllMessages()` on reconnect (line 137–142). Refactor to properly `await` the recovery. Since `onopen` can't be `async` directly on EventSource, wrap the recovery logic in an immediately-invoked async function (IIFE) or extract to a separate async helper. The key change: `setStatus("connected")` and `setError(undefined)` must only execute _after_ `loadAllMessages()` resolves. **Critical**: The IIFE must guard `isMounted.current` _after_ the await (not just at the top of `onopen`), since the component may unmount during the async `loadAllMessages()` call. Without this guard, `setStatus` would be called on an unmounted component.
  **Files**: `src/hooks/use-session-events.ts`
  **Acceptance**: On reconnection, status transitions: `connecting` → `recovering` → (messages loaded) → `connected`. The "recovering" state is visible until all messages are fetched. The first-connect path (line 143–149) remains unchanged. The `isMounted.current` check appears both at the top of `onopen` and after the awaited `loadAllMessages()` call.

### Part 2b: Coordinated Polling — Pause When Disconnected

- [ ] 5. Add `enabled` parameter to `useSessions` hook
  **What**: Add an optional `enabled?: boolean` parameter (default `true`) to `useSessions`. When `enabled` is `false`, skip the `setInterval` setup and do not call `fetchSessions` on mount. When `enabled` transitions from `false` to `true`, immediately fetch and restart the interval.
  **Files**: `src/hooks/use-sessions.ts`
  **Acceptance**: `useSessions(5000, false)` does not make any fetch calls. `useSessions(5000, true)` behaves as before (fetch on mount + interval).

- [ ] 6. Add `enabled` parameter to `useFleetSummary` hook
  **What**: Same pattern as task 5. Add optional `enabled?: boolean` parameter (default `true`). When `false`, no fetch calls or intervals.
  **Files**: `src/hooks/use-fleet-summary.ts`
  **Acceptance**: `useFleetSummary(10000, false)` does not make any fetch calls.

- [ ] 7. Wire polling `enabled` to connection health in `SessionsProvider`
  **What**: The `SessionsProvider` doesn't directly have SSE status (that lives per-session in `useSessionEvents`). Instead, add a simple connection health signal: expose a `setPollingEnabled` function from the context, and have the session detail page call `setPollingEnabled(false)` when SSE status is `"disconnected"` or `"error"`, and `setPollingEnabled(true)` when `"connected"`. In `SessionsProvider`, pass this boolean to `useSessions` and `useFleetSummary`. Default should be `true` (polling on) so the fleet overview page works normally.
  **Files**: `src/contexts/sessions-context.tsx`, `src/app/sessions/[id]/page.tsx`
  **Acceptance**: When the SSE connection drops on a session detail page, the 5s/10s polling stops. When it reconnects, polling resumes. On the fleet page (no SSE), polling runs normally.

### Part 2c: Circuit Breaker — Max Retry Count

- [ ] 8. Add max retry count to SSE reconnection logic
  **What**: Add a constant `MAX_RECONNECT_ATTEMPTS = 10` near the existing delay constants (line 48–49). **Critical implementation detail**: `reconnectAttempt` is React state (`useState`, line 60) — reading it synchronously in `onerror` after `setReconnectAttempt` will see the stale pre-increment value, so the circuit breaker will never trip. Add a `reconnectAttemptRef = useRef(0)` as the synchronous counter for the guard condition. Keep `setReconnectAttempt` for UI display only. In the `es.onerror` handler (line 163–175), increment the ref (`reconnectAttemptRef.current += 1`), sync to state (`setReconnectAttempt(reconnectAttemptRef.current)`), then check if `reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS`. If so, set status to `"error"` with a descriptive message (e.g., "Connection lost after 10 attempts. Click Reconnect to try again.") and do NOT schedule a reconnect timer. The manual `reconnect()` function (line 207–221) must also reset `reconnectAttemptRef.current = 0` alongside the existing `setReconnectAttempt(0)`.
  **Files**: `src/hooks/use-session-events.ts`
  **Acceptance**: After 10 consecutive failed reconnection attempts, status is `"error"`, no more automatic retries. Manual reconnect button still works and resets both the ref and state counters.

### Part 2e: Standardize Status Colors

- [ ] 9. Standardize activity stream status bar colors
  **What**: In `activity-stream-v1.tsx` status bar (line 467–489), the current logic uses inline `style={{ backgroundColor: ... }}` with CSS variables/runtime values — **not** Tailwind classes. New states must continue using the inline `style` approach to match. Refactor to use consistent colors:
  - When `sessionStatus === "busy"`: keep agent color (green fallback) + pulse — no change needed
  - When `status === "connected"` (idle): zinc/gray — currently `var(--color-zinc-500)` ✓
  - When `status === "connecting"`: `var(--color-amber-500)` + add `animate-pulse` via className
  - When `status === "recovering"`: `var(--color-blue-500)` + add `animate-pulse` via className
  - When `status === "disconnected"`: `var(--color-red-500)`
  - When `status === "error"`: `var(--color-red-500)`
  
  Currently the status bar text only distinguishes "Idle", "Connecting…", "Disconnected" — add "Recovering…" and "Error" states. Also add the `recovering` case to the banner section (line 324–349) with a blue-themed banner.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: The status bar dot and text reflect all 5 connection states. A "recovering" banner shows during state recovery. All status bar dot colors use inline `style` with CSS variables (not Tailwind bg- classes).

- [ ] 10. Standardize header status dot colors in session detail page
  **What**: In `page.tsx` header (line 274–284), the current dot uses:
  - `isStopped` → slate (correct)
  - `busy` → green + pulse (correct)  
  - `connected` → zinc (correct)
  - else → amber + pulse (too vague)
  
  Expand the else branch to distinguish:
  - `connecting` → amber + pulse
  - `recovering` → blue + pulse
  - `disconnected` → red
  - `error` → red
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: The header dot matches the standardized color scheme for all states.

- [ ] 11. Standardize sidebar connection status colors
  **What**: In `page.tsx` sidebar (line 576–582), the dot already distinguishes `connected` (green), `connecting` (amber), `recovering` (blue), and a red fallback. Change `connected` from `bg-green-500` to `bg-zinc-500` (gray) to match the "idle" semantic — green is reserved for `busy` state. This makes the sidebar consistent with the header and status bar.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Sidebar connection dot for "connected" state is `bg-zinc-500` (gray), not `bg-green-500`.

## Verification
- [ ] `npm run build` passes with no errors
- [ ] No TypeScript type errors introduced
- [ ] Rename a workspace in sidebar — name updates inline, no visible re-render or scroll jump
- [ ] Simulate SSE disconnect — banner appears, polling pauses, status dot is red
- [ ] After 10 failed retries — status shows "error", automatic retries stop
- [ ] Click "Reconnect" after circuit breaker trips — reconnection resumes
- [ ] On successful reconnect — "recovering" state visible, then transitions to "connected" only after messages load
- [ ] All three UI locations (status bar, header dot, sidebar) show consistent colors for each state
