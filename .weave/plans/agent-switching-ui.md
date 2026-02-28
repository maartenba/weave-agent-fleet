# Agent Switching, Active Agent Display & Subagent Visibility

## TL;DR
> **Summary**: Add per-prompt agent selection (passed to `promptAsync`), a real-time active agent indicator matching the TUI's `▣ Build · model · duration` pattern, and subagent delegation rendering based on `task` tool calls with `subagent_type`/`description` inputs — all using existing Radix/shadcn components and SDK capabilities already available but unused.
> **Estimated Effort**: Medium

## Context
### Original Request
Add three features to the session detail page: (1) let users choose which agent handles their next prompt, (2) show which agent is currently active/responding, and (3) surface subagent/delegation activity.

### Key Findings (Corrected for v1 SDK)

> **IMPORTANT**: This project uses the **v1 SDK** (`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`), NOT the v2 SDK (`dist/v2/gen/types.gen.d.ts`). All type references below are verified against v1.

1. **`promptAsync` supports `agent?: string`** — The SDK's `SessionPromptAsyncData.body` (v1, line 2333) accepts an optional `agent` field. The current prompt API route and `useSendPrompt` hook never pass this parameter. Zero SDK work needed.

2. **Agent identity differs between `UserMessage` and `AssistantMessage` in v1** —
   - `UserMessage` (v1, lines 39-60) has `agent: string` — this is the agent that was selected for the prompt.
   - `AssistantMessage` (v1, lines 98-127) does **NOT** have an `agent` field. It has `mode: string`, `modelID: string`, `providerID: string`, `parentID: string`, and `time: { created, completed? }`.
   - Therefore: for **user messages**, the agent identifier is `info.agent`. For **assistant messages**, the agent identifier is `info.mode`.
   - The TUI uses `Locale.titlecase(props.message.mode)` for the display name on assistant messages, which aligns with this — `mode` IS the agent identity for assistant messages in v1.

3. **Subagent delegation is NOT via `subtask`/`agent` part types — it's via `task` tool calls** — The TUI renders delegation by matching `props.part.tool === "task"` and checking `props.input.subagent_type` and `props.input.description` from the tool's `state.input`. The `task` tool is a regular `ToolPart` (type: `"tool"`, tool: `"task"`). The tool's `state.metadata.sessionId` contains the child session ID. The TUI's rendering pattern (lines 1885-1949):
   - Title: `"# " + titlecase(input.subagent_type) + " Task"`
   - Description + toolcall count from child session
   - Spinner while `state.status !== "completed"`
   - Current tool being executed in child session
   - Clickable to navigate to child session

4. **Auto-agent-switch on `plan_exit`/`plan_enter` tool completions** — The TUI (lines 209-224) listens for `message.part.updated` events where `part.tool === "plan_exit"` (switches to "build") or `part.tool === "plan_enter"` (switches to "plan"). This auto-updates the selected agent in the agent picker.

5. **TUI assistant message display pattern** (lines 1325-1351):
   ```
   ▣ Build · gpt-4o · 3.2s
   ```
   - Colored `▣` bullet using the agent's color (looked up by `message.mode` since that's the agent name for assistant messages in v1)
   - Agent name titlecased from `message.mode` (e.g., `"build"` → `"Build"`)
   - `message.modelID` for model
   - Duration computed from `message.time.completed - parentUserMessage.time.created`
   - Messages have colored left borders matching the agent

6. **Agent filtering for picker — `hidden` does NOT exist in v1** — The TUI (context/local.tsx line 38) filters agents: `x.mode !== "subagent" && !x.hidden`. However, in the v1 SDK, the `Agent` type (lines 1399-1428) does **NOT** have a `hidden` field. It has: `name`, `description`, `mode`, `builtIn`, `color`, `model`, `permission`, `tools`, `options`, `maxSteps`, `topP`, `temperature`, `prompt`. For our implementation, we filter only on `mode !== "subagent"`. The `hidden` check can be added if/when we upgrade to v2, but in v1 `agent.hidden` would always be `undefined`, so `!undefined === true` means the filter is a no-op — safe but unnecessary. We omit it to avoid confusion.

7. **Tool metadata carries `sessionId`** — `ToolPart.metadata?: { [key: string]: unknown }` exists at the part level (v1, line 272-274). Additionally, `ToolStateRunning.metadata` and `ToolStateCompleted.metadata` carry per-state metadata. The TUI accesses `props.metadata.sessionId` which comes from `part.state.metadata`. Our `AccumulatedToolPart` currently stores `state` as the full state object, so this metadata is already accessible — no schema change needed.

8. **SDK has `SubtaskPart` (inline) and `AgentPart` types** — These exist in the v1 SDK. The `Part` union (line 345-353) includes an inline subtask type with `type: "subtask"`, `prompt`, `description`, `agent`. `AgentPart` (lines 315-326) has `type: "agent"`, `name`. However, the TUI does NOT render these directly — it uses the `task` tool call pattern instead. We should still handle them in `applyPartUpdate` for completeness but focus rendering on the `task` tool pattern.

9. **`AccumulatedMessage` currently discards agent identity, `modelID`, `mode`, and timing info** — `ensureMessage()` only extracts `id`, `sessionID`, `role`, and `time.created`. `loadMessages()` similarly strips these fields. Both need to capture agent identity (from `info.agent` for user messages, `info.mode` for assistant messages), `modelID`, `mode`, and `time.completed` (for duration calculation).

10. **Agent metadata is partially fetched** — The agents API route extracts only `name`, `description`, `mode`, `color`. We need to add `model` (for display). We do NOT need to add `hidden` since it doesn't exist in v1.

## Objectives
### Core Objective
Enable users to select which agent handles their prompts, see which agent is responding in real-time with the TUI's display pattern, and observe when subagents are working via `task` tool calls.

### Deliverables
- [ ] Agent selector dropdown near the prompt input
- [ ] `agent` parameter passed through API route to `promptAsync`
- [ ] `@agent` autocomplete sets the selected agent
- [ ] Active agent indicator on assistant messages matching TUI pattern (`▣ Agent · model · duration`)
- [ ] Agent-colored left borders on messages
- [ ] `task` tool calls with `subagent_type` rendered as delegation blocks
- [ ] Auto-agent-switch on `plan_exit`/`plan_enter` tool completions
- [ ] Enriched agent metadata from API (include `model`)

### Definition of Done
- [ ] Selecting an agent from the dropdown sets it for the next prompt
- [ ] The prompt API route passes `agent` to `promptAsync` when provided
- [ ] Assistant messages show `▣ AgentName · modelID · duration` with agent color
- [ ] `task` tool calls with `subagent_type` render as delegation indicators with spinner/description
- [ ] Agent selector auto-switches when `plan_exit`/`plan_enter` complete
- [ ] All existing tests pass (`npm run test`)
- [ ] Build succeeds (`npm run build`)

### Guardrails (Must NOT)
- Must NOT break existing prompt sending (agent param is optional — `undefined` means default)
- Must NOT add new npm dependencies (all needed UI components exist)
- Must NOT emit fake/synthetic events — only use real SDK data
- Must NOT modify SDK types or monkey-patch the SDK
- Must NOT implement child session navigation (clicking a delegation block to open child session — defer to future iteration)
- Must NOT remove the unused `activity-stream.tsx` or `types.ts` custom events (separate cleanup)

## TODOs

### Phase 1: Data Plumbing (API + Types)

- [ ] 1. **Extend `SendPromptRequest` to include optional `agent` field**
  **What**: Add `agent?: string` to the `SendPromptRequest` type so the prompt API route can accept and forward it.
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: `SendPromptRequest` has an `agent?: string` property.

- [ ] 2. **Pass `agent` parameter to `promptAsync` in the prompt API route**
  **What**: Extract `agent` from the request body. If present, include it in the `body` passed to `client.session.promptAsync()`. If absent, omit it (preserving default behavior).
  **Files**: `src/app/api/sessions/[id]/prompt/route.ts`
  **Changes**:
  - Destructure `agent` from `body` alongside `instanceId` and `text`
  - Add `agent` to the `promptAsync` body: `body: { parts: [...], ...(agent ? { agent } : {}) }`
  **Acceptance**: When `{ instanceId, text, agent: "plan" }` is POSTed, the SDK receives `agent: "plan"` in the prompt body. When `agent` is omitted, behavior is unchanged.

- [ ] 3. **Add `agent` parameter to `useSendPrompt` hook**
  **What**: Extend the `sendPrompt` function signature to accept an optional `agent` parameter and include it in the POST body.
  **Files**: `src/hooks/use-send-prompt.ts`
  **Changes**:
  - Change `sendPrompt` signature: `(sessionId: string, instanceId: string, text: string, agent?: string) => Promise<void>`
  - Include `agent` in `JSON.stringify({ instanceId, text, agent })` (undefined values are dropped by JSON.stringify)
  **Acceptance**: Calling `sendPrompt(sid, iid, "hello", "plan")` sends `{ instanceId, text, agent: "plan" }` in the POST body.

- [ ] 4. **Enrich agent metadata in the agents API route**
  **What**: Include `model` field in the response so the UI can show model info. The v1 SDK `Agent` type does NOT have a `hidden` field — do NOT add it.
  **Files**: `src/app/api/instances/[id]/agents/route.ts`, `src/lib/api-types.ts`
  **Changes**:
  - Extend `AutocompleteAgent` type: add `model?: { modelID: string; providerID: string }`
  - Update the `.map()` in the route to include `model: agent.model`
  - Do NOT add `hidden` — it does not exist in the v1 SDK's `Agent` type (lines 1399-1428)
  **Acceptance**: `GET /api/instances/xxx/agents` returns objects with `model` field. No `hidden` field.

- [ ] 5. **Extend `AccumulatedMessage` to carry agent metadata (v1-correct)**
  **What**: Add agent identity, `modelID`, `mode`, and timing fields to `AccumulatedMessage`. **Critical**: agent identity comes from DIFFERENT fields depending on message role:
  - **User messages** → `info.agent` (v1 `UserMessage` has `agent: string`)
  - **Assistant messages** → `info.mode` (v1 `AssistantMessage` has `mode: string` but NO `agent` field)
  **Files**: `src/lib/api-types.ts`, `src/lib/event-state.ts`
  **Changes**:
  - Add to `AccumulatedMessage` interface:
    ```typescript
    /** The agent name — sourced from info.agent (user) or info.mode (assistant) */
    agent?: string;
    modelID?: string;
    mode?: string;
    completedAt?: number;
    parentID?: string;
    ```
  - In `ensureMessage()`:
    - If `info.role === "user"`: set `agent` from `(info as UserMessage).agent`
    - If `info.role === "assistant"`: set `agent` from `(info as AssistantMessage).mode`, and also extract `modelID`, `mode`, `completedAt` from `(info as AssistantMessage).time?.completed`, and `parentID` from `(info as AssistantMessage).parentID`
  - In `loadMessages()` (`use-session-events.ts`): same role-based extraction when constructing accumulated messages from history.
  - Handle `message.updated` events that update an existing message (for completed timing): currently `ensureMessage` skips if the message already exists. Add a new function `updateMessage()` that merges updated fields (particularly `time.completed`) into existing messages. Call it from `handleEvent` when `message.updated` arrives and the message already exists.
  **Acceptance**: `AccumulatedMessage.agent` is populated from `info.agent` for user messages and from `info.mode` for assistant messages. `modelID`, `mode`, `completedAt`, and `parentID` are populated for assistant messages. When an assistant message completes, `completedAt` is updated.

- [ ] 6. **Handle `task` tool call metadata in `AccumulatedToolPart`**
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

- [ ] 7. **Create `AgentSelector` component**
  **What**: A dropdown button near the prompt input that shows the currently selected agent and lets users pick a different one. Uses DropdownMenu from Radix UI.
  **Files**: `src/components/session/agent-selector.tsx` (new file)
  **Design**:
  - Trigger: A compact button showing the current agent name with a colored dot. When no agent is selected, show "Default" or "Auto".
  - Content: DropdownMenu with `DropdownMenuRadioGroup` listing available agents. Each item shows agent name, colored dot, mode badge (e.g., "primary"), and model info.
  - Filter: Only show agents where `mode !== "subagent"`. Do NOT filter on `hidden` — it does not exist in v1. (If v2 is adopted later, add `&& !agent.hidden` at that time.)
  - Props: `agents: AutocompleteAgent[]`, `selectedAgent: string | null`, `onSelect: (agent: string | null) => void`, `disabled?: boolean`
  - Size: Compact (height matches the send button, ~h-9). Uses `text-xs`.
  **Acceptance**: Renders a dropdown showing available non-subagent agents. Selection calls `onSelect` with the agent name. Selecting the already-selected agent (or a "Default" option) calls `onSelect(null)`.

- [ ] 8. **Integrate `AgentSelector` into `PromptInput`**
  **What**: Add the `AgentSelector` to the left of the input field. Wire it to local state that tracks the selected agent. Pass the selected agent to `onSend`.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  - Add props: `agents: AutocompleteAgent[]` (passed from parent), `selectedAgent: string | null`, `onAgentChange: (agent: string | null) => void`
  - Render `<AgentSelector>` before the `<Input>` in the form
  - Change `onSend` signature to `(text: string, agent?: string) => Promise<void>`
  - In submit handler: call `onSend(text, selectedAgent ?? undefined)`
  **Acceptance**: The agent selector appears in the prompt bar. Selected agent is passed to `onSend`.

- [ ] 9. **Wire agent selection through the session page**
  **What**: Update the session detail page to pass agents to PromptInput and forward the agent parameter to `sendPrompt`. Manage agent selection state here (not in PromptInput) so auto-agent-switching can update it.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Import and call `useAgents(instanceId)` to get the agents list
  - Add state: `const [selectedAgent, setSelectedAgent] = useState<string | null>(null)`
  - Pass `agents`, `selectedAgent`, `onAgentChange: setSelectedAgent` to `<PromptInput>`
  - Update `handleSend` callback: `async (text: string, agent?: string) => { await sendPrompt(sessionId, instanceId, text, agent); }`
  **Acceptance**: Full data flow works: user selects agent → enters text → submits → API receives `agent` param → `promptAsync` is called with `agent`.

- [ ] 10. **`@agent` autocomplete sets the active agent**
  **What**: When a user selects an agent from `@` autocomplete, in addition to inserting the text, also set it as the active agent for the prompt.
  **Files**: `src/components/session/prompt-input.tsx`, `src/hooks/use-autocomplete.ts`
  **Changes**:
  - Add an `onAgentSelect?: (agentName: string) => void` callback to `UseAutocompleteParams`
  - In `useAutocomplete.onSelect()`: if the selected item is an agent (group === "agent"), extract the agent name and call `onAgentSelect`
  - In `PromptInput`: pass `onAgentSelect` that calls `onAgentChange` with the agent name
  **Acceptance**: Typing `@plan` and selecting from autocomplete inserts `@plan ` into the input AND sets the agent selector to "plan".

### Phase 3: Active Agent Display

- [ ] 11. **Show agent name, model, and duration on assistant messages (TUI pattern)**
  **What**: Replace the hardcoded "Assistant" label with the TUI's pattern: `▣ AgentName · modelID · duration`. Show the agent's color on the bullet and as a left border on the message.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - `MessageItem` receives `agents?: AutocompleteAgent[]` and `allMessages?: AccumulatedMessage[]` as props (for color lookup and duration calculation)
  - For assistant messages:
    - Display agent name: use `message.agent` (which was populated from `info.mode` — see Task 5), titlecased. Fallback to "Assistant" if undefined.
    - Display `▣` colored bullet before the agent name, using agent color from `agents` list (look up by matching `agent.name === message.agent`)
    - Display `· {message.modelID}` after the name in muted text
    - Compute duration: find parent user message (via `message.parentID`), calculate `message.completedAt - parentMessage.createdAt`, format as seconds (e.g., "3.2s"). Only show when `completedAt` is set.
    - Add colored left border to the message container using `border-l-2` with the agent's color
  - For user messages: show colored left border using `message.agent` color (which was populated from `info.agent` — see Task 5)
  - Props update: add `agents?: AutocompleteAgent[]` to `ActivityStreamV1Props`
  **Acceptance**: Assistant messages show "▣ Build · gpt-4o · 3.2s" with colored bullet and left border. User messages have colored left borders.

- [ ] 12. **Add active agent indicator in the status bar**
  **What**: Show which agent is currently working in the bottom status bar (and in the "Thinking…" indicator).
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Derive active agent from the latest user message's `agent` field (this is the agent that was selected for the prompt, populated from `info.agent` on `UserMessage`)
  - When `sessionStatus === "busy"`, show "`{agentName}` working…" instead of just "Agent working…"
  - In the "Thinking…" bubble, show the agent name if available (e.g., "Build thinking…")
  - Apply the agent's color to the status dot instead of always green
  **Acceptance**: When agent "build" is working, status bar shows a colored dot and "Build working…".

- [ ] 13. **Show active agent in the session header**
  **What**: Display a small badge in the header showing the currently active agent when the session is busy.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Derive active agent from the last user message's `agent` field (populated from `info.agent` on `UserMessage` — see Task 5)
  - Look up agent color from the agents list
  - Add a `Badge` next to the existing "Working"/"Idle" badge showing the titlecased agent name with its color as a dot
  - Only show when `sessionStatus === "busy"` and an agent is known
  **Acceptance**: Header shows `[Working] [● Build]` with the agent's color when an agent is actively responding.

### Phase 4: Subagent/Delegation Visibility

- [ ] 14. **Render `task` tool calls as delegation blocks in the activity stream**
  **What**: When a tool call has `tool === "task"` and its `state.input` contains `subagent_type` or `description`, render it as a delegation indicator instead of a generic tool call. Follow the TUI's rendering pattern.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Add a `TaskDelegationItem` component rendered for tool parts where `isTaskToolCall(part)` returns true and `getTaskToolInput(part)` is non-null
  - Display pattern (matching TUI):
    - Title: `"# " + titlecase(input.subagent_type ?? "unknown") + " Task"`
    - Description text + toolcall count (if available from child session — for V1, just show description)
    - Spinner while `state.status === "running"` or `state.status === "pending"`
    - Status badge when completed/errored
    - Styled as a block with colored left border (distinct from regular tool calls — use a different bg/border treatment)
  - In `ToolCallItem`, add early return: if `isTaskToolCall(part) && getTaskToolInput(part)`, render `<TaskDelegationItem>` instead
  **Acceptance**: When the SDK emits a `task` tool call with `subagent_type: "plan"` and `description: "Analyze the codebase"`, it renders as "# Plan Task" with the description and a spinner while running.

- [ ] 15. **Auto-switch agent on `plan_exit`/`plan_enter` tool completions**
  **What**: When a `message.part.updated` event arrives for a completed `plan_exit` or `plan_enter` tool call, automatically update the selected agent in the agent picker. This matches the TUI behavior (lines 209-224).
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

- [ ] 16. **Add "Active Agents" section to the session sidebar**
  **What**: Show a list of agents that have participated in the session, derived from message metadata.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Compute a set of unique agents from `messages.map(m => m.agent).filter(Boolean)` — this works because `AccumulatedMessage.agent` is populated from `info.agent` (user) or `info.mode` (assistant), so all messages have a consistent agent name.
  - For each agent, show: colored dot (from agents list), titlecased name, message count
  - Place after the "Tokens" section in the sidebar
  - Use the `agents` list from `useAgents` to resolve colors
  **Acceptance**: Sidebar shows "Agents" section listing e.g., "● Build (5 messages), ● Plan (2 messages)".

## Implementation Notes

### Agent Selection State
The selected agent is managed at the **session page level** (not inside PromptInput), because:
- Auto-agent-switching (task 15) needs to update it from event processing
- It persists across prompts until explicitly changed
- Add a visible "×" clear button on the selector to reset to default

### Agent Identity from SDK Messages (v1 SDK — CORRECTED)

> **The v1 and v2 SDKs differ significantly here.** This project uses v1.

**v1 SDK types** (`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`):
- `UserMessage` has `agent: string` — the agent selected for the prompt
- `AssistantMessage` does **NOT** have `agent`. It has `mode: string` — which IS the agent name (e.g., `"build"`, `"plan"`)

**Mapping to `AccumulatedMessage.agent`:**
| Message Role | Source Field | Why |
|---|---|---|
| `"user"` | `info.agent` | `UserMessage.agent` exists in v1 |
| `"assistant"` | `info.mode` | `AssistantMessage.agent` does NOT exist in v1; `mode` is the agent name |

Both map to the same `AccumulatedMessage.agent` field, giving a unified interface for the UI layer. The UI never needs to know about the v1/v2 difference — it just reads `message.agent`.

Additionally for assistant messages:
- `AssistantMessage.modelID: string` — the model used
- `AssistantMessage.time.completed?: number` — when the response finished
- `AssistantMessage.parentID: string` — links to the user message (for duration calculation)

### Agent Type — No `hidden` field in v1

The v1 SDK `Agent` type has these fields: `name`, `description`, `mode`, `builtIn`, `color`, `model`, `permission`, `tools`, `options`, `maxSteps`, `topP`, `temperature`, `prompt`.

It does **NOT** have `hidden`. The TUI's filter `x.mode !== "subagent" && !x.hidden` works in v2 but in v1, `x.hidden` is always `undefined`, making `!undefined === true` — so the check is vacuously true and has no effect. We only filter on `mode !== "subagent"` to avoid confusion.

### Subagent Detection (CORRECTED)
Delegation signals come from **regular `task` tool calls**, NOT from `subtask` or `agent` part types. The detection logic:
1. Check `part.type === "tool"` AND `part.tool === "task"`
2. Check `part.state.input.subagent_type` or `part.state.input.description`
3. The child session ID is in `part.state.metadata.sessionId`

The SDK's inline subtask type and `AgentPart` type exist but are NOT what the TUI renders for delegation. We should handle them in `applyPartUpdate()` for completeness but prioritize rendering `task` tool calls.

### Filtering Agents for the Selector (v1-CORRECTED)
Filter: `agent.mode !== "subagent"` only. No `hidden` check (see above).

### Duration Calculation
The TUI computes duration as `assistantMessage.time.completed - parentUserMessage.time.created`. To replicate:
1. Store `parentID` and `completedAt` on `AccumulatedMessage`
2. In the activity stream, find the parent user message by `parentID`
3. Calculate `completedAt - parentMessage.createdAt`
4. Format as "Xs" or "Xm Ys" using a simple formatter

### No New Dependencies
All needed UI components exist: `DropdownMenu`, `Badge`, `Button`, `Tooltip`. No new packages required.

## Verification
- [ ] All existing tests pass (`npm run test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Agent selector renders and is interactive
- [ ] Sending a prompt with an agent selected sends the `agent` param to the API
- [ ] Assistant messages show `▣ AgentName · modelID · duration` with agent color
- [ ] User and assistant messages have agent-colored left borders
- [ ] `task` tool calls with `subagent_type` render as delegation blocks with spinner
- [ ] Agent selector auto-switches on `plan_exit`/`plan_enter` completions
- [ ] Sidebar shows participating agents
- [ ] Sending without an agent selected works as before (no regression)
