# Editor Diff/Change Features

## TL;DR
> **Summary**: Add 5 diff-related features to the Monaco editor: discard changes, inline diff toggle, hover-to-see-old-content, hunk-level revert, and change count badges on file tabs. Features share a common hunk-grouping infrastructure built on the existing `line-diff.ts` engine.
> **Estimated Effort**: Large

## Context
### Original Request
Implement 5 editor diff/change features: (1) Discard All Changes button, (2) Inline DiffEditor toggle, (3) Hover to see old content on changed lines, (4) Hunk-level revert, (5) Change count badges on file tabs.

### Key Findings

**Existing infrastructure:**
- `computeLineChanges(before, after)` in `src/lib/line-diff.ts` returns `LineChange[]` with `{ type, startLine, endLine }` — this is the foundation for all diff features
- `gitBeforeContent` is computed in `files-tab-content.tsx` (lines 261-266) from `diffs` array, passed to `MonacoEditorWrapper`
- `originalContent` in `OpenFile` is the content at load time (for dirty detection) — separate from `gitBeforeContent`
- Monaco wrapper already debounces content for diff computation (300ms) via `debouncedContent` state
- Delta decorations are applied for glyph margin stripes (added=green, modified=amber, deleted=red)
- CSS classes exist: `.glyph-margin-git-added`, `.glyph-margin-git-modified`, `.glyph-margin-git-deleted`, `.line-git-added`, `.line-git-modified`

**UI components available:**
- `AlertDialog` from radix-ui (exists at `src/components/ui/alert-dialog.tsx`) — ideal for discard confirmation
- `Popover` from radix-ui (exists at `src/components/ui/popover.tsx`)
- `Tooltip` (exists at `src/components/ui/tooltip.tsx`)
- Lucide icons used throughout (e.g., `Undo2`, `GitCompare`, `Columns2`)

**Monaco DiffEditor availability:**
- `@monaco-editor/react` exports `DiffEditor` component with props: `original`, `modified`, `language`, `theme`, `options`, `beforeMount`, `onMount`
- The `DiffEditor` uses `IDiffEditorConstructionOptions` options
- The existing `configureMonacoLoader` and `registerMonacoThemes` can be reused

**Data flow for git diffs:**
- `FileDiffItem` has `{ file, before, after, additions, deletions, status }` — `additions`/`deletions` are pre-computed by the API
- `diffs` array is passed from the session page → `FilesTabContent` → individual components
- `buildGitStatusMap()` already processes diffs into per-file status

**Important distinction:**
- `originalContent` = content when file was loaded from disk (for save/dirty tracking)
- `gitBeforeContent` = content before agent changes (from git diff API) — this is what we diff against for change features
- Features 2, 3, 4 use `gitBeforeContent` (showing what changed vs. the git baseline)
- Feature 1 uses `originalContent` (reverting local unsaved edits)
- Feature 5 uses `FileDiffItem.additions`/`deletions` (pre-computed by API)

**LCS edit operations:**
- `line-diff.ts` has internal `EditOp[]` and `backtrack()` producing `{ type: "equal" | "delete" | "insert", beforeIdx, afterIdx }`
- Currently these are private. Features 3 and 4 need richer hunk data (the actual old/new line content, grouped by hunk). We need to export a new function.

## Objectives
### Core Objective
Give users granular visibility and control over file changes in the editor — from quick glances (badges) to precise actions (hunk revert).

### Deliverables
- [x] Discard All Changes button with confirmation dialog
  - [x] Inline DiffEditor toggle (normal editor ↔ Monaco DiffEditor)
  - [x] Hover-to-see-old-content on changed gutter decorations
  - [x] Hunk-level revert via gutter actions
  - [x] Change count badges (+N -M) on file tabs

### Definition of Done
- [x] `npm run build` succeeds with no TypeScript errors
  - [x] `npm run test` passes (all existing + new unit tests)
  - [x] Each feature works in isolation and together without conflicts
  - [x] Features degrade gracefully when `gitBeforeContent` is unavailable

### Guardrails (Must NOT)
- Must NOT call any API for "Discard Changes" — it's a pure local state reset
- Must NOT break the existing dirty tracking or save flow
- Must NOT make hunk-revert available when there's no `gitBeforeContent`
- Must NOT use `react-diff-viewer-continued` for the inline diff — use Monaco's built-in DiffEditor
- Must NOT add heavy dependencies — leverage existing Monaco, radix-ui, and lucide-react

## TODOs

### Phase 0: Shared Infrastructure

- [x] 1 **Export hunk-grouping utility from line-diff**
  **What**: Add a new exported type `Hunk` and function `computeHunks(before: string, after: string): Hunk[]` to `line-diff.ts`. A `Hunk` groups consecutive changed lines into a single unit with:
  ```
  interface Hunk {
    type: "added" | "modified" | "deleted";
    /** 1-based line range in the "after" content */
    afterStartLine: number;
    afterEndLine: number;
    /** 1-based line range in the "before" content (for deleted/modified) */
    beforeStartLine: number;
    beforeEndLine: number;
    /** The actual old lines (from before content) for this hunk */
    oldLines: string[];
    /** The actual new lines (from after content) for this hunk */
    newLines: string[];
  }
  ```
  This function reuses the existing `lcsTable` and `backtrack` internals. The current `opsToChanges` converts ops→LineChange; the new function converts ops→Hunk with full content.
  
  Implementation approach:
  - Refactor: extract `lcsTable` and `backtrack` to remain internal but called by both `computeLineChanges` and `computeHunks`
  - In `computeHunks`, walk the `EditOp[]` array similarly to `opsToChanges`, but also slice the actual line arrays to populate `oldLines`/`newLines`
  - For "deleted" hunks: `newLines` is empty, `afterStartLine`/`afterEndLine` point to the marker position (same logic as current deleted markers)
  - For "added" hunks: `oldLines` is empty, `beforeStartLine`/`beforeEndLine` point to the insertion point in before
  - For "modified" hunks: both populated
  
  **Files**: `src/lib/line-diff.ts`
  **Acceptance**: New `computeHunks` is exported. Existing `computeLineChanges` tests still pass.

- [x] 2 **Add unit tests for `computeHunks`**
  **What**: Add test cases to `src/lib/__tests__/line-diff.test.ts` covering:
  - Identical content → empty array
  - Single added line → one hunk with `type: "added"`, correct `newLines`
  - Single deleted line → one hunk with `type: "deleted"`, correct `oldLines`
  - Single modified line → one hunk with `type: "modified"`, both `oldLines` and `newLines`
  - Multiple separate hunks (e.g., line 2 modified, line 10 added)
  - Contiguous changes grouped into single hunk
  - Edge: empty before, empty after
  **Files**: `src/lib/__tests__/line-diff.test.ts`
  **Acceptance**: `npm run test -- src/lib/__tests__/line-diff.test.ts` passes

---

### Phase 1: Feature 5 — Change Count Badge on File Tabs (simplest, no editor changes)

- [x] 3 **Compute per-file change counts from diffs**
  **What**: Create a utility function `buildFileChangeCounts(diffs: FileDiffItem[]): Map<string, { additions: number; deletions: number }>` in `src/lib/git-status-utils.ts`. This simply maps `diff.file → { diff.additions, diff.deletions }` from the `FileDiffItem[]` array. Trivial but encapsulates the logic.
  **Files**: `src/lib/git-status-utils.ts`
  **Acceptance**: Function exported and callable.

- [x] 4 **Pass change counts to FileTabBar**
  **What**: In `files-tab-content.tsx`:
  - Import `buildFileChangeCounts`
  - Add a `useMemo` to compute `fileChangeCounts` map from `diffs`
  - Pass `fileChangeCounts` as a new prop to `<FileTabBar>`
  
  Update the `FileTabBarProps` interface:
  ```ts
  fileChangeCounts?: Map<string, { additions: number; deletions: number }>;
  ```
  **Files**: `src/components/session/files-tab-content.tsx`, `src/components/session/file-tab-bar.tsx`
  **Acceptance**: Prop is passed; no visual change yet.

- [x] 5 **Render change count badges in FileTabBar**
  **What**: In `file-tab-bar.tsx`, after the file name `<span>`, conditionally render the change counts:
  ```tsx
  {counts && (counts.additions > 0 || counts.deletions > 0) && (
    <span className="ml-1 flex items-center gap-0.5 text-[10px] font-mono opacity-70">
      {counts.additions > 0 && <span className="text-green-500">+{counts.additions}</span>}
      {counts.deletions > 0 && <span className="text-red-500">-{counts.deletions}</span>}
    </span>
  )}
  ```
  Where `counts = fileChangeCounts?.get(file.path)`.
  Position: after the filename, before the close button area. Keep it compact (10px font, mono, reduced opacity).
  **Files**: `src/components/session/file-tab-bar.tsx`
  **Acceptance**: Open files with git changes show `+N -M` in tab. Files without changes show nothing.

---

### Phase 2: Feature 1 — Discard All Changes (File-Level Revert)

- [x] 6 **Add `discardChanges` function to `use-file-content`**
  **What**: Add a new `discardChanges(filePath: string)` callback to `useFileContent`. Implementation:
  ```ts
  const discardChanges = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const file = prev.get(filePath);
      if (!file) return prev;
      const next = new Map(prev);
      next.set(filePath, {
        ...file,
        content: file.originalContent,
        isDirty: false,
      });
      return next;
    });
  }, []);
  ```
  Also add `discardChanges` to the `UseFileContentResult` interface.
  **Files**: `src/hooks/use-file-content.ts`
  **Acceptance**: Function exists on the hook result. No API calls involved.

- [x] 7 **Add Discard Changes button with confirmation to editor toolbar**
  **What**: In `files-tab-content.tsx`, in the editor toolbar section (lines 347-386):
  - Import `Undo2` from lucide-react
  - Import `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/alert-dialog`
  - Add a "Discard Changes" button next to the Save button, visible only when `activeFile.isDirty`
  - The button triggers an AlertDialog confirmation:
    - Title: "Discard changes?"
    - Description: "This will revert all unsaved changes to {filename}."
    - Actions: "Cancel" and "Discard" (destructive variant)
  - On confirm: call `discardChanges(activeFile.path)`
  
  Button placement: before the Save button in the `gap-1` flex container. Use the same styling pattern as the markdown preview toggle button.
  ```tsx
  {activeFile.isDirty && (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Discard all changes"
        >
          <Undo2 className="h-3 w-3" />
          Discard
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>
            This will revert all unsaved changes to {getFileName(activeFile.path)}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => discardChanges(activeFile.path)}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )}
  ```
  
  **Files**: `src/components/session/files-tab-content.tsx`
  **Acceptance**: Button appears only for dirty files. Clicking shows confirmation. Confirming resets content to `originalContent`. Editor updates immediately.

- [x] 8 **Extract `getFileName` to shared utility**
  **What**: The `getFileName(path)` function exists in `file-tab-bar.tsx` (line 14). The discard dialog in `files-tab-content.tsx` also needs it. Either:
  - (a) Move to a tiny shared util (e.g., add to `src/lib/utils.ts`), or
  - (b) Duplicate inline (acceptable for a one-liner)
  
  Recommendation: option (a) — export from an existing util file. Add to `src/lib/utils.ts`:
  ```ts
  export function getFileName(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }
  ```
  Then import in both `file-tab-bar.tsx` and `files-tab-content.tsx`.
  **Files**: `src/lib/utils.ts`, `src/components/session/file-tab-bar.tsx`, `src/components/session/files-tab-content.tsx`
  **Acceptance**: Both files import from the same source. No duplicate definitions.

---

### Phase 3: Feature 2 — Inline Diff Toggle (DiffEditor)

- [x] 9 **Add diff mode state to `files-tab-content.tsx`**
  **What**: Add state to track which files are in "diff view" mode:
  ```ts
  const [diffViewPaths, setDiffViewPaths] = useState<Set<string>>(new Set());
  ```
  Add a toggle function:
  ```ts
  const toggleDiffView = useCallback((filePath: string) => {
    setDiffViewPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);
  ```
  Compute `showDiffView`:
  ```ts
  const showDiffView = activeFilePath !== null && diffViewPaths.has(activeFilePath) && gitBeforeContent !== undefined;
  ```
  **Files**: `src/components/session/files-tab-content.tsx`
  **Acceptance**: State exists but no UI yet.

- [x] 10 **Add diff toggle button to editor toolbar**
  **What**: In the toolbar's button area (after the markdown preview toggle, before discard/save), add a diff toggle button. Only visible when `gitBeforeContent` is available for the active file:
  ```tsx
  {gitBeforeContent !== undefined && (
    <button
      type="button"
      className={cn(
        "rounded px-2 py-0.5 text-xs transition-colors",
        diffViewPaths.has(activeFile.path)
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
      onClick={() => toggleDiffView(activeFile.path)}
      title={diffViewPaths.has(activeFile.path) ? "Exit diff view" : "Show inline diff"}
    >
      <GitCompareArrows className="h-3 w-3 inline mr-1" />
      {diffViewPaths.has(activeFile.path) ? "Editor" : "Diff"}
    </button>
  )}
  ```
  Import `GitCompareArrows` (or `Diff` or `GitCompare`) from lucide-react.
  **Files**: `src/components/session/files-tab-content.tsx`
  **Acceptance**: Button appears for files with git changes. Toggles active state styling.

- [x] 11 **Create `MonacoDiffEditorWrapper` component**
  **What**: Create a new component at `src/components/session/monaco-diff-editor-wrapper.tsx` that wraps `@monaco-editor/react`'s `DiffEditor`:
  
  Props:
  ```ts
  interface MonacoDiffEditorWrapperProps {
    original: string;         // gitBeforeContent
    modified: string;         // current content
    language: string;
    onChange?: (value: string) => void;  // for editable modified side
    readOnly?: boolean;
  }
  ```
  
  Implementation:
  - Dynamic import `DiffEditor` from `@monaco-editor/react` (same pattern as `MonacoEditorWrapper`)
  - Use `configureMonacoLoader` in `beforeMount` (same as existing wrapper)
  - Use `registerMonacoThemes` and `WEAVE_MONACO_THEME_MAP` for theme consistency
  - Pass `options` matching the regular editor's style (font, fontSize, minimap off, etc.)
  - For `onChange`: on mount, get the modified editor via `editor.getModifiedEditor()`, attach `onDidChangeModelContent` listener, read value and call `onChange`
  - If `readOnly` is true (or no `onChange`), set `readOnlyMessage` on modified side
  - Set `renderSideBySide: true` (or make it a prop if we want to allow toggling)
  
  Key options to mirror from the regular editor:
  ```ts
  options={{
    readOnly: readOnly,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "var(--font-jetbrains-mono), ...",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbers: "on",
    renderSideBySide: true,
    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
    padding: { top: 8, bottom: 8 },
  }}
  ```
  
  **Files**: `src/components/session/monaco-diff-editor-wrapper.tsx` (new file)
  **Acceptance**: Component renders a side-by-side diff. Theme matches the regular editor.

- [x] 12 **Integrate DiffEditor into the content area**
  **What**: In `files-tab-content.tsx`, in the content area (lines 397-448), add a condition for `showDiffView` before the regular `MonacoEditorWrapper`:
  ```tsx
  ) : showDiffView ? (
    <MonacoDiffEditorWrapper
      original={gitBeforeContent!}
      modified={activeFile.content}
      language={activeFile.language}
      onChange={(value) => updateContent(activeFile.path, value)}
    />
  ) : (
    <MonacoEditorWrapper ... />
  )
  ```
  The DiffEditor should allow editing the modified side so changes sync back. The order of conditions in the render should be: loading → error → image → binary → markdownPreview → **diffView** → normalEditor.
  
  **Files**: `src/components/session/files-tab-content.tsx`
  **Acceptance**: Toggling the diff button swaps between normal editor and DiffEditor. Edits in the DiffEditor's modified side update the file's content and dirty state. Theme is consistent.

- [x] 13 **Handle edge cases for diff toggle**
  **What**: 
  - When `gitBeforeContent` becomes `undefined` (e.g., user saves and file is no longer in diffs), auto-disable diff view: add a `useEffect` that removes the path from `diffViewPaths` if `gitBeforeContent` is `undefined`.
  - When switching active files, the diff view state is per-file (already handled by the `Set<string>` approach).
  - When file content becomes equal to `gitBeforeContent`, keep the diff view active (shows "no differences") — user can manually toggle off.
  **Files**: `src/components/session/files-tab-content.tsx`
  **Acceptance**: No stale diff views for files that lose their git context.

---

### Phase 4: Feature 3 — Hover to See Old Content on Changed Lines

- [x] 14 **Register a Monaco hover provider for changed lines**
  **What**: In `monaco-editor-wrapper.tsx`, after applying delta decorations, register a `HoverProvider` that shows the old content when hovering over changed lines.
  
  Implementation approach — use `monaco.languages.registerHoverProvider('*', ...)`:
  - In the `useEffect` that applies decorations (lines 119-172), after computing `changes`, also compute `hunks` using the new `computeHunks` from `line-diff.ts`
  - Store hunks in a ref: `const hunksRef = useRef<Hunk[]>([])`
  - Register (or update) a hover provider that, given a position, checks if the line falls within any hunk's `afterStartLine..afterEndLine`
  - If it does, return a `Hover` with `contents` showing the old content as a markdown code block:
    ```ts
    {
      contents: [
        { value: `**Previous content:**\n\`\`\`${language}\n${hunk.oldLines.join('\n')}\n\`\`\`` }
      ]
    }
    ```
  - For "added" hunks (no old content), show "New lines (no previous content)"
  - For "deleted" hunks, show the deleted lines
  - For "modified" hunks, show what the lines used to be
  
  Important: Register the hover provider once on mount, but update the hunks ref. Use a disposable ref to clean up:
  ```ts
  const hoverDisposableRef = useRef<IDisposable | null>(null);
  ```
  Register in `handleMount`, dispose in cleanup.
  
  Alternative approach (simpler): Instead of a hover provider, use `glyphMarginHoverMessage` in the decoration options. This is a Monaco feature where you can set `options.glyphMarginHoverMessage` to an `IMarkdownString` on each decoration. This is simpler but only triggers on glyph margin hover, not line hover.
  
  **Recommendation**: Use `glyphMarginHoverMessage` for simplicity. It's the most natural UX — user hovers over the colored gutter stripe and sees what changed.
  
  Updated decoration creation in `monaco-editor-wrapper.tsx`:
  ```ts
  // First compute hunks for hover messages
  const hunks = computeHunks(gitBeforeContent, debouncedContent);
  
  // Build a map from after-line-number → hunk for quick lookup
  const lineToHunk = new Map<number, Hunk>();
  for (const hunk of hunks) {
    for (let l = hunk.afterStartLine; l <= hunk.afterEndLine; l++) {
      lineToHunk.set(l, hunk);
    }
  }
  
  // In decoration creation, add glyphMarginHoverMessage:
  const hunk = lineToHunk.get(change.startLine);
  const hoverMessage = hunk ? buildHoverMessage(hunk, language) : undefined;
  
  // ... in options:
  glyphMarginHoverMessage: hoverMessage ? [hoverMessage] : undefined,
  ```
  
  The `buildHoverMessage` helper:
  ```ts
  function buildHoverMessage(hunk: Hunk, language: string): monaco.IMarkdownString {
    if (hunk.type === "added") {
      return { value: "*New lines — no previous content*" };
    }
    const oldCode = hunk.oldLines.join("\n");
    return { value: `**Previous:**\n\`\`\`${language}\n${oldCode}\n\`\`\`` };
  }
  ```
  
  **Note**: `glyphMarginHoverMessage` only shows on the first line of the decoration range. For multi-line hunks, set it on the first line's decoration only (or set it on all lines — Monaco handles deduplication). Actually, since each `LineChange` may span multiple lines but we create one decoration per change, and hunks group consecutive changes, we should set the hover on the first line of each hunk only.
  
  Refinement: Since decorations are created per `LineChange` (which already groups consecutive same-type changes), and `LineChange` maps 1:1 to hunks, we can simply set `glyphMarginHoverMessage` on every decoration. The hover will appear on whichever gutter line the user hovers.
  
  **Files**: `src/components/session/monaco-editor-wrapper.tsx`
  **Acceptance**: Hovering over a colored gutter stripe shows the previous content in a tooltip. Dismissed by moving the mouse away. Does not block editing.

- [x] 15 **Pass `language` prop for hover code blocks**
  **What**: The `MonacoEditorWrapper` already receives `language` as a prop but doesn't use it internally for the hover messages. The hover message needs the language for syntax-highlighted code blocks in the markdown tooltip. Ensure `language` is available in the decoration effect.
  
  Currently `language` is a prop but the decoration effect (`useEffect` at line 119) doesn't depend on it. Add `language` to the dependency array (it changes rarely so this is fine).
  
  **Files**: `src/components/session/monaco-editor-wrapper.tsx`
  **Acceptance**: Hover code blocks show syntax highlighting matching the file language.

- [x] 16 **Style the hover tooltip**
  **What**: Monaco's built-in hover widget uses the editor's theme colors. The markdown code blocks in `glyphMarginHoverMessage` will be rendered by Monaco's markdown renderer. No custom CSS should be needed — Monaco handles this. However, verify that:
  - Long hover content doesn't overflow
  - The tooltip is readable in all 9 themes
  - Code blocks use the correct font family
  
  If adjustments are needed, add CSS targeting `.monaco-hover-content` in `globals.css`.
  
  **Files**: `src/app/globals.css` (if needed)
  **Acceptance**: Hover tooltips are readable across all themes.

---

### Phase 5: Feature 4 — Hunk-Level Revert

- [x] 17 **Create `applyHunkRevert` utility function**
  **What**: Add a pure function to `src/lib/line-diff.ts`:
  ```ts
  export function applyHunkRevert(
    currentContent: string,
    hunk: Hunk
  ): string
  ```
  
  This function takes the current editor content and a hunk, and returns the new content with that hunk reverted:
  - For "added" hunks: remove lines `afterStartLine..afterEndLine` from the current content
  - For "deleted" hunks: insert `hunk.oldLines` at the hunk's `afterStartLine` position
  - For "modified" hunks: replace lines `afterStartLine..afterEndLine` with `hunk.oldLines`
  
  Implementation:
  ```ts
  export function applyHunkRevert(currentContent: string, hunk: Hunk): string {
    const lines = currentContent.split("\n");
    const startIdx = hunk.afterStartLine - 1; // 0-based
    const endIdx = hunk.afterEndLine - 1;      // 0-based, inclusive
    const deleteCount = endIdx - startIdx + 1;
    
    if (hunk.type === "added") {
      lines.splice(startIdx, deleteCount);
    } else if (hunk.type === "deleted") {
      lines.splice(startIdx, 0, ...hunk.oldLines);
    } else {
      // modified: replace new lines with old lines
      lines.splice(startIdx, deleteCount, ...hunk.oldLines);
    }
    
    return lines.join("\n");
  }
  ```
  
  **Important edge case**: For "deleted" hunks, `afterStartLine` is a marker position (the line after which content was deleted). Need to verify the insertion position is correct. The hunk's `afterStartLine` for deletions points to the nearest line in the after content — insertions should happen at that position.
  
  **Files**: `src/lib/line-diff.ts`
  **Acceptance**: Unit tests pass for all hunk types.

- [x] 18 **Add unit tests for `applyHunkRevert`**
  **What**: Test cases:
  - Revert an "added" hunk → lines are removed
  - Revert a "deleted" hunk → old lines are re-inserted
  - Revert a "modified" hunk → new lines replaced with old lines
  - Revert a single-line modification
  - Revert at start of file (line 1)
  - Revert at end of file
  - Round-trip: apply all hunk reverts → get back to original (for single-hunk files)
  
  **Files**: `src/lib/__tests__/line-diff.test.ts`
  **Acceptance**: All tests pass.

- [x] 19 **Add hunk revert glyph margin actions in MonacoEditorWrapper**
  **What**: In `monaco-editor-wrapper.tsx`, for each hunk, add a clickable action in the glyph margin. Monaco supports `GlyphMarginLane` and glyph margin widgets for this purpose.
  
  Approach — Use Monaco's `glyphMarginClassName` with a clickable CSS class + `onMouseDown` handler:
  
  Actually, Monaco doesn't natively support click handlers on glyph margin decorations. The standard pattern is:
  
  **Option A**: Use `editor.addAction` or code lens for revert actions (not gutter-specific).
  
  **Option B**: Use `editor.onMouseDown` to detect clicks on the glyph margin, then check if the clicked line has a hunk.
  
  **Option C**: Use Monaco's `IContentWidget` or `IOverlayWidget` positioned in the glyph margin area.
  
  **Recommendation**: Option B — listen to `editor.onMouseDown`, check if `target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN`, get the line number, look up the hunk, and trigger revert.
  
  Implementation:
  1. In `handleMount`, add a mouse down listener:
     ```ts
     editor.onMouseDown((e) => {
       if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
         const lineNumber = e.target.position?.lineNumber;
         if (lineNumber) {
           onHunkRevertRef.current?.(lineNumber);
         }
       }
     });
     ```
  2. Add a new prop to `MonacoEditorWrapper`:
     ```ts
     onHunkRevert?: (lineNumber: number) => void;
     ```
  3. Store in a ref to avoid stale closures (same pattern as `onSaveRef`).
  
  However, this means ANY click on the glyph margin triggers revert, which is too aggressive. We need to distinguish between "revert click" and normal click.
  
  **Better approach**: Add a dedicated revert icon as a separate CSS class on a narrow region. Use a custom glyph margin decoration with a different className that includes a revert icon (via CSS `::after` pseudo-element or background-image), placed only on the first line of each hunk.
  
  Revised plan:
  1. For each hunk, add a SECOND decoration on the first line of the hunk with a special class `glyph-margin-git-revert` that shows a small revert arrow icon
  2. In the `onMouseDown` handler, check if the clicked element has the `glyph-margin-git-revert` class (via `e.target.element?.classList`)
  3. If so, find the hunk for that line and trigger revert
  
  CSS for the revert icon in `globals.css`:
  ```css
  .glyph-margin-git-revert {
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    width: 14px !important;
    height: 14px !important;
    margin-left: 8px;
    background-image: url("data:image/svg+xml,..."); /* inline SVG of a revert arrow */
    background-size: 12px 12px;
    background-repeat: no-repeat;
    background-position: center;
  }
  .glyph-margin-git-revert:hover,
  .monaco-editor .margin:hover .glyph-margin-git-revert {
    opacity: 0.7;
  }
  .glyph-margin-git-revert:hover {
    opacity: 1;
  }
  ```
  
  Note: Monaco's glyph margin only supports one decoration per lane. We may need `glyphMargin: true` and use `GlyphMarginLane.Left` for the color stripe and `GlyphMarginLane.Right` for the revert icon. Check Monaco API version for `GlyphMarginLane` support.
  
  **Alternative simpler approach**: Instead of a glyph margin icon, show the revert button as a hover widget above the first line of each hunk. Use Monaco's `IContentWidget`:
  - Create a content widget positioned at the start of the first line of each hunk
  - The widget contains a small "↩" button
  - Show it only when the cursor/mouse is near the hunk
  - Clicking calls `onHunkRevert(hunkIndex)`
  
  **Simplest viable approach**: Use a code lens provider. Register `monaco.languages.registerCodeLensProvider('*', ...)` that adds a "Revert" code lens above each hunk's first line. This is non-intrusive, familiar from VSCode, and fully supported.
  
  However, code lenses are more for information display. They work but feel slightly off for a revert action.
  
  **Final recommendation**: Use `editor.onMouseDown` + glyph margin approach. Add the revert decoration only on the FIRST line of each hunk. Use CSS to show/hide the revert icon on hover. The `onMouseDown` handler checks both (a) it's a glyph margin click and (b) the line has a revert decoration.
  
  For the glyph margin to support both the color stripe AND the revert icon, use `marginClassName` (which targets the entire margin line) for the color stripe, and `glyphMarginClassName` for the revert icon. Wait — currently the color stripe IS in `glyphMarginClassName`. We'd need to move the stripe to `linesDecorationsClassName` instead, freeing up the glyph margin for the revert icon.
  
  **Revised decoration strategy**:
  - Color stripe: move from `glyphMarginClassName` to `linesDecorationsClassName` (Monaco's "lines decorations" appear as a thin strip in the margin)
  - Revert icon: put in `glyphMarginClassName` on the first line of each hunk only
  - This means updating existing CSS class names and the decoration creation code
  
  Actually, `linesDecorationsClassName` draws a decoration between line numbers and the code. The current glyph margin approach draws to the LEFT of line numbers. Let's keep the current glyph margin stripes and add the revert icon using a **different technique**:
  
  Use Monaco `IViewZone` + `IOverlayWidget` to place a small floating button. This is complex.
  
  **Pragmatic final approach**: Keep it simple. Don't use glyph margin for the revert icon. Instead:
  1. On the first line of each hunk, add a `linesDecorationsClassName` with a revert icon that appears on hover
  2. The existing glyph margin stripes remain unchanged
  3. `editor.onMouseDown` checks `target.type === MouseTargetType.GUTTER_LINE_DECORATIONS` and the element's class
  
  This works because `linesDecorationsClassName` creates a separate clickable region in the margin.
  
  **Files**: `src/components/session/monaco-editor-wrapper.tsx`, `src/app/globals.css`
  **Acceptance**: Each hunk shows a small revert icon on its first line in the margin (visible on hover). Clicking it triggers the revert callback.

- [x] 20 **Wire hunk revert into `files-tab-content.tsx`**
  **What**: 
  1. Pass a new `onHunkRevert` prop to `MonacoEditorWrapper`
  2. In `files-tab-content.tsx`, implement the handler:
     ```ts
     const handleHunkRevert = useCallback((lineNumber: number) => {
       if (!activeFilePath || !gitBeforeContent) return;
       const activeFile = openFiles.get(activeFilePath);
       if (!activeFile) return;
       
       const hunks = computeHunks(gitBeforeContent, activeFile.content);
       const hunk = hunks.find(h => lineNumber >= h.afterStartLine && lineNumber <= h.afterEndLine);
       if (!hunk) return;
       
       const newContent = applyHunkRevert(activeFile.content, hunk);
       updateContent(activeFilePath, newContent);
     }, [activeFilePath, gitBeforeContent, openFiles, updateContent]);
     ```
  3. Pass to the editor: `onHunkRevert={handleHunkRevert}`
  
  **Files**: `src/components/session/files-tab-content.tsx`, `src/components/session/monaco-editor-wrapper.tsx`
  **Acceptance**: Clicking a hunk's revert icon reverts only that hunk. Other hunks remain unchanged. The editor updates in place.

- [x] 21 **Handle hunk revert edge cases**
  **What**: Consider and handle:
  - **Cascading line shifts**: After reverting one hunk, line numbers change. The hunks are recomputed on the next debounced cycle (300ms). Until then, clicking another hunk might use stale line numbers. Mitigation: recompute hunks immediately after revert by forcing a synchronous diff.
  - **Undo support**: After revert, the user should be able to Ctrl+Z. Since we call `updateContent` which sets the value, Monaco may lose undo history. Consider using `editor.executeEdits` instead to push an edit onto the undo stack. This requires the revert to happen inside the editor, not via prop change.
    
    Better approach: Instead of updating via `updateContent` (which replaces the entire value via prop), use `editor.getModel()?.pushEditOperations()` or `editor.executeEdits()` to apply the revert as an edit operation. This preserves undo history.
    
    This means the `onHunkRevert` callback should receive the full hunk info and the editor ref should be available. The revert logic should live in `MonacoEditorWrapper` where it has access to the editor instance.
    
    Revised flow:
    1. `MonacoEditorWrapper` detects glyph click → determines line number → finds hunk from hunksRef → applies edit via `editor.executeEdits`
    2. The `onChange` handler fires naturally, updating the parent state
    3. No need for `onHunkRevert` prop — the wrapper handles it internally
    
    But the wrapper needs `gitBeforeContent` (which it already has) and the hunks (which it already computes). So the revert can be self-contained.
  
  - **Empty file after revert**: If reverting the only change in a file makes content equal to `gitBeforeContent`, the decorations should clear naturally.
  
  **Files**: `src/components/session/monaco-editor-wrapper.tsx`
  **Acceptance**: Undo works after hunk revert. Multiple reverts in sequence work correctly.

- [x] 22 **Add CSS for hunk revert icon in margin**
  **What**: Add styles to `globals.css` for the lines decoration revert icon:
  ```css
  /* Hunk revert icon in lines decoration margin */
  .lines-decoration-git-revert {
    width: 16px !important;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E");
    background-size: 12px 12px;
    background-repeat: no-repeat;
    background-position: center;
  }
  
  /* Show on line hover — Monaco adds hover state to the margin row */
  .monaco-editor .margin-view-overlays > div:hover .lines-decoration-git-revert,
  .lines-decoration-git-revert:hover {
    opacity: 0.6;
  }
  .lines-decoration-git-revert:hover {
    opacity: 1;
  }
  ```
  
  **Note**: The exact CSS selectors for Monaco's margin may need experimentation. Monaco's margin structure is `.margin > .margin-view-overlays > div[line]`. The `linesDecorationsClassName` creates an element inside each line's overlay. Test in browser DevTools.
  
  **Files**: `src/app/globals.css`
  **Acceptance**: Revert icon appears on hover, is clickable, uses a recognizable undo/revert arrow icon.

---

### Phase 6: Integration & Polish

- [x] 23 **Ensure features compose correctly**
  **What**: Test the following interactions:
  - Discard changes while diff view is open → should switch back to normal editor (content now matches original, diff view may need updating)
  - Hunk revert while diff view is open → diff view should update to reflect the partial revert
  - Change count badges should update as hunks are reverted
  - Hover tooltips should update after hunk reverts (hunks re-computed)
  - Opening a file with no git changes → no diff toggle, no revert icons, no hover, no badges
  - Switching between files → all per-file state (diff view toggle, decorations) should be independent
  
  **Files**: No code changes — manual testing checklist
  **Acceptance**: All combinations work without errors.

- [x] 24 **Performance considerations**
  **What**: 
  - `computeHunks` is called in the decoration effect (debounced 300ms) — same as `computeLineChanges`. For most files this is fast, but very large files (>5000 lines) could be slow due to the O(n*m) LCS algorithm.
  - The existing `computeLineChanges` already handles this (tested at 1000 lines in 5s budget). `computeHunks` uses the same algorithm, just extracts more data.
  - Badge computation uses pre-computed API values, not line-diff — no perf concern.
  - DiffEditor is a separate Monaco instance — mounting/unmounting has a cost. Consider `display: none` instead of conditional rendering for smoother toggles. However, this means both editors are in the DOM. Trade-off: smoother toggle vs. memory use. For now, use conditional rendering (simpler, less memory).
  
  **Files**: No changes unless profiling reveals issues
  **Acceptance**: No noticeable lag on files up to 2000 lines.

- [x] 25 **Keyboard accessibility for hunk revert**
  **What**: The glyph margin click is mouse-only. Add a keyboard shortcut or context menu entry for reverting the hunk at the cursor position:
  - Register a Monaco action via `editor.addAction`:
    ```ts
    editor.addAction({
      id: "weave-revert-hunk",
      label: "Revert This Change",
      contextMenuGroupId: "modification",
      contextMenuOrder: 1,
      run: (editor) => {
        const position = editor.getPosition();
        if (!position) return;
        // Find hunk at position.lineNumber, apply revert
      },
    });
    ```
  This adds a right-click context menu item "Revert This Change" that works the same as the gutter click.
  
  **Files**: `src/components/session/monaco-editor-wrapper.tsx`
  **Acceptance**: Right-click on a changed line → "Revert This Change" menu item → reverts the hunk.

## Verification
- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `npm run test` passes all existing tests
- [ ] New tests for `computeHunks` and `applyHunkRevert` pass
- [ ] Manual testing: each feature works independently
- [ ] Manual testing: features compose correctly (see 6.1)
- [ ] All 9 themes tested for visual consistency (hover tooltips, diff editor, badges)
- [ ] No regressions in: file open/close, save, dirty tracking, SSE reload, file tree coloring

## Implementation Order Summary

```
Phase 0  →  0.1, 0.2          (shared infra: hunk types + tests)
Phase 1  →  1.1, 1.2, 1.3     (badges — simplest, no editor changes)
Phase 2  →  2.3, 2.1, 2.2     (discard — extract getFileName first, then hook, then UI)
Phase 3  →  3.1, 3.2, 3.3, 3.4, 3.5  (diff toggle — state, button, component, wire, edge cases)
Phase 4  →  4.1, 4.2, 4.3     (hover — decorations + hover messages)
Phase 5  →  5.1, 5.2, 5.3, 5.4, 5.5, 5.6  (hunk revert — utility, tests, UI, wiring, edge cases, CSS)
Phase 6  →  6.1, 6.2, 6.3     (polish — integration testing, perf, keyboard)
```

Dependencies:
- **Phase 0** blocks Phases 4 and 5 (they use `computeHunks` and `Hunk` type)
- **Phase 1** is independent — can be done in parallel with anything
- **Phase 2** is independent — can be done in parallel with Phase 1
- **Phase 3** is independent of other features but should come before Phase 4 (both touch MonacoEditorWrapper)
- **Phase 4** depends on Phase 0 (uses `computeHunks` for hover content)
- **Phase 5** depends on Phase 0 (uses `computeHunks` and `applyHunkRevert`)
- **Phase 6** depends on all previous phases
