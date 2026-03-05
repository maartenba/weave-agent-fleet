# Session Rename

## TL;DR
> **Summary**: Add session rename capability — DB function, API endpoint, client hook, and inline-edit UI in the sidebar session item — mirroring the existing workspace rename pattern.
> **Estimated Effort**: Medium

**GitHub Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/9

## Context

### Original Request
Issue #9 tracks session organization features. Search, filtering, sorting, grouping, and workspace rename are already shipped. The remaining work is **session rename** — allowing users to rename sessions via inline editing in the sidebar and context menu.

### Key Findings

1. **Workspace rename is fully implemented and serves as the blueprint**:
   - `updateWorkspaceDisplayName()` in `db-repository.ts` (line 116) — sync better-sqlite3 UPDATE
   - `PATCH /api/workspaces/[id]` in `src/app/api/workspaces/[id]/route.ts` — validates body, calls DB, returns `{ id, displayName }`
   - `useRenameWorkspace()` hook in `src/hooks/use-rename-workspace.ts` — `useState` + `fetch(PATCH)` pattern with `isLoading`/`error`/`onSuccess`
   - `SidebarWorkspaceItem` wires `InlineEdit` + `ContextMenu` with a "Rename" option and `isRenaming` state

2. **`sessions.title` column already exists** (line 72 of `database.ts`): `title TEXT NOT NULL DEFAULT 'Untitled'`. The `DbSession` type has `title: string`. The `insertSession` function defaults title to `"Untitled"` if not provided. **No schema migration needed**.

3. **No `updateSessionTitle` function exists** in `db-repository.ts`. The only session update functions are `updateSessionStatus()` and `updateSessionForResume()`.

4. **`sessions/[id]/route.ts` already has GET and DELETE handlers** (273 lines). A PATCH handler must be **added to this existing file**, not a new file.

5. **`SidebarSessionItem` is a simple `<Link>` component** (48 lines) — no context menu, no inline editing, no state. It receives a `SessionListItem` and renders a status dot + title. Title fallback: `session.title || session.id.slice(0, 12)`.

6. **`InlineEdit` component** (`src/components/ui/inline-edit.tsx`) supports controlled editing state via `editing`/`onEditingChange` props — same pattern used in `SidebarWorkspaceItem`.

7. **The SDK `Session` type has `title?: string`** (optional). The session object in `SessionListItem.session` comes from the OpenCode SDK, so renaming must update the **Fleet DB title** (not the SDK session). The title displayed in the sidebar comes from `session.title` which is the SDK session's title. However, looking at the API flow:
   - `POST /api/sessions` creates the Fleet DB row with `title: session.title ?? title ?? "New Session"`
   - The sidebar's `SidebarSessionItem` reads `item.session.title` (SDK title)
   - The live card reads `session.title || session.id.slice(0, 12)` (SDK title)

   **Key insight**: The rename must update the Fleet DB `sessions.title`, but the sidebar currently reads from the SDK's `session.title`. The approach should be: (a) update the Fleet DB title, (b) have the session list API enrich the response with the DB title as an override when it differs from the SDK title, or (c) more simply — the sessions list already builds from the DB, so we need to check how the title flows.

8. **Session list title flow**: In `GET /api/sessions` (`src/app/api/sessions/route.ts`), the response builds `SessionListItem` objects. The `session` field comes from the OpenCode SDK client's `session.list()`. The SDK `session.title` is what the sidebar displays. However, the Fleet DB also stores a `title`. After renaming in the DB, we need the renamed title to appear in the UI.

   **Approach**: Add a `customTitle` field (or just `title` override) to `SessionListItem`. When the user renames a session, the DB title is updated. The `GET /api/sessions` handler should check if the DB title differs from the SDK title and expose it. The sidebar item should prefer the custom/DB title over the SDK title. Alternatively: just override `session.title` in the response with the DB title when a rename has occurred.

9. **`useSessionsContext()` exposes `refetch`** — after rename, call `refetch()` to refresh the session list (same pattern as workspace rename).

10. **Context menu components** are already installed: `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuTrigger` from `src/components/ui/context-menu.tsx`.

### Architecture Decision: Title Override Strategy

The cleanest approach: add a `customTitle: string | null` field to `SessionListItem`. The `GET /api/sessions` handler looks up the Fleet DB session and, if `db.title !== "Untitled"` and `db.title !== sdk.session.title`, sets `customTitle = db.title`. The sidebar and card components render `item.customTitle ?? item.session.title ?? item.session.id.slice(0, 12)`.

**Simpler alternative** (preferred): In the `GET /api/sessions` handler, when building the response, mutate the `session.title` on the response object to use the DB title if it was explicitly renamed. This way no new field is needed — the existing `session.title` rendering throughout the UI "just works". To know if a rename happened, we check `db.title !== "Untitled"` — but this is fragile. Better: make `sessions.title` nullable in the DB (via migration). When null → "never renamed" (use SDK title). When non-null → user renamed (use DB title). This is what the issue suggests.

**Final decision**: Make `sessions.title` nullable. Migration: `ALTER TABLE sessions ALTER COLUMN title` — but SQLite doesn't support ALTER COLUMN. Instead: the default is already `'Untitled'` and current insert uses `sess.title ?? "Untitled"`. We can change the insert to use `null` as default and update the column default. But changing an existing NOT NULL column in SQLite is complex. 

**Pragmatic approach**: Keep `title NOT NULL DEFAULT 'Untitled'`. Treat `"Untitled"` as "never renamed". When `updateSessionTitle` is called, it sets the DB title. The `GET /api/sessions` handler already passes through the SDK session object — we just need to overlay the DB title onto `session.title` in the response. Currently the sessions route doesn't look up DB sessions for each entry in the list (it builds from the DB directly for active sessions). Let me re-read the sessions route to confirm.

Let me trace the full flow more carefully:

**Session list flow** (from `GET /api/sessions`): The handler iterates over running instances, calls `client.session.list()` for each, then for each SDK session, looks up the DB session to get `workspaceId`, `sessionStatus`, etc. The response's `session` field is the raw SDK `Session` object. To overlay the renamed title, the handler should replace `session.title` with the DB title if it's not `"Untitled"`.

This is the simplest approach — zero changes to `SessionListItem` type, zero changes to rendering logic. Just one line in the sessions route to overlay the title.

## Objectives

### Core Objective
Allow users to rename sessions via context menu or double-click in the sidebar, with the rename persisted to the Fleet database and reflected everywhere sessions are displayed.

### Deliverables
- [x] `updateSessionTitle()` function in `db-repository.ts`
- [x] `PATCH /api/sessions/[id]` handler added to existing route file
- [x] `useRenameSession()` client hook
- [x] Context menu with "Rename" option on `SidebarSessionItem`
- [x] `InlineEdit` integration in `SidebarSessionItem`
- [x] Title overlay in `GET /api/sessions` response so renamed titles appear everywhere
- [x] Test coverage for the PATCH endpoint

### Definition of Done
- [x] `npm run build` passes with no errors
- [x] `npm run lint` passes with no errors
- [x] `npm run test` passes with no regressions
- [x] Right-click on a session in sidebar → "Rename" → inline edit appears → Enter saves → title persists across refresh
- [x] Double-click on session title in sidebar → inline edit appears → same save behavior
- [x] Renamed title appears in sidebar, Fleet page cards, and Fleet page search results
- [x] Escape cancels rename, empty string reverts to original

### Guardrails (Must NOT)
- Must NOT change the `SessionListItem` type signature (no new fields needed)
- Must NOT add new polling intervals — reuse `useSessionsContext().refetch`
- Must NOT modify the SDK `Session` type
- Must NOT break existing session navigation (`/sessions/[id]?instanceId=...`)
- Must NOT change the database schema (no ALTER TABLE needed — `title` column already exists)
- Must NOT modify the History page

## TODOs

- [x] 1. Add `updateSessionTitle()` to `db-repository.ts`
  **What**: Add a new function to update the session's title in the Fleet DB. Follows the exact pattern of `updateWorkspaceDisplayName()`.
  **Files**: `src/lib/server/db-repository.ts`
  **Implementation**:
  ```typescript
  export function updateSessionTitle(id: string, title: string): void {
    getDb()
      .prepare("UPDATE sessions SET title = @title WHERE id = @id")
      .run({ id, title });
  }
  ```
  Place it after the existing `updateSessionForResume()` function (around line 239).
  **Acceptance**: Function exists, compiles, updates the `title` column for a given session ID.

- [x] 2. Add `PATCH` handler to `src/app/api/sessions/[id]/route.ts`
  **What**: Add a PATCH export to the existing sessions `[id]` route file. Mirrors the workspace PATCH handler pattern exactly.
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Implementation**:
  - Import `updateSessionTitle` from `db-repository`
  - Add `PATCH` export function that:
    1. Extracts `id` from route params
    2. Parses JSON body, validates `title` is a non-empty string
    3. Looks up session via `getSession(id)` — 404 if not found
    4. Calls `updateSessionTitle(id, title)`
    5. Returns `{ id, title }` with 200
  - Error handling: 400 for invalid body, 404 for session not found, 500 for DB errors
  **Key differences from workspace PATCH**:
  - Field name is `title` (not `displayName`)
  - Uses `getSession()` (not `getWorkspace()`)
  - Uses `updateSessionTitle()` (not `updateWorkspaceDisplayName()`)
  **Acceptance**: `curl -X PATCH /api/sessions/<id> -H 'Content-Type: application/json' -d '{"title":"My Session"}'` returns `200 { id, title }`. Invalid body returns 400. Unknown ID returns 404.

- [x] 3. Overlay DB title in `GET /api/sessions` response
  **What**: In the sessions list API handler, when building each `SessionListItem`, overlay the DB session's `title` onto the SDK `session.title` if the DB title is not `"Untitled"`. This ensures renamed titles appear in the sidebar, Fleet page cards, and search without any UI changes.
  **Files**: `src/app/api/sessions/route.ts`
  **Implementation**: Find where the SDK session object is assembled into the response. After looking up the DB session (which is already done to get `sessionStatus`, `workspaceId`, etc.), add:
  ```typescript
  // Overlay user-renamed title from Fleet DB
  if (dbSession && dbSession.title !== "Untitled") {
    session.title = dbSession.title;
  }
  ```
  **Note**: The SDK `Session` type has `title?: string`, so assignment is valid. This mutates the response object (not the cached SDK data). Must be careful to clone or only mutate after the object is constructed for the response.
  **Acceptance**: After renaming a session via PATCH, the next `GET /api/sessions` response shows the renamed title in `session.title`. Sessions that were never renamed continue showing the SDK title.

- [x] 4. Create `useRenameSession()` hook
  **What**: Client-side hook for the session rename mutation. Identical pattern to `use-rename-workspace.ts`.
  **Files**: `src/hooks/use-rename-session.ts` (new file)
  **Implementation**:
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
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const renameSession = async (
      sessionId: string,
      title: string,
      onSuccess?: () => void
    ): Promise<void> => {
      setIsLoading(true);
      setError(undefined);

      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          }
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${response.status}`
          );
        }

        onSuccess?.();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to rename session";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    };

    return { renameSession, isLoading, error };
  }
  ```
  **Acceptance**: Hook compiles, calls `PATCH /api/sessions/[id]` with `{ title }`, returns loading/error state. `onSuccess` fires after successful rename.

- [x] 5. Wire `InlineEdit` and context menu into `SidebarSessionItem`
  **What**: Transform `SidebarSessionItem` from a simple `<Link>` into a component with inline rename and context menu support, following the `SidebarWorkspaceItem` pattern.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Implementation**:
  - Add imports: `useState`, `useCallback` from React; `Pencil` from lucide-react; `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuTrigger` from context-menu; `InlineEdit` from inline-edit; `useRenameSession` from hook; `useSessionsContext` from context
  - Add state: `const [isRenaming, setIsRenaming] = useState(false);`
  - Add hooks: `const { renameSession } = useRenameSession();` and `const { refetch } = useSessionsContext();`
  - Add handler:
    ```typescript
    const handleRename = useCallback(
      async (newTitle: string) => {
        try {
          // Use the Fleet DB session ID for the PATCH call
          const dbId = item.dbId ?? item.session.id;
          await renameSession(dbId, newTitle, refetch);
        } catch {
          // error surfaced inside useRenameSession
        }
      },
      [item.dbId, item.session.id, renameSession, refetch]
    );
    ```
  - Wrap the existing `<Link>` with `<ContextMenu>` / `<ContextMenuTrigger>` (using `asChild`)
  - Replace the title `<span>` with `<InlineEdit>`:
    ```tsx
    <InlineEdit
      value={title}
      onSave={handleRename}
      editing={isRenaming}
      onEditingChange={setIsRenaming}
      className="text-xs truncate block"
    />
    ```
  - Add `<ContextMenuContent>` with a single "Rename" item:
    ```tsx
    <ContextMenuContent>
      <ContextMenuItem
        onClick={() => setIsRenaming(true)}
        className="gap-2 text-xs"
      >
        <Pencil className="h-3.5 w-3.5" />
        Rename
      </ContextMenuItem>
    </ContextMenuContent>
    ```
  - Prevent link navigation when renaming (same pattern as workspace item):
    ```tsx
    onClick={(e) => { if (isRenaming) e.preventDefault(); }}
    ```
  - Add hidden rename trigger for F2 keyboard shortcut:
    ```tsx
    <button
      data-rename-trigger
      className="sr-only"
      tabIndex={-1}
      onClick={() => setIsRenaming(true)}
      aria-label={`Rename ${title}`}
    />
    ```

  **Pitfalls**:
  - The `<Link>` must not navigate when in rename mode — use `onClick` preventDefault guard
  - The `item.dbId` (Fleet DB session ID) should be used for the PATCH call, not `item.session.id` (OpenCode session ID). `dbId` is already present on `SessionListItem` as an optional field. If `dbId` is undefined (shouldn't happen for active sessions), fall back to `item.session.id`.
  - The context menu must be outside the `<Link>` to prevent navigation on right-click

  **Acceptance**: Right-click on session in sidebar → "Rename" menu item → inline edit appears → Enter saves → title updates after `refetch()`. Double-click also enters edit mode. Escape cancels. F2 keyboard shortcut works via the hidden trigger (existing sidebar keyboard navigation already dispatches click on `[data-rename-trigger]`).

- [x] 6. Add tests for the PATCH endpoint
  **What**: Add test cases for the new PATCH handler to the existing test file for session `[id]` route.
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Implementation**: Add a new `describe("PATCH /api/sessions/[id]")` block with tests:
  - **200**: Valid rename — mock `getSession` to return a session, mock `updateSessionTitle`, verify response `{ id, title }`
  - **400**: Missing body / invalid JSON
  - **400**: Missing `title` field
  - **400**: Empty string `title`
  - **404**: Session not found (mock `getSession` returning undefined)
  - **500**: DB error during update

  Must add `updateSessionTitle` to the `vi.mock("@/lib/server/db-repository")` block at the top, and import `PATCH` from `@/app/api/sessions/[id]/route`.
  **Acceptance**: All new tests pass. Existing tests continue to pass.

## Verification
- [x] `npm run build` passes with no errors
- [x] `npm run lint` passes with no errors
- [x] `npm run test` passes with no regressions
- [x] New PATCH endpoint tests pass
- [x] Sidebar session items show context menu with "Rename" on right-click
- [x] Double-click session title enters inline edit mode
- [x] Renamed title persists across page refresh (appears in sidebar, Fleet cards, search)
- [x] No duplicate API requests (rename uses existing `refetch` from SessionsContext)
