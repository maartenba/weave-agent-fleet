# Git Status Coloring & Inline Diff Decorations

## TL;DR
> **Summary**: Add git-status-based coloring to the file tree (green/amber/red for added/modified/deleted) and inline diff gutter decorations in the Monaco editor showing added/modified/deleted lines.
> **Estimated Effort**: Medium

## Context
### Original Request
Two features requested:
1. **File tree git status coloring** — files and folders in the file tree should be colored based on their git status (added=green, modified=amber, deleted=red).
2. **Monaco editor inline diff decorations** — gutter decorations (colored bars) for added/modified/deleted lines, similar to VS Code's inline change indicators.

### Key Findings
- **Diffs API** already exists: `GET /api/sessions/[id]/diffs?instanceId=xxx` returns `FileDiffItem[]` with `file`, `before`, `after`, `status` fields.
- `useDiffs` hook is called in the session page (`page.tsx` line 103) and returns `{ diffs, fetchDiffs }`.
- `diffs` is currently passed to `<DiffViewer>` and used for sidebar stats, but **NOT** passed to `<FilesTabContent>`.
- `FilesTabContent` receives `fetchDiffs` callback (to refresh after save) but not the `diffs` array itself.
- `FileTree` uses `text-muted-foreground` for all file/folder names. The `TreeNode` component is `memo`-ized.
- `MonacoEditorWrapper` has `glyphMargin: false` and `overviewRulerLanes: 0`. It already has `editorRef` and `monacoRef` refs.
- `OpenFile` in `useFileContent` has `content` (current) and `originalContent` (at load time), but no git-before content.
- Existing test pattern: tests live in `src/lib/__tests__/`, use vitest, and import directly from `@/lib/`.

### Data Flow (Current)
```
page.tsx → useDiffs() → { diffs, fetchDiffs }
                             ├── diffs → <DiffViewer>
                             └── fetchDiffs → <FilesTabContent>
```

### Data Flow (Proposed)
```
page.tsx → useDiffs() → { diffs, fetchDiffs }
                             ├── diffs → <DiffViewer>
                             ├── diffs → <FilesTabContent>
                             │       ├── gitStatusMap → <FileTree>  (coloring)
                             │       └── gitBeforeContent → <MonacoEditorWrapper>  (decorations)
                             └── fetchDiffs → <FilesTabContent>
```

## Objectives
### Core Objective
Surface git change information visually in two places: the file tree (file-level status) and the Monaco editor (line-level changes).

### Deliverables
- [ ] File tree shows colored file/folder names based on git status
- [ ] Monaco editor shows gutter decorations for changed lines
- [ ] Pure line-diff utility with full test coverage
- [ ] No new npm dependencies

### Definition of Done
- [ ] `npx tsc --noEmit --skipLibCheck` passes with zero errors
- [ ] `npx vitest run src/lib/__tests__/line-diff.test.ts` passes
- [ ] `npx vitest run src/lib/__tests__/git-status-utils.test.ts` passes
- [ ] File tree shows green/amber/red text for added/modified/deleted files
- [ ] Parent directories inherit the "most severe" status from children
- [ ] Monaco gutter shows colored indicators for added/modified/deleted lines
- [ ] Existing behavior preserved: blue dot for unsaved changes, context menus, expand/collapse, file open/close

### Guardrails (Must NOT)
- Must NOT install new npm dependencies
- Must NOT modify `src/components/ui/context-menu.tsx` or `src/components/ui/dialog.tsx`
- Must NOT break existing file tree interactions (click, expand, context menu, dirty indicators)
- Must NOT break Monaco editor basic editing, save, or read-only mode
- Must NOT add git coloring when diffs array is empty (graceful no-op)

## TODOs

- [ ] 1. **Create `src/lib/git-status-utils.ts` — git status map builder**
  **What**: A pure utility function that takes `FileDiffItem[]` and returns a `Map<string, "added" | "modified" | "deleted">` mapping file paths AND their ancestor directory paths to a git status. Directory status logic: if all children are "added", directory is "added"; if any child is "deleted", directory is "deleted"; otherwise "modified". Export type `GitStatusMap`.
  **Files**: Create `src/lib/git-status-utils.ts`
  **Details**:
  ```
  export type GitStatus = "added" | "modified" | "deleted";
  export type GitStatusMap = Map<string, GitStatus>;
  export function buildGitStatusMap(diffs: FileDiffItem[]): GitStatusMap
  ```
  - Iterate over each diff item, add `diff.file → diff.status` to the map.
  - For each file path, extract all ancestor directory paths (e.g., `"src/components/Foo.tsx"` → `["src", "src/components"]`).
  - For each directory, aggregate statuses from all descendant files: if all are "added" → "added"; if any is "deleted" → "deleted"; else "modified".
  - Handle edge case: if diffs array is empty, return empty map.
  **Acceptance**: Unit tests pass, TypeScript compiles, function is pure (no side effects).

- [ ] 2. **Create `src/lib/__tests__/git-status-utils.test.ts` — tests for status map**
  **What**: Vitest tests covering: empty diffs → empty map; single added file; single modified file; single deleted file; multiple files in same directory; nested directory propagation; mixed statuses in same directory (should be "modified"); directory with all "added" children → "added"; directory with one "deleted" child → "deleted".
  **Files**: Create `src/lib/__tests__/git-status-utils.test.ts`
  **Acceptance**: All tests pass via `npx vitest run src/lib/__tests__/git-status-utils.test.ts`.

- [ ] 3. **Create `src/lib/line-diff.ts` — simple line diff utility**
  **What**: A pure function that compares two strings line-by-line and returns line-level change ranges for the "after" side. No external dependencies — implement a simple LCS (Longest Common Subsequence) based diff or a simpler greedy approach.
  **Files**: Create `src/lib/line-diff.ts`
  **Details**:
  ```
  export type LineChangeType = "added" | "modified" | "deleted";
  export interface LineChange {
    type: LineChangeType;
    /** 1-based start line number in the "after" content */
    startLine: number;
    /** 1-based end line number (inclusive) in the "after" content */
    endLine: number;
  }
  export function computeLineChanges(before: string, after: string): LineChange[]
  ```
  Algorithm approach:
  - Split both strings into line arrays.
  - Use a simple LCS algorithm to find matching lines.
  - Walk the LCS result to identify added lines (present in after, not in before), deleted lines (present in before, not in after — represented as a zero-width marker at the corresponding position in after), and modified lines (lines that changed between before and after).
  - For "deleted" lines that don't map to a position in the after text, place the marker at the nearest line in the after content (e.g., after the last matching line before the deletion).
  - Return sorted array of `LineChange` objects.
  - Handle edge cases: both empty → `[]`; before empty (all added); after empty (all deleted); identical → `[]`.
  **Acceptance**: Unit tests pass, TypeScript compiles, function is pure.

- [ ] 4. **Create `src/lib/__tests__/line-diff.test.ts` — tests for line diff**
  **What**: Vitest tests covering: identical files → empty array; completely new file (before empty) → all lines "added"; completely deleted file (after empty) → "deleted" marker; single line addition in middle; single line deletion; single line modification; multiple contiguous changes collapsed into ranges; large file performance (should complete under 100ms for ~1000 lines).
  **Files**: Create `src/lib/__tests__/line-diff.test.ts`
  **Acceptance**: All tests pass via `npx vitest run src/lib/__tests__/line-diff.test.ts`.

- [ ] 5. **Pass `diffs` from session page to `FilesTabContent`**
  **What**: Thread the `diffs` array from the session page into `FilesTabContent` so it can compute the git status map and find per-file before content.
  **Files**: Modify `src/app/sessions/[id]/page.tsx`
  **Details**:
  - In the `<FilesTabContent>` JSX (line 839–845), add a new prop: `diffs={diffs}`.
  - This is a simple 1-line prop addition.
  **Acceptance**: TypeScript compiles (after step 6 adds the prop type).

- [ ] 6. **Update `FilesTabContent` to accept diffs and compute gitStatusMap**
  **What**: Accept `diffs` as a new prop, compute `gitStatusMap` using `buildGitStatusMap`, and determine the `beforeContent` for the currently active file from the diffs array.
  **Files**: Modify `src/components/session/files-tab-content.tsx`
  **Details**:
  - Import `FileDiffItem` from `@/lib/api-types` and `buildGitStatusMap` from `@/lib/git-status-utils`.
  - Add to `FilesTabContentProps`: `diffs?: FileDiffItem[];`.
  - Compute `gitStatusMap` via `useMemo`:
    ```typescript
    const gitStatusMap = useMemo(
      () => buildGitStatusMap(diffs ?? []),
      [diffs]
    );
    ```
  - Compute `gitBeforeContent` for the active file via `useMemo`:
    ```typescript
    const gitBeforeContent = useMemo(() => {
      if (!activeFilePath || !diffs) return undefined;
      const diff = diffs.find((d) => d.file === activeFilePath);
      return diff?.before;
    }, [activeFilePath, diffs]);
    ```
  - Pass `gitStatusMap` to `<FileTree>`: `gitStatusMap={gitStatusMap}`.
  - Pass `gitBeforeContent` to `<MonacoEditorWrapper>`: `gitBeforeContent={gitBeforeContent}`.
  **Acceptance**: TypeScript compiles after steps 7 and 8 add the corresponding prop types.

- [ ] 7. **Update `FileTree` to accept and render git status coloring**
  **What**: Accept `gitStatusMap` prop and apply text color classes to file and folder names based on their git status.
  **Files**: Modify `src/components/session/file-tree.tsx`
  **Details**:
  - Import `GitStatusMap` from `@/lib/git-status-utils`.
  - Add to `FileTreeProps` and `TreeNodeProps`: `gitStatusMap?: GitStatusMap;`.
  - Create a helper function to map status to Tailwind classes:
    ```typescript
    function gitStatusColorClass(status: "added" | "modified" | "deleted" | undefined): string {
      switch (status) {
        case "added": return "text-green-500 dark:text-green-400";
        case "modified": return "text-amber-500 dark:text-amber-400";
        case "deleted": return "text-red-500 dark:text-red-400";
        default: return "";
      }
    }
    ```
  - In the `TreeNode` directory button (line 125, the `<span>` with `node.name`):
    - Look up `gitStatusMap?.get(node.path)` and apply the color class to the `<span>`:
    ```tsx
    <span className={cn("truncate font-medium", gitStatusColorClass(gitStatusMap?.get(node.path)))}>
      {node.name}
    </span>
    ```
  - In the `TreeNode` file button (line 173, the `<span>` with `node.name`):
    - Same approach:
    ```tsx
    <span className={cn("flex-1 truncate font-mono", gitStatusColorClass(gitStatusMap?.get(node.path)))}>
      {node.name}
    </span>
    ```
  - Thread `gitStatusMap` through to child `TreeNode` renders (lines 131–144 and 244–257).
  - Important: The `TreeNode` component is `memo`-ized. The `gitStatusMap` is a `Map` object — it will be a new reference on each render when diffs change, which is fine since diffs don't change frequently. But to avoid unnecessary re-renders, consider checking if the status for *this particular node* changed. However, since `useMemo` in the parent already gates recomputation on `diffs`, and tree re-renders are cheap, this is acceptable without additional optimization.
  **Acceptance**: File tree names show colors. Existing blue dirty dot still works. Context menus still work.

- [ ] 8. **Update `MonacoEditorWrapper` to accept git before content and show decorations**
  **What**: Accept an optional `gitBeforeContent` prop. When provided, compute line-level diffs and apply Monaco `deltaDecorations` for gutter indicators and subtle line backgrounds.
  **Files**: Modify `src/components/session/monaco-editor-wrapper.tsx`
  **Details**:
  - Import `computeLineChanges` from `@/lib/line-diff` and `LineChange` type.
  - Add to `MonacoEditorWrapperProps`: `gitBeforeContent?: string;`.
  - Accept `gitBeforeContent` in the destructured props (also `filePath` which is already declared but unused in the body).
  - Change editor options:
    - `glyphMargin: true` (was `false`) — only when `gitBeforeContent` is provided. Simplest: always set to `true` since marginal space cost is minimal, OR conditionally set based on whether `gitBeforeContent` is defined.
    - `overviewRulerLanes: 1` (was `0`) — to show overview ruler indicators.
  - Add a `useEffect` that computes decorations when `gitBeforeContent` or `content` changes:
    ```typescript
    const decorationsRef = useRef<string[]>([]);

    useEffect(() => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco || gitBeforeContent === undefined) {
        // Clear decorations if no git context
        if (editor && decorationsRef.current.length > 0) {
          decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
        }
        return;
      }

      const changes = computeLineChanges(gitBeforeContent, content);
      const newDecorations = changes.map((change) => {
        const color =
          change.type === "added" ? "git-added" :
          change.type === "modified" ? "git-modified" :
          "git-deleted";

        if (change.type === "deleted") {
          // Deleted lines: show a thin red line at the position
          return {
            range: new monaco.Range(change.startLine, 1, change.endLine, 1),
            options: {
              isWholeLine: true,
              glyphMarginClassName: `glyph-margin-${color}`,
              overviewRuler: {
                color: color === "git-deleted" ? "#ef4444" : "#f59e0b",
                position: monaco.editor.OverviewRulerLane.Left,
              },
            },
          };
        }

        return {
          range: new monaco.Range(change.startLine, 1, change.endLine, 1),
          options: {
            isWholeLine: true,
            className: `line-${color}`,
            glyphMarginClassName: `glyph-margin-${color}`,
            overviewRuler: {
              color: change.type === "added" ? "#22c55e" : "#f59e0b",
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        };
      });

      decorationsRef.current = editor.deltaDecorations(
        decorationsRef.current,
        newDecorations
      );
    }, [gitBeforeContent, content]);
    ```
  - Add CSS for glyph margin and line background decorations. These need to be injected as global styles or via a `<style>` tag since Monaco uses class names. Add to a new or existing global stylesheet:
    ```css
    /* Git diff gutter decorations */
    .glyph-margin-git-added {
      background-color: #22c55e;
      width: 3px !important;
      margin-left: 3px;
    }
    .glyph-margin-git-modified {
      background-color: #f59e0b;
      width: 3px !important;
      margin-left: 3px;
    }
    .glyph-margin-git-deleted {
      background-color: #ef4444;
      width: 3px !important;
      margin-left: 3px;
    }
    .line-git-added {
      background-color: rgba(34, 197, 94, 0.08);
    }
    .line-git-modified {
      background-color: rgba(245, 158, 11, 0.08);
    }
    ```
  - The CSS should be added to the global styles file. Check for `globals.css` or the appropriate location.
  - **Debouncing**: The `content` prop changes on every keystroke. To avoid recomputing the diff on every keystroke, debounce the computation. Use a `useRef` + `setTimeout` pattern (300ms delay) or compute the diff lazily. A simple approach:
    ```typescript
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const [debouncedContent, setDebouncedContent] = useState(content);

    useEffect(() => {
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedContent(content);
      }, 300);
      return () => clearTimeout(debounceTimerRef.current);
    }, [content]);
    ```
    Then use `debouncedContent` instead of `content` in the decoration effect.
  - **Cleanup**: Clear decorations when `gitBeforeContent` becomes undefined (file with no git changes selected) or component unmounts.
  **Acceptance**: Monaco gutter shows colored bars. Typing doesn't cause lag (debounced). Switching files clears old decorations.

- [ ] 9. **Add global CSS for Monaco git decorations**
  **What**: Add the CSS classes used by Monaco `deltaDecorations` for glyph margin and line background styling.
  **Files**: Modify `src/app/globals.css` (or wherever global styles live)
  **Details**: Add the 6 CSS classes listed in step 8 at the end of the global stylesheet. These styles work in both light and dark themes because they use fixed colors with opacity (the gutter bar colors are opaque and small, so theme doesn't matter; the line backgrounds use `rgba` with low alpha).
  **Acceptance**: CSS classes are globally available when Monaco editor renders.

- [ ] 10. **Verify TypeScript compilation**
  **What**: Run `npx tsc --noEmit --skipLibCheck` to ensure all type changes are consistent across the modified files.
  **Files**: None (verification step)
  **Acceptance**: Zero TypeScript errors.

- [ ] 11. **Manual integration testing checklist**
  **What**: Verify the full feature works end-to-end.
  **Files**: None (testing step)
  **Acceptance**:
  - [ ] Open a session with git changes → file tree shows colored names
  - [ ] Directories with mixed changes show amber
  - [ ] Directory with all added children shows green
  - [ ] Open a modified file → Monaco gutter shows colored bars
  - [ ] Open an added file → all lines show green gutter
  - [ ] Open a file with no git changes → no gutter decorations
  - [ ] Unsaved changes (blue dot) still works alongside git coloring
  - [ ] Context menus on file tree still work
  - [ ] Editor save (Cmd+S) still works
  - [ ] Tab switching between Activity/Changes/Files still works
  - [ ] Empty diffs (no git changes) → no visual change from before

## Verification
- [ ] `npx tsc --noEmit --skipLibCheck` passes with zero errors
- [ ] `npx vitest run src/lib/__tests__/git-status-utils.test.ts` — all tests pass
- [ ] `npx vitest run src/lib/__tests__/line-diff.test.ts` — all tests pass
- [ ] No regressions in existing vitest suite: `npx vitest run`
- [ ] File tree context menus work (regression)
- [ ] File tree expand/collapse works (regression)
- [ ] Monaco editor editing, save, and dirty detection work (regression)
- [ ] Diffs tab still works correctly (unchanged)

## Implementation Order Summary

| Step | File | Action | Depends On |
|------|------|--------|------------|
| 1 | `src/lib/git-status-utils.ts` | Create | — |
| 2 | `src/lib/__tests__/git-status-utils.test.ts` | Create | 1 |
| 3 | `src/lib/line-diff.ts` | Create | — |
| 4 | `src/lib/__tests__/line-diff.test.ts` | Create | 3 |
| 5 | `src/app/sessions/[id]/page.tsx` | Modify (1 line) | — |
| 6 | `src/components/session/files-tab-content.tsx` | Modify | 1, 5 |
| 7 | `src/components/session/file-tree.tsx` | Modify | 1, 6 |
| 8 | `src/components/session/monaco-editor-wrapper.tsx` | Modify | 3, 6 |
| 9 | `src/app/globals.css` (or equivalent) | Modify | 8 |
| 10 | — | TypeScript check | All |
| 11 | — | Manual test | All |

Steps 1–4 (utilities + tests) can be done in parallel with step 5 (prop threading). Steps 7 and 8 can also be done in parallel once step 6 is complete.
