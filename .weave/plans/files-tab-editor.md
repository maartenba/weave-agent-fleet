# Files Tab with Integrated Monaco Editor

## TL;DR
> **Summary**: Add a "Files" tab to the session detail page with a collapsible file tree, Monaco code editor, theme-aware syntax highlighting, bi-directional file editing (editor ↔ OpenCode), and stretch goals of Markdown preview and image preview.
> **Estimated Effort**: Large

## Context
### Original Request
Add a new "Files" tab alongside "Activity" and "Changes" in each session, showing files created/modified by the agent in a directory tree. Clicking a file opens it in a Monaco editor that respects the app's 9 themes. Edits made in the editor should reflect on the "Changes" tab and be communicated back to OpenCode's context.

### Key Findings

**Session Page Architecture** (`src/app/sessions/[id]/page.tsx`, 1,165 lines):
- Uses Radix UI `Tabs` (from `src/components/ui/tabs.tsx`) with `variant="line"` and `defaultValue="activity"`.
- Two tabs currently: `"activity"` (lines 760-812) and `"changes"` (lines 813-815).
- Tab change handler on line 757: `onValueChange={(value) => { if (value === "changes") fetchDiffs(); }}` — pattern to follow for Files tab lazy loading.
- `useDiffs()` hook returns `{ diffs, isLoading, error, fetchDiffs }` — diffs contain `{ file, before, after, additions, deletions, status }`.
- Session metadata (line 285-289) includes `workspaceDirectory` — this is the resolved on-disk path of the session's workspace.
- `instanceId` is available from URL search params (line 67).

**Diffs API** (`src/app/api/sessions/[id]/diffs/route.ts`):
- Calls `client.session.diff({ sessionID })` on the OpenCode SDK.
- SDK returns `FileDiff` objects with `{ file, before, after, additions, deletions }`.
- `before`/`after` contain full file contents as strings — useful for populating the editor.
- The diffs are git-based (comparing worktree to base branch), so writing a file to disk and re-fetching diffs will correctly reflect changes.

**OpenCode SDK Capabilities** (`@opencode-ai/sdk/v2`):
- SDK methods observed in codebase: `client.session.{create, get, list, messages, diff, abort, promptAsync, command, status}`.
- No `client.file.*` or `client.fs.*` methods found — the SDK does **not** expose file reading/writing directly.
- The SDK communicates with an `opencode serve` process bound to a `directory`.
- OpenCode tracks git state — writing files to disk is sufficient for it to see changes on next read. No explicit "notify" API exists.

**ManagedInstance** (`src/lib/server/process-manager.ts`):
- `ManagedInstance.directory` gives the workspace root path for any instance.
- `getInstance(instanceId)` returns the instance with its directory.
- This directory can be used for server-side `fs.readFile`/`fs.writeFile` operations.

**Theme System** (`src/contexts/theme-context.tsx` + `src/app/globals.css`):
- 9 themes: `default`, `black`, `light`, `nord`, `dracula`, `solarized-dark`, `solarized-light`, `monokai`, `github-dark`.
- `useTheme()` returns `{ theme, resolvedTheme }` where `resolvedTheme` is `"light"` or `"dark"`.
- CSS variables: `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--accent`, etc.
- Existing pattern in `diff-viewer.tsx` (line 48): `getDiffStyleOverride(theme)` maps theme → hardcoded color values. Same approach needed for Monaco themes.

**Existing Patterns to Follow**:
- Tool cards (`src/components/session/tool-cards/write-tool-card.tsx`, `read-tool-card.tsx`) show file paths with `shortenPath()` from `src/lib/tool-labels.ts`.
- Language detection: `getLanguageFromPath()` in `src/lib/tool-card-utils.ts` maps extensions to highlight.js language IDs — reusable for Monaco language detection (with mapping to Monaco language IDs).
- Collapsible sections use `@/components/ui/collapsible` (Radix `Collapsible`).
- Scroll areas use `@/components/ui/scroll-area`.
- Loading/error states follow a consistent pattern (see `DiffViewer` lines 208-231).

**Dependencies**:
- `@monaco-editor/react` is **not** yet installed — must be added.
- `react-markdown` v10.1.0 is already installed (for stretch goal).
- `react-diff-viewer-continued` already installed for Changes tab.
- No tree view component exists — build from scratch using Radix `Collapsible` or plain HTML.

**Tauri/Bundling Considerations**:
- App uses `next build` with `output: 'standalone'` and Tauri 2 for desktop.
- `@monaco-editor/react` loads Monaco from CDN by default. For Tauri offline support, configure `monaco-editor` as a local dependency and use `@monaco-editor/loader` to set the path.
- `next.config.ts` has `serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"]` — Monaco is client-only, no server externals needed.

**File Content Access Strategy**:
- For **changed files**: diffs API already provides `before`/`after` content — use `after` for current state.
- For **listing files**: Need a new API endpoint since the SDK has no file listing. Server-side `fs.readdir` on `instance.directory` + recursive walk.
- For **reading arbitrary files**: New API endpoint using `fs.readFile`.
- For **writing files**: New API endpoint using `fs.writeFile` → triggers git diff refresh on Changes tab.
- **Security**: All file operations must be path-validated to stay within the workspace directory (prevent path traversal).

## Objectives
### Core Objective
Give users a fully-featured code editor inside the session view so they can inspect and modify files that the AI agent creates/edits, with changes flowing back to the agent's context and the Changes diff view.

### Deliverables
- [ ] New "Files" tab on session detail page with file tree + Monaco editor
- [ ] File tree component (collapsible directory hierarchy) populated from workspace directory
- [ ] Monaco editor with theme-aware syntax highlighting (9 custom themes matching app CSS variables)
- [ ] API endpoints for file listing, reading, and writing
- [ ] Bi-directional sync: edits in Monaco → disk → Changes tab diffs update
- [ ] Editor state management (open files, dirty/saved indicators, active file)
- [ ] (Stretch) Markdown preview toggle for `.md` files
- [ ] (Stretch) Image/SVG preview for image files

### Definition of Done
- [x] `npm run typecheck` passes with zero errors
- [x] `npm run lint` passes
- [x] `npm run test` passes — new unit tests cover API routes and utility functions
- [ ] Opening the Files tab shows a tree of workspace files
- [ ] Clicking a file opens it in Monaco with correct syntax highlighting
- [ ] Editing a file and saving writes to disk; switching to Changes tab shows the edit as a diff
- [ ] Theme switching updates the Monaco editor colors in real-time

### Guardrails (Must NOT)
- Must NOT allow reading/writing files outside the workspace directory (path traversal)
- Must NOT break existing Activity or Changes tabs
- Must NOT auto-save — explicit save action only (user may be experimenting)
- Must NOT bundle Monaco in the server bundle — client-only dynamic import
- Must NOT install Monaco from CDN in production Tauri builds — local bundle required

## TODOs

### Phase 1: Dependencies & Monaco Infrastructure

- [x] 1. **Install Monaco dependencies**
  **What**: Add `@monaco-editor/react` and `monaco-editor` to `package.json` dependencies. The `monaco-editor` package provides the actual editor; `@monaco-editor/react` provides the React wrapper with lazy loading.
  **Files**: `package.json`
  **Acceptance**: `npm install` succeeds; `npm run typecheck` passes.

- [x] 2. **Configure Monaco loader for local bundling**
  **What**: Create a Monaco loader configuration module that uses `@monaco-editor/loader` to point at the local `monaco-editor` package rather than CDN. This is critical for Tauri offline support. The loader is initialized once on first use.
  **Files**: `src/lib/monaco-loader.ts` (new)
  **Details**:
  ```
  // Pseudocode:
  import loader from "@monaco-editor/loader";
  import * as monaco from "monaco-editor";
  loader.config({ monaco });
  export { loader };
  ```
  **Acceptance**: Monaco loads without network requests when the app is offline.

- [x] 3. **Create Monaco theme definitions**
  **What**: Define 9 custom Monaco themes that match the app's CSS variable palette. Monaco themes use `monaco.editor.defineTheme()` with a base (`vs`, `vs-dark`, `hc-black`) and color rules. Map each Weave theme's CSS variables to Monaco's `colors` and `rules` objects.
  **Files**: `src/lib/monaco-themes.ts` (new)
  **Details**:
  Each theme definition maps to:
  - `editor.background` → `--background` CSS variable value
  - `editor.foreground` → `--foreground`
  - `editor.lineHighlightBackground` → `--accent` or `--muted`
  - `editorLineNumber.foreground` → `--muted-foreground`
  - `editor.selectionBackground` → `--primary` with alpha
  - `editorGutter.background` → `--background`
  - `editorWidget.background` → `--card`
  - `editorWidget.border` → `--border`
  
  Theme mapping (Weave theme → Monaco base):
  | Weave Theme | Monaco Base | Key Background |
  |---|---|---|
  | `default` | `vs-dark` | `#0F172A` |
  | `black` | `vs-dark` | `#000000` |
  | `light` | `vs` | `#FFFFFF` |
  | `nord` | `vs-dark` | `#2E3440` |
  | `dracula` | `vs-dark` | `#282A36` |
  | `solarized-dark` | `vs-dark` | `#002B36` |
  | `solarized-light` | `vs` | `#FDF6E3` |
  | `monokai` | `vs-dark` | `#272822` |
  | `github-dark` | `vs-dark` | `#0D1117` |
  
  For `nord`, `dracula`, `monokai`, and `github-dark` — there are well-known community Monaco themes. Use their token color rules (for syntax highlighting accuracy) but override the editor chrome colors with the CSS variable values from `globals.css`.
  **Acceptance**: Each theme renders with visually matching background/foreground colors. No jarring contrast between the Monaco editor and surrounding UI.

### Phase 2: API Endpoints

- [x] 4. **Create file listing API route**
  **What**: `GET /api/sessions/[id]/files?instanceId=xxx` — returns a flat list of files in the workspace directory, excluding common ignore patterns (`.git`, `node_modules`, `.next`, etc.). Returns paths relative to the workspace root.
  **Files**: `src/app/api/sessions/[id]/files/route.ts` (new)
  **Request**: `GET /api/sessions/[id]/files?instanceId=xxx`
  **Response**:
  ```json
  {
    "root": "/absolute/path/to/workspace",
    "files": [
      { "path": "src/index.ts", "type": "file", "size": 1234 },
      { "path": "src/utils", "type": "directory" },
      { "path": "package.json", "type": "file", "size": 567 }
    ]
  }
  ```
  **Implementation**:
  - Use `getInstance(instanceId)` to get `instance.directory`.
  - Recursive `fs.readdir` with `{ withFileTypes: true }`.
  - Filter out: `.git`, `node_modules`, `.next`, `.turbo`, `dist`, `build`, `coverage`, `__pycache__`, `.weave`.
  - Return paths relative to workspace root.
  - Cap depth at 10 levels, cap total entries at 5,000 to prevent overwhelming the UI.
  **Security**: Resolve all paths and assert they start with the workspace directory.
  **Acceptance**: Returns correct file tree for a real workspace. Excluded directories don't appear.

- [x] 5. **Create file read API route**
  **What**: `GET /api/sessions/[id]/files/[...path]?instanceId=xxx` — reads a single file's content. Uses catch-all route segment for nested paths.
  **Files**: `src/app/api/sessions/[id]/files/[...path]/route.ts` (new)
  **Request**: `GET /api/sessions/[id]/files/src/index.ts?instanceId=xxx`
  **Response**:
  ```json
  {
    "path": "src/index.ts",
    "content": "import ...\n...",
    "size": 1234,
    "language": "typescript",
    "isBinary": false
  }
  ```
  **Implementation**:
  - Resolve `path` segments to a full filesystem path.
  - Validate the resolved path is within `instance.directory`.
  - Detect binary files (check first 8KB for null bytes).
  - For binary files: return `{ isBinary: true, content: null, mime: "..." }`.
  - For text files: `fs.readFile` with `"utf-8"` encoding.
  - Use `getLanguageFromPath()` from `tool-card-utils.ts` to detect language (extend for Monaco language IDs).
  - Cap file size at 5MB to prevent memory issues.
  **Security**: Path traversal protection via `path.resolve()` + startsWith check.
  **Acceptance**: Can read any text file in the workspace. Binary files are detected. Path traversal attempts return 403.

- [x] 6. **Create file write API route**
  **What**: `POST /api/sessions/[id]/files/[...path]?instanceId=xxx` — writes content to a file on disk.
  **Files**: `src/app/api/sessions/[id]/files/[...path]/route.ts` (same file as read, POST handler)
  **Request**:
  ```json
  { "content": "new file content here" }
  ```
  **Response**: `{ "success": true, "path": "src/index.ts" }`
  **Implementation**:
  - Same path resolution and validation as read.
  - `fs.writeFile` with `"utf-8"` encoding.
  - Create parent directories if they don't exist (`fs.mkdir` with `{ recursive: true }`).
  - No notification to OpenCode needed — it reads from disk on each tool invocation and uses git for diff tracking.
  **Security**: Same path traversal protection. Refuse writes to `.git/` directory.
  **Acceptance**: Writing a file via API + refreshing diffs shows the change. Cannot write outside workspace.

- [x] 7. **Add path security utility**
  **What**: Create a shared utility for validating that a resolved file path is within a given root directory. Used by both file read and write routes.
  **Files**: `src/lib/server/path-security.ts` (new)
  **Details**:
  ```
  export function validatePathWithinRoot(root: string, relativePath: string): string
  // Returns the resolved absolute path, or throws if it escapes root.
  // Handles: "..", symlinks (via fs.realpath), null bytes, etc.
  ```
  **Acceptance**: Unit tests cover: normal paths, `../` traversal, symlink escape, null bytes, absolute path injection.

- [x] 8. **Add language ID mapping for Monaco**
  **What**: Extend `getLanguageFromPath()` or create a companion function that returns Monaco-compatible language IDs instead of highlight.js IDs. Monaco uses different identifiers (e.g. `"typescript"` is the same, but `"bash"` → `"shell"`, `"ini"` → `"ini"`, etc.).
  **Files**: `src/lib/tool-card-utils.ts` (modify — add `getMonacoLanguageFromPath()`)
  **Acceptance**: All common file extensions return correct Monaco language IDs.

### Phase 3: Client-Side Hooks & State

- [x] 9. **Create `useFileTree` hook**
  **What**: Hook that fetches and caches the file tree for a session's workspace. Called when Files tab is activated. Supports refresh. Transforms flat file list into a nested tree structure for the UI.
  **Files**: `src/hooks/use-file-tree.ts` (new)
  **Interface**:
  ```ts
  interface FileTreeNode {
    name: string;
    path: string;     // relative path from workspace root
    type: "file" | "directory";
    size?: number;
    children?: FileTreeNode[];
    isExpanded?: boolean;
  }
  
  interface UseFileTreeResult {
    tree: FileTreeNode[];
    isLoading: boolean;
    error?: string;
    fetchTree: () => void;
    toggleExpand: (path: string) => void;
  }
  ```
  **Implementation**:
  - `apiFetch()` to `GET /api/sessions/[id]/files?instanceId=xxx`.
  - Transform flat `files[]` into a nested tree by splitting paths on `/`.
  - Sort: directories first, then files, alphabetically within each group.
  - Track expanded directories in local state (default: expand first 2 levels).
  **Acceptance**: Returns a properly nested tree. Toggle expand/collapse works.

- [x] 10. **Create `useFileContent` hook**
  **What**: Hook that fetches file content on demand. Manages loading state, error state, and caches content for open files. Provides a save function that writes back to disk.
  **Files**: `src/hooks/use-file-content.ts` (new)
  **Interface**:
  ```ts
  interface OpenFile {
    path: string;
    content: string;
    originalContent: string;  // for dirty detection
    language: string;
    isBinary: boolean;
    isLoading: boolean;
    error?: string;
    isDirty: boolean;
  }
  
  interface UseFileContentResult {
    openFiles: Map<string, OpenFile>;
    activeFile: string | null;
    openFile: (path: string) => Promise<void>;
    closeFile: (path: string) => void;
    setActiveFile: (path: string) => void;
    updateContent: (path: string, content: string) => void;
    saveFile: (path: string) => Promise<void>;
    isSaving: boolean;
  }
  ```
  **Implementation**:
  - `openFile()`: fetch from API, add to `openFiles` map, set as active.
  - `updateContent()`: update content in map, mark as dirty.
  - `saveFile()`: POST to write API, update `originalContent` to match, clear dirty flag.
  - Cache: keep content in memory for open files. Clear on close.
  - Limit open files to 10 (close oldest when exceeded).
  **Acceptance**: Can open, edit, save, and close files. Dirty indicator is accurate.

### Phase 4: UI Components

- [x] 11. **Create `FileTree` component**
  **What**: Recursive tree view component showing the workspace file hierarchy. Directories are collapsible, files are clickable. Shows file icons based on extension/type.
  **Files**: `src/components/session/file-tree.tsx` (new)
  **Design**:
  - Indentation: 16px per level.
  - Directory nodes: `ChevronRight`/`ChevronDown` + `Folder`/`FolderOpen` icons from `lucide-react`.
  - File nodes: `FileText` icon (or type-specific: `FileCode` for code files, `FileImage` for images, `FileJson` for JSON).
  - Active file: highlighted with `bg-accent` background.
  - Dirty files: show a dot indicator next to the filename.
  - Context: receive `tree`, `onFileSelect`, `activeFile`, `dirtyFiles` as props.
  - Styling: `text-xs font-mono`, use `ScrollArea` for overflow.
  **Acceptance**: Renders correctly with deeply nested directories. Click handlers fire. Active file is visually distinct.

- [x] 12. **Create `MonacoEditor` wrapper component**
  **What**: Wrapper around `@monaco-editor/react`'s `Editor` component that handles theme integration, lazy loading, and the Weave-specific configuration.
  **Files**: `src/components/session/monaco-editor-wrapper.tsx` (new)
  **Props**:
  ```ts
  interface MonacoEditorWrapperProps {
    content: string;
    language: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }
  ```
  **Implementation**:
  - `React.lazy()` or `next/dynamic` with `{ ssr: false }` — Monaco must not run on server.
  - On mount: register all 9 custom themes via `monaco.editor.defineTheme()`.
  - Subscribe to `useTheme()` — when theme changes, call `monaco.editor.setTheme(themeName)`.
  - Editor options: `minimap: { enabled: false }` (save space), `fontSize: 13`, `wordWrap: "on"`, `scrollBeyondLastLine: false`, `automaticLayout: true`.
  - Show a loading skeleton while Monaco loads (~500ms on first load).
  **Acceptance**: Editor renders with correct theme. Theme switching updates colors without remounting. No SSR errors.

- [x] 13. **Create `FileTabBar` component**
  **What**: Horizontal tab bar above the editor showing open files. Each tab shows the filename, a dirty indicator (dot), and a close button. Clicking switches the active file.
  **Files**: `src/components/session/file-tab-bar.tsx` (new)
  **Design**:
  - Horizontal scrollable container (like a browser tab bar).
  - Each tab: filename (not full path) + close `X` button.
  - Dirty files show a filled circle instead of close X (or both).
  - Active tab: `border-b-2 border-primary`.
  - Overflow: horizontal scroll with `no-scrollbar` utility.
  - Tooltip on hover: show full relative path.
  **Acceptance**: Tabs render. Click switches active file. Close removes from open files. Dirty indicator visible.

- [x] 14. **Create `FilesTabContent` component**
  **What**: The main container for the Files tab, combining the file tree (left panel), editor (center), and optional preview (right). Uses a resizable split layout.
  **Files**: `src/components/session/files-tab-content.tsx` (new)
  **Layout**:
  ```
  ┌─────────────┬────────────────────────────────────┐
  │  File Tree   │  [file-tab-bar]                    │
  │  (250px,     │  ┌────────────────────────────────┐ │
  │   resizable) │  │  Monaco Editor / Preview       │ │
  │              │  │                                │ │
  │              │  │                                │ │
  │              │  └────────────────────────────────┘ │
  └─────────────┴────────────────────────────────────┘
  ```
  **Implementation**:
  - Left panel: `FileTree` with fixed initial width of 250px.
  - Right panel: `FileTabBar` + `MonacoEditorWrapper` or preview pane.
  - Split: CSS `grid` or `flex` with a draggable divider (simple `onMouseDown`/`onMouseMove` handler — no library needed, keep it lightweight).
  - Empty state: "Select a file to view" with folder icon.
  - Error state: "Failed to load file tree" with retry button.
  **Props**: `sessionId`, `instanceId`, `onDirtyChange` (to show unsaved indicator on tab trigger).
  **Acceptance**: Layout renders correctly. Resizing works. File selection → editor display works end-to-end.

- [x] 15. **Create save keyboard shortcut**
  **What**: Register `Cmd+S` / `Ctrl+S` keyboard shortcut within the Monaco editor to trigger file save. Also register it in the command registry.
  **Files**: `src/components/session/files-tab-content.tsx` (modify), `src/app/sessions/[id]/page.tsx` (modify)
  **Implementation**:
  - Monaco has built-in keybinding support: `editor.addAction({ id: "save", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => saveFile() })`.
  - Also register in command registry: `{ id: "save-file", label: "Save File", icon: Save, category: "Files", globalShortcut: "mod+s" }`.
  - Prevent browser default save-page behavior via `e.preventDefault()`.
  **Acceptance**: `Cmd+S` saves the active file. No browser save dialog appears.

### Phase 5: Integration

- [x] 16. **Add Files tab to session page**
  **What**: Add the third tab trigger and content to the existing `Tabs` component in the session detail page.
  **Files**: `src/app/sessions/[id]/page.tsx` (modify)
  **Changes**:
  - Import `FilesTabContent` (lazy/dynamic) and `FileCode` icon from lucide-react.
  - Add `TabsTrigger` for `"files"` between "Activity" and "Changes":
    ```tsx
    <TabsTrigger value="files" className="gap-1.5">
      <FileCode className="h-3.5 w-3.5" />
      Files
    </TabsTrigger>
    ```
  - Add `TabsContent` for `"files"`:
    ```tsx
    <TabsContent value="files" className="flex-1 overflow-hidden">
      <FilesTabContent
        sessionId={sessionId}
        instanceId={instanceId}
        fetchDiffs={fetchDiffs}
      />
    </TabsContent>
    ```
  - Update `onValueChange` to also handle `"files"` tab activation (fetch tree).
  - Register `"toggle-files-view"` in command registry (following `"toggle-diff-view"` pattern on line 190).
  **Acceptance**: Three tabs visible. Files tab loads on click. No regressions on Activity/Changes.

- [x] 17. **Wire save → diffs refresh**
  **What**: After a successful file save in the editor, automatically refresh the diffs so the Changes tab is up-to-date. Pass `fetchDiffs` from the page into `FilesTabContent`.
  **Files**: `src/components/session/files-tab-content.tsx` (modify)
  **Implementation**:
  - `FilesTabContent` receives `fetchDiffs` as a prop.
  - After `saveFile()` resolves successfully, call `fetchDiffs()`.
  - Also refresh the file tree (in case a new file was created via the editor).
  **Acceptance**: Save a file → switch to Changes tab → the edit appears as a diff.

- [x] 18. **Handle SSE-driven file refresh**
  **What**: When the agent modifies files (detected via SSE tool events like `write`, `edit`), refresh the file tree and update open file content if the modified file is open.
  **Files**: `src/components/session/files-tab-content.tsx` (modify)
  **Implementation**:
  - The existing `useSessionEvents` hook provides `messages` which include tool parts.
  - When a new tool part with `tool === "write"` or `tool === "edit"` completes (`state.status === "completed"`), extract the file path from `state.input.filePath`.
  - If that file is open in the editor and not dirty, re-fetch its content from disk.
  - If that file is open and dirty, show a conflict indicator: "File changed on disk. Reload?"
  - Refresh the file tree after any write/edit tool completes.
  - **Key design decision**: Don't auto-refresh the tree on every SSE event — debounce to once every 2 seconds during active agent work.
  **Acceptance**: Agent writes a file → file tree updates. Open (clean) file auto-refreshes. Dirty file shows conflict warning.

### Phase 6: Stretch Goals

- [x] 19. **Markdown preview for `.md` files**
  **What**: Add a toggle button in the editor toolbar for `.md` files that switches between the Monaco editor and a rendered Markdown preview using the existing `react-markdown` dependency.
  **Files**: `src/components/session/markdown-preview.tsx` (new), `src/components/session/files-tab-content.tsx` (modify)
  **Implementation**:
  - Detect `.md`/`.mdx` files by extension.
  - Show "Preview" / "Edit" toggle button in the file tab bar.
  - Preview uses `ReactMarkdown` with `remark-gfm` + `rehype-highlight` (already installed).
  - Reuse the `prose-weave` CSS class from `globals.css` for styling.
  **Acceptance**: Toggle works. Markdown renders with syntax highlighting in code blocks.

- [x] 20. **Image and SVG preview**
  **What**: When a binary image file (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`) is selected, show a preview instead of the Monaco editor. SVGs can be rendered inline; raster images use a data URL.
  **Files**: `src/components/session/image-preview.tsx` (new), `src/components/session/files-tab-content.tsx` (modify)
  **Implementation**:
  - File read API already detects binary files.
  - For SVGs: fetch as text, render inline or via `dangerouslySetInnerHTML` (sanitize first).
  - For raster images: create a new API endpoint or modify the existing one to return base64 data.
  - Show image centered with zoom controls (or at least `object-contain`).
  **Acceptance**: Clicking an image file shows a preview. SVGs render at full quality.

### Phase 7: Testing

- [x] 21. **Unit tests for path security utility**
  **What**: Test the path validation utility against traversal attacks.
  **Files**: `src/lib/server/__tests__/path-security.test.ts` (new)
  **Cases**: Normal relative paths, `../` traversal, absolute path injection, null bytes, deeply nested valid paths.
  **Acceptance**: All tests pass. Edge cases covered.

- [x] 22. **Unit tests for file listing and reading API routes**
  **What**: Test the file listing and reading API routes with mocked filesystem.
  **Files**: `src/app/api/sessions/[id]/files/__tests__/route.test.ts` (new)
  **Pattern**: Follow existing pattern in `src/app/api/sessions/[id]/diffs/__tests__/route.test.ts` — mock `getClientForInstance`, mock `fs` operations.
  **Cases**: Valid file listing, excluded directories, file read success, binary detection, path traversal rejection, file not found, write success, write to .git rejection.
  **Acceptance**: All tests pass.

- [x] 23. **Unit tests for file tree transformation**
  **What**: Test the flat-to-tree transformation in `useFileTree`.
  **Files**: `src/hooks/__tests__/use-file-tree.test.ts` (new)
  **Cases**: Empty tree, single file, nested directories, sorting (dirs first), depth limiting.
  **Acceptance**: All tests pass.

- [x] 24. **Unit tests for Monaco language mapping**
  **What**: Test the extension → Monaco language ID mapping function.
  **Files**: `src/lib/__tests__/tool-card-utils.test.ts` (new or extend existing)
  **Cases**: All mapped extensions, unknown extensions return `"plaintext"`, case-insensitive.
  **Acceptance**: All tests pass.

## Architecture Decisions

### Monaco Loading Strategy
**Decision**: Local bundling via `monaco-editor` npm package + `@monaco-editor/loader` configuration.
**Rationale**: The app runs as a Tauri desktop app where CDN access isn't guaranteed. Local bundling adds ~2MB to the build but ensures offline capability. The `monaco-editor` workers are loaded from the same origin.

### State Management
**Decision**: Local state within `FilesTabContent` (via hooks), not a global context.
**Rationale**: File editor state is scoped to a single session. No other component needs to access open files or editor state. Using hooks (`useFileTree`, `useFileContent`) keeps the state localized and avoids adding complexity to the global context tree. If future requirements need cross-component access (e.g., "jump to file from Activity tab"), promote to a context then.

### File Writing & OpenCode Sync
**Decision**: Write files directly to disk via Node.js `fs.writeFile`. No explicit notification to OpenCode.
**Rationale**: OpenCode uses git for tracking changes (`client.session.diff()` compares worktree to base). Writing to disk is sufficient — OpenCode will see changes next time it reads a file. The agent doesn't cache file contents in memory between tool calls. This was confirmed by the fact that diffs are purely git-based (comparing working tree).

### Theme Integration
**Decision**: Define 9 static Monaco themes at initialization time, switch via `monaco.editor.setTheme()` when `useTheme()` changes.
**Rationale**: Monaco themes must be registered before use. Registering all 9 upfront (they're small JSON objects) is simpler than lazy registration. The `useTheme()` hook already provides `theme` (specific theme name) which maps directly to our custom Monaco theme names.

### File Tree: Server-Side vs Client-Side Listing
**Decision**: Server-side `fs.readdir` via a new API route, returning a flat list that's tree-ified on the client.
**Rationale**: The workspace directory is on the server's filesystem. The client can't access it directly. A flat list is more efficient to transfer than a pre-built tree. Client-side transformation to a nested tree is trivial and allows for different sorting/filtering without re-fetching.

## File Inventory

### New Files
| File | Purpose |
|---|---|
| `src/lib/monaco-loader.ts` | Configure Monaco for local loading |
| `src/lib/monaco-themes.ts` | 9 custom Monaco theme definitions |
| `src/lib/server/path-security.ts` | Path traversal validation utility |
| `src/app/api/sessions/[id]/files/route.ts` | File listing API |
| `src/app/api/sessions/[id]/files/[...path]/route.ts` | File read/write API |
| `src/hooks/use-file-tree.ts` | File tree fetching & state |
| `src/hooks/use-file-content.ts` | File content management |
| `src/components/session/file-tree.tsx` | File tree UI component |
| `src/components/session/file-tab-bar.tsx` | Open file tabs |
| `src/components/session/monaco-editor-wrapper.tsx` | Monaco editor wrapper |
| `src/components/session/files-tab-content.tsx` | Main Files tab container |
| `src/components/session/markdown-preview.tsx` | Markdown preview (stretch) |
| `src/components/session/image-preview.tsx` | Image preview (stretch) |
| `src/lib/server/__tests__/path-security.test.ts` | Path security tests |
| `src/app/api/sessions/[id]/files/__tests__/route.test.ts` | API route tests |
| `src/hooks/__tests__/use-file-tree.test.ts` | Tree transformation tests |

### Modified Files
| File | Changes |
|---|---|
| `package.json` | Add `@monaco-editor/react`, `monaco-editor` |
| `src/app/sessions/[id]/page.tsx` | Add Files tab trigger + content, register commands |
| `src/lib/tool-card-utils.ts` | Add `getMonacoLanguageFromPath()` |

## Potential Pitfalls

1. **Monaco bundle size**: `monaco-editor` is ~2MB gzipped. Mitigate by lazy-loading via `next/dynamic` with `ssr: false`. The editor only loads when the Files tab is first activated.

2. **Monaco worker threads**: Monaco uses web workers for syntax highlighting and validation. In Tauri, workers load from the same origin — ensure `next.config.ts` doesn't block worker scripts. May need to configure `MonacoWebpackPlugin` or equivalent for Turbopack.

3. **Large files**: Monaco handles files up to ~10MB well, but very large files (>5MB) can cause lag. The API caps file reads at 5MB. Show a warning for large files: "This file is large and may slow down the editor."

4. **Race conditions on save**: If the user saves while the agent is also modifying the same file, one write may overwrite the other. Mitigate by: (a) showing a warning if the file was modified externally while dirty, (b) disabling save when the agent is actively working on the file.

5. **Path traversal**: The catch-all route `[...path]` could receive crafted paths. The `path-security.ts` utility must be bulletproof. Use `path.resolve()` + `realpath()` + startsWith check.

6. **Monaco theme registration timing**: Themes must be registered before the editor mounts. Use the `beforeMount` callback of `@monaco-editor/react`'s `Editor` component to register themes synchronously.

7. **Tauri CSP**: Tauri's Content Security Policy may block inline styles or workers. Check `tauri.conf.json` CSP settings if Monaco doesn't render.

## Verification
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes (all new + existing tests)
- [ ] Manual test: open Files tab → file tree renders → click file → editor opens with correct highlighting
- [ ] Manual test: edit file → Cmd+S → switch to Changes → diff visible
- [ ] Manual test: switch theme → editor colors update immediately
- [ ] Manual test: agent writes a file → file tree auto-refreshes
- [ ] No console errors or warnings in browser DevTools
- [ ] Tauri build succeeds: `npm run tauri:build`
