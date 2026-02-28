# Weave Agent Fleet

A fleet orchestrator for managing multiple OpenCode AI agent sessions from a single web UI. Spawn, monitor, and interact with parallel AI coding agents across different workspaces.

## Quick Start

### Prerequisites

- [OpenCode CLI](https://opencode.ai) must be installed: `curl -fsSL https://opencode.ai/install | bash`

### Install

**macOS / Linux:**

```sh
curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex
```

### Run

```sh
weave-fleet
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Update

```sh
weave-fleet update
```

### Uninstall

```sh
weave-fleet uninstall
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOSTNAME` | `0.0.0.0` | Server hostname |
| `WEAVE_DB_PATH` | `~/.weave/fleet.db` (macOS/Linux), `%USERPROFILE%\.weave\fleet.db` (Windows) | SQLite database path |
| `WEAVE_INSTALL_DIR` | `~/.weave/fleet` (macOS/Linux), `%LOCALAPPDATA%\weave\fleet` (Windows) | Installation directory (used by installer) |

## Development

### Setup

```sh
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Commands

```sh
bun run dev          # Start development server
bun run build        # Production build
bun run lint         # Run ESLint
bun run typecheck    # TypeScript type checking
bun run test         # Run tests
bun run test:watch   # Run tests in watch mode
```

### Standalone Build

Build a self-contained distribution (used by the release workflow):

```sh
npm run build:standalone
```

This produces a standalone directory at `.next/standalone/` with all dependencies bundled.

## Architecture

- **Framework**: Next.js 16 (App Router) with React 19
- **Database**: SQLite via better-sqlite3 (stored at `~/.weave/fleet.db`)
- **AI Backend**: OpenCode SDK — each session spawns an `opencode serve` process
- **UI**: Tailwind CSS + Shadcn UI (Radix primitives)

## License

Private — see repository settings.
