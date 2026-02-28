# Agent Switching, Active Agent Display & Subagent Visibility

## TL;DR
> **Summary**: Migrate from v1 to v2 SDK (import path change only), then add per-prompt agent selection (passed to `promptAsync`), a real-time active agent indicator matching the TUI's `▣ Build · model · duration` pattern, and subagent delegation rendering based on `task` tool calls with `subagent_type`/`description` inputs — all using existing Radix/shadcn components and v2 SDK capabilities.
> **Estimated Effort**: Medium

## Context
### Original Request
Add three features to the session detail page: (1) let users choose which agent handles their next prompt, (2) show which agent is currently active/responding, and (3) surface subagent/delegation activity.

### SDK Migration Context
This project was on the **v1 SDK** (`from "@opencode-ai/sdk"`). The opencode TUI uses the **v2 SDK** (`from "@opencode-ai/sdk/v2"`). The v1→v2 migration is **import path changes only** — no breaking API changes. v2 gives us `AssistantMessage.agent: string` and `Agent.hidden?: boolean` directly, eliminating the workarounds previously needed for v1.

### Key Findings (v2 SDK)

1. **`promptAsync` supports `agent?: string`** — The SDK's `SessionPromptAsyncData.body` accepts an optional `agent` field. The current prompt API route and `useSendPrompt` hook never pass this parameter. Zero SDK work needed beyond the import migration.

2. **Agent identity is consistent across message types in v2** — Both `UserMessage` and `AssistantMessage` have `agent: string`. No more role-based field mapping needed.

3. **Subagent delegation is via `task` tool calls** — The TUI renders delegation by matching `props.part.tool === "task"` and checking `props.input.subagent_type` and `props.input.description` from the tool's `state.input`. The `task` tool is a regular `ToolPart` (type: `"tool"`, tool: `"task"`). The tool's `state.metadata.sessionId` contains the child session ID. The TUI's rendering pattern:
   - Title: `"# " + titlecase(input.subagent_type) + " Task"`
   - Description + toolcall count from child session
   - Spinner while `state.status !== "completed"`
   - Current tool being executed in child session
   - Clickable to navigate to child session

4. **Auto-agent-switch on `plan_exit`/`plan_enter` tool completions** — The TUI listens for `message.part.updated` events where `part.tool === "plan_exit"` (switches to "build") or `part.tool === "plan_enter"` (switches to "plan"). This auto-updates the selected agent in the agent picker.

5. **TUI assistant message display pattern**:
   ```
   ▣ Build · gpt-4o · 3.2s
   ```
   - Colored `▣` bullet using the agent's color (looked up by `message.agent` in v2)
   - Agent name titlecased from `message.agent` (e.g., `"build"` → `"Build"`)
   - `message.modelID` for model
   - Duration computed from `message.time.completed - parentUserMessage.time.created`
   - Messages have colored left borders matching the agent

6. **Agent filtering for picker — `hidden` is available in v2** — The TUI filters agents: `x.mode !== "subagent" && !x.hidden`. The v2 SDK `Agent` type includes `hidden?: boolean`. We use both filters to match the TUI exactly.

7. **Tool metadata carries `sessionId`** — `ToolPart.metadata?: { [key: string]: unknown }` exists at the part level. Additionally, `ToolStateRunning.metadata` and `ToolStateCompleted.metadata` carry per-state metadata. The TUI accesses `props.metadata.sessionId` which comes from `part.state.metadata`. Our `AccumulatedToolPart` currently stores `state` as the full state object, so this metadata is already accessible — no schema change needed.

8. **SDK has `SubtaskPart` (inline) and `AgentPart` types** — The `Part` union includes an inline subtask type with `type: "subtask"`, `prompt`, `description`, `agent`. `AgentPart` has `type: "agent"`, `name`. However, the TUI does NOT render these directly — it uses the `task` tool call pattern instead. We should handle them in `applyPartUpdate` for completeness but focus rendering on the `task` tool pattern.

9. **`AccumulatedMessage` currently discards agent identity, `modelID`, and timing info** — `ensureMessage()` only extracts `id`, `sessionID`, `role`, and `time.created`. `loadMessages()` similarly strips these fields. Both need to capture `agent` (from `info.agent` for both user and assistant messages in v2), `modelID`, and `time.completed` (for duration calculation).

10. **Agent metadata is partially fetched** — The agents API route extracts only `name`, `description`, `mode`, `color`. We need to add `model` (for display) and `hidden` (for filtering).

## Objectives
### Core Objective
Enable users to select which agent handles their prompts, see which agent is responding in real-time with the TUI's display pattern, and observe when subagents are working via `task` tool calls.

### Deliverables
- [x] v1→v2 SDK migration (import paths only)
- [x] Agent selector dropdown near the prompt input
- [x] `agent` parameter passed through API route to `promptAsync`
- [x] `@agent` autocomplete remains text-only (does not change agent selector)
- [x] Active agent indicator on assistant messages matching TUI pattern (`▣ Agent · model · duration`)
- [x] Agent-colored left borders on messages
- [x] `task` tool calls with `subagent_type` rendered as delegation blocks
- [x] Auto-agent-switch on `plan_exit`/`plan_enter` tool completions
- [x] Enriched agent metadata from API (include `model`, `hidden`)

### Definition of Done
- [x] All imports use `@opencode-ai/sdk/v2` — no v1 imports remain
- [x] Typecheck passes after migration (`npm run typecheck` or `npx tsc --noEmit`)
- [x] Selecting an agent from the dropdown sets it for the next prompt
- [x] The prompt API route passes `agent` to `promptAsync` when provided
- [x] Assistant messages show `▣ AgentName · modelID · duration` with agent color
- [x] `task` tool calls with `subagent_type` render as delegation indicators with spinner/description
- [x] Agent selector auto-switches when `plan_exit`/`plan_enter` complete
- [x] All existing tests pass (`npm run test`)
- [x] Build succeeds (`npm run build`)

### Guardrails (Must NOT)
- Must NOT break existing prompt sending (agent param is optional — `undefined` means default)
- Must NOT add new npm dependencies (all needed UI components exist)
- Must NOT emit fake/synthetic events — only use real SDK data
- Must NOT modify SDK types or monkey-patch the SDK
- Must NOT implement child session navigation (clicking a delegation block to open child session — defer to future iteration)
- Must NOT remove the unused `activity-stream.tsx` or `types.ts` custom events (separate cleanup)

## TODOs

### Phase 0: SDK Migration (v1 → v2)

- [x] 0. **Migrate all imports from `@opencode-ai/sdk` to `@opencode-ai/sdk/v2`**
  **What**: Change every import path from `"@opencode-ai/sdk"` to `"@opencode-ai/sdk/v2"` across all production and test files. This is a path-only change — no API or type changes required. The v2 SDK gives us `AssistantMessage.agent`, `Agent.hidden`, and other fields that v1 lacked.
  **Files**:
  - `src/lib/api-types.ts` (line 6): `import type { Session, Part, SessionStatus } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  - `src/lib/server/process-manager.ts` (line 15): `import { createOpencodeServer, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  - `src/lib/server/process-manager.ts` (line 32): `export type { OpencodeClient } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  - `src/lib/server/opencode-client.ts` (line 7): `import type { OpencodeClient } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  - `src/lib/server/opencode-client.ts` (lines 11-15): `export type { Session, Message, Part } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  - `src/lib/__tests__/workspace-utils.test.ts` (line 7): `import type { Session } from "@opencode-ai/sdk"` → `from "@opencode-ai/sdk/v2"`
  **Acceptance**: `grep -r '"@opencode-ai/sdk"' src/` returns zero matches (only `"@opencode-ai/sdk/v2"` remains). `npm run test` passes. `npm run build` passes.

### Phase 1: Data Plumbing (API + Types)

- [x] 1. **Extend `SendPromptRequest` to include optional `agent` field**
  **What**: Add `agent?: string` to the `SendPromptRequest` type so the prompt API route can accept and forward it.
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: `SendPromptRequest` has an `agent?: string` property.

- [x] 2. **Pass `agent` parameter to `promptAsync` in the prompt API route**
  **What**: Extract `agent` from the request body. If present, include it in the `body` passed to `client.session.promptAsync()`. If absent, omit it (preserving default behavior).
  **Files**: `src/app/api/sessions/[id]/prompt/route.ts`
  **Changes**:
  - Destructure `agent` from `body` alongside `instanceId` and `text`
  - Add `agent` to the `promptAsync` body: `body: { parts: [...], ...(agent ? { agent } : {}) }`
  **Acceptance**: When `{ instanceId, text, agent: "plan" }` is POSTed, the SDK receives `agent: "plan"` in the prompt body. When `agent` is omitted, behavior is unchanged.

- [x] 3. **Add `agent` parameter to `useSendPrompt` hook**
  **What**: Extend the `sendPrompt` function signature to accept an optional `agent` parameter and include it in the POST body.
  **Files**: `src/hooks/use-send-prompt.ts`
  **Changes**:
  - Change `sendPrompt` signature: `(sessionId: string, instanceId: string, text: string, agent?: string) => Promise<void>`
  - Include `agent` in `JSON.stringify({ instanceId, text, agent })` (undefined values are dropped by JSON.stringify)
  **Acceptance**: Calling `sendPrompt(sid, iid, "hello", "plan")` sends `{ instanceId, text, agent: "plan" }` in the POST body.

- [x] 4. **Enrich agent metadata in the agents API route**
  **What**: Include `model` and `hidden` fields in the response so the UI can show model info and filter hidden agents.
  **Files**: `src/app/api/instances/[id]/agents/route.ts`, `src/lib/api-types.ts`
  **Changes**:
  - Extend `AutocompleteAgent` type: add `model?: { modelID: string; providerID: string }` and `hidden?: boolean`
  - Update the `.map()` in the route to include `model: agent.model` and `hidden: agent.hidden`
  **Acceptance**: `GET /api/instances/xxx/agents` returns objects with `model` and `hidden` fields.

- [x] 5. **Extend `AccumulatedMessage` to carry agent metadata (v2 — unified)**
  **What**: Add agent identity, `modelID`, and timing fields to `AccumulatedMessage`. In v2, both `UserMessage` and `AssistantMessage` have `agent: string`, so we use `info.agent` for BOTH roles — no role-based field mapping needed.
  **Files**: `src/lib/api-types.ts`, `src/lib/event-state.ts`, `src/hooks/use-session-events.ts`
  **Changes**:
  - Add to `AccumulatedMessage` interface:
    ```typescript
    /** The agent name — sourced from info.agent for both user and assistant messages (v2) */
    agent?: string;
    modelID?: string;
    completedAt?: number;
    parentID?: string;
    ```
  - **Add `agent`, `modelID`, `parentID` to `ensureMessage()`** — extract these on message creation (first `message.updated` event). These are safe, additive fields with no behavioral change to existing logic.
  - **Add an isolated `mergeMessageUpdate()` function** for handling the second `message.updated` event (completion). Keep this **separate from `ensureMessage()`** so it can be removed without affecting message creation:
    ```typescript
    /**
     * Merges completion data into an existing message.
     * Isolated from ensureMessage() for easy revert if needed.
     * Only updates fields that were previously unset (null-safe merge).
     */
    export function mergeMessageUpdate(
      prev: AccumulatedMessage[],
      info: { id: string; time?: { completed?: number }; [key: string]: unknown }
    ): AccumulatedMessage[] {
      const index = prev.findIndex((m) => m.messageId === info.id);
      if (index === -1) return prev; // message not found, no-op
      const existing = prev[index];
      const completedAt = info.time?.completed;
      if (!completedAt || existing.completedAt) return prev; // nothing new to merge
      const updated = [...prev];
      updated[index] = { ...existing, completedAt };
      return updated;
    }
    ```
  - **Wire `mergeMessageUpdate` into event handling** — in `handleEvent` (`use-session-events.ts`), after calling `ensureMessage()` for `message.updated` events, also call `mergeMessageUpdate()`. This is a single line addition that can be commented out to disable duration tracking without side effects.
  - In `loadMessages()` (`use-session-events.ts`): extract `agent`, `modelID`, `completedAt`, `parentID` from `msg.info` when constructing accumulated messages from history (these messages already have `time.completed` populated since they're loaded after completion).
  **Revert strategy**: To back out duration tracking, remove `mergeMessageUpdate()` from `event-state.ts` and its single call site in `use-session-events.ts`. The `completedAt` field on `AccumulatedMessage` becomes always-undefined, and Task 11's duration display gracefully shows nothing (it already guards on `completedAt` being set). No other tasks are affected.
  **Acceptance**: `AccumulatedMessage.agent` is populated from `info.agent` for both user and assistant messages. `modelID` and `parentID` are populated on creation. When the second `message.updated` event arrives with `time.completed`, `mergeMessageUpdate()` sets `completedAt` on the existing message. Removing `mergeMessageUpdate()` disables duration without breaking anything else.

- [x] 6. **Handle `task` tool call metadata in `AccumulatedToolPart`**
  **What**: The existing `AccumulatedToolPart` stores `state` as the raw SDK state object, which includes `state.input` (with `subagent_type`, `description`) and `state.metadata` (with `sessionId`). Verify this data flows through correctly. Add typed helper accessors or type narrowing utilities.
  **Files**: `src/lib/api-types.ts`
  **Changes**:
  - Add a helper type or function to extract task tool metadata:
    ```typescript
    export function isTaskToolCall(part: AccumulatedToolPart): boolean {
      return part.tool === "task";
    }
    export function getTaskToolInput(part: AccumulatedToolPart): { subagent_type?: string; description?: string } | null {
      const state = part.state as any;
      const input = state?.input;
      if (!input?.subagent_type && !input?.description) return null;
      return { subagent_type: input.subagent_type, description: input.description };
    }
    export function getTaskToolSessionId(part: AccumulatedToolPart): string | null {
      const state = part.state as any;
      return state?.metadata?.sessionId ?? null;
    }
    ```
  **Acceptance**: `isTaskToolCall`, `getTaskToolInput`, and `getTaskToolSessionId` correctly extract data from `task` tool parts.

### Phase 2: Agent Selector UI

- [x] 7. **Create `AgentSelector` component**
  **What**: A dropdown button near the prompt input that shows the currently selected agent and lets users pick a different one. Uses DropdownMenu from Radix UI.
  **Files**: `src/components/session/agent-selector.tsx` (new file)
  **Design**:
  - Trigger: A compact button showing the current agent name with a colored dot. When no agent is selected, show "Default" or "Auto".
  - Content: DropdownMenu with `DropdownMenuRadioGroup` listing available agents. Each item shows agent name, colored dot, mode badge (e.g., "primary"), and model info.
  - Filter: Only show agents where `mode !== "subagent" && hidden !== true` (matching the TUI's filter exactly).
  - Props: `agents: AutocompleteAgent[]`, `selectedAgent: string | null`, `onSelect: (agent: string | null) => void`, `disabled?: boolean`
  - Size: Compact (height matches the send button, ~h-9). Uses `text-xs`.
  **Acceptance**: Renders a dropdown showing available non-subagent, non-hidden agents. Selection calls `onSelect` with the agent name. Selecting the already-selected agent (or a "Default" option) calls `onSelect(null)`.

- [x] 8. **Integrate `AgentSelector` into `PromptInput`**
  **What**: Add the `AgentSelector` to the left of the input field. Wire it to local state that tracks the selected agent. Pass the selected agent to `onSend`.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  - Add props: `agents: AutocompleteAgent[]` (passed from parent), `selectedAgent: string | null`, `onAgentChange: (agent: string | null) => void`
  - Render `<AgentSelector>` before the `<Input>` in the form
  - Change `onSend` signature to `(text: string, agent?: string) => Promise<void>`
  - In submit handler: call `onSend(text, selectedAgent ?? undefined)`
  **Acceptance**: The agent selector appears in the prompt bar. Selected agent is passed to `onSend`.

- [x] 9. **Wire agent selection through the session page**
  **What**: Update the session detail page to pass agents to PromptInput and forward the agent parameter to `sendPrompt`. Manage agent selection state here (not in PromptInput) so auto-agent-switching can update it.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Import and call `useAgents(instanceId)` to get the agents list
  - Add state: `const [selectedAgent, setSelectedAgent] = useState<string | null>(null)`
  - Pass `agents`, `selectedAgent`, `onAgentChange: setSelectedAgent` to `<PromptInput>`
  - Update `handleSend` callback: `async (text: string, agent?: string) => { await sendPrompt(sessionId, instanceId, text, agent); }`
  **Acceptance**: Full data flow works: user selects agent → enters text → submits → API receives `agent` param → `promptAsync` is called with `agent`.

- [x] 10. **`@agent` mention remains text-only — agent switching is explicit**
  **What**: Keep the existing `@agent` autocomplete behavior as-is: selecting an agent from `@` autocomplete inserts `@agentname` as text into the prompt. This is delegation syntax — the agent processes the `@mention` in the prompt text. Agent switching (changing which agent handles the prompt) is done **only** via the explicit `AgentSelector` dropdown (Task 7). This matches the opencode TUI behavior where `@agent` in text is delegation and Tab/picker is explicit switching.
  **Files**: No changes needed — existing behavior is correct.
  **Acceptance**: `@agent` autocomplete inserts text only. The agent selector dropdown is the sole mechanism for explicit agent switching.

### Phase 3: Active Agent Display

- [x] 11. **Show agent name, model, and duration on assistant messages (TUI pattern)**
  **What**: Replace the hardcoded "Assistant" label with the TUI's pattern: `▣ AgentName · modelID · duration`. Show the agent's color on the bullet and as a left border on the message.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - `MessageItem` receives `agents?: AutocompleteAgent[]` and `allMessages?: AccumulatedMessage[]` as props (for color lookup and duration calculation)
  - For assistant messages:
    - Display agent name: use `message.agent` (populated from `info.agent` in v2), titlecased. Fallback to "Assistant" if undefined.
    - Display `▣` colored bullet before the agent name, using agent color from `agents` list (look up by matching `agent.name === message.agent`). **Fallback color strategy**: if the agent is not found in the list (list not loaded yet, or unknown agent), use a neutral muted color (e.g., `text-muted-foreground`). The TUI cycles through a palette (`secondary`, `accent`, `success`, `warning`, `primary`, `error`, `info`) — for simplicity, we use a single neutral fallback.
    - Display `· {message.modelID}` after the name in muted text
    - Compute duration: find parent user message (via `message.parentID`), calculate `message.completedAt - parentMessage.createdAt`, format as seconds (e.g., "3.2s"). Only show when `completedAt` is set.
    - Add colored left border to the message container using `border-l-2` with the agent's color
  - For user messages: show colored left border using `message.agent` color (populated from `info.agent` in v2)
  - Props update: add `agents?: AutocompleteAgent[]` to `ActivityStreamV1Props`
  **Acceptance**: Assistant messages show "▣ Build · gpt-4o · 3.2s" with colored bullet and left border. User messages have colored left borders.

- [x] 12. **Add active agent indicator in the status bar**
  **What**: Show which agent is currently working in the bottom status bar (and in the "Thinking…" indicator).
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Derive active agent from the latest user message's `agent` field (populated from `info.agent` in v2)
  - When `sessionStatus === "busy"`, show "`{agentName}` working…" instead of just "Agent working…"
  - In the "Thinking…" bubble, show the agent name if available (e.g., "Build thinking…")
  - Apply the agent's color to the status dot instead of always green
  **Acceptance**: When agent "build" is working, status bar shows a colored dot and "Build working…".

- [x] 13. **Show active agent in the session header**
  **What**: Display a small badge in the header showing the currently active agent when the session is busy.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Derive active agent from the last user message's `agent` field (populated from `info.agent` in v2)
  - Look up agent color from the agents list
  - Add a `Badge` next to the existing "Working"/"Idle" badge showing the titlecased agent name with its color as a dot
  - Only show when `sessionStatus === "busy"` and an agent is known
  **Acceptance**: Header shows `[Working] [● Build]` with the agent's color when an agent is actively responding.

### Phase 4: Subagent/Delegation Visibility

- [x] 14. **Render `task` tool calls as delegation blocks in the activity stream**
  **What**: When a tool call has `tool === "task"` and its `state.input` contains `subagent_type` or `description`, render it as a delegation indicator instead of a generic tool call. Follow the TUI's rendering pattern.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Add a `TaskDelegationItem` component rendered for tool parts where `isTaskToolCall(part)` returns true and `getTaskToolInput(part)` is non-null
  - Display pattern (matching TUI):
    - Title: `"# " + titlecase(input.subagent_type ?? "unknown") + " Task"`
    - Description text + toolcall count (if available from child session — for now, just show description)
    - Spinner while `state.status === "running"` or `state.status === "pending"`
    - Status badge when completed/errored
    - Styled as a block with colored left border (distinct from regular tool calls — use a different bg/border treatment)
  - In `ToolCallItem`, add early return: if `isTaskToolCall(part) && getTaskToolInput(part)`, render `<TaskDelegationItem>` instead
  **Acceptance**: When the SDK emits a `task` tool call with `subagent_type: "plan"` and `description: "Analyze the codebase"`, it renders as "# Plan Task" with the description and a spinner while running.

- [x] 15. **Auto-switch agent on `plan_exit`/`plan_enter` tool completions**
  **What**: When a `message.part.updated` event arrives for a completed `plan_exit` or `plan_enter` tool call, automatically update the selected agent in the agent picker. This matches the TUI behavior.
  **Files**: `src/hooks/use-session-events.ts`, `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Add a new callback parameter to `useSessionEvents`: `onAgentSwitch?: (agent: string) => void`
  - In `handleEvent`, when processing `message.part.updated` with a tool part where:
    - `part.state?.status === "completed"` AND
    - `part.tool === "plan_exit"` → call `onAgentSwitch("build")`
    - `part.tool === "plan_enter"` → call `onAgentSwitch("plan")`
  - In the session page: pass `onAgentSwitch: setSelectedAgent` to `useSessionEvents`
  - Deduplicate: track last switched part ID (via ref) to avoid re-switching on the same part event
  **Acceptance**: When a `plan_enter` tool call completes, the agent selector automatically switches to "plan". When `plan_exit` completes, it switches to "build".

- [x] 16. **Add "Active Agents" section to the session sidebar**
  **What**: Show a list of agents that have participated in the session, derived from message metadata.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Compute a set of unique agents from `messages.map(m => m.agent).filter(Boolean)` — this works because `AccumulatedMessage.agent` is populated from `info.agent` for all messages in v2, so all messages have a consistent agent name.
  - For each agent, show: colored dot (from agents list), titlecased name, message count
  - Place after the "Tokens" section in the sidebar
  - Use the `agents` list from `useAgents` to resolve colors
  **Acceptance**: Sidebar shows "Agents" section listing e.g., "● Build (5 messages), ● Plan (2 messages)".

## Implementation Notes

### SDK Migration (v1 → v2)
The migration is Phase 0 and is **import path changes only**. Every `from "@opencode-ai/sdk"` becomes `from "@opencode-ai/sdk/v2"`. There are no API or type breaking changes. This aligns our project with the opencode TUI, which uses v2.

After migration, the following v2 types are available:
- `AssistantMessage.agent: string` — the agent that handled the response (eliminates the v1 workaround of using `mode`)
- `Agent.hidden?: boolean` — whether the agent should be hidden from the picker

### Agent Selection vs `@agent` Mentions
These are **two separate concepts** (matching the TUI behavior):
- **Agent selector** (dropdown): Explicitly sets which agent handles the prompt. This is the `agent` parameter sent to `promptAsync`.
- **`@agent` mention** (text): Delegation syntax embedded in the prompt text. The agent processes this as part of the message content. `@agent` does NOT change the agent selector.

The user switches agents via the dropdown only. `@agent` in the prompt text is just text that the current agent interprets.

### Auto-Agent-Switching Behavior
Task 15 auto-switches the agent selector on `plan_exit`/`plan_enter` tool completions. This **overrides any manual selection**, matching the TUI behavior. This is intentional — when the system transitions between planning and building, the agent context should follow automatically.

### Agent Identity from SDK Messages (v2 SDK)
In v2, both `UserMessage` and `AssistantMessage` have `agent: string`. We use `info.agent` for all message roles — clean, unified, no role-based branching needed.

Additionally for assistant messages:
- `AssistantMessage.modelID: string` — the model used
- `AssistantMessage.time.completed?: number` — when the response finished
- `AssistantMessage.parentID: string` — links to the user message (for duration calculation)

### Filtering Agents for the Selector (v2)
Filter: `agent.mode !== "subagent" && agent.hidden !== true` — matching the TUI's filter exactly.

### Subagent Detection
Delegation signals come from **regular `task` tool calls**, NOT from `subtask` or `agent` part types. The detection logic:
1. Check `part.type === "tool"` AND `part.tool === "task"`
2. Check `part.state.input.subagent_type` or `part.state.input.description`
3. The child session ID is in `part.state.metadata.sessionId`

The SDK's inline subtask type and `AgentPart` type exist but are NOT what the TUI renders for delegation. We should handle them in `applyPartUpdate()` for completeness but prioritize rendering `task` tool calls.

### Duration Calculation
The TUI computes duration as `assistantMessage.time.completed - parentUserMessage.time.created`. To replicate:
1. Store `parentID` and `completedAt` on `AccumulatedMessage`
2. In the activity stream, find the parent user message by `parentID`
3. Calculate `completedAt - parentMessage.createdAt`
4. Format as "Xs" or "Xm Ys" using a simple formatter
5. During streaming (before `completedAt` is set), show no duration — it appears when the message completes

### Message Update Lifecycle
The SDK emits `message.updated` **twice** per message:
1. **Creation** — `time.created` set, `time.completed` undefined, streaming begins
2. **Completion** — `time.completed` now set, cost/tokens populated
The current `ensureMessage()` discards the second event. Task 5 fixes this with a merge pattern.

### Agent Color Fallback
When looking up agent colors, fallback to a neutral muted color (`text-muted-foreground`) if:
- The agents list hasn't loaded yet
- The agent name from a message doesn't match any known agent
- The agent has no `color` defined

The TUI cycles through a palette for agents without custom colors. For simplicity, we use a single neutral fallback.

### No New Dependencies
All needed UI components exist: `DropdownMenu`, `Badge`, `Button`, `Tooltip`. No new packages required.

## Verification
- [x] No v1 SDK imports remain (`grep -r '"@opencode-ai/sdk"' src/` returns nothing — only `"@opencode-ai/sdk/v2"`)
- [x] All existing tests pass (`npm run test`)
- [x] Build succeeds (`npm run build`)
- [x] Agent selector renders and is interactive
- [x] Agent selector filters out subagent and hidden agents
- [x] Sending a prompt with an agent selected sends the `agent` param to the API
- [x] Assistant messages show `▣ AgentName · modelID · duration` with agent color
- [x] User and assistant messages have agent-colored left borders
- [x] `task` tool calls with `subagent_type` render as delegation blocks with spinner
- [x] Agent selector auto-switches on `plan_exit`/`plan_enter` completions
- [x] Sidebar shows participating agents
- [x] Sending without an agent selected works as before (no regression)

## Future Work

Deferred capabilities that are technically feasible with the current SDK. Each has the primitives already available — they were excluded from this plan to keep scope manageable.

### 1. Click-through to subagent sessions
**What**: Clicking a delegation block (Task 14) navigates to the child session, showing the subagent's full message history, tool calls, and output.
**Why deferred**: Requires routing infrastructure (session-in-session navigation or a modal/drawer), plus loading child session messages via a separate API call. The TUI handles this with `navigate({ type: "session", sessionID })`.
**SDK support**: `getTaskToolSessionId(part)` already extracts the child `sessionId` from `part.state.metadata.sessionId`. `client.session.children()` returns child sessions. Messages can be loaded via the existing session detail API.
**Suggested approach**: Add an `onClick` handler to `TaskDelegationItem` that navigates to `/sessions/{childSessionId}`, or opens a side panel/drawer showing the child session's activity stream. The existing `ActivityStreamV1` component can be reused for rendering.

### 2. Toolcall count and current-tool display on delegation blocks
**What**: Show how many tool calls the subagent has made and which tool is currently executing (e.g., `"Analyze the codebase (12 toolcalls) └ Read src/index.ts"`).
**Why deferred**: Requires subscribing to the child session's events in real-time, or periodically fetching child session state. The TUI accesses `tools().length` and `current()` from its reactive store which tracks all sessions.
**SDK support**: Child session events flow through the same SSE event stream — they're just filtered by `sessionID`. `message.part.updated` events for the child session contain tool parts with `tool` name and `state.status`.
**Suggested approach**: When a `TaskDelegationItem` is rendered with a running state, subscribe to events for the child `sessionId`. Accumulate tool parts and display count + latest active tool. Unsubscribe when the delegation completes. Alternatively, poll `GET /api/sessions/{childSessionId}` periodically for a simpler (but less real-time) approach.

### 3. Keyboard shortcuts for agent cycling
**What**: Tab/Shift+Tab cycles through agents (matching the TUI's `agent.cycle` and `agent.cycle.reverse` commands).
**Why deferred**: Requires a keyboard shortcut system that doesn't conflict with browser/input focus behavior. Tab is used for focus navigation in web apps, so the keybinding may need to differ from the TUI (e.g., Ctrl+Tab, or only active when the prompt input is focused).
**SDK support**: N/A — this is purely a UI concern. The agent list and selection state from Phase 2 are all that's needed.
**Suggested approach**: Add a `useHotkeys` hook (or use the existing keyboard event handling in `PromptInput`) that listens for a configurable keybinding when the prompt input is focused. Cycle through the filtered agent list (same list as the dropdown) and update `selectedAgent` state. Show a brief toast or visual flash on the agent selector to confirm the switch.
