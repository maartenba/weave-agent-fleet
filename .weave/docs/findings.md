# Research Findings & Technical Discoveries

> Captured during the initial spike phase (2026-02-27)

## 1. OpenCode Architecture

### What is OpenCode?
OpenCode is a **Go-based Bubble Tea TUI** that provides an AI coding assistant experience in the terminal. It has:
- An **HTTP API** for programmatic access
- A **TypeScript SDK** (`@opencode-ai/sdk`) for client integration
- **Headless mode** (`-p` flag with `-f json` output) for non-interactive use
- A `serve` subcommand that starts an HTTP server

### What is Weave?
**Weave** (`@opencode_weave/weave`) is a **plugin** for OpenCode — TypeScript running inside OpenCode's process. It is NOT a standalone application. It provides:
- 8 specialized agents: Loom (orchestrator), Tapestry (execution), Shuttle (specialist), Pattern (planner), Thread (explorer), Spindle (researcher), Weft (reviewer), Warp (security)
- Agent coordination, delegation chains, plan-driven execution
- Source lives at `/Users/pgermishuys/source/weave/`

### OpenCode SDK API Surface (`@opencode-ai/sdk`)

**Server lifecycle:**
```typescript
import { createOpencodeServer, createOpencodeClient, createOpencode } from "@opencode-ai/sdk";

// Option A: Separate server + client
const server = await createOpencodeServer({ port: 4097 });  // spawns `opencode serve`
const client = createOpencodeClient({ baseUrl: server.url });

// Option B: Convenience (spawns + connects)
const { client, server } = await createOpencode({ port: 4097 });
```

**Session operations:**
```typescript
const session = await client.session.create({ body: { title?: string, parentID?: string } });
const sessions = await client.session.list();
const detail = await client.session.get({ path: { id: sessionId } });
await client.session.promptAsync({
  path: { id: sessionId },
  body: { parts: [{ type: "text", text: "your prompt" }] }
});  // Returns 204 immediately (fire-and-forget)
```

**Event streaming (SSE):**
```typescript
// IMPORTANT: Returns Promise<{ stream: AsyncGenerator }>, NOT AsyncGenerator directly
const { stream } = await client.event.subscribe({ query: { directory } });
for await (const event of stream) {
  // event.type: "message.updated" | "message.part.updated" | "session.status" | ...
  // event.properties: varies by type
}
```

**Key SDK types:**
```typescript
// SDK Session (differs from our UI Session type)
interface Session {
  id: string;
  projectID: string;
  directory: string;
  title: string;  // required string, not optional
  version: number;
  time: { created: string; updated: string };
  parentID?: string;
  summary?: string;
}
```

### SSE Event Types
- `message.updated` — message lifecycle (created/updated). `properties.info.sessionID`
- `message.part.updated` — streaming text deltas. `properties.part.sessionID`
- `session.status` — idle/busy. `properties.sessionID`
- `session.created` — new session created
- `permission.updated` — agent requesting permission (edit files, run bash)

### Server Configuration
- Default port: 4096
- Config supports `permission: { edit: "allow", bash: "allow" }` for auto-approve
- The SDK package is **ESM-only** (`"type": "module"`) and uses `child_process` — requires `serverExternalPackages: ["@opencode-ai/sdk"]` in Next.js config

### Successor Project
OpenCode may be archived; successor is **Crush** by Charm (`github.com/charmbracelet/crush`).

---

## 2. Weave Brand Identity

Extracted from the Weave marketing website at `/Users/pgermishuys/source/weave-website/`.

### Visual Identity
- **Dark theme only** — no light mode
- **Signature gradient**: 135deg from `#3B82F6` → `#A855F7` → `#EC4899`
- **Naming convention**: Section labels use `{curly_brace}` monospace style
- **Logo**: `weave_logo.png` (rounded icon)
- **Favicon**: Inline data-URI SVG — gradient "W" letter

### Color Palette
| Role | Color | Hex |
|------|-------|-----|
| Page background | Slate-900 | `#0F172A` |
| Card background | Slate-800 | `#1E293B` |
| Hover/accent | Slate-700 | `#334155` |
| Sidebar | Deep navy | `#0B1120` |
| Primary text | — | `#F8FAFC` |
| Secondary text | — | `#CBD5E1` |
| Muted text | — | `#94A3B8` |

### Typography
- **Body**: Inter (weights 400-700)
- **Headings, code, brand**: JetBrains Mono (weights 400-600)

### Per-Agent Color System
Each Weave agent has a distinct color used consistently across session cards, activity streams, and sidebar token bars:

| Agent | Role | Color |
|-------|------|-------|
| Loom | Orchestrator | `#4A90D9` (blue) |
| Tapestry | Executor | `#D94A4A` (red) |
| Pattern | Planner | `#9B59B6` (purple) |
| Thread | Explorer | `#27AE60` (green) |
| Spindle | Researcher | `#F39C12` (orange) |
| Weft | Reviewer | `#1ABC9C` (teal) |
| Warp | Security | `#E74C3C` (crimson) |
| Shuttle | Specialist | `#E67E22` (dark orange) |

---

## 3. Data Model

### Core Entities
- **Workspace** — a managed directory with an OpenCode process (port, PID, isolation strategy)
- **Session** — an active agent conversation within a workspace (status, agent, tokens, cost, plan progress, tags, modified files)
- **SessionEvent** — append-only log entries (messages, tool calls, delegations, plan progress, cost updates)
- **Pipeline** — a DAG of stages with `dependsOn` and `contextFrom` arrays
- **PipelineStage** — one step in a pipeline, links to a session when running
- **TaskTemplate** — reusable prompt templates with `{{variable}}` placeholders
- **QueueItem** — queued tasks with priority ordering
- **Notification** — alerts for input-required, completion, errors, cost thresholds
- **FleetSummary** — aggregate statistics across all sessions

### Session Sources
Sessions can be created from 5 sources (discriminated union):
1. `manual` — user-initiated
2. `template` — from a task template
3. `batch` — part of a batch operation
4. `github` — triggered by a GitHub issue
5. `pipeline` — spawned by a pipeline stage

### Key Type Differences: SDK vs UI
The OpenCode SDK `Session` type is minimal (id, title, directory, timestamps). Our UI `Session` type is rich (tokens, cost, agent, plan progress, tags, modified files). The mapping layer needs to augment SDK data with orchestrator-tracked metadata.

---

## 4. Architecture Decisions

### Decision 1: Multi-Process + SDK + Web UI
Selected over alternatives (single-process, websocket, electron, VS Code extension). Each OpenCode instance runs as a separate process with its own HTTP server on a unique port. The orchestrator manages the fleet.

### Decision 2: SSE Proxy Pattern
Browser → Next.js API route → OpenCode SDK → OpenCode process. This avoids CORS issues and keeps OpenCode ports unexposed to the browser.

### Decision 3: Vertical Slices over Horizontal Layers
Implementation proceeds as end-to-end vertical slices rather than building all layers first:
- **V1**: Start session → Send prompt → Stream response (in progress)
- **V2**: Fleet view with real sessions, workspace management
- Future: Pipelines, templates, queues, notifications, GitHub integration

### Decision 4: Dark Mode Only
No light mode toggle. `className="dark"` is hardcoded on `<html>`. Matches the Weave website.

### Decision 5: Spike-First UI Development
Built the full UI skeleton with mock data first to iterate on UX before designing backend layers. This approach was validated — UI was approved before backend work began.

---

## 5. Phased Roadmap

| Phase | Feature | UI Status | Backend Status |
|-------|---------|-----------|----------------|
| P0 | Workspace Manager + Fleet View | ✅ Complete | ⬜ Not started |
| P1 | Session Detail + Activity Stream | ✅ Complete | ⬜ Not started |
| P2 | Persistence + History (SQLite) | ✅ Complete | ⬜ Not started |
| P3 | Templates + Queue | ✅ Complete | ⬜ Not started |
| P4 | Pipelines + DAG + Context Bridge | ✅ Complete | ⬜ Not started |
| P5 | GitHub integration | ⬜ Not started | ⬜ Not started |
| P6 | Notifications | ✅ Complete | ⬜ Not started |

---

## 6. RESOLVED: OpenCode Server Hang — Weave Plugin Deadlock

### Problem Statement
The OpenCode HTTP server starts successfully but **never responds to any HTTP requests**. This blocked the entire V1 plan — no sessions can be created, no prompts sent, no events streamed.

### Root Cause: Weave Plugin Deadlock

**The `@opencode_weave/weave@0.6.0` plugin causes a deadlock during server bootstrap.**

The sequence:
1. First HTTP request (e.g., `GET /session`) triggers lazy instance creation
2. Instance bootstrap loads plugins from the global config (`~/.config/opencode/opencode.json`)
3. The Weave plugin initialization calls `GET /skill` **back to the same server**
4. The server can't respond to `/skill` because it's still inside the bootstrap handler for `/session`
5. **Deadlock** — both requests wait forever

Debug log evidence:
```
INFO  service=server method=GET path=/session request           ← original request
INFO  service=default directory=... creating instance
INFO  service=plugin path=@opencode_weave/weave@0.6.0 loading plugin
INFO  service=server method=GET path=/skill request              ← plugin calls back!
                                                                 ← DEADLOCK: neither completes
```

### Why `OPENCODE_CONFIG_CONTENT='{"plugin":[]}'` Didn't Fix It

OpenCode merges configs from multiple sources (global → project → env var). The `OPENCODE_CONFIG_CONTENT` env var is loaded **last** but does NOT override array fields — it merges them. The global config at `~/.config/opencode/opencode.json` containing `"plugin":["@opencode_weave/weave@0.6.0"]` always loads.

### The Fix

**Isolate `XDG_CONFIG_HOME`** when spawning OpenCode server instances. Point it to a temp directory with a clean config that has no plugins:

```typescript
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Create isolated config dir
const configDir = join(tmpdir(), "opencode-orchestrator-config", "opencode");
mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ plugin: [] }));

// Set BEFORE spawning
process.env.XDG_CONFIG_HOME = join(tmpdir(), "opencode-orchestrator-config");

const server = await createOpencodeServer({
  port: 4097,
  config: {
    plugin: [],
    permission: { edit: "allow", bash: "allow" },
  },
});
```

### Validated Critical Path (2026-02-27)

All steps confirmed working with the fix applied:

| Step | API | Result |
|------|-----|--------|
| Server spawn | `createOpencodeServer()` | ✅ Starts in ~500ms |
| Session list | `GET /session` | ✅ Returns array of sessions |
| Session create | `POST /session` | ✅ Returns new session with ID |
| Event subscribe | `GET /event` (SSE) | ✅ Returns `{ stream: AsyncGenerator }` |
| Send prompt | `POST /session/{id}/prompt` | ✅ Returns 204, fire-and-forget |
| Stream response | SSE events | ✅ Receives `message.part.delta`, `message.part.updated`, `session.status` |
| Full cycle | prompt → response → idle | ✅ Agent responds with text, session goes idle |

### SSE Event Flow (observed)

A typical prompt→response cycle produces events in this order:
1. `message.updated` (role=user) — user message created
2. `message.part.updated` (type=text) — user message text
3. `session.status` (type=busy) — session becomes busy
4. `message.updated` (role=assistant) — assistant message created
5. `message.part.updated` (type=step-start) — agent step begins
6. `message.part.delta` — streaming text delta (the actual response text!)
7. `message.part.updated` (type=text) — final accumulated text
8. `message.part.updated` (type=step-finish) — agent step done (with cost/tokens)
9. `message.updated` (role=assistant) — assistant message finalized
10. `session.status` (type=idle) — session returns to idle
11. `session.idle` — explicit idle notification

**New event type discovered**: `message.part.delta` — not in the SDK types but emitted during streaming. Contains `{ sessionID, messageID, partID, field: "text", delta: "..." }`.

### Investigation History (for reference)

#### Attempt 1-3: Previous sessions
See git history for details on earlier debugging attempts.

#### Attempt 4: Systematic diagnosis (this session)
- Tested 5 config variations — all hung EXCEPT when config validation error triggered early response
- Discovered: server only responds when config validation FAILS (returns 500 immediately)
- Valid configs proceed to initialization → hang
- Debug logging revealed the Weave plugin deadlock
- Fixed by isolating `XDG_CONFIG_HOME`
- Full critical path validated end-to-end

### Spike Scripts
- `spike/validate-sdk.ts` — Original SDK test (hung due to plugin deadlock)
- `spike/validate-sdk-v2.ts` — Raw HTTP test (hung due to plugin deadlock)
- `spike/diagnose-server.ts` — Systematic hypothesis testing (identified the fix)
- `spike/validate-critical-path.ts` — **Full critical path validation (SUCCESS)**

---

## 7. Open Questions & Future Considerations

1. **OpenCode binary availability** — SDK spawns `opencode` from PATH. Binary must be installed. Consider adding a config option for the binary path.
2. **Single-directory limitation** — each `createOpencodeServer` is scoped to one directory. Multiple sessions in the same directory share one server instance.
3. **Permission UI** — OpenCode may pause for permission requests. V1 will auto-approve; V2 should show a permission dialog in the UI.
4. **Context Bridge** — for cross-session coordination, use hybrid approach: git diff for small changes, LLM-summarized context for large changes, key files in full.
5. **Workspace isolation** — `git worktree` for same-repo parallelism, full clones for different repos.
6. **Crush migration** — if OpenCode is archived in favor of Crush, the SDK integration layer will need updating.
