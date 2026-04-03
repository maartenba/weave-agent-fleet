# Session Tree Features — Collapse, Filter, Remove Inactive

## TL;DR
> **Summary**: Add collapsible workspace groups to the sidebar tree, a toggle to show/hide inactive sessions, and a "Remove all inactive" action with confirmation dialog. Update documentation.
> **Estimated Effort**: Medium

## Context
### Original Request
Four features for the sidebar session tree:
1. Collapse/expand for workspace groups (mirroring the fleet page pattern)
2. Filter toggle to hide inactive sessions (completed/stopped/error)
3. "Remove all inactive" action with confirmation dialog
4. Documentation updates in README.md and `.weave/docs/`

### Key Findings

1. **Fleet page collapse pattern is the exact template** — `session-group.tsx` (L51–67) uses `usePersistedState<string[]>("weave:fleet:collapsed", [])` to track collapsed workspace IDs. The Collapsible/CollapsibleTrigger/CollapsibleContent Radix primitives are already installed (`src/components/ui/collapsible.tsx`). The chevron rotates 90° when open via `cn("size-3.5 transition-transform duration-150", !isCollapsed && "rotate-90")`.

2. **Sidebar workspace item currently shows sessions unconditionally** — `sidebar-workspace-item.tsx` L158–178 renders the session list in a `<div role="group">` with no collapse logic. The workspace row (L114–156) has a `<Link>` for navigation and an `InlineEdit` for rename. The collapse chevron needs to be added to the left of the display name.

3. **`usePersistedState` is battle-tested** — used in `session-group.tsx` for collapse and `sidebar-workspace-item.tsx` for pinned IDs. It's built on `useSyncExternalStore` with cross-component reactivity via a subscriber registry. Using a separate localStorage key for sidebar collapse (`weave:sidebar:collapsed`) vs fleet collapse (`weave:fleet:collapsed`) lets them be independent.

4. **Lifecycle statuses are well-defined** — `SessionLifecycleStatus` in `types.ts` (L36–41): `"running" | "completed" | "stopped" | "error" | "disconnected"`. The inactive set is `["completed", "stopped", "error"]`. `"disconnected"` is ambiguous — the fleet page's `live-session-card.tsx` treats it as inactive (`isInactive = isDisconnected || isStopped || isCompleted`), and the sidebar's terminate-all handler already excludes disconnected from active (L84). For this filter, we should treat `"disconnected"` as **inactive** to match the fleet page pattern.

5. **Delete session hook exists** — `use-delete-session.ts` provides `deleteSession(sessionId, instanceId)`. For bulk deletion, we need to call it in a `Promise.allSettled` loop (same pattern as existing `handleTerminateAll`). The `ConfirmDeleteSessionDialog` is the reference for `AlertDialog` usage.

6. **Fleet panel layout** — `fleet-panel.tsx` renders: Fleet header row → workspace tree. The filter toggle and "Remove all inactive" button fit naturally in the Fleet header row (L93–131), between the "Fleet" link and the "New Session" button.

7. **Keyboard navigation** — `fleet-panel.tsx` handles `ArrowRight` to expand into children and `ArrowLeft` to jump back to parent. The collapse feature should integrate: `ArrowRight` on a collapsed workspace should expand it; `ArrowLeft` on an expanded workspace should collapse it.

8. **Session count in workspace** — The fleet page shows a `<Badge>` with session count. The sidebar currently doesn't. Adding a count badge is out of scope but the collapse feature should visually indicate there are hidden items (the chevron rotation is sufficient).

9. **No toggle component exists** — There's no `toggle.tsx` in the UI components. The filter should use a small icon button (ghost variant) rather than a toggle switch. Use `Eye`/`EyeOff` from lucide-react for show/hide semantics.

10. **Context menu already has "Terminate All"** — `sidebar-workspace-item.tsx` L210–217. "Remove all inactive" is a different action (permanent delete, not terminate). It should be added to the workspace context menu and also as a global action in the fleet header.

## Objectives
### Core Objective
Make the sidebar tree manageable when there are many workspaces and sessions by adding collapse, filter, and cleanup capabilities.

### Deliverables
- [x] Collapsible workspace groups in the sidebar with persisted state
- [x] Inactive session filter toggle with persisted state
- [x] "Remove all inactive" action with AlertDialog confirmation
- [x] Updated README.md and `.weave/docs/project-overview.md`

### Definition of Done
- [x] Clicking the chevron on a sidebar workspace group collapses/expands its sessions
- [x] Collapse state persists across page reloads (via `usePersistedState`)
- [x] A filter button in the sidebar header hides/shows inactive sessions
- [x] Filter state persists across page reloads
- [x] "Remove all inactive" action deletes all completed/stopped/error/disconnected sessions after confirmation
- [x] All existing keyboard navigation still works
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `bun run test` passes (no regressions)

### Guardrails (Must NOT)
- Do NOT change the fleet page collapse behavior (it uses its own key `weave:fleet:collapsed`)
- Do NOT change session list API responses or backend
- Do NOT remove the pinned workspace feature
- Do NOT filter sessions from the fleet page — only the sidebar
- Do NOT auto-collapse workspaces — all should be expanded by default (empty default array `[]`)

## TODOs

- [x] 1. **Define shared inactive status constants**
  **What**: Create a shared constant for inactive lifecycle statuses to avoid duplicating the list across components. Add a helper function `isInactiveSession(item: SessionListItem): boolean`.
  **Files**: `src/lib/session-utils.ts`
  **Details**:
  - Add at the top of the file:
    ```ts
    /** Lifecycle statuses considered "inactive" — the session is no longer running. */
    export const INACTIVE_LIFECYCLE_STATUSES: SessionLifecycleStatus[] = [
      "completed", "stopped", "error", "disconnected",
    ] as const;

    /** Returns true if a session is in an inactive lifecycle state. */
    export function isInactiveSession(item: SessionListItem): boolean {
      return (INACTIVE_LIFECYCLE_STATUSES as readonly string[]).includes(item.lifecycleStatus);
    }
    ```
  - Import `SessionLifecycleStatus` from `@/lib/types` and `SessionListItem` from `@/lib/api-types`
  **Acceptance**: `bun run typecheck` passes. The constants are importable from `session-utils`.

- [x] 2. **Add collapse/expand to `sidebar-workspace-item.tsx`**
  **What**: Wrap the session list in a `Collapsible` component with a chevron toggle, following the `session-group.tsx` pattern exactly. Use a separate localStorage key from the fleet page.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`
  **Details**:
  - Add imports:
    ```ts
    import { ChevronRight } from "lucide-react";
    import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
    ```
  - Add persisted collapse state (alongside existing `PINNED_KEY`):
    ```ts
    const COLLAPSED_KEY = "weave:sidebar:collapsed";
    ```
  - Inside the component, add collapse state (after the existing `usePersistedState` for pinned):
    ```ts
    const [collapsedIds, setCollapsedIds] = usePersistedState<string[]>(COLLAPSED_KEY, []);
    const isCollapsed = collapsedIds.includes(group.workspaceId);

    const handleToggleCollapse = useCallback(
      (open: boolean) => {
        setCollapsedIds((prev) =>
          open
            ? prev.filter((id) => id !== group.workspaceId)
            : [...prev, group.workspaceId]
        );
      },
      [group.workspaceId, setCollapsedIds]
    );
    ```
  - Wrap the outer structure in `<Collapsible open={!isCollapsed} onOpenChange={handleToggleCollapse}>`. The workspace row div becomes the trigger area. **Important**: Only the chevron should trigger collapse — the workspace name link should still navigate. So use a separate `<CollapsibleTrigger asChild>` on just the chevron button, not the entire row.
  - Modify the workspace row (`<div className={cn("flex items-center gap-2 ...")}>`):
    - **Before** the `<Tooltip>` containing the display name link, insert a `CollapsibleTrigger`:
      ```tsx
      <CollapsibleTrigger asChild>
        <button
          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
          aria-label={isCollapsed ? `Expand ${group.displayName}` : `Collapse ${group.displayName}`}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform duration-150",
              !isCollapsed && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      ```
    - Adjust padding: currently `pl-3` on the workspace row. The chevron takes ~16px, so adjust to `pl-1` and let the chevron + gap provide the indent.
  - Wrap the session list div (L158–178, `<div className="space-y-0.5 mt-0.5" role="group">`) in `<CollapsibleContent>`:
    ```tsx
    <CollapsibleContent>
      <div className="space-y-0.5 mt-0.5" role="group">
        {nestSessions(group.sessions, { sort: true }).map(({ item, children }) => (
          // ... existing session rendering unchanged
        ))}
      </div>
    </CollapsibleContent>
    ```
  - The outermost fragment structure becomes: `<> <Collapsible open={!isCollapsed} onOpenChange={handleToggleCollapse}> <ContextMenu>...</ContextMenu> </Collapsible> <NewSessionDialog .../> </>`
  **Acceptance**: Clicking the chevron collapses/expands the session list. The workspace name link still navigates. Refreshing the page preserves collapse state. The `role="treeitem"` on the workspace div is preserved.

- [x] 3. **Update keyboard navigation for collapse**
  **What**: Modify the `ArrowRight`/`ArrowLeft` keyboard handlers in `fleet-panel.tsx` to support expand/collapse of workspace groups. When a workspace `treeitem` is focused: `ArrowRight` should expand it (if collapsed) or move to first child; `ArrowLeft` should collapse it (if expanded) or do nothing.
  **Files**: `src/components/layout/fleet-panel.tsx`
  **Details**:
  - The challenge: `fleet-panel.tsx` handles keyboard events but doesn't have direct access to collapse state (that lives in `sidebar-workspace-item.tsx`). Two approaches:
    - **Option A (data attributes)**: Have `sidebar-workspace-item.tsx` set `data-collapsed="true"/"false"` on the `treeitem` div. In `fleet-panel.tsx`, check `focused.dataset.collapsed` and programmatically click the `CollapsibleTrigger` button (query `[data-slot="collapsible-trigger"]` within the focused element).
    - **Option B (simpler)**: Let the `ArrowRight`/`ArrowLeft` on a treeitem simulate a click on the collapsible trigger within that treeitem. If the workspace is collapsed, `ArrowRight` clicks the trigger to expand. If expanded, `ArrowLeft` clicks it to collapse.
  - Go with **Option A** for robustness:
    - In `sidebar-workspace-item.tsx`, add `data-collapsed={isCollapsed ? "true" : "false"}` to the `<div role="treeitem">` element.
    - In `fleet-panel.tsx`, update `ArrowRight`:
      ```ts
      case "ArrowRight": {
        e.preventDefault();
        if (focused?.getAttribute("role") === "treeitem") {
          const isCollapsed = focused.dataset.collapsed === "true";
          if (isCollapsed) {
            // Expand the group
            const trigger = focused.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
            trigger?.click();
          } else {
            // Move to first child
            const next = items[currentIndex + 1];
            next?.focus();
          }
        }
        break;
      }
      ```
    - Update `ArrowLeft`:
      ```ts
      case "ArrowLeft": {
        e.preventDefault();
        if (focused?.getAttribute("data-tree-leaf") !== undefined) {
          // On a session leaf — find parent treeitem
          // Walk backwards to find the closest treeitem
          for (let i = currentIndex - 1; i >= 0; i--) {
            if (items[i]?.getAttribute("role") === "treeitem") {
              items[i]?.focus();
              break;
            }
          }
        } else if (focused?.getAttribute("role") === "treeitem") {
          const isCollapsed = focused.dataset.collapsed === "true";
          if (!isCollapsed) {
            // Collapse the group
            const trigger = focused.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
            trigger?.click();
          }
        }
        break;
      }
      ```
  **Acceptance**: With keyboard focus on a workspace: `ArrowRight` expands if collapsed, moves to first session if expanded. `ArrowLeft` collapses if expanded. On a session: `ArrowLeft` navigates to parent workspace.

- [x] 4. **Add inactive session filter to fleet panel**
  **What**: Add a toggle button in the fleet panel header that shows/hides inactive sessions. Use `usePersistedState` to remember the preference. Pass the filter state down so `sidebar-workspace-item.tsx` can filter its sessions.
  **Files**: `src/components/layout/fleet-panel.tsx`, `src/components/layout/sidebar-workspace-item.tsx`
  **Details**:
  - In `fleet-panel.tsx`:
    - Add imports:
      ```ts
      import { Eye, EyeOff } from "lucide-react";
      import { usePersistedState } from "@/hooks/use-persisted-state";
      ```
    - Add state:
      ```ts
      const HIDE_INACTIVE_KEY = "weave:sidebar:hideInactive";
      // ...inside component:
      const [hideInactive, setHideInactive] = usePersistedState<boolean>(HIDE_INACTIVE_KEY, false);
      ```
    - Add toggle button in the fleet header row, between the Fleet link and the New Session button:
      ```tsx
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setHideInactive((prev) => !prev)}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
            aria-label={hideInactive ? "Show inactive sessions" : "Hide inactive sessions"}
            aria-pressed={hideInactive}
          >
            {hideInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {hideInactive ? "Show inactive sessions" : "Hide inactive sessions"}
        </TooltipContent>
      </Tooltip>
      ```
    - Pass `hideInactive` to `SidebarWorkspaceItem`:
      ```tsx
      <SidebarWorkspaceItem
        key={group.workspaceDirectory}
        group={group}
        activeSessionPath={pathname}
        refetch={refetch}
        hideInactive={hideInactive}
      />
      ```
    - **Important**: When `hideInactive` is true, workspaces that have ZERO visible sessions after filtering should be hidden entirely. Filter `workspaces` before rendering:
      ```ts
      const visibleWorkspaces = hideInactive
        ? workspaces.filter((g) => g.sessions.some((s) => !isInactiveSession(s)))
        : workspaces;
      ```
      Import `isInactiveSession` from `@/lib/session-utils`.
  - In `sidebar-workspace-item.tsx`:
    - Add `hideInactive: boolean` to `SidebarWorkspaceItemProps`
    - Import `isInactiveSession` from `@/lib/session-utils`
    - Filter sessions before passing to `nestSessions`:
      ```ts
      const visibleSessions = hideInactive
        ? group.sessions.filter((s) => !isInactiveSession(s))
        : group.sessions;
      ```
    - Replace `group.sessions` with `visibleSessions` in the `nestSessions(...)` call on L160
    - Also filter children in the nested rendering — `nestSessions` handles parent-child nesting, but if a child is inactive it should be hidden too. The simplest approach: filter the flat list before nesting. Since `nestSessions` builds parent→child from the input list, filtering inactive items from the input means inactive children won't appear either. **However**, if a parent is inactive but has active children, both parent and children should be hidden (the parent acts as the container). This is the correct behavior since filtering happens at the flat list level before nesting.
  **Acceptance**: Clicking the eye icon toggles inactive sessions. The icon changes between Eye and EyeOff. Empty workspaces (all sessions inactive) disappear when filter is on. Preference persists across reloads.

- [x] 5. **Add "Remove all inactive" action to fleet panel**
  **What**: Add a trash-can button in the fleet header (or a dropdown action) that deletes all inactive sessions across all workspaces after showing a confirmation dialog.
  **Files**: `src/components/layout/fleet-panel.tsx`
  **Details**:
  - Add imports:
    ```ts
    import { Trash2, Loader2 } from "lucide-react";
    import { useState, useCallback } from "react"; // extend existing import
    import { useDeleteSession } from "@/hooks/use-delete-session";
    import { isInactiveSession } from "@/lib/session-utils";
    import {
      AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
      AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    } from "@/components/ui/alert-dialog";
    ```
  - Add state and handler inside the component:
    ```ts
    const { deleteSession } = useDeleteSession();
    const [showRemoveInactiveConfirm, setShowRemoveInactiveConfirm] = useState(false);
    const [isRemovingInactive, setIsRemovingInactive] = useState(false);

    const inactiveSessions = sessions.filter(isInactiveSession);

    const handleRemoveAllInactive = useCallback(async () => {
      setIsRemovingInactive(true);
      try {
        await Promise.allSettled(
          inactiveSessions.map((s) => deleteSession(s.session.id, s.instanceId))
        );
        refetch();
      } finally {
        setIsRemovingInactive(false);
        setShowRemoveInactiveConfirm(false);
      }
    }, [inactiveSessions, deleteSession, refetch]);
    ```
  - Add the button in the fleet header row, next to the filter toggle (only visible when inactive sessions exist):
    ```tsx
    {inactiveSessions.length > 0 && (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setShowRemoveInactiveConfirm(true)}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-destructive transition-colors"
            aria-label={`Remove ${inactiveSessions.length} inactive session${inactiveSessions.length !== 1 ? "s" : ""}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Remove {inactiveSessions.length} inactive session{inactiveSessions.length !== 1 ? "s" : ""}
        </TooltipContent>
      </Tooltip>
    )}
    ```
  - Add the confirmation dialog at the bottom of the component return (outside `<nav>`), following the `ConfirmDeleteSessionDialog` pattern:
    ```tsx
    <AlertDialog open={showRemoveInactiveConfirm} onOpenChange={setShowRemoveInactiveConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Inactive Sessions</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete {inactiveSessions.length} inactive session{inactiveSessions.length !== 1 ? "s" : ""} (completed, stopped, errored, or disconnected). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemovingInactive}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isRemovingInactive}
            onClick={(e) => {
              e.preventDefault();
              handleRemoveAllInactive();
            }}
          >
            {isRemovingInactive ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Removing…
              </>
            ) : (
              `Remove ${inactiveSessions.length} Session${inactiveSessions.length !== 1 ? "s" : ""}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    ```
  - **Structural note**: The current `FleetPanel` returns a single `<nav>`. Wrap in a fragment `<>` to add the dialog alongside it: `<><nav>...</nav><AlertDialog>...</AlertDialog></>`.
  **Acceptance**: The trash icon appears only when inactive sessions exist. Clicking it shows a confirmation dialog with the count. Confirming deletes all inactive sessions. The button shows a spinner during deletion. After deletion, the list updates (via refetch). Cancelling dismisses the dialog without action.

- [x] 6. **Add "Remove inactive" to workspace context menu**
  **What**: Add a "Remove Inactive" option to each workspace's right-click context menu, to remove inactive sessions within just that workspace.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`
  **Details**:
  - Add imports:
    ```ts
    import { Loader2 } from "lucide-react";
    import { useDeleteSession } from "@/hooks/use-delete-session";
    import { isInactiveSession } from "@/lib/session-utils";
    import {
      AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
      AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    } from "@/components/ui/alert-dialog";
    ```
  - Add state:
    ```ts
    const { deleteSession } = useDeleteSession();
    const [showRemoveInactiveConfirm, setShowRemoveInactiveConfirm] = useState(false);
    const [isRemovingInactive, setIsRemovingInactive] = useState(false);

    const inactiveInWorkspace = group.sessions.filter(isInactiveSession);
    ```
  - Add handler:
    ```ts
    const handleRemoveInactive = useCallback(async () => {
      setIsRemovingInactive(true);
      try {
        await Promise.allSettled(
          inactiveInWorkspace.map((s) => deleteSession(s.session.id, s.instanceId))
        );
        refetch();
      } finally {
        setIsRemovingInactive(false);
        setShowRemoveInactiveConfirm(false);
      }
    }, [inactiveInWorkspace, deleteSession, refetch]);
    ```
  - Add context menu item between "Terminate All" and the separator above it (around L209):
    ```tsx
    {inactiveInWorkspace.length > 0 && (
      <ContextMenuItem
        onClick={() => setShowRemoveInactiveConfirm(true)}
        variant="destructive"
        className="gap-2 text-xs"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove {inactiveInWorkspace.length} Inactive
      </ContextMenuItem>
    )}
    ```
  - Add the AlertDialog alongside the existing `NewSessionDialog` at the bottom of the component return.
  **Acceptance**: Right-clicking a workspace that has inactive sessions shows "Remove N Inactive" in the context menu. Clicking it shows a confirmation dialog. Confirming deletes just that workspace's inactive sessions.

- [x] 7. **Update README.md**
  **What**: Add documentation for the new sidebar features in the Features section.
  **Files**: `README.md`
  **Details**:
  - In the `## Features` section, after `### Session Management`, add a new subsection:
    ```markdown
    ### Sidebar Navigation

    The sidebar provides a tree view of all workspaces and sessions:

    | Feature | Description |
    | :--- | :--- |
    | **Collapse/Expand** | Click the chevron next to a workspace to collapse or expand its sessions. State persists across reloads. |
    | **Hide Inactive** | Toggle the eye icon in the sidebar header to hide completed, stopped, errored, and disconnected sessions. |
    | **Remove Inactive** | Click the trash icon to permanently delete all inactive sessions, or right-click a workspace to remove only its inactive sessions. |
    | **Pin Workspaces** | Right-click a workspace to pin it to the top of the list. |
    | **Rename** | Right-click a workspace or session to rename it, or press F2. |
    ```
  - Update the Table of Contents to include `- [Sidebar Navigation](#sidebar-navigation)` after `- [Session Management](#session-management)`.
  **Acceptance**: README reflects the new features. Markdown renders correctly.

- [x] 8. **Update `.weave/docs/project-overview.md`**
  **What**: Mention the new sidebar features in the project overview.
  **Files**: `.weave/docs/project-overview.md`
  **Details**:
  - In the `## Pages & Routes` section, update the `/` route description or add a note:
    ```markdown
    ### Sidebar
    The sidebar session tree supports collapsible workspace groups, an inactive session filter (persisted to localStorage), and bulk removal of inactive sessions. Keyboard navigation (Arrow keys) integrates with collapse: ArrowRight expands, ArrowLeft collapses.
    ```
  **Acceptance**: The project overview accurately describes the sidebar capabilities.

## Verification
- [x] All tests pass: `bun run test`
- [x] No type errors: `bun run typecheck`
- [x] No lint errors: `bun run lint`
- [x] No regressions: manual verification that existing sidebar features (rename, pin, terminate all, context menu, keyboard navigation, new session dialog) still work
- [x] Collapse state survives page reload
- [x] Filter state survives page reload
- [x] Keyboard nav works: ArrowRight expands collapsed workspace, ArrowLeft collapses expanded workspace
- [x] "Remove all inactive" shows confirmation, deletes on confirm, cancels on cancel
- [x] Empty workspaces hidden when filter is active
