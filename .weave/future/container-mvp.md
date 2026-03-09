# Container MVP — Feasibility Analysis & Design

> Recorded: 2026-03-09
> Status: Exploration / MVP Design
> Smoke Test: ✅ PASSED (2026-03-09)

## The Core Concern

Running OpenCode inside a Docker container requires solving two problems:
1. **Installation** — getting OpenCode into the container
2. **Authentication** — getting LLM provider credentials into the container

Both are solvable. Here's why and how.

---

## Key Findings

### OpenCode in Docker: Solved

- **Official Docker image exists**: `ghcr.io/anomalyco/opencode:latest` (linux/amd64, linux/arm64)
- **Headless operation works**: `opencode serve --hostname 0.0.0.0 --port 4096` — no TTY required
- **Server supports basic auth**: `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` env vars
- **SDK works over HTTP**: Fleet already talks to OpenCode via `@opencode-ai/sdk/v2` over `http://127.0.0.1:{port}` — changing this to a container IP/port is trivial

### Authentication: Three Options

OpenCode does NOT natively read `ANTHROPIC_API_KEY` from env. But there are three viable paths:

| Option | Mechanism | Complexity | MVP? |
|---|---|---|---|
| **A. Config file with env interpolation** | Mount `opencode.json` using `{env:ANTHROPIC_API_KEY}` syntax, pass env vars to container | Low | ✅ Yes |
| **B. Mount auth.json** | Generate auth.json on the host, mount into container at `~/.local/share/opencode/auth.json` | Low | ✅ Yes |
| **C. SDK auth endpoint** | After container starts, call `POST /auth` via SDK to set credentials programmatically | Medium | Possible |

**Recommended for MVP: Option A** — it's the simplest and most Docker-native approach.

```jsonc
// opencode.json mounted into container
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

```bash
docker run -d \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -p 4096:4096 \
  ghcr.io/anomalyco/opencode:latest \
  opencode serve --hostname 0.0.0.0 --port 4096
```

### How Fleet Currently Spawns Instances

The process manager (`src/lib/server/process-manager.ts`):
1. Allocates a port from range 4097–4200
2. Spawns `opencode serve --hostname=127.0.0.1 --port={port}`
3. Passes config via `OPENCODE_CONFIG_CONTENT` env var (plugin disable, permissions, model overrides)
4. Waits for stdout line: `"opencode server listening on http://..."`
5. Creates an SDK client pointing at the URL
6. Registers the instance in SQLite

For containers, step 2 changes from `spawn()` to `docker create + docker start`, and step 4 changes from stdout parsing to health-check polling.

---

## MVP Design: `container` Isolation Strategy

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Fleet API (host or container)                  │
│                                                 │
│  ┌─────────────────┐  ┌─────────────────┐      │
│  │ Process Manager  │  │Container Manager│      │
│  │ (local instances)│  │(Docker instances)│     │
│  └────────┬────────┘  └────────┬────────┘      │
│           │                    │                 │
│     spawn process         docker create         │
│           │                    │                 │
│  ┌────────▼────────┐  ┌───────▼─────────┐      │
│  │ opencode serve  │  │  Docker Engine   │      │
│  │ (local process) │  │  API / Socket    │      │
│  └─────────────────┘  └───────┬─────────┘      │
│                               │                 │
│                    ┌──────────▼──────────┐      │
│                    │  Agent Container    │      │
│                    │  ┌──────────────┐   │      │
│                    │  │opencode serve│   │      │
│                    │  │  :4096       │   │      │
│                    │  └──────────────┘   │      │
│                    │  + mounted code     │      │
│                    │  + injected creds   │      │
│                    └─────────────────────┘      │
│                                                 │
│  SDK client connects to container:mapped-port   │
└─────────────────────────────────────────────────┘
```

### New Component: Container Manager

`src/lib/server/container-manager.ts` — parallel to `process-manager.ts`

```typescript
interface ContainerInstance {
  id: string;              // Fleet instance ID
  containerId: string;     // Docker container ID
  containerName: string;   // Human-readable name
  port: number;            // Mapped host port
  url: string;             // http://127.0.0.1:{port}
  directory: string;       // Source directory (on host)
  client: OpencodeClient;  // SDK client
  status: "creating" | "running" | "stopping" | "dead";
  createdAt: Date;
}
```

Lifecycle:
1. **Create**: `docker create` with image, port mapping, env vars, volume mount
2. **Start**: `docker start` → poll health endpoint until ready
3. **Monitor**: Periodic `docker inspect` or health check via SDK
4. **Stop**: `docker stop` → `docker rm`

### Workspace Strategy: `container`

Added to `workspace-manager.ts`:

```typescript
case "container": {
  // The "workspace" is the source directory on the host.
  // The container manager handles creating the container
  // and mounting the directory into it.
  // We still create a workspace record for tracking.
  insertWorkspace({
    id,
    directory: sourceDirectory,
    isolation_strategy: "container",
    source_directory: sourceDirectory,
  });
  return { id, directory: sourceDirectory, strategy };
}
```

### Credential Injection Flow

For the MVP, credentials flow like this:

```
Fleet API
  │
  ├── reads host auth.json (existing auth-store.ts)
  │   OR
  ├── reads from Fleet credential config (future)
  │
  ▼
Container Manager
  │
  ├── generates opencode.json with {env:VAR} references
  ├── passes API keys as container env vars
  │   (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
  │
  ▼
Docker Container
  │
  ├── opencode.json resolves {env:ANTHROPIC_API_KEY}
  └── opencode serve starts with working credentials
```

For the MVP, the simplest approach: **read the host's environment variables and forward them to the container**. If `ANTHROPIC_API_KEY` is set on the Fleet host, pass it through.

### Docker Library

Use `dockerode` (Node.js Docker client) or shell out to `docker` CLI.

**dockerode approach** (recommended):
```typescript
import Docker from "dockerode";
const docker = new Docker(); // connects to /var/run/docker.sock

const container = await docker.createContainer({
  Image: "ghcr.io/anomalyco/opencode:latest",
  Cmd: ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"],
  Env: [
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
    `OPENCODE_CONFIG_CONTENT=${JSON.stringify(config)}`,
  ],
  ExposedPorts: { "4096/tcp": {} },
  HostConfig: {
    PortBindings: { "4096/tcp": [{ HostPort: String(allocatedPort) }] },
    Binds: [`${sourceDirectory}:/workspace:rw`],
  },
});
await container.start();
```

**CLI approach** (simpler, less control):
```typescript
execFileSync("docker", [
  "run", "-d",
  "--name", containerName,
  "-p", `${allocatedPort}:4096`,
  "-v", `${sourceDirectory}:/workspace`,
  "-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
  "ghcr.io/anomalyco/opencode:latest",
  "opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"
]);
```

---

## MVP Scope

### In Scope
- [ ] `container-manager.ts` — create, start, stop, remove containers
- [ ] New `container` isolation strategy in workspace manager
- [ ] Container health check (poll `/session` endpoint)
- [ ] Credential forwarding via env vars
- [ ] Integration with existing session creation flow (API route creates container instead of process)
- [ ] Basic cleanup (stop + remove container on session delete)

### Out of Scope (Future)
- Fleet API authentication (skip for MVP — localhost only)
- Encrypted credential store (use host env vars for now)
- Custom Docker images (use official opencode image)
- Resource limits (CPU, memory caps)
- Container networking (use host port mapping)
- Remote Docker hosts (local socket only)
- git clone inside container (mount host directory for now)
- Container logs streaming to Fleet UI

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `OPENCODE_CONFIG_CONTENT` may not work in container | ~~Medium~~ | ~~Test with official image~~ **VERIFIED: Works ✅** |
| `{env:VAR}` interpolation in opencode.json may not resolve | ~~Medium~~ | Not needed — using `PUT /auth/{providerID}` API instead |
| Docker socket permissions on Linux | Low | Document: user must be in `docker` group or use sudo |
| Port exhaustion with many containers | Low | Same port allocation as process manager (4097–4200 range) |
| Container startup time | Low | Official image likely pre-built; expect 2-5s startup |
| OpenCode working directory in container | Medium | Need to verify `opencode serve` respects `--cwd` or similar; may need to `cd /workspace` in entrypoint |

---

## Verification Steps for MVP

1. ~~**Manual test first**~~: ✅ Done — opencode serve starts and responds in container
2. ~~**SDK connectivity**~~: ✅ Done — session creation via HTTP works
3. ~~**Credential flow**~~: ✅ Done — `PUT /auth/{providerID}` works programmatically
4. **Volume mount**: Verify a mounted host directory is accessible to opencode inside the container
5. **Full integration**: Wire up container-manager.ts and create a session through the Fleet API

---

## Smoke Test Results (2026-03-09)

Tested with **Podman 5.7.0** on Windows (functionally equivalent to Docker).

### Test 1: Basic `opencode serve` in container ✅
```bash
podman run -d --name weave-smoke-test -p 4096:4096 \
  ghcr.io/anomalyco/opencode:latest \
  serve --hostname 0.0.0.0 --port 4096
```
**Result**: Container started successfully. Logs show:
```
Performing one time database migration, may take a few minutes...
sqlite-migration:done
Database migration complete.
Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.
opencode server listening on http://0.0.0.0:4096
```

### Test 2: Session endpoint responds ✅
```bash
curl -s http://localhost:4096/session
# Returns: []
```

### Test 3: `OPENCODE_CONFIG_CONTENT` env var ✅
```bash
podman run -d --name weave-smoke-test -p 4096:4096 \
  -e OPENCODE_CONFIG_CONTENT='{"plugin":[],"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}' \
  ghcr.io/anomalyco/opencode:latest \
  serve --hostname 0.0.0.0 --port 4096
```
**Result**: Starts cleanly with config applied. This is the same env var Fleet uses for local processes.

### Test 4: Session creation via HTTP ✅
```bash
curl -s -X POST http://localhost:4096/session -H "Content-Type: application/json" -d "{}"
```
**Result**: Returns session object:
```json
{"id":"ses_...","slug":"stellar-cabin","version":"1.2.24","directory":"/","title":"New session - ..."}
```

### Test 5: Credential injection via API ✅
```bash
curl -s -X PUT http://localhost:4096/auth/anthropic \
  -H "Content-Type: application/json" \
  -d '{"type":"api","key":"sk-ant-test-fake-key-12345"}'
# Returns: true
```
**Result**: Credential stored successfully. Verified via `GET /config/providers` — the key appears in the Anthropic provider config.

### Test 6: OpenAPI spec available ✅
```bash
curl -s http://localhost:4096/doc
```
**Result**: Full OpenAPI 3.1 spec returned (141KB+). All endpoints documented.

### Key Observations
- **Image**: `ghcr.io/anomalyco/opencode:latest` — entrypoint is `opencode`, working dir is `/`
- **Startup time**: ~5 seconds (includes SQLite migration on first run)
- **Auth API**: `PUT /auth/{providerID}` accepts `{"type":"api","key":"..."}` — **this is the best credential injection path** (Option C from above). It's programmatic, doesn't require file mounts, and can be called after the container starts.
- **No volume mount tested yet**: Need to test workspace directory mounting separately
- **Podman works**: Full Docker API compatibility — `dockerode` or CLI approach both viable

### Revised Credential Injection Recommendation

The smoke test revealed that **Option C (SDK auth endpoint)** is actually the cleanest path:

1. Fleet starts the container with `OPENCODE_CONFIG_CONTENT` for config (plugins, permissions, model overrides)
2. Fleet waits for the container to be healthy (poll `GET /session`)
3. Fleet calls `PUT /auth/{providerID}` with the API key for each configured provider
4. No file mounts needed for credentials — everything is API-driven

This is simpler than Option A (config file interpolation) and more secure than Option B (mounting auth.json).

---

## Remaining Open Questions

1. ~~Does the official opencode Docker image set a working directory?~~ **ANSWERED**: Working dir is `/`. Need to test if opencode operates on a mounted `/workspace` directory correctly.
2. ~~Does `OPENCODE_CONFIG_CONTENT` work in the official image?~~ **ANSWERED**: ✅ Yes.
3. **What user does opencode run as in the container?** File permissions on mounted volumes depend on this.
4. **Does opencode need git init in the workspace?** Some features may require a git repo.
5. **Windows compatibility**: Tested with Podman on Windows — works. Docker Desktop should also work.
6. **Volume mount behavior**: Need to test mounting a host directory and having opencode operate on files within it.
