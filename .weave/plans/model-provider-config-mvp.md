# Model Provider Configuration — MVP

## TL;DR
> **Summary**: Add a Providers tab to Settings that reads OpenCode's `auth.json` to show connected providers, extend the Agents tab with model selection dropdowns scoped to connected providers, persist model choices to `weave-opencode.jsonc`, and inject `agent.<name>.model` into `OPENCODE_CONFIG_CONTENT` when spawning instances.
> **Estimated Effort**: Large

## Context
### Original Request
Enable users to see which model providers are connected and assign specific models to agents, with the configuration actually taking effect when OpenCode instances are spawned.

### Key Findings

**Config types** (`src/cli/skill-catalog.ts`, lines 17-23):
- `WeaveAgentConfig` only has `skills?: string[]` — needs a `model?: string` field
- `WeaveConfig` has `agents?: Record<string, WeaveAgentConfig>` — shape is correct, just needs the inner type extended

**Config manager** (`src/lib/server/config-manager.ts`, lines 43-64):
- `deepMerge()` already spreads agent config objects (`{ ...merged.agents[agent], ...agentConfig }`) so adding `model` to `WeaveAgentConfig` will flow through merging automatically — no merge logic changes needed

**Process manager** (`src/lib/server/process-manager.ts`, lines 470-477):
- `spawnOpencodeServer()` passes `config` object as `OPENCODE_CONFIG_CONTENT` env var
- Currently only sends `{ plugin: [], permission: {...} }` — needs to also include `agent: { <name>: { model: "provider/model" } }` entries
- `spawnInstance()` takes only `directory: string` — needs access to merged WeaveConfig to inject agent model settings

**Settings page** (`src/app/settings/page.tsx`):
- Has tabs: Skills, Agents, Notifications, Keybindings, About — Providers tab needs to be inserted
- Uses shadcn-style `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` components

**Agents tab** (`src/components/settings/agents-tab.tsx`):
- Read-only display of agents → skills mappings
- Uses `useConfig()` hook which returns `{ config, installedSkills, isLoading, error, fetchConfig, updateConfig }`
- `updateConfig()` does a `PUT /api/config` — already supports writing full config objects

**Config hook** (`src/hooks/use-config.ts`, line 13):
- Client-side `WeaveConfig` interface mirrors server-side — must be extended to include `model?: string`

**Config API** (`src/app/api/config/route.ts`):
- `GET` returns `{ userConfig, installedSkills, paths }` — needs to also return `connectedProviders`
- `PUT` accepts `{ agents: {...} }` — already handles full config writes, no changes needed

**API types** (`src/lib/api-types.ts`, lines 117-125):
- `AutocompleteAgent` already has `model?: { modelID: string; providerID: string }` — confirms the `provider/model` format is used by OpenCode

**Config paths** (`src/cli/config-paths.ts`):
- Only resolves `~/.config/opencode/` for config — no XDG data dir resolution exists
- OpenCode stores `auth.json` at XDG data dir: `~/.local/share/opencode/auth.json` on macOS/Linux
- Need a new function for XDG data dir that respects `$XDG_DATA_HOME`, handles Windows `%LOCALAPPDATA%`

**Known agents** (`src/components/settings/skill-card.tsx`, line 8):
- `KNOWN_AGENTS = ["loom", "tapestry", "shuttle", "weft", "warp", "thread", "spindle", "pattern"]`
- These are the Weave-specific OpenCode agent names

**No `xdg-basedir` dependency** — package.json doesn't include it. Since the resolution logic is simple (one env var + one fallback path), implement it inline rather than adding a dependency.

**No Select component** exists in `src/components/ui/` — need to add one via shadcn for the model dropdown.

**Test patterns** — vitest with `vi.mock()`, temp directories, `describe/it` blocks with PascalCase test names (e.g. `ReturnsNullWhenNoConfigExists`). Tests collocated in `__tests__/` directories.

## Objectives
### Core Objective
Allow users to see connected providers and assign models to agents, with the assignment persisted and passed through to spawned OpenCode instances.

### Deliverables
- [ ] Auth store reader that reads OpenCode's `auth.json` cross-platform
- [ ] Hardcoded bundled provider registry with display names and common models
- [ ] Providers tab showing connected/unconfigured providers
- [ ] Model selector on each agent card in the Agents tab
- [ ] `model` field added to `WeaveAgentConfig` and persisted in `weave-opencode.jsonc`
- [ ] Agent model config injected into `OPENCODE_CONFIG_CONTENT` on spawn
- [ ] Tests for auth store reader, config changes, and process manager injection

### Definition of Done
- [ ] `npx next build` passes with no errors
- [ ] `npx vitest run` passes (all existing + new tests)
- [ ] Providers tab displays connected providers read from `auth.json`
- [ ] Agents tab shows model selection dropdown per agent, scoped to connected providers
- [ ] Saving a model selection persists to `weave-opencode.jsonc`
- [ ] Spawned OpenCode instances receive `agent.<name>.model` in their config

### Guardrails (Must NOT)
- Do NOT store API keys in Weave — only READ from OpenCode's auth store
- Do NOT fetch from models.dev — use hardcoded model lists
- Do NOT add provider settings editing (endpoints, whitelists)
- Do NOT support per-project provider overrides (user-level only for MVP)
- Do NOT detect providers from env vars — only auth.json
- Do NOT add custom model definitions — bundled providers only

## TODOs

- [ ] 1. Add XDG data directory resolution to config-paths
  **What**: Add a `getDataDir()` function that resolves the XDG data directory where OpenCode stores `auth.json`. Must handle:
  - `$XDG_DATA_HOME` env var if set (use it directly)
  - macOS/Linux default: `~/.local/share/opencode/`
  - Windows: `%LOCALAPPDATA%/opencode/` (use `process.env.LOCALAPPDATA`)
  - Return the `opencode` subdirectory (not the bare XDG root)
  Add `getAuthJsonPath()` that returns `join(getDataDir(), "auth.json")`.
  **Files**:
  - `src/cli/config-paths.ts` — Add two new exported functions:
    ```typescript
    /**
     * Returns the OpenCode data directory (XDG data home).
     * Respects $XDG_DATA_HOME; falls back to platform defaults.
     */
    export function getDataDir(): string {
      const xdgDataHome = process.env.XDG_DATA_HOME;
      if (xdgDataHome) {
        return join(xdgDataHome, "opencode");
      }
      if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          return join(localAppData, "opencode");
        }
        // Fallback for Windows if LOCALAPPDATA is not set
        return join(homedir(), "AppData", "Local", "opencode");
      }
      return join(homedir(), ".local", "share", "opencode");
    }

    /**
     * Returns the path to OpenCode's auth.json file.
     */
    export function getAuthJsonPath(): string {
      return join(getDataDir(), "auth.json");
    }
    ```
  **Acceptance**: Unit tests pass for all platforms/env var combinations. `getAuthJsonPath()` returns a path ending in `auth.json`.

- [ ] 2. Create the bundled provider registry
  **What**: Create a hardcoded registry of bundled OpenCode providers with their display names, auth type expectations, and common models. This is a pure data file — no I/O, no auth checking.
  **Files**:
  - `src/lib/provider-registry.ts` — New file with types and data:
    ```typescript
    export interface ProviderModelInfo {
      id: string;       // e.g. "claude-sonnet-4-5"
      name: string;     // e.g. "Claude Sonnet 4.5"
    }

    export interface BundledProvider {
      id: string;           // e.g. "anthropic" — matches auth.json key
      name: string;         // e.g. "Anthropic"
      models: ProviderModelInfo[];
    }

    export const BUNDLED_PROVIDERS: BundledProvider[] = [
      {
        id: "anthropic",
        name: "Anthropic",
        models: [
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
          { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
          { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
          { id: "claude-haiku-3-5-20241022", name: "Claude 3.5 Haiku" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1" },
          { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
          { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
          { id: "o3", name: "o3" },
          { id: "o4-mini", name: "o4 Mini" },
        ],
      },
      {
        id: "google",
        name: "Google",
        models: [
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
        ],
      },
      {
        id: "amazon-bedrock",
        name: "Amazon Bedrock",
        models: [
          { id: "us.anthropic.claude-sonnet-4-5-20250514-v1:0", name: "Claude Sonnet 4.5 (Bedrock)" },
          { id: "us.anthropic.claude-sonnet-4-20250514-v1:0", name: "Claude Sonnet 4 (Bedrock)" },
        ],
      },
      {
        id: "azure",
        name: "Azure OpenAI",
        models: [
          { id: "gpt-4.1", name: "GPT-4.1 (Azure)" },
          { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (Azure)" },
        ],
      },
      {
        id: "xai",
        name: "xAI",
        models: [
          { id: "grok-3", name: "Grok 3" },
          { id: "grok-3-mini", name: "Grok 3 Mini" },
        ],
      },
      {
        id: "mistral",
        name: "Mistral",
        models: [
          { id: "codestral-latest", name: "Codestral" },
          { id: "mistral-large-latest", name: "Mistral Large" },
        ],
      },
      {
        id: "groq",
        name: "Groq",
        models: [
          { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
        ],
      },
      {
        id: "github-copilot",
        name: "GitHub Copilot",
        models: [
          { id: "claude-sonnet-4", name: "Claude Sonnet 4 (Copilot)" },
          { id: "gpt-4.1", name: "GPT-4.1 (Copilot)" },
          { id: "o4-mini", name: "o4 Mini (Copilot)" },
        ],
      },
    ];

    /** Lookup helper: get a BundledProvider by its id */
    export function getProviderById(id: string): BundledProvider | undefined {
      return BUNDLED_PROVIDERS.find((p) => p.id === id);
    }
    ```
  **Acceptance**: Import compiles. `getProviderById("anthropic")` returns the correct entry. All bundled OpenCode providers are represented.

- [ ] 3. Create the auth store reader
  **What**: Create a server-side module that reads OpenCode's `auth.json` and returns a list of connected provider IDs with their auth type. Handles all error cases gracefully (file missing, unreadable, malformed JSON). This is read-only — we never write to `auth.json`.
  **Files**:
  - `src/lib/server/auth-store.ts` — New file:
    ```typescript
    import { existsSync, readFileSync } from "fs";
    import { getAuthJsonPath } from "@/cli/config-paths";
    import { log } from "./logger";

    /** Auth entry types matching OpenCode's auth.json format */
    export type AuthType = "api" | "oauth" | "wellknown";

    export interface ConnectedProvider {
      id: string;          // Provider ID matching auth.json key (e.g. "anthropic")
      authType: AuthType;  // The type field from the auth entry
    }

    /**
     * Read OpenCode's auth.json and return the list of connected providers.
     * Returns an empty array if the file doesn't exist, is unreadable, or is malformed.
     * Never throws — all errors are logged and result in an empty array.
     */
    export function getConnectedProviders(authJsonPath?: string): ConnectedProvider[] {
      const filePath = authJsonPath ?? getAuthJsonPath();

      if (!existsSync(filePath)) {
        return [];
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          log.warn("auth-store", "auth.json is not a valid object");
          return [];
        }

        const providers: ConnectedProvider[] = [];
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const entry = value as Record<string, unknown>;
            const authType = entry.type;
            if (authType === "api" || authType === "oauth" || authType === "wellknown") {
              providers.push({ id: key, authType });
            }
          }
        }
        return providers;
      } catch (err) {
        log.warn("auth-store", "Failed to read auth.json", { path: filePath, err });
        return [];
      }
    }
    ```
  **Acceptance**: Unit tests verify: returns connected providers for valid auth.json, returns empty array for missing file, returns empty array for malformed JSON, returns empty array for non-object JSON, skips entries without valid `type` field, handles mixed valid/invalid entries.

- [ ] 4. Write tests for config-paths XDG resolution and auth store reader
  **What**: Add test files for the new server-side modules. Follow existing test patterns (vitest, `vi.mock()`, temp directories, PascalCase test names).
  **Files**:
  - `src/cli/__tests__/config-paths.test.ts` — New test file:
    - Test `getDataDir()`: returns `$XDG_DATA_HOME/opencode` when env var is set
    - Test `getDataDir()`: returns `~/.local/share/opencode` as default on non-Windows
    - Test `getDataDir()`: Windows fallback uses `LOCALAPPDATA`
    - Test `getAuthJsonPath()`: returns path ending in `auth.json`
  - `src/lib/server/__tests__/auth-store.test.ts` — New test file:
    - Test `getConnectedProviders()`: returns empty array for nonexistent file
    - Test `getConnectedProviders()`: returns empty array for empty file
    - Test `getConnectedProviders()`: returns empty array for malformed JSON
    - Test `getConnectedProviders()`: returns empty array for non-object (array, string)
    - Test `getConnectedProviders()`: parses valid auth.json with api key provider
    - Test `getConnectedProviders()`: parses valid auth.json with oauth provider
    - Test `getConnectedProviders()`: parses valid auth.json with wellknown provider
    - Test `getConnectedProviders()`: skips entries without valid type field
    - Test `getConnectedProviders()`: handles mixed valid and invalid entries
    - Use temp files via `tmpdir()` + `randomUUID()` pattern, pass path via optional `authJsonPath` parameter
  **Acceptance**: `npx vitest run src/cli/__tests__/config-paths.test.ts src/lib/server/__tests__/auth-store.test.ts` passes.

- [ ] 5. Extend `WeaveAgentConfig` with `model` field
  **What**: Add `model?: string` to the `WeaveAgentConfig` interface. This field stores the model identifier in `"provider/model"` format (e.g. `"anthropic/claude-sonnet-4-5"`). Update the client-side mirror in `use-config.ts`.
  **Files**:
  - `src/cli/skill-catalog.ts` — Line 18, add `model?: string` to the `WeaveAgentConfig` interface:
    ```typescript
    export interface WeaveAgentConfig {
      skills?: string[];
      model?: string;
    }
    ```
  - `src/hooks/use-config.ts` — Line 13, update the client-side `WeaveConfig` interface:
    ```typescript
    interface WeaveConfig {
      agents?: Record<string, { skills?: string[]; model?: string }>;
    }
    ```
  **Acceptance**: TypeScript compiles. Existing tests still pass (model is optional, so backward compatible). Config can be read/written with `model` field.

- [ ] 6. Add connected providers to the config API response
  **What**: Extend `GET /api/config` to also return connected provider information. Import the auth store reader and provider registry, enrich connected providers with display names, and return both connected and unconfigured providers.
  **Files**:
  - `src/app/api/config/route.ts` — Modify the `GET` handler:
    - Import `getConnectedProviders` from `@/lib/server/auth-store`
    - Import `BUNDLED_PROVIDERS` from `@/lib/provider-registry`
    - Add `connectedProviders` to the response:
      ```typescript
      const connected = getConnectedProviders();
      const connectedProviders = BUNDLED_PROVIDERS.map((provider) => {
        const conn = connected.find((c) => c.id === provider.id);
        return {
          id: provider.id,
          name: provider.name,
          connected: !!conn,
          authType: conn?.authType ?? null,
          models: provider.models,
        };
      });
      ```
    - Response shape becomes: `{ userConfig, installedSkills, paths, connectedProviders }`
  - `src/hooks/use-config.ts` — Extend `ConfigData` interface and hook return:
    - Add provider types to the hook file:
      ```typescript
      interface ProviderModelInfo {
        id: string;
        name: string;
      }

      interface ProviderStatus {
        id: string;
        name: string;
        connected: boolean;
        authType: "api" | "oauth" | "wellknown" | null;
        models: ProviderModelInfo[];
      }
      ```
    - Add `connectedProviders: ProviderStatus[]` to `ConfigData`
    - Add `providers: data?.connectedProviders ?? []` to the hook return
  **Acceptance**: `GET /api/config` returns `connectedProviders` array with all bundled providers, each with a `connected` boolean. Hook exposes `providers` to components. Existing config test still passes (new field is additive).

- [ ] 7. Add a Select UI component
  **What**: Add a shadcn-compatible Select component using Radix UI primitives (`radix-ui` is already a dependency). The project already uses Radix-based components (Dialog, Popover, DropdownMenu) so this follows the same pattern.
  **Files**:
  - `src/components/ui/select.tsx` — New file. Generate via `npx shadcn@latest add select` or create manually following the existing component patterns in `src/components/ui/`. Should export: `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`, `SelectGroup`, `SelectLabel`.
  **Acceptance**: Component renders. Can be imported and used in the agents tab.

- [ ] 8. Create the Providers tab component
  **What**: Create a new settings tab that shows all bundled providers with their connection status. Connected providers show a green "Connected" badge with auth type. Unconfigured providers show a muted "Not Connected" state with a hint about how to connect (run `opencode auth` CLI). No editing — this is read-only visibility into `auth.json`.
  **Files**:
  - `src/components/settings/providers-tab.tsx` — New file:
    - Import `useConfig` hook to get `providers`
    - Show loading spinner while fetching (matching existing tab patterns)
    - Layout: grid of provider cards (similar to agents tab)
    - Each card shows:
      - Provider name (e.g. "Anthropic")
      - Connection status badge: green "Connected" or muted "Not Connected"
      - Auth type badge if connected (e.g. "API Key", "OAuth")
      - Number of available models (e.g. "4 models")
    - If no providers are connected at all, show a helpful empty state: "No providers connected. Run `opencode auth <provider>` to connect a provider."
    - Use existing UI components: `Card`, `CardContent`, `Badge`, `Loader2`
    - Follow the style of `about-tab.tsx` and `agents-tab.tsx`
  **Acceptance**: Tab renders the provider grid. Connected providers show green status. Unconfigured providers show "Not Connected" with guidance.

- [ ] 9. Add the Providers tab to the Settings page
  **What**: Register the new Providers tab in the Settings page, inserting it between "Agents" and "Notifications" (logical grouping: Skills → Agents → Providers → Notifications → Keybindings → About).
  **Files**:
  - `src/app/settings/page.tsx`:
    - Add import: `import { ProvidersTab } from "@/components/settings/providers-tab";`
    - Add `<TabsTrigger value="providers">Providers</TabsTrigger>` after the "agents" trigger
    - Add `<TabsContent value="providers" className="mt-4"><ProvidersTab /></TabsContent>` after the agents content
    - Update subtitle: `"Manage skills, agents, providers, notifications, keybindings, and configuration"`
  **Acceptance**: Providers tab appears in Settings. Clicking it shows the providers grid.

- [ ] 10. Extend the Agents tab with model selection
  **What**: Add a model selector dropdown to each agent card. The dropdown is a `Select` component that shows models grouped by connected provider. When the user selects a model, it calls `updateConfig()` to persist the choice. The format is `"provider/model"` (e.g. `"anthropic/claude-sonnet-4-5"`). If no providers are connected, show a hint instead of the dropdown.
  **Files**:
  - `src/components/settings/agents-tab.tsx` — Modify significantly:
    - Import `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`, `SelectGroup`, `SelectLabel` from `@/components/ui/select`
    - Get `providers` from `useConfig()` hook (destructure alongside `config`, `installedSkills`)
    - Get `updateConfig` from `useConfig()` hook
    - For each agent card, add a model selection section below the skills section:
      - Show current model if set: `agents[agentName].model` displayed as a badge
      - Show `Select` dropdown with models grouped by connected provider:
        ```
        <SelectGroup>
          <SelectLabel>Anthropic</SelectLabel>
          <SelectItem value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
          ...
        </SelectGroup>
        ```
      - Only show providers where `connected === true`
      - Include a "Default" option (empty value) that clears the model override
      - On change: build updated config and call `updateConfig()`
    - `onModelChange` handler:
      ```typescript
      const onModelChange = async (agentName: string, model: string) => {
        const currentAgents = config?.agents ?? {};
        const updatedAgents = {
          ...currentAgents,
          [agentName]: {
            ...currentAgents[agentName],
            model: model || undefined,  // clear if empty
          },
        };
        await updateConfig({ agents: updatedAgents });
      };
      ```
    - If no connected providers, show a muted message: "Connect a provider in the Providers tab to select models."
  **Acceptance**: Each agent card shows a model dropdown. Selecting a model persists it. The dropdown only shows models from connected providers. "Default" clears the selection.

- [ ] 11. Inject agent model config into `OPENCODE_CONFIG_CONTENT` on spawn
  **What**: When spawning OpenCode instances, read the merged WeaveConfig for the target directory and include any agent model settings in the config object passed as `OPENCODE_CONFIG_CONTENT`. The format OpenCode expects is `{ agent: { "<name>": { model: "provider/model" } } }`.
  **Files**:
  - `src/lib/server/process-manager.ts`:
    - Import `getMergedConfig` from `@/lib/server/config-manager`
    - In `spawnInstance()` (around line 470), after allocating a port and before calling `spawnOpencodeServer()`:
      - Call `getMergedConfig(directory)` to get the merged config
      - Build an `agent` config object from any agent entries that have a `model` field:
        ```typescript
        const weaveConfig = getMergedConfig(directory);
        const agentConfig: Record<string, { model: string }> = {};
        if (weaveConfig.agents) {
          for (const [name, cfg] of Object.entries(weaveConfig.agents)) {
            if (cfg.model) {
              agentConfig[name] = { model: cfg.model };
            }
          }
        }
        ```
      - Pass the agent config into `spawnOpencodeServer`:
        ```typescript
        server = await spawnOpencodeServer({
          port,
          timeout: SPAWN_TIMEOUT_MS,
          config: {
            plugin: [],
            permission: { edit: "allow", bash: "allow", external_directory: "allow" },
            ...(Object.keys(agentConfig).length > 0 ? { agent: agentConfig } : {}),
          },
        });
        ```
    - This approach keeps the existing config shape intact and only adds the `agent` key when model overrides exist.
  **Acceptance**: When a user has set `model: "anthropic/claude-sonnet-4-5"` for agent "tapestry" in their config, spawning an instance for that directory produces `OPENCODE_CONFIG_CONTENT` containing `{ ..., agent: { tapestry: { model: "anthropic/claude-sonnet-4-5" } } }`.

- [ ] 12. Write tests for process manager model injection
  **What**: Add tests verifying that `spawnInstance()` passes agent model config through to `OPENCODE_CONFIG_CONTENT`. Follow the existing test patterns in `process-manager.test.ts`.
  **Files**:
  - `src/lib/server/__tests__/process-manager.test.ts` — Add new describe block:
    - Mock `getMergedConfig` to return config with agent model settings
    - Verify the `config` argument passed to `spawnOpencodeServer` includes the `agent` key
    - Test: no agent key when no models are configured
    - Test: agent key present when models are configured
    - Test: only agents with model field are included (agents with only skills are excluded)
    - Since `spawnInstance` actually spawns processes, these tests should mock `spawnOpencodeServer` (or the lower-level `spawn`) to capture the config argument. Look at how existing spawn tests handle this — they may use `vi.mock()` on the module.
  **Acceptance**: `npx vitest run src/lib/server/__tests__/process-manager.test.ts` passes with new tests.

- [ ] 13. Update existing config API tests
  **What**: Update the config API route tests to verify the new `connectedProviders` field in the GET response. Add a test that verifies writing config with a `model` field persists correctly.
  **Files**:
  - `src/app/api/config/__tests__/route.test.ts`:
    - Add mock for `@/lib/server/auth-store` so tests don't depend on real `auth.json`
    - Add test: `GET` response includes `connectedProviders` array
    - Add test: writing config with `model` field persists it
    - Add test: reading config with `model` field returns it
  **Acceptance**: `npx vitest run src/app/api/config/__tests__/route.test.ts` passes.

## Verification
- [ ] `npx next build` passes with no TypeScript errors
- [ ] `npx vitest run` passes — all existing + new tests
- [ ] Manual: Settings → Providers tab shows providers with correct connected/not-connected status
- [ ] Manual: Settings → Agents tab shows model dropdown per agent, only connected provider models
- [ ] Manual: Selecting a model persists to `~/.config/opencode/weave-opencode.jsonc`
- [ ] Manual: Starting a new session spawns OpenCode with the model config in `OPENCODE_CONFIG_CONTENT`
- [ ] No regression: existing skills, agent assignments, and session spawning work unchanged

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings Page                                                   │
│  ┌─────────────────┐  ┌──────────────────┐                      │
│  │  Providers Tab   │  │   Agents Tab      │                     │
│  │  (read-only)     │  │  (model select)   │                     │
│  │                  │  │                   │                      │
│  │  ● Anthropic ✓   │  │  tapestry         │                     │
│  │  ○ OpenAI ✗      │  │  model: [▼ ...]   │                     │
│  │  ● Copilot ✓     │  │  skills: [...]    │                     │
│  └─────────┬────────┘  └────────┬──────────┘                     │
│            │                     │                                │
│            ▼                     ▼                                │
│     GET /api/config        PUT /api/config                       │
└────────────┬─────────────────────┬──────────────────────────────┘
             │                     │
             ▼                     ▼
     ┌───────────────┐    ┌──────────────────┐
     │  auth-store   │    │  config-manager  │
     │  (reads       │    │  (reads/writes   │
     │  auth.json)   │    │  weave-opencode  │
     └───────┬───────┘    │  .jsonc)         │
             │            └────────┬─────────┘
             │                     │
             ▼                     ▼
     ~/.local/share/       ~/.config/opencode/
     opencode/auth.json    weave-opencode.jsonc
                                   │
                                   ▼
                           ┌───────────────┐
                           │ process-manager│
                           │ spawnInstance()│
                           │               │
                           │ OPENCODE_     │
                           │ CONFIG_CONTENT│
                           │ { agent: {    │
                           │   tapestry: { │
                           │    model:...  │
                           │   }           │
                           │ }}            │
                           └───────────────┘
```

## File Impact Summary

| File | Action | Description |
|------|--------|-------------|
| `src/cli/config-paths.ts` | Modify | Add `getDataDir()`, `getAuthJsonPath()` |
| `src/cli/skill-catalog.ts` | Modify | Add `model?: string` to `WeaveAgentConfig` |
| `src/lib/provider-registry.ts` | Create | Hardcoded bundled provider + model registry |
| `src/lib/server/auth-store.ts` | Create | Read-only auth.json reader |
| `src/components/ui/select.tsx` | Create | Shadcn Select component |
| `src/components/settings/providers-tab.tsx` | Create | New Providers tab UI |
| `src/components/settings/agents-tab.tsx` | Modify | Add model selection dropdown |
| `src/app/settings/page.tsx` | Modify | Register Providers tab |
| `src/app/api/config/route.ts` | Modify | Add `connectedProviders` to GET response |
| `src/hooks/use-config.ts` | Modify | Add provider types and `providers` to hook |
| `src/lib/server/process-manager.ts` | Modify | Inject agent model config on spawn |
| `src/cli/__tests__/config-paths.test.ts` | Create | Tests for XDG data dir resolution |
| `src/lib/server/__tests__/auth-store.test.ts` | Create | Tests for auth store reader |
| `src/lib/server/__tests__/process-manager.test.ts` | Modify | Add model injection tests |
| `src/app/api/config/__tests__/route.test.ts` | Modify | Add provider/model config tests |
