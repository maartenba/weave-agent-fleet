# Session Organization

## TL;DR
> **Summary**: Add workspace-based session organization through a sidebar tree under the Fleet nav item and a grouped/filterable Fleet page, with user-renamable workspace display names persisted in SQLite.
> **Estimated Effort**: Large

## Context

### Original Request
Sessions are displayed as a flat grid of cards on the Fleet page (`/`). The sidebar is static navigation only. We want a **hybrid approach**: (1) a sidebar workspace tree that expands under the Fleet nav item showing workspace groups with session counts and status dots, (2) a grouped Fleet page with group-by controls, search/filter bar, and sorting, and (3) user-renamable workspace display names stored in the database.

### Key Findings

1. **Sidebar is purely static** — `src/components/layout/sidebar.tsx` renders a flat `navItems` array as `<Link>` elements. The Fleet item (`/`) is a simple link with no children. The sidebar is `w-56` (224px) and uses `lucide-react` icons. It's a `"use client"` component that reads `usePathname()` for active state.

2. **Root layout is a server component** — `src/app/layout.tsx` has **no `"use client"` directive**, making it a React Server Component. It renders `<Sidebar />` and `<main>` side-by-side in a flex container. The only client provider currently is `<TooltipProvider>`. Because server components cannot use hooks or context providers, any shared session data context must be introduced via a **separate client wrapper component** (`src/app/client-layout.tsx`) that `layout.tsx` renders.

3. **Fleet page uses `useSessions` hook** — `src/app/page.tsx` calls `useSessions(5000)` which polls `GET /api/sessions` every 5s. Returns `SessionListItem[]` with `workspaceId`, `workspaceDirectory`, `sessionStatus`, `instanceStatus`, and a full `session` object. The page renders a flat `grid` of inline-defined `LiveSessionCard` components.

4. **`LiveSessionCard` is defined inline** — Lines 25–115 of `src/app/page.tsx` define the `LiveSessionCard` component inside the page file. It takes a `SessionListItem` and renders status dot, title, badges (status, isolation strategy), directory, time since creation, and a terminate button. Must be extracted to its own file.

5. **`SessionCard` vs `LiveSessionCard` are different components** — `src/components/fleet/session-card.tsx` is used on the History page and operates on the `Session` type from `src/lib/types.ts` (mock-era type with agent, tokens, cost, plan progress). `LiveSessionCard` operates on `SessionListItem` from `src/lib/api-types.ts` (real API data). They are **not interchangeable**.

6. **`SessionListItem` already has grouping data** — Each item has `workspaceId: string` and `workspaceDirectory: string`. Grouping by workspace can be done client-side by collecting unique `workspaceId` values. No additional API call needed.

7. **Database `workspaces` table has no `display_name` column** — Schema in `src/lib/server/database.ts` (lines 46-54): columns are `id`, `directory`, `source_directory`, `isolation_strategy`, `branch`, `created_at`, `cleaned_up_at`. The `DbWorkspace` type in `src/lib/server/db-repository.ts` matches. Must add `display_name TEXT` column via migration.

8. **No workspace API endpoints exist** — Only `sessions`, `fleet/summary`, and `notifications` routes exist under `src/app/api/`. Need to create `src/app/api/workspaces/[id]/route.ts` for rename.

9. **DB repository pattern is well-established** — `src/lib/server/db-repository.ts` exports typed sync CRUD functions (`insertWorkspace`, `getWorkspace`, `listWorkspaces`, `markWorkspaceCleaned`). Need to add `updateWorkspaceDisplayName()`.

10. **No context-menu or collapsible UI primitives** — Available Radix-based UI components: `dropdown-menu`, `sheet`, `scroll-area`, `tooltip`, `tabs`, `input`, `button`, `badge`, `card`, `progress`, `separator`, `avatar`. Must install `context-menu` and `collapsible` via shadcn CLI, or use `dropdown-menu` for right-click and manual collapse state.

11. **No `localStorage` usage exists** — No existing pattern for persisting UI state. Collapsed group state will be the first use of localStorage.

12. **No `select` component exists** — The new-session-dialog uses a raw `<select>` element (line 93-105 of `new-session-dialog.tsx`). For the Group By / Sort dropdowns, can use `DropdownMenu` (already available) or install shadcn `Select`.

13. **URL search params pattern exists** — The session detail page reads `?instanceId=` from URL via `useSearchParams()`. The Fleet page can use `?workspace=` query param for workspace filtering from sidebar clicks.

14. **Hook pattern is consistent** — All hooks (`useSessions`, `useFleetSummary`, `useTerminateSession`, `useCreateSession`) follow the same pattern: `useState` + `useCallback` + `useEffect` with poll intervals. No React Query / SWR.

15. **`basename` derivation for naming** — `workspaceDirectory` contains full paths like `/Users/foo/projects/my-app`. The display name fallback should use `path.basename()` equivalent in the browser (split on `/`, take last segment).

### Architecture Decisions

**Shared session data between sidebar and Fleet page**: Introduce a `SessionsProvider` context via a new `src/app/client-layout.tsx` (`"use client"`) wrapper component. `layout.tsx` (server component) renders `<ClientLayout>`, which wraps both `<Sidebar>` and `<main>` with `<SessionsProvider>`. The provider calls `useSessions(5000)` once, and both sidebar tree and Fleet page consume the same data. This avoids duplicate polling. **Important**: `layout.tsx` remains a server component — it must NOT receive `"use client"`. The `refetch` function exposed by the context triggers session re-fetch only; fleet summary has its own independent poll cycle within the provider.

**Workspace filtering via URL**: Clicking a workspace in the sidebar navigates to `/?workspace={workspaceId}`. The Fleet page reads this param and filters. This makes workspace filter state shareable via URL and back-button friendly.

**Context menu approach**: Install shadcn `context-menu` component (Radix-based, matches existing patterns) rather than building custom right-click handling. Sidebar workspace items get `<ContextMenu>` wrapping.

**Collapsible approach**: Install shadcn `collapsible` component for sidebar tree sections and Fleet page group sections. Provides accessible expand/collapse with animation support.

**Inline rename approach**: Use a controlled `<Input>` component that appears on double-click, replacing the text label. On blur/Enter, fire the PATCH API call. On Escape, cancel. No modal dialog needed.

## Objectives

### Core Objective
Transform the flat session list into an organized workspace-grouped view in both the sidebar (tree navigation) and Fleet page (grouped grid with controls), with user-renamable workspace display names.

### Deliverables
- [ ] Database migration: `display_name` column on `workspaces` table
- [ ] API endpoint: `PATCH /api/workspaces/[id]` for rename
- [ ] `SessionsProvider` context for shared session data
- [ ] `LiveSessionCard` extracted to its own component file
- [ ] `SessionGroup` component for collapsible workspace groups on Fleet page
- [ ] Fleet page toolbar: Group By, Sort, Search controls
- [ ] Sidebar workspace tree under Fleet nav item
- [ ] Context menu on sidebar workspace items (Rename, Pin, New session, Terminate all)
- [ ] Inline rename on double-click (sidebar and Fleet page headers)
- [ ] Persisted UI state (collapsed groups, sort/group preferences) via localStorage

### Definition of Done
- [ ] `npm run build` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test` passes with no regressions
- [ ] Sidebar shows workspace tree with session counts and status dots
- [ ] Clicking a workspace in sidebar filters Fleet page
- [ ] Fleet page groups sessions by workspace with collapsible sections
- [ ] Search input filters sessions by title, directory, or tags
- [ ] Workspace rename via context menu or double-click persists to DB
- [ ] UI state (collapsed groups, sort preference) survives page refresh

### Guardrails (Must NOT)
- Must NOT introduce React Query, SWR, or other data-fetching libraries — use existing hook patterns
- Must NOT add new polling intervals — reuse the single `useSessions(5000)` poll via context
- Must NOT change the `SessionListItem` API response shape — all grouping is client-side
- Must NOT break existing session navigation (`/sessions/[id]?instanceId=...`)
- Must NOT modify the History page or its `SessionCard` component
- Must NOT add server-side filtering — keep the API simple, filter client-side
- Must NOT add `"use client"` to `src/app/layout.tsx` — it must remain a server component
- Must NOT conflate `refetch` with fleet summary refresh — `SessionsContext.refetch` triggers session list re-fetch only; fleet summary has its own independent 10s poll cycle within the provider

## TODOs

### Phase 1: Data Layer

- [ ] 1. Add `display_name` column to `workspaces` table
  **What**: Add `ALTER TABLE workspaces ADD COLUMN display_name TEXT` migration to `src/lib/server/database.ts` in the schema init block. Add it after the existing `CREATE TABLE IF NOT EXISTS workspaces` statement as an `ALTER TABLE` wrapped in a try/catch (column may already exist on existing DBs). Update `DbWorkspace` type in `src/lib/server/db-repository.ts` to include `display_name: string | null`.
  **Files**:
    - `src/lib/server/database.ts` — add ALTER TABLE migration
    - `src/lib/server/db-repository.ts` — update `DbWorkspace` type, add `updateWorkspaceDisplayName()` function
  **Acceptance**: `getWorkspace()` returns objects with `display_name` field. `updateWorkspaceDisplayName(id, "My Project")` updates the row.

- [ ] 2. Create workspace rename API endpoint
  **What**: Create `PATCH /api/workspaces/[id]` route. Accepts `{ displayName: string }` body. Calls `updateWorkspaceDisplayName()`. Returns `{ id, displayName }` on success. 400 if body invalid, 404 if workspace not found.
  **Files**:
    - `src/app/api/workspaces/[id]/route.ts` — new file, PATCH handler
  **Acceptance**: `curl -X PATCH /api/workspaces/<id> -d '{"displayName":"My Project"}'` returns 200 with updated display name.

- [ ] 3. Enrich `GET /api/sessions` response with workspace display name
  **What**: In `src/app/api/sessions/route.ts`, when looking up workspace info (line 167), also read `display_name` from the workspace row. Add `workspaceDisplayName: string | null` to `SessionListItem` in `src/lib/api-types.ts`.
  **Files**:
    - `src/lib/api-types.ts` — add `workspaceDisplayName` to `SessionListItem`
    - `src/app/api/sessions/route.ts` — pass `display_name` through to response
  **Acceptance**: `GET /api/sessions` response items include `workspaceDisplayName` field (null if not set).

- [ ] 4. Create `useRenameWorkspace` hook
  **What**: Client-side hook for the rename mutation. Pattern: `const { renameWorkspace, isLoading, error } = useRenameWorkspace()`. The `renameWorkspace(workspaceId, displayName, onSuccess?)` function calls `PATCH /api/workspaces/[id]` with `{ displayName }` and invokes the optional `onSuccess` callback on 200 response. This keeps the hook decoupled from the sessions context (which doesn't exist yet in Phase 1). Callers in Phase 3/4 will wire `onSuccess` to `sessionsContext.refetch` to refresh the session list after rename.
  **Files**:
    - `src/hooks/use-rename-workspace.ts` — new file
  **Acceptance**: Hook compiles, calls API, returns loading/error state. `onSuccess` callback fires after successful rename.

### Phase 2: Shared State & Component Extraction

- [ ] 5. Create `SessionsProvider` context and client layout wrapper
  **What**: Create a React context that wraps `useSessions(5000)` and `useFleetSummary(10000)` into a single provider. Exposes `{ sessions, isLoading, error, refetch, summary }` where `refetch` triggers a session re-fetch (fleet summary refreshes on its own poll cycle). Because `src/app/layout.tsx` is a **server component** (no `"use client"` directive), the provider cannot be added there directly. Instead: (1) create `src/contexts/sessions-context.tsx` with the provider and `useSessionsContext()` hook, (2) create `src/app/client-layout.tsx` as a `"use client"` component that wraps children with `<SessionsProvider>` and renders `<Sidebar>` + `<main>` inside the flex container, (3) update `layout.tsx` to render `<ClientLayout>{children}</ClientLayout>` instead of the current inline flex layout.
  **Files**:
    - `src/contexts/sessions-context.tsx` — new file, provider + `useSessionsContext()` hook
    - `src/app/client-layout.tsx` — new file, `"use client"` wrapper that composes `<SessionsProvider>`, `<TooltipProvider>`, `<Sidebar>`, and `<main>`
    - `src/app/layout.tsx` — replace inline flex layout with `<ClientLayout>{children}</ClientLayout>`, remove direct `<Sidebar>` and `<TooltipProvider>` imports
  **Acceptance**: `useSessionsContext()` returns the same data as `useSessions()` currently does, accessible from any component in the tree. `layout.tsx` remains a server component (no `"use client"`). `npm run build` passes.

- [ ] 6. Extract `LiveSessionCard` component
  **What**: Move `LiveSessionCard` and the `timeSince` helper from `src/app/page.tsx` into a new component file. Export both so Fleet page can import them.
  **Files**:
    - `src/components/fleet/live-session-card.tsx` — new file with `LiveSessionCard` and `timeSince`
    - `src/app/page.tsx` — import `LiveSessionCard` from new file, remove inline definition
  **Acceptance**: Fleet page renders identically to before. No visual change.

- [ ] 7. Create `useWorkspaces` derived hook
  **What**: A hook that takes the `SessionListItem[]` from context and derives a workspace list. Returns `WorkspaceGroup[]` where each entry has `{ workspaceId, workspaceDirectory, displayName, sessionCount, hasRunningSession, sessions: SessionListItem[] }`. Sorts workspaces: those with running sessions first, then alphabetically by display name. **Important**: Wrap the derivation logic in `useMemo` keyed on the `sessions` array reference to prevent re-computing the grouping on every render cycle (the `useSessions` poll returns a new array reference every 5s, but intermediate re-renders should not re-derive).
  **Files**:
    - `src/hooks/use-workspaces.ts` — new file, pure derivation (no API calls), memoized with `useMemo`
  **Acceptance**: Given 5 sessions across 2 workspaces, returns 2 `WorkspaceGroup` objects with correct counts and sessions. Re-derivation only occurs when session data changes.

- [ ] 8. Install shadcn `context-menu` and `collapsible` components
  **What**: Run `npx shadcn@latest add context-menu collapsible` to install the Radix-based primitives. These will be used for sidebar right-click menus and collapsible tree/group sections.
  **Files**:
    - `src/components/ui/context-menu.tsx` — auto-generated by shadcn
    - `src/components/ui/collapsible.tsx` — auto-generated by shadcn
  **Acceptance**: Both components importable and type-check clean.

### Phase 3: Grouped Fleet Page

- [ ] 9. Create `FleetToolbar` component
  **What**: A toolbar rendered above the session grid with three controls:
    - **Group By** dropdown: `Directory` (default) | `Status` | `Source` | `None` — uses `DropdownMenu` from existing UI
    - **Sort** dropdown: `Recent` (default) | `Name` | `Status` — uses `DropdownMenu`
    - **Search** input: filters sessions by title, directory, or `workspaceDisplayName` — uses existing `Input` component
  State is lifted to Fleet page via props/callbacks. Group/sort preferences persisted to `localStorage` key `weave:fleet:prefs`.
  **Files**:
    - `src/components/fleet/fleet-toolbar.tsx` — new file
  **Acceptance**: Toolbar renders three controls. Changing controls calls parent callbacks. Preferences survive page refresh.

- [ ] 10. Create `SessionGroup` component
  **What**: A collapsible section that wraps a group of session cards. Shows:
    - Header row: expand/collapse chevron, workspace display name (or basename fallback), session count badge, status dot (green if any session running), "..." overflow menu (Rename, New Session, Terminate All)
    - Collapsible body: the session card grid (reuses `LiveSessionCard`)
  Uses the `Collapsible` primitive from shadcn. Double-click on the workspace name enters inline rename mode (shows `<Input>`, saves on Enter/blur, cancels on Escape).
  **Files**:
    - `src/components/fleet/session-group.tsx` — new file
  **Acceptance**: Groups render with correct headers. Clicking chevron collapses/expands. Double-click name enables editing. Overflow menu shows options.

- [ ] 11. Create `InlineEdit` component
  **What**: A reusable component that shows text normally, and on double-click switches to an `<Input>` for editing. Props: `value`, `onSave(newValue)`, `onCancel()`, `className`. Used in both `SessionGroup` headers and sidebar workspace items.
  **Pitfall — blur vs context menu interaction**: When the user right-clicks while the input is focused (e.g., to access browser context menu or our custom ContextMenu), the `blur` event fires before the menu click registers. To avoid premature saves, use a short `requestAnimationFrame` delay in the blur handler before committing — check if the related target is within a context menu portal, and if so, skip the save. Alternatively, save on blur but allow the context menu's "Rename" action to re-enter edit mode cleanly.
  **Files**:
    - `src/components/ui/inline-edit.tsx` — new file
  **Acceptance**: Double-click → input appears with current value selected. Enter → saves. Escape → cancels. Blur → saves (with the interaction trap handled). Empty value → cancels (reverts). Right-clicking during edit does not cause data loss.

- [ ] 12. Refactor Fleet page to use grouped layout
  **What**: Rewrite `src/app/page.tsx` to:
    1. Consume session data from `useSessionsContext()` instead of direct `useSessions()` call
    2. Read `?workspace=` search param — if present, filter to that workspace only
    3. Render `<FleetToolbar>` with group/sort/search state
    4. When grouping is "Directory" (default): render `<SessionGroup>` for each workspace
    5. When grouping is "None": render flat grid (current behavior)
    6. When grouping is "Status" or "Source": group by respective field
    7. Apply search filter across all sessions before grouping
    8. Apply sort within each group
  **Files**:
    - `src/app/page.tsx` — major refactor
  **Acceptance**: Fleet page shows grouped sessions by default. Toolbar controls work. `?workspace=<id>` shows only that workspace's sessions. Search filters live.

- [ ] 13. Persist collapsed group state in localStorage
  **What**: Create a `usePersistedState<T>` utility hook that wraps `useState` with `localStorage` read/write. Key pattern: `weave:fleet:collapsed`. Store a `Set<string>` (serialized as array) of collapsed workspace IDs.
  **Files**:
    - `src/hooks/use-persisted-state.ts` — new file, generic localStorage-backed state hook
    - `src/components/fleet/session-group.tsx` — use persisted state for collapsed
  **Acceptance**: Collapsing a group, refreshing the page → group remains collapsed.

### Phase 4: Sidebar Workspace Tree

- [ ] 14. Refactor sidebar Fleet nav item into expandable tree
  **What**: Replace the Fleet `<Link>` in the sidebar with an expandable/collapsible section:
    - Clicking the "Fleet" label or icon → navigates to `/` (same as before)
    - Clicking the chevron → toggles the tree open/closed
    - Tree expanded state persisted in localStorage (`weave:sidebar:fleet-expanded`, default: true)
  Structure below the Fleet item:
    - "All Sessions" row — total count badge, navigates to `/`
    - One row per workspace — display name, session count, status dot
    - Each workspace row is itself expandable to show individual sessions
  **Files**:
    - `src/components/layout/sidebar.tsx` — major refactor of the Fleet nav item rendering
  **Acceptance**: Fleet nav item has a toggleable chevron. Tree shows workspaces with counts. "All Sessions" navigates to `/`. Workspace clicks navigate to `/?workspace=<id>`.

- [ ] 15. Create `SidebarWorkspaceItem` component
  **What**: A single workspace row in the sidebar tree. Shows:
    - Indent (pl-8 from sidebar edge)
    - Status dot (green pulsing if any session active, gray otherwise)
    - Display name (truncated, tooltip on hover for full path)
    - Session count badge
    - Expand chevron (to show individual sessions)
  When expanded, shows child `SidebarSessionItem` components below.
  Clicking the workspace name → navigates to `/?workspace=<workspaceId>`.
  Active state: highlighted when `?workspace=` matches this workspace.
  **Files**:
    - `src/components/layout/sidebar-workspace-item.tsx` — new file
  **Acceptance**: Workspace items render in sidebar with correct styling. Navigation works. Active state highlights correctly.

- [ ] 16. Create `SidebarSessionItem` component
  **What**: A single session row nested under a workspace in the sidebar tree. Shows:
    - Double indent (pl-12 from sidebar edge)
    - Status dot (color based on `sessionStatus` and `instanceStatus`)
    - Session title (truncated, max ~120px)
  Clicking → navigates to `/sessions/[id]?instanceId=...`.
  **Files**:
    - `src/components/layout/sidebar-session-item.tsx` — new file
  **Acceptance**: Session items render under expanded workspace. Clicking navigates to session detail.

- [ ] 17. Add context menu to sidebar workspace items
  **What**: Wrap `SidebarWorkspaceItem` with `<ContextMenu>` from the installed shadcn component. Right-click shows:
    - **Rename** — triggers inline rename mode on the workspace name
    - **Pin to top** — (UI only in V1, stores pinned IDs in localStorage `weave:sidebar:pinned`)
    - **New Session** — opens the `NewSessionDialog` sheet, pre-filled with the workspace directory
    - **Terminate All** — calls `DELETE /api/sessions/[id]` for each active session in the workspace (with confirmation)
  **Files**:
    - `src/components/layout/sidebar-workspace-item.tsx` — add ContextMenu wrapping
  **Acceptance**: Right-click shows menu. Rename triggers inline edit. Pin moves item to top of list. New Session opens dialog pre-filled. Terminate All confirms then terminates.

- [ ] 18. Wire sidebar to `SessionsContext`
  **What**: Update sidebar to consume `useSessionsContext()` for the workspace tree data. Use `useWorkspaces()` hook to derive workspace groups. The sidebar should not make any independent API calls — it shares the same poll data as the Fleet page.
  **Files**:
    - `src/components/layout/sidebar.tsx` — consume context, render tree
  **Acceptance**: Sidebar tree updates in real-time as sessions are created/terminated. No duplicate network requests visible in browser DevTools.

### Phase 5: Polish & Persistence

- [ ] 19. Add keyboard navigation to sidebar tree
  **What**: When sidebar tree is focused:
    - `↑`/`↓` — move focus between items
    - `→` — expand focused workspace
    - `←` — collapse focused workspace (or move to parent)
    - `Enter` — activate (navigate) focused item
    - `F2` — rename focused workspace
  Use `role="tree"`, `role="treeitem"`, and `aria-expanded` attributes for accessibility. Manage focus with `tabIndex` and `onKeyDown`.
  **Files**:
    - `src/components/layout/sidebar.tsx` — add tree ARIA roles
    - `src/components/layout/sidebar-workspace-item.tsx` — add keyboard handlers
    - `src/components/layout/sidebar-session-item.tsx` — add keyboard handlers
  **Acceptance**: Full keyboard navigation works. Screen reader announces tree structure correctly.

- [ ] 20. Add expand/collapse animations
  **What**: Add smooth height transitions to collapsible sections in both sidebar tree and Fleet page groups. Use Tailwind's `transition-all` + `data-[state=open]`/`data-[state=closed]` from Radix Collapsible. Sidebar tree items should have a subtle slide-in animation.
  **Files**:
    - `src/components/fleet/session-group.tsx` — add transition classes
    - `src/components/layout/sidebar-workspace-item.tsx` — add transition classes
  **Acceptance**: Expanding/collapsing animates smoothly (no layout jumps).

- [ ] 21. Add empty states and edge cases
  **What**: Handle edge cases gracefully:
    - No sessions at all → sidebar tree shows "No workspaces" with muted text
    - Single workspace → still shows as a group (no special case)
    - Workspace with 0 active sessions → shows in tree with gray dot, group header shows count
    - Search with no results → "No sessions match your search" message
    - Error loading sessions → sidebar tree shows error state, Fleet page shows existing error UI
  **Files**:
    - `src/components/layout/sidebar.tsx` — empty state in tree
    - `src/components/fleet/session-group.tsx` — handle 0 sessions
    - `src/app/page.tsx` — search empty state
  **Acceptance**: All edge cases render appropriate UI, no crashes or blank screens.

## File Summary

### New Files (14)
| File | Purpose |
|------|---------|
| `src/app/api/workspaces/[id]/route.ts` | PATCH endpoint for workspace rename |
| `src/app/client-layout.tsx` | `"use client"` wrapper — composes providers, sidebar, and main |
| `src/hooks/use-rename-workspace.ts` | Client hook for rename mutation |
| `src/hooks/use-workspaces.ts` | Derive workspace groups from session data |
| `src/hooks/use-persisted-state.ts` | Generic localStorage-backed state hook |
| `src/contexts/sessions-context.tsx` | Shared sessions data provider |
| `src/components/fleet/live-session-card.tsx` | Extracted `LiveSessionCard` component |
| `src/components/fleet/fleet-toolbar.tsx` | Group By / Sort / Search toolbar |
| `src/components/fleet/session-group.tsx` | Collapsible workspace group with header |
| `src/components/ui/inline-edit.tsx` | Reusable inline text editor |
| `src/components/ui/context-menu.tsx` | shadcn context-menu (auto-generated) |
| `src/components/ui/collapsible.tsx` | shadcn collapsible (auto-generated) |
| `src/components/layout/sidebar-workspace-item.tsx` | Sidebar workspace tree row |
| `src/components/layout/sidebar-session-item.tsx` | Sidebar session tree row |

### Modified Files (7)
| File | Changes |
|------|---------|
| `src/lib/server/database.ts` | Add `display_name` column migration |
| `src/lib/server/db-repository.ts` | Update `DbWorkspace` type, add `updateWorkspaceDisplayName()` |
| `src/lib/api-types.ts` | Add `workspaceDisplayName` to `SessionListItem` |
| `src/app/api/sessions/route.ts` | Pass `workspaceDisplayName` through in GET response |
| `src/app/layout.tsx` | Replace inline flex layout with `<ClientLayout>` wrapper; remove direct Sidebar/TooltipProvider imports |
| `src/app/page.tsx` | Refactor to use context, grouped layout, toolbar, search |
| `src/components/layout/sidebar.tsx` | Refactor Fleet nav item into expandable tree |

## Verification
- [ ] `npm run build` completes successfully
- [ ] `npm run lint` passes
- [ ] `npm run test` passes with no regressions
- [ ] Sidebar Fleet item expands to show workspace tree with correct session counts
- [ ] Clicking workspace in sidebar filters Fleet page via URL param
- [ ] Fleet page groups sessions by workspace by default
- [ ] Group By dropdown switches between Directory/Status/Source/None
- [ ] Search input filters sessions in real-time
- [ ] Right-click workspace in sidebar shows context menu with Rename option
- [ ] Double-click workspace name enables inline edit, saves to DB on Enter
- [ ] Collapsed group state persists across page refreshes
- [ ] No duplicate API requests (sidebar and Fleet page share same data)
- [ ] Browser back button works after clicking workspace filter
