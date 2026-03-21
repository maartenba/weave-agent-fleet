# GitHub Repo Cache — Full Load with localStorage Persistence

## TL;DR
> **Summary**: Replace the paginated "load more" repo fetching with a fully-loaded, localStorage-cached model that auto-refreshes daily and supports manual refresh.
> **Estimated Effort**: Medium

## Context
### Original Request
Change `useGitHubRepos` from on-demand paginated fetching (30 at a time, "Load more" button) to a fully-loaded, cached model. All repos are fetched once via exhaustive pagination, stored in localStorage, and served instantly on subsequent loads. Cache refreshes daily or on manual trigger.

### Key Findings
1. **`useGitHubRepos`** (`src/integrations/github/hooks/use-github-repos.ts`) — 71-line hook using `useState`/`useEffect`/`useCallback`. Fetches page-at-a-time with `apiFetch`. Returns `{ repos, isLoading, error, hasMore, loadMore, refetch }`. Used by 2 consumers.

2. **Consumers**:
   - `AddRepoDialog` (`src/integrations/github/components/add-repo-dialog.tsx`) — uses `repos`, `isLoading`, `error`, `hasMore`, `loadMore`. Has a "Load more…" `CommandItem` at the bottom.
   - `RepoSelector` (`src/integrations/github/components/repo-selector.tsx`) — uses `repos`, `isLoading`, `error`, `hasMore`, `loadMore`, `refetch`. Has "Load more…" item and a refresh button.

3. **API endpoint** (`src/app/api/integrations/github/repos/route.ts`) — proxies to GitHub's `/user/repos` with `page`, `per_page`, `sort`, `direction` params. Returns `GitHubRepo[]`. **Stays unchanged.**

4. **`usePersistedState`** (`src/hooks/use-persisted-state.ts`) — mature hook using `useSyncExternalStore` with per-key subscriber registry and snapshot caching. Already used by `useBookmarkedRepos` and `GitHubBrowser`. Perfect for repo cache storage.

5. **`GitHubRepo` type** (`src/integrations/github/types.ts`) — has fields: `id`, `full_name`, `name`, `owner: { login, avatar_url }`, `description`, `html_url`, `private`, `stargazers_count`, `language`, `updated_at`. The cache should store a lean subset.

6. **Settings UI** (`src/components/settings/integrations-tab.tsx`) — renders each integration as a `Card`. When connected, shows only a "Disconnect" button. The `GitHubSettings` component (`src/integrations/github/settings.tsx`) returns `null` when connected (line 253). The manual refresh button must go into the integrations tab's connected state for GitHub.

7. **Integrations context** (`src/contexts/integrations-context.tsx`) — provides `connectedIntegrations` array. GitHub connection status is derived from `integrations.some(i => i.id === "github" && i.status === "connected")`.

8. **localStorage key namespace**: existing keys use `weave:github:repos` (bookmarked) and `weave:github:lastRepo`. Our cache keys will be `weave:github:repos-cache` and `weave:github:repos-cache-ts`.

## Objectives
### Core Objective
Replace paginated repo loading with an eagerly-loaded, localStorage-cached, daily-refreshing repo list that all consumers can use instantly.

### Deliverables
- [ ] New `CachedGitHubRepo` type for lean cached data
- [ ] Rewritten `useGitHubRepos` hook with full-fetch + cache + staleness logic
- [ ] Updated `AddRepoDialog` — remove "Load more", show all repos from cache
- [ ] Updated `RepoSelector` — remove "Load more", use cached data
- [ ] Manual refresh button in settings integrations tab for connected GitHub
- [ ] Fetch-on-connect trigger when GitHub becomes connected

### Definition of Done
- [ ] `useGitHubRepos` returns all repos from cache instantly (no "Load more")
- [ ] Cache persists across page reloads (verified in localStorage)
- [ ] Cache auto-refreshes when older than 24 hours
- [ ] Manual refresh button in Settings > Integrations triggers re-fetch
- [ ] First connection immediately triggers full fetch
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] No lint errors: `npx next lint`
- [ ] App builds: `npm run build`

### Guardrails (Must NOT)
- Must NOT change the server-side API route (`src/app/api/integrations/github/repos/route.ts`)
- Must NOT store full `GitHubRepo` objects in localStorage (only lean subset)
- Must NOT break the `RepoSelector` in the GitHub browser
- Must NOT use `per_page` values above 100 (GitHub API max)

## Type Definitions

### `CachedGitHubRepo` (lean cache shape)

```typescript
/** Lean shape stored in localStorage — subset of GitHubRepo */
export interface CachedGitHubRepo {
  id: number;
  full_name: string;         // "owner/repo"
  name: string;
  owner_login: string;       // flattened from owner.login
  private: boolean;
  language: string | null;
  stargazers_count: number;
}
```

**Why flatten `owner.login`?** Avoids nested objects in the cache. The `owner.avatar_url` field is not needed in the repo list UI. Consumers that need `owner.login` (like `AddRepoDialog`'s `handleSelect`) read it from `owner_login` instead.

### Cache localStorage shape

- Key `weave:github:repos-cache` → `CachedGitHubRepo[]`
- Key `weave:github:repos-cache-ts` → `number` (Unix timestamp in ms from `Date.now()`)

### New hook return type

```typescript
interface UseGitHubReposResult {
  repos: CachedGitHubRepo[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;   // timestamp or null if never fetched
  refresh: () => void;          // manual trigger
}
```

## Staleness Logic

```typescript
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function isCacheStale(timestamp: number | null): boolean {
  if (timestamp === null) return true;
  return Date.now() - timestamp > CACHE_MAX_AGE_MS;
}
```

Checked on hook mount. If stale (or no cache), triggers a full fetch automatically.

## Exhaustive Pagination Logic

```typescript
async function fetchAllRepos(): Promise<CachedGitHubRepo[]> {
  const PER_PAGE = 100; // GitHub max
  let page = 1;
  const all: CachedGitHubRepo[] = [];

  while (true) {
    const res = await apiFetch(
      `/api/integrations/github/repos?page=${page}&per_page=${PER_PAGE}&sort=updated`
    );
    if (!res.ok) throw new Error("Failed to fetch repos");
    const data: GitHubRepo[] = await res.json();

    all.push(...data.map(toCache));

    if (data.length < PER_PAGE) break; // last page
    page++;
  }

  return all;
}

function toCache(repo: GitHubRepo): CachedGitHubRepo {
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner_login: repo.owner.login,
    private: repo.private,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
  };
}
```

## TODOs

- [ ] 1. **Add `CachedGitHubRepo` type to GitHub types**
  **What**: Add the `CachedGitHubRepo` interface to the GitHub types file. This is the lean shape stored in localStorage.
  **Files**: `src/integrations/github/types.ts`
  **Changes**:
  - Add `CachedGitHubRepo` interface at the end of the file (after `BookmarkedRepo`):
    ```typescript
    /** Lean repo shape for localStorage cache — subset of GitHubRepo */
    export interface CachedGitHubRepo {
      id: number;
      full_name: string;
      name: string;
      owner_login: string;
      private: boolean;
      language: string | null;
      stargazers_count: number;
    }
    ```
  **Acceptance**: Type exists and is importable. `npx tsc --noEmit` passes.

- [ ] 2. **Rewrite `useGitHubRepos` hook with caching**
  **What**: Replace the paginated hook with a fully-loaded, cached implementation. The hook:
    - Uses `usePersistedState` for `weave:github:repos-cache` (repos) and `weave:github:repos-cache-ts` (timestamp)
    - On mount, checks cache staleness. If stale or empty, triggers full fetch.
    - Exposes `refresh()` to manually trigger re-fetch.
    - Exposes `lastUpdated` timestamp.
    - Full fetch paginates through ALL pages (100 per page) until done.
    - Maps `GitHubRepo` → `CachedGitHubRepo` before storing.
    - Returns cached data instantly while fetching in background if cache exists but is stale.
  **Files**: `src/integrations/github/hooks/use-github-repos.ts`
  **Changes**: Complete rewrite. New implementation:
  ```typescript
  "use client";

  import { useState, useEffect, useCallback, useRef } from "react";
  import { usePersistedState } from "@/hooks/use-persisted-state";
  import { apiFetch } from "@/lib/api-client";
  import type { GitHubRepo, CachedGitHubRepo } from "../types";

  const CACHE_KEY = "weave:github:repos-cache";
  const CACHE_TS_KEY = "weave:github:repos-cache-ts";
  const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  const PER_PAGE = 100;

  interface UseGitHubReposResult {
    repos: CachedGitHubRepo[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: number | null;
    refresh: () => void;
  }

  function toCache(repo: GitHubRepo): CachedGitHubRepo {
    return {
      id: repo.id,
      full_name: repo.full_name,
      name: repo.name,
      owner_login: repo.owner.login,
      private: repo.private,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
    };
  }

  export function useGitHubRepos(): UseGitHubReposResult {
    const [cachedRepos, setCachedRepos] = usePersistedState<CachedGitHubRepo[]>(CACHE_KEY, []);
    const [cacheTimestamp, setCacheTimestamp] = usePersistedState<number | null>(CACHE_TS_KEY, null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetchTrigger, setFetchTrigger] = useState(0);
    const isMountedRef = useRef(true);

    // Track mount state for async safety
    useEffect(() => {
      isMountedRef.current = true;
      return () => { isMountedRef.current = false; };
    }, []);

    // Fetch all repos (exhaustive pagination)
    const fetchAll = useCallback(async () => {
      if (isLoading) return; // prevent concurrent fetches
      setIsLoading(true);
      setError(null);

      try {
        let page = 1;
        const all: CachedGitHubRepo[] = [];

        while (true) {
          const res = await apiFetch(
            `/api/integrations/github/repos?page=${page}&per_page=${PER_PAGE}&sort=updated`
          );
          if (!res.ok) throw new Error("Failed to fetch repositories");
          if (!isMountedRef.current) return;

          const data: GitHubRepo[] = await res.json();
          all.push(...data.map(toCache));

          if (data.length < PER_PAGE) break;
          page++;
        }

        if (!isMountedRef.current) return;
        setCachedRepos(all);
        setCacheTimestamp(Date.now());
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load repositories");
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    }, [isLoading, setCachedRepos, setCacheTimestamp]);

    // Auto-fetch on mount if cache is stale or empty
    useEffect(() => {
      const isStale = cacheTimestamp === null || Date.now() - cacheTimestamp > CACHE_MAX_AGE_MS;
      if (isStale) {
        fetchAll();
      }
      // Only run on mount and when fetchTrigger changes (manual refresh)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTrigger]);

    const refresh = useCallback(() => {
      setFetchTrigger((t) => t + 1);
    }, []);

    return {
      repos: cachedRepos,
      isLoading,
      error,
      lastUpdated: cacheTimestamp,
      refresh,
    };
  }
  ```

  **Key behaviors**:
  - Cache is read synchronously via `usePersistedState` → instant render of cached repos
  - Stale check on mount triggers background fetch; existing cached data remains visible during fetch
  - `refresh()` increments trigger counter → re-runs the effect → full re-fetch
  - `PER_PAGE = 100` (GitHub API max) minimizes round-trips
  - `isLoading` guard in `fetchAll` prevents concurrent fetches
  - Cleanup via `isMountedRef` prevents state updates after unmount

  **Acceptance**: Hook compiles. Consumers can call `useGitHubRepos()` and get `{ repos, isLoading, error, lastUpdated, refresh }`. No "Load more" in the API.

- [ ] 3. **Update `AddRepoDialog` to use cached repos**
  **What**: Remove all "Load more" logic. Show all repos from cache with Command search filtering. Update destructuring to match new hook API.
  **Files**: `src/integrations/github/components/add-repo-dialog.tsx`
  **Changes**:
  - Line 32: Change destructuring from `{ repos, isLoading, error, hasMore, loadMore }` to `{ repos, isLoading, error }`
  - Line 38: Update `availableRepos` filter — the `repos` are now `CachedGitHubRepo[]` not `GitHubRepo[]`. The `.full_name`, `.private`, `.language`, `.stargazers_count` fields exist on both types. The `.owner.login` field is now `.owner_login`.
  - Lines 41-48: Update `handleSelect` — change `repo.owner.login` to `repo.owner_login`:
    ```typescript
    function handleSelect(fullName: string) {
      const repo = repos.find((r) => r.full_name === fullName);
      if (!repo) return;
      addRepo({
        fullName: repo.full_name,
        owner: repo.owner_login,
        name: repo.name,
      });
      setOpen(false);
    }
    ```
  - Lines 85-113: The `availableRepos.map(...)` rendering stays largely the same — `.full_name`, `.private`, `.language`, `.stargazers_count` are all present on `CachedGitHubRepo`. The `key={repo.id}` works since `id` is in the cache.
  - Lines 115-127: **Remove** the entire loading spinner and "Load more" block at the bottom of `CommandGroup`. Replace with a simpler loading state:
    ```tsx
    {isLoading && cachedRepos have length 0 → show spinner}
    ```
    Specifically, remove:
    ```tsx
    {isLoading && (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )}
    {hasMore && !isLoading && (
      <CommandItem
        onSelect={loadMore}
        className="justify-center text-xs text-muted-foreground"
      >
        Load more…
      </CommandItem>
    )}
    ```
    And replace with a single loading indicator that only shows when there are no cached repos yet:
    ```tsx
    {isLoading && availableRepos.length === 0 && (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )}
    ```
  - Remove unused imports: `hasMore` and `loadMore` are no longer destructured, so no imports to remove — they were from the hook return. But verify `Loader2` is still used (yes, for the loading state).
  **Acceptance**: Dialog opens, shows all repos instantly from cache. Command search filters them. No "Load more" button. Selecting a repo works (bookmarks it correctly with owner/name).

- [ ] 4. **Update `RepoSelector` to use cached repos**
  **What**: Remove "Load more" logic. Update to use new hook API. Keep the existing refresh button (it now calls `refresh()` from the hook).
  **Files**: `src/integrations/github/components/repo-selector.tsx`
  **Changes**:
  - Line 21: Update the `GitHubRepo` import — `RepoSelector` accepts `selected: GitHubRepo | null` and `onSelect: (repo: GitHubRepo) => void` in its props. This is a problem: the hook now returns `CachedGitHubRepo[]`, but consumers expect `GitHubRepo`. We need to either:
    - (a) Change the `RepoSelector` props to accept `CachedGitHubRepo`, OR
    - (b) Keep `GitHubRepo` in props but adapt within the component

    **Decision**: Change `RepoSelectorProps` to use `CachedGitHubRepo` since the selector only renders fields that exist on the cached type (`full_name`, `private`, `language`, `stargazers_count`). The `GitHubBrowser` component that uses `RepoSelector` persists `selectedRepo` as `GitHubRepo | null` in `usePersistedState` — this also needs updating to `CachedGitHubRepo | null`.

  - Line 22: Change `import type { GitHubRepo } from "../types"` to `import type { CachedGitHubRepo } from "../types"`
  - Lines 23-26: Change props interface:
    ```typescript
    interface RepoSelectorProps {
      selected: CachedGitHubRepo | null;
      onSelect: (repo: CachedGitHubRepo) => void;
    }
    ```
  - Line 30-31: Change destructuring from `{ repos, isLoading, error, hasMore, loadMore, refetch }` to `{ repos, isLoading, error, refresh }`
  - Lines 55-96: Remove the "Load more" `CommandItem` block (lines 85-96). Keep repo list rendering as-is (all fields exist on `CachedGitHubRepo`).
  - Line 108: Change `onClick={refetch}` to `onClick={refresh}`
  **Acceptance**: RepoSelector dropdown shows all repos. Search works. Refresh button triggers full re-fetch. No "Load more" item.

- [ ] 5. **Update `GitHubBrowser` to use `CachedGitHubRepo`**
  **What**: The browser persists `selectedRepo` as `GitHubRepo | null`. Change to `CachedGitHubRepo | null`. Update `GitHubBrowserInner` to accept `CachedGitHubRepo`.
  **Files**: `src/integrations/github/browser.tsx`
  **Changes**:
  - Line 12: Change `import type { GitHubRepo } from "./types"` to `import type { CachedGitHubRepo } from "./types"`
  - Line 14: Change `function GitHubBrowserInner({ repo }: { repo: GitHubRepo })` to `{ repo }: { repo: CachedGitHubRepo }`
  - Line 15: The line `const [owner, repoName] = repo.full_name.split("/")` still works since `full_name` is on `CachedGitHubRepo`.
  - Line 54: Change `usePersistedState<GitHubRepo | null>(...)` to `usePersistedState<CachedGitHubRepo | null>(...)`
  - Line 61: `RepoSelector` props now expect `CachedGitHubRepo`, so this is consistent.

  **Note**: Changing the persisted type means existing localStorage values (which have the old `GitHubRepo` shape with `owner: { login, avatar_url }`) will still deserialize but have extra fields. This is safe — TypeScript won't enforce runtime shapes, and the component only reads `full_name` from it. However, to be safe, consider clearing the `weave:github:lastRepo` key on first load of the new version, or simply letting it work (the extra fields are harmless).

  **Acceptance**: Browser works with `CachedGitHubRepo`. Selecting a repo in `RepoSelector` persists it. Issues/PRs tabs load correctly.

- [x] 6. **Add manual refresh button to integrations tab (connected GitHub state)**
  **What**: When GitHub is connected, show a "Refresh repos" button alongside the "Disconnect" button. This calls `refresh()` from `useGitHubRepos`. Also show `lastUpdated` as a relative time hint.
  **Files**: `src/components/settings/integrations-tab.tsx`
  **Changes**:
  - This file renders each integration generically from manifests. The connected state (lines 72-79) currently only shows a "Disconnect" button. We need to add GitHub-specific UI here.
  - **Approach**: Import and use `useGitHubRepos` conditionally for the GitHub card. Since this is a generic integration loop, the cleanest approach is to extract a `GitHubConnectedActions` component that renders alongside the Disconnect button.
  - Add a new component inline or in a small helper within the file:
    ```tsx
    function GitHubConnectedActions() {
      const { isLoading, lastUpdated, refresh } = useGitHubRepos();
      return (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh Repos
          </Button>
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground">
              Last updated: {new Date(lastUpdated).toLocaleDateString()}
            </span>
          )}
        </div>
      );
    }
    ```
  - In the connected branch (line 72-79), for GitHub specifically, render `GitHubConnectedActions` above or below the Disconnect button:
    ```tsx
    {connected ? (
      <div className="space-y-2">
        {manifest.id === "github" && <GitHubConnectedActions />}
        <Button
          size="sm"
          variant="outline"
          onClick={() => disconnect(manifest.id)}
        >
          Disconnect
        </Button>
      </div>
    ) : /* ... */}
    ```
  - Add imports: `RefreshCw`, `Loader2` from `lucide-react`, `useGitHubRepos` from the hook.

  **Acceptance**: When GitHub is connected, the integration card shows "Refresh Repos" button and last-updated time. Clicking it triggers a full re-fetch. The Disconnect button still works.

- [x] 7. **Trigger full fetch when GitHub first connects**
  **What**: When a user completes the OAuth flow or PAT connection, immediately trigger a full repo fetch. This should happen reactively — when `connectedIntegrations` changes to include GitHub and the cache is empty.
  **Files**: `src/integrations/github/hooks/use-github-repos.ts` (already handled by staleness check on mount)
  **Changes**:
  - The hook already auto-fetches when cache is stale or empty on mount. However, the hook is only mounted when a component using it is rendered. The `AddRepoDialog` mounts only when opened. The `RepoSelector` mounts when the browser tab is shown.
  - **Strategy**: The staleness check on mount will naturally trigger a fetch the first time any consumer mounts after connection. Since the cache timestamp is `null` initially, it's always "stale" for a new connection. This is sufficient for the requirement — the first time the user opens the AddRepoDialog or browser after connecting, repos load immediately.
  - **Enhancement** (recommended): To make repos available _instantly_ after connecting (before the user opens any dialog), add a `useEffect` in `IntegrationsProvider` or a new `GitHubRepoCacheWarmer` component that is always mounted. This component would:
    1. Watch `connectedIntegrations` for GitHub
    2. When GitHub appears and cache is empty, trigger a fetch

    **Implementation**: Create a small component `GitHubRepoCacheWarmer` rendered inside `IntegrationsProvider` (or at app layout level):
    ```tsx
    // In integrations-context.tsx or a new file
    function GitHubRepoCacheWarmer() {
      const { connectedIntegrations } = useIntegrationsContext();
      const { repos, refresh, lastUpdated } = useGitHubRepos();

      const isGitHubConnected = connectedIntegrations.some((i) => i.id === "github");

      useEffect(() => {
        if (isGitHubConnected && lastUpdated === null) {
          refresh();
        }
      }, [isGitHubConnected, lastUpdated, refresh]);

      return null;
    }
    ```

    However, putting this in `integrations-context.tsx` creates a circular dependency (context → hook → apiFetch, context → provider). A cleaner approach:

    **Better approach**: Add the connected-integration awareness directly to `useGitHubRepos`. Pass `isConnected` as an optional parameter or read it from the integrations context inside the hook. But the hook shouldn't depend on the integration context to avoid coupling.

    **Simplest approach**: In the `useGitHubRepos` hook, the staleness check on mount already covers this. Additionally, add the hook to a component that is always rendered when GitHub is connected. The `IntegrationsTab` already renders `GitHubConnectedActions` (from TODO 6) which calls `useGitHubRepos` — but only when the user is on the settings page.

    **Final decision**: Create a `GitHubRepoCacheWarmer` component in `src/integrations/github/components/repo-cache-warmer.tsx` and render it in the app layout (or inside a wrapper that's always mounted). OR, simpler: render it inside the `IntegrationsProvider`:

    **File**: `src/contexts/integrations-context.tsx`
    - After the existing `useEffect` that syncs `setGitHubConfigured` (line 45-50), the provider renders `{children}`. We can add a sibling component.
    - But `IntegrationsProvider` can't import `useGitHubRepos` because that would create a coupling issue. Instead:

    **File**: `src/integrations/github/components/repo-cache-warmer.tsx` (NEW file)
    ```tsx
    "use client";

    import { useEffect } from "react";
    import { useIntegrationsContext } from "@/contexts/integrations-context";
    import { useGitHubRepos } from "../hooks/use-github-repos";

    /**
     * Invisible component that triggers a full repo cache fetch
     * when GitHub is first connected and the cache is empty.
     * Mount this at app-layout level so it's always active.
     */
    export function GitHubRepoCacheWarmer() {
      const { connectedIntegrations } = useIntegrationsContext();
      const { lastUpdated, refresh } = useGitHubRepos();

      const isGitHubConnected = connectedIntegrations.some((i) => i.id === "github");

      useEffect(() => {
        if (isGitHubConnected && lastUpdated === null) {
          refresh();
        }
      }, [isGitHubConnected, lastUpdated, refresh]);

      return null;
    }
    ```

    **File**: Find the app layout that wraps `IntegrationsProvider` and render `<GitHubRepoCacheWarmer />` inside it. Need to check the layout:

  **Additional research needed**: Check `src/app/layout.tsx` or wherever `IntegrationsProvider` wraps the app to find the right place to mount `GitHubRepoCacheWarmer`.

  **Acceptance**: After connecting GitHub (via device flow or PAT), the repo cache is populated automatically without the user needing to open any dialog. Verified by checking localStorage for `weave:github:repos-cache` after connection.

- [x] 8. **Clear cache on GitHub disconnect**
  **What**: When the user disconnects GitHub, clear the repo cache from localStorage so stale data doesn't persist.
  **Files**: `src/integrations/github/hooks/use-github-repos.ts` OR handle at disconnect time.
  **Changes**:
  - **Option A**: In the `useGitHubRepos` hook, watch for disconnection (but the hook doesn't know about connection status).
  - **Option B**: In the `IntegrationsTab` disconnect handler, clear localStorage keys. But that's in a generic component.
  - **Option C** (recommended): In the `GitHubRepoCacheWarmer` component, add cleanup:
    ```tsx
    useEffect(() => {
      if (!isGitHubConnected) {
        // Clear cache when disconnected
        setCachedRepos([]);
        setCacheTimestamp(null);
      }
    }, [isGitHubConnected]);
    ```
    This requires `GitHubRepoCacheWarmer` to also destructure `setCachedRepos` / `setCacheTimestamp` — but those aren't exposed from `useGitHubRepos`.
  - **Better option**: Add a `clearCache()` function to `useGitHubRepos` return value, or simply expose it as part of `refresh` behavior. Actually, the simplest: just have the warmer component call `localStorage.removeItem` directly for the two keys:
    ```tsx
    useEffect(() => {
      if (!isGitHubConnected) {
        try {
          localStorage.removeItem("weave:github:repos-cache");
          localStorage.removeItem("weave:github:repos-cache-ts");
        } catch { /* ignore */ }
      }
    }, [isGitHubConnected]);
    ```
    But this won't trigger `usePersistedState` subscribers. Better to expose a `clear()` from the hook.
  - **Final approach**: Add `clear: () => void` to `UseGitHubReposResult`. Implementation:
    ```typescript
    const clear = useCallback(() => {
      setCachedRepos([]);
      setCacheTimestamp(null);
    }, [setCachedRepos, setCacheTimestamp]);
    ```
    Then in `GitHubRepoCacheWarmer`:
    ```tsx
    const { lastUpdated, refresh, clear } = useGitHubRepos();

    useEffect(() => {
      if (isGitHubConnected && lastUpdated === null) {
        refresh();
      }
      if (!isGitHubConnected) {
        clear();
      }
    }, [isGitHubConnected, lastUpdated, refresh, clear]);
    ```
  **Acceptance**: After disconnecting GitHub, `weave:github:repos-cache` and `weave:github:repos-cache-ts` are cleared from localStorage.

- [x] 9. **Mount `GitHubRepoCacheWarmer` in app layout**
  **What**: Mount `GitHubRepoCacheWarmer` inside the `IntegrationsProvider` subtree in `client-layout.tsx` so the warmer is always active.
  **Files**: `src/app/client-layout.tsx`
  **Changes**:
  - Add import at the top:
    ```tsx
    import { GitHubRepoCacheWarmer } from "@/integrations/github/components/repo-cache-warmer";
    ```
  - Insert `<GitHubRepoCacheWarmer />` as the first child inside `<IntegrationsProvider>`, before `<SidebarProvider>` (line 22). The component renders `null` so it has no visual or layout impact:
    ```tsx
    <IntegrationsProvider>
      <GitHubRepoCacheWarmer />
      <SidebarProvider>
        {/* ... rest of the tree ... */}
      </SidebarProvider>
    </IntegrationsProvider>
    ```
  **Acceptance**: Component is mounted at app level. Verified by checking that connecting GitHub populates the cache without opening any dialog.

## Implementation Order

The tasks have dependencies:

1. **TODO 1** (type) — no dependencies, do first
2. **TODO 2** (hook rewrite) — depends on TODO 1
3. **TODO 3** (AddRepoDialog) — depends on TODO 2
4. **TODO 4** (RepoSelector) — depends on TODO 2
5. **TODO 5** (GitHubBrowser) — depends on TODO 4
6. **TODO 6** (settings refresh button) — depends on TODO 2
7. **TODO 7 + 8** (cache warmer with clear) — depends on TODO 2
8. **TODO 9** (mount warmer) — depends on TODO 7

Parallel groups:
- After TODO 2: TODOs 3, 4, 6, 7 can all be done in parallel
- TODO 5 follows TODO 4
- TODO 9 follows TODO 7+8

## Verification

- [ ] `npx tsc --noEmit` — no TypeScript errors
- [ ] `npx next lint` — no lint errors
- [ ] `npm run build` — app builds successfully
- [ ] Manual test: Connect GitHub → verify localStorage has `weave:github:repos-cache` populated
- [ ] Manual test: Reload page → AddRepoDialog shows all repos instantly
- [ ] Manual test: Wait 24h (or manually set stale timestamp) → repos auto-refresh on next mount
- [ ] Manual test: Settings > Integrations > "Refresh Repos" button triggers re-fetch
- [ ] Manual test: Disconnect GitHub → cache is cleared
- [ ] Manual test: RepoSelector in GitHub browser shows all repos, search works, no "Load more"

## Potential Pitfalls

1. **Large repo count**: Users with thousands of repos will have a large localStorage entry. At ~100 bytes per `CachedGitHubRepo`, 1000 repos ≈ 100KB — well within localStorage limits (typically 5-10MB). Users with 5000+ repos may hit ~500KB which is still fine.

2. **Rate limiting**: Exhaustive pagination on a user with 2000 repos requires 20 API calls (100/page). GitHub's rate limit is 5000/hour for authenticated users. This is safe unless the user spam-refreshes.

3. **`isLoading` guard in `fetchAll`**: The `if (isLoading) return` guard uses the state value which may be stale in the closure. Use a ref (`isFetchingRef`) instead to prevent concurrent fetches more reliably:
   ```typescript
   const isFetchingRef = useRef(false);
   // In fetchAll:
   if (isFetchingRef.current) return;
   isFetchingRef.current = true;
   // ... in finally: isFetchingRef.current = false;
   ```

4. **`usePersistedState` server snapshot**: During SSR/hydration, `usePersistedState` returns `defaultValue` (empty array / null). This means on first client render, there's a flash where repos are empty, then the cached value appears. This is the existing behavior for all `usePersistedState` usages — acceptable.

5. **Stale closure in `useEffect`**: The `fetchAll` callback captures `isLoading` from render. Use a ref for the loading guard (see pitfall 3) and ensure `fetchAll` is called from the effect correctly. The `fetchTrigger` pattern avoids needing `fetchAll` in the deps array.

6. **Migration from old localStorage shape**: The `weave:github:lastRepo` key stores `GitHubRepo` objects (with `owner: { login, avatar_url }`). After TODO 5, the type changes to `CachedGitHubRepo`. Old values will deserialize fine (extra fields ignored at runtime), but the persisted object will retain old fields until overwritten. This is harmless.
