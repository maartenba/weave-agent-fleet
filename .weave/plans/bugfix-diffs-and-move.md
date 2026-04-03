# Bugfix: Auto-refresh Diffs + File Move Support

## TL;DR
> **Summary**: Fix the Changes tab to auto-refresh when agent edits files or a session resumes, and add a "Move to..." context menu option for moving files between directories.
> **Estimated Effort**: Medium

## Context
### Original Request
Two bugfixes in the session file management UI:
1. The Changes/Diffs tab doesn't auto-refresh when files are edited via SSE tool events or when a session is resumed.
2. Users cannot move files between directories — no drag-and-drop or "Move to..." option exists.

### Key Findings
- **SSE-driven refresh already exists** in `files-tab-content.tsx` lines 142-178 — it calls `fetchTree()` when agent write/edit tools complete, but never calls `fetchDiffs()`.
- **`fetchDiffs` is already a prop** of `FilesTabContent` (line 28-29, 46) and is called after manual save (line 93) and dialog success (line 121). The pattern is established.
- **`useDiffs` hook** (line 49 of `use-diffs.ts`) recreates `fetchDiffs` when `[sessionId, instanceId]` change, but nothing auto-calls it on `instanceId` change (session resume).
- **`renameFile()` in `file-operations.ts`** (line 57-77) already supports full-path moves via PATCH — it sends `{ newPath }` which can be any path, not just same-directory.
- **`DialogState` union** currently has 5 variants: `idle`, `create-file`, `create-folder`, `rename`, `delete`. Adding `move` follows the same pattern.
- **Available UI components**: Dialog, Button, Input, ScrollArea, all from `src/components/ui/`. `FolderInput` icon confirmed in `lucide-react`.
- **`FileTreeNode`** has `name`, `path`, `type`, `children`, `isExpanded` — sufficient to extract a directory list for the Move dialog.
- **`FileOperationDialogsProps`** does NOT currently receive the `tree` data. The `MoveDialog` needs it for the directory picker, so `tree` must be threaded through.

## Objectives
### Core Objective
1. Diffs auto-refresh on SSE file edits and session resume.
2. Users can move files/folders between directories via context menu.

### Deliverables
- [ ] Changes tab updates automatically when agent writes/edits files
- [ ] Changes tab refreshes when a session is resumed (instanceId changes)
- [ ] "Move to..." context menu item on all file tree nodes
- [ ] MoveDialog with directory picker using existing tree data
- [ ] Move operation uses existing `renameFile()` API

### Definition of Done
- [ ] `npx tsc --noEmit --skipLibCheck` passes with zero errors
- [ ] File tree click/expand, context menus, and dirty indicators still work
- [ ] No new npm dependencies added
- [ ] `context-menu.tsx` and `dialog.tsx` are NOT modified

### Guardrails (Must NOT)
- Must NOT install new npm dependencies
- Must NOT modify `src/components/ui/context-menu.tsx`
- Must NOT modify `src/components/ui/dialog.tsx`
- Must NOT break existing file tree click/expand behavior
- Must NOT break existing context menu items (New File, New Folder, Rename, Delete)
- Must NOT break dirty file indicators

## TODOs

### BUG 1: Auto-refresh diffs on SSE file edits + session resume

- [ ] 1. **Add `fetchDiffs()` to SSE-driven debounce effect**
  **What**: In the existing `useEffect` that debounces SSE tool events (lines 142-178 of `files-tab-content.tsx`), add a call to `fetchDiffs()` inside the `setTimeout` callback at line 156, right after `fetchTree()`.
  **Files**: `src/components/session/files-tab-content.tsx`
  **Details**:
  - Line 156-157 currently:
    ```typescript
    debounceTimerRef.current = setTimeout(() => {
      fetchTree();
    ```
  - Change to:
    ```typescript
    debounceTimerRef.current = setTimeout(() => {
      fetchTree();
      fetchDiffs();
    ```
  - Also add `fetchDiffs` to the `useEffect` dependency array on line 178: `[recentParts, fetchTree, openFiles, fileContent]` → `[recentParts, fetchTree, fetchDiffs, openFiles, fileContent]`
  **Acceptance**: When agent writes/edits a file via SSE, the Changes tab data refreshes within ~2s without the user clicking on the tab. Verify by checking that `fetchDiffs` is called in the debounce timer.

- [ ] 2. **Add `useEffect` to auto-fetch diffs when `instanceId` changes (session resume)**
  **What**: In `page.tsx`, add a `useEffect` that calls `fetchDiffs()` whenever `instanceId` changes (and is non-empty). This ensures diffs are loaded after session resume, when `handleResume` triggers a `router.replace` with a new `instanceId`.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - Add after the existing `useDiffs` hook call (around line 103):
    ```typescript
    // Auto-fetch diffs when instanceId changes (e.g. after session resume)
    useEffect(() => {
      if (instanceId) {
        fetchDiffs();
      }
    }, [instanceId, fetchDiffs]);
    ```
  - This fires on initial mount AND after `handleResume` triggers `router.replace` with a new `instanceId` query param.
  - The `fetchDiffs` callback from `useDiffs` already guards against empty `sessionId`/`instanceId`, so this is safe.
  **Acceptance**: After clicking "Resume Session", the new session loads with diffs already populated (visible in sidebar "Changes" summary and when switching to Changes tab).

### BUG 2: File move support via context menu

- [ ] 3. **Extend `DialogState` union with `"move"` variant**
  **What**: Add a new `| { type: "move"; node: FileTreeNode }` variant to the `DialogState` type.
  **Files**: `src/components/session/file-operation-dialogs.tsx` (line 25-30)
  **Details**:
  - Change:
    ```typescript
    export type DialogState =
      | { type: "idle" }
      | { type: "create-file"; parentPath: string }
      | { type: "create-folder"; parentPath: string }
      | { type: "rename"; node: FileTreeNode }
      | { type: "delete"; node: FileTreeNode };
    ```
  - To:
    ```typescript
    export type DialogState =
      | { type: "idle" }
      | { type: "create-file"; parentPath: string }
      | { type: "create-folder"; parentPath: string }
      | { type: "rename"; node: FileTreeNode }
      | { type: "delete"; node: FileTreeNode }
      | { type: "move"; node: FileTreeNode };
    ```
  **Acceptance**: TypeScript compiles without errors.

- [ ] 4. **Add `tree` prop to `FileOperationDialogsProps`**
  **What**: Add an optional `tree?: FileTreeNode[]` prop so the MoveDialog can access the full tree for directory listing.
  **Files**: `src/components/session/file-operation-dialogs.tsx` (line 34-46)
  **Details**:
  - Add to `FileOperationDialogsProps` interface:
    ```typescript
    /** Full file tree — used by MoveDialog for directory selection */
    tree?: FileTreeNode[];
    ```
  **Acceptance**: TypeScript compiles. Existing dialogs unaffected (they don't use `tree`).

- [ ] 5. **Create `MoveDialog` component inside `file-operation-dialogs.tsx`**
  **What**: A new component (similar to RenameDialog/DeleteDialog) that shows a directory picker and calls `renameFile()` to move the file/folder.
  **Files**: `src/components/session/file-operation-dialogs.tsx`
  **Details**:
  - Add a helper function to extract directories recursively from the tree:
    ```typescript
    function collectDirectories(nodes: FileTreeNode[], prefix = ""): string[] {
      const dirs: string[] = [];
      for (const node of nodes) {
        if (node.type === "directory") {
          dirs.push(node.path);
          if (node.children) {
            dirs.push(...collectDirectories(node.children));
          }
        }
      }
      return dirs;
    }
    ```
  - MoveDialog component:
    - Props: same pattern as RenameDialog (`FileOperationDialogsProps & { dialogState: { type: "move"; node: FileTreeNode } }`)
    - State: `selectedDir` (string | null), `isLoading`, `apiError`
    - Computes `directories` from `props.tree` using `collectDirectories`, plus adds `""` for root (displayed as `/ (root)`)
    - Computes `currentParent` from `node.path` (everything before last `/`, or `""` for root-level items)
    - Validates:
      - `selectedDir !== null` (something is selected)
      - `selectedDir !== currentParent` (not moving to same location)
      - For directories: `selectedDir` does not start with `node.path + "/"` (can't move into itself)
    - On confirm:
      - `newPath = selectedDir ? selectedDir + "/" + node.name : node.name`
      - Calls `await renameFile(sessionId, instanceId, node.path, newPath)`
      - Calls `onSuccess("move", node.path, newPath)`
      - Calls `onClose()`
    - UI:
      - Dialog with title "Move {node.name}"
      - Description: "Select a destination directory"
      - ScrollArea containing a list of clickable directory entries
      - Each entry shows the full path (or "/ (root)" for empty string)
      - Current parent directory is visually indicated (muted text + "(current)" label)
      - Selected directory gets highlighted background (e.g. `bg-accent`)
      - Footer: Cancel + Move button (disabled when `selectedDir` is null or same as current)
    - Import `renameFile` from `@/lib/file-operations` (already imported at line 18)
    - Import `ScrollArea` from `@/components/ui/scroll-area`
    - Import `Folder` icon from `lucide-react` for directory entries
  **Acceptance**: Component renders correctly. Selecting a directory and confirming calls `renameFile` with correct paths. Self-move and same-location-move are prevented.

- [ ] 6. **Wire `MoveDialog` into the `FileOperationDialogs` orchestrator**
  **What**: Add a case for `dialogState.type === "move"` in the `FileOperationDialogs` function.
  **Files**: `src/components/session/file-operation-dialogs.tsx` (lines 342-368)
  **Details**:
  - Before the final `return null;` (line 367), add:
    ```typescript
    if (dialogState.type === "move") {
      return <MoveDialog {...props} dialogState={dialogState} />;
    }
    ```
  **Acceptance**: When `dialogState` is `{ type: "move", node: ... }`, the MoveDialog renders.

- [ ] 7. **Add "Move to..." item to `FileTreeContextMenu`**
  **What**: Add an `onMove` callback prop and a "Move to..." menu item.
  **Files**: `src/components/session/file-tree-context-menu.tsx`
  **Details**:
  - Add to `FileTreeContextMenuProps` (line 14-22):
    ```typescript
    onMove?: (node: FileTreeNode) => void;
    ```
  - Destructure `onMove` in the component function params (line 32-39)
  - Add the menu item AFTER the Rename item and BEFORE the Delete separator. In the `{node !== null && (...)}` block (lines 69-87), insert:
    ```tsx
    {onMove && (
      <ContextMenuItem onSelect={() => onMove(node)}>
        <FolderInput />
        Move to…
      </ContextMenuItem>
    )}
    ```
  - Place it after the Rename `<ContextMenuItem>` (line 72-76) and before the `<ContextMenuSeparator />` (line 77).
  - Import `FolderInput` from `lucide-react` (add to existing import on line 3).
  - Note: `onMove` is optional so existing callers that don't pass it won't break, and the menu item won't render.
  **Acceptance**: Right-clicking a file/folder shows "Move to..." between Rename and the separator before Delete. Right-clicking root area does NOT show "Move to...".

- [ ] 8. **Thread `onMove` through `FileTree` → `TreeNode`**
  **What**: Add `onMove` optional prop to `FileTreeProps` and `TreeNodeProps`, and pass it down to `FileTreeContextMenu`.
  **Files**: `src/components/session/file-tree.tsx`
  **Details**:
  - Add to `TreeNodeProps` (line 72-84):
    ```typescript
    onMove?: (node: FileTreeNode) => void;
    ```
  - Destructure `onMove` in `TreeNode` component (line 86-98)
  - Add no-op default: `const handleMove = onMove ?? (() => {});`
  - Pass `onMove={handleMove}` to both `<FileTreeContextMenu>` instances inside TreeNode (lines 112-118 and 168-174)
  - Pass `onMove={onMove}` to recursive `<TreeNode>` calls (line 145-158)
  - Add to `FileTreeProps` (line 202-214):
    ```typescript
    onMove?: (node: FileTreeNode) => void;
    ```
  - Destructure `onMove` in `FileTree` component (line 216-228)
  - Add no-op default: `const handleMove = onMove ?? (() => {});`
  - Pass `onMove={handleMove}` to root-level `<FileTreeContextMenu>` (lines 252-258)
  - Pass `onMove={onMove}` to each root `<TreeNode>` (lines 262-275)
  **Acceptance**: `onMove` flows from `FileTree` → `TreeNode` → `FileTreeContextMenu` without TypeScript errors. Existing props unaffected.

- [ ] 9. **Wire up `handleMove` and pass `tree` in `files-tab-content.tsx`**
  **What**: Add a `handleMove` callback, pass `onMove` to `<FileTree>`, pass `tree` to `<FileOperationDialogs>`, and handle `"move"` in `handleDialogSuccess`.
  **Files**: `src/components/session/files-tab-content.tsx`
  **Details**:
  - **Add `handleMove` callback** (after `handleDelete` around line 112-114):
    ```typescript
    const handleMove = useCallback((node: FileTreeNode) => {
      setDialogState({ type: "move", node });
    }, []);
    ```
  - **Pass `onMove` to `<FileTree>`** (around line 281-293):
    ```tsx
    onMove={handleMove}
    ```
  - **Handle `"move"` in `handleDialogSuccess`** (lines 117-136): Add a case similar to rename:
    ```typescript
    } else if (action === "move" && newPath) {
      renameOpenFile(path, newPath);
      expandTo(newPath);
    }
    ```
  - **Pass `tree` to `<FileOperationDialogs>`** (lines 420-426):
    ```tsx
    <FileOperationDialogs
      dialogState={dialogState}
      onClose={() => setDialogState({ type: "idle" })}
      onSuccess={handleDialogSuccess}
      sessionId={sessionId}
      instanceId={instanceId}
      tree={tree}
    />
    ```
  **Acceptance**: Right-clicking a file → "Move to..." opens the MoveDialog. Selecting a directory and confirming moves the file. Open files are updated to the new path. Tree refreshes and expands to show the file at its new location.

## Verification

- [ ] Run `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] Manual test: Agent writes a file via SSE → Changes tab data refreshes within ~2s
- [ ] Manual test: Resume a session → Changes tab shows diffs without manually clicking the tab
- [ ] Manual test: Right-click a file → "Move to..." → select directory → confirm → file moves
- [ ] Manual test: Right-click a folder → "Move to..." → can't select itself or a child as destination
- [ ] Manual test: Existing context menu items (New File, New Folder, Rename, Delete) still work
- [ ] Manual test: File tree click/expand still works
- [ ] Manual test: Dirty file indicators still show
- [ ] Verify `src/components/ui/context-menu.tsx` has NO changes
- [ ] Verify `src/components/ui/dialog.tsx` has NO changes
- [ ] Verify `package.json` has NO new dependencies

## File Change Summary

| File | Action | Bug |
|------|--------|-----|
| `src/components/session/files-tab-content.tsx` | Modify (add `fetchDiffs` to SSE debounce + add `handleMove` + pass `tree` + handle `"move"` success) | 1 + 2 |
| `src/app/sessions/[id]/page.tsx` | Modify (add `useEffect` for `instanceId`-driven diff fetch) | 1 |
| `src/components/session/file-operation-dialogs.tsx` | Modify (extend `DialogState` + add `tree` prop + add `MoveDialog` + wire in orchestrator) | 2 |
| `src/components/session/file-tree-context-menu.tsx` | Modify (add `onMove` prop + "Move to..." menu item) | 2 |
| `src/components/session/file-tree.tsx` | Modify (thread `onMove` prop through `FileTreeProps` → `TreeNodeProps` → `FileTreeContextMenu`) | 2 |

No new files created. No files deleted. No dependencies added.
