# Weave Agent Fleet — Project Overview

> **Last updated**: 2026-02-27
> **Status**: UI mockup complete (approved), V1 backend plan ready for execution
> **Location**: `/Users/pgermishuys/source/opencode-orchestrator/`

## What is this?

**Weave Agent Fleet** is a web-based dashboard for spawning, managing, monitoring, and coordinating multiple OpenCode TUI instances across different projects. It provides full orchestration-level control including task assignment, dependency graphs (pipelines), cross-session coordination, task queues, templates, notifications, and persistent searchable history.

## How to run

```bash
cd /Users/pgermishuys/source/opencode-orchestrator
npm run dev
# Open http://localhost:3000
```

The app currently runs entirely on **mock data** — no backend, no OpenCode processes. All pages are functional and navigable.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1.6 (App Router) |
| UI Components | shadcn/ui (12 components installed) |
| Styling | Tailwind CSS v4 + custom Weave theme |
| Fonts | Inter (body) + JetBrains Mono (headings, code) |
| Language | TypeScript 5 |
| State | React state (no external state management yet) |
| Data | Mock data (SQLite planned for persistence) |

## Architecture

**Option 2 — Multi-Process + SDK + Web UI** (selected):
- Spawn multiple OpenCode processes, each with its own server port
- Orchestrator connects to each via the `@opencode-ai/sdk` TypeScript SDK
- Web UI communicates with orchestrator's own API layer (Next.js API routes)
- Browser never talks to OpenCode directly — all proxied through Next.js

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Fleet Overview | Summary bar (8 stats) + grid of session cards |
| `/sessions/[id]` | Session Detail | Activity stream + sidebar (plan progress, agent activity, resources, files) + prompt input |
| `/pipelines` | Pipelines | Pipeline cards with stage flow (DAG arrows) |
| `/queue` | Task Queue | Running / Queued / Completed sections with priority badges |
| `/templates` | Templates | Template cards with variable badges + "Launch Session" button |
| `/alerts` | Alerts | Unread / Read notification list with type-specific icons |
| `/history` | History | Searchable table of all sessions (past + current) |

## Branding

Dark-only theme matching the [Weave website](https://weave.pgermishuys.dev).

| Element | Value |
|---------|-------|
| **Signature gradient** | 135deg from `#3B82F6` (blue) → `#A855F7` (purple) → `#EC4899` (pink) |
| **Page background** | `#0F172A` (slate-900) |
| **Card background** | `#1E293B` (slate-800) |
| **Sidebar background** | `#0B1120` (deeper navy) |
| **Hover/accent** | `#334155` (slate-700) |
| **Primary text** | `#F8FAFC` |
| **Secondary text** | `#CBD5E1` |
| **Muted text** | `#94A3B8` |
| **Primary (interactive)** | `#A855F7` (Weave purple) |
| **Body font** | Inter (400-700) |
| **Headings / code font** | JetBrains Mono (400-600) |
| **Favicon** | Inline SVG gradient "W" (blue→purple→pink) |
| **Logo** | `public/weave_logo.png` |

### Agent Colors

| Agent | Color | Hex |
|-------|-------|-----|
| Loom | Blue | `#4A90D9` |
| Tapestry | Red | `#D94A4A` |
| Pattern | Purple | `#9B59B6` |
| Thread | Green | `#27AE60` |
| Spindle | Orange | `#F39C12` |
| Weft | Teal | `#1ABC9C` |
| Warp | Crimson | `#E74C3C` |
| Shuttle | Dark Orange | `#E67E22` |

### CSS Utilities

- `.weave-gradient-text` — gradient text (background-clip)
- `.weave-gradient-bg` — gradient background
- `.weave-gradient-border` — gradient border

---

## Current Status: UNBLOCKED — Ready for V1 Execution

### ✅ Blocker Resolved: Weave Plugin Deadlock (2026-02-27)
The OpenCode server hang was caused by the `@opencode_weave/weave@0.6.0` plugin creating a deadlock during bootstrap. The plugin calls `GET /skill` back to the server while the server is still inside the request handler. **Fix**: Isolate `XDG_CONFIG_HOME` when spawning OpenCode instances. See `.weave/docs/findings.md` § 6 for full details.

### Critical Path Validated
All steps of the V1 flow have been validated end-to-end:
- ✅ Server spawn via SDK (`createOpencodeServer`)
- ✅ Session CRUD (list, create, get)
- ✅ SSE event subscription and streaming
- ✅ Prompt submission (fire-and-forget, 204)
- ✅ Response streaming (text deltas via `message.part.delta` events)
- ✅ Full lifecycle (busy → response → idle)

### Next Step
Execute the V1 plan at `.weave/plans/v1-session-prompt-response.md` (21 tasks, reviewed by Weft).
The process manager must include the `XDG_CONFIG_HOME` isolation in its spawn logic.

**V1 goal**: Start session → Send prompt → See streamed response.
