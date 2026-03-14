# Remote Fleet Client-Server Architecture — Findings

> Date: 2026-03-13
> Status: Research / Vision
> Scope: Feasibility and design analysis for splitting Weave Agent Fleet into a remote-capable client-server architecture

---

## Current Architecture

Weave Agent Fleet is a **monolithic Next.js application** — the API server, React UI, and process manager all run in one process. The frontend talks to its own backend via relative URLs (`/api/sessions`), and the process manager spawns OpenCode instances on `127.0.0.1` with ports in the 4097–4200 range. Everything is **localhost-only**.

### Key files

| Component | Path |
|---|---|
| API client (frontend) | `src/lib/api-client.ts` |
| API types (shared contract) | `src/lib/api-types.ts` |
| CORS proxy middleware | `src/proxy.ts` |
| Process manager | `src/lib/server/process-manager.ts` |
| Workspace manager | `src/lib/server/workspace-manager.ts` |
| Database (SQLite) | `src/lib/server/database.ts` |
| Callback service | `src/lib/server/callback-service.ts` |
| OpenCode client wrapper | `src/lib/server/opencode-client.ts` |
| Next.js config | `next.config.ts` |
| CLI entry point | `cli.js` (built from `src/cli/index.ts`) |
| API routes | `src/app/api/` (12 route groups, ~27+ handlers) |

### Existing abstractions that hint at remote support

1. **`api-client.ts`** — already uses `NEXT_PUBLIC_API_BASE_URL` to optionally prefix API calls, enabling "split mode" where the UI runs on a different port than the API.
2. **`proxy.ts`** — CORS middleware with `Access-Control-Allow-Origin: *`, already permitting cross-origin access (added for Tauri webview support).
3. **`api-types.ts`** — cleanly separates request/response shapes from server internals. This is already a de facto API contract.
4. **Transport** — RESTful HTTP + SSE (Server-Sent Events). No WebSockets, no gRPC, no custom protocols. Any HTTP client can talk to it today.
5. **Persistence** — Server state is in SQLite (`~/.weave/fleet.db`). Sessions, workspaces, callbacks are all persisted. The server is already stateful in the right way for a multi-client scenario.

---

## Proposed Architecture

Split Fleet into two deployable artifacts:

### Fleet Server
The API + process manager + database. Runs on a machine with resources (a beefy dev server, a cloud VM, a CI runner). Binds to `0.0.0.0:<port>`. Manages OpenCode instances, workspaces, sessions, callbacks, health checks.

### Fleet Client
A lightweight frontend (web UI, CLI, desktop app via Tauri, or an SDK library) that connects to a remote Fleet Server over HTTP/SSE. No process manager, no SQLite, no OpenCode binaries needed.

```
+------------------------+          HTTPS / SSE          +--------------------------+
|   Fleet Client         | <---------------------------> |   Fleet Server           |
|                        |                               |                          |
|  * Web UI (React)      |  POST /api/sessions           |  * Process Manager       |
|  * CLI                 |  POST /api/sessions/:id/prompt|  * Workspace Manager     |
|  * Tauri Desktop       |  GET  /api/sessions (SSE)     |  * SQLite Database       |
|  * SDK / Library       |  GET  /api/activity-stream    |  * OpenCode Instances    |
|                        |                               |  * Health Check Loop     |
|  Config:               |                               |  * Callback Service      |
|   FLEET_SERVER_URL     |                               |                          |
|   FLEET_API_KEY        |                               |  Binds: 0.0.0.0:3000    |
+------------------------+                               +--------------------------+
                                                                    |
                                                         +----------+----------+
                                                         | OpenCode Instances   |
                                                         | :4097  :4098  :4099  |
                                                         +----------------------+
```

---

## What Changes Are Needed

| Area | Current State | Remote-Ready State |
|------|--------------|-------------------|
| **Server binding** | Next.js defaults (localhost:3000) | Configurable `HOST=0.0.0.0`, TLS support |
| **Authentication** | None — zero auth on any endpoint | API key / token auth on all `/api/` routes |
| **CORS** | `Access-Control-Allow-Origin: *` | Configurable allowed origins |
| **Client configuration** | `NEXT_PUBLIC_API_BASE_URL` (build-time only) | Runtime-configurable server URL + auth credentials |
| **SSE proxy** | Relative URLs, same-origin | Full URL construction with auth headers on EventSource |
| **CLI** | Only `init` and `skill` commands | Full session management: `connect`, `session create`, `prompt` |
| **SDK/Library** | None | Standalone TypeScript package: `@weave-fleet/client` |
| **Transport security** | None needed (localhost) | TLS termination (direct or via reverse proxy) |
| **Workspace roots** | Local filesystem paths | Server-side paths — client sends intents, server resolves |
| **File watching** | Same machine | Server-side only; diffs returned via API |

---

## Architecture Layers

```
Layer 1: Transport & Auth
  +-- TLS termination (nginx/caddy or built-in)
  +-- API key validation middleware
  +-- Rate limiting
  +-- CORS policy enforcement

Layer 2: Fleet API (already exists, mostly ready)
  +-- POST /api/sessions             — create session
  +-- POST /api/sessions/:id/prompt  — send prompt
  +-- GET  /api/sessions             — list sessions
  +-- GET  /api/sessions/:id/events  — SSE stream
  +-- GET  /api/sessions/:id/diffs   — get diffs
  +-- GET  /api/fleet/summary        — fleet overview
  +-- POST /api/sessions/:id/stop    — stop session
  +-- ... (27+ existing routes)

Layer 3: Process Manager (server-side only, no changes needed)
  +-- OpenCode instance lifecycle
  +-- Port allocation & health checks
  +-- Workspace isolation (worktree/clone/existing)
  +-- Callback orchestration

Layer 4: Clients (new / enhanced)
  +-- Web UI (existing — needs runtime config for server URL)
  +-- CLI (existing — needs session management commands)
  +-- Tauri Desktop (existing — needs connection settings UI)
  +-- SDK Library (new — standalone npm package)
```

---

## Benefits

### 1. Team Multiplayer
Multiple developers connect their Fleet Clients to a shared Fleet Server. Everyone sees the same sessions, the same agent activity, the same results. One person spawns a session, another monitors or interacts with it.

### 2. Headless / CI Runners
A Fleet Server runs on a CI machine or cloud VM. CI pipelines or GitHub Actions call the Fleet API to spawn agent sessions that fix issues, run migrations, generate code. No UI needed — just API calls.

### 3. Resource Efficiency
OpenCode instances are heavyweight (each spawns an LLM-connected process). Running them on a beefy server while developers use lightweight clients on laptops means better resource utilization. Your MacBook Air doesn't need to run 5 OpenCode instances.

### 4. Persistent Sessions Across Devices
Start a session on your desktop, check in on it from your laptop. The session lives on the server — the client is just a view into it. Close your browser, reopen later, the session is still there.

### 5. Centralized Governance
API keys, model provider credentials, allowed workspace roots, cost limits — all managed server-side. Developers don't need individual Anthropic/OpenAI API keys. The server can enforce spending caps, model policies, and audit logs.

### 6. Remote Development
Dev containers, cloud workstations (Codespaces, Gitpod), SSH-forwarded environments — the Fleet Server runs where the code lives, and the Fleet Client connects remotely.

### 7. SDK/Library Composability
A clean `@weave-fleet/client` SDK means other tools can integrate: VS Code extensions, custom dashboards, Slack bots, internal tooling. The Fleet becomes a platform, not just a UI.

---

## Readiness Assessment

### What's Surprisingly Close Already

1. **`api-client.ts` already supports a configurable base URL** — the `NEXT_PUBLIC_API_BASE_URL` pattern just needs to become runtime-configurable instead of build-time.
2. **CORS is already permissive** — added for Tauri webview support, works for any remote client.
3. **API types are cleanly separated** — `api-types.ts` is already a de facto API contract.
4. **The API is RESTful + SSE** — no custom protocols. Any HTTP client can talk to it.
5. **Server state is in SQLite** — already persistent and stateful in the right way for multi-client scenarios.

### What's Missing

1. **Authentication** — the biggest gap. Zero auth today. Needs at minimum API key validation, ideally with scoped permissions (read-only vs. full control).
2. **Server binding config** — Next.js needs `--hostname 0.0.0.0` passed explicitly. No env var for this today.
3. **A standalone client package** — the React UI is tightly coupled to Next.js. Extracting the API interaction layer into `@weave-fleet/client` would unlock CLI, SDK, and third-party integration.
4. **Connection management UI** — the client needs a "Connect to Server" flow: enter URL, authenticate, persist connection settings.
5. **Multi-tenancy considerations** — if multiple users connect, who owns which sessions? Can user A see user B's sessions? Today the model is single-tenant.

---

## Summary

The mental model shift: **Fleet Server is the engine, Fleet Client is the steering wheel.** You can have multiple steering wheels (web, CLI, desktop, API), and the engine can run anywhere — local machine, team server, or cloud. The existing API surface is ~90% of what's needed; the main gaps are auth, network binding, and a clean client extraction.
