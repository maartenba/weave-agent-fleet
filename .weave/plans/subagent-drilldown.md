# Subagent Drill-Down Visibility

## TL;DR
> **Summary**: Add inline expandable subagent visibility by parameterizing existing SSE/messages endpoints with an `opencodeSessionId` query parameter, then making `TaskDelegationItem` expandable to render a nested activity stream of child session messages in real time.
> **Estimated Effort**: Medium

## Context
### Original Request
When an agent spawns subagents via the `task` tool, those subagents run as child sessions within the same OpenCode process. The OpenCode TUI can drill into them, but the Fleet UI currently cannot. The `TaskDelegationItem` component renders a static card showing subagent type, description, and status — it needs to become expandable to show the child session's conversation inline.

### Key Findings

1. **SSE events endpoint** (`src/app/api/sessions/[id]/events/route.ts`) subscribes to `client.event.subscribe({ directory })` on the instance and filters events using `isRelevantToSession(type, properties, sessionId)` where `sessionId` comes from the URL path param `[id]`. Adding an optional `opencodeSessionId` query param to override the filtering session ID lets the UI stream events from a child session using the same instance connection.

2. **Messages endpoint** (`src/app/api/sessions/[id]/messages/route.ts`) calls `client.session.messages({ sessionID: sessionId })` where `sessionId` is the URL path param. Adding an optional `opencodeSessionId` query param to override the `sessionID` passed to the SDK lets the UI fetch a child session's messages from the same instance.

3. **`isRelevantToSession()`** in `src/lib/event-state.ts` (line 182) matches events by comparing `properties.part.sessionID`, `properties.info.sessionID`, `properties.sessionID`, etc. against the provided `sessionId` string. No structural changes needed — just pass the child's session ID instead of the parent's.

4. **`getTaskToolSessionId(part)`** in `src/lib/api-types.ts` (line 143) extracts `state.metadata.sessionId` — this is the OpenCode SDK session ID for the child. This is the value to pass as `opencodeSessionId`.

5. **`useSessionEvents` hook** (`src/hooks/use-session-events.ts`) constructs the SSE URL at line 124: `/api/sessions/${sessionId}/events?instanceId=${instanceId}`. The `sessionId` here is used for both the URL path and the event filtering. For subagent drill-down, we need a variant that passes an additional `opencodeSessionId` param to the SSE URL.

6. **`useMessagePagination` hook** (`src/hooks/use-message-pagination.ts`) constructs the messages URL at line 61: `/api/sessions/${sessionId}/messages?instanceId=${instanceId}&limit=...`. Same pattern — needs to accept an optional override session ID.

7. **`CollapsibleToolCall` component** (`src/components/session/collapsible-tool-call.tsx`) uses the `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` from `@/components/ui/collapsible` (radix-ui primitives). It manages `open` state via `useState(false)`. This is the exact expand/collapse pattern to reuse for `TaskDelegationItem`.

8. **`TaskDelegationItem`** (`src/components/session/activity-stream-v1.tsx`, lines 57-87) is a plain function component (not `memo`). It receives `{ part: AccumulatedToolPart }`. Since it's rendered by `ToolCallItem` which is rendered by `MessageItem` (a memo'd component), adding hooks to `TaskDelegationItem` is safe — it re-renders when `part` changes.

9. **`handleEvent()` in `useSessionEvents`** (line 246) uses the `sessionId` argument to filter `message.part.delta` events (line 306: `if (sessionID !== sessionId) return`). For the subagent variant, this filter must use the child session ID.

10. **Recursive subagents**: A child session can spawn its own subagents (task tool calls within task tool calls). The expandable card design naturally supports this — a nested `TaskDelegationItem` inside a child's activity stream would itself be expandable. A max nesting depth guard prevents UI runaway.

## Objectives
### Core Objective
Enable users to expand task delegation blocks and see the child session's activity inline in real time, without leaving the parent session view.

### Deliverables
- [ ] Parameterized events endpoint accepts `opencodeSessionId` to stream a different session's events
- [ ] Parameterized messages endpoint accepts `opencodeSessionId` to fetch a different session's messages
- [ ] `useSubagentMessages` hook that connects to a child session's SSE stream and accumulates messages
- [ ] Expandable `TaskDelegationItem` with inline child activity stream
- [ ] Recursive subagent support with configurable max depth
- [ ] Loading/error/empty states for subagent expansion

### Definition of Done
- [ ] Clicking expand on a task block shows the child session's conversation inline
- [ ] Live SSE updates flow into the expanded child view in real time
- [ ] Collapsing a task block disconnects the child SSE connection
- [ ] The `opencodeSessionId` param is optional — omitting it preserves existing behavior
- [ ] Recursive expansion works (subagent within subagent) up to 3 levels
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] Existing tests pass: `npx vitest run`
- [ ] Build succeeds: `npm run build`

### Guardrails (Must NOT)
- Must NOT break existing SSE consumers — the `opencodeSessionId` param is purely additive
- Must NOT modify `isRelevantToSession()` function signature or logic
- Must NOT open SSE connections for collapsed task blocks (lazy connection only)
- Must NOT introduce new npm dependencies
- Must NOT modify the database schema
- Must NOT render more than 3 levels of nested subagent expansion

---

## TODOs

### Phase 1: API — Parameterized Subagent Access

- [ ] 1. **Modify the events endpoint to accept `opencodeSessionId`**
  **What**: Add an optional `opencodeSessionId` query parameter to the SSE events endpoint. When provided, use it instead of the URL's `sessionId` for event filtering via `isRelevantToSession()`. The URL's `sessionId` remains the "parent" session (for instance lookup), while `opencodeSessionId` controls which session's events are forwarded.
  **Files**: `src/app/api/sessions/[id]/events/route.ts` (modify)
  **Details**:
  - After line 32 (`const instanceId = ...`), add:
    ```typescript
    const opencodeSessionId = request.nextUrl.searchParams.get("opencodeSessionId");
    const filterSessionId = opencodeSessionId ?? sessionId;
    ```
  - On line 111, change:
    ```typescript
    // Before:
    if (!isRelevantToSession(type, properties, sessionId)) continue;
    // After:
    if (!isRelevantToSession(type, properties, filterSessionId)) continue;
    ```
  - **Critical**: The notification/status-tracking logic (lines 117-177) must continue using the original `sessionId` (not `filterSessionId`) because notifications are tied to the parent Fleet session, not the child. Do NOT change the `sessionId` references in the notification block.
  - The `send()` call on line 113 is unaffected — it forwards whatever events pass the filter.
  **Acceptance**: `curl` to `/api/sessions/PARENT_ID/events?instanceId=XXX&opencodeSessionId=CHILD_ID` streams events belonging to the child session. Omitting `opencodeSessionId` preserves existing behavior.

- [ ] 2. **Modify the messages endpoint to accept `opencodeSessionId`**
  **What**: Add an optional `opencodeSessionId` query parameter to the messages endpoint. When provided, use it instead of the URL's `sessionId` when calling `client.session.messages()`.
  **Files**: `src/app/api/sessions/[id]/messages/route.ts` (modify)
  **Details**:
  - After line 25 (`const before = ...`), add:
    ```typescript
    const opencodeSessionId = searchParams.get("opencodeSessionId");
    const targetSessionId = opencodeSessionId ?? sessionId;
    ```
  - On line 53, change:
    ```typescript
    // Before:
    const messagesResult = await client.session.messages({ sessionID: sessionId });
    // After:
    const messagesResult = await client.session.messages({ sessionID: targetSessionId });
    ```
  - Log messages should still reference the URL `sessionId` for debugging clarity (don't change the error log format strings).
  **Acceptance**: `curl` to `/api/sessions/PARENT_ID/messages?instanceId=XXX&opencodeSessionId=CHILD_ID` returns the child session's messages. Omitting `opencodeSessionId` preserves existing behavior.

---

### Phase 2: Hook — Subagent Message Streaming

- [ ] 3. **Create `useSubagentMessages` hook**
  **What**: A React hook that connects to a child session's SSE stream and accumulates messages, similar to `useSessionEvents` but scoped for inline subagent display. It uses the parameterized endpoints from Phase 1. The hook only connects when explicitly enabled (lazy connection for expand/collapse).
  **Files**: `src/hooks/use-subagent-messages.ts` (new)
  **Details**:
  - Signature:
    ```typescript
    export interface UseSubagentMessagesResult {
      messages: AccumulatedMessage[];
      status: SessionConnectionStatus;
      sessionStatus: "idle" | "busy";
      error?: string;
    }

    export function useSubagentMessages(
      parentSessionId: string,
      instanceId: string,
      childSessionId: string | null,
      enabled: boolean,
    ): UseSubagentMessagesResult
    ```
  - When `enabled` is false or `childSessionId` is null, return empty state and do NOT open any connections.
  - When `enabled` is true and `childSessionId` is non-null:
    - Construct SSE URL: `/api/sessions/${parentSessionId}/events?instanceId=${instanceId}&opencodeSessionId=${childSessionId}`
    - Open an `EventSource` connection
    - On open, fetch initial messages via: `/api/sessions/${parentSessionId}/messages?instanceId=${instanceId}&opencodeSessionId=${childSessionId}&limit=50`
    - Process incoming SSE events using the same `handleEvent()` pattern from `useSessionEvents` (import `ensureMessage`, `mergeMessageUpdate`, `applyPartUpdate`, `applyTextDelta` from `event-state.ts`)
    - **Important**: The `handleEvent()` function's `message.part.delta` handler (line 304-311 in `use-session-events.ts`) filters by `sessionID !== sessionId`. In this hook, use `childSessionId` for that comparison.
  - On `enabled` changing to false, close the EventSource and clear messages.
  - On unmount, close the EventSource.
  - Include reconnection logic (reuse the exponential backoff pattern from `useSessionEvents`).
  - No pagination support needed for inline preview (just the last 50 messages).
  - **Why a separate hook instead of parameterizing `useSessionEvents`**: The existing hook has deep coupling to pagination (`useMessagePagination`), `loadAllMessages` recovery, `onAgentSwitch` callbacks, and `forceIdle`. The subagent variant needs none of these — it's a simplified read-only stream. A separate hook is cleaner and avoids destabilizing the primary hook.
  **Acceptance**: When enabled with valid IDs, the hook streams child session events and returns accumulated messages. When disabled, no connections are open.

---

### Phase 3: UI — Expandable Task Delegation Cards

- [ ] 4. **Create `SubagentActivityInline` component**
  **What**: A component that renders a child session's activity stream inline within a task delegation card. It uses `useSubagentMessages` and renders a compact version of the message list.
  **Files**: `src/components/session/subagent-activity-inline.tsx` (new)
  **Details**:
  - Props:
    ```typescript
    interface SubagentActivityInlineProps {
      parentSessionId: string;
      instanceId: string;
      childSessionId: string;
      /** Current nesting depth — used to enforce max recursion */
      depth: number;
    }
    ```
  - Uses `useSubagentMessages(parentSessionId, instanceId, childSessionId, true)` — always enabled when mounted (the parent controls mount/unmount via expand/collapse).
  - Renders messages in a compact format:
    - User messages: role icon + truncated text (single line, max ~120 chars)
    - Assistant messages: agent name + text content (allow multi-line, rendered with `MarkdownRenderer` from `./markdown-renderer`)
    - Tool calls: delegate to `ToolCallItem` from `activity-stream-v1.tsx` (this automatically handles nested task tool calls via `TaskDelegationItem`)
    - **Recursive support**: `ToolCallItem` → `TaskDelegationItem` → (if expanded) `SubagentActivityInline` — the recursion is natural. The `depth` prop is passed through to prevent infinite nesting.
  - Container styling:
    - `ml-4 border-l-2 border-indigo-500/30` — visual indentation and color coding
    - `max-h-96 overflow-y-auto` — scrollable with max height
    - `bg-muted/10` — subtle background to distinguish from parent stream
  - Status indicators:
    - While connecting: `<Loader2 className="animate-spin" />` with "Connecting to subagent..."
    - While busy: "Subagent working..." indicator at bottom
    - On error: error message with subtle styling
    - When idle with messages: show messages normally
    - When idle with no messages: "No activity recorded"
  **Acceptance**: Component renders child session messages compactly within the parent's activity stream. Recursive rendering works up to the depth limit.

- [ ] 5. **Make `TaskDelegationItem` expandable**
  **What**: Transform `TaskDelegationItem` from a static card to an expandable card using the `Collapsible` component pattern from `CollapsibleToolCall`. When expanded, mount `SubagentActivityInline` to show the child's activity.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify `TaskDelegationItem`)
  **Details**:
  - Add new props to `TaskDelegationItem`:
    ```typescript
    interface TaskDelegationItemProps {
      part: AccumulatedToolPart;
      /** The parent session's OpenCode session ID (for API calls) */
      parentSessionId: string;
      /** The parent session's instance ID (for API calls) */
      instanceId: string;
      /** Current nesting depth for recursive subagent rendering */
      depth?: number;
    }
    ```
  - Add state: `const [isExpanded, setIsExpanded] = useState(false);`
  - Extract child session ID: `const childSessionId = getTaskToolSessionId(part);`
  - Determine if expandable: `const canExpand = childSessionId !== null;`
  - Restructure the component to use `Collapsible`:
    ```tsx
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger asChild disabled={!canExpand}>
        <div className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs border-l-2 border-l-indigo-500/60 cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2 font-medium text-foreground/80">
            {/* Chevron indicator */}
            {canExpand ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              )
            ) : null}
            {/* Status indicator (existing) */}
            {isRunning && <Loader2 className="h-3 w-3 animate-spin text-indigo-400 shrink-0" />}
            {!isRunning && !isError && (
              <span className="h-2 w-2 rounded-full bg-green-500 shrink-0 inline-block" />
            )}
            {isError && (
              <span className="h-2 w-2 rounded-full bg-red-500 shrink-0 inline-block" />
            )}
            <span>{title}</span>
          </div>
          {input.description && (
            <p className="mt-1 text-muted-foreground leading-relaxed">{input.description}</p>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {canExpand && isExpanded && (depth ?? 0) < MAX_SUBAGENT_DEPTH && (
          <SubagentActivityInline
            parentSessionId={parentSessionId}
            instanceId={instanceId}
            childSessionId={childSessionId}
            depth={(depth ?? 0) + 1}
          />
        )}
        {(depth ?? 0) >= MAX_SUBAGENT_DEPTH && (
          <div className="ml-4 py-2 text-xs text-muted-foreground italic">
            Maximum nesting depth reached
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
    ```
  - Add constant: `const MAX_SUBAGENT_DEPTH = 3;`
  - Import `SubagentActivityInline` from `./subagent-activity-inline`
  - Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`
  - Import `ChevronDown`, `ChevronRight` from `lucide-react` (already imported at line 7)
  - **Update `ToolCallItem` call site** (line 94): Pass `parentSessionId` and `instanceId` through. This requires `ToolCallItem` to also accept and pass these props.
  - **Update `ToolCallItem` props**: Add `parentSessionId`, `instanceId`, and `depth` props. Pass them through to `TaskDelegationItem`.
  - **Update `MessageItem`**: Pass `parentSessionId` (which is `message.sessionId`) and `instanceId` to each `ToolCallItem`. The `instanceId` is not currently available in `MessageItem` — it needs to be threaded through from `ActivityStreamV1`.
  - **Prop threading path**: `ActivityStreamV1` receives `instanceId` (new prop) → `MessageItem` receives `instanceId` → `ToolCallItem` receives `instanceId` + `parentSessionId` → `TaskDelegationItem` receives both.
  - **Add `instanceId` prop to `ActivityStreamV1Props`**: Add `instanceId: string` to the interface. This is already available on the session detail page (`page.tsx`, line 42) and is currently passed to `useSessionEvents`. Just add it as a prop to `ActivityStreamV1` as well.
  - **Update session detail page**: Pass `instanceId` to `<ActivityStreamV1>` in `src/app/sessions/[id]/page.tsx`.
  **Acceptance**: Task blocks with resolved child session IDs show a chevron and are expandable. Clicking expands to show the child's activity inline. Collapsing unmounts the child stream.

- [ ] 6. **Thread `instanceId` through the component hierarchy**
  **What**: Add the `instanceId` prop through the component chain so `TaskDelegationItem` has access to it for the subagent API calls. Also thread `parentSessionId` (derived from the message's `sessionId`).
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify)
  **Details**:
  - **`ActivityStreamV1Props`** — add:
    ```typescript
    /** Instance ID — needed for subagent drill-down API calls */
    instanceId?: string;
    ```
  - **`MessageItemProps`** — add:
    ```typescript
    instanceId?: string;
    ```
  - **`ToolCallItem`** — change from:
    ```typescript
    function ToolCallItem({ part }: { part: AccumulatedPart & { type: "tool" } })
    ```
    to:
    ```typescript
    function ToolCallItem({ part, parentSessionId, instanceId, depth }: {
      part: AccumulatedPart & { type: "tool" };
      parentSessionId?: string;
      instanceId?: string;
      depth?: number;
    })
    ```
  - Update `ToolCallItem` to pass props through to `TaskDelegationItem`:
    ```typescript
    if (isTaskToolCall(part) && getTaskToolInput(part)) {
      return <TaskDelegationItem part={part} parentSessionId={parentSessionId ?? ""} instanceId={instanceId ?? ""} depth={depth} />;
    }
    ```
  - In `MessageItem`, pass through when rendering `ToolCallItem`:
    ```typescript
    <ToolCallItem
      key={part.partId}
      part={part}
      parentSessionId={message.sessionId}
      instanceId={instanceId}
      depth={0}
    />
    ```
  - In `ActivityStreamV1`, pass `instanceId` to `MessageItem`:
    ```typescript
    <MessageItem
      message={message}
      agents={agents}
      instanceId={instanceId}
      ...
    />
    ```
  - In `src/app/sessions/[id]/page.tsx`, pass `instanceId` to `<ActivityStreamV1>`:
    ```typescript
    <ActivityStreamV1
      messages={messages}
      ...
      instanceId={instanceId}
    />
    ```
  **Acceptance**: `instanceId` is accessible in `TaskDelegationItem` for subagent API calls. No TypeScript errors.

- [ ] 7. **Handle edge case: child session not yet created**
  **What**: When a task tool call first appears (status "running"), `getTaskToolSessionId()` may return `null` because the child session hasn't been created yet. The component must handle this gracefully and become expandable once the metadata arrives.
  **Files**: `src/components/session/activity-stream-v1.tsx` (already handled in task 5)
  **Details**:
  - `getTaskToolSessionId(part)` returns `null` when `state.metadata.sessionId` is not yet set.
  - `canExpand = childSessionId !== null` — non-expandable when null.
  - When the SSE stream updates the part (via `applyPartUpdate` in `event-state.ts`), `part.state` is replaced with the new state which includes `metadata.sessionId`.
  - React re-renders `TaskDelegationItem` with the updated `part` → `childSessionId` becomes non-null → `canExpand` becomes true → chevron appears.
  - No explicit polling or retry needed — the SSE stream naturally delivers the update.
  - For completed subagents (page load with historical data), the metadata is already present in the initial message load.
  **Acceptance**: Task blocks without child session metadata render without a chevron. Once metadata arrives via SSE, the chevron appears and the block becomes expandable. No errors during the transition.

---

### Phase 4: Polish

- [ ] 8. **Add depth-based visual nesting indicators**
  **What**: Make nested subagent expansions visually distinct at each level with indentation and color variation.
  **Files**: `src/components/session/subagent-activity-inline.tsx` (modify)
  **Details**:
  - Use depth to vary the left border color:
    - Depth 1: `border-indigo-500/30` (default)
    - Depth 2: `border-purple-500/30`
    - Depth 3: `border-pink-500/30`
  - Increase left margin per depth: `ml-${2 + depth * 2}` (or use inline style for dynamic values)
  - Decrease max height per depth: `max-h-96` → `max-h-72` → `max-h-48`
  - Show depth indicator text: "↳ Subagent (depth N)"
  **Acceptance**: Nested subagent expansions are visually distinct and don't consume excessive vertical space.

- [ ] 9. **Add subagent status summary on collapsed card**
  **What**: Show a lightweight status summary on the collapsed `TaskDelegationItem` card (e.g., "3 messages · 5 tool calls" or "Working...") derived from the tool's state without opening an SSE connection.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify `TaskDelegationItem`)
  **Details**:
  - Extract available info from `part.state`:
    - `state.output` — when completed, may contain a summary
    - `state.status` — "running", "completed", "error"
  - Show output preview (truncated to ~60 chars) on the collapsed card, similar to how `CollapsibleToolCall` shows `truncatedOutput` (line 57-65).
  - For running subagents: show "Working..." (already shown via spinner)
  - For completed subagents: show the first line of `state.output` if available
  - For error subagents: show error text preview in red
  - This requires NO additional API calls — it uses data already in the accumulated part state.
  **Acceptance**: Collapsed task blocks show a status summary. No additional network requests.

- [ ] 10. **Tests**
  **What**: Add tests covering the modified API endpoints and the new hook.
  **Files**:
  - `src/app/api/sessions/[id]/events/__tests__/route.test.ts` (new or extend existing)
  - `src/app/api/sessions/[id]/messages/__tests__/route.test.ts` (new or extend existing)
  - `src/hooks/__tests__/use-subagent-messages.test.ts` (new)
  **Details**:
  - **Events endpoint tests**:
    - Without `opencodeSessionId` → filters using URL session ID (backward compat)
    - With `opencodeSessionId` → filters using the override session ID
    - Notification logic still uses the original URL session ID (not the override)
  - **Messages endpoint tests**:
    - Without `opencodeSessionId` → calls `client.session.messages({ sessionID: urlSessionId })`
    - With `opencodeSessionId` → calls `client.session.messages({ sessionID: overrideSessionId })`
  - **Hook tests**:
    - When `enabled=false` → no EventSource created, returns empty messages
    - When `childSessionId=null` → no EventSource created
    - When enabled with valid IDs → EventSource opens to correct URL
    - On unmount → EventSource closed
  - Follow existing test patterns (vitest + vi.mock)
  **Acceptance**: `npx vitest run` passes with all new tests.

---

## Implementation Order

```
Phase 1 (Tasks 1-2):   API endpoint modifications (quick, low-risk)
Phase 2 (Task 3):      useSubagentMessages hook
Phase 3 (Tasks 4-7):   UI components and prop threading
Phase 4 (Tasks 8-10):  Visual polish and tests
```

**Dependencies**:
- Tasks 1-2 are independent of each other, can be done in parallel
- Task 3 depends on Tasks 1-2 (uses the parameterized endpoints)
- Task 4 depends on Task 3 (uses the hook)
- Tasks 5-6 depend on Task 4 (wire up the component)
- Task 7 is a verification of the design from tasks 5-6
- Tasks 8-9 are independent polish, can be done in parallel
- Task 10 can be done at any point after Tasks 1-3

## Edge Cases

| Scenario | Handling |
|----------|----------|
| `getTaskToolSessionId()` returns null (tool running, no metadata yet) | Render non-expandable card. SSE part update will re-render with metadata. |
| Child session not yet started (metadata present but session empty) | `useSubagentMessages` returns empty messages array. Component shows "No activity recorded." |
| Child session on same instance but already completed | Initial message fetch returns historical messages. SSE may not deliver new events — that's fine, the messages are already loaded. |
| Multiple task blocks expanded simultaneously | Each opens its own SSE connection. Browser limit is ~6 per domain. Unlikely to exceed with 3-level max depth. |
| Parent navigates away while child is expanded | React unmounts → `useSubagentMessages` cleanup closes EventSource. Clean. |
| Recursive subagents (child spawns grandchild) | `SubagentActivityInline` renders `ToolCallItem` → `TaskDelegationItem` → expandable again. `depth` prop prevents > 3 levels. |
| `instanceId` not provided to `ActivityStreamV1` | Props are optional (`instanceId?: string`). When undefined, `TaskDelegationItem` renders without expand capability (graceful degradation). |
| `opencodeSessionId` points to a non-existent session | `client.session.messages()` will return empty or error. Hook handles errors gracefully. SSE stream won't match any events — no events forwarded. |
| Subagent on a different instance (external task) | Not supported — `opencodeSessionId` only works within the same instance's event stream. Card renders without expand. This is correct because external subagents would be separate Fleet sessions. |

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `src/app/api/sessions/[id]/events/route.ts` | Modify (add `opencodeSessionId` param) | 1 |
| `src/app/api/sessions/[id]/messages/route.ts` | Modify (add `opencodeSessionId` param) | 1 |
| `src/hooks/use-subagent-messages.ts` | Create | 2 |
| `src/components/session/subagent-activity-inline.tsx` | Create | 3 |
| `src/components/session/activity-stream-v1.tsx` | Modify (expandable `TaskDelegationItem`, prop threading) | 3 |
| `src/app/sessions/[id]/page.tsx` | Modify (pass `instanceId` to `ActivityStreamV1`) | 3 |

## Verification
- [ ] All existing tests pass: `npx vitest run`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] Build succeeds: `npm run build`
- [ ] Dev server runs: `npm run dev`
- [ ] Events endpoint without `opencodeSessionId` works identically to before
- [ ] Events endpoint with `opencodeSessionId` streams only child session events
- [ ] Messages endpoint without `opencodeSessionId` works identically to before
- [ ] Messages endpoint with `opencodeSessionId` returns child session messages
- [ ] Expanding a task block shows child session activity inline
- [ ] Collapsing closes the SSE connection (verify in browser DevTools → Network tab)
- [ ] Expanding a completed subagent shows historical messages
- [ ] Recursive expansion works up to 3 levels deep
- [ ] Task blocks without child metadata render normally (no chevron, no errors)
- [ ] No regressions in non-task tool call rendering (`CollapsibleToolCall` still works)
