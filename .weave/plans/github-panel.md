# GitHub Panel — Sidebar Repository Browser

## TL;DR
> **Summary**: Build out the GitHub sidebar panel with a bookmarked repository list, an "Add Repository" dialog, context menus, and a new `/github/:owner/:repo` route that renders the existing `GitHubBrowser` issues/PRs UI driven by URL params instead of the repo selector dropdown.
> **Estimated Effort**: Medium

## Context

### Original Request
Replace the placeholder GitHub panel ("coming soon") with a fully functional sidebar panel that mirrors the Fleet panel pattern: a header row with label + "+" button, a persisted list of bookmarked repositories, and navigation to a main content view showing issues/PRs for the selected repo. Also remove the Integrations icon rail button since GitHub connection lives in Settings > Integrations.

### Key Findings

**Existing infrastructure we can reuse:**
- `usePersistedState` hook (`src/hooks/use-persisted-state.ts`) — localStorage-backed state with `useSyncExternalStore`. Keys follow `weave:category:name` pattern.
- `useGitHubRepos` hook (`src/integrations/github/hooks/use-github-repos.ts`) — paginated fetch of user's GitHub repos via `apiFetch`. Returns `repos`, `isLoading`, `error`, `hasMore`, `loadMore`, `refetch`.
- `GitHubBrowserInner` in `browser.tsx` — already accepts a `GitHubRepo` and renders issues/PRs tabs using `useGitHubIssues` + `useGitHubPulls`. Only needs `full_name` to derive owner/repo.
- `IssueList` and `PrList` components accept `owner` and `repo` strings directly — perfect for URL-param-driven rendering.
- `Command`/`CommandInput`/`CommandList` components (Radix) — used in `repo-selector.tsx` for searchable repo list. Same pattern works for the "Add Repo" dialog.
- `ContextMenu` components — already used in `sidebar-workspace-item.tsx` for right-click menus.
- `Dialog` component (`src/components/ui/dialog.tsx`) — available for the add-repo dialog.
- `useIntegrationsContext` — provides `connectedIntegrations` to check if GitHub is connected.

**Sidebar architecture:**
- `sidebar-icon-rail.tsx` has `IconRailButton` (view togglers) and `IconRailLink` (page links). The Integrations `IconRailLink` at lines 245-247 needs removal.
- `sidebar-panel.tsx` switches on `activeView` to render `<FleetPanel />` or `<GitHubPanel />`.
- `sidebar-context.tsx` defines `SidebarView = "welcome" | "fleet" | "github"`. The `viewForPathname()` and `VIEW_DEFAULT_ROUTE` maps need updating for github routes.
- `fleet-panel.tsx` is the reference pattern: header row with `Link` + `Plus` button, then a tree/list below.

**Routing:**
- Next.js 16 App Router. Routes are file-based under `src/app/`.
- No `src/app/github/` directory exists yet — needs creation.
- `viewForPathname()` in `sidebar-icon-rail.tsx` needs to map `/github/*` to `"github"` view.
- `VIEW_DEFAULT_ROUTE.github` currently set to `"/"` (placeholder) — needs to become `/github`.

**Stored repo shape** (minimal, not full `GitHubRepo`):
```ts
interface BookmarkedRepo {
  fullName: string;   // "owner/repo"
  owner: string;      // "owner"
  name: string;       // "repo"
}
```

## Objectives

### Core Objective
Make the GitHub sidebar panel a first-class navigation experience: users add repos they care about, see them listed in the sidebar, click to browse issues/PRs in the main content area.

### Deliverables
- [ ] Remove Integrations icon rail button
- [ ] GitHub panel with header row ("GitHub" label + "+" button)
- [ ] Persisted bookmarked repository list in sidebar
- [ ] Add Repository dialog with search (using `useGitHubRepos`)
- [ ] Right-click context menu on repo items (Remove)
- [ ] Active repo highlighting based on current route
- [ ] `/github` index page (repo overview or prompt to add repos)
- [ ] `/github/[owner]/[repo]` page rendering issues/PRs tabs
- [ ] Updated routing integration (viewForPathname, VIEW_DEFAULT_ROUTE)

### Definition of Done
- [ ] Clicking GitHub icon in rail shows the GitHub panel with bookmarked repos
- [ ] Clicking "+" opens a dialog to search and add repos from GitHub
- [ ] Added repos persist across page reloads (localStorage `weave:github:repos`)
- [ ] Clicking a repo in the sidebar navigates to `/github/:owner/:repo`
- [ ] The main content area shows issues/PRs tabs for that repo
- [ ] Right-clicking a repo shows "Remove" option that removes it from the list
- [ ] Active repo is visually highlighted in the sidebar
- [ ] Panel works when GitHub is not connected (shows repo list from localStorage, API calls fail gracefully)
- [ ] Not-connected state in the add dialog shows a message directing to Settings
- [ ] Integrations icon rail button is gone
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

### Guardrails (Must NOT)
- Must NOT store full `GitHubRepo` objects in localStorage — only `BookmarkedRepo` shape
- Must NOT duplicate `IssueList`/`PrList` components — reuse existing ones
- Must NOT move GitHub connection management out of Settings > Integrations
- Must NOT break existing Fleet panel or session navigation

## TODOs

### Phase 1: Cleanup & Routing Foundation (sequential)

- [x] 1. **Remove Integrations icon rail button**
  **What**: Delete the `connectedIntegrations.length > 0 && <IconRailLink icon={Blocks} ...>` block (lines 245-247) from the icon rail. Remove the `Blocks` import from lucide-react. Remove the `useIntegrationsContext` import and `connectedIntegrations` destructure if no longer used in this file.
  **Files**: `src/components/layout/sidebar-icon-rail.tsx`
  **Acceptance**: Icon rail no longer shows a "Blocks" icon for Integrations. TypeScript compiles.

- [x] 2. **Update GitHub routing in sidebar-icon-rail**
  **What**: (a) Change `VIEW_DEFAULT_ROUTE.github` from `"/"` to `"/github"`. (b) Update `viewForPathname()` to return `"github"` when pathname starts with `/github`. (c) Update `isFleetRoute()` to ensure `/github` is NOT a fleet route (already excluded, but verify).
  **Files**: `src/components/layout/sidebar-icon-rail.tsx`
  **Acceptance**: Clicking the GitHub icon rail button navigates to `/github`. Navigating to `/github/foo/bar` keeps the GitHub view active.

- [x] 3. **Create the `/github` route (index page)**
  **What**: Create `src/app/github/page.tsx` — a simple page that shows a `Header` with title "GitHub" and a centered message: "Select a repository from the sidebar to browse issues and pull requests." If no repos are bookmarked, show a prompt to add one. Uses the same persisted state key to check.
  **Files**: `src/app/github/page.tsx` (new)
  **Acceptance**: Navigating to `/github` renders the page. No type errors.

- [x] 4. **Create the `/github/[owner]/[repo]` route (repo detail page)**
  **What**: Create `src/app/github/[owner]/[repo]/page.tsx`. Extract `owner` and `repo` from `useParams()`. Render the `Header` with title `owner/repo` and the issues/PRs tabs using `IssueList` and `PrList` directly (same pattern as `GitHubBrowserInner` but driven by URL params, not a `GitHubRepo` object). Include a `Tabs` component with "Issues" and "Pull Requests" tabs using `useGitHubIssues` and `useGitHubPulls` for badge counts.
  **Files**: `src/app/github/[owner]/[repo]/page.tsx` (new)
  **Acceptance**: Navigating to `/github/octocat/hello-world` shows issues/PRs for that repo. Uses existing `IssueList` and `PrList`. TypeScript compiles.

### Phase 2: Bookmarked Repos Type & Hook (can parallel with Phase 1 tasks 3-4)

- [x] 5. **Define BookmarkedRepo type**
  **What**: Add a `BookmarkedRepo` interface to `src/integrations/github/types.ts`:
  ```ts
  export interface BookmarkedRepo {
    fullName: string;  // "owner/repo"
    owner: string;
    name: string;
  }
  ```
  **Files**: `src/integrations/github/types.ts`
  **Acceptance**: Type is exported and importable. TypeScript compiles.

- [x] 6. **Create useBookmarkedRepos hook**
  **What**: Create `src/integrations/github/hooks/use-bookmarked-repos.ts`. This wraps `usePersistedState<BookmarkedRepo[]>("weave:github:repos", [])` and exposes:
  - `repos: BookmarkedRepo[]` — the current list
  - `addRepo(repo: BookmarkedRepo): void` — appends if not already present (deduped by `fullName`)
  - `removeRepo(fullName: string): void` — filters out by `fullName`
  - `hasRepo(fullName: string): boolean` — check for membership
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts` (new)
  **Acceptance**: Hook is importable. Adding/removing repos updates localStorage. TypeScript compiles.

### Phase 3: GitHub Panel Implementation (depends on Phase 2)

- [x] 7. **Rewrite GitHubPanel component — header + repo list**
  **What**: Rewrite `src/components/layout/github-panel.tsx` to match the Fleet panel pattern:
  - **Header row**: GitHub icon + "GitHub" label (as a `Link` to `/github`) + "+" button that opens the Add Repo dialog.
  - **Repo list**: Map over `useBookmarkedRepos().repos`, rendering each as a clickable row showing `owner/repo`. Clicking navigates to `/github/:owner/:repo` via `Link`. Active repo highlighted using `usePathname()` comparison (pathname === `/github/${repo.owner}/${repo.name}`).
  - **Empty state**: "No repositories added yet. Click + to add one."
  - Each repo row wrapped in `ContextMenu` with a "Remove" item that calls `removeRepo`.
  **Files**: `src/components/layout/github-panel.tsx`
  **Acceptance**: Panel shows "GitHub" header with "+" button. Bookmarked repos are listed. Clicking navigates to the repo page. Right-click shows "Remove". Active repo is highlighted. Empty state shown when no repos.

- [x] 8. **Create AddRepoDialog component**
  **What**: Create `src/integrations/github/components/add-repo-dialog.tsx`. A `Dialog` component that:
  - Uses `useGitHubRepos()` to fetch the user's repos
  - Uses `useBookmarkedRepos()` to check which are already added
  - Shows a `Command`/`CommandInput`/`CommandList` searchable list (similar to `repo-selector.tsx`)
  - Filters out already-bookmarked repos from the displayed list
  - On select: calls `addRepo({ fullName: repo.full_name, owner: repo.owner.login, name: repo.name })` and closes the dialog
  - If GitHub is not connected (`useIntegrationsContext().connectedIntegrations` has no github entry): shows a message "GitHub is not connected. Go to Settings > Integrations to connect." with a link to `/settings?tab=integrations`.
  - Has `hasMore` / `loadMore` support for pagination
  - Accepts `trigger` prop (ReactNode) so the panel can pass the "+" button as trigger
  **Files**: `src/integrations/github/components/add-repo-dialog.tsx` (new)
  **Acceptance**: Dialog opens, shows searchable repo list. Selecting a repo adds it to bookmarks and closes the dialog. Already-added repos are filtered out. Not-connected state shows helpful message. TypeScript compiles.

### Phase 4: Polish & Integration (depends on Phase 3)

- [x] 9. **Wire AddRepoDialog into GitHubPanel**
  **What**: Import `AddRepoDialog` in `github-panel.tsx` and wrap the "+" button as its trigger. Verify the full flow: click "+", search repos, select one, it appears in the sidebar list, click it to navigate to the detail page.
  **Files**: `src/components/layout/github-panel.tsx`
  **Acceptance**: End-to-end flow works. "+" button opens dialog. Selected repo appears in sidebar. Click navigates to `/github/:owner/:repo`. Issues/PRs load.

- [x] 10. **Update /github index page to use bookmarked repos**
  **What**: Enhance the `/github` index page to show a grid/list of bookmarked repos as clickable cards (repo name, click navigates to detail). If no repos bookmarked, show the "add repos" prompt. If repos exist but none selected, show the repo cards as a landing page.
  **Files**: `src/app/github/page.tsx`
  **Acceptance**: `/github` shows bookmarked repos as cards. Clicking a card navigates to its detail page. Empty state prompts to add repos.

- [x] 11. **Verify type checking and build**
  **What**: Run `npx tsc --noEmit` and `npm run build`. Fix any type errors, unused imports, or build issues.
  **Files**: All modified/created files
  **Acceptance**: Both commands succeed with zero errors.

## File Summary

| File | Action | Phase |
|------|--------|-------|
| `src/components/layout/sidebar-icon-rail.tsx` | Modify (remove Integrations link, update routing) | 1 |
| `src/app/github/page.tsx` | Create | 1 |
| `src/app/github/[owner]/[repo]/page.tsx` | Create | 1 |
| `src/integrations/github/types.ts` | Modify (add `BookmarkedRepo`) | 2 |
| `src/integrations/github/hooks/use-bookmarked-repos.ts` | Create | 2 |
| `src/components/layout/github-panel.tsx` | Rewrite | 3 |
| `src/integrations/github/components/add-repo-dialog.tsx` | Create | 3 |
| `src/app/github/page.tsx` | Enhance | 4 |

## Verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] Integrations icon no longer in rail
- [ ] GitHub panel shows bookmarked repos, "+" opens dialog, right-click has "Remove"
- [ ] `/github` shows landing page with bookmarked repo cards
- [ ] `/github/:owner/:repo` shows issues/PRs tabs
- [ ] Repos persist in localStorage across page reloads
- [ ] Panel works when GitHub is not connected (shows stored repos, dialog shows helpful message)
- [ ] Active repo highlighted in sidebar when on its detail page
- [ ] Fleet panel and all session navigation still works
