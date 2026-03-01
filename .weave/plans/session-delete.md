# Permanent Session Deletion

## TL;DR
> **Summary**: Add permanent deletion for sessions — removes the row from SQLite, cleans up related notifications, optionally cleans up workspace artifacts (worktree/clone), and provides a confirmation dialog in the UI to prevent accidental data loss.
> **Estimated Effort**: Medium

## Context

### Original Request
Sessions accumulate in the database forever. The existing "terminate" functionality (DELETE /api/sessions/[id]) aborts the session and updates the status to stopped/completed, but never removes the row. We need permanent deletion that removes the session from the DB entirely, cleans up related data, and provides appropriate UI affordances.

### Key Findings

1. **DB schema has no cascade deletes for notifications** — The `notifications` table has a `session_id TEXT` column (line 83, database.ts) but no `REFERENCES sessions(id)` FK constraint. Deletion of related notifications must be done manually in application code. The `sessions` table itself has FKs to `workspaces(id)` and `instances(id)`, but nothing references `sessions(id)` with cascading deletes.

2. **Existing terminate flow is well-structured** — `DELETE /api/sessions/[id]` (route.ts lines 86-175) follows a clear 4-step pattern: check other sessions on instance → abort via SDK → kill instance if last session → update DB status. Permanent delete can reuse terminate as a prerequisite step.

3. **Workspace cleanup already exists** — `cleanupWorkspace()` in workspace-manager.ts handles worktree removal (git worktree remove) and clone deletion (rmSync). The terminate handler already accepts `?cleanupWorkspace=true`. Permanent delete should always invoke this for non-"existing" strategies.

4. **No AlertDialog component yet** — The project has `dialog.tsx` (Radix Dialog) but no AlertDialog. Since `radix-ui@1.4.3` is installed, we can generate an AlertDialog component via `npx shadcn@latest add alert-dialog` to get the standard confirmation pattern.

5. **LiveSessionCard has conditional action buttons** — The card currently shows a terminate button for non-stopped/non-completed sessions (line 65: `canTerminate = !isStopped && !isCompleted`) and a resume button for inactive sessions. A permanent delete button should appear for stopped/completed/disconnected sessions.

6. **SessionGroup has a "Terminate All" dropdown action** — The workspace group header (session-group.tsx line 145-153) has a destructive "Terminate All" menu item. We should add a "Delete All Stopped" companion action.

7. **Session detail page has stop/resume controls** — `sessions/[id]/page.tsx` has terminate and resume handlers with a two-click confirmation pattern for stop (lines 135-148). We need to add a delete action here too, but use the AlertDialog for stronger confirmation.

8. **Test pattern is established** — `db-repository.test.ts` uses `WEAVE_DB_PATH` with tmpdir + `_resetDbForTests()`. The new `deleteSession()` function needs tests following this exact pattern.

9. **SessionsContext relies on polling refetch** — `sessions-context.tsx` uses `useSessions(5000)` for polling. After deletion, calling `refetch()` is sufficient to remove the session from the UI — no special removal logic needed in the context.

10. **Sidebar session items are read-only links** — `sidebar-session-item.tsx` is just a navigation link with a status dot. Adding a delete action here would require a right-click context menu or hover action. Defer this — the fleet page cards and session detail page are the primary deletion surfaces.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Terminate-then-delete** | Auto-terminate if active, then delete | Users shouldn't need two steps. If a session is active/idle, terminate it first automatically. If already stopped/completed/disconnected, just delete. |
| **Workspace cleanup** | Always clean up non-"existing" workspaces on permanent delete | Permanent = gone. No reason to keep orphaned worktrees/clones after the session record is deleted. |
| **API design** | Add `?permanent=true` query param to existing DELETE endpoint | Avoids a new route. The existing DELETE already handles terminate. Adding `permanent=true` extends it: terminate (if needed) + delete row + cleanup workspace. |
| **Confirmation UI** | AlertDialog component (Radix) | Stronger than the two-click pattern used for terminate. Permanent deletion is irreversible and warrants a proper modal confirmation. |
| **Batch delete** | Out of scope for V1 | Keep it simple. Single-session delete first. |
| **Sidebar delete** | Out of scope for V1 | The sidebar items are compact navigation links. Adding delete here adds complexity with minimal UX benefit — users can delete from the card or detail page. |
| **Notification cleanup** | Delete notifications with matching session_id | Orphaned notifications referencing a deleted session are confusing. Clean them up. |

## Objectives

### Core Objective
Enable permanent deletion of sessions from the database with proper cleanup of related data and workspace artifacts, guarded by a confirmation dialog.

### Deliverables
- [x] `deleteSession()` and `deleteNotificationsForSession()` functions in db-repository.ts
- [x] Extended DELETE handler with `?permanent=true` support in route.ts
- [x] `useDeleteSession` React hook
- [x] AlertDialog UI component (shadcn)
- [x] Confirmation dialog component for session deletion
- [x] Delete button on LiveSessionCard for inactive sessions
- [x] Delete action on session detail page
- [x] Unit tests for new db-repository functions

### Definition of Done
- [x] `npm run build` succeeds with zero errors
- [x] `npm run test` passes (including new tests)
- [x] `npm run lint` passes
- [x] Stopped/completed/disconnected sessions show a delete button on their card
- [x] Clicking delete shows a confirmation dialog
- [x] Confirming deletion removes the session from the DB, cleans up notifications, and cleans up workspace (for worktree/clone)
- [x] Deleting an active/idle session terminates it first, then permanently deletes
- [x] Session disappears from the fleet page after deletion

### Guardrails (Must NOT)
- Must NOT delete workspace directories for "existing" isolation strategy (the user's actual project directory)
- Must NOT auto-delete without user confirmation
- Must NOT break the existing terminate flow — `DELETE` without `?permanent=true` must behave exactly as before
- Must NOT leave orphaned notifications referencing a deleted session_id

## TODOs

- [x] 1. **Add `deleteSession()` and `deleteNotificationsForSession()` to db-repository.ts**
  **What**: Add two new synchronous functions to the database repository:
  - `deleteNotificationsForSession(sessionId: string): number` — Deletes all rows from `notifications` where `session_id = ?`. Returns the number of rows deleted (from `changes`).
  - `deleteSession(id: string): boolean` — Deletes the row from `sessions` where `id = ?`. Returns `true` if a row was deleted (changes > 0), `false` otherwise.
  
  Both functions follow the existing pattern of `getDb().prepare(...).run(...)`. Place `deleteNotificationsForSession` in the Notifications section and `deleteSession` in the Sessions section, after `updateSessionForResume`.
  
  **Files**: `src/lib/server/db-repository.ts`
  **Acceptance**: Functions exist, are exported, and follow the existing code style (sync, thin wrappers, no business logic).

- [x] 2. **Add unit tests for new db-repository functions**
  **What**: Add a new `describe("session deletion")` block in the existing test file with these test cases:
  - `DeletesSessionFromDatabase` — Insert a session, delete it, verify `getSession()` returns undefined.
  - `DeleteSessionReturnsTrueWhenRowDeleted` — Verify return value is `true` for an existing session.
  - `DeleteSessionReturnsFalseForNonexistentSession` — Verify return value is `false` for a missing ID.
  - `DeleteSessionDoesNotAffectOtherSessions` — Insert two sessions, delete one, verify the other remains.
  - `DeleteNotificationsForSessionRemovesMatchingNotifications` — Insert notifications with and without a session_id, delete for one session, verify only matching ones are removed.
  - `DeleteNotificationsForSessionReturnsDeletedCount` — Verify return count.
  - `DeleteNotificationsForSessionReturnsZeroWhenNoneMatch` — Verify return is 0 for a non-existent session_id.
  
  Import `deleteSession`, `deleteNotificationsForSession`, `insertNotification` in the test file's import block. Follow the existing test naming convention (PascalCase test names) and setup pattern.
  
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **Acceptance**: `npm run test -- src/lib/server/__tests__/db-repository.test.ts` passes with all new tests green.

- [x] 3. **Extend DELETE /api/sessions/[id] to support `?permanent=true`**
  **What**: Modify the existing `DELETE` handler in the session route to support a new `permanent` query parameter. When `permanent=true`:
  
  1. Look up the session in DB (existing step — reuse `resolvedDbId` and `workspaceId`).
  2. If the session is active/idle, run the existing terminate flow (abort → kill instance if last → update status). This reuses the exact existing code for steps 1-3.
  3. Delete notifications for the session: call `deleteNotificationsForSession(resolvedDbId)`.
  4. Delete the session row: call `deleteSession(resolvedDbId)`.
  5. Clean up workspace if non-"existing": look up workspace via `getWorkspace(workspaceId)`, check `isolation_strategy !== "existing"`, and if so call `cleanupWorkspace(workspaceId)`. Skip if workspace has other active sessions (check via a simple query or list sessions with same workspace_id).
  6. Return `{ message: "Session permanently deleted", sessionId, instanceId }` with status 200.
  
  When `permanent` is NOT set (or `false`), the handler behaves exactly as before — no behavior change.
  
  Add `deleteSession`, `deleteNotificationsForSession` to the imports from `db-repository`. Add `listSessions` or add a new helper `getSessionsForWorkspace(workspaceId)` to check if other sessions share the workspace before cleaning it up.
  
  **Files**: `src/app/api/sessions/[id]/route.ts`, `src/lib/server/db-repository.ts` (if adding `getSessionsForWorkspace`)
  **Acceptance**: 
  - `DELETE /api/sessions/abc?instanceId=xyz` works exactly as before (terminate only).
  - `DELETE /api/sessions/abc?instanceId=xyz&permanent=true` terminates if needed, then deletes from DB.
  - After permanent delete, `getSession(id)` returns `undefined`.

- [x] 4. **Add AlertDialog UI component**
  **What**: Generate the AlertDialog component using shadcn. Run:
  ```
  npx shadcn@latest add alert-dialog
  ```
  This creates `src/components/ui/alert-dialog.tsx` with Radix AlertDialog primitives (AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel).
  
  If the CLI doesn't work in the environment, manually create the component following the exact shadcn pattern used in the existing `dialog.tsx` but using `AlertDialog` from `radix-ui` (the project uses the monorepo `radix-ui` package).
  
  **Files**: `src/components/ui/alert-dialog.tsx`
  **Acceptance**: Component exists and exports all standard AlertDialog parts. Matches the project's existing Radix component style (using `radix-ui` import, `cn()` utility, `data-slot` attributes).

- [x] 5. **Create `useDeleteSession` hook**
  **What**: Create a new hook `src/hooks/use-delete-session.ts` that mirrors the pattern of `use-terminate-session.ts`. The hook should:
  - Export `UseDeleteSessionResult` interface with: `deleteSession(sessionId, instanceId) => Promise<void>`, `isDeleting: boolean`, `error?: string`.
  - Call `DELETE /api/sessions/${sessionId}?instanceId=${instanceId}&permanent=true`.
  - Manage loading/error state via `useState`.
  - Re-throw errors after setting state (matching the terminate hook pattern).
  
  The hook does NOT need `cleanupWorkspace` as a param — the server always cleans up non-"existing" workspaces on permanent delete.
  
  **Files**: `src/hooks/use-delete-session.ts`
  **Acceptance**: Hook compiles, follows the same pattern as `use-terminate-session.ts`, makes the correct API call with `permanent=true`.

- [x] 6. **Create `ConfirmDeleteSessionDialog` component**
  **What**: Create `src/components/fleet/confirm-delete-session-dialog.tsx` — a reusable AlertDialog for confirming permanent session deletion.
  
  Props:
  ```typescript
  interface ConfirmDeleteSessionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionTitle: string;
    onConfirm: () => void;
    isDeleting?: boolean;
  }
  ```
  
  Content:
  - Title: "Delete Session"
  - Description: `Are you sure you want to permanently delete "${sessionTitle}"? This will remove the session and all related data. This action cannot be undone.`
  - Cancel button (disabled when `isDeleting`)
  - Confirm button: "Delete" with destructive styling (disabled when `isDeleting`, show spinner when `isDeleting`)
  
  Use the AlertDialog components from step 4. Use `Loader2` for the spinner icon (already imported throughout the codebase).
  
  **Files**: `src/components/fleet/confirm-delete-session-dialog.tsx`
  **Acceptance**: Component renders a proper confirmation dialog. Cancel closes the dialog. Confirm calls `onConfirm`. Loading state disables buttons.

- [x] 7. **Add delete button to LiveSessionCard for inactive sessions**
  **What**: Modify `LiveSessionCard` to show a permanent delete button for stopped/completed/disconnected sessions. This is in addition to the existing terminate button (which shows for active/idle sessions).
  
  Changes:
  1. Add `onDelete?: (sessionId: string, instanceId: string) => void` to the component props.
  2. Add a delete button that appears when `isInactive` (stopped/completed/disconnected). Position it in the same area as the terminate button (absolute top-right). Use `Trash2` icon with a different color treatment to distinguish from terminate — use `text-red-400 hover:text-red-500 hover:bg-red-500/10` styling.
  3. The delete button should NOT navigate (prevent default + stop propagation, matching the terminate button pattern).
  
  The button does NOT open the dialog directly — it calls `onDelete` and the parent manages the dialog state. This keeps the card component simple and stateless.
  
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Acceptance**: Inactive session cards show a delete button on hover. Active/idle cards still show terminate only. Clicking delete calls the `onDelete` callback.

- [x] 8. **Wire up delete flow in the fleet page (page.tsx)**
  **What**: Integrate the delete hook, dialog, and card callback in the fleet page.
  
  Changes:
  1. Import `useDeleteSession` hook and `ConfirmDeleteSessionDialog` component.
  2. Add state for the delete confirmation dialog: `const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; instanceId: string; title: string } | null>(null)`.
  3. Add `handleDeleteRequest` callback — sets `deleteTarget` to open the dialog.
  4. Add `handleDeleteConfirm` callback — calls `deleteSession()` from the hook, then `refetch()`, then clears `deleteTarget`.
  5. Pass `onDelete={handleDeleteRequest}` to all `LiveSessionCard` instances (there are 4 render locations: ungrouped grid, status groups, source groups, and SessionGroup).
  6. Render `<ConfirmDeleteSessionDialog>` once at the bottom of the component, controlled by `deleteTarget` state.
  7. Pass `onDelete` through to `SessionGroup` (add it to `SessionGroupProps`).
  
  **Files**: 
  - `src/app/page.tsx` — main wiring
  - `src/components/fleet/session-group.tsx` — pass `onDelete` through to `LiveSessionCard`
  - `src/components/fleet/live-session-card.tsx` — already done in step 7
  **Acceptance**: Clicking delete on a stopped session card opens the confirmation dialog. Confirming deletes the session and it disappears from the fleet view after refetch. Dialog shows loading state during deletion.

- [x] 9. **Add delete action to session detail page**
  **What**: Add a "Delete" button to the session detail page header (next to the Stop button) that opens the same confirmation dialog. This should only appear for stopped/disconnected sessions (when `isStopped` is true or `isResumable` is true).
  
  Changes to `src/app/sessions/[id]/page.tsx`:
  1. Import `useDeleteSession` and `ConfirmDeleteSessionDialog`.
  2. Add `const { deleteSession: permanentDelete, isDeleting } = useDeleteSession()`.
  3. Add `const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)`.
  4. Add a "Delete" button in the header actions area, after the stop/cancel buttons. Only show when `isStopped || isResumable`. Use `Trash2` icon, destructive variant, small size.
  5. Add `handlePermanentDelete` callback: calls `permanentDelete(sessionId, instanceId)`, then navigates back to the fleet page (`router.push("/")`).
  6. Render `<ConfirmDeleteSessionDialog>` at the bottom of the component.
  
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Stopped sessions show a "Delete" button in the header. Clicking it opens the confirmation dialog. Confirming deletes the session and navigates back to the fleet page.

## Verification
- [x] `npm run build` succeeds with zero errors
- [x] `npm run test` passes with all new tests green
- [x] `npm run lint` passes
- [x] Manual: Create a session, let it complete, click delete on the card → confirmation appears → confirm → session gone
- [x] Manual: Create a worktree session, complete it, delete → workspace directory is cleaned up
- [x] Manual: Terminate without `permanent=true` still works as before (no regression)
- [x] Manual: Session detail page shows delete button for stopped sessions, navigates home after delete
