# Worktree/Clone Session Grouping Fix

## TL;DR
> **Summary**: Group worktree/clone sessions under their source project directory instead of the UUID workspace path, and replace text isolation badges with compact icons.
> **Estimated Effort**: Short

## Context
### Original Request
When a worktree or clone session is created from `/Users/you/my-project`, the workspace `directory` becomes `~/.weave/workspaces/{UUID}`. The UI groups sessions by `workspaceDirectory`, so these isolated sessions appear as their own group with a GUID name — confusing to users. Fix the grouping and clean up the visual presentation.

### Key Findings
- `DbWorkspace` already stores `source_directory: string | null` (db-repository.ts:15). For worktree/clone, this is the original project path; for "existing", it equals `directory`.
- The API route (`GET /api/sessions`) already reads the workspace via `getWorkspace()` but does **not** pass `source_directory` to the frontend.
- `groupSessionsByWorkspace()` keys on `session.workspaceDirectory` (the UUID path for worktree/clone), causing them to form separate groups.
- `filterSessionsByWorkspace()` also resolves by `workspaceDirectory` and needs the same fix.
- `WorkspaceGroup.workspaceDirectory` is consumed in 4 places: new-session button (session-group.tsx:146), open-in-editor (session-group.tsx:157), sidebar tooltip (sidebar-workspace-item.tsx:177), and sidebar open-in-editor (sidebar-workspace-item.tsx:244). All of these should show/use the **source** (logical) directory, which is exactly what we want after the fix.
- `live-session-card.tsx` uses `item.workspaceDirectory` for the "Open" button (line 207) — this should continue using the **actual** workspace directory (the worktree path) since that's where the code physically lives. This is the one place we need to preserve the physical directory.
- The `Tooltip` component from shadcn/ui is already available (`src/components/ui/tooltip.tsx`).
- Lucide-react icons `GitBranch` and `Copy` are available (lucide-react is already imported in the card).
- There are existing tests in `src/lib/__tests__/workspace-utils.test.ts` covering `groupSessionsByWorkspace` and `filterSessionsByWorkspace` that must be updated.

## Objectives
### Core Objective
Make worktree/clone sessions appear grouped under their source project alongside "existing" sessions, and replace noisy text badges with icons.

### Deliverables
- [ ] `sourceDirectory` field added to `SessionListItem` API type
- [ ] API route passes `source_directory` from the DB workspace
- [ ] Grouping/filtering logic uses `sourceDirectory` as the key
- [ ] Session card shows icon+tooltip instead of text badge for isolation strategy
- [ ] Session card hides the meaningless UUID directory for worktree/clone sessions
- [ ] Existing tests updated, new test cases added for worktree grouping

### Definition of Done
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm test` passes (all workspace-utils tests)
- [ ] Manual verification: create a worktree session and confirm it groups under the source project in the UI

### Guardrails (Must NOT)
- Must NOT change database schema or `DbWorkspace` type
- Must NOT change `workspace-manager.ts` or `db-repository.ts`
- Must NOT break the "Open in Editor" flow for worktree sessions — the physical directory must still be accessible where needed
- Must NOT remove isolation strategy information entirely — it should still be visible via tooltip

## TODOs

- [ ] 1. **Add `sourceDirectory` to `SessionListItem` interface**
  **What**: Add a `sourceDirectory: string | null` field to the `SessionListItem` interface. This represents the original project directory that the worktree/clone was created from. For "existing" strategy sessions, this will be `null` or equal to `workspaceDirectory`.
  **Files**: `src/lib/api-types.ts` (line ~59, add field after `parentSessionId`)
  **Acceptance**: TypeScript compiles; the field exists on the interface.

- [ ] 2. **Populate `sourceDirectory` in the sessions API route**
  **What**: In the `GET /api/sessions` handler, extract `ws.source_directory` from the workspace object (already fetched via `getWorkspace()`) and include it in all three `items.push()` calls:
  - **Live session** (line ~293): add `sourceDirectory`
  - **Stub session** (line ~313): add `sourceDirectory`
  - **DB-unavailable fallback** (line ~157): add `sourceDirectory: null` (no DB = no workspace info)
  Declare a `let sourceDirectory: string | null = null` alongside the other workspace variables (line ~268-270), and set it from `ws.source_directory` inside the `if (ws)` block (line ~273-277).
  **Files**: `src/app/api/sessions/route.ts`
  **Acceptance**: API response includes `sourceDirectory` for every session in all code paths. For worktree/clone sessions, it contains the original project path; for "existing" or DB-unavailable fallback, it's `null`.

- [ ] 3. **Update `groupSessionsByWorkspace()` to group by source directory**
  **What**: Change the grouping key on line 43 from `session.workspaceDirectory` to `session.sourceDirectory ?? session.workspaceDirectory`. This ensures worktree/clone sessions (whose `sourceDirectory` is `/Users/you/my-project`) merge into the same group as "existing" sessions for that directory. Also update the `WorkspaceGroup` creation (line 73) so that `workspaceDirectory` is set to this resolved key (the logical/source directory) rather than the raw `workspaceDirectory`. The `deriveDisplayName()` function (line 28) reads `item.workspaceDirectory` for fallback name derivation — this is fine as-is because groups will now be keyed by source directory, and the group's `workspaceDirectory` field will be the source dir.
  **Files**: `src/lib/workspace-utils.ts` (function `groupSessionsByWorkspace`, lines 37-97)
  **Acceptance**: Sessions with different `workspaceDirectory` values but the same `sourceDirectory` end up in the same `WorkspaceGroup`. The group's `workspaceDirectory` reflects the source/logical directory.

- [ ] 4. **Update `filterSessionsByWorkspace()` to resolve by source directory**
  **What**: On line 114, change `matched.workspaceDirectory` to `matched.sourceDirectory ?? matched.workspaceDirectory` for the `targetDir`. On line 115, change the filter predicate to compare `s.sourceDirectory ?? s.workspaceDirectory` against `targetDir`. This ensures sidebar filtering correctly includes worktree/clone sessions that share a source directory.
  **Files**: `src/lib/workspace-utils.ts` (function `filterSessionsByWorkspace`, lines 107-116)
  **Acceptance**: Filtering by a workspace ID that belongs to a worktree session returns all sessions (including "existing" ones) that share the same source directory.

- [ ] 5. **Update `deriveDisplayName()` to prefer source directory for name derivation**
  **What**: On line 28, change the fallback from `item.workspaceDirectory` to `item.sourceDirectory ?? item.workspaceDirectory`. This prevents UUID paths from leaking into display names when a worktree/clone session has no explicit `workspaceDisplayName`.
  **Files**: `src/lib/workspace-utils.ts` (function `deriveDisplayName`, lines 24-30)
  **Acceptance**: A worktree session with `workspaceDirectory: "~/.weave/workspaces/abc-123"` and `sourceDirectory: "/Users/you/my-project"` derives display name `"my-project"` instead of `"abc-123"`.

- [ ] 6. **Replace isolation strategy text badge with icon + tooltip on session card**
  **What**: In `live-session-card.tsx`, replace the text badge block (lines 97-101) with an icon-based approach:
  - Import `GitBranch` and `Copy` from `lucide-react` (add to existing import on line 7).
  - Import `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` from `@/components/ui/tooltip`.
  - Replace the `<Badge>` that shows `{isolationStrategy}` with:
    - A `<Tooltip>` wrapping an icon: `GitBranch` (size 3, `text-purple-400`) for `"worktree"`, `Copy` (size 3, `text-purple-400`) for `"clone"`.
    - `<TooltipContent>` showing the full text (e.g., "worktree" or "clone").
  - Keep the conditional: only show for `isolationStrategy !== "existing"`.
  **Files**: `src/components/fleet/live-session-card.tsx` (lines 7, 97-101)
  **Acceptance**: Worktree sessions show a small purple git-branch icon; clone sessions show a small purple copy icon. Hovering reveals a tooltip with the strategy name. No text badge.

- [ ] 7. **Clean up directory display on session card for worktree/clone sessions**
  **What**: The `session.directory` shown on line 112-114 is the UUID workspace path for worktree/clone sessions, which is meaningless. Conditionally hide this or replace it:
  - If `isolationStrategy !== "existing"` and `item.sourceDirectory` exists, show nothing for the directory (the source directory is already visible in the group header).
  - Alternatively, if the workspace has a `branch` (available if we add it to the API), show the branch name. However, since `branch` is not currently on `SessionListItem` and adding it would expand scope, the simplest approach is to just hide the directory line for non-"existing" sessions.
  - Change the span (line 112-114) to conditionally render: only show `session.directory` when `isolationStrategy === "existing"`.
  **Files**: `src/components/fleet/live-session-card.tsx` (lines 112-114)
  **Acceptance**: Worktree/clone session cards no longer show a UUID path. "Existing" session cards still show the directory as before.

- [ ] 8. **Preserve physical directory for "Open in Editor" on session card**
  **What**: Verify that `live-session-card.tsx` line 207 (`onOpen(item.workspaceDirectory)`) still passes the **physical** workspace directory (the worktree path), not the source directory. Since `item.workspaceDirectory` remains unchanged on the `SessionListItem` (we only changed what `WorkspaceGroup.workspaceDirectory` resolves to), this should already be correct. No code change needed — just verify.
  **Files**: `src/components/fleet/live-session-card.tsx` (line 207)
  **Acceptance**: Clicking "Open in Editor" on a worktree session card opens the worktree directory (the physical path where the code is checked out), not the source directory.

- [ ] 9. **Update search filtering on main page**
  **What**: In `src/app/page.tsx` line 130, the search filter checks `s.workspaceDirectory.toLowerCase()`. This should also check `s.sourceDirectory` so that searching for the project name matches worktree/clone sessions. Change to: `const dir = (s.sourceDirectory ?? s.workspaceDirectory).toLowerCase()`.
  **Files**: `src/app/page.tsx` (line 130)
  **Acceptance**: Searching for the project name in the main page search bar finds worktree/clone sessions that have that project as their source directory.

- [ ] 10. **Update existing tests and add new test cases**
  **What**: Update the test helpers and add new test cases in `src/lib/__tests__/workspace-utils.test.ts`:
  - Add `sourceDirectory: null` to the `makeSession()` helper (line 23-35) default.
  - Add test: two sessions with different `workspaceDirectory` but same `sourceDirectory` should be grouped together by `groupSessionsByWorkspace()`.
  - Add test: a worktree session (with `sourceDirectory` set) should group with an "existing" session for the same directory.
  - Add test: `deriveDisplayName()` uses `sourceDirectory` when `workspaceDisplayName` is null and `sourceDirectory` is set.
  - Add test: `filterSessionsByWorkspace()` includes worktree sessions that share the same `sourceDirectory` as the target.
  - Update existing tests if they break due to the new `sourceDirectory` field.
  **Files**: `src/lib/__tests__/workspace-utils.test.ts`
  **Acceptance**: All tests pass with `npm test`. New test cases cover the worktree/clone grouping scenarios.

## Verification
- [ ] `npm run build` completes with no TypeScript errors
- [ ] `npm test` passes — all existing and new workspace-utils tests green
- [ ] No regressions: "existing" sessions still group and display correctly
- [ ] Manual test: create a worktree session from a project → appears in the same group as existing sessions for that project
- [ ] Manual test: hover over the git-branch icon on a worktree session card → tooltip shows "worktree"
- [ ] Manual test: worktree session card does not show UUID path
- [ ] Manual test: "Open in Editor" on a worktree session card opens the correct physical worktree directory
- [ ] Manual test: sidebar tooltip for a group containing worktree sessions shows the source project path, not a UUID
