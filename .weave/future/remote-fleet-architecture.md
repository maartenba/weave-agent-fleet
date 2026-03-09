# Remote Fleet Architecture

> Recorded: 2026-03-09
> Status: Planning / Future

## Vision

Evolve Weave Agent Fleet from a local desktop tool into a remote-capable platform where:

1. **The Fleet API becomes a headless server** — deployable to AWS, a VM, a NAS, wherever — that can provision, run, and tear down agent sessions without a human sitting at the machine.
2. **The Fleet UI becomes a thin client** — connecting over the network to a remote Fleet API, the same way you'd connect to a remote Grafana or Jenkins.
3. **Sessions run in containers** — not just git worktrees on the host filesystem, but fully isolated Docker/OCI containers that get created, receive code, do work, and get destroyed.
4. **Credentials are managed centrally** — the Fleet API holds model provider keys (Anthropic, OpenAI, etc.) and injects them into sessions, rather than each session needing its own `auth.json`.

The overarching goal: **a self-hosted AI coding agent platform** — spin up a Fleet server, point your browser at it, and orchestrate agent work across isolated containers, all managed centrally.

---

## Current State vs. What's Needed

| Capability | Current State | Gap |
|---|---|---|
| **API Authentication** | None — completely open, `localhost`-only assumption | Need API key auth at minimum, potentially JWT/OAuth later |
| **Remote connectivity** | UI supports `NEXT_PUBLIC_API_BASE_URL` (configurable base URL) | Need TLS, auth, and CORS tightening for real remote use |
| **Container isolation** | Only `worktree` / `clone` / `existing` (all local filesystem) | Need a container runtime adapter (Docker API) |
| **Credential management** | Read-only from OpenCode's `auth.json` on disk | Need Fleet-managed credential store with per-session injection |
| **Session lifecycle in containers** | Process manager spawns local `opencode serve` processes | Need container lifecycle manager (create -> start -> monitor -> destroy) |
| **Code upload/workspace provisioning** | Assumes local filesystem access | Need volume mounting, `docker cp`, or git clone inside container |
| **Health monitoring** | 30s health check loop on local processes | Need container health checks, restart policies |
| **Cleanup/decommission** | Process kill + optional workspace delete | Need container removal + volume cleanup |

---

## Architectural Components

### 1. API Security Layer

**What**: Middleware that authenticates every API request.

**Design**:
- **Phase 1**: Static API key — a random token stored in a server-side config/env var. Clients send `Authorization: Bearer <key>` or `X-API-Key: <key>`. Simple, effective, good enough for self-hosted.
- **Phase 2** (optional future): JWT tokens with user identity, enabling multi-user access control.
- Implementation: Next.js middleware (`src/middleware.ts`) that intercepts all `/api/*` routes, validates the key, and rejects with 401/403.
- SSE streams need auth too — either via query param token or initial handshake.

### 2. Remote Fleet API Server Mode

**What**: The ability to run the Fleet API as a headless server on any machine.

**Design**:
- Next.js standalone build already exists (`output: 'standalone'`).
- Need a proper server entry point: `fleet-server` command that starts the Next.js server with configurable host/port/TLS.
- TLS options: (a) built-in via Node.js HTTPS server, (b) reverse proxy (nginx/caddy) — recommend (b) for production, (a) for quick setup.
- Docker image for the Fleet API server itself (the control plane).
- Environment-based configuration: `FLEET_HOST`, `FLEET_PORT`, `FLEET_API_KEY`, `FLEET_TLS_CERT`, `FLEET_TLS_KEY`.

### 3. Container Runtime Adapter

**What**: A new `container` isolation strategy alongside `worktree`/`clone`/`existing`.

**Design**:
- **Container Manager** (`src/lib/server/container-manager.ts`) — abstraction over the Docker Engine API (via `dockerode` or direct HTTP to `/var/run/docker.sock`).
- Lifecycle: `createContainer()` -> `startContainer()` -> `monitorContainer()` -> `stopContainer()` -> `removeContainer()`
- Base image: A pre-built Docker image with Node.js, OpenCode, git, and common tools (`ghcr.io/weave-agent-fleet/agent-runtime:latest`).
- Workspace provisioning inside container:
  - **Git clone**: Container clones from a repo URL (needs git credentials injection)
  - **Volume mount**: Mount a host directory into the container (simpler but less isolated)
  - **Upload**: `docker cp` or tar stream to push code into the container
- Port mapping: Each container exposes OpenCode's port, Fleet API connects via `http://container-ip:port` or mapped host port.
- Resource limits: CPU, memory, disk — prevent runaway agents from killing the host.

### 4. Credential Management System

**What**: A Fleet-level credential store that holds model provider API keys and injects them into sessions.

**Design**:
- **Credential Store** (`src/lib/server/credential-store.ts`):
  - Stores encrypted provider credentials in SQLite (new `credentials` table) or a separate encrypted file.
  - Encryption at rest using a master key derived from the Fleet API key or a separate secret.
  - CRUD API: `POST/GET/PUT/DELETE /api/credentials`
  - Schema: `{ id, provider, name, type, encryptedValue, createdAt, updatedAt }`
- **Credential Injection**:
  - For local sessions: Write a temporary `auth.json` scoped to the session's workspace directory.
  - For container sessions: Pass as environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) or mount a secrets volume.
  - Cleanup: Remove injected credentials when session terminates.
- **UI**: Settings page gets a "Providers" section for credential CRUD. Existing `auth-store.ts` becomes a fallback source.

### 5. Remote UI Connection

**What**: The Fleet UI connecting to a remote Fleet API instead of localhost.

**Design**:
- Already partially supported via `NEXT_PUBLIC_API_BASE_URL` and `src/lib/api-client.ts`.
- Need a **connection flow**: "Connect to Fleet" dialog with server URL and API key.
- Store connection details in browser `localStorage`.
- Handle reconnection, offline states, connection errors.
- Option: UI served FROM the Fleet API server (same-origin, no CORS issues). Remote = browse to `https://your-fleet-server:3000`.

### 6. Fleet Server Docker Image (Control Plane)

**What**: A Docker image for running the Fleet API server itself.

**Design**:
- Dockerfile based on `node:22-alpine` with Next.js standalone output.
- `docker-compose.yml` with Fleet API + Docker socket mount for spawning agent containers.
- Volume mounts for DB persistence and Docker socket access.

---

## Recommended Phasing

### Phase 1 — Security Foundation (prerequisite)
- API key authentication middleware
- Credential store with encryption at rest
- CORS tightening
- Unblocks remote use even without containers

### Phase 2 — Remote Server Mode
- Fleet Server Docker image
- Connection flow in UI
- TLS support (or documented reverse proxy setup)
- Deployable remote Fleet

### Phase 3 — Container Runtime
- Container manager using Docker API
- Agent runtime base image
- Container isolation strategy in workspace manager
- Workspace provisioning (git clone / volume mount / upload)
- Container lifecycle management + health checks

### Phase 4 — Polish & Scale
- Container resource limits and quotas
- Multi-user support (if needed)
- Container registry integration
- Observability (logs, metrics from containers)

---

## Risks & Concerns

- **Docker-in-Docker complexity** — Fleet server in a container spawning other containers requires careful socket management.
- **Credential security** — storing API keys that can run up significant bills requires real encryption, not just base64.
- **Network latency** — SSE streams over the internet need reconnection handling, buffering, and possibly WebSocket fallback.
- **State management** — containers are ephemeral; if the Fleet server restarts, it needs to rediscover running containers and reconcile with its DB.
- **OpenCode in containers** — installing and authenticating OpenCode inside containers is a non-trivial bootstrapping problem (see `container-mvp.md`).
