# Issue Browsing Improvement

## TL;DR
> **Summary**: Add rich filtering (author, labels, milestones, assignees, types), sort controls, full-text search, and a GitHub-compatible filter expression field to the issue browser — backed by new API routes for metadata and a search proxy.
> **Estimated Effort**: Large

## Context

### Original Request
Enhance the GitHub issue browser from its current minimal state-only filtering to a full-featured experience with multi-faceted filtering, sort controls, search, and a GitHub-compatible filter expression field that serves as the canonical source of truth for all filter state.

### Related
- GitHub Issue: [#8 — GitHub Integration](../../issues/8) (parent feature; this is the "Issue browser" advanced scope item)
- Branch: `issue-browsing-improvement`
- Pull Request: [pgermishuys/weave-agent-fleet#148](https://github.com/pgermishuys/weave-agent-fleet/pull/148)

### Key Findings

**Current architecture:**
- `IssueList` owns a single `stateFilter` state ("open" | "closed") passed to `useGitHubIssues`
- `useGitHubIssues` accepts `{ state, sort, direction }` but only `state` is exposed in UI; sort is hardcoded to `updated/desc`
- Issues API route (`repos/[owner]/[repo]/issues/route.ts`) forwards `state`, `page`, `per_page`, `sort`, `direction` to GitHub — but does **not** forward `labels`, `milestone`, `assignee`, `creator`, or `type`
- No search API route exists (would need `/search/issues` proxy)
- No metadata API routes exist (labels, milestones, assignees)
- Existing cache pattern in `useGitHubRepos`: module-level state + `useSyncExternalStore` + `listeners` Set + TTL check + generation counter for stale cancellation — this is the pattern to replicate

**Available UI primitives (Shadcn/Radix already installed):**
- `Popover` + `Command` (searchable dropdown — used by `RepoSelector`)
- `Input`, `Select`, `Badge`, `Button`, `DropdownMenu`
- No `MultiSelect` or `Combobox` component — will need to compose from `Popover` + `Command`

**GitHub API specifics:**
- Issues REST API: 5,000 req/hr, supports `state`, `labels` (comma-sep), `milestone` (number/\*/none), `assignee` (username/\*/none), `creator` (username), `type` (name/\*/none), `sort`, `direction`
- Search API: 30 req/min authenticated, returns `{ total_count, items }`, qualifier syntax e.g. `repo:owner/name is:open label:bug author:foo`
- Labels endpoint returns `{ name, color, description }[]`
- Milestones endpoint returns `{ number, title, state }[]`
- Assignees endpoint returns `{ login, avatar_url }[]`

## Objectives

### Core Objective
Replace the minimal state-only filter bar with a comprehensive filter/sort/search system driven by a GitHub-compatible filter expression field.

### Deliverables
- [ ] Filter expression parser and serializer (pure functions, fully tested)
- [ ] Filter expression text field UI (editable, auto-updates)
- [ ] Author, Labels, Milestones, Assignees, Types filter dropdowns
- [ ] Sort controls (Created Newest/Oldest, Updated Newest/Oldest)
- [ ] Full-text search via GitHub Search API with debounce
- [ ] API routes for labels, milestones, assignees metadata
- [ ] API route for search issues proxy
- [ ] Cached hooks for metadata (labels, milestones, assignees)
- [ ] Updated issues API route to forward all filter params
- [ ] Updated `useGitHubIssues` hook to accept full filter state
- [ ] Tests for parser, API routes, hooks, and key components

### Definition of Done
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm run test` passes (all new and existing tests)
- [ ] Filter expression field drives all filter state bidirectionally
- [ ] Changing a dropdown updates the expression; editing expression updates dropdowns
- [ ] Search debounces and switches to Search API transparently
- [ ] Filter dropdowns populated from cached metadata hooks
- [ ] Pagination continues to work with active filters/search

### Guardrails (Must NOT)
- Must NOT cache issue list results — always fetch fresh from API
- Must NOT break existing PR list/tab functionality
- Must NOT add new npm dependencies (Shadcn components are composed from existing Radix primitives)
- Must NOT use GraphQL API (stick to REST + Search REST)
- Must NOT modify `useGitHubRepos` or its cache pattern (only replicate it)

## TODOs

### Phase 1: Filter Expression Engine (Pure Logic Layer)

- [x] 1. **Define filter state types**
  **What**: Add `IssueFilterState` interface and related types that represent the full parsed filter state. This is the central data model all other code depends on.
  **Files**:
  - Modify `src/integrations/github/types.ts` — add:
    ```
    IssueFilterState {
      state: "open" | "closed" | "all";
      labels: string[];
      milestone: string | null;      // milestone title (UI) — mapped to number for API
      assignee: string | null;        // username, "*", or "none"
      author: string | null;          // username
      type: string | null;            // type name, "*", or "none"
      sort: "created" | "updated" | "comments";
      direction: "asc" | "desc";
      search: string;                 // free-text search query
    }
    ```
  - Also add: `GitHubLabel { name, color, description }`, `GitHubMilestone { number, title, state, open_issues, closed_issues }`, `GitHubAssignee { login, avatar_url }` — for metadata endpoints
  - Add `DEFAULT_ISSUE_FILTER: IssueFilterState` constant
  **Acceptance**: Types compile. `DEFAULT_ISSUE_FILTER` has `state:"open"`, `sort:"updated"`, `direction:"desc"`, empty search, null optionals, empty arrays.

- [x] 2. **Implement filter expression parser**
  **What**: Create `parseFilterExpression(expr: string): IssueFilterState` — parses a GitHub-compatible filter expression string into structured state. Supports qualifiers: `is:open`, `is:closed`, `label:name`, `milestone:name`, `assignee:name`, `author:name`, `type:name`, `sort:created-desc`, `sort:created-asc`, `sort:updated-desc`, `sort:updated-asc`, `sort:comments-desc`, `sort:comments-asc`. Quoted values for multi-word labels: `label:"good first issue"`. Remaining unqualified text becomes the `search` field.
  **Files**:
  - Create `src/integrations/github/lib/filter-expression.ts` — exports `parseFilterExpression` and `serializeFilterExpression`
  **Acceptance**: Unit tests cover: basic `is:open`, multiple labels, quoted label values, sort parsing, mixed qualifiers + free text, empty string returns defaults, unknown qualifiers preserved in search, round-trip (parse→serialize→parse yields same state).

- [x] 3. **Implement filter expression serializer**
  **What**: Create `serializeFilterExpression(state: IssueFilterState): string` — inverse of parser. Produces a canonical string from structured state. Omits qualifiers at default values (e.g., don't emit `is:open` since that's the default). Multi-word values quoted. Search text appended at end.
  **Files**:
  - Same file: `src/integrations/github/lib/filter-expression.ts`
  **Acceptance**: Unit tests confirm: defaults produce empty string, non-default state round-trips, labels with spaces are quoted, sort only emitted when non-default.

- [x] 4. **Unit tests for filter expression engine**
  **What**: Comprehensive test suite for parser and serializer.
  **Files**:
  - Create `src/integrations/github/lib/__tests__/filter-expression.test.ts`
  **Acceptance**: Tests pass. Coverage includes: empty input, single qualifier, multiple qualifiers, quoted values, sort variants, free-text search, round-trip consistency, edge cases (duplicate qualifiers, unknown qualifiers, malformed input).

### Phase 2: API Routes for Metadata & Search

- [x] 5. **Add labels API route**
  **What**: `GET /api/integrations/github/repos/[owner]/[repo]/labels` — proxies to `GET /repos/{owner}/{repo}/labels` with pagination (fetch all pages, labels are typically <100). Forward `per_page=100` and page through until exhausted.
  **Files**:
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/labels/route.ts`
  **Acceptance**: Route returns array of `{ name, color, description }`. Returns 401 when no token. Returns GitHub errors transparently.

- [x] 6. **Add milestones API route**
  **What**: `GET /api/integrations/github/repos/[owner]/[repo]/milestones` — proxies to `GET /repos/{owner}/{repo}/milestones?state=open&per_page=100`. Return all open milestones.
  **Files**:
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/milestones/route.ts`
  **Acceptance**: Route returns array of `{ number, title, state }`. Auth check present.

- [x] 7. **Add assignees API route**
  **What**: `GET /api/integrations/github/repos/[owner]/[repo]/assignees` — proxies to `GET /repos/{owner}/{repo}/assignees?per_page=100`. Page through if needed.
  **Files**:
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/assignees/route.ts`
  **Acceptance**: Route returns array of `{ login, avatar_url }`. Auth check present.

- [x] 8. **Add search issues API route**
  **What**: `GET /api/integrations/github/repos/[owner]/[repo]/issues/search?q=...&page=1&per_page=30` — proxies to `GET /search/issues?q=repo:{owner}/{repo}+{q}`. Constructs the full search query server-side by prepending `repo:` and `type:issue` qualifiers. Returns `{ total_count, items }`.
  **Files**:
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/issues/search/route.ts`
  **Acceptance**: Route constructs correct search query. Returns search results with total_count. Auth check present. Handles 422 (invalid query) gracefully.

- [x] 9. **Update existing issues API route to forward all filter params**
  **What**: Extend the issues route to forward `labels`, `milestone`, `assignee`, `creator` (mapped from "author"), and `type` query params to the GitHub API. Only forward non-empty values. **Important**: `labels` arrives as a comma-separated string from the client (the hook must join `IssueFilterState.labels` with `labels.join(',')` before building the query string, since `githubFetch`'s params type is `Record<string, string | number | undefined>` and cannot accept arrays). The route simply forwards this comma-separated string as-is — no array handling needed server-side.
  **Files**:
  - Modify `src/app/api/integrations/github/repos/[owner]/[repo]/issues/route.ts`
  **Acceptance**: All new params forwarded when present. `labels` forwarded as comma-separated string. Existing behavior unchanged when params absent. Existing tests still pass.

- [x] 10. **API route tests**
  **What**: Add tests for the new metadata and search routes, and extend existing issues route tests for new params.
  **Files**:
  - Create `src/app/api/integrations/github/__tests__/labels.test.ts`
  - Create `src/app/api/integrations/github/__tests__/milestones.test.ts`
  - Create `src/app/api/integrations/github/__tests__/assignees.test.ts`
  - Create `src/app/api/integrations/github/__tests__/search-issues.test.ts`
  - Modify `src/app/api/integrations/github/__tests__/issues.test.ts` — add test for forwarding `labels`, `milestone`, `assignee`, `creator`, `type` params
  **Acceptance**: All new tests pass. Existing issues tests unchanged and pass.

### Phase 3: Cached Metadata Hooks

- [x] 11. **Create `useGitHubLabels` hook**
  **What**: In-memory cached hook following `useGitHubRepos` pattern. Module-level state, `useSyncExternalStore`, 5-minute TTL. **Per-repo keying**: Unlike `useGitHubRepos` which is a global singleton, this hook must cache per-repo since different repos have different labels. Use a `Map<string, CacheEntry>` keyed by `"owner/repo"` at module level instead of a single `let state`. The `getSnapshot` function returns the entry for the current `owner/repo` key (or a default empty entry). When the hook's `owner/repo` changes, it reads from the map (cache hit) or triggers a fresh fetch (cache miss). Each entry has its own `lastUpdated` for independent TTL tracking.
  **Files**:
  - Create `src/integrations/github/hooks/use-github-labels.ts`
  **Acceptance**: Returns `{ labels, isLoading, error, refresh }`. Cache persists across component re-mounts. Stale after 5min per repo. Concurrent fetches for the same repo deduplicated. Switching repos returns cached data if fresh, fetches if stale/missing.

- [x] 12. **Create `useGitHubMilestones` hook**
  **What**: Same pattern as labels hook. Uses its own module-level `Map<string, CacheEntry>` keyed by `"owner/repo"`. 5-minute TTL per entry.
  **Files**:
  - Create `src/integrations/github/hooks/use-github-milestones.ts`
  **Acceptance**: Returns `{ milestones, isLoading, error, refresh }`. Same per-repo caching behavior as labels.

- [x] 13. **Create `useGitHubAssignees` hook**
  **What**: Same pattern as labels hook. Uses its own module-level `Map<string, CacheEntry>` keyed by `"owner/repo"`. 5-minute TTL per entry.
  **Files**:
  - Create `src/integrations/github/hooks/use-github-assignees.ts`
  **Acceptance**: Returns `{ assignees, isLoading, error, refresh }`. Same per-repo caching behavior.

- [x] 14. **Extract generic per-repo cache factory (recommended DRY refactor)**
  **What**: Since all three hooks above are structurally identical (only differing in endpoint path, return type, and data key name), extract a `createRepoMetadataCache<T>(config: { endpoint: (owner, repo) => string, dataKey: string })` factory. The factory produces the module-level `Map<string, CacheEntry<T>>` + subscribe/getSnapshot + a `useRepoMetadata(owner, repo)` hook. Each concrete hook (`useGitHubLabels`, etc.) becomes a thin wrapper. This avoids triplicating the `Map`-keyed `useSyncExternalStore` boilerplate.
  **Files**:
  - Create `src/integrations/github/hooks/create-repo-metadata-cache.ts`
  - Refactor `use-github-labels.ts`, `use-github-milestones.ts`, `use-github-assignees.ts` to use the factory
  **Acceptance**: All three hooks behave identically to before refactor. Factory is well-typed. Per-repo `Map` keying works correctly.

- [x] 15. **Tests for metadata hooks**
  **What**: Test at least `useGitHubLabels` thoroughly (same coverage as `use-github-repos.test.ts`): initial load, caching, TTL staleness, concurrent dedup, repo key change clears. Lighter tests for milestones/assignees (same factory).
  **Files**:
  - Create `src/integrations/github/hooks/__tests__/use-github-labels.test.ts`
  - Create `src/integrations/github/hooks/__tests__/use-github-milestones.test.ts`
  - Create `src/integrations/github/hooks/__tests__/use-github-assignees.test.ts`
  **Acceptance**: All tests pass. Follows existing test pattern from `use-github-repos.test.ts`.

### Phase 4: Update `useGitHubIssues` Hook

- [x] 16. **Extend `useGitHubIssues` to accept full filter state**
  **What**: Change `UseGitHubIssuesOptions` to accept `IssueFilterState` (or a subset of it). When `search` is non-empty, switch to the search API route; otherwise use the issues REST route. Add debounce (300ms) for search queries to respect the 30/min rate limit. Reset page to 1 when any filter changes.
  **Files**:
  - Modify `src/integrations/github/hooks/use-github-issues.ts`
  **Acceptance**: Hook fetches from correct endpoint based on search presence. Filter params forwarded as query params. Page resets on filter change. Debounce applied to search. Loading/error/hasMore/loadMore/refetch all work correctly in both modes.

- [x] 17. **Handle search API response shape**
  **What**: The search API returns `{ total_count, incomplete_results, items }` not a flat array. The hook needs to handle both shapes transparently. `hasMore` should use `total_count` in search mode.
  **Files**:
  - Same file: `src/integrations/github/hooks/use-github-issues.ts`
  **Acceptance**: Search mode correctly extracts items from `{ items }` wrapper. `hasMore` computed from `total_count` vs accumulated items. PR filtering (`pull_request` field) still applied.

- [x] 18. **Tests for updated `useGitHubIssues`**
  **What**: Test the dual-mode behavior, filter forwarding, debounce, page reset on filter change.
  **Files**:
  - Create `src/integrations/github/hooks/__tests__/use-github-issues.test.ts`
  **Acceptance**: Tests cover: default fetch, filter params in URL, search mode switch, debounce behavior, page reset, error handling.

### Phase 5: Filter Bar UI Components

- [x] 19. **Create `IssueFilterBar` component**
  **What**: Top-level filter bar component that manages the `IssueFilterState` and renders the filter expression field, filter dropdowns, and sort controls. This is the composition root for all filter UI. Owns the canonical `IssueFilterState` via `useState`. Exposes `onFilterChange` callback to parent.
  **Files**:
  - Create `src/integrations/github/components/issue-filter-bar.tsx`
  **Acceptance**: Renders filter expression field, state toggle, sort dropdown, and filter popover triggers. Changing any control updates the expression field. Editing the expression field updates all controls.

- [x] 20. **Create `FilterExpressionField` component**
  **What**: A text input that displays the serialized filter expression. Editable — on blur or Enter, parse the text and update filter state. Show the expression in a monospace font. Clear button to reset to defaults.
  **Files**:
  - Create `src/integrations/github/components/filter-expression-field.tsx`
  **Acceptance**: Displays serialized expression. Editing and committing (blur/Enter) parses and fires `onChange` with new state. Invalid input handled gracefully (no crash, show subtle error indicator). Clear button resets to defaults.

- [x] 21. **Create `LabelFilter` popover component**
  **What**: Multi-select popover using `Popover` + `Command` (same pattern as `RepoSelector`). Shows all labels from `useGitHubLabels` with colored badges. Checkmarks for selected labels. Searchable. Selection adds/removes from `labels[]` in filter state.
  **Files**:
  - Create `src/integrations/github/components/filters/label-filter.tsx`
  **Acceptance**: Shows labels with colors. Multi-select with checkmarks. Search within popover. Selected count shown as badge on trigger button.

- [x] 22. **Create `AuthorFilter` popover component**
  **What**: Single-select popover. Shows contributors/assignees from `useGitHubAssignees` (reuse as proxy for likely authors). Searchable. Selecting sets `author` in filter state.
  **Files**:
  - Create `src/integrations/github/components/filters/author-filter.tsx`
  **Acceptance**: Shows users with avatars. Single select. Clearable. Search within popover.

- [x] 23. **Create `MilestoneFilter` popover component**
  **What**: Single-select popover for milestones from `useGitHubMilestones`. Shows milestone title. Includes "No milestone" and "Any milestone" options.
  **Files**:
  - Create `src/integrations/github/components/filters/milestone-filter.tsx`
  **Acceptance**: Shows open milestones. Single select with "none"/"*" options. Clearable.

- [x] 24. **Create `AssigneeFilter` popover component**
  **What**: Single-select popover for assignees from `useGitHubAssignees`. Shows user login + avatar. Includes "Unassigned" and "Assigned to anyone" options.
  **Files**:
  - Create `src/integrations/github/components/filters/assignee-filter.tsx`
  **Acceptance**: Shows assignees with avatars. Single select with "none"/"*" options. Clearable.

- [x] 25. **Create `SortControl` component**
  **What**: Dropdown or segmented control for sort. Options: "Newest" (created/desc), "Oldest" (created/asc), "Recently updated" (updated/desc), "Least recently updated" (updated/asc), "Most commented" (comments/desc). Use `DropdownMenu` component.
  **Files**:
  - Create `src/integrations/github/components/filters/sort-control.tsx`
  **Acceptance**: Dropdown shows all sort options. Current selection indicated. Changing updates filter state `sort` and `direction`.

### Phase 6: Integration — Wire Filter Bar into Issue List

- [x] 26. **Refactor `IssueList` to use `IssueFilterBar` and full filter state**
  **What**: Replace the current inline state-only filter buttons with `IssueFilterBar`. Lift `IssueFilterState` into `IssueList` as the single source of truth. Pass it to `useGitHubIssues`. Remove the old `stateFilter` state and inline buttons.
  **Files**:
  - Modify `src/integrations/github/components/issue-list.tsx`
  **Acceptance**: Issue list shows the new filter bar. All filters work end-to-end. Pagination works with filters active. Changing filters resets pagination. Refresh button still works. Empty state messages reflect active filters.

- [x] 27. **Update `GitHubBrowserInner` and `GitHubRepoPage` badge count call sites**
  **What**: Two files call `useGitHubIssues` with the old `{ state: "open" }` options shape for badge counts:
  - `browser.tsx` line 18: `useGitHubIssues(owner, repoName, { state: "open" })`
  - `src/app/github/[owner]/[repo]/page.tsx` line 25: `useGitHubIssues(ownerValue, repoValue, { state: "open" })`

  When TODO 16 changes `UseGitHubIssuesOptions` to accept `IssueFilterState`, both call sites will break with TypeScript compile errors. Update both to pass `DEFAULT_ISSUE_FILTER` (which already has `state: "open"` as default). These badge counts should always show total open issues, unaffected by filters within the IssueList tab content.
  **Files**:
  - Modify `src/integrations/github/browser.tsx` — change `{ state: "open" }` to `DEFAULT_ISSUE_FILTER`
  - Modify `src/app/github/[owner]/[repo]/page.tsx` — change `{ state: "open" }` to `DEFAULT_ISSUE_FILTER`
  **Acceptance**: Both files compile. Tab badges show total open issues count, unaffected by filters within IssueList.

- [ ] 28. **Component tests for `IssueFilterBar`**
  **What**: Test that the filter bar renders all controls, that changing a dropdown updates the expression, and that editing the expression updates dropdowns.
  **Files**:
  - Create `src/integrations/github/components/__tests__/issue-filter-bar.test.tsx`
  **Acceptance**: Tests pass. Cover: initial render, dropdown interaction updates expression, expression edit updates dropdowns, sort change, clear/reset.

### Phase 7: Polish & Edge Cases

- [x] 29. **Handle URL-safe milestone mapping**
  **What**: The GitHub REST API `milestone` param accepts a milestone **number**, but the filter expression uses milestone **title** (user-friendly). When building the API request in `useGitHubIssues`, look up the milestone number from the cached milestones data. If the milestone isn't found in cache, skip the milestone filter and log a warning.
  **Files**:
  - Modify `src/integrations/github/hooks/use-github-issues.ts` — accept optional `milestones` data for number lookup
  - Modify `src/integrations/github/components/issue-list.tsx` — pass milestones to hook or do the mapping before calling hook
  **Acceptance**: Filtering by milestone title works correctly. API receives milestone number. Missing milestone handled gracefully.

- [x] 30. **Debounce search to respect rate limits**
  **What**: Ensure the search query in `useGitHubIssues` is debounced (300ms). Do NOT debounce filter changes that use the REST API (only search). Show a subtle "searching..." indicator during debounce delay.
  **Files**:
  - Modify `src/integrations/github/hooks/use-github-issues.ts` (if not already done in TODO 16)
  - Modify `src/integrations/github/components/issue-filter-bar.tsx` or `filter-expression-field.tsx` — show debounce indicator
  **Acceptance**: Typing in search field doesn't fire API calls on every keystroke. 300ms debounce. Visual feedback during debounce.

- [x] 31. **Keyboard navigation and accessibility**
  **What**: Ensure all filter popovers are keyboard navigable (Radix handles this mostly). Filter expression field supports Enter to apply, Escape to revert. Focus management: after selecting a filter option, popover closes and focus returns to trigger.
  **Files**:
  - Verify all filter popover components
  - Modify `src/integrations/github/components/filter-expression-field.tsx` — Escape key reverts
  **Acceptance**: Tab through all controls. Enter/Escape in expression field. Popover keyboard nav works.

- [x] 32. **Responsive layout for filter bar**
  **What**: On narrow widths, the filter bar should wrap gracefully. Consider collapsing some filter buttons into a "More filters" dropdown on narrow screens, or simply allow flex-wrap. The expression field should be full-width on its own row.
  **Files**:
  - Modify `src/integrations/github/components/issue-filter-bar.tsx` — add responsive Tailwind classes
  **Acceptance**: Filter bar looks good at sidebar-width (320px–400px). No overflow or truncation issues.

## File Summary

### New Files (26)
| File | Phase |
|------|-------|
| `src/integrations/github/lib/filter-expression.ts` | 1 |
| `src/integrations/github/lib/__tests__/filter-expression.test.ts` | 1 |
| `src/app/api/integrations/github/repos/[owner]/[repo]/labels/route.ts` | 2 |
| `src/app/api/integrations/github/repos/[owner]/[repo]/milestones/route.ts` | 2 |
| `src/app/api/integrations/github/repos/[owner]/[repo]/assignees/route.ts` | 2 |
| `src/app/api/integrations/github/repos/[owner]/[repo]/issues/search/route.ts` | 2 |
| `src/app/api/integrations/github/__tests__/labels.test.ts` | 2 |
| `src/app/api/integrations/github/__tests__/milestones.test.ts` | 2 |
| `src/app/api/integrations/github/__tests__/assignees.test.ts` | 2 |
| `src/app/api/integrations/github/__tests__/search-issues.test.ts` | 2 |
| `src/integrations/github/hooks/use-github-labels.ts` | 3 |
| `src/integrations/github/hooks/use-github-milestones.ts` | 3 |
| `src/integrations/github/hooks/use-github-assignees.ts` | 3 |
| `src/integrations/github/hooks/create-repo-metadata-cache.ts` | 3 |
| `src/integrations/github/hooks/__tests__/use-github-labels.test.ts` | 3 |
| `src/integrations/github/hooks/__tests__/use-github-milestones.test.ts` | 3 |
| `src/integrations/github/hooks/__tests__/use-github-assignees.test.ts` | 3 |
| `src/integrations/github/hooks/__tests__/use-github-issues.test.ts` | 4 |
| `src/integrations/github/components/issue-filter-bar.tsx` | 5 |
| `src/integrations/github/components/filter-expression-field.tsx` | 5 |
| `src/integrations/github/components/filters/label-filter.tsx` | 5 |
| `src/integrations/github/components/filters/author-filter.tsx` | 5 |
| `src/integrations/github/components/filters/milestone-filter.tsx` | 5 |
| `src/integrations/github/components/filters/assignee-filter.tsx` | 5 |
| `src/integrations/github/components/filters/sort-control.tsx` | 5 |
| `src/integrations/github/components/__tests__/issue-filter-bar.test.tsx` | 6 |

### Modified Files (6)
| File | Phase | Change |
|------|-------|--------|
| `src/integrations/github/types.ts` | 1 | Add `IssueFilterState`, `GitHubLabel`, `GitHubMilestone`, `GitHubAssignee`, `DEFAULT_ISSUE_FILTER` |
| `src/app/api/integrations/github/repos/[owner]/[repo]/issues/route.ts` | 2 | Forward `labels` (comma-sep string), `milestone`, `assignee`, `creator`, `type` params |
| `src/integrations/github/hooks/use-github-issues.ts` | 4 | Accept `IssueFilterState`, dual-mode (REST vs Search), debounce, join `labels[]` with comma before query string |
| `src/integrations/github/components/issue-list.tsx` | 6 | Replace inline filter buttons with `IssueFilterBar`, use full filter state |
| `src/integrations/github/browser.tsx` | 6 | Update `useGitHubIssues` call to use `DEFAULT_ISSUE_FILTER` |
| `src/app/github/[owner]/[repo]/page.tsx` | 6 | Update `useGitHubIssues` call to use `DEFAULT_ISSUE_FILTER` |

## Verification
- [ ] `npm run build` succeeds with zero type errors
- [ ] `npm run test` — all tests pass (existing + new)
- [ ] Manual verification: select a repo, verify each filter dropdown populates from API
- [ ] Manual verification: type `label:bug author:octocat` in expression field → dropdowns reflect selection
- [ ] Manual verification: select label from dropdown → expression field updates
- [ ] Manual verification: search text triggers search API (check Network tab for `/search/issues`)
- [ ] Manual verification: pagination works with active filters
- [ ] Manual verification: filter bar renders cleanly at sidebar width (~350px)
- [ ] No regressions: PR tab still works, repo selector still works, session creation from issue still works
