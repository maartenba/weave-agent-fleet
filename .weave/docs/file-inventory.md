# File Inventory — UI Mockup

> Complete listing of every file in the mockup, its purpose, and key details.

## Project Configuration

| File | Purpose |
|------|---------|
| `package.json` | Dependencies: Next.js 16.1.6, React 19, shadcn/ui, Tailwind v4, Lucide icons |
| `next.config.ts` | Currently empty config (will need `serverExternalPackages` for V1) |
| `tsconfig.json` | TypeScript configuration with `@/` path alias |
| `postcss.config.mjs` | PostCSS with Tailwind plugin |
| `components.json` | shadcn/ui configuration |

## Theme & Layout

### `src/app/globals.css`
Custom Weave dark theme replacing default shadcn zinc palette. Contains:
- All CSS custom properties for backgrounds, text, borders, sidebar
- Weave brand color variables (`--color-weave-blue/purple/pink`)
- Agent color variables (`--color-agent-loom` through `--color-agent-shuttle`)
- `.weave-gradient-text`, `.weave-gradient-bg`, `.weave-gradient-border` utilities
- Both `:root` and `.dark` selectors set to same values (dark-only app)

### `src/app/layout.tsx`
Root layout with:
- Inter + JetBrains Mono font loading via `next/font/google`
- Inline SVG favicon (gradient "W")
- `<html className="dark">` hardcoded
- `<Sidebar />` + `<main>` flex layout
- `<TooltipProvider>` wrapping everything

## Data Layer

### `src/lib/types.ts` (216 lines)
All TypeScript interfaces:
- `Workspace`, `WorkspaceStatus`
- `Session`, `SessionStatus`, `SessionSource`, `SessionSourceType`, `TokenUsage`, `FileChange`
- `SessionEvent`, `EventType`
- `Pipeline`, `PipelineStage`, `PipelineStatus`, `StageStatus`
- `TaskTemplate`, `TemplateVariable`
- `TaskQueue`, `QueueItem`, `QueueStatus`, `QueueItemStatus`
- `Notification`, `NotificationType`
- `FleetSummary`

### `src/lib/mock-data.ts` (801 lines)
Comprehensive mock data:
- **8 sessions** covering all statuses (active×4, idle, completed, error, waiting_input) and all source types (manual, template, batch, github, pipeline)
- **23 session events** for `sess-001` showing a realistic Weave workflow: user message → Loom delegation to Thread → Thread tool calls → delegation to Pattern → plan creation → Tapestry execution → Weft review → cost update
- **2 pipelines** (one running, one draft) with 4 and 3 stages respectively
- **4 templates** with variables and usage counts
- **8 queue items** (2 running, 4 queued, 2 completed)
- **4 notifications** (2 unread, 2 read)
- **Fleet summary** aggregate stats

Helper functions:
- `getSessionById(id)`, `getEventsForSession(sessionId)`
- `formatTokens(n)`, `formatCost(n)`, `formatDuration(seconds)`
- `getStatusColor(status)` → Tailwind text class
- `getStatusDot(status)` → Tailwind bg class

### `src/lib/utils.ts`
Standard shadcn `cn()` utility (clsx + tailwind-merge).

## Layout Components

### `src/components/layout/sidebar.tsx`
Left sidebar (w-56) with:
- Weave logo PNG (32×32) + "Weave" gradient text + "Agent Fleet" subtext
- 6 nav items: Fleet, Pipelines, Queue (badge: 4), Templates, Alerts (badge: 2), History
- Active state highlighting with `usePathname()`
- Settings link in footer
- Deep navy background (`bg-sidebar` → `#0B1120`)

### `src/components/layout/header.tsx`
Top header bar (h-14) with:
- `Header` component: title (font-mono), optional subtitle, optional actions slot
- Notification bell with gradient badge showing count
- `NewSessionButton` component: gradient background button with Plus icon

## Fleet View Components

### `src/components/fleet/summary-bar.tsx`
8-stat grid (responsive: 4 cols → 8 cols):
- Active, Idle, Completed, Errors (session counts)
- Cost, Tokens, Pipelines, Queued (aggregate metrics)
- Each with colored Lucide icon

### `src/components/fleet/session-card.tsx` (159 lines)
Rich session card showing:
- Status dot (animated pulse for active) + session name
- Agent badge (with per-agent background color) + source badge + status label
- Prompt preview (2-line clamp)
- Plan progress bar (if applicable)
- Stats row: tokens, cost, file count, time since creation
- Tags row
- Hover effect with arrow indicator
- Links to `/sessions/[id]`

## Session Detail Components

### `src/components/session/activity-stream.tsx` (215 lines)
Event timeline rendering all `EventType` variants:
- `message` — user/assistant messages with agent-colored names
- `delegation_start` — agent→agent arrows with reason
- `delegation_end` — return with token/duration stats
- `tool_call` — tool name + args + result + duration
- `plan_progress` — checkbox completion with task index
- `agent_switch` — from→to badges with reason
- `cost_update` — session cost + token count
- Per-agent colors applied to all agent names

### `src/components/session/session-sidebar.tsx` (187 lines)
Right sidebar (w-72) with 4 sections:
1. **Plan Progress** — checklist with completed/pending tasks, progress bar
2. **Agent Activity** — horizontal bar chart of tokens per agent (5 agents shown)
3. **Resources** — tokens, cost, cache hit %, context window usage bar
4. **Modified Files** — file list with add/modify/delete icons

### `src/components/session/prompt-input.tsx` (35 lines)
Message input at bottom of session detail:
- Text input + send button
- Form submission clears input
- Button disabled when empty
- `// TODO: Send via SDK` placeholder

## Pages

### `src/app/page.tsx` — Fleet Overview
- Header: "Agent Fleet" + active session count + New Session button
- SummaryBar with fleet aggregate stats
- Responsive grid (2→3→4 cols) of SessionCards

### `src/app/sessions/[id]/page.tsx` — Session Detail
- Header: session name, prompt as subtitle, status dot + agent badge
- Three-panel layout: activity stream (left, flex-1) + prompt input (bottom) + sidebar (right, w-72)
- 404 state when session not found

### `src/app/pipelines/page.tsx` — Pipelines
- Pipeline cards with stage flow (horizontal arrows between stage boxes)
- Each stage shows: name, status badge, token count
- Pipeline-level status badge

### `src/app/queue/page.tsx` — Task Queue
- Three sections: Running, Queued, Completed
- Each item shows: status dot, prompt, workspace path, priority badge, tokens/cost/duration stats
- Resume/Pause action buttons in header

### `src/app/templates/page.tsx` — Templates
- Card grid (2→3 cols)
- Each card: name, usage count badge, description, prompt preview (mono, 3-line clamp), variable badges, tag badges, "Launch Session" button

### `src/app/alerts/page.tsx` — Alerts
- Unread section (amber left border) + Read section (dimmed)
- Type-specific icons: MessageSquare (input), AlertCircle (error), CheckCircle (completed), GitBranch (pipeline)
- Type badges with colored backgrounds
- Timestamps

### `src/app/history/page.tsx` — History
- Search input with icon
- Full-width table: status dot, session name (linked), prompt, agent badge, tokens, cost, file count, start time
- Client-side filtering by name, prompt, or tag
- "No sessions match" empty state

## shadcn/ui Components Installed

12 components in `src/components/ui/`:
- `avatar.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`
- `dropdown-menu.tsx`, `input.tsx`, `progress.tsx`, `scroll-area.tsx`
- `separator.tsx`, `sheet.tsx`, `tabs.tsx`, `tooltip.tsx`

## Public Assets

| File | Description |
|------|-------------|
| `public/weave_logo.png` | Weave logo (copied from weave-website project) |

## Plans

| File | Description |
|------|-------------|
| `.weave/plans/v1-session-prompt-response.md` | V1 vertical slice implementation plan (21 tasks, reviewed by Weft) |
