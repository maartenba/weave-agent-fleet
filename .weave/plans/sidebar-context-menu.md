# Sidebar Session Context Menu

## TL;DR
> **Summary**: Expand the existing right-click context menu on sidebar session items to include Stop, Abort, Delete, Resume, and Copy Session ID actions — eliminating the need to navigate to a session detail page for common lifecycle operations.
> **Estimated Effort**: Short

## Context
### Original Request
Add a right-click context menu to each session item in the left sidebar with actions like Stop (only if running), Delete, etc. Currently users must click into a session and then find stop/delete buttons in the detail view header.

### Key Findings
1. **Context menu already exists** — `sidebar-session-item.tsx` (lines 64–114) already wraps the session link in a `<ContextMenu>` from Radix UI with a single "Rename" action. We just need to add more items to `<ContextMenuContent>`.
2. **All hooks already exist**:
   - `useTerminateSession` — `src/hooks/use-terminate-session.ts` — calls `DELETE /api/sessions/[id]?instanceId=...`
   - `useDeleteSession` — `src/hooks/use-delete-session.ts` — calls `DELETE /api/sessions/[id]?instanceId=...&permanent=true`
   - `useAbortSession` — `src/hooks/use-abort-session.ts` — calls `POST /api/sessions/[id]/abort?instanceId=...`
   - `useResumeSession` — `src/hooks/use-resume-session.ts` — calls `POST /api/sessions/[id]/resume`
3. **Delete confirmation dialog exists** — `ConfirmDeleteSessionDialog` at `src/components/fleet/confirm-delete-session-dialog.tsx` is a reusable Radix AlertDialog component already used by both the fleet page and session detail page.
4. **Workspace context menu is the gold standard** — `sidebar-workspace-item.tsx` (lines 216–249) already demonstrates the full pattern: rename, pin, separator, new session, terminate all (destructive). We mirror this style.
5. **UI primitives available** — `ContextMenuSeparator`, `ContextMenuItem` with `variant="destructive"`, and `ContextMenuShortcut` are all exported from `src/components/ui/context-menu.tsx`.
6. **Session state is already available** — `item.lifecycleStatus` and `item.activityStatus` are on the `SessionListItem` prop, so conditional rendering is trivial.
7. **Clipboard pattern exists** — `navigator.clipboard.writeText()` is used in several components already.

## Objectives
### Core Objective
Give users quick access to session lifecycle actions (stop, abort, delete, resume, copy ID) directly from the sidebar context menu, matching the established workspace context menu pattern.

### Deliverables
- [ ] Extended context menu on `SidebarSessionItem` with all actions
- [ ] Delete confirmation dialog integrated at the sidebar level
- [ ] Conditional visibility of actions based on session lifecycle/activity status

### Definition of Done
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] Right-click on a running session shows: Rename, separator, Abort (if busy), Stop, separator, Copy Session ID, separator, Delete
- [ ] Right-click on a stopped/completed session shows: Rename, separator, Resume, separator, Copy Session ID, separator, Delete
- [ ] Right-click on a disconnected session shows: Rename, separator, Resume, separator, Copy Session ID, separator, Delete
- [ ] "Delete" shows the `ConfirmDeleteSessionDialog` before proceeding
- [ ] "Stop" triggers `terminateSession` and calls `refetch()`
- [ ] "Abort" triggers `abortSession` (interrupt, does not kill the session)
- [ ] "Copy Session ID" copies `session.id` to clipboard

### Guardrails (Must NOT)
- Do NOT add hooks at the sidebar root level — keep them scoped to `SidebarSessionItem` (each item manages its own state, same as workspace items)
- Do NOT change the visual appearance of the session item itself (link, status dot, etc.)
- Do NOT add actions that don't have existing API support
- Do NOT remove the existing "Rename" action

## TODOs

- [ ] 1. **Add hooks and state to `SidebarSessionItem`**
  **What**: Import and wire up `useTerminateSession`, `useAbortSession`, `useDeleteSession`, and `useResumeSession` hooks. Add state for the delete confirmation dialog (`showDeleteConfirm`). Import `useRouter` from `next/navigation` for navigation after resume.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details**:
  - Add imports at the top:
    ```
    import { useRouter } from "next/navigation";
    import { Pencil, Square, WifiOff, StopCircle, OctagonX, Trash2, Copy, Play } from "lucide-react";
    import { ContextMenuSeparator } from "@/components/ui/context-menu";
    import { ConfirmDeleteSessionDialog } from "@/components/fleet/confirm-delete-session-dialog";
    import { useTerminateSession } from "@/hooks/use-terminate-session";
    import { useAbortSession } from "@/hooks/use-abort-session";
    import { useDeleteSession } from "@/hooks/use-delete-session";
    import { useResumeSession } from "@/hooks/use-resume-session";
    ```
  - Inside the component body, add:
    ```
    const router = useRouter();
    const { terminateSession } = useTerminateSession();
    const { abortSession } = useAbortSession();
    const { deleteSession, isDeleting } = useDeleteSession();
    const { resumeSession } = useResumeSession();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    ```
  **Acceptance**: TypeScript compiles with no errors; hooks are wired up but not yet called from UI.

- [ ] 2. **Add action handler callbacks**
  **What**: Create `useCallback` handlers for each action, following the patterns in `page.tsx` (fleet) and `sidebar-workspace-item.tsx`.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details** — add these handlers inside the component, after the existing `handleRename`:
  ```typescript
  const isRunning = lifecycleStatus === "running";
  const canAbort = isRunning && activityStatus === "busy";
  const canStop = isRunning;
  const canResume = isStopped || isCompleted || isDisconnected;

  const handleStop = useCallback(async () => {
    try {
      await terminateSession(session.id, instanceId);
      refetch();
    } catch {
      // error surfaced inside useTerminateSession
    }
  }, [terminateSession, session.id, instanceId, refetch]);

  const handleAbort = useCallback(async () => {
    try {
      await abortSession(session.id, instanceId);
    } catch {
      // error surfaced inside useAbortSession
    }
  }, [abortSession, session.id, instanceId]);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      await deleteSession(session.id, instanceId);
      refetch();
    } catch {
      // error surfaced inside useDeleteSession
    } finally {
      setShowDeleteConfirm(false);
    }
  }, [deleteSession, session.id, instanceId, refetch]);

  const handleResume = useCallback(async () => {
    try {
      const result = await resumeSession(session.id);
      router.push(
        `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}`
      );
    } catch {
      // error surfaced inside useResumeSession
      refetch();
    }
  }, [resumeSession, session.id, router, refetch]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(session.id).catch(() => {});
  }, [session.id]);
  ```
  **Acceptance**: Handlers compile; no unused variable warnings.

- [ ] 3. **Expand the `ContextMenuContent` with conditional actions**
  **What**: Replace the single "Rename" menu item with the full set of context menu actions, conditionally rendered based on session state.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details** — replace lines 105–113 (the `<ContextMenuContent>` block) with:
  ```tsx
  <ContextMenuContent>
    {/* Always available */}
    <ContextMenuItem onClick={() => setIsRenaming(true)} className="gap-2 text-xs">
      <Pencil className="h-3.5 w-3.5" />
      Rename
    </ContextMenuItem>

    <ContextMenuSeparator />

    {/* Lifecycle actions — shown conditionally */}
    {canAbort && (
      <ContextMenuItem onClick={handleAbort} className="gap-2 text-xs">
        <OctagonX className="h-3.5 w-3.5" />
        Interrupt
      </ContextMenuItem>
    )}
    {canStop && (
      <ContextMenuItem onClick={handleStop} className="gap-2 text-xs">
        <StopCircle className="h-3.5 w-3.5" />
        Stop
      </ContextMenuItem>
    )}
    {canResume && (
      <ContextMenuItem onClick={handleResume} className="gap-2 text-xs">
        <Play className="h-3.5 w-3.5" />
        Resume
      </ContextMenuItem>
    )}

    <ContextMenuSeparator />

    {/* Utility */}
    <ContextMenuItem onClick={handleCopyId} className="gap-2 text-xs">
      <Copy className="h-3.5 w-3.5" />
      Copy Session ID
    </ContextMenuItem>

    <ContextMenuSeparator />

    {/* Destructive */}
    <ContextMenuItem
      onClick={() => setShowDeleteConfirm(true)}
      variant="destructive"
      className="gap-2 text-xs"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Delete
    </ContextMenuItem>
  </ContextMenuContent>
  ```
  **Acceptance**: Context menu renders with correct items for each session state.

- [ ] 4. **Add `ConfirmDeleteSessionDialog` to the component return**
  **What**: Render the delete confirmation dialog outside the `<ContextMenu>` so it works independently of the context menu's open/close state.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details**: Wrap the return value in a React Fragment (`<>...</>`) and add the dialog after the `</ContextMenu>`:
  ```tsx
  return (
    <>
      <ContextMenu>
        {/* ... existing content ... */}
      </ContextMenu>

      <ConfirmDeleteSessionDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        sessionTitle={title}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </>
  );
  ```
  **Acceptance**: Clicking "Delete" in context menu opens the confirmation dialog; confirming calls `deleteSession` and refetches; cancelling closes dialog.

- [ ] 5. **Clean up imports**
  **What**: Ensure only necessary lucide icons are imported; remove any unused imports from the original file. The `Square` import is already used for the stopped/completed connection icon so it stays.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details**: Final import block should be:
  ```typescript
  import React, { useState, useCallback } from "react";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { Copy, OctagonX, Pencil, Play, Square, StopCircle, Trash2, WifiOff } from "lucide-react";
  import { cn } from "@/lib/utils";
  import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
  } from "@/components/ui/context-menu";
  import { InlineEdit } from "@/components/ui/inline-edit";
  import { ConfirmDeleteSessionDialog } from "@/components/fleet/confirm-delete-session-dialog";
  import { useRenameSession } from "@/hooks/use-rename-session";
  import { useTerminateSession } from "@/hooks/use-terminate-session";
  import { useAbortSession } from "@/hooks/use-abort-session";
  import { useDeleteSession } from "@/hooks/use-delete-session";
  import { useResumeSession } from "@/hooks/use-resume-session";
  import type { SessionListItem } from "@/lib/api-types";
  ```
  **Acceptance**: `npm run lint` reports no unused import warnings for this file.

## Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes (no unused imports, no missing deps)
- [ ] Manual test: right-click a **running/busy** session → see Rename, Interrupt, Stop, Copy Session ID, Delete
- [ ] Manual test: right-click a **running/idle** session → see Rename, Stop, Copy Session ID, Delete (no Interrupt)
- [ ] Manual test: right-click a **stopped** session → see Rename, Resume, Copy Session ID, Delete (no Stop/Interrupt)
- [ ] Manual test: right-click a **disconnected** session → see Rename, Resume, Copy Session ID, Delete
- [ ] Manual test: "Delete" opens confirmation dialog, confirm deletes, cancel closes
- [ ] Manual test: "Stop" terminates the session and sidebar refreshes
- [ ] Manual test: "Resume" navigates to the resumed session
- [ ] Manual test: "Copy Session ID" copies to clipboard (verify via paste)
- [ ] No regressions: existing Rename functionality still works
- [ ] No regressions: workspace context menu still works
- [ ] Keyboard accessibility: context menu items are navigable with arrow keys (inherited from Radix)

## Notes
- **No new files needed** — this is a single-file change to `src/components/layout/sidebar-session-item.tsx` plus reuse of existing components.
- **Hook count per item**: Adding 4 hooks per `SidebarSessionItem` instance. Since hooks are lightweight (just `useState` internally) and sessions are typically < 50, this is fine. The hooks only make API calls when an action is triggered.
- **Separator handling**: If both `canAbort` and `canStop` are false and `canResume` is also false (unlikely but possible during transitions), the lifecycle section will be empty and we'll get two adjacent separators. This is a minor visual glitch that Radix handles gracefully (it collapses adjacent separators). If desired, wrap the lifecycle section + its separator in a conditional, but this is a cosmetic edge case.
