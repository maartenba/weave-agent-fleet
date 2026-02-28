# Session Rename

## TL;DR
> **Summary**: Add inline rename functionality to sessions, mirroring the existing workspace rename pattern. Includes DB function, PATCH endpoint, React hook, sidebar inline-edit, and consistent title/fallback display across all UI surfaces.
> **Estimated Effort**: Medium

## Context
### Original Request
Allow users to rename sessions. Display the session name everywhere (falling back to truncated `session_id` when no name is explicitly set). Follow the existing workspace rename pattern exactly.

### Key Findings
1. **DB schema** (`src/lib/server/database.ts` L72): `title TEXT NOT NULL DEFAULT 'Untitled'` — the default is `'Untitled'` which makes it impossible to distinguish "user set a title" from "no title set". Must change to allow `NULL`.
2. **DB repository** (`src/lib/server/db-repository.ts` L184): `insertSession` falls back to `"Untitled"` when no title provided. Must change to `null`.
3. **Workspace rename pattern** is the exact blueprint:
   - `updateWorkspaceDisplayName()` in `db-repository.ts` (L115-119)
   - `PATCH /api/workspaces/[id]/route.ts` (61 lines)
   - `useRenameWorkspace` hook (56 lines)
   - `InlineEdit` component already exists at `src/components/ui/inline-edit.tsx`
   - Sidebar workspace item uses `ContextMenu` with "Rename" option + `InlineEdit` + F2 trigger
4. **Session title display locations** (all need `title || id.slice(0, 8)` fallback):
   - `sidebar-session-item.tsx` L27: `session.title || session.id.slice(0, 12)` — already has fallback but uses `||` which treats `"Untitled"` as truthy
   - `live-session-card.tsx` L62: `session.title || session.id.slice(0, 12)`
   - `sessions/[id]/page.tsx` L134: Uses raw `sessionId` in header — no title at all
   - `page.tsx` L63, 77-78: Search/sort use `session.title` — need null-safe handling
5. **`DbSession.title` type** (`db-repository.ts` L39): Currently `title: string` — must become `title: string | null` to support null.
6. **Session detail page** (`sessions/[id]/page.tsx` L134): Shows raw `sessionId` in the `Header` title — should show session title with fallback.
7. **Existing `[id]/route.ts`** for sessions has GET and DELETE but **no PATCH** — we add one.
8. **The `insertSession` call in `POST /api/sessions`** (route.ts L73): `title: session.title ?? title ?? "New Session"` — should change to `session.title ?? title ?? null` so sessions start without an explicit title.

## Objectives
### Core Objective
Enable users to rename sessions from the sidebar (and eventually other surfaces) with full persistence, following the workspace rename pattern.

### Deliverables
- [ ] DB migration: Allow `title` to be `NULL` in the sessions table
- [ ] DB function: `updateSessionTitle(id, title)`
- [ ] API endpoint: `PATCH /api/sessions/[id]`
- [ ] React hook: `useRenameSession()`
- [ ] Sidebar UI: Inline rename with context menu + F2 shortcut on session items
- [ ] Consistent fallback: All UI surfaces show `title ?? session_id.slice(0, 8)` (not "Untitled")
- [ ] Session detail page: Show session title in header (not raw session ID)
- [ ] Tests for DB function and PATCH endpoint

### Definition of Done
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm test` passes (existing + new tests)
- [ ] User can right-click a session in sidebar → "Rename" → type new name → Enter saves it
- [ ] User can double-click session name in sidebar to rename
- [ ] Sessions created without explicit title show truncated session ID (not "Untitled")
- [ ] Session detail page header shows the session title (or truncated ID)

### Guardrails (Must NOT)
- Must NOT break existing workspace rename functionality
- Must NOT change the OpenCode SDK session — only our local DB title
- Must NOT introduce new dependencies
- Must NOT change the session ID or opencode_session_id

## TODOs

### Phase 1: Data Layer

- [ ] 1. **Allow NULL title in sessions table**
  **What**: Add a migration in `database.ts` that makes the `title` column nullable. Since SQLite `CREATE TABLE IF NOT EXISTS` won't re-create the table, and we can't `ALTER COLUMN` in SQLite, the approach is: the column already exists and accepts NULL values at the SQLite level (the `NOT NULL` constraint is only enforced if the table was freshly created). For new databases, change the schema definition from `title TEXT NOT NULL DEFAULT 'Untitled'` to `title TEXT DEFAULT NULL`. For existing databases, we don't need an ALTER since we control what we INSERT.
  **Files**: `src/lib/server/database.ts`
  **Details**:
  - Change L72 from `title TEXT NOT NULL DEFAULT 'Untitled'` to `title TEXT DEFAULT NULL`
  - This only affects newly created databases; existing databases already have the column and SQLite won't recreate the table due to `IF NOT EXISTS`
  - For existing databases with `NOT NULL` constraint, add a migration block (like the `display_name` migration at L94-98): `ALTER TABLE sessions ALTER COLUMN ...` won't work in SQLite. Instead, since we control inserts, we can simply pass `NULL` and it will work if the column was created without `NOT NULL`, or we accept that existing DBs will continue to have the constraint but we'll treat `'Untitled'` as "no title" in the UI fallback logic
  **Acceptance**: New databases created from scratch have nullable `title` column

- [ ] 2. **Update DbSession type to allow null title**
  **What**: Change `title: string` to `title: string | null` in the `DbSession` interface
  **Files**: `src/lib/server/db-repository.ts`
  **Details**:
  - L39: Change `title: string;` to `title: string | null;`
  - L184: Change `title: sess.title ?? "Untitled"` to `title: sess.title ?? null`
  **Acceptance**: TypeScript compiles; `DbSession.title` is `string | null`

- [ ] 3. **Add `updateSessionTitle()` DB function**
  **What**: Add a function to update a session's title, following the `updateWorkspaceDisplayName` pattern
  **Files**: `src/lib/server/db-repository.ts`
  **Details**:
  - Add after the `updateSessionStatus` function (around L223):
    ```typescript
    export function updateSessionTitle(id: string, title: string): void {
      getDb()
        .prepare("UPDATE sessions SET title = @title WHERE id = @id")
        .run({ id, title });
    }
    ```
  - This takes a non-empty string (validation happens at the API layer)
  **Acceptance**: Function exists and updates the title column for a given session ID

- [ ] 4. **Update session creation to use null title**
  **What**: Change the POST /api/sessions route to not set a default title, letting it be null
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - L73: Change `title: session.title ?? title ?? "New Session"` to `title: session.title ?? title ?? null`
  - This ensures sessions created without an explicit title have `null` in the DB, triggering the ID fallback in the UI
  **Acceptance**: New sessions created without a title have `null` in the `title` column

### Phase 2: API Layer

- [ ] 5. **Add PATCH handler to `/api/sessions/[id]/route.ts`**
  **What**: Add a PATCH endpoint to update the session title, following the workspace PATCH pattern exactly
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Details**:
  - Import `updateSessionTitle` from `db-repository`
  - Add `PATCH` export following the workspace pattern:
    - Parse JSON body, validate `title` is a non-empty string
    - Look up session by ID (try `getSession(id)` then `getSessionByOpencodeId(id)`)
    - If not found, return 404
    - Call `updateSessionTitle(resolvedId, title)` using the DB session's `id` (not the opencode session ID)
    - Return `{ id, title }` with 200
  - Handle the same error cases as the workspace PATCH (invalid JSON → 400, missing field → 400, not found → 404, DB error → 500)
  **Acceptance**: `curl -X PATCH /api/sessions/<id> -d '{"title":"My Task"}' -H 'Content-Type: application/json'` returns 200 and updates the DB

### Phase 3: Client Hook

- [ ] 6. **Create `useRenameSession` hook**
  **What**: Create a hook following the `useRenameWorkspace` pattern
  **Files**: `src/hooks/use-rename-session.ts` (new file)
  **Details**:
  - Mirror `use-rename-workspace.ts` structure exactly:
    ```typescript
    "use client";
    import { useState } from "react";

    export interface UseRenameSessionResult {
      renameSession: (
        sessionId: string,
        title: string,
        onSuccess?: () => void
      ) => Promise<void>;
      isLoading: boolean;
      error?: string;
    }

    export function useRenameSession(): UseRenameSessionResult {
      // ... same pattern as useRenameWorkspace
      // fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      //   method: "PATCH",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ title }),
      // })
    }
    ```
  **Acceptance**: Hook compiles and exposes `renameSession`, `isLoading`, `error`

### Phase 4: UI — Sidebar Inline Rename

- [ ] 7. **Add inline rename to `sidebar-session-item.tsx`**
  **What**: Transform the sidebar session item from a simple `<Link>` into a component with `InlineEdit`, context menu (Rename), and F2 shortcut — similar to `sidebar-workspace-item.tsx`
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details**:
  - Import `InlineEdit`, `ContextMenu*`, `useRenameSession`, `useSessionsContext`, `Pencil` icon
  - Add `useState` for `isRenaming`
  - Add `handleRename` callback that calls `renameSession(session.id, newName, refetch)`
  - Important: the session ID passed to the API must be the fleet DB session ID. Currently `item.session.id` is the **opencode** session ID. The PATCH endpoint handles this by looking up both `getSession(id)` and `getSessionByOpencodeId(id)`.
  - Wrap the existing `<Link>` in a `<ContextMenu>`:
    - ContextMenuItem "Rename" with `<Pencil>` icon → `setIsRenaming(true)`
  - Replace the plain `<span>` title display with `<InlineEdit>`:
    - `value={title}` (where `title = session.title || session.id.slice(0, 8)`)
    - `onSave={handleRename}`
    - `editing={isRenaming}`
    - `onEditingChange={setIsRenaming}`
  - Add hidden `data-rename-trigger` button for F2 keyboard shortcut (matching workspace pattern)
  - Prevent link navigation when `isRenaming` is true
  **Acceptance**: Right-click session → "Rename" → type → Enter saves; double-click also works

### Phase 5: UI — Display Consistency

- [ ] 8. **Update title fallback logic across all UI surfaces**
  **What**: Ensure all locations that display a session title treat both `null` and `"Untitled"` as "no explicit title" and fall back to truncated session ID
  **Files**:
  - `src/components/layout/sidebar-session-item.tsx` — L27
  - `src/components/fleet/live-session-card.tsx` — L62
  - `src/app/sessions/[id]/page.tsx` — L134
  - `src/app/page.tsx` — L63, L77-78
  **Details**:
  - Define a consistent fallback helper or inline pattern. The simplest approach: treat `"Untitled"` as equivalent to null for backwards compat with existing sessions:
    ```typescript
    const displayTitle = (title: string | null | undefined, id: string) =>
      title && title !== "Untitled" ? title : id.slice(0, 8);
    ```
  - Or create a tiny utility in `src/lib/utils.ts`:
    ```typescript
    export function sessionDisplayTitle(title: string | null | undefined, sessionId: string): string {
      return title && title !== "Untitled" ? title : sessionId.slice(0, 8);
    }
    ```
  - **`sidebar-session-item.tsx`** L27: Replace `session.title || session.id.slice(0, 12)` with `sessionDisplayTitle(session.title, session.id)`
  - **`live-session-card.tsx`** L62: Replace `session.title || session.id.slice(0, 12)` with `sessionDisplayTitle(session.title, session.id)`
  - **`sessions/[id]/page.tsx`** L134: Change `title={sessionId}` to use the session title from metadata (requires fetching it — see next detail)
  - **`page.tsx`** L63: `session.title?.toLowerCase()` is fine (null-safe already); L77-78: `a.session.title ?? a.session.id` is fine for sorting
  **Acceptance**: Sessions without explicit titles show truncated ID everywhere; sessions with "Untitled" in legacy DB also show truncated ID

- [ ] 9. **Show session title in session detail page header**
  **What**: The session detail page currently shows `sessionId` as the header title. It should show the session's display name.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - Extend the `SessionMetadata` interface to include `title: string | null`
  - In the `useEffect` fetch (L54-68), extract `data.session?.title` into metadata
  - The existing GET response at `/api/sessions/[id]` already includes the full `session` object which has `title`
  - Change L134 from `title={sessionId}` to `title={sessionDisplayTitle(metadata.title, sessionId)}`
  - Import `sessionDisplayTitle` from `src/lib/utils`
  **Acceptance**: Session detail page header shows the session title (or truncated ID if none)

### Phase 6: Tests

- [ ] 10. **Add DB repository tests for `updateSessionTitle`**
  **What**: Add tests in the existing db-repository test file
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **Details**:
  - Add test: "UpdatesSessionTitle" — insert a session, call `updateSessionTitle`, verify with `getSession`
  - Add test: "InsertsSessionWithNullTitleByDefault" — insert without title, verify `title` is `null` (update existing "Untitled" test at L236)
  - Update existing test at L236: `expect(sess?.title).toBe("Untitled")` → `expect(sess?.title).toBeNull()`
  **Acceptance**: `npm test -- src/lib/server/__tests__/db-repository.test.ts` passes

- [ ] 11. **Add PATCH endpoint tests**
  **What**: Add tests for the new PATCH handler in the sessions route test file
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Details**:
  - Import `PATCH` from the route
  - Add mock for `updateSessionTitle`
  - Test cases:
    - Returns 400 for invalid JSON body
    - Returns 400 when `title` is missing or empty string
    - Returns 404 when session not found
    - Returns 200 and calls `updateSessionTitle` with correct args
    - Resolves session via `getSessionByOpencodeId` when `getSession` returns undefined (opencode ID lookup)
  - Update the existing stub session test at L485: `expect(body[0].session.title).toBe("Stub Session")` — verify this still works or update if the title default changed
  **Acceptance**: `npm test -- src/app/api/sessions/__tests__/route.test.ts` passes

### Phase 7: Backward Compatibility

- [ ] 12. **Handle existing "Untitled" sessions in the DB**
  **What**: Existing sessions with `title = 'Untitled'` should display as truncated session IDs (not the literal string "Untitled"). The utility function from TODO 8 handles this.
  **Files**: No additional files — covered by the `sessionDisplayTitle` utility from TODO 8
  **Details**:
  - The `sessionDisplayTitle` helper already treats `"Untitled"` the same as `null`
  - Optionally: add a one-time migration in `database.ts` to set `title = NULL WHERE title = 'Untitled'` for cleanup, but this is cosmetic — the UI handles it either way
  - Consider adding: `try { db.exec("UPDATE sessions SET title = NULL WHERE title = 'Untitled'"); } catch { /* ignore */ }` in the migrations section of `database.ts`
  **Acceptance**: Existing sessions with "Untitled" title show truncated ID in all UI surfaces

## Verification
- [ ] `npm run build` completes without TypeScript errors
- [ ] `npm test` — all existing tests pass, new tests pass
- [ ] Manual: Create a new session → sidebar shows truncated session ID (not "Untitled")
- [ ] Manual: Right-click session in sidebar → Rename → type name → Enter → sidebar shows new name
- [ ] Manual: Double-click session name in sidebar → rename inline
- [ ] Manual: Navigate to session detail page → header shows the session title (or truncated ID)
- [ ] Manual: Rename a session → refresh page → name persists
- [ ] No regressions in workspace rename functionality
