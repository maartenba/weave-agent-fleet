# Plugin System — Exploration Findings

> **Date**: 2026-03-13
> **Status**: Research complete — design produced at `.weave/plans/plugin-system-design.md`

## 1. Codebase Architecture Summary

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1.6 (App Router, standalone output) |
| Frontend | React 19, Tailwind CSS 4, shadcn/ui (Radix + CVA) |
| Desktop | Tauri v2 (Rust shell wrapping the Next.js app) |
| CLI | `fleet` (esbuild bundle from `src/cli/`) |
| AI Backend | `@opencode-ai/sdk` v1.2.24 wrapping the `opencode serve` process |
| Database | SQLite via `better-sqlite3` at `~/.fleet/fleet.db` |
| Testing | Vitest 4, @testing-library/react |

### Directory Layout

```
src/
  app/              # Next.js App Router — pages + 27 API route files
  cli/              # CLI tool (compiled to cli.js via esbuild)
  components/       # React components (fleet/, session/, settings/, layout/, ui/)
  contexts/         # 5 React context providers
  hooks/            # 34 custom React hooks
  lib/              # Shared libraries
    server/         # 16 server-only modules (process-manager, database, etc.)
src-tauri/          # Tauri desktop app (Rust)
skills/             # Bundled skill definitions
scripts/            # Build/install scripts
```

### API Layer

Pure REST + SSE — no tRPC or GraphQL. 27 API route files under `src/app/api/`:

- **Sessions**: CRUD, prompt, events (SSE), fork, resume, abort, diffs, messages, status, command
- **Fleet**: Summary metrics
- **Config/Skills**: Configuration management, skill listing/installation/removal
- **Instances**: Agents, models, commands, file search per OpenCode instance
- **Infrastructure**: Directories, workspace-roots, available-tools, open-directory, version, activity-stream (global SSE)

### Data Model (SQLite — 5 tables)

| Table | Purpose |
|-------|---------|
| `workspaces` | Workspace isolation tracking (directory, isolation strategy, branch) |
| `instances` | OpenCode process instances (port, PID, URL, status) |
| `sessions` | Session state (workspace, instance, opencode session ID, status, parent) |
| `session_callbacks` | Parent-child completion notifications (source, target, status) |
| `workspace_roots` | Registered project root directories |

### Key Domain Abstractions

- **Workspace** — isolation container (existing/worktree/clone) for a session's files
- **ManagedInstance** — running OpenCode server process with SDK client, port, health status
- **Session / SessionListItem** — rich session with DB state + live SDK state merged
- **Pipeline / PipelineStage** — multi-stage orchestration (draft/running/paused/completed/failed)
- **TaskTemplate / TaskQueue / QueueItem** — reusable task definitions with variable substitution and concurrency control
- **FleetSummary** — aggregate dashboard metrics

---

## 2. Existing Extensibility Patterns

These are the patterns already in the codebase that a plugin system should align with:

| Pattern | Location | Mechanism |
|---------|----------|-----------|
| Command Registry | `src/contexts/command-registry-context.tsx` | `registerCommand()` / `unregisterCommand()` — client-side React context |
| Tool Registry | `src/lib/server/tool-registry.ts` | Data-driven lookup table with config overrides + custom entries |
| Activity Emitter | `src/lib/server/activity-emitter.ts` | `EventEmitter` pub/sub via `globalThis` singleton |
| Config System | `src/lib/server/config-manager.ts` | Two-level merge (user `~/.config/opencode/fleet.jsonc` + project) |
| Skills System | `src/cli/skill-catalog.ts` | Markdown files with YAML frontmatter, CLI install/remove |
| SSE Streaming | `src/hooks/use-global-sse.ts` | Module-level singleton EventSource with typed dispatch |
| Provider Hierarchy | `src/app/client-layout.tsx` | Nested React providers: Theme → Sessions → Sidebar → Keybindings → Commands |
| DB Schema | `src/lib/server/database.ts` | SQLite with `try/catch ALTER TABLE` migrations |
| Process Manager | `src/lib/server/process-manager.ts` | `globalThis` singleton with recovery promises |
| Settings Tabs | `src/app/settings/page.tsx` | Static `<Tabs>` with hardcoded tab triggers |
| Instrumentation | `src/instrumentation.ts` | Next.js startup hook — runs once on server boot |

---

## 3. Constraints That Shape the Plugin Design

1. **Next.js App Router cannot dynamically register route handlers at runtime.** API routes must exist at build time → requires a catch-all route (`/api/plugins/[...pluginPath]/route.ts`) to dispatch to plugin-registered handlers.

2. **`globalThis` singletons survive Turbopack HMR.** Plugin registries must use this pattern to avoid re-initialization during development.

3. **Tauri desktop wraps the Next.js standalone server.** Plugins must not require separate processes — everything runs in the same Node.js process.

4. **`output: 'standalone'`** means the deployment artifact is a self-contained Node.js server. Plugins must be loadable without modifying the build output.

5. **`serverExternalPackages`** allows Node.js-native modules — plugins can use npm packages with native bindings.

6. **Single-user model** (currently). OAuth token storage is simple key-value. Multi-user would require keying by user ID.

---

## 4. What a Plugin System Needs

Based on the exploration, a Fleet plugin system requires these components:

### Server Side
- **Plugin loader** — discovers, validates manifests, runs migrations, calls `onLoad()` at startup
- **Catch-all API route** — dispatches `/api/plugins/{pluginId}/*` to plugin handlers
- **PluginContext** — scoped API surface: database, SSE, lifecycle hooks, session creation, key-value store, OAuth
- **Migration system** — versioned, per-plugin, idempotent, with `plugin_migrations` tracking table
- **Hook emission points** — wired into session creation, completion, error, workspace creation, instance start/stop

### Client Side
- **PluginProvider** — React context that fetches plugin registry, loads client bundles, collects registrations
- **Extension slots** — sidebar sections, settings tabs, session card badges, session detail panels, pages, dialogs, commands
- **Catch-all page** — renders plugin-registered pages at `/plugins/{pluginId}/*`
- **Plugin client bundles** — pre-bundled JS served via API route (no host-side build step)

### Configuration
- `plugins` section added to `FleetConfig` — same two-level merge as existing config
- Per-plugin `configSchema` (JSON Schema) for validation
- `enabled` flag for per-project enable/disable

---

## 5. GitHub Plugin — What It Would Look Like

The GitHub integration validates the plugin design. It would need:

| Feature | Server | Client |
|---------|--------|--------|
| OAuth connect/disconnect | OAuth routes, token storage | Settings tab with connect button |
| Issue browsing | REST proxy to GitHub API | Full page with repo selector + filters |
| PR browsing | REST proxy to GitHub API | Full page or sidebar section |
| Create session from issue | Session creation with source metadata | "Start Session" button on issue cards |
| Session→issue linking | DB mapping table (`plugin_github_issue_sessions`) | Issue badge on session cards |
| Completion sync | `session:completed` hook → post GitHub comment | Real-time SSE update |

### Key Design Decisions

- **OAuth over PAT**: OAuth GitHub App is better for org access; PAT can be offered as a simpler fallback
- **Proxy vs. direct**: Server proxies GitHub API calls (avoids CORS, keeps token server-side)
- **Source metadata**: Sessions store `source: { type: "github", issueNumber, issueUrl }` for traceability
- **Bidirectional sync**: Session completion posts a comment on the issue; issue updates could push SSE events to the dashboard

---

## 6. Key Trade-offs Identified

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sandboxing | None | Developer tool, not marketplace. Trust model matches npm. |
| Client bundles | Pre-bundled by plugin author | Avoids host build steps. Host provides `@fleet/plugin-build` tool. |
| React sharing | Externals via `window.__FLEET_EXTERNALS__` | Prevents version conflicts, consistent UI. |
| Hot reload | Not in v1 (restart required) | Simpler. Dev reload can be added later. |
| Plugin dependencies | Not in v1 | Plugins are independent initially. Inter-plugin API added later. |
| Route dispatch | Single catch-all | Next.js constraint. Map lookup is negligible overhead. |

---

## 7. Estimated Effort

| Phase | Description | Weeks |
|-------|-------------|-------|
| 1 | Core infrastructure (loader, catch-all route, config, migrations) | 2–3 |
| 2 | Server APIs (PluginContext, SSE, hooks, OAuth, store) | 2–3 |
| 3 | Client infrastructure (PluginProvider, extension slots) | 2–3 |
| 4 | GitHub plugin (OAuth, issues, PRs, session creation, UI) | 3–4 |
| 5 | Developer experience (`@fleet/plugin-api`, build tool, template) | 1 |
| **Total** | | **10–14** |

---

## 8. Next Steps

- Full design document with TypeScript interfaces, implementation phases, and 36 concrete tasks: `.weave/plans/plugin-system-design.md`
- To begin implementation: run `/start-work` on the plan
