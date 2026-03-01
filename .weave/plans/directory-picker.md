# Add Directory Picker to New Session Dialog

## TL;DR
> **Summary**: Add a browsable directory picker to the New Session dialog, backed by a new `GET /api/directories` endpoint that lists subdirectories under allowed workspace roots. Users can browse, search, and select directories instead of typing paths manually.
> **Estimated Effort**: Medium

## Context
### Original Request
Issue #22 — When creating a new session, users currently type directory paths manually into a plain `<Input>`. Add a directory picker that lets users browse and select directories visually, while preserving the ability to type paths directly.

### Key Findings
1. **New Session Dialog** (`src/components/session/new-session-dialog.tsx`) — Uses a `Sheet` (slide-out panel) with `useState` for form fields (`directory`, `title`, `isolationStrategy`, `branch`). The directory field is a plain `<Input>` on line 116-123. The `useCreateSession` hook handles API calls.

2. **Security model** — `validateDirectory()` in `process-manager.ts` (line 230) ensures paths are under allowed roots. `getAllowedRoots()` (line 213) reads `ORCHESTRATOR_WORKSPACE_ROOTS` env var (colon-separated), falling back to `$HOME`. **Neither function is exported** — `getAllowedRoots` is private, `validateDirectory` is exported.

3. **Available UI primitives** — The project has Radix UI `Popover`, `Command` (cmdk), `ScrollArea`, `Input`, `Button`, and all Lucide icons. The `autocomplete-popup.tsx` component is an excellent pattern reference — it uses cmdk's `Command` + `CommandList` + `CommandItem` for keyboard-navigable lists with loading/error states.

4. **Data-fetching pattern** — Hooks like `useFindFiles` use `useState` + `useEffect` with debounced `fetch()`, `AbortController` for cancellation, and loading/error state. No SWR or React Query — just vanilla hooks.

5. **API route pattern** — GET routes use `NextRequest`/`NextResponse`, read query params via `request.nextUrl.searchParams`, and follow a consistent error-handling pattern (try/catch with JSON error responses). See `notifications/route.ts` and `instances/[id]/find/files/route.ts`.

6. **Test pattern** — API route tests use `vitest` with `vi.mock()` for server dependencies. Tests import the route handler directly and call it with constructed `NextRequest` objects. Tests are colocated in `__tests__/` directories next to the routes.

7. **No fs-listing utility exists** — There's no existing function to list directory contents. The `find/files` route delegates to the OpenCode SDK's `client.find.files()`, which won't help here since we need to list directories before any instance is spawned.

## Objectives
### Core Objective
Allow users to browse and select directories from allowed workspace roots when creating a new session, while maintaining security constraints and the manual-input fallback.

### Deliverables
- [ ] `GET /api/directories` API route with security-scoped directory listing
- [ ] `useDirectoryBrowser` hook for client-side data fetching and state
- [ ] `DirectoryPicker` component with browsable directory list + text input
- [ ] Integration into `NewSessionDialog` replacing the plain `<Input>`
- [ ] API route tests for `GET /api/directories`
- [ ] API type definitions for the new endpoint

### Definition of Done
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm run test` passes — all existing + new tests green
- [ ] `npm run lint` passes
- [ ] User can browse directories in the New Session dialog
- [ ] User can still type a path manually
- [ ] Paths outside `ORCHESTRATOR_WORKSPACE_ROOTS` cannot be listed
- [ ] Directory picker works correctly with all three isolation strategies (existing, worktree, clone)

### Guardrails (Must NOT)
- Must NOT expose directories outside `ORCHESTRATOR_WORKSPACE_ROOTS`
- Must NOT allow path traversal (`../`) to escape allowed roots
- Must NOT break manual path input — users who prefer typing must still be able to
- Must NOT add new npm dependencies (Radix Popover, cmdk, Lucide are already available)
- Must NOT modify `process-manager.ts` exports beyond adding `getAllowedRoots` to the export list

## TODOs

### Phase 1: Backend — API Route

- [ ] 1. Export `getAllowedRoots` from `process-manager.ts`
  **What**: Change `function getAllowedRoots()` to `export function getAllowedRoots()` so the new API route can reuse it for security validation.
  **Files**: `src/lib/server/process-manager.ts` (line 213)
  **Acceptance**: `getAllowedRoots` appears in the module's exports; existing `validateDirectory` still works; `npm run build` passes.

- [ ] 2. Add API types for the directories endpoint
  **What**: Add `DirectoryEntry` and `DirectoryListResponse` types to `api-types.ts`.
  ```
  DirectoryEntry {
    name: string;           // e.g. "my-project"
    path: string;           // absolute path, e.g. "/home/user/my-project"
    isGitRepo: boolean;     // true if .git exists (useful for worktree/clone strategy hints)
  }
  DirectoryListResponse {
    entries: DirectoryEntry[];
    currentPath: string;    // the resolved absolute path being listed
    parentPath: string | null; // parent path, or null if at an allowed root
    roots: string[];        // the allowed workspace roots (so the UI can show root-level navigation)
  }
  ```
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: Types compile; no downstream breakage.

- [ ] 3. Create `GET /api/directories` route
  **What**: New API route that lists subdirectories under allowed workspace roots.
  - Query params:
    - `path` (optional) — absolute directory path to list. If omitted, returns the allowed roots themselves as entries.
    - `search` (optional) — case-insensitive substring filter on directory names.
  - Security:
    - Reuse `getAllowedRoots()` and `validateDirectory()` from process-manager.
    - If `path` is provided, validate it's under an allowed root before listing.
    - Only return directories (skip files, skip hidden dirs like `.git`, `node_modules`, `.next`).
  - Implementation:
    - Use `fs.readdirSync(path, { withFileTypes: true })` to list entries.
    - Filter to directories only.
    - Skip common noise directories: `.git`, `node_modules`, `.next`, `.cache`, `__pycache__`, `.venv`, `dist`, `build`, `.DS_Store`.
    - Check for `.git` subdirectory existence to set `isGitRepo`.
    - Compute `parentPath`: if the listed path is an allowed root, `parentPath` is `null`; otherwise it's `dirname(path)`.
    - Cap results at 100 entries to prevent massive listings.
    - Apply `search` filter if provided (case-insensitive substring match on entry name).
  - Error handling:
    - 400 if `path` is outside allowed roots (reuse validateDirectory error).
    - 400 if `path` exists but is not a directory.
    - 404 if `path` does not exist.
    - 403 if permission denied (EACCES).
    - 500 for unexpected errors.
  **Files**: `src/app/api/directories/route.ts` (new file)
  **Acceptance**: `curl 'http://localhost:3000/api/directories'` returns roots; `curl 'http://localhost:3000/api/directories?path=/home/user'` returns subdirectories; paths outside allowed roots return 400.

- [ ] 4. Write tests for `GET /api/directories`
  **What**: Vitest tests following the existing route test pattern (mock `process-manager` exports, construct `NextRequest` objects, assert on responses).
  Test cases:
    - Returns allowed roots when no `path` param is provided
    - Returns subdirectories for a valid path under an allowed root
    - Returns 400 for path outside allowed roots
    - Returns 400/404 for nonexistent path
    - Filters hidden/noise directories (`.git`, `node_modules`)
    - Applies `search` filter correctly
    - Sets `isGitRepo` correctly for directories containing `.git`
    - Returns `parentPath: null` when listing an allowed root
    - Returns correct `parentPath` for nested directories
    - Caps results at 100 entries
    - Returns 403 for permission-denied paths (mock `readdirSync` to throw EACCES)
  **Files**: `src/app/api/directories/__tests__/route.test.ts` (new file)
  **Acceptance**: `npm run test -- src/app/api/directories` passes.

### Phase 2: Frontend — Hook

- [ ] 5. Create `useDirectoryBrowser` hook
  **What**: Client-side hook that manages directory browsing state and data fetching.
  - State:
    - `currentPath: string | null` — the path currently being browsed (null = show roots)
    - `entries: DirectoryEntry[]` — listed directories
    - `isLoading: boolean`
    - `error: string | undefined`
    - `roots: string[]` — allowed workspace roots
    - `parentPath: string | null` — for "go up" navigation
  - API:
    - `browse(path: string | null)` — fetch directory listing for the given path
    - `goUp()` — navigate to `parentPath`
    - `refresh()` — re-fetch current path
    - `search: string` / `setSearch(s: string)` — filter text (debounced 200ms)
  - Implementation pattern: follow `useFindFiles` — `useState` + `useEffect`, `AbortController` for cancellation, debounced fetch.
  - On mount, auto-fetch the root listing (`path=null`).
  **Files**: `src/hooks/use-directory-browser.ts` (new file)
  **Acceptance**: Hook compiles; can be called in a component to browse directories.

### Phase 3: Frontend — Component

- [ ] 6. Create `DirectoryPicker` component
  **What**: A composite component that combines a text input with a browsable directory popup. Designed to be a drop-in replacement for the `<Input>` in the New Session dialog.

  **Props**:
  ```
  value: string                    // the currently selected/typed directory path
  onChange: (path: string) => void // callback when path changes
  placeholder?: string            // forwarded to the text input
  disabled?: boolean              // forwarded to the text input
  id?: string                     // forwarded to the text input for label association
  ```

  **UI Structure**:
  - An `<Input>` with a `<Button>` icon trigger (Lucide `FolderOpen` icon) on the right side, wrapped in a flex container.
  - Clicking the button or a keyboard shortcut (Ctrl+Space? or just clicking) opens a `<Popover>` below the input.
  - The popover contains:
    - **Breadcrumb bar**: Shows current path as clickable segments (e.g. `/ > home > user > projects`). Clicking a segment navigates to that directory. The root-level crumb shows the workspace root name.
    - **Search input**: Small search field at top of popover for filtering the current listing. Uses `CommandInput` from cmdk for consistent styling.
    - **Directory list**: Uses `CommandList` + `CommandItem` for keyboard-navigable entries. Each entry shows:
      - `Folder` icon (Lucide)
      - Directory name
      - `GitBranch` icon badge if `isGitRepo` is true
    - **Loading state**: `Loader2` spinner (matches `autocomplete-popup.tsx` pattern)
    - **Error state**: Red text inline (matches existing error display pattern)
    - **Empty state**: "No subdirectories" message
    - **Go up button**: At the top of the list when not at root level, with `ChevronUp` icon and parent path preview
  - Selecting a directory:
    - **Single click**: Navigate into that directory (browse deeper)
    - **Double click** or **Enter on selected item** or **"Select" button**: Confirm selection — set `value` to the directory's absolute path and close the popover.
    - A small "Use this directory" button at the bottom of the popover (always visible) confirms the *current browsed directory* as the selection.
  - The text input remains fully editable — typing a path directly still works. The popover is an *optional* enhancement.

  **Files**: `src/components/session/directory-picker.tsx` (new file)
  **Acceptance**: Component renders; can browse directories; selecting a directory updates the value; manual text input still works; keyboard navigation works (Arrow keys, Enter, Escape).

### Phase 4: Integration

- [ ] 7. Integrate `DirectoryPicker` into `NewSessionDialog`
  **What**: Replace the plain `<Input id="directory" ...>` (lines 116-123 of `new-session-dialog.tsx`) with the new `<DirectoryPicker>` component.
  - Pass `value={directory}`, `onChange={setDirectory}`, `placeholder={DIRECTORY_PLACEHOLDERS[isolationStrategy]}`, `disabled={isLoading}`, `id="directory"`.
  - The existing `<label>` should still work via the `id` prop.
  - The `required` behavior is handled by the submit button's `disabled={!directory.trim()}` check — no change needed.
  - For `clone` strategy where a git URL is also valid, the text input fallback is important — the DirectoryPicker's text input handles this naturally (user just types the URL instead of browsing).
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Acceptance**: New Session dialog shows directory picker; all three isolation strategies work; form submission works; existing error handling unchanged.

### Phase 5: Polish

- [ ] 8. Handle edge cases and UX refinements
  **What**: Address edge cases discovered during integration.
  - **Popover width**: Match the width of the input field (use `PopoverContent` with `className="w-[var(--radix-popover-trigger-width)]"` or explicit width matching).
  - **Popover height**: Cap at 300px with `ScrollArea` to prevent overflow in the Sheet panel.
  - **Focus management**: When popover opens, focus the search input. When popover closes, return focus to the trigger button.
  - **Escape key**: Close popover without changing the value.
  - **Sheet scroll**: Ensure the Sheet content doesn't break when the popover is open (the popover renders in a Portal, so this should be fine by default).
  - **Empty roots**: If `ORCHESTRATOR_WORKSPACE_ROOTS` yields no valid roots, show a helpful error message.
  - **Long path names**: Truncate with ellipsis in breadcrumbs; show full path in tooltip.
  **Files**: `src/components/session/directory-picker.tsx`, possibly `src/components/session/new-session-dialog.tsx`
  **Acceptance**: All edge cases handled gracefully; no visual overflow; keyboard flow is smooth.

## File Summary

| File | Action | Phase |
|------|--------|-------|
| `src/lib/server/process-manager.ts` | Modify (export `getAllowedRoots`) | 1 |
| `src/lib/api-types.ts` | Modify (add directory types) | 1 |
| `src/app/api/directories/route.ts` | **Create** | 1 |
| `src/app/api/directories/__tests__/route.test.ts` | **Create** | 1 |
| `src/hooks/use-directory-browser.ts` | **Create** | 2 |
| `src/components/session/directory-picker.tsx` | **Create** | 3 |
| `src/components/session/new-session-dialog.tsx` | Modify (swap Input → DirectoryPicker) | 4 |

## Dependencies Between Tasks

```
1 (export getAllowedRoots) ─┐
                            ├─► 3 (API route) ─► 4 (tests)
2 (API types)        ───────┘         │
                                      ▼
                              5 (hook) ─► 6 (component) ─► 7 (integration) ─► 8 (polish)
```

Tasks 1 and 2 are independent and can be done in parallel. Task 3 depends on both. Task 4 can be done alongside or after 3. Tasks 5-8 are sequential.

## Verification

- [ ] `npm run build` succeeds (type-checks + builds)
- [ ] `npm run test` passes (all existing + new tests)
- [ ] `npm run lint` passes
- [ ] Manual verification: open New Session dialog, click folder icon, browse directories, select one, create session
- [ ] Manual verification: type a path manually in the input (bypass picker), create session
- [ ] Manual verification: try browsing outside allowed roots via devtools network manipulation → 400 error
- [ ] Manual verification: all three isolation strategies (existing, worktree, clone) work with the picker

## Potential Pitfalls

1. **Symlinks**: `readdirSync` with `withFileTypes` follows symlinks for `isDirectory()` on some platforms. Use `lstatSync` fallback if `dirent.isDirectory()` throws. Add a try/catch per entry to skip broken symlinks gracefully.

2. **Performance on large directories**: Directories with thousands of subdirectories (e.g. `node_modules` parent) could be slow. The noise-directory filter (skipping `node_modules`, etc.) and the 100-entry cap mitigate this. The search filter runs server-side, so the client always gets a manageable list.

3. **Race conditions in the hook**: Rapid browsing could cause stale responses. The `AbortController` pattern (from `useFindFiles`) handles this — each new fetch aborts the previous in-flight request.

4. **Popover positioning in Sheet**: The Sheet panel is `max-w-sm` (384px). The popover needs to fit within this width. Use `align="start"` and match the input width.

5. **Clone strategy accepting URLs**: The directory picker browse button is irrelevant for git URLs. The text input fallback handles this naturally — the picker is additive, not replacing manual input.
