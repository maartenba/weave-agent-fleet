# PR #132 Follow-ups

## TL;DR
> **Summary**: Ship a low-risk follow-up that fixes sidebar/view drift, restores the rail toggle affordance, and removes long-lived persisted GitHub repo inventory while ensuring disconnect clears every GitHub-derived client cache.
> **Estimated Effort**: Medium

## Context
### Original Request
Create a detailed implementation plan for addressing the review findings from merged PR #132, covering sidebar state regressions, missing tests, repo-cache safety, and full GitHub local-state cleanup on disconnect.

### Key Findings
- PR #132 introduced these new files in the merged branch: `src/components/layout/sidebar-icon-rail.tsx`, `src/components/layout/sidebar-panel.tsx`, `src/components/layout/github-panel.tsx`, `src/integrations/github/components/repo-cache-warmer.tsx`, `src/integrations/github/hooks/use-bookmarked-repos.ts`, and an expanded `src/integrations/github/hooks/use-github-repos.ts`; those files are now present locally and are the basis for this follow-up.
- In PR #132, `src/components/layout/sidebar-icon-rail.tsx` persists `activeView` via `src/contexts/sidebar-context.tsx`, tracks `lastPathByView`, and only updates that map when the current route already belongs to `activeView`; direct navigation and browser history can therefore leave `activeView` stale relative to the route.
- In PR #132, clicking a rail icon calls `setActiveView(view)` unconditionally; `src/contexts/sidebar-context.tsx` only toggles the panel through `toggleSidebar()`, so clicking the already-active icon no longer closes the panel.
- In PR #132, `src/integrations/github/hooks/use-github-repos.ts` writes the full fetched repo inventory plus timestamp to `localStorage` for 24 hours, and `src/integrations/github/components/repo-cache-warmer.tsx` eagerly warms that cache whenever GitHub is connected.
- PR #132 stores additional GitHub-derived client state in `localStorage`: `weave:github:repos` via `src/integrations/github/hooks/use-bookmarked-repos.ts` and `weave:github:lastRepo` via `src/integrations/github/browser.tsx`; the current disconnect flow only clears the bulk repo cache.
- For a quick follow-up PR, the safest cache choice is **in-memory** for the full repo inventory: it avoids persisting private repo names/metadata to browser storage, requires no TTL migration semantics, and still supports one-session reuse plus manual refresh. `sessionStorage` still writes sensitive data to browser-managed storage, and `localStorage` is the riskiest because it survives browser restarts for hours/days.

## Objectives
### Core Objective
Stabilize the PR #132 sidebar and GitHub caching behavior without redesigning the architecture.

### Deliverables
- [x] Sidebar rail state always follows the current route and supports click-to-close on the active view.
- [x] GitHub repo inventory no longer persists in `localStorage`; disconnect clears all GitHub-derived client state.
- [x] Targeted regression tests cover sidebar transitions plus repo warm/disconnect-clear behavior.

### Definition of Done
- [x] `npm run test -- sidebar-icon-rail use-github-repos repo-cache-warmer` passes, or equivalent targeted Vitest invocations for the added test files.
- [x] `npm run typecheck` passes.
- [x] Manual verification on a PR #132 build confirms: direct `/github/...` navigation activates GitHub rail, clicking the active rail icon closes the panel, reconnect/disconnect leaves no GitHub keys in storage, and disconnected UI does not surface stale GitHub data.

### Guardrails (Must NOT)
- [x] Do not expand scope into a broader sidebar redesign.
- [x] Do not keep full GitHub repo inventory in `localStorage` or move it to another durable store with similar exposure.
- [x] Do not introduce server-side schema changes or new backend APIs unless a testability gap makes a tiny helper unavoidable.
- [x] Do not preserve stale bookmarked or last-selected GitHub state after disconnect.

## TODOs

- [x] 1. Lock the follow-up design and shared GitHub storage contract
  **What**: Add a small client-side storage helper that defines all GitHub storage keys, exposes `clearGitHubClientState()`, and documents the storage policy: full repo inventory in memory only; user-facing selections/bookmarks may remain persisted only until disconnect. Include lightweight one-time cleanup for legacy repo-cache keys created by PR #132.
  **Files**: `src/integrations/github/storage.ts` (new), `src/integrations/github/hooks/use-github-repos.ts`, `src/integrations/github/hooks/use-bookmarked-repos.ts`, `src/integrations/github/browser.tsx`, `src/integrations/github/components/repo-cache-warmer.tsx`
  **Acceptance**: One shared helper owns the key names and clearing logic; legacy `weave:github:repos-cache` and `weave:github:repos-cache-ts` are removed on first use.

- [x] 2. Fix route-to-view synchronization in the sidebar rail
  **What**: Update the PR #132 rail logic so route changes drive `activeView`, not just the reverse. Use `viewForPathname(pathname)` as the source of truth when navigation occurs through direct URL entry, browser back/forward, or deep links. Preserve `lastPathByView` only as a restore target for reopening a panel, not as a substitute for route synchronization.
  **Files**: `src/components/layout/sidebar-icon-rail.tsx`, `src/contexts/sidebar-context.tsx`
  **Acceptance**: Navigating directly to `/welcome`, `/`, `/sessions/...`, `/github`, or `/github/[owner]/[repo]` updates the active rail item without requiring a rail click.

- [x] 3. Restore active-icon click to close the panel
  **What**: Make clicking the already-active panel view behave like a close toggle. Prefer a minimal API addition such as `toggleView(view)` or a small conditional inside `handleSwitch()` that sends the app to the hidden/welcome state when the clicked view is already active, while keeping `toggleSidebar()` behavior intact for keyboard shortcuts.
  **Files**: `src/components/layout/sidebar-icon-rail.tsx`, `src/contexts/sidebar-context.tsx`
  **Acceptance**: Clicking `Fleet` while Fleet is open closes the panel; clicking `GitHub` while GitHub is open closes the panel; clicking again reopens the most recent route for that view.

- [x] 4. Replace durable repo inventory caching with in-memory cache
  **What**: Refactor `useGitHubRepos` so the exhaustive repo list lives in module memory or React state shared within the browser session, not `usePersistedState`. Keep explicit `refresh()` and `clear()` APIs and retain fetch de-duping. Remove the 24h `localStorage` TTL path; if staleness is still needed, track it in memory for the current tab only.
  **Files**: `src/integrations/github/hooks/use-github-repos.ts`, `src/integrations/github/types.ts`, optionally `src/integrations/github/components/repo-selector.tsx`, `src/components/settings/integrations-tab.tsx`
  **Acceptance**: Reload-free navigation still reuses fetched repos during the session, but no full repo inventory or timestamp is written to `localStorage` or `sessionStorage`.

- [x] 5. Tighten repo warmer and disconnect cleanup
  **What**: Update `repo-cache-warmer` so it only warms when GitHub is connected and the in-memory cache is empty/stale for the current session. On disconnect, call the shared clear helper to remove repo inventory, bookmarks, last-selected repo, and any future GitHub client keys in one place.
  **Files**: `src/integrations/github/components/repo-cache-warmer.tsx`, `src/integrations/github/hooks/use-github-repos.ts`, `src/integrations/github/storage.ts`, `src/hooks/use-integrations.ts` or `src/components/settings/integrations-tab.tsx` if disconnect orchestration needs a post-success callback
  **Acceptance**: After a successful disconnect, browser storage contains no `weave:github:*` keys and the in-memory repo cache is empty.

- [x] 6. Gate GitHub UI on active connection
  **What**: Add a minimal guard so GitHub-specific pages/panels render a disconnected empty state instead of stale bookmarks or stale selected repos when the integration is not connected. Prefer UI gating over automatic redirects to keep the change low-risk and predictable.
  **Files**: `src/components/layout/github-panel.tsx`, `src/app/github/page.tsx`, `src/app/github/[owner]/[repo]/page.tsx`, `src/integrations/github/browser.tsx`, `src/app/integrations/page.tsx` if needed for shared empty-state messaging
  **Acceptance**: When GitHub is disconnected, GitHub routes/panels do not render repo-specific content from prior local state and instead show a reconnect prompt or empty state.

- [x] 7. Add targeted sidebar regression tests
  **What**: Add focused component/context tests for PR #132 sidebar behavior: route -> active view sync, active icon click closes panel, reopen restores last route for that view, and non-panel links like Settings do not corrupt panel restore state.
  **Files**: `src/components/layout/__tests__/sidebar-icon-rail.test.tsx` (new), optionally `src/contexts/__tests__/sidebar-context.test.tsx` (new)
  **Acceptance**: Tests fail on the PR #132 behavior and pass with the fix, using `next/navigation` mocks plus interaction assertions.

- [x] 8. Add targeted GitHub cache and disconnect tests
  **What**: Cover the privacy-sensitive flows with hook/component tests: `useGitHubRepos` does not persist inventory to browser storage, `repo-cache-warmer` warms only when connected, disconnect clears bookmarks + last-selected repo + legacy cache keys, and gated GitHub UI hides stale data when disconnected.
  **Files**: `src/integrations/github/hooks/__tests__/use-github-repos.test.ts` (new), `src/integrations/github/components/__tests__/repo-cache-warmer.test.tsx` (new), optionally `src/integrations/github/__tests__/browser.test.tsx` or `src/components/settings/__tests__/integrations-tab.test.tsx` (new)
  **Acceptance**: Tests explicitly assert `localStorage.getItem(...) === null` for the removed cache keys and verify full state clearing after disconnect.

## Verification
- [x] All tests pass.
- [x] No regressions in existing GitHub issue/PR browsing flows while connected.
- [x] `npm run typecheck` passes.
- [x] Added tests cover route-driven sidebar state, active-view toggle-close behavior, repo warmer warm/clear flow, and disconnect cleanup of bookmarks plus last-selected repo.
- [x] Backward-compat cleanup verified: clients with old PR #132 cache keys automatically drop them without breaking first-load behavior.
- [x] Manual browser check confirms no full GitHub repo inventory is present in `localStorage` or `sessionStorage` after warming, refresh, navigation, or disconnect.
