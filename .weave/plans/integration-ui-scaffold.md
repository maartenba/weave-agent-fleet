# Integration UI Scaffold — Empty Shells with Mock Data

## TL;DR
> **Summary**: Scaffold empty UI components for the integration framework (settings tab, sidebar button, hub page, GitHub browser) using hardcoded mock data — no API calls, no server logic, no hooks. Validates layout and navigation flow before the full build.
> **Estimated Effort**: Short

## Context
### Original Request
Before building the full pluggable integration framework (see `.weave/plans/github-integration.md`), scaffold just the UI shells — empty components with hardcoded mock data — so the layout, navigation, and component placement can be reviewed visually.

### Key Findings

**Sidebar (`src/components/layout/sidebar.tsx`)**:
- Footer section (lines 301–383) contains Settings link → Collapse toggle → Version info
- Both collapsed and expanded variants exist for each footer item
- Collapsed: `<Tooltip><TooltipTrigger asChild><Link>` with icon-only, tooltip on right
- Expanded: `<Link>` with icon + label text, `gap-3 px-3 py-2`
- Active state: `bg-sidebar-accent text-sidebar-accent-foreground`
- Inactive state: `text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground`
- Icons are `h-4 w-4` from lucide-react
- Links use `pathname.startsWith("/...")` for active detection

**Settings page (`src/app/settings/page.tsx`)**:
- Uses `<Header>` with title and subtitle
- `<Tabs defaultValue="skills">` with `<TabsList variant="line">`
- 6 existing tabs: Skills, Agents, Providers, Keybindings, Appearance, About
- Each tab content component is in `src/components/settings/`
- Tab content renders with `className="mt-4"`
- Page layout: `<div className="flex flex-col h-full">` → `<Header>` → `<div className="flex-1 overflow-auto p-6">`

**Settings tab patterns** (from `providers-tab.tsx`, `appearance-tab.tsx`):
- `"use client"` directive
- Cards use `<Card>` → `<CardContent className="p-4 space-y-2">`
- Status badges: Connected = `<Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">` with `<Wifi>` icon
- Not Connected = `<Badge variant="outline" className="text-[10px] text-muted-foreground">` with `<WifiOff>` icon
- Grid layout: `<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">`
- Empty state: centered icon (opacity-40) + text + code snippet

**Page structure pattern**:
- Pages are `"use client"` with default export
- Layout: `<div className="flex flex-col h-full">` → `<Header>` → content area
- Middle pane renders whatever the page returns
- Hub page at `/integrations` follows same pattern as `/settings`

**Available UI primitives**: Tabs, Card, Badge, Button, Input, ScrollArea, Collapsible, Separator, Select, Tooltip — all in `src/components/ui/`

## Objectives
### Core Objective
Place empty/mock UI components in their final intended locations so the integration layout and navigation flow can be visually validated.

### Deliverables
- [x] Settings > Integrations tab with a mock GitHub integration card
- [x] Sidebar "Integrations" button (above Settings)
- [x] Integration hub page at `/integrations`
- [x] Mock GitHub browser with repo selector, issue list, PR list
- [x] Mock issue/PR rows with expandable detail and "Create Session" buttons

### Definition of Done
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] Navigating to `/settings` shows the "Integrations" tab
- [ ] Sidebar shows "Integrations" button that links to `/integrations`
- [ ] `/integrations` page renders mock GitHub browser with issues and PRs
- [ ] All mock components render without errors in both light and dark mode

### Guardrails (Must NOT)
- Must NOT create API routes, server-side files, or hooks
- Must NOT modify `api-types.ts`, `use-create-session.ts`, or session routes
- Must NOT create framework files (`types.ts`, `registry.ts`, `integration-store.ts`)
- Must NOT add any `fetch()`, `apiFetch()`, or `useEffect` data-fetching calls
- Must NOT install new npm dependencies
- Must NOT create context providers or modify `client-layout.tsx`

## TODOs

- [x] 1. **Create the Integrations settings tab component**
  **What**: A new `IntegrationsTab` component that renders a mock GitHub integration card. Uses `useState` for a local `isConnected` toggle so the reviewer can flip between connected/disconnected states. When disconnected: shows GitHub icon, name, description, a masked token `<Input type="password">` field, and a "Connect" button. When connected: shows "Connected" badge and "Disconnect" button. All purely local state — no API calls.
  **Files**:
  - Create `src/components/settings/integrations-tab.tsx`
  **Details**:
  - `"use client"` directive
  - Import `useState` from React
  - Import `Github` from `lucide-react` for the icon
  - Import `Card`, `CardContent` from `@/components/ui/card`
  - Import `Badge` from `@/components/ui/badge`
  - Import `Button` from `@/components/ui/button`
  - Import `Input` from `@/components/ui/input`
  - Import `Wifi`, `WifiOff` from `lucide-react` (match providers-tab badge pattern)
  - Local state: `const [isConnected, setIsConnected] = useState(false)`
  - Layout: `<div className="space-y-4">` → summary text → grid with a single card
  - Card follows the `providers-tab.tsx` Card pattern exactly:
    ```
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h4 className="text-sm font-semibold">GitHub</h4>
          </div>
          {connected badge or not-connected badge — same classes as providers-tab}
        </div>
        <p className="text-xs text-muted-foreground">Browse repositories, issues, and pull requests. Create sessions with context from GitHub.</p>
        {!isConnected ? (
          <div className="space-y-2">
            <Input type="password" placeholder="ghp_xxxxxxxxxxxx" disabled={false} />
            <Button size="sm" onClick={() => setIsConnected(true)}>Connect</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setIsConnected(false)}>Disconnect</Button>
        )}
      </CardContent>
    </Card>
    ```
  - Grid wrapper: `<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">`
  **Acceptance**: Component renders without errors. Clicking Connect/Disconnect toggles state. Badge changes between green "Connected" and outline "Not Connected".

- [x] 2. **Add Integrations tab to Settings page**
  **What**: Add a new `TabsTrigger` and `TabsContent` for "Integrations" to the settings page. Position it after "Appearance" and before "About" to match the full plan.
  **Files**:
  - Modify `src/app/settings/page.tsx`
  **Details**:
  - Add import: `import { IntegrationsTab } from "@/components/settings/integrations-tab";`
  - Add `<TabsTrigger value="integrations">Integrations</TabsTrigger>` after the "appearance" trigger and before the "about" trigger
  - Add `<TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>` after the "appearance" content and before the "about" content
  - No other changes to this file
  **Acceptance**: Settings page shows 7 tabs. Clicking "Integrations" renders the mock card.

- [x] 3. **Add Integrations button to sidebar**
  **What**: Add a new "Integrations" link in the sidebar footer, positioned between the nav/content area and the existing Settings link. Follows the exact same collapsed/expanded pattern as Settings. Always visible (in the full version it would be conditional on connected integrations, but for the scaffold we always show it).
  **Files**:
  - Modify `src/components/layout/sidebar.tsx`
  **Details**:
  - Add `Blocks` to the lucide-react import (used as the integrations icon — visually represents modules/integrations)
  - Insert the integrations link in the footer `<div>` (line 302), BEFORE the Settings link (line 303-334)
  - Collapsed variant (copy the exact Settings collapsed pattern, lines 304-319):
    ```tsx
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/integrations"
          className={cn(
            "flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/integrations")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          <Blocks className="h-4 w-4 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">Integrations</TooltipContent>
    </Tooltip>
    ```
  - Expanded variant (copy the exact Settings expanded pattern, lines 321-333):
    ```tsx
    <Link
      href="/integrations"
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        pathname.startsWith("/integrations")
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
      )}
    >
      <Blocks className="h-4 w-4" />
      <span className="whitespace-nowrap">Integrations</span>
    </Link>
    ```
  - Wrap in the same `{collapsed ? (...) : (...)}` conditional pattern
  **Acceptance**: Sidebar shows "Integrations" button in both collapsed and expanded states. Active highlight when on `/integrations`. Navigates to `/integrations`.

- [x] 4. **Create the integration hub page**
  **What**: A Next.js page at `/integrations` that renders in the middle pane. Shows `<Header>` and a tab for the mock GitHub integration, which renders the mock browser component (created in task 5).
  **Files**:
  - Create `src/app/integrations/page.tsx`
  **Details**:
  - `"use client"` directive, default export
  - Import `Header` from `@/components/layout/header`
  - Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
  - Import `Github` from `lucide-react`
  - Import the mock browser component: `import { MockGitHubBrowser } from "@/integrations/github/mock-browser"`
  - Layout follows the settings page pattern exactly:
    ```tsx
    <div className="flex flex-col h-full">
      <Header title="Integrations" subtitle="Browse connected integrations" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="github">
          <TabsList variant="line">
            <TabsTrigger value="github" className="gap-1.5">
              <Github className="h-3.5 w-3.5" />
              GitHub
            </TabsTrigger>
          </TabsList>
          <TabsContent value="github" className="mt-4">
            <MockGitHubBrowser />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    ```
  **Acceptance**: `/integrations` renders with header, GitHub tab, and mock browser content.

- [x] 5. **Create mock GitHub browser component**
  **What**: The main mock browser UI showing a repo selector button, sub-tabs for Issues and Pull Requests, and rendering mock lists. All data hardcoded.
  **Files**:
  - Create `src/integrations/github/mock-browser.tsx`
  **Details**:
  - `"use client"` directive
  - Named export `MockGitHubBrowser`
  - Import `useState` from React
  - Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
  - Import `Button` from `@/components/ui/button`
  - Import `Badge` from `@/components/ui/badge`
  - Import `ScrollArea` from `@/components/ui/scroll-area`
  - Import `ChevronDown`, `GitPullRequest`, `CircleDot`, `RefreshCw` from `lucide-react`
  - Import `MockIssueRow` from `./components/mock-issue-row`
  - Import `MockPrRow` from `./components/mock-pr-row`
  - Top bar: a button showing the mock selected repo `"acme/my-project"` with `<ChevronDown>` icon (non-functional dropdown), plus a refresh icon button
    ```tsx
    <div className="flex items-center gap-2 mb-4">
      <Button variant="outline" size="sm" className="gap-1.5">
        acme/my-project
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm">
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
    ```
  - Sub-tabs for Issues / Pull Requests:
    ```tsx
    <Tabs defaultValue="issues">
      <TabsList variant="line">
        <TabsTrigger value="issues" className="gap-1.5">
          <CircleDot className="h-3.5 w-3.5" />
          Issues
          <Badge variant="secondary" className="text-[10px] ml-1">4</Badge>
        </TabsTrigger>
        <TabsTrigger value="pulls" className="gap-1.5">
          <GitPullRequest className="h-3.5 w-3.5" />
          Pull Requests
          <Badge variant="secondary" className="text-[10px] ml-1">3</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="issues" className="mt-4">
        <div className="space-y-1">
          {MOCK_ISSUES.map(issue => <MockIssueRow key={issue.number} {...issue} />)}
        </div>
      </TabsContent>
      <TabsContent value="pulls" className="mt-4">
        <div className="space-y-1">
          {MOCK_PRS.map(pr => <MockPrRow key={pr.number} {...pr} />)}
        </div>
      </TabsContent>
    </Tabs>
    ```
  - Define `MOCK_ISSUES` array at module level with 4 items:
    ```ts
    const MOCK_ISSUES = [
      { number: 42, title: "Add dark mode support for dashboard widgets", labels: [{ name: "enhancement", color: "a2eeef" }, { name: "ui", color: "d4c5f9" }], commentCount: 3, author: "alice", age: "2 hours ago" },
      { number: 41, title: "Fix memory leak in WebSocket reconnection handler", labels: [{ name: "bug", color: "d73a4a" }, { name: "priority: high", color: "e11d48" }], commentCount: 7, author: "bob", age: "5 hours ago" },
      { number: 39, title: "Upgrade to React 19 and fix hydration mismatches", labels: [{ name: "dependencies", color: "0075ca" }], commentCount: 1, author: "charlie", age: "1 day ago" },
      { number: 37, title: "Document the plugin architecture and extension points", labels: [{ name: "documentation", color: "0075ca" }], commentCount: 0, author: "alice", age: "3 days ago" },
    ];
    ```
  - Define `MOCK_PRS` array at module level with 3 items:
    ```ts
    const MOCK_PRS = [
      { number: 40, title: "feat: implement streaming response handler", labels: [{ name: "feature", color: "a2eeef" }], additions: 342, deletions: 28, branch: "feat/streaming", draft: false, author: "alice", age: "1 hour ago" },
      { number: 38, title: "refactor: extract session state machine", labels: [{ name: "refactor", color: "d4c5f9" }], additions: 156, deletions: 203, branch: "refactor/session-fsm", draft: false, author: "bob", age: "6 hours ago" },
      { number: 36, title: "WIP: experimental multi-agent orchestration", labels: [{ name: "experimental", color: "fbca04" }], additions: 89, deletions: 12, branch: "experiment/multi-agent", draft: true, author: "charlie", age: "2 days ago" },
    ];
    ```
  **Acceptance**: Component renders repo button, issues tab (4 items), PRs tab (3 items).

- [x] 6. **Create mock issue row component**
  **What**: An expandable issue row using `Collapsible`. Collapsed: shows issue number, title, label badges, comment count, author, age, and a "Create Session" button. Expanded: shows mock issue body text, mock comments, and labels.
  **Files**:
  - Create `src/integrations/github/components/mock-issue-row.tsx`
  **Details**:
  - `"use client"` directive
  - Named export `MockIssueRow`
  - Props: `{ number: number; title: string; labels: Array<{ name: string; color: string }>; commentCount: number; author: string; age: string }`
  - Import `useState` from React
  - Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`
  - Import `Badge` from `@/components/ui/badge`
  - Import `Button` from `@/components/ui/button`
  - Import `MessageSquare`, `ChevronRight`, `Rocket` from `lucide-react`
  - Local state: `const [isOpen, setIsOpen] = useState(false)`
  - Collapsed row (the trigger):
    ```tsx
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors group">
        <CollapsibleTrigger className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <span className="text-xs text-muted-foreground font-mono shrink-0">#{number}</span>
          <span className="text-sm truncate">{title}</span>
          <div className="flex items-center gap-1 shrink-0">
            {labels.map(l => (
              <Badge key={l.name} variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: `#${l.color}`, color: `#${l.color}` }}>
                {l.name}
              </Badge>
            ))}
          </div>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2 shrink-0">
          {commentCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {commentCount}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{author}</span>
          <span className="text-xs text-muted-foreground">{age}</span>
          <Button size="xs" variant="outline" className="opacity-0 group-hover:opacity-100 transition-opacity gap-1" onClick={(e) => { e.stopPropagation(); }}>
            <Rocket className="h-3 w-3" />
            Create Session
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        {/* Mock expanded content */}
        <div className="ml-9 mr-3 mb-3 p-4 rounded-md border bg-muted/30 space-y-3">
          <p className="text-sm text-muted-foreground">
            This is a mock issue body. In the real implementation, this will render the full GitHub issue body as markdown, including code blocks, images, and task lists.
          </p>
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Comments ({commentCount})</p>
            {commentCount > 0 ? (
              <div className="space-y-2">
                <div className="text-xs space-y-1">
                  <span className="font-medium">@{author}</span>
                  <span className="text-muted-foreground ml-2">2 hours ago</span>
                  <p className="text-muted-foreground mt-1">This is a mock comment. The real implementation will show actual GitHub comments with markdown rendering.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            )}
          </div>
          <div className="border-t pt-3">
            <Button size="sm" className="gap-1.5" onClick={() => {}}>
              <Rocket className="h-3.5 w-3.5" />
              Create Session From Issue
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
    ```
  - Import `cn` from `@/lib/utils` for the chevron rotation
  **Acceptance**: Issue row renders in collapsed state. Clicking expands to show mock body/comments. "Create Session" button visible on hover in collapsed state and always visible in expanded state. Labels render with their color.

- [x] 7. **Create mock PR row component**
  **What**: Same expandable pattern as issue row, but with PR-specific data: additions/deletions, branch name, draft badge. Expanded view shows diff stats and mock comments.
  **Files**:
  - Create `src/integrations/github/components/mock-pr-row.tsx`
  **Details**:
  - `"use client"` directive
  - Named export `MockPrRow`
  - Props: `{ number: number; title: string; labels: Array<{ name: string; color: string }>; additions: number; deletions: number; branch: string; draft: boolean; author: string; age: string }`
  - Same imports as `MockIssueRow` plus `GitBranch` from `lucide-react`
  - Same `Collapsible` pattern as issue row with these differences:
  - Collapsed row additionally shows:
    - `+{additions} -{deletions}` in green/red text (like session detail's diff stats: `<span className="text-green-500">+{additions}</span> <span className="text-red-500">-{deletions}</span>`)
    - Branch name in a `<Badge variant="outline" className="text-[10px] font-mono">` with `<GitBranch>` icon
    - If `draft`: a `<Badge variant="secondary" className="text-[10px]">Draft</Badge>`
  - Expanded content:
    - Mock PR body text (similar to issue)
    - Diff stats line: `"{additions + deletions} lines changed across N files"` (hardcode N as something like "5 files")
    - Mock comments section (same pattern as issue)
    - "Create Session From PR" button
  **Acceptance**: PR row renders with diff stats, branch badge, and optional draft badge. Expands to show mock detail.

## File Summary

### New Files (5)
| File | Task | Purpose |
|------|------|---------|
| `src/components/settings/integrations-tab.tsx` | 1 | Mock GitHub integration card for settings |
| `src/app/integrations/page.tsx` | 4 | Integration hub page (middle pane) |
| `src/integrations/github/mock-browser.tsx` | 5 | Mock GitHub browser with repo selector + tabs |
| `src/integrations/github/components/mock-issue-row.tsx` | 6 | Expandable mock issue row |
| `src/integrations/github/components/mock-pr-row.tsx` | 7 | Expandable mock PR row |

### Modified Files (2)
| File | Task | Change |
|------|------|--------|
| `src/app/settings/page.tsx` | 2 | Add `Integrations` TabsTrigger + TabsContent |
| `src/components/layout/sidebar.tsx` | 3 | Add `Integrations` link in footer before Settings |

### Files NOT Modified (guardrails)
- `src/lib/api-types.ts` — no type changes
- `src/hooks/use-create-session.ts` — no hook changes
- `src/app/api/**` — no API routes
- `src/app/client-layout.tsx` — no context providers
- `src/integrations/types.ts` — not created (framework file)
- `src/integrations/registry.ts` — not created (framework file)

## Implementation Order

```
Task 1: integrations-tab.tsx (standalone, no deps)
Task 6: mock-issue-row.tsx  (standalone, no deps)    ← parallel with 1
Task 7: mock-pr-row.tsx     (standalone, no deps)    ← parallel with 1, 6
Task 5: mock-browser.tsx    (depends on 6, 7 — imports mock rows)
Task 2: settings/page.tsx   (depends on 1 — imports IntegrationsTab)
Task 3: sidebar.tsx         (standalone, no deps — but do after 4 so /integrations exists)
Task 4: integrations/page.tsx (depends on 5 — imports MockGitHubBrowser)
```

Optimal parallel execution: Tasks 1, 6, 7 can run simultaneously, then 5, then 2 + 3 + 4.

## Verification
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] No regressions — existing pages render correctly
- [ ] `/settings` → "Integrations" tab renders mock card with connect/disconnect toggle
- [ ] Sidebar shows "Integrations" button in both collapsed and expanded states
- [ ] `/integrations` renders with GitHub tab, repo selector, issues list, PR list
- [ ] Issue rows expand/collapse with mock content
- [ ] PR rows show diff stats, branch badge, draft badge
- [ ] "Create Session" buttons are visible but non-functional
- [ ] Dark mode renders correctly (all colors use CSS variables or dark: variants)
- [ ] Label badges render with colored borders

## Potential Pitfalls
1. **`lucide-react` icon availability**: Verify `Github`, `Blocks`, `CircleDot`, `GitPullRequest`, `Rocket` are exported from the project's version of lucide-react. If `Blocks` isn't available, use `Plug` as a fallback.
2. **Nested Tabs**: The integrations hub page uses `<Tabs>` for integration tabs, and the mock browser uses a nested `<Tabs>` for Issues/PRs. Radix Tabs supports nesting, but ensure each has a unique scope (they do — different `defaultValue` and no shared state).
3. **Badge color styling**: The label badges use inline `style={{ borderColor, color }}` with hex colors from GitHub. These won't automatically adapt to dark mode. This is acceptable for a scaffold — the full implementation will add proper color contrast handling.
4. **Directory creation**: `src/integrations/github/components/` doesn't exist yet. The implementer needs to create these directories when creating the files.
5. **Temporary files**: `mock-browser.tsx`, `mock-issue-row.tsx`, and `mock-pr-row.tsx` are explicitly temporary — they will be replaced by real components in the full implementation. Add a comment at the top of each: `// SCAFFOLD: Temporary mock component — will be replaced by real implementation`.
