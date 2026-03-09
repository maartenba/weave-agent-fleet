# Fleet-Owned Credential Management System

## TL;DR
> **Summary**: Build an encrypted credential store in Fleet's SQLite database with CRUD API routes, session injection, and an interactive providers settings UI — replacing the current read-only providers tab and the dependency on OpenCode's auth.json for credential management.
> **Estimated Effort**: Large

## Context
### Original Request
Build a Fleet-owned credential management system where users configure LLM provider API keys through the Fleet UI. Credentials are stored encrypted in SQLite, injected into agent sessions, and managed via a settings page.

### Key Findings

1. **Database patterns** (`src/lib/server/database.ts`): Schema is created via `CREATE TABLE IF NOT EXISTS` in `getDb()`. Migrations use try/catch `ALTER TABLE` blocks. Tables use `TEXT PRIMARY KEY`, `TEXT NOT NULL DEFAULT (datetime('now'))` for timestamps. All queries are synchronous (better-sqlite3).

2. **Repository patterns** (`src/lib/server/db-repository.ts`): Thin typed wrappers around prepared statements. Row types are `Db*` interfaces, insert types are `Insert*` using `Pick` + `Partial<Pick>`. Functions are exported individually (not a class). `getDb()` is called per-function. Named parameters use `@param` syntax.

3. **API route patterns** (`src/app/api/workspace-roots/route.ts`, `[id]/route.ts`): Next.js 16 route handlers using `NextRequest`/`NextResponse`. Dynamic params via `{ params }: { params: Promise<{ id: string }> }` with `await params`. Try/catch with `NextResponse.json({ error }, { status })`. No auth middleware.

4. **Hook patterns** (`src/hooks/use-skills.ts`): `useState` + `useCallback` + `useEffect`. `apiFetch` from `@/lib/api-client`. Fetch + mutate pattern: fetch functions reload state, mutate functions call fetch after success. Errors thrown to callers.

5. **Dialog patterns** (`src/components/settings/install-skill-dialog.tsx`): `open`/`onOpenChange` props. Local `isLoading`/`error`/`success` state. Shadcn Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter. Lucide icons (Loader2, AlertCircle, CheckCircle2).

6. **Providers tab** (`src/components/settings/providers-tab.tsx`): Currently read-only. Uses `useConfig()` which fetches `GET /api/config` — the config route enriches providers with connection status from `auth-store.ts`. Shows Card grid with Badge for connected/disconnected status.

7. **Process manager** (`src/lib/server/process-manager.ts`): Spawns OpenCode via `spawnOpencodeServer()`. Passes config via `OPENCODE_CONFIG_CONTENT` env var as JSON. Currently passes `{ plugin: [], permission: {...}, ...agentModelConfig }`. This is the injection point for credentials.

8. **Provider registry** (`src/lib/provider-registry.ts`): 9 providers with id, name, and models. IDs: `anthropic`, `openai`, `google`, `amazon-bedrock`, `azure`, `xai`, `mistral`, `groq`, `github-copilot`.

9. **Auth store** (`src/lib/server/auth-store.ts`): Read-only reader of OpenCode's `auth.json`. Returns `ConnectedProvider[]` with `{ id, authType }`. Never throws. This becomes the fallback source.

10. **API types** (`src/lib/api-types.ts`): Shared request/response shapes between API routes and frontend. Types exported from here are imported by both server and client code.

11. **Logger** (`src/lib/server/logger.ts`): `log.info/warn/error(context, message, details?)`. Context is module name string.

12. **Test patterns** (`src/lib/server/__tests__/`): Vitest with `vi.mock`. Tests use `_resetDbForTests()` with `WEAVE_DB_PATH` env var pointed to tmpdir. `createSecureTempDir`/`writeTempFile` helpers in `test-temp-utils.ts`. Test names are PascalCase (e.g., `ReturnsEmptyArrayForNonexistentFile`).

## Objectives
### Core Objective
Enable users to manage LLM provider API keys through the Fleet UI with encrypted storage, and have those credentials automatically injected into spawned agent sessions.

### Deliverables
- [ ] Encrypted credential store (AES-256-GCM) with master key management (platform-aware: POSIX modes on Linux/macOS, icacls on Windows)
- [ ] `credentials` table in SQLite with CRUD repository functions
- [ ] REST API routes for credential CRUD (values masked in responses)
- [ ] Same-origin CSRF protection on credential-mutating endpoints
- [ ] Credential injection into OpenCode sessions via process manager (with FLEET_MASTER_KEY excluded from child env)
- [ ] Updated providers tab with interactive add/edit/delete credential UI
- [ ] Client-side hook for credential operations
- [ ] Backward compatibility: auth.json remains a fallback source
- [ ] Unit tests for credential store, repository, and masking logic

### Definition of Done
- [ ] `npm run build` completes with no errors
- [ ] `npx vitest run` — all tests pass (existing + new)
- [ ] User can add an API key for a provider via Settings → Providers
- [ ] Saved credentials are encrypted in the SQLite database (verify by inspecting raw DB)
- [ ] Credential values are never sent to the browser (API returns masked values only)
- [ ] New sessions receive injected credentials as environment variables
- [ ] Providers connected via OpenCode's auth.json still show as connected (fallback)

### Guardrails (Must NOT)
- Must NOT send decrypted credential values to the browser — API returns masked values only
- Must NOT log credential values — redact in all log output
- Must NOT write to OpenCode's auth.json — Fleet owns its own credential store
- Must NOT break existing auth.json fallback — providers connected via CLI still appear
- Must NOT store the master key in the database — it's external (env var or file)
- Must NOT use `node:crypto`'s deprecated APIs — use `createCipheriv`/`createDecipheriv`
- Must NOT leak `FLEET_MASTER_KEY` to child processes — explicitly exclude from spawned env
- Must NOT accept credential-mutating requests from cross-origin sources — validate `Origin` header

## TODOs

### Phase 1: Encryption & Master Key Management

- [ ] 1. Create credential store module with encryption primitives
  **What**: New module `src/lib/server/credential-store.ts` providing:
  
   **Master key resolution** — `getMasterKey(): Buffer` (cached):
   1. If `FLEET_MASTER_KEY` env var is set, decode it (hex string → 32-byte Buffer)
   2. Else, check platform:
      - **Non-Windows (Linux/macOS)**: read from `~/.weave/master.key` (32 bytes, binary file). If missing, auto-generate 32 random bytes via `crypto.randomBytes(32)`, write to `~/.weave/master.key` with mode `0o600` (owner-only read/write), and log a one-time info message.
      - **Windows**: read from `~/.weave/master.key` if it exists. If missing, auto-generate the key file AND restrict access via `child_process.execSync('icacls "path" /inheritance:r /grant:r "%USERNAME%:R"')` to remove inherited permissions and grant read-only to the current user. If `icacls` fails, log a warning but continue (defense in depth — the user's home directory is typically ACL-protected on Windows). Log a one-time info message about key generation.
   3. Cache the result in a module-level variable (cleared only by `_resetForTests()`)
   4. Throw a clear error if the key is not exactly 32 bytes
  
  **Encryption** — `encryptValue(plaintext: string): string`:
  1. Generate 12-byte random IV via `crypto.randomBytes(12)`
  2. Create cipher: `crypto.createCipheriv('aes-256-gcm', masterKey, iv)`
  3. Encrypt the plaintext (UTF-8 → Buffer)
  4. Get the 16-byte auth tag via `cipher.getAuthTag()`
  5. Return `iv:authTag:ciphertext` as a single hex-encoded string (format: `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`)
  
  **Decryption** — `decryptValue(encrypted: string): string`:
  1. Split on `:` to get iv, authTag, ciphertext hex strings
  2. Convert each to Buffer
  3. Create decipher: `crypto.createDecipheriv('aes-256-gcm', masterKey, iv)`
  4. Set auth tag via `decipher.setAuthTag(authTag)`
  5. Decrypt and return as UTF-8 string
  6. Throw a descriptive error on decryption failure (without leaking the value)
  
  **Masking** — `maskValue(plaintext: string): string`:
  1. If value length ≤ 8: return `••••••••` (all masked)
  2. Else: show first 6 chars + `...` + last 4 chars (e.g., `sk-ant-...7890`)
  3. Used by API routes before sending to browser
  
  **Test helper** — `_resetForTests(): void`: Clears cached master key.
  
  **Files**: `src/lib/server/credential-store.ts` (new)
  **Acceptance**: Unit tests verify encrypt→decrypt roundtrip, masking output, master key generation. `_resetForTests()` clears cached state.

- [ ] 2. Write unit tests for credential store
  **What**: New test file `src/lib/server/__tests__/credential-store.test.ts` covering:
  - `EncryptDecryptRoundTrip` — encrypt a value, decrypt it, verify match
  - `EncryptProducesDifferentCiphertextEachTime` — same plaintext encrypts to different ciphertext (random IV)
  - `DecryptFailsWithTamperedCiphertext` — modify ciphertext, verify decrypt throws
  - `DecryptFailsWithWrongKey` — encrypt with key A, attempt decrypt with key B
  - `MaskValueShowsFirstAndLastChars` — verify masking for various lengths
  - `MaskValueHandlesShortValues` — values ≤ 8 chars fully masked
   - `MasterKeyAutoGeneratesWhenMissing` — with no env var and no file, key is auto-generated and file created
   - `MasterKeyAutoGenerateUsesIcaclsOnWindows` — on Windows (mocked `process.platform`), verify `icacls` is called after key file creation
   - `MasterKeyReadsFromEnvVar` — set `FLEET_MASTER_KEY`, verify it's used
  - `MasterKeyReadsFromFile` — write a key file, verify it's read
  - `MasterKeyRejectsInvalidLength` — env var with wrong length throws
  
  Setup: Mock `FLEET_MASTER_KEY` env var. Use `createSecureTempDir` for key file tests. Call `_resetForTests()` in `afterEach`.
  
  **Files**: `src/lib/server/__tests__/credential-store.test.ts` (new)
  **Acceptance**: All tests pass. Tests are isolated (no cross-test state leakage).

### Phase 2: Database Schema & Repository

- [ ] 3. Add `credentials` table to database schema
  **What**: Add the `credentials` table creation to the `getDb()` function in `database.ts`, inside the existing `db.exec()` block:
  
  ```sql
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'default',
    encrypted_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_provider_label
    ON credentials(provider_id, label);
  ```
  
  Design notes:
  - `provider_id` matches registry IDs (e.g., `anthropic`, `openai`)
  - `label` allows multiple credentials per provider in the future (default: `'default'`)
  - `encrypted_value` stores the output of `encryptValue()` — hex-encoded `iv:authTag:ciphertext`
  - Unique index on `(provider_id, label)` enforces one credential per provider+label pair
  - No foreign key to a providers table — provider IDs are validated against the registry in the API layer
  
  **Files**: `src/lib/server/database.ts` (modify — add ~10 lines to the `db.exec()` block)
  **Acceptance**: Table created on first `getDb()` call. Existing tables unaffected.

- [ ] 4. Add credential CRUD functions to db-repository
  **What**: Add a new section `// ─── Credentials ──────────────────────────────────────────────────────────────` to `db-repository.ts` following existing patterns:
  
  **Row type**:
  ```typescript
  export interface DbCredential {
    id: string;
    provider_id: string;
    label: string;
    encrypted_value: string;
    created_at: string;
    updated_at: string;
  }
  ```
  
  **Insert type**:
  ```typescript
  export type InsertCredential = Pick<DbCredential, "id" | "provider_id" | "encrypted_value"> &
    Partial<Pick<DbCredential, "label">>;
  ```
  
  **Functions** (all synchronous, following existing patterns):
  - `insertCredential(cred: InsertCredential): void` — INSERT with named params
  - `getCredential(id: string): DbCredential | undefined` — SELECT by id
  - `getCredentialByProvider(providerId: string, label?: string): DbCredential | undefined` — SELECT by provider_id + label (default: `'default'`)
  - `listCredentials(): DbCredential[]` — SELECT all, ORDER BY created_at DESC
  - `updateCredentialValue(id: string, encryptedValue: string): void` — UPDATE encrypted_value and updated_at (`datetime('now')`)
  - `deleteCredential(id: string): boolean` — DELETE, return `result.changes > 0`
  
  **Files**: `src/lib/server/db-repository.ts` (modify — add ~60 lines)
  **Acceptance**: All CRUD operations work. Unique index prevents duplicate provider+label.

- [ ] 5. Write unit tests for credential repository
  **What**: Add credential tests to `src/lib/server/__tests__/db-repository.test.ts` (or create a new file `credential-repository.test.ts` — follow existing pattern of the single `db-repository.test.ts` file). New test section:
  
  - `InsertAndGetCredential` — insert, get by id, verify fields
  - `GetCredentialByProvider` — insert, get by provider_id
  - `GetCredentialByProviderWithLabel` — insert with custom label, get by provider_id + label
  - `ListCredentials` — insert multiple, list all, verify order (newest first)
  - `UpdateCredentialValue` — insert, update, verify new value and updated_at changed
  - `DeleteCredential` — insert, delete, verify gone. Returns true. Deleting nonexistent returns false
  - `UniqueConstraintOnProviderAndLabel` — insert two with same provider_id+label, verify second throws
  - `DifferentLabelsForSameProvider` — insert two with same provider_id but different labels, both succeed
  
  **Files**: `src/lib/server/__tests__/db-repository.test.ts` (modify — add ~80 lines at the end)
  **Acceptance**: All tests pass. Tests use `_resetDbForTests()` in beforeEach/afterEach.

### Phase 3: API Types

- [ ] 6. Add credential API types to api-types.ts
  **What**: Add a new section `// ─── Credentials ──────────────────────────────────────────────────────────────` to `src/lib/api-types.ts`:
  
  ```typescript
  /** A credential as returned by the API (value is always masked) */
  export interface CredentialItem {
    id: string;
    providerId: string;
    label: string;
    maskedValue: string;
    createdAt: string;
    updatedAt: string;
  }
  
  /** Response shape for GET /api/credentials */
  export interface CredentialsListResponse {
    credentials: CredentialItem[];
  }
  
  /** Request body for POST /api/credentials */
  export interface CreateCredentialRequest {
    providerId: string;
    value: string;
    label?: string;
  }
  
  /** Response shape for POST /api/credentials */
  export interface CreateCredentialResponse {
    credential: CredentialItem;
  }
  
  /** Request body for PUT /api/credentials/:id */
  export interface UpdateCredentialRequest {
    value: string;
  }
  
  /** Response shape for PUT /api/credentials/:id */
  export interface UpdateCredentialResponse {
    credential: CredentialItem;
  }
  ```
  
  Note: `value` in request types is the plaintext API key. `maskedValue` in response types is the masked version. The plaintext is NEVER in a response type.
  
  **Files**: `src/lib/api-types.ts` (modify — add ~35 lines)
  **Acceptance**: Types importable from both server and client code.

### Phase 4: API Security & Routes

- [ ] 7. Add same-origin validation middleware for credential-mutating endpoints
  **What**: Create a reusable origin validation helper `src/lib/server/api-security.ts` that protects state-changing API routes from cross-origin requests (CSRF protection).
  
  **Implementation**:
  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  
  /**
   * Validates that a mutating request (POST/PUT/DELETE) originates from the
   * same origin as the Fleet server. This prevents cross-site request forgery
   * where a malicious page makes authenticated requests to localhost.
   *
   * Checks the Origin header (set by browsers on all non-GET requests).
   * If Origin is absent (non-browser clients like curl), the request is allowed —
   * CLI/SDK callers are trusted.
   */
  export function validateSameOrigin(req: NextRequest): NextResponse | null {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return null; // Safe methods are allowed
    }
    
    const origin = req.headers.get("origin");
    if (!origin) {
      return null; // Non-browser client (curl, SDK) — allow
    }
    
    const requestUrl = new URL(req.url);
    const expectedOrigin = `${requestUrl.protocol}//${requestUrl.host}`;
    
    if (origin !== expectedOrigin) {
      return NextResponse.json(
        { error: "Cross-origin requests are not allowed" },
        { status: 403 }
      );
    }
    
    return null; // Same origin — allow
  }
  ```
  
  **Usage**: Each credential-mutating route handler (POST, PUT, DELETE) calls `validateSameOrigin(req)` at the top. If it returns a `NextResponse`, return that immediately (403). This is a simple pattern — no middleware registration needed.
  
  **Design notes**:
  - This protects against CSRF from malicious websites making requests to `localhost:3000`
  - Non-browser clients (curl, SDKs) don't send `Origin` headers and are allowed through — they are trusted (no cookie-based auth to steal)
  - GET requests are always allowed (read-only, credentials are masked in responses)
  - Future enhancement: when Fleet adds API authentication (bearer tokens), this becomes defense-in-depth rather than the primary protection
  
  **Files**: `src/lib/server/api-security.ts` (new)
  **Acceptance**: POST/PUT/DELETE from cross-origin get 403. Same-origin requests succeed. Requests without Origin header (non-browser) succeed.

- [ ] 8. Create `GET /api/credentials` and `POST /api/credentials` routes
  **What**: New route file `src/app/api/credentials/route.ts`:
  
  **GET handler**:
  1. Call `listCredentials()` from db-repository
  2. For each credential, decrypt the value via `decryptValue()`, then mask via `maskValue()`
  3. Map to `CredentialItem[]` (camelCase field names, masked value)
  4. Return `{ credentials }` as JSON
  5. On decryption error for a credential: log warning, return `maskedValue: "••••••••"` (don't fail the whole list)
  
  **POST handler**:
  1. **Call `validateSameOrigin(req)` — return 403 if cross-origin**
  2. Parse request body as `CreateCredentialRequest`
  3. Validate: `providerId` is non-empty string, `value` is non-empty string
  4. Validate: `providerId` exists in `BUNDLED_PROVIDERS` from provider-registry
  5. Encrypt the value via `encryptValue(value)`
  6. Generate UUID for id
  7. Call `insertCredential({ id, provider_id: providerId, encrypted_value, label })`
  8. Handle unique constraint violation: if a credential already exists for this provider+label, return 409 with `{ error: "Credential already exists for this provider. Use PUT to update." }`
  9. Decrypt + mask the stored value for the response
  10. Return `{ credential: CredentialItem }` with status 201
  11. IMPORTANT: Never log the `value` field from the request body
  
  **Files**: `src/app/api/credentials/route.ts` (new)
  **Acceptance**: GET returns masked credentials. POST creates encrypted credential. POST from cross-origin returns 403. Invalid provider returns 400. Duplicate returns 409.

- [ ] 9. Create `PUT /api/credentials/:id` and `DELETE /api/credentials/:id` routes
  **What**: New route file `src/app/api/credentials/[id]/route.ts`:
  
  **PUT handler**:
  1. **Call `validateSameOrigin(req)` — return 403 if cross-origin**
  2. Extract `id` from `await params`
  3. Parse request body as `UpdateCredentialRequest`
  4. Validate: `value` is non-empty string
  5. Verify credential exists via `getCredential(id)` — return 404 if not found
  6. Encrypt the new value via `encryptValue(value)`
  7. Call `updateCredentialValue(id, encryptedValue)`
  8. Fetch updated credential, decrypt + mask for response
  9. Return `{ credential: CredentialItem }` with status 200
  10. IMPORTANT: Never log the `value` field
  
  **DELETE handler**:
  1. **Call `validateSameOrigin(req)` — return 403 if cross-origin**
  2. Extract `id` from `await params`
  3. Call `deleteCredential(id)` — return 404 if not found (returns false)
  4. Return `{ ok: true }` with status 200
  
  **Files**: `src/app/api/credentials/[id]/route.ts` (new)
  **Acceptance**: PUT updates encrypted value. PUT/DELETE from cross-origin return 403. DELETE removes credential. Both return 404 for missing id.

### Phase 5: Credential Injection into Sessions

- [ ] 10. Inject stored credentials into spawned OpenCode instances
  **What**: Modify `spawnInstance()` in `process-manager.ts` to inject Fleet-stored credentials as environment variables into the child process. 
  
  **Implementation**:
  1. Create a new helper function `getCredentialEnvVars(): Record<string, string>` in `credential-store.ts` that:
     - Calls `listCredentials()` from db-repository
     - For each credential, decrypts the value
     - Maps provider IDs to their canonical env var names using a `PROVIDER_ENV_VAR_MAP`:
       ```typescript
       const PROVIDER_ENV_VAR_MAP: Record<string, string> = {
         "anthropic": "ANTHROPIC_API_KEY",
         "openai": "OPENAI_API_KEY",
         "google": "GOOGLE_API_KEY",  
         "amazon-bedrock": "AWS_ACCESS_KEY_ID",  // Note: Bedrock uses AWS creds
         "azure": "AZURE_OPENAI_API_KEY",
         "xai": "XAI_API_KEY",
         "mistral": "MISTRAL_API_KEY",
         "groq": "GROQ_API_KEY",
         "github-copilot": "GITHUB_TOKEN",
       };
       ```
     - Returns `Record<string, string>` of env var name → decrypted value
     - On any decryption error, logs warning and skips that credential (never throws)
  
   2. In `spawnOpencodeServer()` (or in `spawnInstance()` before calling it), merge credential env vars into the child process environment, **excluding security-sensitive Fleet variables**:
      ```typescript
      const credentialEnvVars = getCredentialEnvVars();
      // Exclude Fleet's master key from child process env — children must NOT
      // have access to the encryption key that protects the credential store.
      const { FLEET_MASTER_KEY, ...safeParentEnv } = process.env;
      const proc = spawn(command, args, {
        env: {
          ...safeParentEnv,
          ...credentialEnvVars,  // Fleet credentials override process.env
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        },
      });
      ```
   
   3. **Security invariant**: The `FLEET_MASTER_KEY` environment variable must NEVER be passed to child processes. This is enforced by destructuring it out of `process.env` before spreading. Add a code comment explaining why.
  
  3. The env var injection means OpenCode will pick up the credentials naturally — no SDK calls needed for local processes.
  
  **Design notes**:
  - Credentials are injected at spawn time. If a user adds/changes a credential, existing sessions won't pick it up until restarted. This is acceptable for MVP.
  - Fleet credentials override any ambient env vars (e.g., if `ANTHROPIC_API_KEY` is already set in the host environment, Fleet's stored credential takes precedence). This is intentional — Fleet is the source of truth.
  - Amazon Bedrock may need multiple env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`). For MVP, store the primary key. Document the limitation for multi-value credentials.
  
  **Files**: 
  - `src/lib/server/credential-store.ts` (modify — add `getCredentialEnvVars()` and `PROVIDER_ENV_VAR_MAP`)
  - `src/lib/server/process-manager.ts` (modify — add ~5 lines to `spawnInstance()`)
  **Acceptance**: New sessions spawned after adding a credential receive the API key as an env var. Verified by checking the spawned process environment or by testing that the session can use the provider.

### Phase 6: Update Config API for Merged Provider Status

- [ ] 11. Merge Fleet credentials into provider status in GET /api/config
  **What**: Update the `GET /api/config` handler in `src/app/api/config/route.ts` to also check Fleet's credential store when determining provider connection status.
  
  Current logic: Only checks `getConnectedProviders()` (auth.json).
  
  New logic:
  1. Get auth.json providers via `getConnectedProviders()` (existing)
  2. Get Fleet credentials via `listCredentials()` from db-repository
  3. For each bundled provider, mark as connected if:
     - It exists in auth.json (fallback), OR
     - It has a credential in Fleet's store
  4. Add a `source` field to the provider status to indicate where the connection comes from: `"fleet"`, `"opencode"`, or `null`
  5. If a provider has a Fleet credential, include the `maskedValue` in the response (decrypt + mask)
  6. If a provider is only connected via auth.json, `maskedValue` is null (we can't read the actual key from auth.json — we just know it exists)
  
  This requires updating the `ProviderStatus` type in `use-config.ts` and the config API response. Add these fields to the provider status object:
  ```typescript
  credentialSource: "fleet" | "opencode" | null;
  credentialId: string | null;       // Fleet credential DB id (for edit/delete)
  maskedValue: string | null;        // Masked credential value (Fleet only)
  ```
  
  **Files**:
  - `src/app/api/config/route.ts` (modify — add ~20 lines to the GET handler)
  - `src/hooks/use-config.ts` (modify — update `ProviderStatus` interface with new fields)
  **Acceptance**: GET /api/config returns merged provider status. Fleet credentials show `source: "fleet"` with masked value. Auth.json providers show `source: "opencode"`.

### Phase 7: Frontend — Credential Hook

- [ ] 12. Create `useCredentials` hook
  **What**: New hook `src/hooks/use-credentials.ts` providing credential CRUD operations:
  
  ```typescript
  import { useState, useCallback } from "react";
  import { apiFetch } from "@/lib/api-client";
  import type { CredentialItem } from "@/lib/api-types";
  
  export function useCredentials() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const createCredential = useCallback(async (
      providerId: string, 
      value: string, 
      label?: string
    ): Promise<CredentialItem> => {
      // POST /api/credentials
      // Sets isSubmitting, clears error, throws on failure
    }, []);
    
    const updateCredential = useCallback(async (
      id: string, 
      value: string
    ): Promise<CredentialItem> => {
      // PUT /api/credentials/{id}
    }, []);
    
    const deleteCredential = useCallback(async (
      id: string
    ): Promise<void> => {
      // DELETE /api/credentials/{id}
    }, []);
    
    return { isSubmitting, error, createCredential, updateCredential, deleteCredential };
  }
  ```
  
  Pattern follows `useSkills` — each mutation sets `isSubmitting`, clears `error`, makes the fetch call, and throws on failure so the caller can handle UI state. The caller (ProvidersTab) calls `fetchConfig()` after a successful mutation to refresh provider status.
  
  **Files**: `src/hooks/use-credentials.ts` (new)
  **Acceptance**: Hook exports create/update/delete operations. Each makes correct API call.

### Phase 8: Frontend — Credential Dialog

- [ ] 13. Create `CredentialDialog` component
  **What**: New dialog component `src/components/settings/credential-dialog.tsx` for adding/editing API keys. Follows `InstallSkillDialog` patterns.
  
  **Props**:
  ```typescript
  interface CredentialDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    providerId: string;
    providerName: string;
    /** If set, we're editing an existing credential */
    existingCredentialId?: string;
    existingMaskedValue?: string;
    /** Called after successful create/update to refresh provider list */
    onSaved: () => void;
  }
  ```
  
  **Behavior**:
  1. Title: "Add API Key" (create) or "Update API Key" (edit)
  2. Subtitle: provider name
  3. Input field: `type="password"` with placeholder "Paste your API key". Auto-focused.
  4. If editing: show current masked value below the input as reference text
  5. Save button: calls `createCredential` (if no `existingCredentialId`) or `updateCredential` (if editing)
  6. On success: show green CheckCircle2 message, call `onSaved()`, auto-close after 1.5s
  7. On error (409 for duplicate): show "A credential already exists for this provider. Edit the existing one instead."
  8. On error (other): show error message with AlertCircle
  9. Cancel button: closes dialog, resets state
  10. On close: clear input value from local state (security — don't persist in React state)
  
  **UI components**: Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Loader2, AlertCircle, CheckCircle2
  
  **Files**: `src/components/settings/credential-dialog.tsx` (new)
  **Acceptance**: Dialog opens, accepts API key input, creates/updates credential, shows feedback.

- [ ] 14. Create `DeleteCredentialDialog` component
  **What**: Confirmation dialog using AlertDialog for deleting a credential.
  
  **Props**:
  ```typescript
  interface DeleteCredentialDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    credentialId: string;
    providerName: string;
    onDeleted: () => void;
  }
  ```
  
  **Behavior**:
  1. Warning text: "This will remove the stored API key for {providerName}. New sessions will not have access to this provider. Existing sessions are unaffected."
  2. Cancel + Delete buttons with loading state on Delete
  3. On success: call `onDeleted()`, close dialog
  4. On error: show error inline
  
  **UI components**: AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel, Button, Loader2
  
  **Files**: `src/components/settings/delete-credential-dialog.tsx` (new)
  **Acceptance**: Dialog shows confirmation, deletes credential, refreshes list.

### Phase 9: Frontend — Updated Providers Tab

- [ ] 15. Rewrite providers tab for interactive credential management
  **What**: Transform `src/components/settings/providers-tab.tsx` from read-only display to interactive credential management. The component structure:
  
  **State additions**:
  ```typescript
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean;
    providerId: string;
    providerName: string;
    credentialId?: string;
    maskedValue?: string;
  } | null>(null);
  
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    credentialId: string;
    providerName: string;
  } | null>(null);
  ```
  
  **Card layout changes for each provider**:
  
  *Connected via Fleet credential*:
  - Green "Connected" badge (existing)
  - New: "Fleet" source badge (small, subtle)
  - New: masked value text (e.g., `sk-ant-...7890`) in monospace, muted
  - New: "Edit" button (Pencil icon, ghost variant) — opens CredentialDialog in edit mode
  - New: "Remove" button (Trash2 icon, ghost variant, destructive hover) — opens DeleteCredentialDialog
  
  *Connected via auth.json only*:
  - Green "Connected" badge (existing)
  - New: "OpenCode" source badge (small, subtle)
  - Auth type badge (existing)
  - No edit/remove buttons (can't manage OpenCode's auth.json from Fleet)
  - New: small helper text: "Managed by OpenCode CLI"
  
  *Not connected*:
  - "Not Connected" badge (existing, keep greyed-out style)
  - New: "Add API Key" button (outline variant) — opens CredentialDialog in create mode
  
  **Empty state update**: Remove the CLI command instruction. Replace with:
  - "No providers connected. Add an API key to get started."
  - Show provider cards with "Add API Key" buttons (currently shown but non-interactive)
  
  **After dialog success**: Call `fetchConfig()` to refresh all provider status.
  
  **Imports to add**: `CredentialDialog`, `DeleteCredentialDialog`, `useCredentials`, Lucide icons (`Pencil`, `Trash2`, `Key`)
  
  **Files**: `src/components/settings/providers-tab.tsx` (modify — significant rewrite, ~150-200 lines)
  **Acceptance**: Each provider shows correct state. Add/Edit/Remove buttons work. Dialogs open with correct props. Status refreshes after mutations.

### Phase 10: Provider Env Var Mapping Enhancement

- [ ] 16. Add env var name display to provider registry
  **What**: Extend the provider registry to include the expected environment variable name for each provider. This serves two purposes:
  1. The UI can show users which env var their key will be injected as
  2. The credential store's `PROVIDER_ENV_VAR_MAP` stays DRY with the registry
  
  Add an `envVar` field to `BundledProvider`:
  ```typescript
  export interface BundledProvider {
    id: string;
    name: string;
    envVar: string;          // e.g., "ANTHROPIC_API_KEY"
    models: ProviderModelInfo[];
  }
  ```
  
  Update each entry in `BUNDLED_PROVIDERS` with the correct env var name. Update `PROVIDER_ENV_VAR_MAP` in credential-store.ts to read from the registry instead of maintaining a separate mapping.
  
  In the providers tab, show a small helper text under the API key input: "Will be injected as `ANTHROPIC_API_KEY`" — so users know what's happening.
  
  **Files**:
  - `src/lib/provider-registry.ts` (modify — add `envVar` field to interface and all entries)
  - `src/lib/server/credential-store.ts` (modify — use registry instead of hardcoded map)
  - `src/components/settings/credential-dialog.tsx` (modify — show env var name hint)
  **Acceptance**: Each provider has an `envVar` field. Credential store uses registry. Dialog shows env var hint.

### Phase 11: Integration Test

- [ ] 17. Write integration test for credential flow
  **What**: New test file `src/lib/server/__tests__/credential-integration.test.ts` testing the full encrypt → store → retrieve → mask → inject flow:
  
  1. Set up temp DB via `WEAVE_DB_PATH`
  2. Set `FLEET_MASTER_KEY` env var to a known test key
  3. Encrypt a test API key via `encryptValue()`
  4. Store via `insertCredential()`
  5. Retrieve via `getCredentialByProvider()`
  6. Decrypt via `decryptValue()` — verify matches original
  7. Mask via `maskValue()` — verify correct masked format
  8. Call `getCredentialEnvVars()` — verify correct env var mapping
  9. Verify the raw `encrypted_value` in DB is NOT the plaintext
  10. Verify `listCredentials()` returns all stored credentials
  
  **Files**: `src/lib/server/__tests__/credential-integration.test.ts` (new)
  **Acceptance**: Full flow test passes. Encrypted value in DB differs from plaintext.

## File Summary

### New Files (8)
| File | Purpose |
|------|---------|
| `src/lib/server/credential-store.ts` | Encryption/decryption, master key, masking, env var mapping |
| `src/lib/server/api-security.ts` | Same-origin validation for mutating API routes |
| `src/lib/server/__tests__/credential-store.test.ts` | Unit tests for encryption primitives |
| `src/lib/server/__tests__/credential-integration.test.ts` | Integration test for full credential flow |
| `src/app/api/credentials/route.ts` | GET (list) and POST (create) credential routes |
| `src/app/api/credentials/[id]/route.ts` | PUT (update) and DELETE credential routes |
| `src/hooks/use-credentials.ts` | Client-side hook for credential CRUD |
| `src/components/settings/credential-dialog.tsx` | Add/edit API key dialog |
| `src/components/settings/delete-credential-dialog.tsx` | Delete credential confirmation dialog |

### Modified Files (6)
| File | Change |
|------|--------|
| `src/lib/server/database.ts` | Add `credentials` table schema |
| `src/lib/server/db-repository.ts` | Add credential CRUD functions |
| `src/lib/server/__tests__/db-repository.test.ts` | Add credential repository tests |
| `src/lib/api-types.ts` | Add credential API types |
| `src/lib/provider-registry.ts` | Add `envVar` field to providers |
| `src/app/api/config/route.ts` | Merge Fleet credentials into provider status |
| `src/hooks/use-config.ts` | Update ProviderStatus interface |
| `src/lib/server/process-manager.ts` | Inject credential env vars on spawn |
| `src/components/settings/providers-tab.tsx` | Interactive credential management UI |

## Verification
- [ ] `npm run build` completes with no errors
- [ ] `npx vitest run` — all tests pass (existing + new)
- [ ] Manual: Settings → Providers → Add API Key for Anthropic → key stored encrypted in DB
- [ ] Manual: Provider card updates to show "Connected" with masked value
- [ ] Manual: Edit credential → new value encrypted, old value replaced
- [ ] Manual: Delete credential → provider shows "Not Connected"
- [ ] Manual: Start a new session → `ANTHROPIC_API_KEY` env var present in child process
- [ ] Manual: Connect a provider via OpenCode CLI → still shows as connected in Fleet (fallback)
- [ ] Security: Inspect `~/.weave/fleet.db` — `encrypted_value` column contains hex-encoded ciphertext, not plaintext
- [ ] Security: Browser DevTools → Network → GET /api/config — no plaintext API keys in response
- [ ] Security: Server logs — no API key values logged
- [ ] Security: `FLEET_MASTER_KEY` does NOT appear in child process environment variables
- [ ] Security: Cross-origin POST/PUT/DELETE to `/api/credentials` returns 403

## Potential Pitfalls

1. **Master key loss = credential loss**: If `~/.weave/master.key` is deleted or `FLEET_MASTER_KEY` changes, all stored credentials become undecryptable. The GET /api/credentials handler must handle decryption failures gracefully (return masked placeholder, log warning) rather than crashing. Document this in code comments.

2. **Windows file permissions**: `fs.writeFileSync` with `mode: 0o600` is a no-op on Windows (NTFS uses ACLs, not POSIX modes). The master key generation code uses `icacls` on Windows to strip inherited permissions and restrict access to the current user only. If `icacls` fails, a warning is logged — the user's home directory is typically ACL-protected as a fallback. See Task 1 for implementation details.

3. **Concurrent credential updates**: Two simultaneous PUT requests for the same credential ID could race. Since better-sqlite3 is synchronous and SQLite uses file-level locking with `busy_timeout`, this is safe — the second write simply overwrites the first. No additional locking needed.

4. **Hot Module Reload in dev**: The `credential-store.ts` module caches the master key in a module-level variable. HMR may create new module instances with separate caches. Use `globalThis` pattern (like `process-manager.ts`) to share the cached key across Turbopack re-evaluations.

5. **Multi-value provider credentials (Bedrock/Azure)**: Amazon Bedrock requires `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_SESSION_TOKEN`). Azure may need endpoint URL + API key. For MVP, the single-value model only covers the primary key. Document this limitation. The `label` field in the credentials table provides a future extension point for storing multiple values per provider.

6. **Credential injection timing**: Credentials are injected at `spawnInstance()` time. If a user adds a credential while sessions are running, those sessions won't pick it up. This is documented and acceptable — the user would need to restart sessions. A future enhancement could push credentials to running instances via the OpenCode SDK's `auth.set()` method.

7. **Provider ID validation**: The POST /api/credentials route validates `providerId` against `BUNDLED_PROVIDERS`. If a new provider is added to OpenCode but not to Fleet's registry, users can't store credentials for it through the UI. This is acceptable — the registry is updated as part of Fleet releases.
