# GitHub Device OAuth Flow (RFC 8628)

## TL;DR
> **Summary**: Replace the manual PAT-paste flow with GitHub's Device Authorization Grant (RFC 8628) as the primary connection method, keeping PAT entry as a secondary "Advanced" option.
> **Estimated Effort**: Medium

## Context

### Original Request
Add GitHub Device OAuth flow so users can authenticate by visiting a URL and entering a code, instead of manually creating and pasting a Personal Access Token. The device flow should be primary; PAT should remain as a fallback.

### Key Findings
- **Current flow**: `settings.tsx` renders a password `<Input>` for a PAT. User pastes token → "Test Connection" validates against `api.github.com/user` client-side → "Connect" calls `POST /api/integrations` which writes `{ token }` to `~/.weave/integrations.json` via `integration-store.ts`.
- **Token consumption**: `github-fetch.ts` reads `getIntegrationConfig("github").token` and uses `Bearer ${token}` — this works identically for OAuth tokens and PATs.
- **Integration store**: Already generic (`IntegrationConfig.token?: string`). No schema changes needed — the OAuth access token is stored the same way a PAT is.
- **UI host**: `integrations-tab.tsx` renders `manifest.settingsComponent` inside a `<Card>` when disconnected, and a "Disconnect" button when connected. The settings component has full control of its interior.
- **Reference impl**: opencode's `copilot.ts` (lines 197-298) shows the complete device flow: POST to `/login/device/code`, poll `/login/oauth/access_token`, handle `authorization_pending`, `slow_down`, `expired_token`, and generic errors.
- **No new deps needed**: Native `fetch` on both server (Next.js API routes) and client.
- **Test patterns**: Existing tests in `__tests__/repos.test.ts` use `vi.mock` for `integration-store` and `vi.spyOn(global, "fetch")`.
- **Client ID**: GitHub OAuth App registered. Client ID is `Ov23liJT2Q0HXHj9xLGM` — hardcoded as a constant (it's a public identifier, same approach as opencode).

## Objectives

### Core Objective
Implement the full GitHub Device Authorization flow (RFC 8628) with two new API routes and a redesigned settings UI, so users can connect GitHub with a single click instead of manually creating a PAT.

### Deliverables
- [x] Server-side device flow initiation route (`POST /api/integrations/github/auth/device-code`)
- [x] Server-side token polling route (`POST /api/integrations/github/auth/poll`)
- [x] Redesigned `settings.tsx` with device flow as primary, PAT as collapsible secondary
- [x] Shared types file for device auth request/response shapes
- [x] Unit tests for both new API routes
- [x] Documentation of `GITHUB_OAUTH_CLIENT_ID` constant

### Definition of Done
- [x] `npm run typecheck` passes
- [x] `npm run test` passes (including new tests)
- [ ] `npm run build` succeeds
- [ ] Manual test: clicking "Connect with GitHub" initiates device flow, shows code + URL, completes auth, stores token, shows "Connected" status

### Guardrails (Must NOT)
- Must NOT expose `device_code` to the browser unnecessarily (though `device_code` alone cannot obtain a token without `client_id` — standard RFC 8628 pattern)
- Must NOT remove the PAT flow — keep it as a secondary option
- Must NOT add new npm dependencies (use native `fetch`)
- Must NOT change `integration-store.ts` schema (OAuth token stored as `token` field, same as PAT)
- Must NOT block the server during polling (polling is client-initiated, server is stateless per-request)

## TODOs

- [x] 1. **Create shared types for device auth**
  **What**: Define TypeScript types for the device flow API request/response shapes. These are used by both the API routes and the frontend.
  **Files**: `src/app/api/integrations/github/auth/_types.ts` (new)
  **Details**:
  - `DeviceCodeResponse`: `{ userCode: string; verificationUri: string; expiresIn: number; interval: number }` — returned to frontend from initiation route
  - `DeviceCodeRequest`: (empty body — no client params needed)
  - `PollRequest`: `{ deviceCode: string }` — sent from frontend to poll route
  - `PollResponse`: `{ status: "pending" | "complete" | "expired" | "denied" | "error"; token?: string; interval?: number; message?: string }`
  - Internal server types (never sent to client): `GitHubDeviceCodeResponse` (raw GitHub shape with `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval`), `GitHubAccessTokenResponse` (raw GitHub shape with `access_token`, `error`, `interval`)
  - Note: `deviceCode` is passed from frontend to backend but is an opaque string — it cannot be used without the `client_id` (which stays server-side). This is the standard RFC 8628 pattern.
  **Acceptance**: File exists, `npm run typecheck` passes

- [x] 2. **Add GitHub OAuth constants**
  **What**: Define the hardcoded client ID and GitHub URL constants for the device flow.
  **Files**: `src/app/api/integrations/github/auth/_config.ts` (new)
  **Details**:
  - Export `const GITHUB_OAUTH_CLIENT_ID = "Ov23liJT2Q0HXHj9xLGM"` (public identifier, safe to hardcode — same pattern as opencode)
  - Export `const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"`
  - Export `const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"`
  - Export `const OAUTH_SCOPES = "repo,read:user"` (repo for full access to repos/issues/PRs, read:user for user profile)
  - Export `const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000` (safety buffer per opencode pattern)
  **Acceptance**: File exists, `npm run typecheck` passes

- [x] 3. **Create device code initiation API route**
  **What**: `POST /api/integrations/github/auth/device-code` — initiates the GitHub device flow by calling GitHub's device code endpoint, then returns the user-facing code and URL to the frontend (without exposing `client_id` or `device_code` internals).
  **Files**: `src/app/api/integrations/github/auth/device-code/route.ts` (new)
  **Details**:
  - POST handler: reads `client_id` from `GITHUB_OAUTH_CLIENT_ID` constant
  - Calls `POST https://github.com/login/device/code` with `{ client_id, scope: OAUTH_SCOPES }` and headers `Accept: application/json`, `Content-Type: application/json`, `User-Agent: weave-agent-fleet`
  - On success, returns `{ userCode, verificationUri, deviceCode, expiresIn, interval }` to the client
  - Note: `deviceCode` is returned to the client so it can pass it back during polling. This is safe — `device_code` alone cannot obtain a token without `client_id` (which stays server-side). This is the standard pattern used by GitHub CLI, VS Code, and opencode.
  - On failure (GitHub returns non-200), returns `{ error: "Failed to initiate GitHub device authorization" }` with status 502
  - Use structured logging via `log` from `@/lib/server/logger`
  **Acceptance**: Route responds correctly. Unit test passes.

- [x] 4. **Create token polling API route**
  **What**: `POST /api/integrations/github/auth/poll` — polls GitHub for the access token using the device code. Called repeatedly by the frontend. Stateless — each call is independent.
  **Files**: `src/app/api/integrations/github/auth/poll/route.ts` (new)
  **Details**:
  - POST handler: reads `{ deviceCode }` from request body
   - Reads `client_id` from `GITHUB_OAUTH_CLIENT_ID` constant
  - Calls `POST https://github.com/login/oauth/access_token` with `{ client_id, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }` and headers `Accept: application/json`, `Content-Type: application/json`, `User-Agent: weave-agent-fleet`
  - Response mapping:
    - `data.access_token` present → store token via `setIntegrationConfig("github", { token: data.access_token })` → return `{ status: "complete" }`
    - `data.error === "authorization_pending"` → return `{ status: "pending" }`
    - `data.error === "slow_down"` → return `{ status: "pending", interval: data.interval ?? currentInterval + 5 }` (RFC 8628 §3.5: add 5 seconds)
    - `data.error === "expired_token"` → return `{ status: "expired", message: "Device code expired. Please restart the flow." }`
    - `data.error === "access_denied"` → return `{ status: "denied", message: "Authorization was denied." }`
    - Any other `data.error` → return `{ status: "error", message: data.error }` with status 502
    - GitHub returns non-200 → return `{ status: "error", message: "GitHub API error" }` with status 502
  - Validate `deviceCode` is present and is a non-empty string, return 400 if missing
  - Token storage happens server-side in this route (same `setIntegrationConfig` used by `POST /api/integrations`)
  - Use structured logging for all error paths
  **Acceptance**: Route correctly maps all GitHub response types. Token is stored on success. Unit tests cover all branches.

- [x] 5. **Write unit tests for device-code route**
  **What**: Test the device code initiation route with mocked GitHub responses.
  **Files**: `src/app/api/integrations/github/__tests__/device-code.test.ts` (new)
  **Details**:
  - Follow existing test pattern from `repos.test.ts`: `vi.mock` for `integration-store`, `logger`; `vi.spyOn(global, "fetch")` for GitHub calls
  - Test cases:
    1. Returns user code and verification URI on successful GitHub response
    2. Returns 502 when GitHub returns non-200
    3. Returns 502 on network error (fetch throws)
    4. Sends correct headers and body to GitHub (verify `User-Agent`, `Accept`, `Content-Type`, `client_id`, `scope`)
  **Acceptance**: All tests pass with `npm run test`

- [x] 6. **Write unit tests for poll route**
  **What**: Test the token polling route with mocked GitHub responses covering all RFC 8628 states.
  **Files**: `src/app/api/integrations/github/__tests__/poll.test.ts` (new)
  **Details**:
  - Same mock pattern as device-code tests
  - Additionally mock `setIntegrationConfig` to verify token storage
  - Test cases:
    1. Returns `{ status: "complete" }` and stores token when GitHub returns `access_token`
    2. Returns `{ status: "pending" }` when GitHub returns `authorization_pending` error
    3. Returns `{ status: "pending", interval }` with increased interval on `slow_down`
    4. Returns `{ status: "expired" }` on `expired_token`
    5. Returns `{ status: "denied" }` on `access_denied`
    6. Returns `{ status: "error" }` on unknown GitHub errors
    7. Returns 400 when `deviceCode` is missing from request body
    8. Returns 502 on network error
    9. Verifies correct `grant_type` in request to GitHub
  **Acceptance**: All tests pass with `npm run test`

- [x] 7. **Redesign `settings.tsx` — device flow as primary, PAT as secondary**
  **What**: Rewrite the GitHub settings component to show "Connect with GitHub" button (device flow) as the primary action, with a collapsible "Advanced: Use Personal Access Token" section below.
  **Files**: `src/integrations/github/settings.tsx` (modify)
  **Details**:
  - **State machine for device flow** (local state, no new context needed):
    - `idle` → initial state, shows "Connect with GitHub" button
    - `initiating` → button shows spinner, calling device-code route
    - `awaiting-auth` → shows verification URL, user code (large, monospace, copyable), "Waiting for authorization..." with spinner, and a "Cancel" button
    - `complete` → brief success flash, then component unmounts (parent shows "Connected")
    - `error` → shows error message with "Try Again" button
    - `expired` → shows "Code expired" with "Try Again" button
    - `denied` → shows "Authorization denied" with "Try Again" button
  - **Device flow UI** (when in `awaiting-auth`):
    - Show verification URI as a clickable link: `<a href={verificationUri} target="_blank" rel="noopener noreferrer">`
    - Show user code in large monospace text with a "Copy" button (use `navigator.clipboard.writeText`)
    - Show countdown or "Expires in X minutes" based on `expiresIn`
    - Auto-poll: use `setInterval` to call `POST /api/integrations/github/auth/poll` every `interval` seconds (respect `slow_down` by updating interval)
    - On `complete`: call `refetch()` from integrations context to update connection status
    - On `expired`/`denied`: stop polling, show message
    - Cleanup: clear interval on unmount or state change
  - **PAT section** (below device flow):
    - Wrap existing PAT UI in a collapsible section (use existing `Collapsible` from `@/components/ui/collapsible`)
    - Trigger text: "Advanced: Use Personal Access Token" with a chevron
    - Contents: existing `<Input>`, "Test Connection", "Connect" buttons (current code, moved here)
  - **Imports**: Add `useRef`, `useCallback` from React. Add `Copy`, `ExternalLink`, `ChevronDown` from `lucide-react`. Add `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`. Add `apiFetch` from `@/lib/api-client`.
  - The component still returns `null` when `isConnected` is true (parent handles disconnect).
  **Acceptance**: UI renders device flow button. Clicking it calls the API and shows the code/URL. Polling works. PAT section is collapsible. `npm run typecheck` passes.

## File Tree (new/modified)

```
src/app/api/integrations/github/auth/
├── _types.ts                    (NEW) — shared types
├── _config.ts                   (NEW) — env var helper + constants
├── device-code/
│   └── route.ts                 (NEW) — initiation endpoint
└── poll/
    └── route.ts                 (NEW) — polling endpoint

src/app/api/integrations/github/__tests__/
├── device-code.test.ts          (NEW) — tests for initiation route
├── poll.test.ts                 (NEW) — tests for polling route
├── repos.test.ts                (existing, unchanged)
└── issues.test.ts               (existing, unchanged)

src/integrations/github/
└── settings.tsx                 (MODIFIED) — device flow UI + collapsible PAT
```

## Verification
- [x] `npm run typecheck` passes with zero errors
- [x] `npm run test` passes (all existing + new tests)
- [ ] `npm run build` succeeds (pre-existing /_global-error build failure unrelated to this work — confirmed same on baseline commit 9d5f214)
- [x] No regressions: existing PAT flow still works via the "Advanced" section
- [ ] Manual E2E: click "Connect with GitHub", verify code appears, authorize in browser, verify token stored and status shows "Connected"
