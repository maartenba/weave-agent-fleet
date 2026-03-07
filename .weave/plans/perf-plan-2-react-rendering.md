# Performance Plan 2: React Rendering Optimization

## TL;DR
> **Summary**: Stabilize callback props with `useCallback`, remove double-wrapped arrow callbacks, add `React.memo` to leaf components, and thread `refetch` as a prop to avoid context subscriptions that bypass `React.memo`.
> **Estimated Effort**: Short (1–2 days)

## Context
### Original Request
The fleet page re-renders all session cards and sidebar items on every state change, even when individual items haven't changed. The combined analysis identified that `React.memo` alone is insufficient — callbacks must be stabilized first, and context subscriptions for `refetch` must be removed.

### Key Findings
- **`page.tsx` lines 53–115**: 8 handler functions are plain inline `async` functions, recreated on every render. These are passed as props to `SessionGroup` and `LiveSessionCard`, defeating any `React.memo` on those components.
- **`page.tsx` lines 215, 228, 283, 297, 344, 355, 401, 413**: Double-wrapped arrow callbacks like `onOpen={(dir) => handleOpen(dir)}` create a new closure on every render. Since `handleOpen` is already a function, this should be `onOpen={handleOpen}` (or `onOpen={stableHandleOpen}` after useCallback).
- **`session-group.tsx` line 44**: Plain function export (no `React.memo`). Line 45: `const { refetch } = useSessionsContext()` subscribes to entire context.
- **`live-session-card.tsx` line 20**: Plain function export (no `React.memo`).
- **`sidebar-session-item.tsx` line 24**: Plain function (no `React.memo`). Line 26: `const { refetch } = useSessionsContext()`.
- **`sidebar-workspace-item.tsx` line 45**: Plain function (no `React.memo`). Line 55: `const { refetch } = useSessionsContext()`.
- **`sidebar.tsx` line 47**: `const { sessions, error } = useSessionsContext()` — consumes full context. Line 44: plain function.
- **`page.tsx` line 442**: `group={{ ...group, sessions: sortSessions(group.sessions) }}` creates a new object on every render, defeating `React.memo` on `SessionGroup`.

## Prerequisites
- **Plan 1 must be completed first** — specifically Tasks 1 (memoize context value) and 3 (structural sharing in polls). Without a stable context value, `React.memo` on components that consume context is useless.

## Expected Impact
- Re-renders reduced from ~690/min (after Plan 1) to ~120/min (per H2 estimate — 97% total reduction from baseline)
- Individual session cards and sidebar items only re-render when their own data changes

## Objectives
### Core Objective
Ensure leaf components only re-render when their own props change, not when unrelated sessions update.

### Deliverables
- [ ] All 8 handlers in `page.tsx` wrapped in `useCallback`
- [ ] Double-wrapped arrow callbacks eliminated
- [ ] `React.memo` added to `LiveSessionCard`, `SessionGroup`, `SidebarSessionItem`, `SidebarWorkspaceItem`
- [ ] `refetch` threaded as prop instead of consumed via context in child components
- [ ] Sorted sessions memoized to avoid new object identity on each render

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] React DevTools: selecting a single `LiveSessionCard` and triggering a poll shows it does NOT re-render when its data is unchanged

### Guardrails (Must NOT)
- Must NOT change component external APIs beyond adding optional `refetch` prop
- Must NOT change any business logic or behavior
- Must NOT add `React.memo` to components that render children from context (like `Sidebar` itself — only leaf items)

---

## TODOs

- [ ] 1. **Wrap handlers in `useCallback` in `FleetPageInner`**
  **What**: Wrap all 8 handler functions (lines 53–115) in `useCallback` with appropriate dependency arrays.
  **Files**: `src/app/page.tsx`
  **Details**:
  The handlers to wrap (approximate line numbers from current source):
  1. `handleTerminate` — deps: none (uses fetch + refetch which is stable)
  2. `handleAbort` — deps: none
  3. `handleResume` — deps: none
  4. `handleDeleteRequest` — deps: [setDeleteTarget] or similar state setter
  5. `handleDeleteConfirm` — deps: [deleteTarget state]
  6. `handleDeleteCancel` — deps: none
  7. `handleOpen` — deps: [router]
  8. `handleRename` — deps: none

  Pattern:
  ```tsx
  // BEFORE
  async function handleTerminate(sessionId: string, instanceId: string) { ... }

  // AFTER
  const handleTerminate = useCallback(async (sessionId: string, instanceId: string) => {
    // ... same body ...
  }, [refetch]); // refetch is stable from useCallback in use-sessions.ts
  ```
  Note: Some handlers call `refetch()` — since `refetch` is already stable (wrapped in `useCallback` at `use-sessions.ts:23`), it's a safe dependency. Check each handler's closure variables carefully.
  **Acceptance**: Each handler has a stable identity across renders. Verify: add `useEffect(() => console.log('handleTerminate changed'), [handleTerminate])` — should only log once.

- [ ] 2. **Remove double-wrapped arrow callbacks**
  **What**: Replace `onOpen={(dir) => handleOpen(dir)}` patterns with direct references `onOpen={handleOpen}`. The extra arrow function creates a new closure on every render, defeating `React.memo` on the child.
  **Files**: `src/app/page.tsx`, `src/components/fleet/session-group.tsx`
  **Details**:
  In `page.tsx`, find all instances matching `onSomething={(args) => handleSomething(args)}` and replace with `onSomething={handleSomething}`.

  Known locations in `page.tsx`: lines 215, 228, 283, 297, 344, 355, 401, 413.

  In `session-group.tsx`, lines 188 and 202 have:
  ```tsx
  onOpen={onOpen ? (dir) => onOpen(dir, "vscode") : undefined}
  ```
  This creates a new closure every render. Extract to a stable callback:
  ```tsx
  const handleOpenVscode = useCallback(
    (dir: string) => onOpen?.(dir, "vscode"),
    [onOpen]
  );
  // Then: onOpen={onOpen ? handleOpenVscode : undefined}
  ```
  Similarly for the "cursor" variant if present.

  **Important caveat**: Some double-wraps add extra arguments (like the `"vscode"` above). These need `useCallback` wrappers, not just direct references. Only remove the wrapper when it's a pure passthrough.
  **Acceptance**: No inline arrow functions passed as props to memoized components. Grep for `={(` patterns in JSX return and verify none are simple passthroughs.

- [ ] 3. **Memoize sorted sessions in `FleetPageInner`**
  **What**: The `group={{ ...group, sessions: sortSessions(group.sessions) }}` spread at line 442 creates a new object every render. Memoize the sorted groups.
  **Files**: `src/app/page.tsx`
  **Details**:
  ```tsx
  // BEFORE (in the render/map)
  group={{ ...group, sessions: sortSessions(group.sessions) }}

  // AFTER — memoize outside the JSX
  const sortedGroups = useMemo(
    () => groups.map(g => ({ ...g, sessions: sortSessions(g.sessions) })),
    [groups]
  );
  // Then in JSX: group={sortedGroup}
  ```
  This ensures `SessionGroup` receives a stable object reference when the underlying data hasn't changed.
  **Acceptance**: `SessionGroup` props have stable identity between renders when data is unchanged.

- [ ] 4. **Add `React.memo` to `LiveSessionCard`**
  **What**: Wrap the component export in `React.memo`. This is a leaf component that receives all data via props.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Details**:
  ```tsx
  // BEFORE (line 20)
  export function LiveSessionCard({ ... }: LiveSessionCardProps) {

  // AFTER
  export const LiveSessionCard = React.memo(function LiveSessionCard({ ... }: LiveSessionCardProps) {
    // ... same body ...
  });
  ```
  Ensure `React` or `memo` is imported. This component does NOT consume context directly, so `React.memo` is effective once handlers are stabilized (Task 1).
  **Acceptance**: A `LiveSessionCard` for session A does not re-render when session B's status changes.

- [ ] 5. **Thread `refetch` as prop to `SessionGroup` + add `React.memo`**
  **What**: Remove the `const { refetch } = useSessionsContext()` call from `SessionGroup` (line 45). Instead, accept `refetch` as a prop. Then wrap in `React.memo`.
  **Files**: `src/components/fleet/session-group.tsx`, `src/app/page.tsx`
  **Details**:
  In `session-group.tsx`:
  ```tsx
  // BEFORE
  interface SessionGroupProps { ... }
  export function SessionGroup({ ... }: SessionGroupProps) {
    const { refetch } = useSessionsContext();

  // AFTER
  interface SessionGroupProps {
    // ... existing props ...
    refetch: () => void;
  }
  export const SessionGroup = React.memo(function SessionGroup({ ..., refetch }: SessionGroupProps) {
    // remove useSessionsContext() call
  ```
  In `page.tsx`, pass `refetch` prop to `SessionGroup`:
  ```tsx
  <SessionGroup ... refetch={refetch} />
  ```
  `refetch` is already available in `FleetPageInner` from `useSessionsContext()`. Since `refetch` is stable (wrapped in `useCallback`), passing it as a prop doesn't defeat `React.memo`.
  **Acceptance**: `SessionGroup` no longer subscribes to context. Verify: remove the `useSessionsContext` import if no longer used.

- [ ] 6. **Thread `refetch` as prop to `SidebarSessionItem` and `SidebarWorkspaceItem` + add `React.memo`**
  **What**: Same pattern as Task 5 — remove context consumption from sidebar leaf items and thread `refetch` as a prop from `Sidebar`.
  **Files**: `src/components/layout/sidebar-session-item.tsx`, `src/components/layout/sidebar-workspace-item.tsx`, `src/components/layout/sidebar.tsx`
  **Details**:
  In `sidebar-session-item.tsx` (line 26):
  ```tsx
  // BEFORE
  const { refetch } = useSessionsContext();
  // AFTER — accept refetch as prop, remove context call
  ```
  Same for `sidebar-workspace-item.tsx` (line 55).

  In `sidebar.tsx`, pass `refetch` from its own context consumption:
  ```tsx
  // sidebar.tsx already has: const { sessions, error } = useSessionsContext();
  // Change to: const { sessions, error, refetch } = useSessionsContext();
  // Then pass refetch={refetch} to SidebarSessionItem and SidebarWorkspaceItem
  ```

  Wrap both in `React.memo`:
  ```tsx
  export const SidebarSessionItem = React.memo(function SidebarSessionItem(...) { ... });
  export const SidebarWorkspaceItem = React.memo(function SidebarWorkspaceItem(...) { ... });
  ```
  **Acceptance**: Sidebar items only re-render when their own session data changes. Verify via React DevTools Profiler.

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] React DevTools Profiler: with 10+ sessions, a poll cycle that changes 1 session results in ≤3 component re-renders (the changed card, its group, and the provider) — not 53
- [ ] Manual test: hover/click interactions still work correctly (handlers are functional)
- [ ] Manual test: refetch (e.g., after terminating a session) still updates the sidebar
- [ ] No console warnings about missing `React.memo` display names
