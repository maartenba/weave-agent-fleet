# Provider Connection/Disconnection UI

## TL;DR
> **Summary**: Add interactive connect/disconnect buttons to the Settings → Providers tab, proxying auth operations through OpenCode's HTTP API via the SDK. Requires a management instance mechanism and new API routes + frontend dialogs.
> **Estimated Effort**: Medium

## Context
### Original Request
Make the Settings Providers tab interactive — users should connect (API key or OAuth) and disconnect providers directly from the UI, rather than using `opencode auth` on the CLI.

### Key Findings

1. **OpenCode's auth API** is well-defined:
   - `PUT /auth/:providerID` with body `{ type: "api", key: "..." }` — set API key credentials
   - `DELETE /auth/:providerID` — remove credentials
   - `POST /provider/:providerID/oauth/authorize` with body `{ method: number }` — returns `{ url, method: "auto"|"code", instructions }`
   - `POST /provider/:providerID/oauth/callback` with body `{ method: number, code?: string }` — completes OAuth
   - `GET /provider/auth` — returns `Record<string, ProviderAuthMethod[]>` where `ProviderAuthMethod = { type: "oauth"|"api", label: string }`

2. **SDK client has all needed methods** (`@opencode-ai/sdk/v2`):
   - `client.auth.set({ providerID, auth: { type: "api", key } })` — set credentials
   - `client.auth.remove({ providerID })` — remove credentials
   - `client.provider.auth()` — get auth methods per provider
   - `client.provider.oauth.authorize({ providerID, method })` — start OAuth
   - `client.provider.oauth.callback({ providerID, method, code })` — complete OAuth
   - Note: `auth` is on the root client (not under `provider`), while `oauth` is under `provider`.

3. **Management instance challenge**: Auth endpoints require a running OpenCode instance. The process manager (`process-manager.ts`) already handles spawning via `spawnInstance(directory)`. We need a way to get **any** running instance's client, or spawn a lightweight one just for auth.

4. **Existing patterns to follow**:
   - API routes: `src/app/api/sessions/route.ts` — NextResponse, try/catch, `_recoveryComplete` guard
   - Dialog component: `src/components/settings/install-skill-dialog.tsx` — Dialog with loading/error/success states
   - Hook: `src/hooks/use-skills.ts` — fetch + mutate pattern with error handling
   - Provider tab: `src/components/settings/providers-tab.tsx` — card grid, uses `useConfig()` hook

5. **Auth.json reading**: `auth-store.ts` reads auth.json synchronously from disk. After a connect/disconnect, calling `fetchConfig()` will re-read auth.json and reflect the change in the UI. No cache invalidation needed.

6. **Note on `plugin: []`**: The management instance config should set `plugin: []` to prevent plugin deadlocks (same as existing instances). The `spawnInstance` already does this.

## Objectives
### Core Objective
Enable users to connect and disconnect AI providers through the Fleet Settings UI.

### Deliverables
- [ ] Management instance helper in process-manager
- [ ] API routes for auth operations (connect, disconnect, auth-methods, OAuth)
- [ ] Frontend hook for provider auth operations
- [ ] Connect provider dialog (API key + OAuth flows)
- [ ] Disconnect provider confirmation dialog
- [ ] Updated providers tab with interactive connect/disconnect buttons

### Definition of Done
- [ ] `npm run build` passes with no errors
- [ ] User can connect a provider via API key from the UI
- [ ] User can disconnect a provider from the UI
- [ ] OAuth flow starts and shows device code URL (full OAuth testing requires a real provider)
- [ ] After connect/disconnect, provider card updates without page refresh
- [ ] Works when no sessions are running (management instance spawned on demand)
- [ ] Works when sessions are already running (reuses existing instance)

### Guardrails (Must NOT)
- Must NOT write to auth.json directly — always proxy through OpenCode's API
- Must NOT spawn a new instance if one is already running — reuse first
- Must NOT leave the management instance orphaned — register it in the same instance map
- Must NOT block the UI — all operations are async with loading states
- Must NOT expose API keys in logs or error messages

## TODOs

### Phase 1: Backend — Management Instance

- [ ] 1. Add `getManagementClient()` to process-manager
  **What**: Add a new exported async function `getManagementClient(): Promise<OpencodeClient>` that:
  1. Iterates `instances` map and returns the `.client` of the first instance with `status === "running"` (any directory works — auth.json is global)
  2. If no running instance exists, calls `spawnInstance()` with a safe directory. Use the first allowed root from `getAllowedRoots()` (which always includes `homedir()` at minimum). This is the "management instance" — it's a real instance that just happens to not be associated with a user session yet.
  3. Returns the client from the instance
  
  Key design: We do NOT need a special "management" instance type. A regular instance spawned on the home directory works fine. If the user later creates a session targeting that same directory, `spawnInstance()` will reuse it. The health check loop already handles cleanup.
  
  **Files**: `src/lib/server/process-manager.ts` (modify — add ~20 lines)
  **Acceptance**: Function exported, returns a valid `OpencodeClient`. Falls back to spawning if no instances running.

### Phase 2: Backend — API Routes

- [ ] 2. Create `GET /api/providers/auth-methods` route
  **What**: New route file that:
  1. Awaits `_recoveryComplete`
  2. Calls `getManagementClient()` to get an SDK client
  3. Calls `client.provider.auth()` to get available auth methods
  4. Returns the result as JSON: `Record<string, { type: "oauth" | "api", label: string }[]>`
  
  Error handling: If management instance fails to spawn, return 503 with `{ error: "No OpenCode instance available" }`.
  
  **Files**: `src/app/api/providers/auth-methods/route.ts` (new)
  **Acceptance**: `GET /api/providers/auth-methods` returns auth methods map when an instance is available.

- [ ] 3. Create `POST /api/providers/[id]/connect` route (API key auth)
  **What**: New route file that:
  1. Awaits `_recoveryComplete`
  2. Validates request body: `{ type: "api", key: string }`
  3. Validates `key` is non-empty (do NOT log the key value)
  4. Calls `getManagementClient()`
  5. Calls `client.auth.set({ providerID: id, auth: { type: "api", key } })`
  6. Returns `{ ok: true }` on success
  
  **Files**: `src/app/api/providers/[id]/connect/route.ts` (new)
  **Acceptance**: POST with valid API key sets credentials. Auth.json is updated by OpenCode.

- [ ] 4. Create `DELETE /api/providers/[id]/connect` route (disconnect)
  **What**: New route file that:
  1. Awaits `_recoveryComplete`
  2. Calls `getManagementClient()`
  3. Calls `client.auth.remove({ providerID: id })`
  4. Returns `{ ok: true }` on success
  
  **Files**: `src/app/api/providers/[id]/connect/route.ts` (same file as POST — add DELETE handler)
  **Acceptance**: DELETE removes credentials. Auth.json is updated by OpenCode.

- [ ] 5. Create `POST /api/providers/[id]/oauth/authorize` route
  **What**: New route file that:
  1. Awaits `_recoveryComplete`
  2. Validates request body: `{ method: number }`
  3. Calls `getManagementClient()`
  4. Calls `client.provider.oauth.authorize({ providerID: id, method })`
  5. Returns the authorization result: `{ url: string, method: "auto" | "code", instructions: string }` or `undefined`
  
  **Files**: `src/app/api/providers/[id]/oauth/authorize/route.ts` (new)
  **Acceptance**: POST returns OAuth authorization URL and instructions.

- [ ] 6. Create `POST /api/providers/[id]/oauth/callback` route
  **What**: New route file that:
  1. Awaits `_recoveryComplete`
  2. Validates request body: `{ method: number, code?: string }`
  3. Calls `getManagementClient()`
  4. Calls `client.provider.oauth.callback({ providerID: id, method, code })`
  5. Returns `{ ok: true }` on success
  
  **Files**: `src/app/api/providers/[id]/oauth/callback/route.ts` (new)
  **Acceptance**: POST completes the OAuth flow. Auth.json is updated by OpenCode.

### Phase 3: Frontend — Hook

- [ ] 7. Create `useProviderAuth` hook
  **What**: New hook providing all provider auth operations:
  ```typescript
  interface AuthMethod { type: "oauth" | "api"; label: string }
  
  function useProviderAuth() {
    const [authMethods, setAuthMethods] = useState<Record<string, AuthMethod[]>>({})
    const [isLoadingMethods, setIsLoadingMethods] = useState(false)
    
    const fetchAuthMethods = async () => { /* GET /api/providers/auth-methods */ }
    const connectWithApiKey = async (providerId: string, apiKey: string) => { /* POST /api/providers/[id]/connect */ }
    const disconnect = async (providerId: string) => { /* DELETE /api/providers/[id]/connect */ }
    const startOAuth = async (providerId: string, method: number) => { /* POST /api/providers/[id]/oauth/authorize */ }
    const completeOAuth = async (providerId: string, method: number, code?: string) => { /* POST /api/providers/[id]/oauth/callback */ }
    
    return { authMethods, isLoadingMethods, fetchAuthMethods, connectWithApiKey, disconnect, startOAuth, completeOAuth }
  }
  ```
  
  Each method: sets loading state, makes fetch call, throws on error (caller handles UI state). Follow the `useSkills` pattern — no internal error state, let consumers catch.
  
  **Files**: `src/hooks/use-provider-auth.ts` (new)
  **Acceptance**: Hook exports all 5 operations. Each makes the correct API call and handles errors.

### Phase 4: Frontend — Dialogs

- [ ] 8. Create `ConnectProviderDialog` component
  **What**: A dialog component following the `InstallSkillDialog` pattern. Props:
  ```typescript
  interface ConnectProviderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    providerId: string
    providerName: string
    onConnected: () => void  // called after successful connect to trigger config refresh
  }
  ```
  
  Behavior:
  1. On open, calls `fetchAuthMethods()` from the hook
  2. Filters methods for the selected `providerId`
  3. **If no methods found**: Show "No auth methods available for this provider" message
  4. **If only API key method(s)**: Show inline API key form (password input + Connect button)
  5. **If OAuth method(s) available**: Show method selection list, then:
     - For API key method: switch to API key input
     - For OAuth method: calls `startOAuth()`, displays the returned `url` as a clickable link, shows `instructions` text, and:
       - If `method === "auto"`: Shows a "Waiting for authorization..." spinner, then polls `completeOAuth()` every 3 seconds (up to 5 minutes) with no code
       - If `method === "code"`: Shows a text input for the user to paste the code, plus a Submit button that calls `completeOAuth()` with the code
  6. On success: calls `onConnected()`, shows success message, auto-closes after 1.5s
  7. On error: shows error message inline (red text with AlertCircle icon)
  
  State machine: `idle` → `loading-methods` → `selecting-method` → `entering-key` | `oauth-waiting` → `success` | `error`
  
  UI components used: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Button`, `Input`, `Loader2`, `AlertCircle`, `CheckCircle2`
  
  **Files**: `src/components/settings/connect-provider-dialog.tsx` (new)
  **Acceptance**: Dialog opens, shows appropriate auth flow, connects provider on success.

- [ ] 9. Create `DisconnectProviderDialog` component
  **What**: A confirmation dialog using `AlertDialog`. Props:
  ```typescript
  interface DisconnectProviderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    providerId: string
    providerName: string
    onDisconnected: () => void  // called after successful disconnect to trigger config refresh
  }
  ```
  
  Behavior:
  1. Shows provider name and warning: "This will remove credentials for {providerName}. Existing sessions using this provider may stop working."
  2. Cancel button closes dialog
  3. Disconnect button calls `disconnect(providerId)` from the hook
  4. Shows loading state on the Disconnect button while in progress
  5. On success: calls `onDisconnected()`, closes dialog
  6. On error: shows error message inline
  
  UI components used: `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel`, `Button`, `Loader2`
  
  **Files**: `src/components/settings/disconnect-provider-dialog.tsx` (new)
  **Acceptance**: Dialog shows confirmation, disconnects provider on confirm.

### Phase 5: Frontend — Updated Providers Tab

- [ ] 10. Add connect/disconnect buttons to provider cards
  **What**: Update `ProvidersTab` to:
  1. Import `ConnectProviderDialog` and `DisconnectProviderDialog`
  2. Add state: `connectDialog: { open: boolean, providerId: string, providerName: string } | null` and `disconnectDialog: { open: boolean, providerId: string, providerName: string } | null`
  3. For **disconnected** provider cards: Add a "Connect" button (small, outline variant) in the card's action area
  4. For **connected** provider cards: Add a "Disconnect" button (small, ghost variant, subtle — e.g. text-muted-foreground) in the card's action area
  5. On connect/disconnect button click: open the appropriate dialog with the provider's id and name
  6. After successful connect/disconnect: call `fetchConfig()` from the `useConfig()` hook to refresh provider status
  7. Remove the "no providers connected" empty state's CLI instruction — replace with a more helpful message now that UI connection is available
  8. Update the empty state to show provider cards with Connect buttons (currently they render but without any action)
  
  Layout change: Each card's bottom row currently shows auth type badge + model count. Add the connect/disconnect button to the right side of this row, or as a new row below.
  
  **Files**: `src/components/settings/providers-tab.tsx` (modify)
  **Acceptance**: Connected providers show Disconnect button. Disconnected providers show Connect button. Buttons open the correct dialog. After action, card status updates.

### Phase 6: Edge Cases & Polish

- [ ] 11. Handle management instance spawn failure gracefully
  **What**: In all API routes, if `getManagementClient()` throws (e.g., all ports exhausted, binary not found), return a clear 503 error:
  ```json
  { "error": "Unable to connect to OpenCode. Make sure the opencode binary is installed and accessible." }
  ```
  The `ConnectProviderDialog` should display this error to the user rather than a generic "fetch failed" message.
  
  **Files**: All route files from Phase 2 (verify error handling), `src/components/settings/connect-provider-dialog.tsx` (verify error display)
  **Acceptance**: Meaningful error shown when OpenCode is unavailable.

- [ ] 12. Handle OAuth polling timeout
  **What**: In `ConnectProviderDialog`, when `method === "auto"`, implement polling with:
  - Poll interval: 3 seconds
  - Max duration: 5 minutes (100 polls)
  - On timeout: show "Authorization timed out. Please try again." error
  - On dialog close during polling: clear the interval (cleanup via `useEffect` return)
  - Use `AbortController` for fetch cleanup on unmount
  
  **Files**: `src/components/settings/connect-provider-dialog.tsx` (included in task 8, called out here for emphasis)
  **Acceptance**: OAuth auto-polling stops on timeout, dialog close, or success.

## File Summary

### New Files (7)
| File | Purpose |
|------|---------|
| `src/app/api/providers/auth-methods/route.ts` | GET auth methods per provider |
| `src/app/api/providers/[id]/connect/route.ts` | POST connect (API key), DELETE disconnect |
| `src/app/api/providers/[id]/oauth/authorize/route.ts` | POST start OAuth flow |
| `src/app/api/providers/[id]/oauth/callback/route.ts` | POST complete OAuth flow |
| `src/hooks/use-provider-auth.ts` | Client-side hook for all auth operations |
| `src/components/settings/connect-provider-dialog.tsx` | Connect dialog (API key + OAuth) |
| `src/components/settings/disconnect-provider-dialog.tsx` | Disconnect confirmation dialog |

### Modified Files (2)
| File | Change |
|------|--------|
| `src/lib/server/process-manager.ts` | Add `getManagementClient()` export |
| `src/components/settings/providers-tab.tsx` | Add connect/disconnect buttons, dialog state |

## Verification
- [ ] `npm run build` completes successfully
- [ ] All existing tests pass (`npm test`)
- [ ] Manual test: open Settings → Providers with no sessions running → Connect a provider via API key → card updates to "Connected"
- [ ] Manual test: Disconnect a connected provider → card updates to "Not Connected"
- [ ] Manual test: Open Settings → Providers with a session already running → Connect works (reuses existing instance)
- [ ] Manual test: Enter invalid/empty API key → appropriate error shown
- [ ] Manual test: Cancel mid-flow → dialog closes cleanly, no orphaned state
- [ ] No API keys appear in server logs or browser console

## Potential Pitfalls

1. **Plugin deadlock on management instance**: The management instance must be spawned with `plugin: []` to prevent the Weave plugin from loading and calling back to Fleet. `spawnInstance()` already does this — using it directly avoids the issue.

2. **Race condition on `getManagementClient()`**: Two concurrent auth operations could both find no running instance and try to spawn. Since `spawnInstance()` is keyed by directory and reuses existing instances for the same directory, the second call will just get the already-spawning/spawned instance. No additional locking needed.

3. **OAuth state is per-instance**: The `ProviderAuth` module in OpenCode stores pending OAuth state in instance memory. If the management instance used for `authorize` dies before `callback`, the callback will fail. The dialog should handle this by showing an error and allowing retry.

4. **Auth methods require plugins**: `GET /provider/auth` returns methods derived from OpenCode's loaded plugins. The management instance spawned with `plugin: []` might return **no auth methods**. This is a critical issue.
   
   **Mitigation**: The management instance config should NOT set `plugin: []` — or at minimum, should not disable auth-related plugins. However, the existing `spawnInstance` always sets `plugin: []`. We have two options:
   - **Option A**: Don't use `spawnInstance` — create a dedicated spawn path for the management instance that omits `plugin: []` from the config. This risks plugin deadlock if the Weave plugin is installed.
   - **Option B**: Skip the `GET /provider/auth` endpoint entirely. Instead, hardcode the auth methods in the Fleet frontend based on the bundled provider registry (e.g., Anthropic → API key, GitHub Copilot → OAuth). This is simpler and avoids the plugin dependency, but is less flexible.
   - **Option C (recommended)**: Use `spawnInstance` with `plugin: []` for all auth operations. The `PUT /auth/:providerID` and `DELETE /auth/:providerID` endpoints don't need plugins — they directly read/write auth.json. For the auth methods endpoint, make a raw HTTP request to `/provider/auth` on the management instance — if it returns empty (because no plugins), fall back to a hardcoded mapping in Fleet. OAuth methods come from plugins, so without plugins, only API key auth will be available via the management instance — which is fine for MVP since OAuth providers (like GitHub Copilot) require the plugin to handle the OAuth flow anyway. Document this limitation.
   
   **Decision for MVP**: Go with Option C. API key auth will work for all providers. OAuth auth will only work if there's already a non-management instance running (one spawned with a real project that loads plugins). The `getManagementClient()` function should prefer returning an existing running instance (which DOES have plugins) over spawning a new one. Since most users will have at least one session running, this covers the common case. Document that OAuth requires at least one active session.

5. **The `directory` param on provider SDK calls**: The SDK methods like `client.provider.auth()` accept an optional `directory` param. Since the management instance may be spawned on a home directory that isn't a project, ensure we pass no directory or the instance's own directory. Looking at the SDK, the directory is passed as a query param/header — the OpenCode server uses it for Instance context. Auth endpoints (`PUT/DELETE /auth/:providerID`) are registered BEFORE the Instance middleware in `server.ts` (lines 133-194 vs the `.use()` at line 195), so they don't need a directory. But `/provider/auth` is under the provider routes which ARE after the Instance middleware, so a directory IS needed. The SDK client was created with a `directory` in `createOpencodeClient({ baseUrl, directory })`, so it will pass that directory automatically. This should work fine.
