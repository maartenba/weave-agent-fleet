# GitHub Integration — Pluggable Integration Framework

## TL;DR
> **Summary**: Build a pluggable integration framework and implement GitHub as the first integration, allowing users to browse repos/issues/PRs and create agent sessions with injected context.
> **Estimated Effort**: Large

## Context
### Original Request
Add a pluggable integration framework starting with GitHub. Users should browse repos, issues, and PRs; create sessions from issues/PRs with context injected as the initial prompt; and connect/disconnect integrations via settings.

### Key Findings
- **Settings page** (`src/app/settings/page.tsx`): Uses `<Tabs>` with `variant="line"` — 7 tabs including "Integrations" (already added between Appearance and About). Imports and renders `<IntegrationsTab />`.
- **Sidebar** (`src/components/layout/sidebar.tsx`): Footer section already has an "Integrations" link using `Blocks` icon, with both collapsed (icon+tooltip) and expanded (icon+label) variants, active state on `/integrations`. Currently always visible — needs conditional rendering.
- **Integration hub page** (`src/app/integrations/page.tsx`): Already exists with `Header`, hardcoded GitHub tab, renders `MockGitHubBrowser`. Needs dynamic tab generation from `IntegrationsContext`.
- **Mock GitHub browser** (`src/integrations/github/mock-browser.tsx`): Hardcoded repo selector button, Issues/PRs sub-tabs, renders `MockIssueRow` and `MockPrRow` with static mock data arrays. Layout and UX patterns are correct — need real data fetching.
- **Mock issue row** (`src/integrations/github/components/mock-issue-row.tsx`): Expandable row with `Collapsible`, shows number/title/labels/comments/author/age, "Create Session" button (no-op). Expanded shows mock body and comments.
- **Mock PR row** (`src/integrations/github/components/mock-pr-row.tsx`): Same pattern with additions/deletions, branch badge, draft badge. "Create Session" button (no-op).
- **Integrations settings tab** (`src/components/settings/integrations-tab.tsx`): Mock GitHub card with `useState` toggle for connected/disconnected. Token password input and Connect/Disconnect buttons — all local state, no real API calls.
- **Middle pane**: Content renders in `<main>` via Next.js pages. The integration hub is already a Next.js page at `/integrations`.
- **Session creation**: `useCreateSession` → `POST /api/sessions` with `CreateSessionRequest { directory, title?, isolationStrategy?, branch?, onComplete? }`. Need to add optional `context: ContextSource` and optional `initialPrompt: string`.
- **Server-side session route** (`src/app/api/sessions/route.ts`): After `session.create()`, needs to fire `session.chat()` with the formatted initial prompt if context is provided.
- **Auth/token storage**: `auth-store.ts` reads OpenCode's auth.json (read-only). GitHub token needs its own storage — use `~/.weave/integrations.json` (read/write) via a new `integration-store.ts`.
- **API proxy pattern**: Existing API routes under `src/app/api/` use Next.js route handlers. GitHub API proxy routes follow the same pattern at `src/app/api/integrations/github/`.
- **Context providers**: `client-layout.tsx` wraps everything in nested providers. `IntegrationsProvider` slots in here.
- **UI components**: Existing `Card`, `Badge`, `Input`, `Button`, `Tabs`, `ScrollArea`, `Tooltip`, `Dialog`, `Collapsible` — all available for the browser UI. No need for new primitives.
- **Test pattern**: Vitest with `src/**/*.test.ts`, `__tests__/` directories colocated with source. Server tests mock dependencies; no browser-level tests.
- **No external deps needed**: GitHub REST API is simple enough for raw `fetch()`. No `@octokit` required.
- **`usePersistedState`**: Ideal for persisting the user's last-selected repo, tab state, etc.
- **Session prompt flow**: After `session.create()`, the route already has access to the SDK client — calling `instance.client.chat.send()` (or similar) with the formatted prompt is straightforward.

### UI Scaffold Status
The following scaffold files exist with hardcoded mock data and local state. They establish layout and UX patterns but require upgrading to use real context, hooks, and data fetching:

| Scaffold File | Status | Action Needed |
|---------------|--------|---------------|
| `src/components/settings/integrations-tab.tsx` | Exists (mock `useState`) | Upgrade to use `IntegrationsContext` and render from registry |
| `src/app/settings/page.tsx` | Modified (tab added) | ✅ Complete — no further changes |
| `src/components/layout/sidebar.tsx` | Modified (link added) | Add conditional visibility via `IntegrationsContext` |
| `src/app/integrations/page.tsx` | Exists (hardcoded GitHub tab) | Upgrade to dynamic tabs from `IntegrationsContext` |
| `src/integrations/github/mock-browser.tsx` | Exists (mock data) | Replace with real `browser.tsx`, then delete |
| `src/integrations/github/components/mock-issue-row.tsx` | Exists (mock data) | Replace with real `issue-row.tsx`, then delete |
| `src/integrations/github/components/mock-pr-row.tsx` | Exists (mock data) | Replace with real `pr-row.tsx`, then delete |

## Objectives
### Core Objective
Create a decoupled integration framework where integrations are self-contained modules, and implement GitHub as the first integration.

### Deliverables
- [ ] Integration framework types, registry, and React context
- [ ] Integration settings tab in the Settings page (upgrade existing scaffold)
- [ ] GitHub integration module (types, API proxy, settings component)
- [ ] GitHub browser UI (upgrade scaffold → real data fetching)
- [ ] Sidebar integration button (upgrade existing scaffold with conditional visibility)
- [ ] Session creation from GitHub issues/PRs with context injection
- [ ] Tests for registry, API proxy routes, context formatting, and integration store
- [ ] Cleanup of temporary mock/scaffold files

### Definition of Done
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] User can add a GitHub PAT in Settings > Integrations
- [ ] User can browse repos, issues, and PRs in the integration hub
- [ ] User can create a session from an issue/PR with context injected
- [ ] Removing the token disconnects the integration and hides the sidebar button
- [ ] All mock/scaffold files are deleted

### Guardrails (Must NOT)
- Integration modules must NOT import from `src/lib/server/` or `src/components/session/`
- Core Fleet code must NOT import from `src/integrations/github/` directly — only via registry
- GitHub PAT must NEVER be sent to the browser — all GitHub API calls proxied server-side
- Must NOT add `@octokit` or any heavy GitHub SDK — use raw `fetch()`
- Must NOT break existing session creation flow when no context is provided

## TODOs

---

### Phase 1: Integration Framework

- [x] 1. **Create integration framework types**
  **What**: Define `ContextSource`, `IntegrationManifest`, and related types that form the boundary between integrations and core Fleet.
  **Files**:
  - Create `src/integrations/types.ts`
  **Details**:
  ```ts
  import type { ComponentType } from "react";

  /** The boundary type between integrations and core Fleet */
  export interface ContextSource {
    type: string;                       // "github-issue", "github-pr"
    url: string;                        // canonical URL
    title: string;                      // display title
    body: string;                       // markdown content → becomes initial prompt context
    metadata: Record<string, unknown>;  // source-specific data (labels, comments, diff stats, etc.)
  }

  /** Each integration registers a manifest */
  export interface IntegrationManifest {
    id: string;                                      // "github"
    name: string;                                    // "GitHub"
    icon: ComponentType<{ size?: number }>;           // Lucide icon or custom
    browserComponent: ComponentType;                  // Main browser UI
    isConfigured: () => boolean;                     // Checks if token/config exists
    settingsComponent?: ComponentType;                // Settings panel for this integration
    resolveContext: (url: string) => Promise<ContextSource | null>;  // URL → context
  }

  /** Connection status for an integration */
  export type IntegrationStatus = "connected" | "disconnected" | "error";

  /** Runtime state per integration */
  export interface IntegrationState {
    manifest: IntegrationManifest;
    status: IntegrationStatus;
  }
  ```
  **Acceptance**: File exists, exports types, `npm run typecheck` passes.

- [x] 2. **Create integration registry**
  **What**: Simple array-based registry for integration manifests. Integrations self-register at import time. Registry provides `getAll()`, `getById()`, `getConnected()` helpers.
  **Files**:
  - Create `src/integrations/registry.ts`
  **Details**:
  ```ts
  const manifests: IntegrationManifest[] = [];

  export function registerIntegration(manifest: IntegrationManifest): void { ... }
  export function getIntegrations(): readonly IntegrationManifest[] { ... }
  export function getIntegration(id: string): IntegrationManifest | undefined { ... }
  export function getConnectedIntegrations(): IntegrationManifest[] {
    return manifests.filter(m => m.isConfigured());
  }
  ```
  **Acceptance**: Registry exports work. Unit test at `src/integrations/__tests__/registry.test.ts` passes.

- [x] 3. **Create integration store (server-side)**
  **What**: Server-side read/write store for integration configuration at `~/.weave/integrations.json`. Stores tokens and settings per integration ID. Similar pattern to `auth-store.ts` but read-write.
  **Files**:
  - Create `src/lib/server/integration-store.ts`
  **Details**:
  - File format: `{ "github": { "token": "ghp_...", "connectedAt": "..." }, ... }`
  - Functions: `getIntegrationConfig(id)`, `setIntegrationConfig(id, config)`, `removeIntegrationConfig(id)`, `getAllIntegrationConfigs()`
  - Reads/writes `~/.weave/integrations.json`
  - Never throws — graceful error handling, returns null/empty on failure
  - Token values are stored in plaintext for MVP (same approach as OpenCode's auth.json)
  **Acceptance**: Unit test at `src/lib/server/__tests__/integration-store.test.ts` validates CRUD operations.

- [x] 4. **Create integration status API route**
  **What**: API endpoint to get connection status and manage integrations from the client. `GET` returns all integrations with status; `POST` connects; `DELETE` disconnects.
  **Files**:
  - Create `src/app/api/integrations/route.ts`
  **Details**:
  - `GET /api/integrations` → returns `{ integrations: [{ id, name, status }] }` by reading from the integration store
  - `POST /api/integrations` → body `{ id, config }` → saves config to store → returns `{ success: true }`
  - `DELETE /api/integrations?id=github` → removes config → returns `{ success: true }`
  **Acceptance**: Route responds correctly. Unit test at `src/app/api/integrations/__tests__/route.test.ts`.

- [x] 5. **Create useIntegrations hook**
  **What**: Client-side hook that polls `GET /api/integrations` for integration status. Provides `integrations`, `connect()`, `disconnect()`, `isLoading`.
  **Files**:
  - Create `src/hooks/use-integrations.ts`
  **Details**:
  - Uses `apiFetch` for all calls
  - Polls on a 30-second interval (integrations don't change often)
  - `connect(id, config)` → `POST /api/integrations`
  - `disconnect(id)` → `DELETE /api/integrations?id=...`
  - Returns `{ integrations: IntegrationStatusInfo[], connect, disconnect, isLoading, refetch }`
  **Acceptance**: Hook compiles, typecheck passes.

- [x] 6. **Create IntegrationsContext**
  **What**: React context that wraps the integration state and exposes connected integrations to the component tree. Needed so the sidebar and integration hub can reactively show/hide.
  **Files**:
  - Create `src/contexts/integrations-context.tsx`
  **Details**:
  - `IntegrationsProvider` wraps `useIntegrations` hook
  - Context value: `{ integrations, connectedIntegrations, connect, disconnect, isLoading, refetch }`
  - `connectedIntegrations` is a derived list filtered by status === "connected"
  **Acceptance**: Context compiles, can be mounted in `client-layout.tsx`.

- [x] 7. **Wire IntegrationsProvider into client layout**
  **What**: Add `IntegrationsProvider` to the provider hierarchy in `client-layout.tsx`.
  **Files**:
  - Modify `src/app/client-layout.tsx`
  **Details**:
  - Import `IntegrationsProvider` from `src/contexts/integrations-context.tsx`
  - Nest it inside `SessionsProvider` (it doesn't depend on sessions, but should be available to all components)
  - No other changes to this file
  **Acceptance**: App still loads. `npm run typecheck` passes.

- [x] 8. **Upgrade integrations-tab.tsx to use real IntegrationsContext**
  **What**: The scaffold at `src/components/settings/integrations-tab.tsx` currently uses local `useState` for connection state and a hardcoded GitHub card. Upgrade it to use `IntegrationsContext` and dynamically render integration cards from the registry, delegating per-integration settings to each manifest's `settingsComponent`.
  **Files**:
  - Modify `src/components/settings/integrations-tab.tsx` (exists — upgrade from scaffold)
  **Details**:
  - Remove local `useState` for `isConnected` and `token`
  - Import `useIntegrationsContext` from `@/contexts/integrations-context`
  - Import `getIntegrations` from `@/integrations/registry`
  - Iterate over all registered integrations, rendering a card for each
  - Each card shows: integration icon (from manifest), name, connection status badge
  - Connected integrations show a "Disconnect" button (calls `disconnect(id)`)
  - Disconnected integrations render the integration's `settingsComponent` (from manifest) if available, otherwise show a generic "No configuration available" message
  - Preserve the existing Card/Badge/Button layout and styling from the scaffold
  - The settings page (`src/app/settings/page.tsx`) already imports and renders `<IntegrationsTab />` — **no changes needed** to settings page
  **Acceptance**: Settings > Integrations tab dynamically lists integrations from registry. Connect/disconnect works via API.

---

### Phase 2: GitHub Integration Module

- [x] 9. **Create GitHub integration types**
  **What**: GitHub-specific type definitions used within the integration module and its API proxy.
  **Files**:
  - Create `src/integrations/github/types.ts`
  **Details**:
  ```ts
  export interface GitHubRepo {
    id: number;
    full_name: string;       // "owner/repo"
    name: string;
    owner: { login: string; avatar_url: string };
    description: string | null;
    html_url: string;
    private: boolean;
    stargazers_count: number;
    language: string | null;
    updated_at: string;
  }

  export interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: "open" | "closed";
    labels: Array<{ name: string; color: string }>;
    user: { login: string; avatar_url: string };
    comments: number;
    created_at: string;
    updated_at: string;
    pull_request?: { url: string };  // present if this "issue" is actually a PR
  }

  export interface GitHubPullRequest {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: "open" | "closed" | "merged";
    labels: Array<{ name: string; color: string }>;
    user: { login: string; avatar_url: string };
    comments: number;
    additions: number;
    deletions: number;
    changed_files: number;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    draft: boolean;
  }

  export interface GitHubComment {
    id: number;
    body: string;
    user: { login: string; avatar_url: string };
    created_at: string;
  }
  ```
  **Acceptance**: File exists, types compile.

- [x] 10. **Create GitHub API proxy routes**
  **What**: Server-side API routes that proxy GitHub REST API calls, keeping the PAT server-side. The client calls these routes; they forward to `api.github.com` with the token.
  **Files**:
  - Create `src/app/api/integrations/github/repos/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/issues/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/comments/route.ts`
  - Create `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/comments/route.ts`
  **Details**:
  - Each route reads the GitHub token from `integration-store.getIntegrationConfig("github")`
  - Returns 401 if no token configured
  - Forwards to `https://api.github.com/...` with `Authorization: Bearer <token>` header
  - Accepts standard GitHub query params: `page`, `per_page`, `state`, `sort`, `direction`
  - Returns GitHub API response as-is (our types match GitHub's response shapes)
  - Repos route: `GET /api/integrations/github/repos?page=1&per_page=30&sort=updated` → `GET https://api.github.com/user/repos?...`
  - Issues route: `GET /api/integrations/github/repos/:owner/:repo/issues?state=open` → `GET https://api.github.com/repos/:owner/:repo/issues?...`
  - Pulls route: Similar pattern
  - Single issue/PR routes: Return full detail + comments
  - Comments routes: Return comments for an issue/PR
  - Shared helper: Create `src/app/api/integrations/github/_lib/github-fetch.ts` with a `githubFetch(path, token, params?)` helper that handles auth headers, error mapping, and rate limit headers
  **Acceptance**: Routes return correct data when token is configured. Unit tests for the repos and issues routes at `src/app/api/integrations/github/__tests__/`.

- [x] 11. **Create GitHub settings component**
  **What**: The `settingsComponent` rendered in the Integrations settings tab when GitHub is selected. Allows entering a Personal Access Token and testing the connection. Note: a mock version exists at `src/components/settings/integrations-tab.tsx` with the token input UX — the real settings component extracts this into `src/integrations/github/settings.tsx` as a standalone component referenced by the manifest.
  **Files**:
  - Create `src/integrations/github/settings.tsx`
  **Details**:
  - Form with masked token `<Input type="password">` field (same pattern as the scaffold's token input)
  - "Test Connection" button that calls `GET /api/integrations/github/repos?per_page=1` to verify the token works
  - Shows success (green check + username) or error (red alert + message)
  - "Connect" button saves the token via `connect("github", { token })` from `IntegrationsContext`
  - When connected, shows: Connected badge, authenticated username, "Disconnect" button
  - Uses existing `Button`, `Input`, `Badge`, `Card` components
  - This component is referenced by the GitHub manifest's `settingsComponent` field
  - The integrations-tab.tsx (Task 8) will render this component for the GitHub integration card
  **Acceptance**: User can enter token, test, connect, and disconnect.

- [x] 12. **Create GitHub manifest and register**
  **What**: The `IntegrationManifest` for GitHub and the registration call. Also implements `resolveContext()` which converts a GitHub URL to a `ContextSource`.
  **Files**:
  - Create `src/integrations/github/manifest.ts`
  - Create `src/integrations/github/index.ts` (barrel export + registration side-effect)
  **Details for `manifest.ts`**:
  - `id: "github"`, `name: "GitHub"`, `icon: Github` (from lucide-react)
  - `browserComponent: lazy(() => import("./browser"))` (lazy-loaded)
  - `settingsComponent: lazy(() => import("./settings"))` wrapped appropriately
  - `isConfigured()`: calls `GET /api/integrations` and checks if github is connected — **OR** simpler: reads from a client-side signal set by the `IntegrationsContext`. Since `isConfigured` is synchronous, it should read from a module-level variable that gets updated by the context. Alternative: make it async and adjust the registry interface. **Decision**: Keep it sync — have the context set a module-level `_isGitHubConfigured` boolean that the manifest reads. The context updates this on each poll.
  - `resolveContext(url)`: Parses GitHub URLs (`github.com/:owner/:repo/issues/:num` and `/pull/:num`), calls the proxy API routes to fetch issue/PR details + comments, constructs a `ContextSource` with:
    - `type: "github-issue"` or `"github-pr"`
    - `url`: the canonical GitHub URL
    - `title`: issue/PR title
    - `body`: markdown with title, body, labels, and comments
    - `metadata`: `{ owner, repo, number, labels, state, comments }`
  **Details for `index.ts`**:
  - Imports `registerIntegration` from `../../integrations/registry`
  - Imports `githubManifest` from `./manifest`
  - Calls `registerIntegration(githubManifest)` at module level
  - Exports the manifest for direct use if needed
  **Acceptance**: After importing `src/integrations/github/index.ts`, the GitHub integration appears in `getIntegrations()`.

- [x] 13. **Import GitHub integration in app entry point**
  **What**: Ensure the GitHub integration module is imported so it self-registers. The import must happen in client code.
  **Files**:
  - Modify `src/contexts/integrations-context.tsx` (add the side-effect import)
  **Details**:
  - Add `import "@/integrations/github"` at the top of the context file
  - This ensures the registration runs before the context reads integrations
  - This is the only place where core Fleet references a specific integration — it's an import-only coupling, no type dependency
  **Acceptance**: GitHub appears in integration list.

---

### Phase 3: GitHub Browser UI

- [x] 14. **Upgrade integration hub page to use IntegrationsContext**
  **What**: The page at `src/app/integrations/page.tsx` already exists with a hardcoded GitHub tab and `MockGitHubBrowser`. Upgrade it to dynamically render tabs from connected integrations via `IntegrationsContext`, instead of hardcoding a single tab.
  **Files**:
  - Modify `src/app/integrations/page.tsx` (exists — upgrade from scaffold)
  **Details**:
  - Remove hardcoded `Github` icon import and `MockGitHubBrowser` import
  - Import `useIntegrationsContext` from `@/contexts/integrations-context`
  - Import `getConnectedIntegrations` from `@/integrations/registry`
  - Dynamically generate `TabsTrigger` for each connected integration using `manifest.icon` and `manifest.name`
  - Dynamically generate `TabsContent` for each connected integration rendering `manifest.browserComponent`
  - Default tab: first connected integration's `id`
  - If no integrations are connected, show empty state: "No integrations connected. Go to Settings > Integrations to connect one."
  - Preserve the existing `Header` and page layout from the scaffold
  **Acceptance**: Page renders at `/integrations`, dynamically shows tabs for connected integrations.

- [x] 15. **Add conditional visibility to sidebar Integrations link**
  **What**: The sidebar already has the Integrations link with `Blocks` icon (both collapsed and expanded variants, active state). The only change needed: make it conditionally visible based on `connectedIntegrations.length > 0` from `IntegrationsContext`.
  **Files**:
  - Modify `src/components/layout/sidebar.tsx` (exists — minor upgrade)
  **Details**:
  - Import `useIntegrationsContext` from `@/contexts/integrations-context`
  - Wrap the existing Integrations link block (lines 304–335 approximately) in a conditional: only render when `connectedIntegrations.length > 0`
  - No changes to the link markup itself — the scaffold already has the correct layout, icons, active state, and collapsed/expanded variants
  **Acceptance**: Integrations link appears when at least one integration is connected, disappears when none are connected.

- [x] 16. **Create GitHub browser component (replace mock)**
  **What**: Create the real GitHub browser component at `src/integrations/github/browser.tsx` that replaces `mock-browser.tsx`. Uses real data fetching hooks instead of hardcoded arrays. The mock establishes the correct layout — the real version preserves the same UX patterns (repo selector bar, Issues/PRs sub-tabs) but with live data.
  **Files**:
  - Create `src/integrations/github/browser.tsx`
  - Create `src/integrations/github/components/repo-selector.tsx`
  - Create `src/integrations/github/components/issue-list.tsx`
  - Create `src/integrations/github/components/pr-list.tsx`
  - Create `src/integrations/github/components/issue-row.tsx` (replaces `mock-issue-row.tsx`)
  - Create `src/integrations/github/components/pr-row.tsx` (replaces `mock-pr-row.tsx`)
  **Details for `browser.tsx`**:
  - Same layout as `mock-browser.tsx`: top bar with repo selector + refresh button, sub-tabs for Issues and Pull Requests
  - Replace hardcoded `MOCK_ISSUES` / `MOCK_PRS` arrays with data from hooks (`useGitHubIssues`, `useGitHubPulls`)
  - State: `selectedRepo` (persisted via `usePersistedState("weave:github:lastRepo", null)`)
  - When no repo selected, show "Select a repository to browse issues and pull requests"
  - Issue/PR counts in tab badges come from hook data, not hardcoded lengths
  **Details for `repo-selector.tsx`**:
  - Searchable dropdown using `<Popover>` + `<Command>` (from cmdk, already available)
  - Shows repo list from `useGitHubRepos` hook
  - Each item: repo full_name, private badge, language badge, star count
  - Supports pagination (load more on scroll)
  - Fires `onSelect(repo)` callback
  **Details for `issue-list.tsx`**:
  - Uses `useGitHubIssues(owner, repo, { state })` hook
  - Filter toggle: Open / Closed
  - Renders `IssueRow` for each issue
  - Pagination: "Load more" button at bottom
  **Details for `issue-row.tsx`** (replaces `mock-issue-row.tsx`):
  - Same UX pattern as the mock: `Collapsible`, chevron, number, title, labels, comments, author, age, "Create Session" button
  - Props accept `GitHubIssue` type instead of the mock's inline interface
  - Expanded state: renders real issue body as markdown (using existing `react-markdown`), loads real comments via `useGitHubComments` hook
  - "Create Session" button wired to `CreateSessionButton` (Task 22)
  **Details for `pr-row.tsx`** (replaces `mock-pr-row.tsx`):
  - Same UX pattern as the mock: additions/deletions, branch badge, draft badge
  - Props accept `GitHubPullRequest` type
  - Expanded state: renders real PR body, comments, diff stats
  - "Create Session" button wired to `CreateSessionButton` (Task 22)
  **Details for `pr-list.tsx`**:
  - Same pattern as `issue-list.tsx` but fetches from pulls endpoint
  - Filter toggle: Open / Closed / Merged (derived from merged_at)
  **Acceptance**: User can browse repos, view issues/PRs, expand them inline, see "Create Session" buttons — all with live GitHub data.

- [x] 17. **Create GitHub API client hooks**
  **What**: Custom hooks for fetching GitHub data via the proxy API routes. Used by the browser components.
  **Files**:
  - Create `src/integrations/github/hooks/use-github-repos.ts`
  - Create `src/integrations/github/hooks/use-github-issues.ts`
  - Create `src/integrations/github/hooks/use-github-pulls.ts`
  - Create `src/integrations/github/hooks/use-github-comments.ts`
  **Details**:
  - Each hook uses `apiFetch()` from `@/lib/api-client`
  - Pattern: `useState` for data/loading/error, `useEffect` or `useCallback` for fetch
  - Support pagination: `loadMore()` appends next page of results
  - Support filters: `state` (open/closed), `sort`, `direction`
  - `useGitHubComments(owner, repo, number)` — lazy-loaded (only fetched when expanded)
  - These hooks live INSIDE the integration module, not in `src/hooks/` (per architecture decision)
  **Acceptance**: Hooks compile and function correctly when used by browser components.

---

### Phase 4: Session Context Injection

- [x] 18. **Extend CreateSessionRequest with optional ContextSource**
  **What**: Add an optional `context` field to `CreateSessionRequest` so the client can pass issue/PR context when creating a session.
  **Files**:
  - Modify `src/lib/api-types.ts`
  **Details**:
  - Import `ContextSource` from `@/integrations/types`
  - Add to `CreateSessionRequest`:
    ```ts
    /** Optional integration context to inject as the initial prompt */
    context?: ContextSource;
    ```
  - Also add an optional `initialPrompt?: string` field as a simpler alternative (pre-formatted prompt text)
  **Acceptance**: Type compiles. Existing code unaffected (field is optional).

- [x] 19. **Create context-to-prompt formatter**
  **What**: Server-side utility that converts a `ContextSource` into a structured markdown prompt suitable for the AI agent.
  **Files**:
  - Create `src/lib/server/context-formatter.ts`
  **Details**:
  - `formatContextAsPrompt(context: ContextSource): string`
  - For `type: "github-issue"`:
    ```markdown
    # Context: GitHub Issue

    **Issue**: [title](url)
    **Repository**: owner/repo
    **State**: open | closed
    **Labels**: label1, label2

    ## Description
    <issue body>

    ## Comments
    **@user1** (2 hours ago):
    <comment body>

    ---

    Please analyze this issue and work on implementing a solution.
    ```
  - For `type: "github-pr"`:
    ```markdown
    # Context: GitHub Pull Request

    **PR**: [title](url)
    **Repository**: owner/repo
    **Branch**: head → base
    **State**: open | closed | merged
    **Changes**: +additions -deletions across N files
    **Labels**: label1, label2

    ## Description
    <PR body>

    ## Comments
    **@user1** (2 hours ago):
    <comment body>

    ---

    Please review this pull request and provide feedback or make changes.
    ```
  - Generic fallback for unknown types: title + body + metadata dump
  - Unit-testable pure function
  **Acceptance**: Unit test at `src/lib/server/__tests__/context-formatter.test.ts` validates output for both issue and PR types, including edge cases (empty body, no comments, no labels).

- [x] 20. **Extend POST /api/sessions to handle context injection**
  **What**: Modify the session creation route to accept `context` and send an initial prompt after session creation.
  **Files**:
  - Modify `src/app/api/sessions/route.ts`
  **Details**:
  - After successfully creating the session (Step 3 in current code), check if `body.context` or `body.initialPrompt` is provided
  - If `body.context` is provided, call `formatContextAsPrompt(body.context)` to generate the prompt
  - If `body.initialPrompt` is provided (takes precedence), use it directly
  - Fire the initial prompt using `instance.client.chat.send({ sessionID: session.id, content: prompt })` (fire-and-forget — don't await completion, just ensure the send succeeds)
  - If the prompt send fails, log a warning but still return success (session was created)
  - The session title should default to the context title if no explicit title was provided: `title: title ?? context?.title ?? "New Session"`
  **Acceptance**: Creating a session with `context` sends the initial prompt. Existing session creation (without context) still works. Unit test verifies prompt is sent.

- [x] 21. **Extend useCreateSession to accept ContextSource**
  **What**: Update the hook to pass `context` to the API.
  **Files**:
  - Modify `src/hooks/use-create-session.ts`
  **Details**:
  - Add `context?: ContextSource` to `CreateSessionOptions`
  - Import `ContextSource` from `@/integrations/types`
  - Pass `context` through in the request body
  **Acceptance**: Hook compiles. Existing callers unaffected (field is optional).

- [x] 22. **Create "Create Session From" button component**
  **What**: A reusable button component within the GitHub integration that creates a session from a GitHub issue or PR.
  **Files**:
  - Create `src/integrations/github/components/create-session-button.tsx`
  **Details**:
  - Props: `contextSource: ContextSource`, `directory?: string`
  - On click: Opens a dialog (similar to `NewSessionDialog`) pre-populated with:
    - Title: `contextSource.title`
    - Context source badge showing "GitHub Issue #N" or "GitHub PR #N"
    - Directory picker (reuse `DirectoryPicker`)
    - Isolation strategy selector
  - On submit: Calls `createSession(directory, { title, context: contextSource, isolationStrategy })`
  - After creation: Navigates to the new session page
  - Uses `useCreateSession` hook
  - Shows loading state while creating
  - Note: The mock issue/PR rows already have placeholder "Create Session" buttons with the `Rocket` icon — the real component replaces these no-op buttons
  **Acceptance**: Button renders in issue/PR rows. Clicking it opens dialog. Submitting creates a session with context injected.

- [x] 23. **Wire "Create Session" button into issue and PR rows**
  **What**: Connect the `CreateSessionButton` to the issue and PR row components from Task 16.
  **Files**:
  - Modify `src/integrations/github/components/issue-row.tsx`
  - Modify `src/integrations/github/components/pr-row.tsx`
  **Details**:
  - Each row constructs a `ContextSource` from the issue/PR data:
    - For issues: `{ type: "github-issue", url: issue.html_url, title: issue.title, body: issue.body ?? "", metadata: { owner, repo, number: issue.number, labels: issue.labels, state: issue.state, comments: loadedComments } }`
    - For PRs: `{ type: "github-pr", url: pr.html_url, title: pr.title, body: pr.body ?? "", metadata: { owner, repo, number: pr.number, labels: pr.labels, state: pr.state, additions: pr.additions, deletions: pr.deletions, changed_files: pr.changed_files, head: pr.head.ref, base: pr.base.ref, draft: pr.draft, comments: loadedComments } }`
  - Renders `<CreateSessionButton contextSource={contextSource} />` in both collapsed and expanded states
  - When expanded and comments are loaded, the contextSource includes comments in metadata
  **Acceptance**: "Create Session From" button works end-to-end: click → dialog → create → navigate to session with context.

---

### Phase 5: Tests

- [x] 24. **Unit tests for integration registry**
  **What**: Test registration, retrieval, and filtering.
  **Files**:
  - Create `src/integrations/__tests__/registry.test.ts`
  **Details**:
  - Test `registerIntegration` adds to list
  - Test `getIntegrations` returns all registered
  - Test `getIntegration(id)` returns correct one
  - Test `getConnectedIntegrations` filters by `isConfigured()`
  - Test duplicate registration handling
  **Acceptance**: Tests pass.

- [x] 25. **Unit tests for integration store**
  **What**: Test CRUD operations on integration config.
  **Files**:
  - Create `src/lib/server/__tests__/integration-store.test.ts`
  **Details**:
  - Test set/get/remove config
  - Test file not found returns empty
  - Test malformed JSON handled gracefully
  - Use temp file path for test isolation
  **Acceptance**: Tests pass.

- [x] 26. **Unit tests for context formatter**
  **What**: Test prompt generation from ContextSource.
  **Files**:
  - Create `src/lib/server/__tests__/context-formatter.test.ts`
  **Details**:
  - Test GitHub issue formatting (with labels, comments, empty body)
  - Test GitHub PR formatting (with diff stats, draft, merged)
  - Test generic/unknown type fallback
  - Test special characters in title/body
  **Acceptance**: Tests pass.

- [x] 27. **Unit tests for GitHub API proxy routes**
  **What**: Test the proxy routes handle auth, forwarding, and errors correctly.
  **Files**:
  - Create `src/app/api/integrations/github/__tests__/repos.test.ts`
  - Create `src/app/api/integrations/github/__tests__/issues.test.ts`
  **Details**:
  - Mock `integration-store.getIntegrationConfig` to return/not return a token
  - Mock `fetch` to simulate GitHub API responses
  - Test 401 when no token
  - Test successful proxy
  - Test error forwarding from GitHub (rate limit, 404)
  **Acceptance**: Tests pass.

- [x] 28. **Integration test for session creation with context**
  **What**: Test the full flow of creating a session with context injection.
  **Files**:
  - Add test cases to `src/app/api/sessions/__tests__/route.test.ts`
  **Details**:
  - Test POST /api/sessions with `context` field
  - Verify `formatContextAsPrompt` is called
  - Verify initial prompt is sent via SDK client
  - Test POST /api/sessions without `context` still works (regression)
  **Acceptance**: Tests pass.

---

### Phase 6: Scaffold Cleanup

- [x] 29. **Delete temporary mock/scaffold files**
  **What**: Remove the temporary mock files that were replaced by real implementations in Tasks 14–16. These files are no longer imported by anything after the real components are created.
  **Files**:
  - Delete `src/integrations/github/mock-browser.tsx`
  - Delete `src/integrations/github/components/mock-issue-row.tsx`
  - Delete `src/integrations/github/components/mock-pr-row.tsx`
  **Details**:
  - Verify no remaining imports reference these files before deleting (`grep -r "mock-browser\|mock-issue-row\|mock-pr-row" src/`)
  - The integration hub page (`src/app/integrations/page.tsx`) was updated in Task 14 to use `IntegrationsContext` instead of importing `MockGitHubBrowser`
  - The real components (`browser.tsx`, `issue-row.tsx`, `pr-row.tsx`) were created in Task 16
  - Run `npm run typecheck` and `npm run build` after deletion to confirm no broken references
  **Acceptance**: Mock files deleted. No broken imports. `npm run typecheck` and `npm run build` pass.

## File Summary

### New Files (21)
| File | Phase | Purpose |
|------|-------|---------|
| `src/integrations/types.ts` | 1 | Shared types (ContextSource, IntegrationManifest) |
| `src/integrations/registry.ts` | 1 | Integration registration and lookup |
| `src/lib/server/integration-store.ts` | 1 | Server-side token/config storage |
| `src/app/api/integrations/route.ts` | 1 | Integration status/connect/disconnect API |
| `src/hooks/use-integrations.ts` | 1 | Client-side integration state hook |
| `src/contexts/integrations-context.tsx` | 1 | React context for integration state |
| `src/integrations/github/types.ts` | 2 | GitHub-specific type definitions |
| `src/app/api/integrations/github/_lib/github-fetch.ts` | 2 | Shared GitHub API fetch helper |
| `src/app/api/integrations/github/repos/route.ts` | 2 | Repos proxy endpoint |
| `src/app/api/integrations/github/repos/[owner]/[repo]/issues/route.ts` | 2 | Issues list proxy |
| `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/route.ts` | 2 | PRs list proxy |
| `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/route.ts` | 2 | Single issue proxy |
| `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/route.ts` | 2 | Single PR proxy |
| `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/comments/route.ts` | 2 | Issue comments proxy |
| `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/comments/route.ts` | 2 | PR comments proxy |
| `src/integrations/github/settings.tsx` | 2 | GitHub settings/token input component |
| `src/integrations/github/manifest.ts` | 2 | GitHub integration manifest |
| `src/integrations/github/index.ts` | 2 | GitHub module barrel + self-registration |
| `src/integrations/github/browser.tsx` | 3 | GitHub browser main component (replaces mock-browser.tsx) |
| `src/integrations/github/components/repo-selector.tsx` | 3 | Repo search/select dropdown |
| `src/integrations/github/components/issue-list.tsx` | 3 | Issue list with filters |
| `src/integrations/github/components/pr-list.tsx` | 3 | PR list with filters |
| `src/integrations/github/components/issue-row.tsx` | 3 | Expandable issue row (replaces mock-issue-row.tsx) |
| `src/integrations/github/components/pr-row.tsx` | 3 | Expandable PR row (replaces mock-pr-row.tsx) |
| `src/integrations/github/hooks/use-github-repos.ts` | 3 | Hook for fetching repos |
| `src/integrations/github/hooks/use-github-issues.ts` | 3 | Hook for fetching issues |
| `src/integrations/github/hooks/use-github-pulls.ts` | 3 | Hook for fetching PRs |
| `src/integrations/github/hooks/use-github-comments.ts` | 3 | Hook for fetching comments |
| `src/integrations/github/components/create-session-button.tsx` | 4 | Create session from context button/dialog |
| `src/lib/server/context-formatter.ts` | 4 | Context → prompt formatting |

### Modified Files (Existing — upgrade from scaffold or minor change)
| File | Phase | Status | Change |
|------|-------|--------|--------|
| `src/components/settings/integrations-tab.tsx` | 1 | Scaffold exists | Upgrade: replace `useState` mock with `IntegrationsContext` + registry-driven rendering |
| `src/app/settings/page.tsx` | — | ✅ Complete | Already has Integrations tab trigger/content — no changes needed |
| `src/components/layout/sidebar.tsx` | 3 | Scaffold exists | Minor upgrade: wrap Integrations link in `connectedIntegrations.length > 0` conditional |
| `src/app/integrations/page.tsx` | 3 | Scaffold exists | Upgrade: replace hardcoded GitHub tab with dynamic tabs from `IntegrationsContext` |
| `src/app/client-layout.tsx` | 1 | Untouched | Add IntegrationsProvider |
| `src/lib/api-types.ts` | 4 | Untouched | Add context field to CreateSessionRequest |
| `src/hooks/use-create-session.ts` | 4 | Untouched | Pass context to API |
| `src/app/api/sessions/route.ts` | 4 | Untouched | Handle context injection + initial prompt |

### Files To Delete (Phase 6)
| File | Replaced By |
|------|-------------|
| `src/integrations/github/mock-browser.tsx` | `src/integrations/github/browser.tsx` |
| `src/integrations/github/components/mock-issue-row.tsx` | `src/integrations/github/components/issue-row.tsx` |
| `src/integrations/github/components/mock-pr-row.tsx` | `src/integrations/github/components/pr-row.tsx` |

### Test Files (6)
| File | Phase |
|------|-------|
| `src/integrations/__tests__/registry.test.ts` | 5 |
| `src/lib/server/__tests__/integration-store.test.ts` | 5 |
| `src/lib/server/__tests__/context-formatter.test.ts` | 5 |
| `src/app/api/integrations/github/__tests__/repos.test.ts` | 5 |
| `src/app/api/integrations/github/__tests__/issues.test.ts` | 5 |
| Additional cases in `src/app/api/sessions/__tests__/route.test.ts` | 5 |

## Verification
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run test` passes — all existing + new tests green
- [ ] `npm run build` succeeds
- [ ] No circular imports between integration modules and core Fleet code
- [ ] GitHub token never appears in client-side network responses
- [ ] Session creation without context works identically to before (regression check)
- [ ] The sidebar integration button correctly appears/disappears based on connection status
- [ ] All mock/scaffold files (`mock-browser.tsx`, `mock-issue-row.tsx`, `mock-pr-row.tsx`) are deleted
- [ ] No remaining imports reference deleted mock files

## Potential Pitfalls
1. **Circular imports**: `src/integrations/types.ts` is imported by both core (`api-types.ts`) and integrations. Keep this file free of any imports from core.
2. **`isConfigured()` is synchronous**: The manifest's `isConfigured()` must not make API calls. Solution: the `IntegrationsContext` sets a module-level variable that the manifest reads synchronously.
3. **GitHub rate limits**: Unauthenticated requests get 60/hr; PAT gets 5000/hr. The proxy should forward `X-RateLimit-*` headers from GitHub so the UI can show warnings.
4. **SDK chat API**: Need to verify the exact SDK method for sending an initial prompt. The SDK client has `session.chat()` or similar — check `@opencode-ai/sdk` docs/types during implementation.
5. **Next.js route segment nesting**: Deep routes like `repos/[owner]/[repo]/issues/[number]/comments/route.ts` — verify Next.js handles this nesting correctly.
6. **Lazy loading**: `browserComponent` should use `React.lazy()` so the GitHub browser code isn't in the initial bundle.
7. **Scaffold cleanup ordering**: Mock files must not be deleted until all real replacements are created AND the imports in `page.tsx` are updated. Task 29 depends on Tasks 14 and 16 being fully complete.
8. **IntegrationsContext in sidebar**: The sidebar mounts early in the component tree. Ensure `IntegrationsProvider` is wired in `client-layout.tsx` (Task 7) before the sidebar tries to consume it (Task 15). Phase ordering already ensures this.
