# Credential Store & Workspace Provisioning

> Recorded: 2026-03-09
> Status: Planning
> Depends on: None (prerequisite for container MVP and remote Fleet)

## Problem Statement

When Fleet is remote (cloud-hosted, separate machine, etc.), two critical questions arise:

1. **Where do model provider credentials live?** The browser is a thin client with no persistent storage. Credentials can't live on the user's local machine if Fleet is elsewhere.
2. **How does code get into a container?** Volume mounts only work when Fleet and the code are on the same machine. In cloud scenarios, code must be fetched from a remote source.

Both problems converge on the same solution: **Fleet becomes the credential and workspace authority.**

---

## Credential Store Design

### Why Fleet Must Hold Credentials

- Fleet already runs arbitrary code — it's the most privileged component in the system
- The browser UI is stateless (thin client) — it can't hold secrets durably
- Containers are ephemeral — they can't own credentials
- Credentials need to be shared across sessions — a central store is the only sane option

### Credential Types

| Type | Examples | Used For |
|---|---|---|
| `model-provider` | Anthropic API key, OpenAI API key | LLM access in agent sessions |
| `git` | GitHub PAT, GitLab token, deploy key | Cloning repos into containers |
| `ssh-key` | SSH private key | Git clone over SSH, server access |
| `registry` | Docker/OCI registry credentials | Pulling custom agent images |
| `custom` | Any key-value secret | Future extensibility |

### Storage

**Database**: New `credentials` table in SQLite (`fleet.db`):

```sql
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'model-provider', 'git', 'ssh-key', 'registry', 'custom'
  provider TEXT,               -- e.g. 'anthropic', 'openai', 'github', 'gitlab'
  name TEXT NOT NULL,          -- Human-readable label
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Encryption at rest**: AES-256-GCM using a master key.

Master key options (in order of preference):
1. `FLEET_MASTER_KEY` env var — operator sets it on the Fleet server
2. Auto-generated and stored in `~/.weave/master.key` (file permissions: 0600)
3. Derived from `FLEET_API_KEY` via HKDF (ties auth and encryption together)

### API

```
POST   /api/credentials          — Create credential
GET    /api/credentials          — List credentials (values redacted)
GET    /api/credentials/:id      — Get credential (value redacted)
PUT    /api/credentials/:id      — Update credential
DELETE /api/credentials/:id      — Delete credential
```

Response format (values always redacted in list/get):
```json
{
  "id": "cred_abc123",
  "type": "model-provider",
  "provider": "anthropic",
  "name": "Production Anthropic Key",
  "maskedValue": "sk-ant-...7890",
  "createdAt": "2026-03-09T...",
  "updatedAt": "2026-03-09T..."
}
```

The full decrypted value is only used internally by the container manager / process manager when injecting credentials into sessions.

### UI

Settings page gets a "Credentials" or "Secrets" tab:
- List all stored credentials (masked values)
- Add new credential (type selector, provider, name, value)
- Edit/rotate existing credential
- Delete credential
- Test credential (optional: verify API key works by making a lightweight API call)

### Credential Injection into Sessions

When creating a session (local process or container), Fleet:

1. Queries the credential store for all `model-provider` type credentials
2. For **local processes**: Same as today — OpenCode reads from host `auth.json`. Optionally, Fleet writes a session-scoped `auth.json`.
3. For **containers**: Calls `PUT /auth/{providerID}` on the container's OpenCode API after it starts (proven in smoke test).

---

## Workspace Provisioning Design

### The Problem

Code must get into the agent's environment. The strategy depends on where Fleet and the code are:

| Scenario | Fleet Location | Code Location | Strategy |
|---|---|---|---|
| **Local dev** | Developer's machine | Developer's machine | Volume mount (existing `worktree`/`clone`/`existing`) |
| **Local Fleet + container** | Developer's machine | Developer's machine | Volume mount into container |
| **Remote Fleet** | Cloud/remote server | GitHub/GitLab/etc. | Git clone inside container |
| **Remote Fleet + large repo** | Cloud/remote server | GitHub/GitLab/etc. | Git sparse checkout or persistent volume |
| **Remote Fleet + private code** | Cloud/remote server | Private repo | Git clone with stored git credentials |

### Workspace Sources

A new concept: **Workspace Source** — describes where code comes from.

```typescript
type WorkspaceSource =
  | { type: "local"; path: string }                          // Volume mount
  | { type: "git"; url: string; branch?: string; sparse?: string[] }  // Git clone
  | { type: "volume"; volumeId: string }                     // Pre-existing persistent volume
  | { type: "upload"; }                                      // Upload from browser (future)
```

For the **local container MVP**: only `local` source is needed.
For **remote Fleet**: `git` source is the primary path.

### Git Clone Strategy for Large Repos

For large codebases, a full `git clone` is prohibitive. Options:

1. **Shallow clone** (`--depth=1`): Fast, gets only latest commit. Already used in `clone` strategy.
2. **Sparse checkout**: Clone only specific directories. Good for monorepos.
   ```bash
   git clone --filter=blob:none --sparse <url>
   git sparse-checkout set src/ tests/
   ```
3. **Persistent workspace volumes**: Clone once into a persistent volume (EBS, EFS). Subsequent sessions mount the same volume and do `git pull`. Amortizes clone cost.
4. **Workspace snapshots**: Periodically snapshot a cloned workspace. New containers start from the snapshot.

### Git Credential Flow (Remote Fleet)

```
User (browser)
  │
  ├── Stores GitHub PAT in Fleet credential store (once)
  │
  ▼
Fleet API
  │
  ├── Reads git credential from store
  ├── Creates container
  ├── Injects git credential as env var: GIT_TOKEN=ghp_...
  │
  ▼
Container
  │
  ├── Configures git: git config credential.helper '!f() { echo "password=$GIT_TOKEN"; }; f'
  ├── Clones repo: git clone https://x-access-token:$GIT_TOKEN@github.com/org/repo.git /workspace
  └── OpenCode operates on /workspace
```

### Persistent Volumes (Cloud Fleet)

For repeated work on the same repo in cloud environments:

```
First session:
  Fleet → Create EBS volume → Attach to container → git clone → Session works → Detach volume

Subsequent sessions:
  Fleet → Attach existing volume → git pull → Session works → Detach volume
```

This avoids re-cloning large repos and preserves any build caches, node_modules, etc.

---

## Revised Dependency Chain

```
Phase 0: Credential Store
  ├── SQLite encrypted credential table
  ├── CRUD API + UI
  └── Master key management
       │
Phase 1: Container MVP (local)
  ├── Container manager (podman/docker)
  ├── Volume mount workspace strategy
  ├── Credential injection via PUT /auth/{providerID}
  └── Basic lifecycle (create/start/health/stop/remove)
       │
Phase 2: API Security
  ├── API key authentication middleware
  ├── CORS tightening
  └── SSE auth (query param or handshake)
       │
Phase 3: Remote Fleet
  ├── Git clone workspace strategy
  ├── Git credential injection
  ├── Fleet Server Docker image
  └── Remote UI connection flow
       │
Phase 4: Cloud Scale
  ├── Persistent volume management
  ├── Sparse checkout for monorepos
  ├── Container resource limits
  ├── Multi-user credential isolation
  └── Cloud provider integrations (AWS ECS/EKS, GCP Cloud Run, etc.)
```

Note: Phase 0 (Credential Store) is now a prerequisite, not Phase 1. Without it, containers have no way to get credentials when Fleet is remote.

---

## Design Decisions Log

| Decision | Rationale |
|---|---|
| Fleet stores credentials, not the browser | Browser is stateless thin client; credentials must survive page refreshes, device switches |
| AES-256-GCM encryption at rest | Industry standard; prevents credential exposure if DB file is compromised |
| `PUT /auth/{providerID}` for container injection | Proven in smoke test; no file mounts needed; works after container startup |
| Git clone as primary remote workspace strategy | Universal (works with any git host); doesn't require cloud-specific infra |
| Persistent volumes for large repos | Amortizes clone cost; preserves caches; standard cloud pattern |
| Credential types beyond just model-provider | Git creds needed for remote clone; registry creds for custom images; future-proofs the store |
