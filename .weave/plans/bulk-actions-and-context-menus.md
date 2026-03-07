# Bulk Actions and Context Menus

## TL;DR
> **Summary**: Add right-click context menus to session cards and group headers, bulk action dropdowns to the toolbar and group menus, a batch operations hook with progress tracking, and proper AlertDialog-based confirmation for all destructive bulk operations.
> **Estimated Effort**: Large

## Context
### Original Request
Add context menus and bulk actions to the Fleet dashboard at three levels: session cards (right-click), session groups (enhanced dropdown + right-click), and the toolbar (global bulk actions). Replace all `window.confirm()` usage with `AlertDialog`. Add a `useBatchSessionActions` hook for coordinated multi-session operations with progress feedback.

### Key Findings

1. **Sidebar already has working context menus** — `SidebarSessionItem` (L128–218) wraps a `<Link>` in `<ContextMenu>/<ContextMenuTrigger asChild>` and it works correctly. This is the exact pattern needed for `LiveSessionCard` which also wraps a `<Link>`.

2. **`LiveSessionCard` is `React.memo`** — The component itself is memoized (L13). Wrapping it in `ContextMenu` must happen *outside* the memoized component, either by wrapping at the call site or by creating a thin wrapper component. The cleanest approach: create a `SessionCardWithContextMenu` wrapper that composes `ContextMenu` + `LiveSessionCard` and is itself memoized.

3. **Existing duplicate `Promise.allSettled` patterns** — Both `SessionGroup.handleTerminateAll` (L78–84) and `SidebarWorkspaceItem.handleTerminateAll` (L86–97) manually loop sessions with `Promise.allSettled`. The batch hook consolidates this.

4. **`window.confirm()` usage** — Found in `SidebarWorkspaceItem` (L89). `SessionGroup` currently does NOT confirm before terminate-all (L78–84). Both need `AlertDialog` replacement.

5. **Non-grouped rendering** — When `groupBy` is not `"directory"`, `page.tsx` renders `LiveSessionCard` directly in grids (L187–427). The card context menu must work in both grouped and ungrouped layouts.

6. **`OpenToolContextSubmenu`** — Already exists in `src/components/ui/open-tool-menu.tsx` (L91–126) for use in context menus. Requires a `directory` and `onOpen(directory, tool)` callback.

7. **`ConfirmDeleteSessionDialog`** — Existing single-session dialog (L23–63 in `confirm-delete-session-dialog.tsx`). Uses `AlertDialog` primitives. The bulk confirm dialog should follow the same structure but be parameterized for operation type and count.

8. **`FleetToolbar` is stateless** — It receives all state via props (L79–86). Adding a bulk actions dropdown means passing additional callbacks and session counts from `page.tsx`.

9. **`handleOpen` in page.tsx** — Currently takes `(directory: string, tool?: OpenTool)`. Session card's `onOpen` prop is `(directory: string) => void` — it only opens in VS Code (via `handleOpenVscode` in `SessionGroup`, or the default tool in `page.tsx`). The context menu needs the full `onOpen(directory, tool)` to support the "Open in..." submenu. The card itself should receive an `onOpenWith` callback for the context menu.

## Objectives
### Core Objective
Enable efficient multi-session management through context menus (discoverability) and bulk actions (efficiency), with proper confirmation dialogs and progress feedback.

### Deliverables
- [ ] `useBatchSessionActions` hook with progress tracking
- [ ] `BulkConfirmDialog` component for all destructive bulk operations
- [ ] `SessionContextMenu` reusable content component
- [ ] Session card context menu (right-click)
- [ ] Enhanced `SessionGroup` dropdown with Stop All, Resume All, Delete All Stopped
- [ ] Group header right-click context menu mirroring the dropdown
- [ ] Toolbar "Bulk Actions" dropdown for global operations
- [ ] Replace `window.confirm()` with `AlertDialog` in existing code

### Definition of Done
- [ ] Right-clicking any session card opens a context menu with Interrupt/Stop/Resume/Open in.../Copy Session ID/Delete
- [ ] Right-clicking a group header opens a context menu matching the dropdown
- [ ] Group dropdown has Stop All, Resume All, Delete All Stopped, Terminate All
- [ ] Toolbar has a "Bulk Actions" dropdown when sessions exist
- [ ] All destructive bulk ops show `AlertDialog` confirmation with session counts
- [ ] Batch operations show progress (e.g., "Deleting... 3/10") for 2+ sessions
- [ ] `window.confirm()` is no longer used anywhere in the codebase
- [ ] Existing hover buttons on cards are unchanged
- [ ] `npm run build` succeeds without errors

### Guardrails (Must NOT)
- Must NOT remove or alter existing hover buttons on `LiveSessionCard`
- Must NOT break the `<Link>` navigation on session cards
- Must NOT break `React.memo` memoization on `LiveSessionCard`
- Must NOT use `window.confirm()` for any new or existing confirmations
- Must NOT make sidebar changes in this plan (sidebar refactor to use batch hook is a follow-up)

## TODOs

- [ ] 1. Create `useBatchSessionActions` hook
  **What**: A hook that wraps the existing single-session action hooks and provides batch versions with progress tracking. Uses `Promise.allSettled` internally, tracks `{ total, completed, failed, inProgress }`, and exposes results.
  **Files**: Create `src/hooks/use-batch-session-actions.ts`
  **Details**:
  - Import and call the raw `fetch` functions (not hooks) for terminate, resume, and delete. Since the existing hooks use internal state (`useState`), the batch hook should make the API calls directly rather than calling hook functions in a loop. Copy the fetch logic from `use-terminate-session.ts` (L37–47), `use-resume-session.ts` (L24–38), and `use-delete-session.ts` (L25–35) into standalone async functions at the top of the file.
  - Alternatively, accept the hook return functions as parameters — but this creates tight coupling. **Preferred approach**: define private helper functions (`terminateOne`, `resumeOne`, `deleteOne`) that make the fetch calls directly, then the hook only manages state.
  - Hook signature:
    ```ts
    interface BatchProgress {
      total: number;
      completed: number;
      failed: number;
      inProgress: boolean;
    }
    interface BatchResult {
      succeeded: string[]; // sessionIds
      failed: { sessionId: string; error: string }[];
    }
    interface UseBatchSessionActionsResult {
      batchTerminate: (sessions: { sessionId: string; instanceId: string }[]) => Promise<BatchResult>;
      batchResume: (sessionIds: string[]) => Promise<BatchResult>;
      batchDelete: (sessions: { sessionId: string; instanceId: string }[]) => Promise<BatchResult>;
      progress: BatchProgress;
      reset: () => void;
    }
    ```
  - Each batch function: sets `inProgress = true`, sets `total`, runs `Promise.allSettled`, increments `completed` per settled promise (use a ref + setState to avoid stale closures), collects failures, returns `BatchResult`.
  - For progress updates per-item: wrap each promise in a `.then`/`.catch` that increments a counter via `setState(prev => ...)`.
  **Acceptance**: Hook compiles, exports correct types, batch functions call correct API endpoints.

- [ ] 2. Create `BulkConfirmDialog` component
  **What**: A generic confirmation dialog for bulk operations. Parameterized by action type, session count, and progress state.
  **Files**: Create `src/components/fleet/bulk-confirm-dialog.tsx`
  **Details**:
  - Follow the same pattern as `ConfirmDeleteSessionDialog` (uses `AlertDialog` from `src/components/ui/alert-dialog.tsx`).
  - Props:
    ```ts
    interface BulkConfirmDialogProps {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      title: string;          // e.g. "Stop All Sessions"
      description: string;    // e.g. "This will terminate 5 running sessions. Continue?"
      confirmLabel: string;   // e.g. "Stop All"
      variant: "default" | "destructive";
      onConfirm: () => void;
      progress?: BatchProgress; // from useBatchSessionActions
    }
    ```
  - When `progress?.inProgress` is true: disable Cancel, show progress in the action button: `"Stopping... 3/5"` or `"Deleting... 7/10"`.
  - **Auto-close guard**: When progress completes, auto-close the dialog — but only on a `true → false` transition of `inProgress`, NOT on initial render (where `inProgress` is already `false`). Use a `useRef` to track the previous value:
    ```ts
    const wasInProgress = useRef(false);
    useEffect(() => {
      if (wasInProgress.current && !progress?.inProgress) {
        onOpenChange(false);
      }
      wasInProgress.current = progress?.inProgress ?? false;
    }, [progress?.inProgress, onOpenChange]);
    ```
  - **`e.preventDefault()` on `AlertDialogAction`**: Follow the `ConfirmDeleteSessionDialog` pattern (L45–46) — call `e.preventDefault()` inside `onClick` before calling `onConfirm()`. This prevents Radix from auto-closing the dialog before the async operation completes. The dialog stays open showing progress until the auto-close guard fires.
  - Use `AlertDialogAction` with `variant="destructive"` for destructive operations.
  **Acceptance**: Dialog renders correctly, shows progress, disables buttons during operation. Dialog does NOT close on initial render. Dialog auto-closes only after a batch operation completes.

- [ ] 3. Create `SessionContextMenu` content component
  **What**: A reusable component that renders context menu *items* (not the wrapper) for a single session. Used by both the card context menu and potentially other future consumers.
  **Files**: Create `src/components/fleet/session-context-menu.tsx`
  **Details**:
  - This renders `ContextMenuItem` elements, NOT the `ContextMenu`/`ContextMenuTrigger`/`ContextMenuContent` wrapper. The wrapper is applied at the call site.
  - Props:
    ```ts
    interface SessionContextMenuProps {
      item: SessionListItem;
      onTerminate: (sessionId: string, instanceId: string) => void;
      onAbort?: (sessionId: string, instanceId: string) => void;
      onResume?: (sessionId: string) => void;
      onDelete?: (sessionId: string, instanceId: string) => void;
      onOpen?: (directory: string, tool: OpenTool) => void;
    }
    ```
  - Menu items (following `SidebarSessionItem` patterns, L169–217):
    1. **Interrupt** — `OctagonX` icon, shown when `activityStatus === "busy"` and `lifecycleStatus === "running"`
    2. **Stop** — `StopCircle` icon, shown when `lifecycleStatus === "running"`
    3. **Resume** — `Play` icon, shown when stopped/completed/disconnected
    4. Separator
    5. **Open in...** — `OpenToolContextSubmenu` from `src/components/ui/open-tool-menu.tsx`, shown when `onOpen` is provided. Pass `item.workspaceDirectory` as directory.
    6. Separator
    7. **Copy Session ID** — `Copy` icon, copies `session.id` via `navigator.clipboard.writeText`
    8. Separator
    9. **Delete** — `Trash2` icon, destructive variant, shown when session is inactive (stopped/completed/disconnected) and `onDelete` is provided
  **Acceptance**: Component renders correct items based on session state, follows sidebar item pattern exactly.

- [ ] 4. Add context menu to `LiveSessionCard`
  **What**: Wrap `LiveSessionCard` usage sites with `ContextMenu`. Since `LiveSessionCard` is `React.memo` and is rendered at multiple sites (inside `SessionGroup` and directly in `page.tsx`), the cleanest approach is to wrap at each render site.
  **Files**: Modify `src/components/fleet/session-group.tsx`, modify `src/app/page.tsx`
  **Details**:
  - **Approach**: At each place `LiveSessionCard` is rendered, wrap the enclosing `<div>` (or the card itself) with `<ContextMenu>` + `<ContextMenuTrigger asChild>` + `<ContextMenuContent>` containing `<SessionContextMenu>`.
  - **In `session-group.tsx`** (L184–213): There are TWO render sites for `LiveSessionCard` — parent cards (L186–195) and child cards inside the `border-l-2` indent div (L198–210). Both must be wrapped.
    - **Parent cards** (L185–213): Wrap the outer `<div key=...>` in `<ContextMenu>`:
      ```tsx
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div key={...}> {/* existing wrapper div */}
            <LiveSessionCard item={item} ... />
            {children.length > 0 && (
              <div className="ml-4 mt-1 space-y-2 border-l-2 ...">
                {/* child cards rendered here */}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <SessionContextMenu item={item} onTerminate={...} ... />
        </ContextMenuContent>
      </ContextMenu>
      ```
    - **Child cards** (L199–209): Each child `LiveSessionCard` inside the `border-l-2` container also needs its own `ContextMenu` wrapper. Wrap each child card individually:
      ```tsx
      {children.map((child) => (
        <ContextMenu key={`${child.instanceId}-${child.session.id}`}>
          <ContextMenuTrigger asChild>
            <div> {/* wrapper for asChild */}
              <LiveSessionCard item={child} isChild ... />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <SessionContextMenu item={child} onTerminate={...} ... />
          </ContextMenuContent>
        </ContextMenu>
      ))}
      ```
    - Note: The parent card's `ContextMenu` wraps the entire parent + children container, so right-clicking in the `border-l-2` gutter area (between child cards) would open the parent's context menu. The child card's own `ContextMenu` takes precedence when right-clicking directly on a child card (Radix handles nested context menus correctly — the innermost one wins).
  - **In `page.tsx`**: Same pattern for every `LiveSessionCard` render site (L215–237, L282–305, L341–365, L399–423). There are 4 render functions + 1 default. Each renders cards in a grid. Wrap each card's container div.
  - **Critical**: The `<Link>` inside `LiveSessionCard` must still work. `ContextMenuTrigger asChild` on the wrapper `<div>` means right-click opens the menu, left-click follows the link. This matches the `SidebarSessionItem` pattern (L129–167) where `ContextMenuTrigger asChild` wraps a `<Link>`.
  - **`onOpen` callback**: The `SessionContextMenu` needs `onOpen(directory, tool)` but the card-level `onOpen` is `(directory: string) => void`. In `page.tsx`, pass the full `handleOpen` callback (L111–115). In `session-group.tsx`, expose `onOpen` (which already accepts `OpenTool`).
  - **Memoization**: The `ContextMenu` wrapper is lightweight (no state until opened). Wrapping a memoized component does not defeat memoization — `LiveSessionCard` still skips re-renders when props are unchanged.
  - **Helper component**: To reduce repetition across the 5 render sites in `page.tsx`, create a small local component `SessionCardWithMenu` inside `page.tsx` that wraps `LiveSessionCard` with the context menu. This component takes the same props as `LiveSessionCard` plus `item` for the context menu.
  **Acceptance**: Right-clicking any session card opens the context menu. Left-clicking still navigates. Hover buttons still work.

- [ ] 5. Enhance `SessionGroup` dropdown menu with bulk actions
  **What**: Add Stop All, Resume All, Delete All Stopped items to the existing `SessionGroup` dropdown. Add a right-click context menu on the group header row.
  **Files**: Modify `src/components/fleet/session-group.tsx`
  **Details**:
  - **New props on `SessionGroup`**: Add callbacks for the new bulk actions. These callbacks will be passed from `page.tsx`:
    ```ts
    onStopAll?: (sessions: { sessionId: string; instanceId: string }[]) => void;
    onResumeAll?: (sessionIds: string[]) => void;
    onDeleteAllStopped?: (sessions: { sessionId: string; instanceId: string }[]) => void;
    ```
  - **Compute counts** inside the component:
    ```ts
    const runningSessions = group.sessions.filter(s => s.lifecycleStatus === "running");
    const stoppedSessions = group.sessions.filter(s => 
      s.lifecycleStatus === "stopped" || s.lifecycleStatus === "completed" || s.lifecycleStatus === "disconnected"
    );
    ```
  - **Dropdown menu** (L134–174): Insert new items before "Terminate All":
    - `Stop All` — `Square` icon, disabled when `runningSessions.length === 0`, calls `onStopAll(runningSessions.map(s => ({ sessionId: s.session.id, instanceId: s.instanceId })))`. Label: `"Stop All (N)"`.
    - `Resume All` — `Play` icon, disabled when `stoppedSessions.length === 0`, calls `onResumeAll(stoppedSessions.map(s => s.session.id))`. Label: `"Resume All (N)"`.
    - `Delete All Stopped` — `Trash2` icon, disabled when `stoppedSessions.length === 0`, destructive variant, calls `onDeleteAllStopped(stoppedSessions.map(s => ({ sessionId: s.session.id, instanceId: s.instanceId })))`. Label: `"Delete All Stopped (N)"`.
    - `DropdownMenuSeparator` before existing "Terminate All"
  - **Refactor `handleTerminateAll`**: Remove the inline `Promise.allSettled` logic (L78–84). Instead, call `onStopAll` and let `page.tsx` handle it through the batch hook. This removes the need for `SessionGroup` to have its own `useTerminateSession` hook import.
  - **Right-click context menu on group header**: Wrap the header `<div>` (L95) with `<ContextMenu>` + `<ContextMenuTrigger>`. The `<ContextMenuContent>` mirrors the dropdown items using `ContextMenuItem` equivalents. Include `OpenToolContextSubmenu` (already imported in scope via the open-tool-menu).
  **Acceptance**: Dropdown shows all items with correct counts. New items call parent callbacks. Right-click on header opens matching context menu. Existing "New Session" and "Open in..." still work.

- [ ] 6. Add toolbar-level "Bulk Actions" dropdown
  **What**: Add a "Bulk Actions" dropdown button to `FleetToolbar` that provides global operations across all visible sessions.
  **Files**: Modify `src/components/fleet/fleet-toolbar.tsx`
  **Details**:
  - **New props**:
    ```ts
    // Add to FleetToolbarProps:
    sessionCount?: number;  // total visible sessions
    onStopAll?: () => void;
    onResumeAllStopped?: () => void;
    onDeleteAllStopped?: () => void;
    runningCount?: number;
    stoppedCount?: number;
    ```
  - **Render**: After the Sort By dropdown (L128–149), add a new `DropdownMenu`:
    ```tsx
    {sessionCount > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" /> {/* or ListTodo, or MoreHorizontal */}
            Bulk Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onStopAll} disabled={!runningCount} ...>
            <Square .../> Stop All Sessions ({runningCount})
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onResumeAllStopped} disabled={!stoppedCount} ...>
            <Play .../> Resume All Stopped ({stoppedCount})
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDeleteAllStopped} disabled={!stoppedCount} variant="destructive" ...>
            <Trash2 .../> Delete All Stopped ({stoppedCount})
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )}
    ```
  - Import `Square`, `Play`, `Trash2` from lucide-react.
  **Acceptance**: Toolbar shows "Bulk Actions" dropdown when sessions exist. Items show correct counts. Items call parent callbacks.

- [ ] 7. Wire everything up in `page.tsx`
  **What**: Connect the batch hook, confirmation dialog state, and new callbacks in the page-level orchestrator.
  **Files**: Modify `src/app/page.tsx`
  **Details**:
  - **Import** `useBatchSessionActions`, `BulkConfirmDialog`, and `SessionContextMenu` (if helper component approach is used).
  - **Add batch hook**: `const { batchTerminate, batchResume, batchDelete, progress, reset } = useBatchSessionActions();`
  - **Add bulk confirm state**:
    ```ts
    const [bulkAction, setBulkAction] = useState<{
      type: "stop" | "resume" | "delete";
      title: string;
      description: string;
      confirmLabel: string;
      variant: "default" | "destructive";
      targets: { sessionId: string; instanceId: string }[] | string[];
    } | null>(null);
    ```
  - **Create bulk action handlers** (these set the confirm state, not execute immediately):
    - `handleBulkStopRequest(sessions)` — sets `bulkAction` with type "stop", description "This will terminate N running sessions. Continue?"
    - `handleBulkResumeRequest(sessionIds)` — sets `bulkAction` with type "resume", description "This will resume N stopped sessions."
    - `handleBulkDeleteRequest(sessions)` — sets `bulkAction` with type "delete", description "This will permanently delete N sessions. This cannot be undone."
  - **Create `handleBulkConfirm`** — reads `bulkAction.type`, calls the appropriate batch function, then calls `refetch()`.
  - **Compute global counts** for the toolbar:
    ```ts
    const globalRunning = searchFiltered.filter(s => s.lifecycleStatus === "running");
    const globalStopped = searchFiltered.filter(s => ["stopped", "completed", "disconnected"].includes(s.lifecycleStatus));
    ```
  - **Pass to `FleetToolbar`**: `sessionCount`, `runningCount`, `stoppedCount`, `onStopAll`, `onResumeAllStopped`, `onDeleteAllStopped`.
  - **Pass to `SessionGroup`**: `onStopAll`, `onResumeAll`, `onDeleteAllStopped`.
  - **For toolbar bulk actions**: The `onStopAll` callback computes `globalRunning` sessions and calls `handleBulkStopRequest`. Similarly for others.
  - **For group bulk actions**: The `onStopAll` callback receives the specific sessions from the group.
  - **Render `BulkConfirmDialog`** alongside the existing `ConfirmDeleteSessionDialog`:
    ```tsx
    <BulkConfirmDialog
      open={!!bulkAction}
      onOpenChange={(open) => { if (!open) { setBulkAction(null); reset(); } }}
      title={bulkAction?.title ?? ""}
      description={bulkAction?.description ?? ""}
      confirmLabel={bulkAction?.confirmLabel ?? "Confirm"}
      variant={bulkAction?.variant ?? "default"}
      onConfirm={handleBulkConfirm}
      progress={progress}
    />
    ```
  - **`SessionCardWithMenu` helper** (local to page.tsx): A small component that wraps each `LiveSessionCard` with `ContextMenu` + `SessionContextMenu`. Takes the same props as `LiveSessionCard` plus `onOpenWith` for the full open callback. Use this in all 5 render paths to avoid repetition.
  **Acceptance**: All bulk action flows work end-to-end. Confirmation dialogs appear with correct counts. Progress shows during execution. Sessions refetch after completion.

- [ ] 8. Replace `window.confirm()` in `SidebarWorkspaceItem`
  **What**: Replace the `window.confirm()` call in `SidebarWorkspaceItem.handleTerminateAll` (L89) with an `AlertDialog`.
  **Files**: Modify `src/components/layout/sidebar-workspace-item.tsx`
  **Details**:
  - Add `useState` for `showTerminateAllConfirm`.
  - Change `handleTerminateAll` to just set `showTerminateAllConfirm = true`.
  - Create `handleTerminateAllConfirm` that does the actual `Promise.allSettled` (existing L93–96 logic).
  - Render a simple `AlertDialog` (reuse pattern from `ConfirmDeleteSessionDialog` or directly use `BulkConfirmDialog`):
    ```tsx
    <BulkConfirmDialog
      open={showTerminateAllConfirm}
      onOpenChange={setShowTerminateAllConfirm}
      title="Terminate All Sessions"
      description={`This will terminate all ${activeCount} active sessions in "${group.displayName}". Continue?`}
      confirmLabel="Terminate All"
      variant="destructive"
      onConfirm={handleTerminateAllConfirm}
    />
    ```
  - Note: `SidebarWorkspaceItem` has its own `useTerminateSession` hook and manages its own session operations. For now, keep the inline `Promise.allSettled` and just replace the confirm UI. Migrating to the batch hook is a follow-up.
  - The `ContextMenu` already wraps the entire `Collapsible` (L108–250) and is the root element returned by the component — it is NOT wrapped in a fragment. To render `BulkConfirmDialog` as a sibling, wrap the return in a React fragment `<>...</>`:
    ```tsx
    return (
      <>
        <ContextMenu>
          {/* existing ContextMenu content unchanged */}
        </ContextMenu>
        <BulkConfirmDialog
          open={showTerminateAllConfirm}
          onOpenChange={setShowTerminateAllConfirm}
          ...
        />
      </>
    );
    ```
    This matches how `SidebarSessionItem` renders `ConfirmDeleteSessionDialog` outside its `ContextMenu` (L220–226).
  **Acceptance**: No `window.confirm()` calls remain in the file. Terminate All shows an AlertDialog. Existing behavior is preserved.

- [ ] 9. Remove `handleTerminateAll` inline logic from `SessionGroup`
  **What**: Now that `SessionGroup` receives `onStopAll` from the parent, remove its internal `useTerminateSession` hook and `handleTerminateAll` callback. The existing "Terminate All" dropdown item should call `onStopAll` instead.
  **Files**: Modify `src/components/fleet/session-group.tsx`
  **Details**:
  - Remove `import { useTerminateSession }` (L24).
  - Remove `const { terminateSession } = useTerminateSession()` (L47).
  - Remove `handleTerminateAll` callback (L78–84).
  - Change "Terminate All" `DropdownMenuItem` (L165–172) to call `onStopAll?.(runningSessions.map(...))` where `runningSessions` is the same filter already computed for the new items.
  - This means `SessionGroup` no longer owns session mutation logic — it's all delegated to the parent page. This is cleaner and matches how `onTerminate`, `onResume`, `onDelete` already work.
  **Acceptance**: `SessionGroup` no longer imports or uses `useTerminateSession`. "Terminate All" calls `onStopAll` prop. Build succeeds.

## Implementation Order

The tasks have the following dependency graph:

```
Task 1 (batch hook)  ──────┐
Task 2 (bulk dialog) ──────┤
Task 3 (context menu items)─┼──> Task 4 (card context menu) ──> Task 7 (wire up page.tsx)
                            │                                         │
                            └──> Task 5 (group dropdown) ─────────────┤
                                 Task 6 (toolbar dropdown) ───────────┘
                                                                      │
                                 Task 8 (sidebar confirm) ────────────┘ (independent, can parallel)
                                 Task 9 (refactor SessionGroup) ──────┘ (after Task 5)
```

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 → 9 → 7 → 8

Tasks 1, 2, 3 have no dependencies on each other and can be done in parallel.
Task 8 is independent and can be done at any point after Task 2.
Task 9 should be done after Task 5 (which adds the new items) and before Task 7 (which wires up the parent callbacks).

## Potential Pitfalls

1. **ContextMenu + Link interaction**: Right-click on a `<Link>` inside `ContextMenuTrigger asChild` will open the custom menu. This is proven in `SidebarSessionItem`. However, the card's `<div className="relative group">` wrapper (not the `<Link>`) should be the trigger target. This means `ContextMenuTrigger asChild` wraps the outer `<div>`, which contains the `<Link>` — the browser's native right-click on the link is intercepted by Radix.

2. **Grid layout with ContextMenu wrapper**: Session cards render in CSS grid (`grid gap-4 sm:grid-cols-2 ...`). Adding a `ContextMenu` wrapper `<div>` inside grid items with `className="contents"` will need to be adjusted — the `ContextMenu` root renders no DOM element (it's a React context provider), but `ContextMenuTrigger` will. Use `ContextMenuTrigger asChild` on the existing container div to avoid adding extra DOM nodes.

3. **Batch resume navigates away**: The current `handleResume` in `page.tsx` (L78–88) navigates to the resumed session. For batch resume, we should NOT navigate — just resume in place and refetch. The batch hook's `resumeOne` function should call the resume API without navigation.

4. **Progress state stale closure**: In the batch hook, updating progress via `setState` inside `Promise.allSettled` callbacks can hit stale closure issues. Use `setState(prev => ({ ...prev, completed: prev.completed + 1 }))` functional updates.

5. **Concurrent batch operations**: If a user triggers Stop All while a Delete All is in progress, the progress state will be corrupted. Guard against this by disabling bulk action buttons when `progress.inProgress` is true, and/or keeping a `currentOperation` discriminant.

## Verification
- [ ] Right-click on session card shows context menu with correct items
- [ ] Right-click on group header shows context menu matching dropdown
- [ ] Group dropdown shows Stop All, Resume All, Delete All Stopped with counts
- [ ] Toolbar "Bulk Actions" dropdown appears when sessions exist
- [ ] All destructive bulk operations show AlertDialog confirmation
- [ ] Progress indicator shows during batch operations (visible in confirm dialog button)
- [ ] After bulk operation completes, session list refreshes
- [ ] Existing hover buttons on cards still work
- [ ] Left-click on card still navigates to session detail
- [ ] No `window.confirm()` calls remain in the codebase
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` passes
