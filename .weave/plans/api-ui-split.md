# API/UI Split — Decouple API Server from UI Rendering

## TL;DR
> **Summary**: Introduce a configurable API base URL so the React frontend can talk to the Next.js API server at any origin, enabling independent deployment of API and UI layers. The existing standalone mode (single Next.js process serving both) continues to work unchanged.
> **Estimated Effort**: Large

## Context
### Original Request
Weave Agent Fleet is a Next.js 16 app that serves both a React UI and 27 API routes from a single process. The goal is to decouple these so:
1. The frontend can target a configurable API server URL (not just same-origin `/api/...`)
2. The UI can be built as a static SPA bundle (for a future Tauri wrapper — Stage 2)
3. In development, the UI can run on a separate dev server while the API runs on Next.js
4. The existing standalone deployment mode (single process, `weave-fleet` binary) MUST continue working

### Key Findings

**1. API Surface — 27 routes across 11 route groups:**
All routes live under `src/app/api/` and use Next.js App Router `route.ts` convention:
- `api/sessions/` — CRUD, history, events (SSE), messages, prompt, command, abort, resume, diffs
- `api/fleet/summary` — aggregate stats
- `api/config/` — user config GET/PUT
- `api/notifications/` — CRUD, stream (SSE), unread-count
- `api/instances/[id]/` — agents, commands, find/files
- `api/workspaces/[id]/` — rename
- `api/workspace-roots/` — list/manage
- `api/directories/` — filesystem browsing
- `api/skills/` — list, install, remove
- `api/open-directory/` — OS-level open
- `api/version/` — version check

**2. Frontend API Call Sites — 30+ locations using hardcoded relative paths:**
All `fetch()` calls use relative URLs like `/api/sessions`, `/api/config`, etc. These are spread across:
- **22 hooks** in `src/hooks/` (use-sessions, use-create-session, use-session-events, use-send-prompt, use-abort-session, use-delete-session, use-terminate-session, use-resume-session, use-rename-session, use-rename-workspace, use-config, use-skills, use-fleet-summary, use-session-history, use-message-pagination, use-directory-browser, use-open-directory, use-find-files, use-diffs, use-agents, use-commands, use-global-sse)
- **1 context** in `src/contexts/notifications-context.tsx` (5 fetch calls)
- **1 page** in `src/app/sessions/[id]/page.tsx` (1 fetch call)
- **1 component** in `src/components/settings/about-tab.tsx` (1 fetch call)

**3. SSE Connections — 2 EventSource endpoints:**
- `use-global-sse.ts` — connects to `/api/notifications/stream` (module-level singleton, hardcoded `SSE_URL` const)
- `use-session-events.ts` — connects to `/api/sessions/[id]/events?instanceId=xxx` (per-session EventSource)

**4. No CORS headers currently set** — all routes rely on same-origin. Cross-origin mode will require CORS headers on API responses.

**5. No middleware exists** (`src/middleware.ts` not found) — we'll need to create one for CORS.

**6. Build pipeline:**
- `next build` with `output: 'standalone'` produces `server.js` in `.next/standalone/`
- `scripts/assemble-standalone.sh` and `.ps1` copy static assets, public/, cli.js, better-sqlite3 addon, VERSION file
- Launcher scripts (`scripts/launcher.sh`, `scripts/launcher.cmd`) start `node server.js` with env vars

**7. Server-side modules stay as-is** — `src/lib/server/` contains 16 modules (process-manager, database, config-manager, etc.). These are only imported by API routes. No changes needed.

**8. `src/lib/api-types.ts`** — shared types between API routes and frontend. Already well-factored.

**9. `src/instrumentation.ts`** — runs server-side code on startup (version check). Stays as-is.

**10. `use-fleet-summary.ts` imports a type from the API route file:**
```ts
import type { FleetSummaryResponse } from "@/app/api/fleet/summary/route";
```
This cross-layer type import must be redirected to `api-types.ts` so the frontend doesn't pull in server code.

## Objectives
### Core Objective
Enable the React frontend to communicate with the API server at a configurable base URL, while preserving the existing single-process standalone deployment.

### Deliverables
- [ ] A shared API client module (`src/lib/api-client.ts`) that provides `apiUrl()` and `sseUrl()` helpers
- [ ] All 30+ frontend `fetch()` calls and 2 `EventSource` connections migrated to use the API client
- [ ] CORS support for cross-origin API access (middleware + SSE headers)
- [ ] `NEXT_PUBLIC_API_BASE_URL` environment variable for configuration
- [ ] Development proxy configuration for split-server dev workflow
- [ ] Documentation for running in split mode vs. standalone mode
- [ ] All existing tests continue to pass

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] Standalone mode works: `node .next/standalone/server.js` serves both UI and API
- [ ] Split mode works: API on port 3000, UI on port 3001 with `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`

### Guardrails (Must NOT)
- Must NOT migrate away from Next.js API routes (no Hono, Fastify, Express)
- Must NOT refactor `src/lib/server/` modules
- Must NOT rewrite React UI components (only change `fetch()` call sites)
- Must NOT break the `weave-fleet` launcher scripts or standalone assembly
- Must NOT introduce a monorepo workspace split (keep single package.json)
- Must NOT remove or rename any existing API endpoints

## Design Decisions

### API Base URL Strategy
Use `NEXT_PUBLIC_API_BASE_URL` env var:
- **Unset / empty** (default): relative URLs (`/api/...`) — backwards compatible, same-origin
- **Set to a URL** (e.g., `http://localhost:3000`): absolute URLs (`http://localhost:3000/api/...`) — cross-origin split mode

This is a build-time `NEXT_PUBLIC_` variable so it's inlined into the client bundle. For the standalone build, it's unset, preserving current behavior.

### API Client Module Shape
A single `src/lib/api-client.ts` module that exports:
```ts
export function apiUrl(path: string): string;     // "/api/sessions" → "http://host:3000/api/sessions"
export function sseUrl(path: string): string;      // Same as apiUrl, for EventSource
export function apiFetch(path: string, init?: RequestInit): Promise<Response>;
```
- `apiUrl` prepends the base URL if configured
- `apiFetch` is a thin wrapper around `fetch(apiUrl(path), init)` — keeps migration minimal (just change `fetch("/api/foo")` to `apiFetch("/api/foo")`)
- `sseUrl` is identical to `apiUrl` but semantically clear for EventSource usage

### CORS Approach
Add a Next.js middleware (`src/middleware.ts`) that:
1. Only applies to `/api/` routes
2. Adds `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`
3. Handles preflight `OPTIONS` requests
4. In standalone mode (no cross-origin), the headers are harmless no-ops
5. SSE routes also need CORS headers — these are currently set directly in the route `Response` headers, so the middleware covers them

### Why NOT a monorepo split
A monorepo split (`apps/api` + `apps/web`) would mean:
- Two separate Next.js projects (or one Next.js + one Vite project)
- Duplicated dependency management
- Shared types need a separate package
- The standalone mode becomes complex (two builds merged)

Instead: keep one Next.js project. The "split" is purely at the network layer — the frontend uses configurable URLs, and CORS enables cross-origin access. The standalone build continues to produce a single `server.js` that serves both.

## TODOs

### Phase 1: API Client Foundation

- [ ] 1. **Move `FleetSummaryResponse` type to `api-types.ts`**
  **What**: The `use-fleet-summary.ts` hook imports `FleetSummaryResponse` from `@/app/api/fleet/summary/route` — a cross-layer import that would break if the API routes were served separately. Move the type to `src/lib/api-types.ts` and update both the route and the hook to import from there.
  **Files**:
    - `src/lib/api-types.ts` — add `FleetSummaryResponse` interface
    - `src/app/api/fleet/summary/route.ts` — import from `@/lib/api-types` instead of defining inline (or re-export)
    - `src/hooks/use-fleet-summary.ts` — change import to `@/lib/api-types`
  **Acceptance**: `npm run typecheck` passes; no imports from `@/app/api/` in `src/hooks/` or `src/contexts/`

- [ ] 1b. **Move `DbNotification` type to `api-types.ts`**
  **What**: Three client-side files import `DbNotification` directly from the server module `@/lib/server/db-repository`. This is a type-only import (no runtime breakage today), but it creates a direct dependency from the UI layer into the server layer. When the UI is built as a standalone SPA (Stage 2 / Tauri), the bundler will try to resolve `@/lib/server/db-repository` and fail because it imports `better-sqlite3`. Move the `DbNotification` interface to `src/lib/api-types.ts` and update all importers.
  **Files**:
    - `src/lib/api-types.ts` — add `DbNotification` interface (copy from `db-repository.ts`)
    - `src/lib/server/db-repository.ts` — import `DbNotification` from `@/lib/api-types` (or re-export it so server-side consumers aren't affected)
    - `src/contexts/notifications-context.tsx` — change import to `@/lib/api-types`
    - `src/components/notifications/notification-bell.tsx` — change import to `@/lib/api-types`
    - `src/hooks/use-browser-notifications.ts` — change import to `@/lib/api-types`
    - `src/hooks/use-notifications.ts` — change re-export to `from "@/lib/api-types"`
    - `src/lib/server/notification-emitter.ts` — change import to `@/lib/api-types` (or keep importing via re-export from `db-repository`)
  **Acceptance**: `npm run typecheck` passes; no imports from `@/lib/server/` in `src/hooks/`, `src/contexts/`, or `src/components/`

- [ ] 2. **Create the API client module**
  **What**: Create `src/lib/api-client.ts` with `apiUrl()`, `sseUrl()`, and `apiFetch()` functions. The module reads `process.env.NEXT_PUBLIC_API_BASE_URL` at module scope (safe because `NEXT_PUBLIC_` vars are inlined at build time). When unset, returns paths unchanged (relative URLs). When set, prepends the base URL.
  **Files**:
    - `src/lib/api-client.ts` — new file
  **Implementation notes**:
    ```ts
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    
    export function apiUrl(path: string): string {
      // path should start with "/" e.g. "/api/sessions"
      return API_BASE ? `${API_BASE}${path}` : path;
    }
    
    export const sseUrl = apiUrl; // Same logic, semantic alias
    
    export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
      return fetch(apiUrl(path), init);
    }
    ```
  **Acceptance**: Module compiles; `apiUrl("/api/sessions")` returns `"/api/sessions"` when env var is unset; returns `"http://localhost:3000/api/sessions"` when env var is `"http://localhost:3000"`

- [ ] 3. **Add unit tests for the API client module**
  **What**: Create `src/lib/__tests__/api-client.test.ts` testing `apiUrl()` and `apiFetch()` with and without the env var set.
  **Files**:
    - `src/lib/__tests__/api-client.test.ts` — new file
  **Acceptance**: `npm run test` passes with new tests

### Phase 2: Migrate Hooks (fetch calls)

- [ ] 4. **Migrate `use-sessions.ts`**
  **What**: Replace `fetch("/api/sessions")` with `apiFetch("/api/sessions")`. Add import for `apiFetch` from `@/lib/api-client`.
  **Files**: `src/hooks/use-sessions.ts`
  **Acceptance**: `npm run typecheck` passes; fetch call uses `apiFetch`

- [ ] 5. **Migrate `use-create-session.ts`**
  **What**: Replace `fetch("/api/sessions", { method: "POST", ... })` with `apiFetch("/api/sessions", { method: "POST", ... })`.
  **Files**: `src/hooks/use-create-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 6. **Migrate `use-session-events.ts`**
  **What**: Replace the 2 `fetch()` calls and the `EventSource` URL construction:
    - Line 94: `fetch(\`/api/sessions/...\`)` → `apiFetch(\`/api/sessions/...\`)`
    - Line 126: `fetch(\`/api/sessions/.../messages\`)` → `apiFetch(\`/api/sessions/.../messages\`)`
    - Line 167: `new EventSource(url)` — change `url` construction to use `sseUrl()`
  **Files**: `src/hooks/use-session-events.ts`
  **Acceptance**: `npm run typecheck` passes; EventSource uses `sseUrl()`

- [ ] 7. **Migrate `use-global-sse.ts`**
  **What**: Replace the hardcoded `const SSE_URL = "/api/notifications/stream"` with `sseUrl("/api/notifications/stream")`. Import `sseUrl` from `@/lib/api-client`. Note: `sseUrl()` is called at module scope (not inside a React hook), which is fine since it reads a build-time constant.
  **Files**: `src/hooks/use-global-sse.ts`
  **Acceptance**: `npm run typecheck` passes; SSE URL is configurable

- [ ] 8. **Migrate `use-send-prompt.ts`**
  **What**: Replace 2 `fetch()` calls (command endpoint and prompt endpoint) with `apiFetch()`.
  **Files**: `src/hooks/use-send-prompt.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 9. **Migrate `use-abort-session.ts`**
  **What**: Replace `fetch(\`/api/sessions/.../abort\`)` with `apiFetch(...)`.
  **Files**: `src/hooks/use-abort-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 10. **Migrate `use-delete-session.ts`**
  **What**: Replace `fetch(\`/api/sessions/...\`, { method: "DELETE" })` with `apiFetch(...)`.
  **Files**: `src/hooks/use-delete-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 11. **Migrate `use-terminate-session.ts`**
  **What**: Replace `fetch(\`/api/sessions/...\`, { method: "DELETE" })` with `apiFetch(...)`.
  **Files**: `src/hooks/use-terminate-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 12. **Migrate `use-resume-session.ts`**
  **What**: Replace `fetch(\`/api/sessions/.../resume\`)` with `apiFetch(...)`.
  **Files**: `src/hooks/use-resume-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 13. **Migrate `use-rename-session.ts`**
  **What**: Replace `fetch(\`/api/sessions/...\`, { method: "PATCH" })` with `apiFetch(...)`.
  **Files**: `src/hooks/use-rename-session.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 14. **Migrate `use-rename-workspace.ts`**
  **What**: Replace `fetch(\`/api/workspaces/...\`, { method: "PATCH" })` with `apiFetch(...)`.
  **Files**: `src/hooks/use-rename-workspace.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 15. **Migrate `use-config.ts`**
  **What**: Replace 2 `fetch()` calls (GET and PUT to `/api/config`) with `apiFetch(...)`.
  **Files**: `src/hooks/use-config.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 16. **Migrate `use-skills.ts`**
  **What**: Replace 3 `fetch()` calls (GET, POST, DELETE to `/api/skills`) with `apiFetch(...)`.
  **Files**: `src/hooks/use-skills.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 17. **Migrate `use-fleet-summary.ts`**
  **What**: Replace `fetch("/api/fleet/summary")` with `apiFetch("/api/fleet/summary")`.
  **Files**: `src/hooks/use-fleet-summary.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 18. **Migrate `use-session-history.ts`**
  **What**: Replace `fetch(\`/api/sessions/history?...\`)` with `apiFetch(...)`.
  **Files**: `src/hooks/use-session-history.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 19. **Migrate `use-message-pagination.ts`**
  **What**: Replace 2 `fetch()` calls (initial load and older messages) with `apiFetch(...)`.
  **Files**: `src/hooks/use-message-pagination.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 20. **Migrate `use-directory-browser.ts`**
  **What**: Replace `fetch(url, { signal })` where `url = \`/api/directories...\`` with `apiFetch(url, { signal })`. Note: the URL is constructed as a variable, then passed to fetch. Change to use `apiUrl()` when constructing the URL, then pass to `fetch()` (or use `apiFetch()`).
  **Files**: `src/hooks/use-directory-browser.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 21. **Migrate `use-open-directory.ts`**
  **What**: Replace `fetch("/api/open-directory", { method: "POST" })` with `apiFetch(...)`.
  **Files**: `src/hooks/use-open-directory.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 22. **Migrate `use-find-files.ts`**
  **What**: Replace `fetch(url, { signal })` where `url = \`/api/instances/.../find/files?...\`` with `apiFetch(...)`.
  **Files**: `src/hooks/use-find-files.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 23. **Migrate `use-diffs.ts`**
  **What**: Replace `fetch(url)` where `url = \`/api/sessions/.../diffs?...\`` with `apiFetch(...)`.
  **Files**: `src/hooks/use-diffs.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 24. **Migrate `use-agents.ts`**
  **What**: Replace `fetch(\`/api/instances/.../agents\`)` with `apiFetch(...)`.
  **Files**: `src/hooks/use-agents.ts`
  **Acceptance**: `npm run typecheck` passes

- [ ] 25. **Migrate `use-commands.ts`**
  **What**: Replace `fetch(\`/api/instances/.../commands\`)` with `apiFetch(...)`.
  **Files**: `src/hooks/use-commands.ts`
  **Acceptance**: `npm run typecheck` passes

### Phase 3: Migrate Contexts and Components

- [ ] 26. **Migrate `notifications-context.tsx`**
  **What**: Replace all 5 `fetch()` calls with `apiFetch()`:
    - `fetch("/api/notifications/unread-count")` (line 71)
    - `fetch(\`/api/notifications?limit=...\`)` (line 83)
    - `fetch(\`/api/notifications/...\`, { method: "PATCH" })` (line 99)
    - `fetch("/api/notifications/all", { method: "PATCH" })` (line 117)
    - `fetch("/api/notifications", { method: "DELETE" })` (line 134)
  **Files**: `src/contexts/notifications-context.tsx`
  **Acceptance**: `npm run typecheck` passes

- [ ] 27. **Migrate `sessions/[id]/page.tsx`**
  **What**: Replace `fetch(url)` where `url = \`/api/sessions/...?instanceId=...\`` with `apiFetch(url)`.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: `npm run typecheck` passes

- [ ] 28. **Migrate `about-tab.tsx`**
  **What**: Replace `fetch("/api/version")` with `apiFetch("/api/version")`.
  **Files**: `src/components/settings/about-tab.tsx`
  **Acceptance**: `npm run typecheck` passes

### Phase 4: CORS Support

- [ ] 29. **Create CORS middleware**
  **What**: Create `src/middleware.ts` that adds CORS headers to all `/api/` routes. The middleware should:
    - Match only `/api/:path*` routes (use `matcher` config)
    - Add `Access-Control-Allow-Origin: *` (or read from env var for restrictive mode)
    - Add `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
    - Add `Access-Control-Allow-Headers: Content-Type, Authorization`
    - Handle preflight `OPTIONS` requests with a 204 response
    - Pass through for non-OPTIONS requests with headers added via `NextResponse.next()`
  **Implementation note**: Use `*` for Allow-Origin in dev/standalone. A `WEAVE_CORS_ORIGIN` env var could restrict it in production, but that's optional for v1.
  **Files**: `src/middleware.ts` — new file
  **Acceptance**: `npm run typecheck` passes; API routes return CORS headers when accessed from a different origin

- [ ] 30. **Add CORS headers to SSE responses**
  **What**: The SSE routes (`src/app/api/sessions/[id]/events/route.ts` and `src/app/api/notifications/stream/route.ts`) return raw `Response` objects, not `NextResponse`. The middleware may not be able to modify these streaming responses. Verify whether the middleware intercepts these correctly. If not, add CORS headers directly to the SSE `Response` headers in both route files.
  **Files**:
    - `src/app/api/sessions/[id]/events/route.ts` — add CORS headers to Response
    - `src/app/api/notifications/stream/route.ts` — add CORS headers to Response
  **Acceptance**: SSE connections work cross-origin; `EventSource` from `http://localhost:3001` to `http://localhost:3000` connects successfully

### Phase 5: Build & Dev Configuration

- [ ] 31. **Add `NEXT_PUBLIC_API_BASE_URL` to `next.config.ts` env documentation**
  **What**: Add a comment in `next.config.ts` documenting the new env var. Optionally add it to the `env` block with a default of `""` for clarity. Do NOT set a non-empty default — that would break standalone mode.
  **Files**: `next.config.ts` (project root) — add comment/documentation
  **Acceptance**: `npm run build` succeeds with and without the env var set

- [ ] 32. **Add `.env.development.split` example file**
  **What**: Create `.env.development.split` (not loaded by default — Next.js loads `.env.development`) as a reference for developers who want to run in split mode:
    ```
    NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
    ```
  Users can copy this to `.env.development.local` to activate split mode. Document this in the file with comments.
  **Files**: `.env.development.split` — new file
  **Acceptance**: File exists with clear documentation

- [ ] 33. **Add `dev:split-ui` and `dev:split-api` npm scripts**
  **What**: Add convenience scripts to `package.json`:
    - `"dev:api"` — starts Next.js dev server (API + UI) on default port 3000: `"next dev"`
    - `"dev:ui"` — starts Next.js dev server with API base URL pointing to port 3000, running on port 3001: `"cross-env NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 next dev --port 3001"`
  Note: `cross-env` is not currently a dependency. Use `env` inline or add a note that this only works on macOS/Linux. Alternatively, use a shell script.
  **Files**: `package.json` — add scripts
  **Acceptance**: `npm run dev:api` starts server on port 3000; `npm run dev:ui` starts server on port 3001 with API base URL configured

### Phase 6: Verification

- [ ] 34. **Verify no remaining hardcoded API paths**
  **What**: Run a grep across `src/hooks/`, `src/contexts/`, `src/components/`, and `src/app/` (excluding `src/app/api/`) for any remaining `fetch("/api` or `fetch(\`/api` or `EventSource(` patterns that weren't migrated. Every frontend `fetch` to `/api/` should go through `apiFetch()`.
  **Files**: none (verification only)
  **Acceptance**: Grep returns zero matches for hardcoded `/api/` fetch calls outside of `src/lib/api-client.ts` and `src/app/api/`

- [ ] 35. **Verify standalone build**
  **What**: Run `npm run build` and verify the standalone output works. The build should succeed without `NEXT_PUBLIC_API_BASE_URL` set (defaults to relative URLs).
  **Files**: none (verification only)
  **Acceptance**: `npm run build` succeeds; `node .next/standalone/server.js` (or equivalent) starts and serves both UI and API

- [ ] 36. **Run full test suite**
  **What**: Run `npm run test`, `npm run typecheck`, and `npm run lint` to verify no regressions.
  **Files**: none (verification only)
  **Acceptance**: All commands pass with exit code 0

## Verification
- [ ] `npm run build` succeeds (standalone mode, no env var)
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] No hardcoded `/api/` fetch calls remain in frontend code
- [ ] Standalone mode: `node .next/standalone/server.js` serves both UI and API on same port
- [ ] Split mode: API on port 3000, UI on port 3001 with `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` — UI can fetch data and connect SSE cross-origin

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SSE EventSource doesn't support CORS credentials by default | SSE connections fail cross-origin | EventSource with `withCredentials: false` (default) works with `Access-Control-Allow-Origin: *`. No cookies/auth needed. |
| Next.js middleware can't modify streaming SSE responses | CORS headers missing on SSE | Add CORS headers directly in SSE route Response objects (Task 30) |
| `NEXT_PUBLIC_` vars are inlined at build time | Can't change API URL without rebuilding | This is acceptable — the env var is a build config. Tauri (Stage 2) will use a different build. |
| Large number of files changed (30+ hook migrations) | Merge conflicts with in-flight PRs | Each hook migration is a mechanical 1-line change (`fetch(` → `apiFetch(`). Can be done in a single commit. |
| `use-fleet-summary.ts` imports type from API route file | Build could pull in server code to client bundle | Task 1 fixes this by moving the type to `api-types.ts` |

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `src/lib/api-client.ts` | API base URL helpers: `apiUrl()`, `sseUrl()`, `apiFetch()` |
| `src/lib/__tests__/api-client.test.ts` | Unit tests for API client |
| `src/middleware.ts` | CORS middleware for `/api/*` routes |
| `.env.development.split` | Example env file for split-mode development |

### Modified Files (30+)
| File | Change |
|------|--------|
| `src/lib/api-types.ts` | Add `FleetSummaryResponse` and `DbNotification` types |
| `src/app/api/fleet/summary/route.ts` | Re-export type from `api-types` |
| `src/lib/server/db-repository.ts` | Import/re-export `DbNotification` from `api-types` |
| `src/lib/server/notification-emitter.ts` | Update `DbNotification` import |
| `src/components/notifications/notification-bell.tsx` | Change `DbNotification` import to `@/lib/api-types` |
| `src/hooks/use-browser-notifications.ts` | Change `DbNotification` import to `@/lib/api-types` |
| `src/hooks/use-notifications.ts` | Change `DbNotification` re-export to `from "@/lib/api-types"` |
| `src/hooks/use-sessions.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-create-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-session-events.ts` | `fetch()` → `apiFetch()`, `EventSource` → `sseUrl()` |
| `src/hooks/use-global-sse.ts` | `SSE_URL` → `sseUrl()` |
| `src/hooks/use-send-prompt.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-abort-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-delete-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-terminate-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-resume-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-rename-session.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-rename-workspace.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-config.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-skills.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-fleet-summary.ts` | `fetch()` → `apiFetch()`, fix import |
| `src/hooks/use-session-history.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-message-pagination.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-directory-browser.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-open-directory.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-find-files.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-diffs.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-agents.ts` | `fetch()` → `apiFetch()` |
| `src/hooks/use-commands.ts` | `fetch()` → `apiFetch()` |
| `src/contexts/notifications-context.tsx` | `fetch()` → `apiFetch()` (5 calls) |
| `src/app/sessions/[id]/page.tsx` | `fetch()` → `apiFetch()` |
| `src/components/settings/about-tab.tsx` | `fetch()` → `apiFetch()` |
| `src/app/api/sessions/[id]/events/route.ts` | Add CORS headers to SSE Response |
| `src/app/api/notifications/stream/route.ts` | Add CORS headers to SSE Response |
| `package.json` | Add `dev:api` and `dev:ui` scripts |
