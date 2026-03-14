# Provider Configuration via Fleet — Findings

> Date: 2026-03-13
> Status: Research
> Scope: How model providers are configured in OpenCode, what APIs exist, and what Fleet needs to do to enable provider management

---

## The Problem

Fleet + OpenCode is useless without a connected model provider. Today, configuring a provider requires either:
1. Setting environment variables on the machine running Fleet (e.g. `ANTHROPIC_API_KEY=sk-...`)
2. Running `opencode auth <provider>` manually from a terminal on that machine

Neither works in a remote Fleet Server scenario. A Fleet Client connecting from a laptop has no way to configure providers on the server. This is a **blocking prerequisite** for the remote client-server architecture.

---

## What OpenCode Provides (the hooks we can use)

OpenCode has a comprehensive provider management system with full API coverage. Fleet is barely using it.

### Provider API Endpoints (on each OpenCode instance)

| Method | Path | What it does |
|---|---|---|
| `GET` | `/provider` | Lists all providers with `connected[]` status, models, defaults |
| `GET` | `/provider/auth` | Returns available auth methods per provider (API key, OAuth, etc.) |
| `POST` | `/provider/:id/oauth/authorize` | Starts OAuth flow, returns auth URL |
| `POST` | `/provider/:id/oauth/callback` | Completes OAuth flow |
| `PUT` | `/auth/:providerID` | **Sets credentials directly** (API key, OAuth tokens, etc.) |
| `DELETE` | `/auth/:providerID` | Removes stored credentials |
| `GET` | `/config` | Returns full merged config (includes provider settings) |
| `PATCH` | `/config` | Updates project config (can set `model`, `provider`, etc.) |
| `GET` | `/config/providers` | Returns only connected providers with models |
| `GET` | `/global/config` | Returns global config |
| `PATCH` | `/global/config` | Updates global config |

### SDK v2 Client Methods (what Fleet already has access to)

```typescript
// Fleet already creates these clients for each OpenCode instance:
const client = createOpencodeClient({ baseUrl: server.url, directory });

// Provider operations — ALL available, NONE used by Fleet today:
client.provider.list()                              // → all providers + connected status
client.provider.auth()                              // → auth methods per provider
client.provider.oauthAuthorize({ providerID, method }) // → start OAuth
client.provider.oauthCallback({ providerID, method })  // → complete OAuth
client.auth.set({ providerID, auth })               // → store API key / credentials
client.auth.remove({ providerID })                  // → remove credentials
client.config.get()                                 // → full config
client.config.update({ config })                    // → update project config
client.config.providers()                           // → connected providers only
client.global.config.get()                          // → global config
client.global.config.update({ config })             // → update global config
```

### Credential Storage in OpenCode

- **Location:** `~/.local/share/opencode/auth.json` (permissions `0o600`)
- **Format:** JSON map of `providerID → AuthInfo`
- **Auth types:**
  - `{ type: "api", key: "sk-..." }` — direct API key
  - `{ type: "oauth", refresh: "...", access: "...", expires: 1234 }` — OAuth tokens
  - `{ type: "wellknown", key: "...", token: "..." }` — org-managed

### Provider Discovery Flow (inside OpenCode)

1. Load models database from `https://models.dev/api.json` (cached locally)
2. Merge provider config from config files
3. Check env vars — if a provider's `env` array has a matching var, provider is `source: "env"`
4. Check auth store (`Auth.all()`) — providers with stored keys get `source: "api"`
5. Check plugins (e.g., GitHub Copilot uses plugin-based OAuth)
6. Run custom loaders (e.g., Amazon Bedrock auto-detects AWS credentials)
7. Merge config overrides
8. Filter by `disabled_providers` / `enabled_providers`
9. Return `{ all: Provider[], connected: string[], default: Record<string, string> }`

### Config Precedence (lowest → highest)

1. Remote `.well-known/opencode` (org defaults)
2. Global config: `~/.config/opencode/opencode.json`
3. `OPENCODE_CONFIG` env var path
4. Project config: `opencode.json` in project root
5. `.opencode` directories
6. **`OPENCODE_CONFIG_CONTENT` env var** (inline JSON — what Fleet uses today)
7. Managed config dir (enterprise)

### Config Schema — Provider-Relevant Fields

```typescript
{
  provider: Record<string, {
    api: string,
    name: string,
    env: string[],
    npm: string,
    models: Record<string, ModelOverrides>,
    whitelist: string[],
    blacklist: string[],
    options: {
      apiKey: string,
      baseURL: string,
      enterpriseUrl: string,
      timeout: number,
    }
  }>,
  model: string,               // "provider/model" format, e.g. "anthropic/claude-sonnet-4-5"
  small_model: string,         // for lightweight tasks
  disabled_providers: string[],
  enabled_providers: string[],  // allowlist-only mode
  agent: Record<string, {
    model: string,              // per-agent model override
  }>,
}
```

### Provider Env Vars (checked by OpenCode for auto-connect)

| Provider | Env Vars |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| xAI | `XAI_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Groq | `GROQ_API_KEY` |
| DeepInfra | `DEEPINFRA_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| Cohere | `COHERE_API_KEY` |
| Together AI | `TOGETHER_AI_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Amazon Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_REGION`, `AWS_PROFILE`, etc. |
| Azure | `AZURE_API_KEY`, `AZURE_COGNITIVE_SERVICES_RESOURCE_NAME` |
| Google Vertex | `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, etc. |
| GitLab | `GITLAB_TOKEN`, `GITLAB_INSTANCE_URL` |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, etc. |
| GitHub Copilot | Plugin-based OAuth (no env var) |

---

## Critical Discovery: The Full 97-Provider Catalog

`client.provider.list()` returns **every provider in OpenCode's models.dev database** — not just connected ones. As of this writing, that's **97 providers** including Anthropic, OpenAI, Google, xAI, Mistral, Groq, DeepInfra, Together AI, Perplexity, OpenRouter, Cohere, Cerebras, Fireworks, and dozens more.

Each provider entry includes:
```typescript
{
  id: string,           // e.g. "anthropic", "openai", "together-ai"
  name: string,         // e.g. "Anthropic", "OpenAI", "Together AI"
  env: string[],        // e.g. ["ANTHROPIC_API_KEY"] — which env vars auto-connect
  models: Model[],      // full model catalog for this provider
  source?: string,      // "env" | "api" | undefined (how it's connected, if at all)
}
```

### The Auth Methods Gap

`client.provider.auth()` only returns auth methods for **4 plugin-based providers**:
- `anthropic` — API key
- `openai` — API key
- `github-copilot` — OAuth
- `gitlab` — API key

**The other 93+ providers are NOT listed in `provider.auth()`.** But this does NOT mean they can't be authenticated — `client.auth.set()` works for ANY provider:

```typescript
// This works for ANY of the 97 providers, even those not in provider.auth()
client.auth.set({
  providerID: "together-ai",
  auth: { type: "api", key: "sk-..." }
})
```

### Implication for Fleet

Fleet does **not** need to hardcode a provider list. The dynamic catalog from `provider.list()` replaces the stale `provider-registry.ts` entirely. For providers not in `provider.auth()`:
- If the provider has an `env` array → it accepts API keys (use `auth.set()` with `type: "api"`)
- The `env` field tells Fleet which environment variable name to show as a hint (e.g., "ANTHROPIC_API_KEY")
- API key auth is the universal fallback — every provider in models.dev accepts it

---

## What Fleet Does Today (barely anything)

### Reading providers (read-only, limited)

1. **`auth-store.ts`** — Reads OpenCode's `auth.json` **file directly from disk** to get connected providers. Read-only. Never writes. This is a filesystem-level shortcut that bypasses the OpenCode API entirely.

2. **`provider-registry.ts`** — A **hardcoded list** of 8 providers with manually curated model lists. Stale the moment a new model ships. Does not query OpenCode at all.

3. **`GET /api/config`** — Returns providers by cross-referencing the hardcoded `BUNDLED_PROVIDERS` list with `auth.json`. The response is a merge of two static/file-based sources.

4. **`GET /api/instances/[id]/models`** — The **one place** that actually calls the OpenCode SDK: `client.provider.list()`. Gets real-time connected providers and models from the running instance. But this is only used for the model picker dropdown, not for provider management.

### Configuring providers

5. **`providers-tab.tsx`** — Settings UI shows provider cards as Connected/Not Connected. **No way to connect them from the UI.** The empty state says: *"Run `opencode auth <provider>` to connect a provider."*

6. **`OPENCODE_CONFIG_CONTENT`** — When spawning instances, Fleet passes `{ plugin: [], permission: { edit: "allow", bash: "allow", external_directory: "allow" } }` plus agent model overrides. **No provider config is passed.** Providers rely entirely on env var inheritance from the Fleet process.

### The gap

- Fleet **cannot set API keys** via the OpenCode API (never calls `client.auth.set()`)
- Fleet **cannot initiate OAuth** (never calls `client.provider.oauthAuthorize()`)
- Fleet **cannot update provider config** (never calls `client.config.update()` for provider fields)
- Fleet has no UI for entering API keys, triggering OAuth, or managing credentials
- The entire provider flow depends on the Fleet server process having the right env vars already set

---

## What Fleet Should Do

### Tier 1: API Key Management (minimum viable)

Fleet needs routes that proxy to OpenCode's auth API:

| Fleet Route | Proxies To | Purpose |
|---|---|---|
| `PUT /api/providers/:id/auth` | `client.auth.set()` | Store an API key for a provider |
| `DELETE /api/providers/:id/auth` | `client.auth.remove()` | Remove credentials |
| `GET /api/providers` | `client.provider.list()` | List all providers with real-time connected status |
| `GET /api/providers/auth-methods` | `client.provider.auth()` | Available auth methods per provider |

The `ProvidersTab` UI gets an "Enter API Key" button on each disconnected provider card. User pastes key → Fleet calls `PUT /api/providers/:id/auth` → key is stored in OpenCode's `auth.json` → provider shows as connected.

### Tier 2: OAuth Flows

For providers like GitHub Copilot that use OAuth:

| Fleet Route | Proxies To | Purpose |
|---|---|---|
| `POST /api/providers/:id/oauth/authorize` | `client.provider.oauthAuthorize()` | Get OAuth URL |
| `POST /api/providers/:id/oauth/callback` | `client.provider.oauthCallback()` | Complete flow |

The UI opens the OAuth URL in a browser tab, handles the callback, stores the tokens.

### Tier 3: Provider Config via OPENCODE_CONFIG_CONTENT

For advanced scenarios (custom base URLs, enterprise endpoints, model whitelists):

```typescript
// When spawning an instance, Fleet could pass provider config:
config: {
  plugin: [],
  permission: { edit: "allow", bash: "allow", external_directory: "allow" },
  provider: {
    "anthropic": {
      options: { apiKey: "sk-..." }     // inject key at spawn time
    },
    "custom-endpoint": {
      api: "@ai-sdk/openai-compatible",
      name: "Internal LLM",
      options: { baseURL: "https://llm.internal.corp/v1", apiKey: "..." },
      models: { "internal-model": { name: "Corp Model v2" } }
    }
  },
  model: "anthropic/claude-sonnet-4-5",  // set default model
}
```

This approach means credentials are passed at instance spawn time rather than stored in `auth.json`. Better for remote scenarios where the Fleet Server manages credentials centrally.

### Tier 4: Fleet-Level Credential Store

For a true remote Fleet Server, credentials shouldn't live in individual OpenCode instances' `auth.json`. Fleet needs its own encrypted credential store:

- Fleet stores provider API keys in its own SQLite DB (encrypted at rest)
- When spawning an OpenCode instance, Fleet injects credentials via `OPENCODE_CONFIG_CONTENT`
- The credential store is managed via Fleet API routes, not OpenCode's auth store
- This decouples credential lifecycle from instance lifecycle

---

## Deep Dive: How the Connect Flow Actually Works

### The Two Auth Paths

OpenCode providers support two auth types, determined by the plugin system:

1. **`type: "api"`** — User pastes an API key (Anthropic, OpenAI, etc.)
2. **`type: "oauth"`** — Interactive OAuth flow (GitHub Copilot, etc.)

Each provider can have multiple auth methods. The `GET /provider/auth` endpoint returns:
```typescript
// Response: Record<providerID, ProviderAuthMethod[]>
{
  "github-copilot": [
    { type: "oauth", label: "Login with GitHub Copilot" }
  ],
  "anthropic": [
    { type: "api", label: "API Key" }
  ]
}
```

### API Key Flow (simple)

For providers like Anthropic, the flow is straightforward:

```
User enters key → PUT /auth/anthropic { type: "api", key: "sk-..." } → Done
```

The SDK call: `client.auth.set({ providerID: "anthropic", auth: { type: "api", key: "sk-..." } })`

This writes to `~/.local/share/opencode/auth.json` and the provider immediately shows as connected.

**Fleet can do this today** — it's a single SDK call.

### OAuth Flow (GitHub Copilot — device code flow)

This is the interactive flow you see with `/connect`. Here's what actually happens:

**Step 1: Authorize** — `POST /provider/github-copilot/oauth/authorize { method: 0 }`

The server-side plugin (`copilot.ts`) does:
1. POSTs to `https://github.com/login/device/code` with GitHub's OAuth client ID
2. Gets back `{ verification_uri, user_code, device_code, interval }`
3. Returns to the client:

```typescript
// ProviderAuthAuthorization
{
  url: "https://github.com/login/device",        // URL for user to visit
  method: "auto",                                  // "auto" = server polls, "code" = user pastes code
  instructions: "Enter code: ABCD-1234"           // user code to display
}
```

4. Stores the `callback` closure in server memory (`state.pending[providerID]`) — this closure knows the device code and can poll GitHub

**Step 2: Callback** — `POST /provider/github-copilot/oauth/callback { method: 0 }`

This is a **blocking long-poll HTTP request**. The server:
1. Retrieves the pending callback closure from memory
2. Calls `match.callback()` — which enters a `while(true)` loop:
   - POSTs to `https://github.com/login/oauth/access_token` with the device code
   - If `authorization_pending` → sleeps for `interval` seconds, retries
   - If `slow_down` → increases interval, retries
   - If `access_token` received → returns `{ type: "success", refresh, access, expires }`
   - If error → returns `{ type: "failed" }`
3. On success, stores the OAuth tokens via `Auth.set()` into `auth.json`
4. Returns `true` to the HTTP caller

**The HTTP request does not return until the user completes authorization on GitHub (or an error occurs).** This can take 30+ seconds.

**Step 3: What the UI shows** (from OpenCode's own web app `DialogConnectProvider`):
1. Opens the GitHub verification URL in a browser
2. Displays the user code (e.g., "ABCD-1234") in a copyable text field
3. Shows a spinner with "Waiting..."
4. The callback HTTP request is in-flight the whole time
5. When it resolves, shows a success toast

### SDK Types (exact definitions)

```typescript
// ProviderAuthMethod — returned by GET /provider/auth
type ProviderAuthMethod = {
  type: "oauth" | "api"
  label: string
}

// ProviderAuthAuthorization — returned by POST /provider/:id/oauth/authorize
type ProviderAuthAuthorization = {
  url: string                    // URL for user to visit (or open in browser)
  method: "auto" | "code"       // "auto" = server polls, "code" = user enters code
  instructions: string          // e.g. "Enter code: ABCD-1234"
}

// Auth — body for PUT /auth/:providerID
type Auth =
  | { type: "api"; key: string }
  | { type: "oauth"; refresh: string; access: string; expires: number;
      accountId?: string; enterpriseUrl?: string }
  | { type: "wellknown"; key: string; token: string }
```

### Can Fleet Replicate This?

**Yes — the SDK exposes all the pieces.** The flow for Fleet would be:

```
1. Fleet UI calls GET /api/providers/auth-methods
   → Fleet calls client.provider.auth()
   → Returns auth methods per provider

2. User picks GitHub Copilot → "Login with GitHub Copilot"
   → Fleet UI calls POST /api/providers/github-copilot/oauth/authorize { method: 0 }
   → Fleet calls client.provider.oauthAuthorize({ providerID: "github-copilot", method: 0 })
   → Returns { url, method: "auto", instructions: "Enter code: ABCD-1234" }

3. Fleet UI:
   - Opens url in new browser tab (or shows it as a link)
   - Parses user code from instructions
   - Shows code in copyable field + spinner

4. Fleet UI calls POST /api/providers/github-copilot/oauth/callback { method: 0 }
   → Fleet calls client.provider.oauthCallback({ providerID: "github-copilot", method: 0 })
   → This blocks until user authorizes on GitHub
   → Returns true on success

5. Provider is now connected — Fleet refreshes provider list
```

### One Prerequisite: A Running OpenCode Instance

The authorize/callback flow stores state in the OpenCode server process memory (`state.pending[providerID]`). This means:
- **You need a running OpenCode instance** to proxy auth calls through
- The authorize and callback calls **must go to the same instance** (the callback closure is in-memory)
- Fleet already manages instances — it just needs to pick one (or spawn a temporary one) to handle auth

### Known Limitation: Plugin Prompts Not Exposed via API

GitHub Copilot's plugin defines interactive `prompts` (e.g., "Select GitHub deployment type: GitHub.com vs Enterprise"). These are:
- **Handled in the CLI** via `@clack/prompts` (interactive terminal)
- **Ignored in the web app** — the `authorize()` call receives no inputs, so `deploymentType` defaults to `"github.com"`
- **Not exposed in the HTTP API** — the `POST /provider/:id/oauth/authorize` body only accepts `{ method: number }`, not the prompt inputs

This means:
- GitHub.com OAuth works fine through the API
- GitHub Enterprise OAuth **cannot be triggered** via the API today (it defaults to github.com)
- To fix this, OpenCode would need to: (1) expose prompts in `GET /provider/auth` response, (2) accept `inputs` in the authorize request body

**For Fleet's purposes, this is a minor gap** — GitHub.com is the common case. Enterprise support would require an upstream OpenCode change.

---

## Key Insight: Two Viable Approaches

### Approach A: Proxy to OpenCode's Auth API
- Fleet proxies `auth.set()` / `auth.remove()` / `oauthAuthorize()` / `oauthCallback()` to a running OpenCode instance
- Credentials stored in OpenCode's `auth.json` on the server filesystem
- Simple to implement — wire up SDK calls, build UI
- Prerequisite: at least one running instance to proxy through
- Limitation: authorize + callback must hit the same instance (in-memory state)

### Approach B: Fleet-Owned Credential Store
- Fleet stores credentials in its own DB
- Injects them via `OPENCODE_CONFIG_CONTENT` when spawning instances
- More work but better for remote/multi-tenant scenarios
- Credentials survive instance restarts without relying on filesystem state
- Cannot support OAuth this way (OAuth requires the plugin system inside OpenCode)

**Recommendation:** Start with Approach A (quick wins, the full interactive connect flow works). Move to Approach B for API-key-only providers in the remote server architecture. They're not mutually exclusive — Approach A handles OAuth, Approach B handles API keys at scale.

---

## Files Referenced

### OpenCode (source of truth)
| File | Purpose |
|---|---|
| `packages/opencode/src/provider/provider.ts` | Provider registry, discovery, model database |
| `packages/opencode/src/provider/auth.ts` | OAuth/API key auth flows (`ProviderAuth.authorize`, `.callback`, `.api`) |
| `packages/opencode/src/auth/index.ts` | Credential storage (`auth.json`) |
| `packages/opencode/src/config/config.ts` | Config system, schema, precedence |
| `packages/opencode/src/server/server.ts` | API route mounting |
| `packages/opencode/src/server/routes/provider.ts` | Provider route handlers (authorize, callback, list, auth methods) |
| `packages/opencode/src/plugin/copilot.ts` | GitHub Copilot plugin — device code OAuth flow |
| `packages/opencode/src/flag/flag.ts` | Environment variable flags |
| `packages/opencode/src/env/index.ts` | Instance-scoped env access |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK client methods |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated API types (`ProviderAuthMethod`, `ProviderAuthAuthorization`, `Auth`) |
| `packages/plugin/src/index.ts` | Plugin type definitions (`AuthHook`, `AuthOauthResult`) |
| `packages/app/src/components/dialog-connect-provider.tsx` | OpenCode's own web UI for the connect flow (reference implementation) |

### Fleet (current state)
| File | Purpose |
|---|---|
| `src/lib/server/auth-store.ts` | Reads `auth.json` from disk (read-only) |
| `src/lib/provider-registry.ts` | Hardcoded provider list (stale) |
| `src/app/api/config/route.ts` | Returns providers via hardcoded list + auth.json |
| `src/app/api/instances/[id]/models/route.ts` | Only place that calls `client.provider.list()` |
| `src/components/settings/providers-tab.tsx` | Read-only provider status display |
| `src/lib/server/process-manager.ts` | Spawns instances with `OPENCODE_CONFIG_CONTENT` |
