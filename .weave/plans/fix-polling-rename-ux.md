# Fix Polling-Induced Rename Focus Loss

## TL;DR
> **Summary**: Prevent sidebar polling from disrupting inline rename by deduplicating unchanged poll responses and adding focus-restoration as defense-in-depth.
> **Estimated Effort**: Quick

## Context
### Original Request
The sidebar polls `/api/sessions` every 5 seconds. When a user is renaming a session via `InlineEdit`, a poll can fire, `setSessions(newData)` re-renders the sidebar tree, the inline edit input loses focus, and the rename is interrupted.

### Key Findings
- `useSessions` (line 30-31) unconditionally calls `setSessions(data)` on every successful fetch, even when the data is identical — this triggers a React state update and full re-render of all consumers via `SessionsContext`.
- `useFleetSummary` has the exact same pattern (line 31-32) — unconditional `setSummary(data)` on every poll.
- `InlineEdit` has a `useEffect` on lines 54-59 that focuses the input, but it only fires when `isEditing` changes (dependency: `[isEditing]`). A re-render where `isEditing` stays `true` does NOT re-trigger this effect, so the input loses focus permanently after a polling re-render.
- `SidebarSessionItem` holds `isRenaming` state locally and passes it to `InlineEdit` as `editing={isRenaming}`. The rename state survives re-renders, but the DOM input gets unmounted and remounted (or at minimum loses focus) when the parent tree re-renders from new session data.
- Both hooks already import `useRef` from React.

## Objectives
### Core Objective
Eliminate focus loss during inline rename caused by polling-induced re-renders.

### Deliverables
- [ ] Deduplicated polling updates in `useSessions` and `useFleetSummary`
- [ ] Focus-restoration safety net in `InlineEdit`

### Definition of Done
- [ ] User can double-click to rename a session, type for >10 seconds, and submit without losing focus
- [ ] Polling still works — actual data changes (new session, status change) still update the UI
- [ ] No new dependencies added

### Guardrails (Must NOT)
- Must NOT add external dependencies (no `fast-deep-equal`, `lodash`, etc.)
- Must NOT change polling intervals or disable polling
- Must NOT alter the `SessionsContext` provider shape or API
- Must NOT change the `InlineEdit` public API (props interface)

## TODOs

- [ ] 1. **Deduplicate polling updates in `useSessions`**
  **What**: Add a `useRef` to hold the last-seen JSON string. Before calling `setSessions(data)`, compare `JSON.stringify(data)` to the ref value. If identical, skip the state update. Update the ref whenever the data changes.
  **Files**: `src/hooks/use-sessions.ts`
  **Details**:
  - Add a new ref: `const lastJsonRef = useRef<string>("");`  (after the existing `isMounted` ref on line 21)
  - In `fetchSessions`, after line 29 (`const data = ...`), before the `if (isMounted.current)` block on line 30:
    ```
    const json = JSON.stringify(data);
    if (isMounted.current) {
      if (json !== lastJsonRef.current) {
        lastJsonRef.current = json;
        setSessions(data);
      }
      setError(undefined);
    }
    ```
  - Note: `setError(undefined)` should still be called unconditionally (within the mounted check) to clear errors even when data hasn't changed.
  **Acceptance**: Opening the Network tab, seeing repeated `/api/sessions` fetches, but React DevTools showing no re-renders on `SessionsProvider` when data is unchanged.

- [ ] 2. **Deduplicate polling updates in `useFleetSummary`**
  **What**: Apply the identical pattern from Task 1 to `useFleetSummary`.
  **Files**: `src/hooks/use-fleet-summary.ts`
  **Details**:
  - Add a new ref: `const lastJsonRef = useRef<string>("");` (after the existing `isMounted` ref on line 22)
  - In `fetchSummary`, after line 30 (`const data = ...`), before the `if (isMounted.current)` block on line 31:
    ```
    const json = JSON.stringify(data);
    if (isMounted.current) {
      if (json !== lastJsonRef.current) {
        lastJsonRef.current = json;
        setSummary(data);
      }
      setError(undefined);
    }
    ```
  **Acceptance**: Same verification as Task 1 but for `/api/fleet/summary`.

- [ ] 3. **Add focus-restoration effect in `InlineEdit`**
  **What**: Add a `useEffect` (no dependency array — runs on every render) that checks if `isEditing` is `true` and `document.activeElement` is not the input ref, and if so, re-focuses the input. This is defense-in-depth for the rare case where actual data changes mid-rename.
  **Files**: `src/components/ui/inline-edit.tsx`
  **Details**:
  - After the existing `useEffect` on lines 54-59, add a new effect:
    ```typescript
    // Defense-in-depth: restore focus if a re-render steals it while editing.
    // The effect above only fires when isEditing *changes*; this one fires on
    // every render to catch focus loss from parent re-renders.
    useEffect(() => {
      if (isEditing && inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    });
    ```
  - This effect intentionally has NO dependency array so it runs after every render.
  - It must NOT call `.select()` (unlike the initial focus effect) — re-selecting text mid-typing would discard the user's cursor position.
  **Acceptance**: Even if a forced re-render occurs (e.g. via React DevTools "force update" on a parent), the input retains focus.

- [ ] 4. **Manual verification**
  **What**: Manually test the full rename flow end-to-end.
  **Files**: None (runtime testing)
  **Acceptance**:
  - Start the dev server
  - Double-click a session name to enter rename mode
  - Wait at least 10 seconds (two full polling cycles)
  - Confirm the input stays focused and the draft text is preserved
  - Type a new name and press Enter — confirm rename succeeds
  - Verify that if a real change occurs (e.g. a new session appears), the sidebar updates correctly while the rename input stays focused
  - Test Escape to cancel rename — confirm it still works
  - Test context menu "Rename" entry — confirm it still works

## Verification
- [ ] All existing tests pass (no regressions)
- [ ] No new dependencies added to `package.json`
- [ ] Rename flow works without focus loss across multiple polling cycles
- [ ] Real data changes still propagate to the UI
- [ ] Build succeeds (`npm run build` or equivalent)
