# TodoWrite Tool — Custom Rendering

## TL;DR
> **Summary**: Replace the generic truncated-JSON rendering of `todowrite` tool calls with a proper todo list in the activity stream, and add a persistent "Todos" panel in the session sidebar showing the latest todo state.
> **Estimated Effort**: Short

## Context
### Original Request
The `todowrite` tool call renders identically to every other tool — a wrench icon, tool name, and first 60 characters of JSON output. It should render as an actual todo list with status indicators, content text, and priority badges.

### Key Findings
1. **`ToolCallItem` in `activity-stream-v1.tsx` (line 17–41)** renders all tools generically. It receives `AccumulatedPart & { type: "tool" }` with `part.tool` as the tool name and `part.state` containing `{ status, output, error }`.
2. **Tool name casing is unknown** — no existing `todowrite` references in the codebase. The tool name comes from the SDK event stream via `part.tool`. The match should be case-insensitive (e.g., `part.tool.toLowerCase() === "todowrite"` or match `TodoWrite`).
3. **Tool state shape**: `state.output` is a string containing a JSON array of todo items: `[{ content, status, priority }]`.
4. **Session page sidebar (`src/app/sessions/[id]/page.tsx` lines 173–269)** is inline in the page component — not a separate component. It shows session metadata (ID, instance, workspace, tokens, cost, connection).
5. **`session-sidebar.tsx`** exists but uses mock data and an old `Session` type — it's unused by the live session detail page. The sidebar for the live page is inline in `page.tsx`.
6. **Available UI components**: Badge, Progress, Separator, ScrollArea — all from shadcn/ui. Lucide icons throughout.
7. **`AccumulatedMessage[]`** from `useSessionEvents` is the single source of truth for all messages/parts in the session. Extracting the latest todowrite output means scanning all messages' tool parts in reverse.

## Objectives
### Core Objective
Give `todowrite` tool calls first-class visual treatment in both the activity stream (inline) and session sidebar (persistent latest state).

### Deliverables
- [x] `TodoItem` type definition for parsed todo entries
- [x] `TodoListInline` component for the activity stream
- [x] `TodoSidebarPanel` component for the session sidebar
- [x] `extractLatestTodos` utility function
- [x] Integration into `ToolCallItem` (conditional rendering)
- [x] Integration into session detail page sidebar

### Definition of Done
- [x] `todowrite` tool calls in the activity stream render as a styled todo list (not truncated JSON)
- [x] The session sidebar shows a "Todos" section with the most recent todowrite state
- [x] The sidebar panel updates live as new todowrite events stream in
- [x] All existing tool call rendering remains unchanged
- [x] No TypeScript errors: `npx tsc --noEmit` passes
- [x] Dev server runs without errors: `npm run dev`

### Guardrails (Must NOT)
- Must not change rendering of any tool other than `todowrite`
- Must not modify the SSE event pipeline or `event-state.ts`
- Must not introduce new npm dependencies
- Must not break the existing sidebar metadata layout

## TODOs

- [x] 1. **Define TodoItem type**
  **What**: Add a `TodoItem` interface and a parser/helper to safely extract todos from tool state output. The tool name in the event stream may be `todowrite`, `TodoWrite`, or `todo_write` — handle all casings.
  **Files**: `src/lib/todo-utils.ts` (new)
  **Details**:
  - `interface TodoItem { content: string; status: "pending" | "in_progress" | "completed" | "cancelled"; priority: "high" | "medium" | "low" }`
  - `function parseTodoOutput(output: unknown): TodoItem[] | null` — attempts `JSON.parse` on string output, validates it's an array of objects with the right shape, returns `null` on failure
  - `function isTodoWriteTool(toolName: string): boolean` — case-insensitive match against `todowrite`, `todo_write`, `TodoWrite`
  - `function extractLatestTodos(messages: AccumulatedMessage[]): TodoItem[] | null` — iterates messages in reverse, finds the last `todowrite` tool part with a completed state and valid output, parses and returns it
  **Acceptance**: Unit-testable pure functions. Import works from both activity stream and page components.

- [x] 2. **Build `TodoListInline` component**
  **What**: A compact inline todo list for the activity stream, rendered in place of the generic tool output when the tool is `todowrite`.
  **Files**: `src/components/session/todo-list-inline.tsx` (new)
  **Details**:
  - Receives `items: TodoItem[]` and `isRunning: boolean` props
  - Each item rendered as a single row with:
    - **Status icon** (left): `CheckCircle2` (green) for completed, `Circle` (muted) for pending, `Loader2` (animate-spin, blue) for in_progress, `XCircle` (red/muted) for cancelled
    - **Content text**: `text-xs`, completed items get `line-through text-muted-foreground`
    - **Priority badge** (right): `Badge variant="outline"` with `text-[10px]`, color-coded — high: `text-red-400 border-red-400/30`, medium: `text-amber-400 border-amber-400/30`, low: `text-muted-foreground`
  - Wrapped in a container: `ml-5 mt-1 space-y-0.5` (indented under the tool name line)
  - If `isRunning`, show a subtle `Loader2` spinner next to the header
  - Header line still shows the wrench icon + "todowrite" name (consistent with other tools) but replaces the truncated output with a count like "4 items"
  **Acceptance**: Renders a readable todo list. Visually consistent with the activity stream's `text-xs`, muted-color aesthetic.

- [x] 3. **Integrate `TodoListInline` into `ToolCallItem`**
  **What**: Modify `ToolCallItem` in the activity stream to detect `todowrite` and render the custom component instead of truncated JSON.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify)
  **Details**:
  - Import `isTodoWriteTool`, `parseTodoOutput` from `@/lib/todo-utils`
  - Import `TodoListInline` from `./todo-list-inline`
  - At the top of `ToolCallItem`, check `isTodoWriteTool(part.tool)`. If true:
    - Parse `state?.output` via `parseTodoOutput`
    - If parsed successfully and completed/running, render `TodoListInline` instead of the generic output span
    - If parse fails, fall through to default rendering (graceful degradation)
  - The wrench icon + tool name line remains; only the output portion changes
  - Keep the existing `ToolCallItem` for all other tools untouched
  **Acceptance**: `todowrite` renders as a todo list; all other tools render exactly as before; parse failures degrade gracefully to old rendering.

- [x] 4. **Build `TodoSidebarPanel` component**
  **What**: A sidebar section showing the latest todo state, matching the existing sidebar section design (uppercase label, compact items).
  **Files**: `src/components/session/todo-sidebar-panel.tsx` (new)
  **Details**:
  - Receives `todos: TodoItem[]` prop
  - Section header: `<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Todos</p>` (matches existing sidebar section headers in `page.tsx`)
  - A `ListTodo` (or `ClipboardList`) lucide icon next to the header
  - Progress summary: `"3 of 5 completed"` in `text-[10px] text-muted-foreground`
  - Optional `Progress` bar (h-1.5) showing completion percentage
  - Each item rendered similarly to inline but can be slightly more spacious since the sidebar has ~w-72 of width
  - Items grouped/sorted: in_progress first, then pending, then completed, then cancelled (or keep original order — simpler)
  **Acceptance**: Visually consistent with existing sidebar sections (Session Info, Tokens, Cost). Shows current progress at a glance.

- [x] 5. **Integrate `TodoSidebarPanel` into session detail page**
  **What**: Extract the latest todos from `messages` and render the panel in the sidebar.
  **Files**: `src/app/sessions/[id]/page.tsx` (modify)
  **Details**:
  - Import `extractLatestTodos` from `@/lib/todo-utils`
  - Import `TodoSidebarPanel` from `@/components/session/todo-sidebar-panel`
  - Compute `const latestTodos = extractLatestTodos(messages)` — this is reactive since `messages` is state from `useSessionEvents`
  - In the sidebar `<aside>`, after the "Session Info" heading and before the first Separator, or after the Separator following "Connection" — add:
    ```
    {latestTodos && latestTodos.length > 0 && (
      <>
        <Separator />
        <TodoSidebarPanel todos={latestTodos} />
      </>
    )}
    ```
  - Place it after the Connection section (bottom of sidebar) so it doesn't disrupt the existing metadata layout. Alternatively, place it prominently after "Session Info" / before "Workspace" — decide based on importance. Recommendation: place it **after the first Separator** (after Instance ID, before Workspace) since todos are high-signal.
  - No need for `useMemo` — `extractLatestTodos` is a fast reverse scan and messages change infrequently
  **Acceptance**: Sidebar shows "Todos" section when a todowrite tool has been used. Updates live as new todowrite events arrive. Hidden when no todowrite calls exist.

## Verification
- [x] All existing tools render unchanged (wrench icon + truncated output)
- [x] `todowrite` in stream shows a proper checklist with status icons and priority badges
- [x] Sidebar shows latest todos with progress bar; updates as agent streams new todowrite calls
- [x] Graceful degradation: malformed todowrite output falls back to generic rendering
- [x] `npx tsc --noEmit` passes
- [x] `npm run dev` — page loads, no console errors
- [x] No regressions to session metadata sidebar (tokens, cost, connection still visible)
