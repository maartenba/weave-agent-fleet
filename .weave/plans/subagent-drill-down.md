# Subagent Work Drill-Down

## TL;DR
> **Summary**: Make task tool blocks in the activity stream clickable to navigate to child sessions, show live child status on task blocks, and support inline expansion of child activity — enabling users to drill into subagent work without losing context.
> **Estimated Effort**: Large

## Context
### Original Request
Users see task tool calls as opaque status blocks in the activity stream. They cannot see what the subagent is doing, navigate to the child session, or get live status updates. This feature adds three levels of drill-down: linking (Phase 1), live status badges (Phase 2), and inline expansion (Phase 3).

### Key Findings

1. **`getTaskToolSessionId(part)`** in `src/lib/api-types.ts` (line 143) already extracts `state.metadata.sessionId` from a task tool part — this is the **OpenCode SDK session ID**, not the Fleet DB ID. Navigation requires resolving this to a Fleet DB session (which has `instance_id` for URL construction).

2. **`getSessionByOpencodeId()`** in `src/lib/server/db-repository.ts` (line 197) already looks up a `DbSession` by OpenCode session ID. This is the exact function needed for the lookup API.

3. **`TaskDelegationItem`** component in `src/components/session/activity-stream-v1.tsx` (line 36) renders task tool blocks. It's currently a simple `<div>` with no interactivity — needs to become a clickable/expandable container.

4. **Session detail page** (`src/app/sessions/[id]/page.tsx`) uses the OpenCode session ID as the URL param `[id]` and requires `?instanceId=xxx`. Both values must be obtained from the resolved `DbSession`.

5. **`SessionListItem.parentSessionId`** (line 57 in `api-types.ts`) is already populated by `GET /api/sessions` — the child session detail page can use this to render a "back to parent" link.

6. **SSE event stream** (`/api/sessions/[id]/events/route.ts`) is per-session. For Phase 2/3, the parent view needs child session status. Options: (a) lightweight polling endpoint, (b) open a second EventSource to child's SSE. Polling is simpler and avoids multiplied SSE connections.

7. **No `getChildSessionsForParent()` DB function exists** — only `nestSessions()` in `session-utils.ts` does client-side grouping from the full session list.

8. **The `AccumulatedToolPart.state` shape for task tools**: `{ status: "running" | "completed" | "error", input: { subagent_type, description }, metadata: { sessionId: string }, output?: string }`.

9. **Existing session detail page metadata fetch** (line 66–90 of `page.tsx`) already calls `GET /api/sessions/[id]?instanceId=xxx` on mount. The response includes `session`, `messages`, `workspaceId`, `workspaceDirectory`, `isolationStrategy` but not `parentSessionId`. This needs extending.

10. **The `useSessionEvents` hook** returns `messages`, `status`, `sessionStatus`, `error`. For Phase 3 inline expansion, a lighter version is needed that doesn't manage its own connection lifecycle — or the same hook reused with the child's sessionId/instanceId.

## Objectives
### Core Objective
Enable users to navigate, monitor, and inspect child session activity from within the parent session's activity stream.

### Deliverables
- [ ] Phase 1: Clickable task blocks → navigate to child session detail page
- [ ] Phase 1: "Back to parent" breadcrumb on child session pages
- [ ] Phase 1: API endpoint to resolve OpenCode session ID → Fleet DB session (with instanceId)
- [ ] Phase 2: Live child session status badge on task blocks
- [ ] Phase 2: Tool call count from child session on task blocks
- [ ] Phase 3: Inline expandable child activity stream
- [ ] Phase 3: Lazy-load child messages only when expanded

### Definition of Done
- [ ] Clicking a task tool block navigates to `/sessions/[childSessionId]?instanceId=[childInstanceId]`
- [ ] Child session detail page shows "Back to parent" link when `parentSessionId` exists
- [ ] Task blocks show live running/idle/error status of child session
- [ ] Expanding a task block shows the last N child messages inline with live updates
- [ ] All existing activity stream rendering remains unchanged for non-task tools
- [ ] No TypeScript errors: `npx tsc --noEmit` passes
- [ ] Existing tests pass: `npx vitest run`

### Guardrails (Must NOT)
- Must not modify the SSE event pipeline or `event-state.ts` reducers
- Must not break existing tool call rendering for non-task tools
- Must not open unbounded SSE connections (max 1 child SSE per expanded task block)
- Must not modify the database schema — `parent_session_id` and `opencode_session_id` columns already exist
- Must not introduce new npm dependencies

---

## TODOs

### Phase 1: Linking (Navigate Parent <-> Child)

- [ ] 1. **API — Add child session lookup endpoint**
  **What**: Create a new API route that resolves an OpenCode session ID to a Fleet DB session, returning the `instanceId` and `opencode_session_id` needed for navigation. This is the bridge from `getTaskToolSessionId()` (which returns the OpenCode SDK session ID from tool metadata) to the URL params needed for the session detail page.
  **Files**: `src/app/api/sessions/lookup/route.ts` (new)
  **Details**:
  - `GET /api/sessions/lookup?opencodeSessionId=xxx`
  - Use `getSessionByOpencodeId(opencodeSessionId)` from `db-repository.ts`
  - Return shape:
    ```json
    {
      "dbId": "fleet-db-uuid",
      "instanceId": "instance-uuid",
      "opencodeSessionId": "opencode-sdk-session-id",
      "parentSessionId": "fleet-db-parent-uuid | null",
      "status": "active | idle | stopped | completed | disconnected",
      "title": "Session Title"
    }
    ```
  - Return 404 if not found (child session not tracked in Fleet DB — e.g. spawned externally)
  - Return 400 if `opencodeSessionId` query param is missing
  **Acceptance**: `curl localhost:3000/api/sessions/lookup?opencodeSessionId=xxx` returns the resolved session info or 404.

- [ ] 2. **Hook — Add `useResolveChildSession` hook**
  **What**: Client-side hook that takes an OpenCode session ID (from `getTaskToolSessionId()`) and resolves it to the Fleet DB session info (instanceId, opencodeSessionId) needed to build the navigation URL. Caches results to avoid redundant lookups.
  **Files**: `src/hooks/use-resolve-child-session.ts` (new)
  **Details**:
  - `function useResolveChildSession(opencodeSessionId: string | null): { data: ResolvedSession | null; isLoading: boolean; error: string | null }`
  - `interface ResolvedSession { dbId: string; instanceId: string; opencodeSessionId: string; parentSessionId: string | null; status: string; title: string; }`
  - Calls `GET /api/sessions/lookup?opencodeSessionId=xxx` on mount (only if `opencodeSessionId` is not null)
  - Uses `useRef` cache map keyed by `opencodeSessionId` to avoid re-fetching for the same ID
  - Returns null data if `opencodeSessionId` is null (tool hasn't emitted metadata yet)
  **Acceptance**: Hook resolves child session info; returns null gracefully when metadata is missing.

- [ ] 3. **Component — Make `TaskDelegationItem` clickable**
  **What**: Upgrade the `TaskDelegationItem` component to use `useResolveChildSession` and wrap the block in a `next/link` (or `router.push`) when the child session is resolved. Add visual affordance: cursor-pointer, hover state, and an external-link icon.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify `TaskDelegationItem`)
  **Details**:
  - Extract the OpenCode session ID using `getTaskToolSessionId(part)` (already imported in this file)
  - Call `useResolveChildSession(opencodeSessionId)` to get `instanceId` and `opencodeSessionId`
  - When resolved, wrap content in `<Link href={/sessions/${opencodeSessionId}?instanceId=${instanceId}}>` or use `onClick` with `router.push()`
  - **Important**: `TaskDelegationItem` is called inside `ToolCallItem` which is called inside `MessageItem`. React hooks can't be called conditionally, so `TaskDelegationItem` must always be a full component (not conditionally rendered inline). This is already the case — it's a named function component.
  - Add visual affordance:
    - `cursor-pointer` on hover
    - Subtle background change on hover (e.g. `hover:bg-muted/50`)
    - `ExternalLink` or `ArrowRight` icon from lucide-react on the right side
    - If still loading: show nothing extra (don't block rendering)
    - If resolution failed (404): render the block without link affordance (graceful degradation)
  - Edge case: if `getTaskToolSessionId(part)` returns null (tool hasn't emitted metadata yet, e.g. running state), render without link. The component will re-render when the part state updates with metadata.
  **Acceptance**: Clicking a completed/running task block navigates to the child session. Blocks without resolvable children render normally without errors.

- [ ] 4. **Session detail page — Add "Back to parent" breadcrumb**
  **What**: When viewing a child session's detail page, show a "Back to parent session" link/breadcrumb above the header. This requires knowing the parent session's `instanceId` and `opencodeSessionId` for URL construction.
  **Files**: `src/app/sessions/[id]/page.tsx` (modify), `src/app/api/sessions/[id]/route.ts` (modify)
  **Details**:
  - **API change**: In `GET /api/sessions/[id]` response, add `parentSessionId` and `parentInstanceId` fields. When the DB session has a `parent_session_id`, look up the parent session via `getSession(parent_session_id)` to get `opencode_session_id` and `instance_id`.
    ```typescript
    // After existing DB metadata lookup (line 69-80):
    let parentSessionId: string | null = null;
    let parentInstanceId: string | null = null;
    let parentOpencodeSessionId: string | null = null;
    if (dbSession?.parent_session_id) {
      const parentSession = getSession(dbSession.parent_session_id);
      if (parentSession) {
        parentSessionId = parentSession.id;
        parentInstanceId = parentSession.instance_id;
        parentOpencodeSessionId = parentSession.opencode_session_id;
      }
    }
    ```
    Include `parentSessionId`, `parentInstanceId`, `parentOpencodeSessionId` in the response JSON.
  - **Page change**: In the `SessionDetailPage` component, extend the `metadata` state to include `parentSessionId`, `parentInstanceId`, `parentOpencodeSessionId`. After the metadata fetch, if `parentOpencodeSessionId` is set, render a breadcrumb link:
    ```tsx
    {metadata.parentOpencodeSessionId && metadata.parentInstanceId && (
      <Link
        href={`/sessions/${encodeURIComponent(metadata.parentOpencodeSessionId)}?instanceId=${encodeURIComponent(metadata.parentInstanceId)}`}
        className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground border-b border-border/40 transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to parent session
      </Link>
    )}
    ```
    Place this above the `<Tabs>` component but below the resume/stop banners.
  **Acceptance**: Navigating to a child session shows "Back to parent session" link. Clicking it navigates to the parent. Non-child sessions show no breadcrumb.

- [ ] 5. **Tests — Phase 1**
  **What**: Add tests for the lookup API route and the `useResolveChildSession` hook logic.
  **Files**: `src/app/api/sessions/lookup/__tests__/route.test.ts` (new), `src/hooks/__tests__/use-resolve-child-session.test.ts` (new, optional if time permits)
  **Details**:
  - **API route test**: Mock `db-repository.getSessionByOpencodeId` to test:
    - Returns session info when found
    - Returns 404 when not found
    - Returns 400 when `opencodeSessionId` param is missing
  - Follow existing test patterns (see `src/app/api/sessions/__tests__/route.test.ts` for mock setup with `vi.mock`)
  **Acceptance**: `npx vitest run src/app/api/sessions/lookup` passes.

---

### Phase 2: Live Status

- [ ] 6. **API — Add child session status endpoint**
  **What**: Create a lightweight endpoint that returns the current status and tool call count for a child session, designed for periodic polling (every 3-5s) from the parent view.
  **Files**: `src/app/api/sessions/[id]/status/route.ts` (new)
  **Details**:
  - `GET /api/sessions/[id]/status?instanceId=xxx`
  - Calls `client.session.get({ sessionID })` via the existing SDK client
  - Also calls `client.session.messages({ sessionID })` to count tool call parts
  - Return shape:
    ```json
    {
      "sessionStatus": "idle" | "busy",
      "toolCallCount": 12,
      "messageCount": 8,
      "title": "Session Title"
    }
    ```
  - Falls back gracefully if instance is dead (return `{ sessionStatus: "disconnected", toolCallCount: 0, messageCount: 0 }`)
  - This endpoint should be fast — no DB writes, pure read
  **Acceptance**: Polling returns current status and counts.

- [ ] 7. **Hook — Add `useChildSessionStatus` hook**
  **What**: Client-side hook that polls the child session status endpoint at a configurable interval. Used by `TaskDelegationItem` to display live status.
  **Files**: `src/hooks/use-child-session-status.ts` (new)
  **Details**:
  - `function useChildSessionStatus(sessionId: string | null, instanceId: string | null, pollIntervalMs?: number): ChildSessionStatus`
  - `interface ChildSessionStatus { sessionStatus: "idle" | "busy" | "disconnected" | null; toolCallCount: number; messageCount: number; isLoading: boolean; }`
  - Poll interval defaults to 3000ms
  - Only polls when both `sessionId` and `instanceId` are non-null
  - Stops polling when `sessionStatus` is `"idle"` or `"disconnected"` (session done)
  - Cleans up interval on unmount
  **Acceptance**: Hook returns live status that updates every 3s. Stops when session completes.

- [ ] 8. **Component — Add live status to `TaskDelegationItem`**
  **What**: Extend `TaskDelegationItem` to display child session status badge and tool call count. Use data from `useChildSessionStatus`.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify `TaskDelegationItem`)
  **Details**:
  - After resolving the child session (from Phase 1's `useResolveChildSession`), pass `resolvedSession.opencodeSessionId` and `resolvedSession.instanceId` to `useChildSessionStatus`
  - Display:
    - **Status badge** next to the task title: `<Badge variant="outline">running</Badge>` or `idle`/`error`
    - **Tool call count**: small text like `12 tool calls` next to the status (only when > 0)
    - **Message count**: optional, `8 messages`
  - While still running (spinner already shown), add the tool call count next to it
  - When completed, replace spinner with green dot (already done) and show final counts
  - When status is loading or unavailable: don't show counts (graceful)
  - The `useChildSessionStatus` hook only fires when the task part has metadata — it's a no-op when `sessionId` is null
  **Acceptance**: Task blocks show live "running · 12 tool calls" that update in real-time. Completed tasks show final counts.

- [ ] 9. **Tests — Phase 2**
  **What**: Add tests for the status API endpoint.
  **Files**: `src/app/api/sessions/[id]/status/__tests__/route.test.ts` (new)
  **Details**:
  - Mock SDK client to return session status and messages
  - Test happy path (running session with tool calls)
  - Test disconnected instance
  - Test missing instanceId param
  **Acceptance**: `npx vitest run src/app/api/sessions` passes.

---

### Phase 3: Inline Expansion

- [ ] 10. **Component — Create `ChildActivityPreview` component**
  **What**: A collapsible inline component that renders the last N messages from a child session. Shows inside the task block when expanded.
  **Files**: `src/components/session/child-activity-preview.tsx` (new)
  **Details**:
  - Props: `{ sessionId: string; instanceId: string; isExpanded: boolean; maxMessages?: number; }`
  - `maxMessages` defaults to 10
  - When `isExpanded` is true:
    - Lazy-loads messages via `GET /api/sessions/[id]?instanceId=xxx` (same endpoint used by `useSessionEvents.loadMessages`)
    - Subscribes to child SSE via `useSessionEvents(sessionId, instanceId)` for live updates
    - Renders messages using a simplified version of the message rendering from `ActivityStreamV1` — reuse `MessageItem` or create a compact variant
  - When `isExpanded` is false: renders nothing (SSE connection cleaned up via hook unmount)
  - Container: bordered section with slight indentation, max-height with scroll
  - Shows a small "View full session →" link at the bottom (navigates to child session page)
  - Performance: the `useSessionEvents` hook already manages its own EventSource lifecycle and cleans up on unmount. The component simply unmounts when collapsed, which closes the SSE connection.
  **Acceptance**: Expanding shows the child's recent messages with live updates. Collapsing unmounts the component and closes the SSE connection.

- [ ] 11. **Component — Make `TaskDelegationItem` expandable**
  **What**: Add expand/collapse toggle to `TaskDelegationItem`. When expanded, render `ChildActivityPreview` inline below the task info.
  **Files**: `src/components/session/activity-stream-v1.tsx` (modify `TaskDelegationItem`)
  **Details**:
  - Add `isExpanded` state (default: false) to `TaskDelegationItem`
  - Add an expand/collapse button (chevron icon) on the right side of the task header
  - Clicking the chevron toggles expansion (separate from the navigation link)
  - When expanded, render `<ChildActivityPreview>` below the task description
  - The navigation link (Phase 1) and expand button should be separate click targets:
    - Clicking the task title/description → navigates to child session
    - Clicking the chevron → expands/collapses inline preview
  - Use `Collapsible`/`CollapsibleContent` from shadcn/ui (already imported in `session-group.tsx`)
  - Only show chevron when child session is resolved (has instanceId)
  - Animation: use the existing `data-[state=open]` pattern from the Collapsible component
  **Acceptance**: Chevron click expands child activity inline. Title click still navigates. Multiple task blocks can be expanded independently.

- [ ] 12. **Compact message renderer for inline preview**
  **What**: Create a compact rendering mode for messages in the inline preview. The full `MessageItem` component is too tall for an inline preview — need a denser version that shows tool calls as single-line entries and text as truncated snippets.
  **Files**: `src/components/session/child-activity-preview.tsx` (extend)
  **Details**:
  - `CompactMessageItem` component:
    - User messages: single line with truncated text (first 100 chars)
    - Assistant messages: show agent name + truncated text
    - Tool calls: single line `tool_name → result_snippet`
    - No avatars (User/Bot icons) — space is at a premium
    - Smaller text size (`text-[11px]`) than the main activity stream
  - Each message is a thin row, not a padded card
  - Color-code by role: slight background for assistant vs user
  - If the child session is still running, show a "Working..." indicator at the bottom
  **Acceptance**: Inline preview shows a compact, scrollable list of recent child messages that's visually distinct from the parent activity stream.

- [ ] 13. **Tests — Phase 3**
  **What**: Verify that the expand/collapse mechanism works and that child activity loading is triggered correctly.
  **Files**: `src/components/session/__tests__/child-activity-preview.test.tsx` (new, optional — may be complex to test with SSE mocking)
  **Details**:
  - Focus on unit-testable logic:
    - `ChildActivityPreview` renders nothing when `isExpanded` is false
    - `ChildActivityPreview` renders message content when expanded with pre-loaded messages
  - Integration testing of SSE is better done manually
  **Acceptance**: Core rendering logic is covered.

---

## Implementation Order

```
Phase 1 (tasks 1-5):  API lookup → hook → clickable component → breadcrumb → tests
Phase 2 (tasks 6-9):  Status API → status hook → status in component → tests
Phase 3 (tasks 10-13): Preview component → expandable toggle → compact renderer → tests
```

Phases are strictly ordered — each builds on the previous. Within each phase, tasks should be done in order (API → hook → component → tests).

## Edge Cases

| Scenario | Handling |
|----------|----------|
| `getTaskToolSessionId()` returns null (running, no metadata yet) | Render non-interactive block. Component re-renders when metadata arrives via SSE part update. |
| Child session not in Fleet DB (spawned externally or DB was reset) | Lookup API returns 404. Hook returns null. Block renders without link affordance. |
| Child session on a dead instance | Lookup returns the session with `status: "disconnected"`. Navigation still works (session detail page handles dead instances with resume banner). |
| Multiple task blocks in the same message | Each `TaskDelegationItem` instance independently resolves its child. React key is `part.partId` (unique). |
| Phase 2 polling overload with many child sessions | `useChildSessionStatus` stops polling when session reaches idle/disconnected. Maximum concurrent polls = number of visible running task blocks. |
| Phase 3 SSE connection limit | Browser limit is ~6 per domain. Only expanded child previews open SSE connections. Users are unlikely to expand more than 2-3 simultaneously. Add a warning if > 3 are expanded? |
| Parent navigates away while child preview is expanded | React unmounts `ChildActivityPreview`, which unmounts `useSessionEvents`, which closes the EventSource. Clean. |

## Verification
- [ ] All existing tests pass: `npx vitest run`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] Dev server runs without errors: `npm run dev`
- [ ] Phase 1: Click task block → navigates to child session page
- [ ] Phase 1: Child session page shows "Back to parent" link → navigates back
- [ ] Phase 2: Task blocks show live "running · 5 tool calls" badge
- [ ] Phase 3: Chevron click expands inline preview with child messages
- [ ] Phase 3: Collapsing closes SSE connection (verify in browser DevTools Network tab)
- [ ] No regressions in non-task tool call rendering
