# New Session from Existing Session

> **GitHub Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/44

## TL;DR
> **Summary**: Add a "New Session" affordance on existing sessions that creates a fresh OpenCode session in the same workspace/directory, with optional sibling linking. Inspired by OpenCode's `/new` command.
> **Estimated Effort**: Medium

## Context

### Original Request
Users want to start a new session from the context of an existing session — inheriting the directory/workspace config without needing to re-specify it. This mirrors OpenCode's `/new` (alias `/clear`) which creates a fresh session in the same project.

### Key Findings

**Existing infrastructure that makes this straightforward:**
- `POST /api/sessions` already accepts `directory`, `isolationStrategy`, and `title` — the core mechanics exist
- `createWorkspace()` in `workspace-manager.ts` already reuses workspace records for the `existing` strategy (line 94-97)
- `spawnInstance()` already reuses OpenCode instances for the same directory — no duplicate processes
- `parent_session_id` column exists in the sessions table (added as a migration in `database.ts` line 117-121)
- `nestSessions()` in `session-utils.ts` already groups children under parents via `dbId`/`parentSessionId`
- The `SessionGroup` component already renders parent-child relationships with visual nesting

**What's missing:**
1. No API parameter to say "create a new session like this one" — caller must manually look up the directory
2. No UI button/affordance on existing session cards or session detail page to trigger this
3. The `parent_session_id` relationship is only used for orchestration callbacks (conductor→child), not for "sibling" or "continuation" sessions
4. The sidebar context menu on workspaces has a "New Session" item (line 237-240 of `sidebar-workspace-item.tsx`) but it's not wired up — it renders but the `onNewSession` callback is never provided

**Design decision — `fromSessionId` vs UI-side resolution:**
The simplest approach is to add an optional `fromSessionId` field to `CreateSessionRequest`. The API route resolves the source session's directory/workspace from the DB, inheriting its config. This avoids requiring the UI to fetch and pass directory info separately.

## Objectives

### Core Objective
Enable users to quickly create a new session in the same workspace as an existing session, with a single click from the fleet dashboard, session detail page, or sidebar.

### Deliverables
- [ ] API: `fromSessionId` parameter on `POST /api/sessions` that auto-resolves directory from source session
- [ ] DB: Reuse existing `parent_session_id` column to link sessions created "from" another
- [ ] UI: "New Session" button on session detail page header
- [ ] UI: "New Session" button on `LiveSessionCard` hover actions
- [ ] UI: Wire up the existing "New Session" context menu item in sidebar workspace item
- [ ] UI: Command palette integration — "New Session in Same Workspace" command when viewing a session
- [ ] Tests: API route tests for `fromSessionId` flow

### Definition of Done
- [ ] User can click "New Session" on any session card or detail page and get a new session in the same directory
- [ ] New session is navigated to automatically
- [ ] `fromSessionId` API parameter works and resolves directory from DB
- [ ] No regressions in existing session creation flow
- [ ] `npm run test` passes

### Guardrails (Must NOT)
- Do NOT change the meaning of `parent_session_id` — it's for orchestration callbacks
- Do NOT require `fromSessionId` — the existing `directory`-based flow must continue working
- Do NOT auto-send a prompt to the new session — it should start empty like OpenCode's `/new`
- Do NOT add a new database migration table — use a column addition (same pattern as `parent_session_id`)

## TODOs

### Phase 1: API Layer

- [ ] 1. **Add `fromSessionId` to `CreateSessionRequest` and make `directory` optional**
  **What**: Two changes in `CreateSessionRequest`:
  1. Change `directory: string` (required) → `directory?: string` (optional). This allows callers to omit `directory` when `fromSessionId` is provided.
  2. Add an optional `fromSessionId?: string` field. When provided, the API route resolves the source session's workspace directory, isolation strategy, and workspace ID from the DB.
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: Type compiles. Existing callers that pass `directory` are unaffected. `{ fromSessionId: "xyz" }` (without `directory`) is a valid `CreateSessionRequest`.

- [ ] 2. **Handle `fromSessionId` in `POST /api/sessions` route**
  **What**: The current route has a `!directory` guard at lines 29-34 that returns 400 before any other logic runs. This guard must be **moved below** the `fromSessionId` resolution block, so that the route can resolve `directory` from the source session first. Specifically:
  1. After parsing the body (line 27), add the `fromSessionId` resolution block (see pseudocode below). This block resolves `directory` from the source session's workspace when `fromSessionId` is provided and `directory` is not.
  2. **Move** the existing `!directory` guard (lines 29-34) to **after** the `fromSessionId` resolution block. Change it to validate `resolvedDir` instead of `directory`, so it catches the case where neither `directory` nor `fromSessionId` was provided.
  3. Store the source session's DB id as the new session's `parent_session_id` (reusing the existing column — see note below).
  **Files**: `src/app/api/sessions/route.ts`
  **Acceptance**: `POST /api/sessions { fromSessionId: "xyz" }` (without `directory`) creates a session in the same directory as session "xyz". `POST /api/sessions {}` (neither field) returns 400.

  > **Note on `parent_session_id` reuse**: After analysis, adding a separate `sibling_session_id` column adds complexity without clear value at this stage. The `parent_session_id` column already exists and the `nestSessions()` grouping works. For MVP, we reuse `parent_session_id` to link the new session to the source session. This means "from session" sessions will visually appear as children in the session tree — which is actually desirable UX. If orchestration callbacks need to be distinguished from "sibling" links later, a `relationship_type` column can be added as a follow-up.

- [ ] 3. **Add `fromSessionId` to `CreateSessionResponse`**
  **What**: Optionally include the resolved `fromSessionId` in the response so the UI knows the relationship was established.
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: Response includes `fromSessionId` when the parameter was used

### Phase 2: UI — Session Detail Page

- [ ] 4. **Add "New Session" button to session detail page header**
  **What**: Add a button in the session detail page header actions (next to Stop/Interrupt) that creates a new session from the current session. Use the existing `useCreateSession` hook but extend it to support `fromSessionId`. On success, navigate to the new session.
  **Files**: `src/app/sessions/[id]/page.tsx`, `src/hooks/use-create-session.ts`
  **Acceptance**: Button visible in header, clicking it creates a new session in the same directory and navigates to it

- [ ] 5. **Extend `useCreateSession` hook to support `fromSessionId`**
  **What**: Three changes needed:
  1. Add `fromSessionId?: string` to `CreateSessionOptions`.
  2. Change the `createSession` function signature from `(directory: string, opts?)` to `(directory: string | undefined, opts?)`. This is required because the current `directory: string` type makes `createSession(undefined, ...)` a TypeScript error.
  3. In the function body, build `CreateSessionRequest` conditionally: include `directory` only when defined, include `fromSessionId` from opts when provided. At least one of `directory` or `fromSessionId` must be present — throw a client-side validation error if neither is provided.
  **Files**: `src/hooks/use-create-session.ts`
  **Acceptance**: `createSession(undefined, { fromSessionId: "xyz" })` compiles and sends `{ fromSessionId: "xyz" }` in the request body. `createSession("/path/to/dir")` still works as before.

### Phase 3: UI — Fleet Dashboard & Sidebar

- [ ] 6. **Add "New Session" action to `LiveSessionCard`**
  **What**: Add a "New Session" icon button to the hover overlay on `LiveSessionCard` (similar to the existing terminate/abort/open buttons). Clicking it calls `createSession` with `fromSessionId` set to the card's session ID, then navigates to the new session.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Acceptance**: Hovering over a session card shows a "+" button; clicking it creates a sibling session

- [ ] 7. **Wire the "New Session" callback through the fleet page**
  **What**: The `LiveSessionCard` needs an `onNewSession` prop. Thread it through `page.tsx` (fleet dashboard) and `session-group.tsx`. The handler should call `createSession` with `fromSessionId` and navigate on success.
  **Files**: `src/app/page.tsx`, `src/components/fleet/session-group.tsx`
  **Acceptance**: "New Session" button on cards works from the fleet dashboard

- [ ] 8. **Wire up sidebar "New Session" context menu item**
  **What**: The `SidebarWorkspaceItem` already renders a "New Session" context menu item (line 237-240) but it doesn't do anything. Wire it to open the `NewSessionDialog` pre-filled with the workspace directory. This requires either: (a) passing the workspace directory to the `NewSessionDialog` as a `defaultDirectory` prop, or (b) calling `createSession` directly with the directory.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`, `src/components/session/new-session-dialog.tsx`
  **Acceptance**: Right-clicking a workspace in the sidebar → "New Session" → creates session in that directory

### Phase 4: Command Palette

- [ ] 9. **Register "New Session in Same Workspace" command on session detail page**
  **What**: When viewing a session detail page, register a command in the command palette: "New Session in Same Workspace". Uses the current session's `sessionId` as `fromSessionId`. Only registered when on a session detail page (unregistered on unmount).
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Opening command palette on a session page shows "New Session in Same Workspace"

### Phase 5: Tests

- [ ] 10. **API route tests for `fromSessionId` flow**
  **What**: Add test cases to `src/app/api/sessions/__tests__/route.test.ts`:
  - `Returns200WhenFromSessionIdResolvesValidSession` — mock DB lookup returns a session with workspace, verify `createWorkspace` is called with the resolved directory
  - `Returns400WhenFromSessionIdSessionNotFound` — mock DB returns undefined
  - `Returns400WhenFromSessionIdWorkspaceNotFound` — session exists but workspace doesn't
  - `UseDirectoryWhenBothFromSessionIdAndDirectoryProvided` — `directory` takes precedence
  - `SetsParentSessionIdFromSourceSession` — verify `insertSession` is called with `parent_session_id` matching the source session's DB id
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Acceptance**: All new test cases pass

- [ ] 11. **Hook test for `fromSessionId` in `useCreateSession`**
  **What**: Verify the hook sends `fromSessionId` in the request body when provided, and omits `directory` when only `fromSessionId` is given.
  **Files**: New test file `src/hooks/__tests__/use-create-session.test.ts` (or add to existing if one exists)
  **Acceptance**: Hook test passes

## Implementation Notes

### API Route Change (Task 2) — Pseudocode
```
// In POST /api/sessions, after parsing body (line 27):
// IMPORTANT: The existing `!directory` guard at lines 29-34 must be MOVED below this block.

const { directory, title, isolationStrategy = "existing", branch, fromSessionId } = body;

let resolvedDir = directory;
let sourceSessionDbId: string | null = null;

// Step 0: Resolve directory from source session if fromSessionId provided
if (fromSessionId && !resolvedDir) {
  const sourceSession = getSessionByOpencodeId(fromSessionId) ?? getSession(fromSessionId);
  if (!sourceSession) {
    return 400 "Source session not found";
  }
  const sourceWorkspace = getWorkspace(sourceSession.workspace_id);
  if (!sourceWorkspace) {
    return 400 "Source session workspace not found";
  }
  // Use source_directory (original repo) for worktree/clone, or directory for existing
  resolvedDir = sourceWorkspace.source_directory ?? sourceWorkspace.directory;
  sourceSessionDbId = sourceSession.id;
}

// MOVED guard: now validates resolvedDir AFTER fromSessionId resolution
if (!resolvedDir || typeof resolvedDir !== "string") {
  return 400 "directory is required (or provide fromSessionId)";
}

resolvedDir = validateDirectory(resolvedDir);
// Continue with existing createWorkspace → spawnInstance → session.create flow
// When inserting session, set parent_session_id = sourceSessionDbId ?? parentDbSessionId
```

### UI Button Placement

**Session Detail Page** — Add after the Stop button in the header actions:
```tsx
<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleNewSession}>
  <Plus className="h-3 w-3" />
  New Session
</Button>
```

**LiveSessionCard** — Add a `Plus` icon button in the hover overlay, positioned before the abort button slot.

### Navigation After Creation
All "New Session" actions should navigate to the new session after creation:
```ts
router.push(`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`);
```

## Verification
- [ ] All existing tests pass (`npm run test`)
- [ ] New API tests for `fromSessionId` pass
- [ ] Manual test: create session from fleet card → new session opens in same directory
- [ ] Manual test: create session from session detail page → new session opens in same directory
- [ ] Manual test: create session via sidebar context menu → new session opens in same directory
- [ ] Manual test: existing `POST /api/sessions { directory: "..." }` flow still works
- [ ] No regressions in session list grouping (nestSessions still works correctly)

## Future Enhancements (Out of Scope)
- `relationship_type` column on sessions table to distinguish "sibling" from "conductor-child"
- Session grouping UI that visually links siblings independently from parent-child orchestration
- "Continue conversation" mode that copies the conversation history to the new session
- Keyboard shortcut for "New Session in Same Workspace" (can be added via keybindings system)
