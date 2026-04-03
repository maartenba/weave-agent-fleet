# File Tree Context Menu Commands (Create, Rename, Delete)

## TL;DR
> **Summary**: Add right-click context menu to the file tree with Create File/Folder, Rename, and Delete operations — backed by new API endpoints with full path security.
> **Estimated Effort**: Medium

## Context
### Original Request
Add Delete, Rename, and Create (file/folder) commands to the file tree in the Files tab, accessible via right-click context menu on tree nodes.

### Key Findings
- **File tree** (`src/components/session/file-tree.tsx`): 199-line component with memoized `TreeNode`, recursive rendering, depth-based indentation. Currently no context menu or right-click handling. The `<button>` elements handle click for expand (dirs) and select (files).
- **Parent container** (`src/components/session/files-tab-content.tsx`): Composes `FileTree` with `useFileTree` + `useFileContent` hooks. Owns `fetchTree()`, `fetchDiffs()`, `openFile()`, `closeFile()`. Post-save pattern: `saveFile() → fetchDiffs() → fetchTree()`.
- **useFileContent** (`src/hooks/use-file-content.ts`): Manages `openFiles: Map<string, OpenFile>`, tracks dirty state, has `closeFile()`, `openFile()`, `reloadFile()`. No `renameFile()` method — needs one for path updates.
- **useFileTree** (`src/hooks/use-file-tree.ts`): Has `toggleExpand(path)` which deep-clones tree to toggle. Will need `expandTo(path)` for auto-expanding to newly created files.
- **API routes**: `GET .../files` (list), `GET .../files/[...path]` (read), `POST .../files/[...path]` (write). **No DELETE or PATCH**. POST already creates files + parent dirs via `mkdir(recursive)`.
- **Path security** (`src/lib/server/path-security.ts`): `validatePathWithinRoot()` async with symlink resolution. `.git` write protection in POST handler (case-insensitive check on `relativePath`).
- **UI components**: `context-menu.tsx` (Radix ContextMenu with `variant="destructive"`, shortcut, separator support), `dialog.tsx` (Dialog with Header/Footer/Title/Description, controlled open/onOpenChange), `input.tsx`, `button.tsx` — all ready to use.
- **Test patterns**: Vitest with real temp directories (`mkdtemp`), `vi.mock` for `process-manager`, `NextRequest` construction helpers. Tests co-located in `__tests__/` folders.
- **Existing POST** creates parent dirs with `mkdir(dirname(resolvedPath), { recursive: true })` — handles new file creation already. For folder creation, we need a separate mechanism since POST expects `{ content: string }`.

## Objectives
### Core Objective
Enable users to manage files and folders directly from the tree via context menu — create, rename, and delete — with proper API backends, security, and UI feedback.

### Deliverables
- [x] DELETE endpoint for files and folders
- [x] PATCH endpoint for rename/move
- [x] POST extension or new endpoint for folder creation
- [x] Context menu on tree nodes with appropriate actions
- [x] Create file/folder dialog with name validation
- [x] Rename dialog with pre-filled name
- [x] Delete confirmation dialog with folder warning
- [x] Auto-refresh tree + diffs after mutations
- [x] Open file tabs update on rename, close on delete
- [x] Unit tests for all new API endpoints
- [x] Unit test for filename validation utility

### Definition of Done
- [x] Right-click any tree node → context menu with correct actions for node type
- [x] Right-click empty area → New File / New Folder at root
- [x] Create/Rename/Delete all work end-to-end
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] Path traversal attacks blocked on all new endpoints
- [x] `.git` operations blocked on delete and rename

### Guardrails (Must NOT)
- Must NOT install new npm dependencies
- Must NOT break existing file tree click/expand behavior
- Must NOT modify `src/components/ui/context-menu.tsx` or `dialog.tsx` (use as-is)
- Must NOT allow delete/rename of `.git` directory
- Must NOT allow rename target outside workspace root

## TODOs

### Phase 1: API Endpoints

- [x] 0. **Extract `.git` path check into shared helper and fix interior segment gap**
  **What**: The existing `.git` check only matches `.git` at the workspace root (e.g. `.git/config`). Paths like `subdir/.git/hooks/pre-commit` bypass the check. Extract into a reusable helper and fix the gap. Also backport to existing POST handler.
  **Files**: `src/lib/server/path-security.ts` (add helper), `src/app/api/sessions/[id]/files/[...path]/route.ts` (update POST, use in DELETE/PATCH)
  **Details**:
  - Add `isGitPath(relativePath: string): boolean` to `path-security.ts`:
    ```
    const lower = relativePath.toLowerCase();
    return lower === ".git" || lower.startsWith(".git/") || lower.includes("/.git/") || lower.endsWith("/.git");
    ```
  - Replace existing POST handler's inline `.git` check with `isGitPath(relativePath)`
  - Use `isGitPath()` in new DELETE and PATCH handlers
  - Add tests for interior `.git` segments to `path-security.test.ts`
  **Acceptance**: `subdir/.git/hooks/pre-commit` is blocked. `subdir/.Git` is blocked. Existing root `.git` still blocked.

- [x] 1. **Add DELETE handler to `[...path]/route.ts`**
  **What**: Add a `DELETE` export to the existing catch-all route file that removes a file or directory.
  **Files**: `src/app/api/sessions/[id]/files/[...path]/route.ts`
  **Details**:
  - Import `rm` from `fs/promises` and `stat` for type detection
  - Follow exact same pattern as POST: extract `instanceId` from query, `getInstance()`, reconstruct `relativePath` from `pathSegments.join("/")`
  - Reject `.git` paths using `isGitPath(relativePath)` → 403
  - Call `validatePathWithinRoot(instance.directory, relativePath)` → 403 on `PathTraversalError`
  - `stat()` the resolved path to check if it exists (404 if ENOENT)
  - `rm(resolvedPath, { recursive: true, force: true })` — works for both files and dirs
  - Return `{ success: true, path: relativePath }` with 200
  - Catch and return 500 on unexpected errors
  **Acceptance**: `DELETE /api/sessions/x/files/some/file.ts?instanceId=y` removes the file. Directories removed recursively. `.git` (including interior segments) and traversal blocked.

- [x] 2. **Add PATCH handler to `[...path]/route.ts`**
  **What**: Add a `PATCH` export for rename/move operations.
  **Files**: `src/app/api/sessions/[id]/files/[...path]/route.ts`
  **Details**:
  - Parse body as `{ newPath: string }` — the new relative path
  - Reject `.git` on both source and destination using `isGitPath()` → 403
  - Validate BOTH paths with `validatePathWithinRoot()` — source and destination must be within root
  - **Symlink escape prevention for destination**: After `validatePathWithinRoot` on the destination, resolve the *parent directory*'s real path: `const realParent = await realpath(dirname(resolvedNewPath))`. Verify `isWithinRoot(instance.directory, realParent)`. This prevents symlinked parent directories from escaping the workspace when the destination file doesn't exist yet.
  - `stat()` source to confirm it exists (404 if ENOENT)
  - Check destination doesn't already exist via `stat()` (409 Conflict if it does)
  - `mkdir(dirname(resolvedNewPath), { recursive: true })` to ensure parent exists
  - Import `rename` from `fs/promises` → `rename(resolvedOldPath, resolvedNewPath)`
  - Return `{ success: true, oldPath: relativePath, newPath: body.newPath }` with 200
  **Acceptance**: `PATCH /api/sessions/x/files/old/name.ts?instanceId=y` with body `{ "newPath": "new/name.ts" }` renames. Both paths validated. Symlink escape in parent dirs blocked. Conflict on existing target.

- [x] 3. **Add folder creation support via POST**
  **What**: Extend the existing POST handler to support `{ type: "directory" }` in addition to `{ content: string }`.
  **Files**: `src/app/api/sessions/[id]/files/[...path]/route.ts`
  **Details**:
  - Parse body — accept either `{ content: string }` (existing behavior) or `{ type: "directory" }` (new)
  - When `type === "directory"`: call `mkdir(resolvedPath, { recursive: true })` instead of `writeFile`
  - Skip the `content` validation when type is directory
  - Keep existing file-write behavior fully intact as the default path
  - Return `{ success: true, path: relativePath, type: "directory" }` for dir creation
  **Acceptance**: `POST /api/sessions/x/files/new-folder?instanceId=y` with body `{ "type": "directory" }` creates the directory. Existing file writes unchanged.

### Phase 2: Client Utilities & Hook Extensions

- [x] 4. **Create filename validation utility**
  **What**: A pure function to validate file/folder names for the create and rename dialogs.
  **Files**: `src/lib/file-name-validation.ts` (new)
  **Details**:
  - `validateFileName(name: string): { valid: boolean; error?: string }`
  - Rules: (1) not empty/whitespace-only, (2) no path separators (`/`, `\`), (3) no null bytes, (4) not `.` or `..`, (5) no reserved OS names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` — case-insensitive), (6) max 255 chars, (7) no trailing dots or spaces (Windows compat), (8) no characters `< > : " | ? *`
  - Export as named function
  **Acceptance**: Validates correctly. Edge cases: empty string, `../`, `CON`, `file/name`, `a`.repeat(256).

- [x] 5. **Create file operations API client functions**
  **What**: Thin async functions that call the new API endpoints from the client, matching the `apiFetch` pattern.
  **Files**: `src/lib/file-operations.ts` (new)
  **Details**:
  - `deleteFile(sessionId, instanceId, filePath): Promise<{ success: boolean }>` — calls `DELETE .../files/[...path]`
  - `renameFile(sessionId, instanceId, oldPath, newPath): Promise<{ success: boolean; newPath: string }>` — calls `PATCH .../files/[...path]`
  - `createFolder(sessionId, instanceId, folderPath): Promise<{ success: boolean }>` — calls `POST .../files/[...path]` with `{ type: "directory" }`
  - File creation already works via existing `POST` with `{ content: "" }` — no new function needed, but add `createFile(sessionId, instanceId, filePath): Promise<{ success: boolean }>` for convenience (POST with empty content)
  - All use `apiFetch` from `@/lib/api-client`
  - All encode path segments with `filePath.split("/").map(encodeURIComponent).join("/")`
  - Throw on non-ok responses with error message from body
  **Acceptance**: Each function correctly calls the right HTTP method and endpoint. Error responses throw with message.

- [x] 6. **Add `expandTo(path)` method to `useFileTree`**
  **What**: Expand all ancestor directories of a given path so a newly created file is visible.
  **Files**: `src/hooks/use-file-tree.ts`
  **Details**:
  - Add `expandTo(path: string): void` to `UseFileTreeResult`
  - Compute all ancestor paths: for `"a/b/c/file.ts"` → expand `"a"`, `"a/b"`, `"a/b/c"`
  - Use same deep-clone pattern as `toggleExpand` but set `isExpanded: true` (not toggle) for matching paths
  - Implementation: `setTree(prev => { function expandNodes(...) })` — same recursive pattern as `toggleExpand`
  **Acceptance**: After calling `expandTo("src/components/deep/file.ts")`, all ancestor dirs are expanded.

- [x] 7. **Add `renameOpenFile` and `closeFilesUnderPath` to `useFileContent`**
  **What**: Methods to update open file tabs after rename or directory delete.
  **Files**: `src/hooks/use-file-content.ts`
  **Details**:
  - `renameOpenFile(oldPath: string, newPath: string): void` — if `oldPath` is in `openFiles`, remove entry at `oldPath`, insert at `newPath` with updated `path` field. Update `activeFilePath` if it was `oldPath`. Update `openOrderRef`.
  - `closeFilesUnderPath(pathPrefix: string): void` — close all open files whose path starts with `pathPrefix + "/"` or equals `pathPrefix`. Used when deleting a directory. Calls close logic for each.
  - Add both to `UseFileContentResult` interface
  **Acceptance**: Renaming an open file updates its tab. Deleting a directory closes all files inside it.

### Phase 3: UI Components

- [x] 8. **Create file tree context menu component**
  **What**: A component that wraps tree nodes with a Radix ContextMenu, showing appropriate actions.
  **Files**: `src/components/session/file-tree-context-menu.tsx` (new)
  **Details**:
  - Props: `{ node: FileTreeNode | null; onNewFile: (parentPath: string) => void; onNewFolder: (parentPath: string) => void; onRename: (node: FileTreeNode) => void; onDelete: (node: FileTreeNode) => void; children: React.ReactNode }`
  - When `node` is null (root area): show only "New File" and "New Folder"
  - When `node.type === "directory"`: show "New File", "New Folder", separator, "Rename", separator, "Delete" (destructive)
  - When `node.type === "file"`: show "Rename", separator, "Delete" (destructive)
  - Use `ContextMenuShortcut` for hints: `Del` for delete, `F2` for rename
  - Icons: `FilePlus`, `FolderPlus`, `Pencil`, `Trash2` from lucide-react
  - Use all from `@/components/ui/context-menu`: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuShortcut`
  **Acceptance**: Renders correct menu items based on node type. Calls correct callback on click.

- [x] 9. **Create file operation dialogs component**
  **What**: Dialogs for create, rename, and delete — managed by a single component with state.
  **Files**: `src/components/session/file-operation-dialogs.tsx` (new)
  **Details**:
  - Three separate dialog components, or one component with a discriminated union state:
    ```
    type DialogState =
      | { type: "idle" }
      | { type: "create-file"; parentPath: string }
      | { type: "create-folder"; parentPath: string }
      | { type: "rename"; node: FileTreeNode }
      | { type: "delete"; node: FileTreeNode }
    ```
  - **Create dialog**: `Dialog` with `DialogHeader`+`DialogTitle` ("New File" / "New Folder"), `Input` for name, `DialogFooter` with Cancel + Create buttons. Validate name with `validateFileName()` on submit and on change (show inline error). On submit: call `createFile`/`createFolder` from `file-operations.ts`, then call `onSuccess` callback.
  - **Rename dialog**: Pre-fill input with `node.name`. On submit: compute new full path (replace last segment). Validate. Call `renameFile()`. Then `onSuccess`.
  - **Delete dialog**: No input. Show `DialogDescription` with file/folder name. For folders: "This will permanently delete the folder **{name}** and all its contents." For files: "This will permanently delete **{name}**." `DialogFooter` with Cancel + `Button variant="destructive"` Delete. On confirm: call `deleteFile()`. Then `onSuccess`.
  - All dialogs: show loading state on button during API call, show error toast/inline on failure, call `onClose()` on success or cancel.
  - Props: `{ dialogState: DialogState; onClose: () => void; onSuccess: (action: string, path: string, newPath?: string) => void; sessionId: string; instanceId: string }`
  **Acceptance**: Each dialog renders correctly, validates input, calls API, reports success/failure.

### Phase 4: Integration

- [x] 10. **Wire context menu into `FileTree` component**
  **What**: Wrap each `TreeNode` and the root empty area with the context menu trigger.
  **Files**: `src/components/session/file-tree.tsx`
  **Details**:
  - Add new props to `FileTreeProps` and `TreeNodeProps`: `onNewFile?: (parentPath: string) => void`, `onNewFolder?: (parentPath: string) => void`, `onRename?: (node: FileTreeNode) => void`, `onDelete?: (node: FileTreeNode) => void`
  - Import `FileTreeContextMenu` from `./file-tree-context-menu`
  - In `TreeNode`, wrap the existing `<button>` (for dirs) and `<button>` (for files) with `<FileTreeContextMenu node={node} ...>{existing button}</FileTreeContextMenu>`
  - For the root empty area in `FileTree`, wrap the `<ScrollArea>` content area with `<FileTreeContextMenu node={null} ...>` so right-clicking empty space shows root-level actions
  - Pass through the `onNewFile`, `onNewFolder`, `onRename`, `onDelete` callbacks
  - CRITICAL: Existing click handlers must remain unchanged — `ContextMenuTrigger` should not interfere with left-click
  **Acceptance**: Right-click shows menu. Left-click still opens files and toggles directories. All 4 callbacks fire correctly.

- [x] 11. **Orchestrate everything in `FilesTabContent`**
  **What**: Connect dialogs, callbacks, and post-mutation effects in the parent container.
  **Files**: `src/components/session/files-tab-content.tsx`
  **Details**:
  - Add state: `const [dialogState, setDialogState] = useState<DialogState>({ type: "idle" })`
  - Add `expandTo` from `useFileTree` and `renameOpenFile`, `closeFilesUnderPath` from `useFileContent`
  - Define 4 callbacks for context menu: `handleNewFile`, `handleNewFolder`, `handleRename`, `handleDelete` — each sets `dialogState`
  - Pass these 4 callbacks to `<FileTree>` via new props
  - Define `handleDialogSuccess(action, path, newPath?)`:
    - Always: `fetchTree()` + `fetchDiffs()`
    - On create file: `expandTo(path)`, then `openFile(path)`
    - On create folder: `expandTo(path)`
    - On rename: `renameOpenFile(oldPath, newPath!)`, `expandTo(newPath!)`
    - On delete: `closeFilesUnderPath(path)` (handles both file and dir)
  - Render `<FileOperationDialogs dialogState={dialogState} onClose={() => setDialogState({ type: "idle" })} onSuccess={handleDialogSuccess} sessionId={sessionId} instanceId={instanceId} />` alongside existing JSX
  - Import `DialogState` type from the dialogs component
  **Acceptance**: Full end-to-end flow: right-click → menu → dialog → API call → tree refresh + tab update.

### Phase 5: Tests

- [x] 12. **Add API endpoint tests for DELETE and PATCH**
  **What**: Unit tests for the new DELETE and PATCH handlers, following existing test patterns.
  **Files**: `src/app/api/sessions/[id]/files/__tests__/route.test.ts` (extend existing)
  **Details**:
  - Import `DELETE` and `PATCH` from the route file (add to existing import)
  - Add helper: `makeDeleteRequest(filePath, instanceId)` — NextRequest with method DELETE
  - Add helper: `makePatchRequest(filePath, instanceId, newPath)` — NextRequest with method PATCH and body `{ newPath }`
  - **DELETE tests**: 400 (no instanceId), 404 (instance not found), 403 (`.git`), 403 (`.git` in interior segment e.g. `foo/.git/config`), 403 (path traversal), 404 (file not found), 200 (file deleted — verify with stat), 200 (directory deleted recursively)
  - **PATCH tests**: 400 (no instanceId), 404 (instance not found), 403 (source `.git`), 403 (destination `.git`), 403 (interior `.git` in destination e.g. `foo/.git/hooks/post-checkout`), 403 (path traversal source), 403 (path traversal destination), 404 (source not found), 409 (destination exists), 200 (file renamed — verify old gone, new exists), 200 (directory renamed), 200 (creates parent dirs for destination)
  - **POST directory test**: 200 with `{ type: "directory" }` body creates folder (verify with stat)
  - Use same `tmpRoot` pattern with `mkdtemp`/`rm` in beforeEach/afterEach
  **Acceptance**: All new tests pass. Existing tests still pass.

- [x] 13. **Add filename validation tests**
  **What**: Unit tests for `validateFileName`.
  **Files**: `src/lib/__tests__/file-name-validation.test.ts` (new)
  **Details**:
  - Test valid names: `"file.ts"`, `"my-component.tsx"`, `".env"`, `"Makefile"`, `"a"`, `"file with spaces.txt"`
  - Test invalid names: `""`, `" "`, `"/"`, `"a/b"`, `"."`, `".."`, `"CON"`, `"con"`, `"NUL.txt"`, `"a".repeat(256)`, `"file\0name"`, `"file<name"`, `"file:name"`, `"name."`, `"name "`
  - Verify error messages are descriptive
  **Acceptance**: All edge cases covered. Tests pass.

- [x] 14. **Add `expandTo` unit test to `use-file-tree.test.ts`**
  **What**: Test the new `expandTo` helper logic.
  **Files**: `src/hooks/__tests__/use-file-tree.test.ts` (extend or add new describe block)
  **Details**:
  - This may need to test via the hook if `expandTo` uses `setTree`, or test a pure extracted helper
  - If `expandTo` logic can be extracted as a pure function (like `buildTree`), test directly
  - Otherwise, test via `renderHook` pattern (may need `@testing-library/react-hooks`)
  **Acceptance**: Verifies ancestor expansion behavior.

## Verification
- [x] Right-click file → shows "Rename" and "Delete"
- [x] Right-click folder → shows "New File", "New Folder", "Rename", "Delete"
- [x] Right-click empty tree area → shows "New File", "New Folder"
- [x] Create file → creates on disk, refreshes tree, opens in editor
- [x] Create folder → creates on disk, refreshes tree, expands to show it
- [x] Rename file → renames on disk, updates open tab, refreshes tree
- [x] Rename open file → tab shows new name, editor content preserved
- [x] Delete file → removes from disk, closes tab if open, refreshes tree
- [x] Delete folder → removes recursively, closes all open files inside, refreshes tree
- [x] Path traversal attempts return 403
- [x] `.git` operations return 403 (including interior segments like `foo/.git/config`)
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes (all existing + new tests)
