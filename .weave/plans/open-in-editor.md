# Open with VSCode / IDE or Explorer

## TL;DR
> **Summary**: Add "Open in VSCode / Terminal / File Explorer" actions across the UI — a new API route shells out to the appropriate tool, a shared hook calls it, and buttons/menu items appear in the live session card, session group dropdown, sidebar context menu, and session detail page sidebar.
> **Estimated Effort**: Medium
> **Closes**: #20

## Context

### Original Request
Users want to quickly jump from a Weave session to their preferred editor (VSCode, Cursor), terminal, or file explorer for the session's workspace directory. This should be accessible from every surface that shows a session or workspace.

### Key Findings

1. **`workspaceDirectory` is already available everywhere** — `SessionListItem.workspaceDirectory` is an absolute filesystem path, exposed by `GET /api/sessions` and available on every card, sidebar item, and detail page. `WorkspaceGroup.workspaceDirectory` aggregates the same value. No new data plumbing needed.

2. **`validateDirectory()` exists and is reusable** — `src/lib/server/process-manager.ts` exports `validateDirectory(directory)` which checks: absolute path, within `ORCHESTRATOR_WORKSPACE_ROOTS`, exists on disk, is a directory. Throws with user-facing messages. Perfect for the new API route's security validation.

3. **Cross-platform spawn patterns exist** — `process-manager.ts` already handles `shell: true` on Windows for `.cmd/.bat` resolution (line 78). The `execFileSync` pattern in `workspace-manager.ts` provides synchronous execution of git commands. The new route needs fire-and-forget async spawning (not sync) since editors/terminals should persist after the API response.

4. **Established UI action patterns in four surfaces:**
   - **LiveSessionCard**: Hover-revealed absolute-positioned `<Button variant="ghost" size="icon">` with `onClick` that calls `e.preventDefault(); e.stopPropagation()` (since the card is wrapped in a `<Link>`). Icons are `h-3.5 w-3.5`. Positioned `absolute top-2 right-2` (terminate) or `right-10` (resume, offset to avoid overlap).
   - **SessionGroup**: `<DropdownMenuItem>` entries in overflow menu with `<Icon className="size-3.5" />` and `text-xs` class, `gap-2` spacing.
   - **SidebarWorkspaceItem**: `<ContextMenuItem>` entries with same icon/text pattern as SessionGroup dropdowns.
   - **Session detail page sidebar**: Metadata rows with icon + label + value. The workspace section (lines 351-358) shows `FolderOpen` icon with the directory path — ideal place for an "Open" button.

5. **`usePersistedState` provides localStorage-backed preferences** — Used throughout for fleet prefs, collapsed groups, pinned workspaces. Key convention: `"weave:<domain>:<key>"`. A preferred editor tool can be stored as `"weave:prefs:open-tool"` with default `"vscode"`.

6. **Existing hook pattern** — Hooks like `useTerminateSession`, `useResumeSession`, `useDeleteSession` follow a consistent pattern: `useState` for loading/error, async function that calls `fetch()`, re-throws on error, returns result. The new `useOpenDirectory` hook should follow this exactly.

7. **API route pattern** — Routes use `NextRequest`/`NextResponse`, import from `@/lib/server/process-manager`, validate input, return JSON. `POST` routes parse body with `request.json()`. See `src/app/api/sessions/[id]/resume/route.ts` for a clean example.

8. **No settings page exists** — The sidebar links to `/settings` but the page doesn't exist. Rather than blocking on a settings page, the tool preference should be selectable inline (e.g., a small dropdown next to the "Open" button or within the session group dropdown).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **API design** | New `POST /api/open-directory` route | Clean separation — opening a directory is not a session operation. A dedicated route is simpler than overloading existing session routes. |
| **Supported tools** | `vscode`, `cursor`, `terminal`, `explorer` | VSCode and Cursor are the dominant AI-assisted editors. Terminal and file explorer cover the remaining common use cases. Extensible via a simple switch-case. |
| **Spawn strategy** | Fire-and-forget with `spawn({ detached: true, stdio: "ignore" })` + `unref()` | Editors/terminals must persist after the API response. Detached + unref ensures the child process outlives the Node handler. |
| **User preference** | `usePersistedState("weave:prefs:open-tool", "vscode")` | Matches existing pattern. No settings page needed — the preference is set inline wherever the open action is used. |
| **Preference UI** | Small split-button or dropdown on the "Open" action | Users can click to open with their default tool, or expand the dropdown to pick a different tool (which also updates their default). |
| **Security** | Reuse `validateDirectory()` from process-manager | Already proven, handles workspace root validation, path traversal prevention, existence checks. |
| **Error handling** | Console error + swallow in UI | Opening an editor is a "fire-and-forget" action. If it fails (tool not installed), log to `console.error` and set the hook's `error` state, but don't block the UI. No toast system exists in the codebase — adding one is out of scope. |

## Objectives

### Core Objective
Allow users to open a session's workspace directory in their preferred editor, terminal, or file explorer from any surface in the UI.

### Deliverables
- [x] API route `POST /api/open-directory` with validation and cross-platform spawning
- [x] `useOpenDirectory` React hook for calling the API
- [x] User preference for default tool via `usePersistedState`
- [x] "Open in..." button on `LiveSessionCard` (hover icon)
- [x] "Open in..." menu item in `SessionGroup` dropdown
- [x] "Open in..." menu item in `SidebarWorkspaceItem` context menu
- [x] "Open in..." button on session detail page sidebar

### Definition of Done
- [x] `npm run build` succeeds with zero errors
- [x] `npm run lint` passes
- [ ] Clicking "Open in VSCode" from any surface opens the directory in VSCode
- [ ] Clicking "Open in Terminal" opens a terminal in the workspace directory
- [ ] Clicking "Open in Explorer/Finder" opens the file browser at the directory
- [ ] User's tool preference persists across page reloads
- [ ] Only directories within allowed workspace roots can be opened (server-side validation)
- [ ] Works on macOS (primary), with correct commands for Linux and Windows

### Guardrails (Must NOT)
- Must NOT allow opening arbitrary directories — only validated workspace directories
- Must NOT block the UI waiting for the editor to launch
- Must NOT break existing card/sidebar/dropdown functionality
- Must NOT introduce a settings page dependency — preferences are inline
- Must NOT use synchronous spawn in the API route (would block the event loop)

## TODOs

- [x] 1. **Create `POST /api/open-directory` API route**
  **What**: New server-side route that accepts a directory path and tool name, validates the directory, and shells out to the appropriate command.

  Request body:
  ```typescript
  interface OpenDirectoryRequest {
    directory: string;
    tool: "vscode" | "cursor" | "terminal" | "explorer";
  }
  ```

  Implementation:
   1. Parse and validate body — `directory` (required string) and `tool` (required string).
   2. **SECURITY GATE (mandatory, before any spawn logic)**: Hard-validate `tool` against the fixed string union `["vscode", "cursor", "terminal", "explorer"]` using a strict allowlist check. If `tool` is not in the allowlist, return `400` immediately. This prevents command injection — especially critical on Windows where `shell: true` is required. **Never** concatenate `directory` into a shell string; always pass it as a discrete array argument to `spawn`/`execFile`. The `directory` value must also never be interpolated into template strings used as shell commands.
   3. Call `validateDirectory(directory)` from `process-manager.ts` to ensure the path is within allowed workspace roots and exists.
   4. Determine the spawn command based on `tool` + `process.platform`:
     - **vscode**: `spawn("code", [directory])` — works cross-platform when VS Code is in PATH.
     - **cursor**: `spawn("cursor", [directory])` — Cursor IDE CLI.
     - **terminal**:
       - macOS: `spawn("open", ["-a", "Terminal", "."], { cwd: directory })` — passing `.` with `cwd` ensures Terminal.app opens in the correct directory (passing the directory as a positional arg is unreliable across macOS versions).
       - Linux: `spawn("x-terminal-emulator", [], { cwd: directory })` with fallback to `xterm`
       - Windows: `spawn("cmd", ["/c", "start", "cmd", "/K", `cd /d ${directory}`], { shell: true })`
     - **explorer**:
       - macOS: `spawn("open", [directory])`
       - Linux: `spawn("xdg-open", [directory])`
       - Windows: `spawn("explorer", [directory])`
  4. Spawn with `{ detached: true, stdio: "ignore" }` and call `.unref()` so the process outlives the API handler. On Windows, also set `shell: true`.
  5. Return `{ ok: true }` on success, or `{ error: "..." }` with appropriate status code on failure.

  **Files**: `src/app/api/open-directory/route.ts`
  **Acceptance**: `curl -X POST http://localhost:3000/api/open-directory -H 'Content-Type: application/json' -d '{"directory":"/some/valid/path","tool":"vscode"}'` opens VS Code in the directory and returns `{ "ok": true }`.

- [x] 2. **Create `useOpenDirectory` React hook**
  **What**: A reusable hook that wraps the API call, following the exact pattern of `useTerminateSession` and `useDeleteSession`.

  Exports:
  ```typescript
  interface UseOpenDirectoryResult {
    openDirectory: (directory: string, tool: OpenTool) => Promise<void>;
    isOpening: boolean;
    error?: string;
  }
  type OpenTool = "vscode" | "cursor" | "terminal" | "explorer";
  ```

  Implementation:
  - `useState` for `isOpening` and `error`.
  - `openDirectory` function calls `POST /api/open-directory` with the body.
  - On non-ok response, parse error from body and throw.
  - Re-throw errors after setting state (matching existing hook pattern).
  - Use `useCallback` to memoize `openDirectory`.

  **Files**: `src/hooks/use-open-directory.ts`
  **Acceptance**: Hook compiles, follows the same pattern as `use-terminate-session.ts`, makes correct API call.

- [x] 3. **Create `OpenDirectoryButton` shared component**
  **What**: A reusable button/dropdown component used across all four UI surfaces. This avoids duplicating the tool-selection dropdown logic in every surface.

  Two visual variants:
  - **Icon button** mode (for `LiveSessionCard` and session detail sidebar) — small icon button that opens with the default tool on click, with an optional tiny dropdown chevron to change tool.
  - **Menu item** mode (for `SessionGroup` dropdown and sidebar context menu) — renders as a `DropdownMenuItem` or `ContextMenuItem` with submenu for tool selection.

  Implementation approach — rather than one monolithic component, create a few utilities:

  a. **`OpenToolSubmenu` component** — A reusable submenu that lists the four tools (VSCode, Cursor, Terminal, Explorer) as selectable items. Each item calls `openDirectory(directory, tool)` and optionally updates the user's default preference. This component can render as either `DropdownMenuSub` content or `ContextMenuSub` content.

  b. **Tool preference hook integration** — Use `usePersistedState("weave:prefs:open-tool", "vscode")` to read/write the default. Export a tiny `usePreferredOpenTool` hook from `use-open-directory.ts` (or a separate file) that returns `[preferredTool, setPreferredTool]`.

  c. **Icon mapping** — Map tool names to lucide icons:
     - `vscode` → `Code2` (or `ExternalLink`)
     - `cursor` → `MousePointer2`
     - `terminal` → `Terminal`
     - `explorer` → `FolderOpen`

  **Files**: `src/components/ui/open-tool-menu.tsx`, `src/hooks/use-open-directory.ts` (add `usePreferredOpenTool`)
  **Acceptance**: Component renders correctly in both dropdown-menu and context-menu contexts. Selecting a tool calls the API and updates the default preference.

- [x] 4. **Add "Open in..." to `LiveSessionCard` hover actions**
  **What**: Add a new hover-revealed icon button to the card, positioned alongside existing terminate/resume/delete buttons.

  Changes:
  1. Import `useOpenDirectory` and `usePreferredOpenTool` (or accept them as props to keep the card stateless — follow the existing pattern where the card receives callbacks, not hooks).
  2. Better approach: Add `onOpen?: (directory: string) => void` prop to `LiveSessionCard`, matching the `onTerminate`/`onResume`/`onDelete` callback pattern. The parent manages the hook.
   3. Add a new `<Button variant="ghost" size="icon">` with an appropriate icon (e.g., `ExternalLink` or `Code2`).

   **Concrete button positioning** — The existing card has these hover buttons:
   - Terminate OR Delete button: always at `right-2` (mutually exclusive, one is always present)
   - Resume button: at `right-10` (only shown when `isInactive && onResume`)

   The "Open" button should be placed to the LEFT of the existing buttons. Since `right-2` = 8px and `right-10` = 40px (each button is ~24px wide + 8px gap):
   - **When resume is visible** (`isInactive && onResume`): Place "Open" at `right-[4.5rem]` (72px) — to the left of resume (`right-10`/40px) and terminate/delete (`right-2`/8px).
   - **When resume is NOT visible**: Place "Open" at `right-10` (40px) — to the left of terminate/delete (`right-2`/8px).

   Use a conditional class: `right-10` normally, `right-[4.5rem]` when resume is visible.

   4. Icon button class: `absolute top-2 {offsetClass} h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10` (blue tint to distinguish from destructive actions).
   5. `onClick`: `e.preventDefault(); e.stopPropagation(); onOpen(item.workspaceDirectory)`.
   6. The "Open" button should be **always visible on hover** regardless of session state (active, idle, stopped, completed) — unlike terminate/resume which are state-dependent.

  Note: The simple icon button opens with the user's default tool. No inline tool selector on the card — that's handled by the SessionGroup dropdown and context menu where there's more space.

  **Files**: `src/components/fleet/live-session-card.tsx`
  **Acceptance**: Hovering over a session card reveals an "Open" icon button. Clicking it calls the parent's `onOpen` callback with the workspace directory.

- [x] 5. **Add "Open in..." submenu to `SessionGroup` dropdown**
  **What**: Add an "Open in..." entry to the workspace group's overflow dropdown menu (the `<MoreHorizontal>` button in the group header).

  Changes:
  1. Import `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent` from `@/components/ui/dropdown-menu`.
  2. Import the appropriate lucide icons (`Code2`, `Terminal`, `FolderOpen`, `MousePointer2`).
   3. Add a submenu after the conditional `DropdownMenuSeparator` (following "New Session") and before the "Terminate All" item:
     ```tsx
     <DropdownMenuSub>
       <DropdownMenuSubTrigger className="gap-2 text-xs">
         <ExternalLink className="size-3.5" />
         Open in...
       </DropdownMenuSubTrigger>
       <DropdownMenuSubContent>
         <DropdownMenuItem onClick={() => onOpen(group.workspaceDirectory, "vscode")} className="gap-2 text-xs">
           <Code2 className="size-3.5" /> VS Code
         </DropdownMenuItem>
         <DropdownMenuItem onClick={() => onOpen(group.workspaceDirectory, "cursor")} className="gap-2 text-xs">
           <MousePointer2 className="size-3.5" /> Cursor
         </DropdownMenuItem>
         <DropdownMenuSeparator />
         <DropdownMenuItem onClick={() => onOpen(group.workspaceDirectory, "terminal")} className="gap-2 text-xs">
           <Terminal className="size-3.5" /> Terminal
         </DropdownMenuItem>
         <DropdownMenuItem onClick={() => onOpen(group.workspaceDirectory, "explorer")} className="gap-2 text-xs">
           <FolderOpen className="size-3.5" /> File Explorer
         </DropdownMenuItem>
       </DropdownMenuSubContent>
     </DropdownMenuSub>
     ```
  4. Add `onOpen?: (directory: string, tool: OpenTool) => void` to `SessionGroupProps`.
  5. Verify that `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent` are exported from the dropdown-menu component. If not, add them (they're standard shadcn/Radix dropdown menu sub-components).

   **Files**: `src/components/fleet/session-group.tsx`, possibly `src/components/ui/dropdown-menu.tsx` (if sub-menu exports are missing — expected to be present already)
  **Acceptance**: The workspace group overflow menu shows "Open in..." with a submenu listing all four tools. Clicking one calls `onOpen` with the directory and tool.

- [x] 6. **Add "Open in..." submenu to `SidebarWorkspaceItem` context menu**
  **What**: Add an "Open in..." entry to the workspace item's right-click context menu, following the same submenu pattern.

  Changes:
  1. Import `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent` from `@/components/ui/context-menu`.
  2. Add a submenu entry between "New Session" and the separator before "Terminate All" (matching the position in SessionGroup for consistency):
     ```tsx
     <ContextMenuSub>
       <ContextMenuSubTrigger className="gap-2 text-xs">
         <ExternalLink className="h-3.5 w-3.5" />
         Open in...
       </ContextMenuSubTrigger>
       <ContextMenuSubContent>
         <ContextMenuItem onClick={() => onOpen(group.workspaceDirectory, "vscode")} className="gap-2 text-xs">
           <Code2 className="h-3.5 w-3.5" /> VS Code
         </ContextMenuItem>
         {/* ... same items as SessionGroup ... */}
       </ContextMenuSubContent>
     </ContextMenuSub>
     ```
  3. Add `onOpen?: (directory: string, tool: OpenTool) => void` to `SidebarWorkspaceItemProps`.
  4. Verify that `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent` are exported from the context-menu component. If not, add them.

  **Files**: `src/components/layout/sidebar-workspace-item.tsx`, possibly `src/components/ui/context-menu.tsx` (if sub-menu exports are missing)
  **Acceptance**: Right-clicking a workspace in the sidebar shows the context menu with an "Open in..." submenu. Selecting a tool calls `onOpen`.

- [x] 7. **Add "Open in..." button to session detail page sidebar**
  **What**: Add a clickable "Open" button next to the workspace directory display in the session detail page's sidebar panel.

  Changes to `src/app/sessions/[id]/page.tsx`:
  1. Import `useOpenDirectory` and `usePreferredOpenTool` hooks.
  2. Add `const { openDirectory } = useOpenDirectory()` and `const [preferredTool] = usePreferredOpenTool()`.
  3. In the workspace metadata section (around line 351-358), add a small button next to the directory path:
     ```tsx
     {metadata.workspaceDirectory && (
       <div className="space-y-1">
         <div className="flex items-center gap-1.5">
           <FolderOpen className="h-3 w-3 text-muted-foreground" />
           <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Workspace</p>
           <Button
             variant="ghost"
             size="icon"
             className="h-5 w-5 ml-auto text-muted-foreground hover:text-blue-500"
             onClick={() => openDirectory(metadata.workspaceDirectory!, preferredTool)}
             title={`Open in ${preferredTool}`}
           >
             <ExternalLink className="h-3 w-3" />
           </Button>
         </div>
         <p className="text-xs font-mono break-all">{metadata.workspaceDirectory}</p>
       </div>
     )}
     ```
  4. Optionally, add a small dropdown (using `DropdownMenu`) around the button for tool selection, or keep it simple with just a single click that uses the preferred tool.

  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: The session detail sidebar shows a small "open" button next to the workspace directory. Clicking it opens the directory in the user's preferred tool.

- [x] 8. **Wire up `onOpen` callback in the fleet page and sidebar**
  **What**: Connect the `useOpenDirectory` hook to all UI surfaces by passing `onOpen` callbacks from the parent pages/layouts.

  Changes:

  a. **Fleet page** (`src/app/page.tsx`):
  1. Import `useOpenDirectory` and `usePreferredOpenTool`.
  2. Add `const { openDirectory } = useOpenDirectory()` and `const [preferredTool, setPreferredTool] = usePreferredOpenTool()`.
  3. Create `handleOpen` callback: `(directory: string, tool?: OpenTool) => openDirectory(directory, tool ?? preferredTool)`.
  4. Pass `onOpen={handleOpen}` to all `SessionGroup` components.
  5. For `LiveSessionCard` components rendered directly (outside `SessionGroup`), pass `onOpen={(dir) => handleOpen(dir)}`.

   b. **Sidebar** (`src/components/layout/sidebar.tsx`) — The sidebar renders `SidebarWorkspaceItem` components. This is the parent that needs to provide the `onOpen` callback.
   1. Import `useOpenDirectory` in `sidebar.tsx` and pass `onOpen` down to each `SidebarWorkspaceItem`.

  c. **SessionGroup passthrough** — `SessionGroup` receives `onOpen` and:
  - Uses it directly for the dropdown submenu (already wired in TODO 5).
  - Passes it to `LiveSessionCard` as `onOpen={(dir) => onOpen?.(dir, preferredTool)}` (card only knows the directory, not the tool — uses the parent's preferred tool).

  **Files**: `src/app/page.tsx`, `src/components/layout/sidebar-*.tsx` (whichever renders the workspace list), `src/components/fleet/session-group.tsx`
  **Acceptance**: Clicking "Open" on any card, dropdown, or context menu correctly calls the API and opens the directory. The preferred tool is used when no explicit tool is selected.

- [x] 9. **Pre-check: Verify dropdown/context menu sub-component exports** (30-second check)
  **What**: Confirm that the shadcn dropdown-menu and context-menu components already export the sub-menu primitives. Based on codebase analysis, these exports already exist — this is a quick verification, not implementation work.

  Check `src/components/ui/dropdown-menu.tsx` for exports of:
  - `DropdownMenuSub`
  - `DropdownMenuSubTrigger`
  - `DropdownMenuSubContent`

  Check `src/components/ui/context-menu.tsx` for exports of:
  - `ContextMenuSub`
  - `ContextMenuSubTrigger`
  - `ContextMenuSubContent`

  If missing, add them following the standard shadcn pattern (they're Radix primitives re-exported with styling).

  **Files**: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/context-menu.tsx`
  **Acceptance**: All sub-menu components are exported and usable. `npm run build` succeeds.

## Implementation Order

```
9. Pre-check: verify sub-menu exports (30 seconds, do first)
   ↓
1. API route (no dependencies)
   ↓
2. useOpenDirectory hook (depends on 1)
   ↓
3. OpenToolSubmenu component + usePreferredOpenTool (depends on 2)
   ↓
4. LiveSessionCard changes (depends on 2)
5. SessionGroup dropdown (depends on 3)
6. SidebarWorkspaceItem context menu (depends on 3)
7. Session detail page sidebar (depends on 2)
   ↓ (4–7 can be done in parallel)
8. Wire up callbacks in page/layout (depends on 4, 5, 6, 7)
```

Tasks 4–7 can be done in parallel once tasks 1–3 and 9 are complete.

## Verification
- [x] `npm run build` succeeds with zero errors
- [x] `npm run lint` passes
- [ ] No regressions — existing terminate/resume/delete buttons still work
- [ ] Manual: Click "Open in VS Code" from LiveSessionCard hover → VS Code opens at workspace directory
- [ ] Manual: Click "Open in Terminal" from SessionGroup dropdown → terminal opens at workspace directory
- [ ] Manual: Right-click workspace in sidebar → "Open in..." → select Explorer → file browser opens
- [ ] Manual: Session detail sidebar → click open button → opens in preferred tool
- [ ] Manual: Change preferred tool → subsequent opens use the new default
- [ ] Manual: Try to open a directory outside workspace roots via curl → returns 400 error
- [ ] Manual: Try to open with a tool not installed (e.g., `cursor`) → API returns error, UI doesn't crash
