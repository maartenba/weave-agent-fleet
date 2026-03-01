# Workspace Roots Settings UI

## TL;DR
> **Summary**: Add a "Workspace Roots" tab to the existing Settings page that lets users view, add, and remove allowed workspace roots. User-added roots persist in SQLite; env-var roots remain as locked system roots. The directory picker and session creation immediately reflect changes.
> **Estimated Effort**: Medium

## Context
### Original Request
Users hit "Directory is outside the allowed workspace roots" errors with no idea how to fix them. The only way to configure workspace roots is via the `ORCHESTRATOR_WORKSPACE_ROOTS` env var, which is invisible in the UI. Windows users on multi-drive setups are especially affected — they can't browse to `D:\` if the default root is `C:\Users\<name>`.

### Key Findings

1. **Settings page already exists** at `src/app/settings/page.tsx` with a tab layout (`Skills`, `Agents`, `About`). Adding a `Workspace Roots` tab fits naturally.

2. **SQLite database already exists** (`~/.weave/fleet.db`) with `better-sqlite3`. No ORM. All DB functions are synchronous, in `src/lib/server/db-repository.ts`, following a pattern of `insertX()`, `getX()`, `listX()`, `deleteX()`. Adding a `workspace_roots` table is trivial.

3. **`getAllowedRoots()` in `src/lib/server/process-manager.ts`** is the single source of truth for workspace roots. It reads only from the env var. This function is called by:
   - `validateDirectory()` (same file) — used by `POST /api/sessions` and `GET /api/directories`
   - `GET /api/directories` route directly — to return `roots` in the response and to validate symlinks

4. **Directory picker flow**: `DirectoryPicker` → `useDirectoryBrowser` hook → `GET /api/directories` → `getAllowedRoots()`. The hook stores `roots` in state and shows them as the top-level entries when no path is selected (the "Roots" view). After changes, the picker needs to re-fetch to see new roots.

5. **Config API pattern**: `GET /api/config` returns config data, `PUT /api/config` updates it. The existing `useConfig` hook follows a `fetchConfig()` + `updateConfig()` pattern. Workspace roots are a different concern from skill/agent config, so they deserve their own API endpoint.

6. **API conventions**: Next.js App Router. Routes return `NextResponse.json()`. Error format is `{ error: string }`. Status codes: 200 for success, 400 for validation, 500 for server errors.

7. **Test patterns**: Vitest with `vi.mock()` for module mocking. DB tests use `WEAVE_DB_PATH` pointed at a temp file, reset between tests. API route tests mock `process-manager` and `fs` modules.

8. **UI patterns**: Cards (`Card`/`CardContent`) for settings sections. `Button`, `Input` from shadcn/ui. Loading state with `Loader2` spinner. Error display with red text + `AlertCircle` icon. Badge for counts. `Lock` icon available from `lucide-react` for system roots.

## Objectives
### Core Objective
Allow users to manage workspace roots from the Settings UI so they never need to know about the `ORCHESTRATOR_WORKSPACE_ROOTS` env var.

### Deliverables
- [ ] SQLite table for persisted user workspace roots
- [ ] DB repository functions (CRUD) for workspace roots
- [ ] Updated `getAllowedRoots()` that merges env-var roots + DB roots
- [ ] API endpoints for workspace roots management
- [ ] Settings UI tab for viewing/adding/removing workspace roots
- [ ] Enhanced error message with link to settings when directory validation fails
- [ ] Tests for all new code

### Definition of Done
- [ ] `npx vitest run` passes with no failures
- [ ] User can add a new root in Settings → Workspace Roots, then browse to it in the directory picker
- [ ] Env-var roots appear as locked (non-removable) in the UI
- [ ] Removing a user root from Settings removes it from the directory picker's root list
- [ ] The "outside allowed workspace roots" error includes a link/hint to Settings
- [ ] No regressions in existing tests

### Guardrails (Must NOT)
- Must NOT remove env-var support — it remains as baseline/override
- Must NOT introduce a separate config file — use the existing SQLite DB
- Must NOT change the directory picker's browse UX — only the roots list changes
- Must NOT allow adding roots that don't exist on the filesystem

## TODOs

- [ ] 1. **Add `workspace_roots` table to the database schema**
  **What**: Add a new table `workspace_roots` with columns `id TEXT PRIMARY KEY`, `path TEXT NOT NULL UNIQUE`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`. Add the `CREATE TABLE IF NOT EXISTS` to the schema block in `getDb()`. This is the simplest migration approach matching the existing codebase pattern (no migration files — just `CREATE TABLE IF NOT EXISTS`).
  **Files**: `src/lib/server/database.ts` (modify — add table creation in the schema `db.exec()` block)
  **Acceptance**: Table is created on DB init. Existing tables unaffected.

- [ ] 2. **Add DB repository functions for workspace roots**
  **What**: Add CRUD functions following the existing repository pattern:
  - `insertWorkspaceRoot(root: { id: string; path: string }): void`
  - `listWorkspaceRoots(): DbWorkspaceRoot[]`
  - `deleteWorkspaceRoot(id: string): boolean`
  - `getWorkspaceRootByPath(path: string): DbWorkspaceRoot | undefined`
  
  Also add the `DbWorkspaceRoot` interface:
  ```typescript
  export interface DbWorkspaceRoot {
    id: string;
    path: string;
    created_at: string;
  }
  ```
  **Security**: All queries involving `path` MUST use parameterized prepared statements (`@path` bind parameters), never string interpolation. This is the first time arbitrary user input flows into the database — SQL injection must be impossible by construction.
  **Files**: `src/lib/server/db-repository.ts` (modify — add new section at the end)
  **Acceptance**: Functions compile and work with the new table. No changes to existing functions. All queries use prepared statements with bind parameters.

- [ ] 3. **Update `getAllowedRoots()` to merge env-var and DB roots**
  **What**: Modify `getAllowedRoots()` in `process-manager.ts` to return the union of env-var roots and DB-persisted roots, deduplicated by resolved path. The function currently returns env-var roots or `[homedir()]`. After this change:
  ```typescript
  export function getAllowedRoots(): string[] {
    // 1. Get env-var roots (or default homedir)
    const envRoots = getEnvRoots();
    
    // 2. Get DB roots
    let dbRoots: string[] = [];
    try {
      dbRoots = listWorkspaceRoots().map(r => r.path);
    } catch {
      // DB not available — skip
    }
    
    // 3. Merge and deduplicate by resolved path
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const root of [...envRoots, ...dbRoots]) {
      const resolved = resolve(root);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        merged.push(resolved);
      }
    }
    return merged;
  }
  ```
  
  Also extract a new `getEnvRoots()` function (not exported, or exported for test use) so the API layer can distinguish env-var roots from user roots when rendering the UI.
  
  Export a new function `getEnvRoots(): string[]` that returns ONLY the env-var roots (for UI distinction):
  ```typescript
  export function getEnvRoots(): string[] {
    const envRoots = process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
    if (envRoots) {
      const separator = process.platform === "win32" ? ";" : ":";
      return envRoots.split(separator).map((r) => resolve(r.trim())).filter(Boolean);
    }
    return [resolve(homedir())];
  }
  ```
  **Files**: `src/lib/server/process-manager.ts` (modify — refactor `getAllowedRoots()`, add `getEnvRoots()`)
  **Acceptance**: `getAllowedRoots()` returns merged roots. `getEnvRoots()` returns only env/default roots. All existing tests still pass (they set the env var and don't use DB).

- [ ] 4. **Create API route for workspace roots**
  **What**: Create `GET /api/workspace-roots` and `POST /api/workspace-roots` and `DELETE /api/workspace-roots/[id]` following existing API patterns.

  **`GET /api/workspace-roots`** — returns all roots with source metadata:
  ```typescript
  // Response shape:
  interface WorkspaceRootsResponse {
    roots: Array<{
      id: string | null;    // null for env-var roots
      path: string;
      source: "env" | "user";
      exists: boolean;       // filesystem check
    }>;
  }
  ```
  Implementation: get env roots via `getEnvRoots()`, get DB roots via `listWorkspaceRoots()`, merge/deduplicate, mark each with source. For roots present in both env and DB, mark as `"env"` (env takes precedence).

  **`POST /api/workspace-roots`** — adds a new user root:
  ```typescript
  // Request body: { path: string }
  // Validation (in order):
  //   1. path must be a non-empty string
  //   2. path must be absolute (isAbsolute() check)
  //   3. path must exist on the filesystem (existsSync check)
  //   4. path must be a directory (statSync().isDirectory() check)
  //   5. SECURITY: call resolve() to normalize traversal segments (e.g. /home/../etc → /etc)
  //   6. SECURITY: call realpathSync() to resolve symlinks to the real target path
  //      (prevents symlink-based escapes: e.g. /home/user/link → / would store "/" not the symlink)
  //   7. Store the resolved real path, NOT the user-submitted path
  //   8. path (after resolution) must not already be in the roots list (dedup against both env + DB roots)
  // Response: { id: string, path: string } with status 201
  //   (path in response is the resolved/stored path, which may differ from the submitted path)
  ```
  
  Pseudocode for the security-critical validation chain:
  ```typescript
  const raw = body.path;
  if (!isAbsolute(raw)) return 400;
  if (!existsSync(raw)) return 400;
  if (!statSync(raw).isDirectory()) return 400;
  const resolved = resolve(raw);           // normalize ../
  const realPath = realpathSync(resolved);  // resolve symlinks
  // Store realPath, not raw or resolved
  ```

  **`DELETE /api/workspace-roots/[id]`** — removes a user root:
  ```typescript
  // Validation: root must exist in DB (can't delete env roots)
  // Response: { ok: true } with status 200
  // 404 if not found
  ```
  
  **Files**:
  - `src/app/api/workspace-roots/route.ts` (create)
  - `src/app/api/workspace-roots/[id]/route.ts` (create)
  **Acceptance**: API returns merged roots list with source labels. Can add/remove user roots. Cannot remove env roots.

- [ ] 5. **Create client-side hook for workspace roots**
  **What**: Create `useWorkspaceRoots()` hook following the `useConfig()` pattern:
  ```typescript
  interface WorkspaceRoot {
    id: string | null;
    path: string;
    source: "env" | "user";
    exists: boolean;
  }
  
  interface UseWorkspaceRootsResult {
    roots: WorkspaceRoot[];
    isLoading: boolean;
    error: string | null;
    addRoot: (path: string) => Promise<void>;
    removeRoot: (id: string) => Promise<void>;
    refresh: () => Promise<void>;
  }
  ```
  The hook fetches from `GET /api/workspace-roots`, and `addRoot`/`removeRoot` call `POST`/`DELETE` then re-fetch.
  **Files**: `src/hooks/use-workspace-roots.ts` (create)
  **Acceptance**: Hook fetches roots on mount, supports add/remove with optimistic error handling.

- [ ] 6. **Create WorkspaceRootsTab settings component**
  **What**: Create a new tab component following the pattern of `SkillsTab` and `AboutTab`. Layout:
  
  ```
  ┌─────────────────────────────────────────────┐
  │  Workspace Roots                            │
  │  3 roots configured          [+ Add Root]   │
  │                                             │
  │  ┌─ /home/user ───────────────── 🔒 ──────┐ │
  │  │  System root (from env)                 │ │
  │  └─────────────────────────────────────────┘ │
  │  ┌─ /projects ────────────────── 🔒 ──────┐ │
  │  │  System root (from env)                 │ │
  │  └─────────────────────────────────────────┘ │
  │  ┌─ D:\work ──────────────────── ✕ ───────┐ │
  │  │  User root                              │ │
  │  └─────────────────────────────────────────┘ │
  │                                             │
  │  ℹ System roots from ORCHESTRATOR_WORKSPACE │
  │    _ROOTS env var cannot be removed here.   │
  └─────────────────────────────────────────────┘
  ```
  
  - Each root shown in a `Card` with path, source badge, and remove button (only for user roots)
  - "Add Root" button opens inline form or small dialog with a text input for the path (optionally with the `DirectoryPicker`... but note: the directory picker itself uses workspace roots for browsing, so using it here creates a chicken-and-egg issue. Use a plain text input instead.)
  - Validation feedback: show error if path doesn't exist or is already added
  - Lock icon (`Lock` from lucide) for env roots, `X` button for user roots
  - Warning badge if a root path doesn't exist on the filesystem
  
  **Files**: `src/components/settings/workspace-roots-tab.tsx` (create)
  **Acceptance**: Tab renders correctly with env and user roots distinguished. Add/remove functionality works.

- [ ] 7. **Add WorkspaceRootsTab to the Settings page**
  **What**: Add the new tab to the settings page tab list. Insert it as the first or second tab (before "Skills") since workspace roots is a more foundational setting.
  ```tsx
  import { WorkspaceRootsTab } from "@/components/settings/workspace-roots-tab";
  // ...
  <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
  // ...
  <TabsContent value="workspaces" className="mt-4">
    <WorkspaceRootsTab />
  </TabsContent>
  ```
  **Files**: `src/app/settings/page.tsx` (modify)
  **Acceptance**: Settings page shows new "Workspaces" tab. All existing tabs still work.

- [ ] 8. **Enhance the "outside allowed workspace roots" error with settings link**
  **What**: In the `new-session-dialog.tsx`, detect the specific error message "Directory is outside the allowed workspace roots" and render it with a link to `/settings` (or specifically to the workspaces tab via `?tab=workspaces`). This directly solves the discoverability problem.
  
  The error display currently uses:
  ```tsx
  {error && (
    <div className="...">
      <AlertCircle className="..." />
      <span>{error}</span>
    </div>
  )}
  ```
  
  Enhance to:
  ```tsx
  {error && (
    <div className="...">
      <AlertCircle className="..." />
      <span>
        {error}
        {error.includes("outside the allowed workspace roots") && (
          <>
            {" "}
            <Link href="/settings?tab=workspaces" className="underline hover:text-red-300">
              Manage workspace roots in Settings
            </Link>
          </>
        )}
      </span>
    </div>
  )}
  ```
  
  Also update the Settings page to support `?tab=workspaces` query param to pre-select the tab:
  ```tsx
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "workspaces";
  // ...
  <Tabs defaultValue={defaultTab}>
  ```
  
  **Files**:
  - `src/components/session/new-session-dialog.tsx` (modify)
  - `src/app/settings/page.tsx` (modify — support `tab` query param)
  **Acceptance**: Error message includes clickable link to settings. Link navigates to the Workspaces tab.

- [ ] 9. **Add API types for workspace roots**
  **What**: Add the shared request/response types to `api-types.ts`:
  ```typescript
  // ─── Workspace Roots Types ─────────────────────────────────────────────────
  
  export interface WorkspaceRootItem {
    id: string | null;
    path: string;
    source: "env" | "user";
    exists: boolean;
  }
  
  export interface WorkspaceRootsResponse {
    roots: WorkspaceRootItem[];
  }
  
  export interface AddWorkspaceRootRequest {
    path: string;
  }
  
  export interface AddWorkspaceRootResponse {
    id: string;
    path: string;
  }
  ```
  **Files**: `src/lib/api-types.ts` (modify — add section)
  **Acceptance**: Types compile and are used by API route and hook.

- [ ] 10. **Write tests for DB repository functions**
  **What**: Add tests for the new workspace roots DB functions, following the pattern in `db-repository.test.ts`:
  - `InsertAndRetrieveWorkspaceRoot`
  - `ListWorkspaceRootsReturnsAllInserted`
  - `ListWorkspaceRootsReturnsEmptyWhenNone`
  - `DeleteWorkspaceRootReturnsTrueWhenDeleted`
  - `DeleteWorkspaceRootReturnsFalseForNonexistent`
  - `GetWorkspaceRootByPathFindsExistingRoot`
  - `GetWorkspaceRootByPathReturnsUndefinedForMissing`
  - `InsertDuplicatePathThrowsUniqueConstraint`
  **Files**: `src/lib/server/__tests__/db-repository.test.ts` (modify — add new describe block)
  **Acceptance**: All new tests pass.

- [ ] 11. **Write tests for the workspace roots API route**
  **What**: Test the API routes following the `directories/route.test.ts` pattern:
  - `GET returns env roots with source "env"`
  - `GET returns user roots with source "user"`
  - `GET deduplicates env and user roots`
  - `POST adds a new root and returns 201`
  - `POST returns 400 for non-absolute path`
  - `POST returns 400 for nonexistent directory`
  - `POST returns 409 for duplicate root`
  - `DELETE removes a user root and returns 200`
  - `DELETE returns 404 for nonexistent root`
  
  **Security test cases** (path traversal and symlink escape prevention):
  - `POST normalizes path traversal segments before storing` — submit `/tmp/foo/../bar`, assert the stored path is `resolve("/tmp/bar")` (the `..` is resolved away). Verify the response `path` field matches the resolved form.
  - `POST resolves symlinks before storing` — create a symlink `/tmp/test-link → /tmp/real-dir`, submit `/tmp/test-link`, assert the stored path is `/tmp/real-dir` (the real path, not the symlink). This prevents a user from adding a symlink that later gets retargeted to an arbitrary directory.
  - `POST deduplicates after resolution` — if `/tmp/real-dir` is already a root and the user submits `/tmp/test-link` (symlink to `/tmp/real-dir`), return 409 because after `realpathSync()` they resolve to the same path.
  
  **Files**: `src/app/api/workspace-roots/__tests__/route.test.ts` (create)
  **Acceptance**: All tests pass, including security tests.

- [ ] 12. **Write tests for updated `getAllowedRoots()` and `getEnvRoots()`**
  **What**: Update `process-manager.test.ts` to test the new behavior:
  - `getAllowedRoots returns env roots when no DB roots exist` (existing behavior)
  - `getAllowedRoots merges env and DB roots`
  - `getAllowedRoots deduplicates by resolved path`
  - `getEnvRoots returns only env-var roots`
  - `getEnvRoots returns homedir when env var is unset`
  
  Need to handle the DB dependency in tests — either use a real temp DB (matching existing test pattern) or mock `listWorkspaceRoots`.
  **Files**: `src/lib/server/__tests__/process-manager.test.ts` (modify — add new describe blocks)
  **Acceptance**: All existing and new tests pass.

- [ ] 13. **Update the database test to verify the new table**
  **What**: Add a test case to `database.test.ts` following the existing pattern:
  ```typescript
  it("CreatesWorkspaceRootsTable", () => {
    const db = getDb();
    const result = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_roots'")
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("workspace_roots");
  });
  ```
  **Files**: `src/lib/server/__tests__/database.test.ts` (modify)
  **Acceptance**: Test passes.

## Verification
- [ ] All tests pass: `npx vitest run`
- [ ] No regressions: existing functionality unchanged
- [ ] Manual smoke test: add a root via Settings → see it in directory picker → create session under new root
- [ ] Manual smoke test: attempt to create session outside roots → see error with settings link → click link → add root → retry succeeds
- [ ] TypeScript compiles cleanly: `npx tsc --noEmit`

## Implementation Order

The tasks have these dependencies:
```
1 (DB schema) → 2 (DB repository) → 3 (getAllowedRoots refactor) → 4 (API routes)
                                                                     ↓
9 (API types) ──────────────────────────────────────────────────→ 5 (hook) → 6 (UI component) → 7 (settings page integration)
                                                                                                        ↓
                                                                                               8 (error enhancement)

Tests (10, 11, 12, 13) can be written alongside their corresponding implementation tasks.
```

Recommended build order: **1 → 2 → 10 → 13 → 3 → 12 → 9 → 4 → 11 → 5 → 6 → 7 → 8**

## Notes

- **No `DirectoryPicker` reuse for adding roots**: The directory picker uses `getAllowedRoots()` to constrain browsing, so using it to add new roots would be circular. A plain text input with path validation is the right approach.
- **Windows drive support**: On Windows, users can type paths like `D:\projects` directly. The validation just checks `existsSync()` + `statSync().isDirectory()`, which works for any drive letter.
- **No config file**: Roots are stored in SQLite (`~/.weave/fleet.db`), not in `weave-opencode.jsonc`. The config file is for skill/agent config. SQLite is the right persistence layer for runtime configuration managed by the app itself.
- **`getAllowedRoots()` performance**: It now does a DB read on every call. Since `better-sqlite3` is synchronous and the query is trivial (SELECT from a small table), this has negligible performance impact. The function is called once per API request, not in a hot loop.
