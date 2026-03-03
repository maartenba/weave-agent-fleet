# Smart Activity Stream UX — Scroll Lock, Collapsible Tools, Timestamps, Search

Closes #14

## TL;DR
> **Summary**: Overhaul the activity stream (`activity-stream-v1.tsx`) with four independently shippable features: smart scroll behavior with stick-to-bottom, collapsible/expandable tool call output, enhanced inline timestamps with relative display, and in-session search with filtering. Each phase builds incrementally on the existing 402-line component.
> **Estimated Effort**: Large

## Context
### Original Request
GitHub Issue #14 — Long agent sessions produce walls of content. The stream auto-scrolls on every message with no pause, truncates tool outputs to 60 chars with no expansion, and has no search. These compound to make long sessions nearly unusable.

### Key Findings
1. **Auto-scroll** (lines 250–273): A `useEffect` fires on every `messages` change, debounced by 150ms. It always scrolls to the `bottomRef` div — no scroll-lock logic exists. The `ScrollArea` wraps a Radix `ScrollAreaPrimitive.Viewport` which is the actual scrollable element (`[data-slot="scroll-area-viewport"]`).

2. **Tool output truncation** (lines 107–123): `ToolCallItem` slices `state?.output` to 60 chars inline. There's no expand mechanism. Special handling exists for `task` tool (→ `TaskDelegationItem`) and `todowrite` tool (→ `TodoListInline`). The `state` object contains full `input` and `output` data.

3. **Timestamps already partially shipped**: Issue #27 was implemented — `formatTimestamp()` exists in `format-utils.ts`, and `MessageItem` (line 200–204) renders absolute timestamps for `createdAt`. What's missing from issue #14 is: **relative timestamps** ("2m ago"), **absolute on hover** (tooltip), and **duration between adjacent messages**.

4. **No search/filter**: The stream renders all `messages` with a simple `.map()`. No filtering, no text search, no highlighting.

5. **Existing UI primitives available**:
   - `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` — Radix-based, already in `src/components/ui/collapsible.tsx`
   - `Tooltip` / `TooltipTrigger` / `TooltipContent` — Radix-based, in `src/components/ui/tooltip.tsx`
   - `Button` with `ghost` variant and `icon-xs` / `icon-sm` sizes
   - `Badge` with `outline` variant
   - `Input` component
   - `Switch` component (for toggles)
   - `useKeyboardShortcut` hook with `platformModifier` support
   - `usePersistedState` hook for localStorage-backed state

6. **Dependencies**: `highlight.js` and `rehype-highlight` already present (used by `MarkdownRenderer`). No virtualization library installed — `react-window` would need to be added if pursuing virtualization (deferred to a separate issue).

7. **`ScrollArea` internals**: The scrollable viewport is `ScrollAreaPrimitive.Viewport` which renders as a div with `data-slot="scroll-area-viewport"`. To detect scroll position, we need a ref to this element (not exposed by the current `ScrollArea` wrapper). We'll need to either get a ref to the viewport via DOM query or extend `ScrollArea` to forward a ref.

8. **Component consumption**: `ActivityStreamV1` is used in `src/app/sessions/[id]/page.tsx` (line 398). Props: `messages`, `status`, `sessionStatus`, `error`, `agents`, `onReconnect`, `reconnectAttempt`.

9. **Status bar dead code** (lines 375–377): Empty style objects `sessionStatus === "busy" || status !== "connected" ? {} : {}` — should be cleaned up.

## Objectives
### Core Objective
Make the activity stream usable for long-running, multi-agent sessions by adding scroll control, expandable tool output, enhanced timestamps, and search/filter.

### Deliverables
- [ ] Smart scroll behavior with stick-to-bottom, jump-to-bottom FAB, new-message indicator
- [ ] Collapsible tool calls with full output, copy button, and syntax highlighting
- [ ] Enhanced timestamps: relative display, absolute tooltip, inter-message duration
- [ ] In-session search (Ctrl+F) with message type and agent filters
- [ ] Dead code cleanup in the status bar

### Definition of Done
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (existing + new tests)
- [ ] All four features work independently and together
- [ ] No regressions in existing activity stream behavior

### Guardrails (Must NOT)
- Do NOT add `react-window` or virtualization in this issue (separate concern, separate issue)
- Do NOT modify `use-session-events.ts` — the data layer is not changing
- Do NOT change the legacy `activity-stream.tsx` — it's a separate dead component
- Do NOT modify `AccumulatedMessage` or `AccumulatedPart` interfaces
- Do NOT add third-party date libraries — use native `Intl` / `Date`
- Do NOT break the existing component API (props interface of `ActivityStreamV1`)

## TODOs

### Phase 1: Smart Scroll Behavior
> Foundation phase — affects how all subsequent features interact with the stream.

- [ ] 1. **Create `useScrollAnchor` hook**
  **What**: Extract and upgrade the scroll logic into a dedicated hook. The hook should:
  - Accept a `scrollAreaRef` (ref to the scroll container viewport element)
  - Track whether the user is "at the bottom" (within a 50px threshold)
  - Expose `isAtBottom: boolean` state
  - Expose `scrollToBottom(): void` function (smooth scroll)
  - Expose `newMessageCount: number` — count of messages arriving while scrolled up
  - Auto-scroll to bottom when new messages arrive **only if** `isAtBottom` is true
  - Reset `newMessageCount` to 0 when user scrolls back to bottom
  - Use `scroll` event listener on the viewport element for detection
  - Debounce scroll events (requestAnimationFrame) to avoid jank
  **Files**: `src/hooks/use-scroll-anchor.ts` (new)
  **Acceptance**: Hook exported, properly cleans up listeners, handles edge cases (empty container, rapid messages).

- [ ] 2. **Wire `useScrollAnchor` into `ActivityStreamV1`**
  **What**: Replace the existing auto-scroll `useEffect` (lines 250–273) with the new hook. Steps:
  - Get a ref to the Radix `ScrollArea` viewport element. The viewport has `data-slot="scroll-area-viewport"`. Use a `useCallback` ref on the `ScrollArea` wrapper that queries for `[data-slot="scroll-area-viewport"]` to find the scrollable element.
  - Pass the viewport ref to `useScrollAnchor`
  - Remove `bottomRef`, `scrollTimerRef`, `prevMessageCountRef`, and the auto-scroll `useEffect`
  - Keep the sentinel `<div>` at the bottom for `scrollToBottom` target (optional — `scrollTop = scrollHeight` is simpler)
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Auto-scroll works as before when at bottom. Scrolling up pauses auto-scroll. Scrolling back to bottom resumes it.

- [ ] 3. **Add "Jump to bottom" floating button**
  **What**: When `!isAtBottom`, render a floating button at the bottom-right of the scroll area. The button should:
  - Show a `ChevronDown` icon (from `lucide-react`)
  - Display the `newMessageCount` badge when > 0 (e.g., "3 new")
  - On click: call `scrollToBottom()` from the hook
  - Animate in/out with opacity transition (Tailwind `transition-opacity`)
  - Position: `absolute bottom-4 right-4` within a `relative` container wrapping `ScrollArea`
  - Use `Button` component with `variant="outline"` and `size="icon-sm"`
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Button appears when scrolled up, disappears when at bottom. Badge shows new message count. Clicking scrolls to bottom smoothly.

- [ ] 4. **Add unit tests for `useScrollAnchor`**
  **What**: Test the hook logic:
  - `isAtBottom` is true initially
  - `scrollToBottom` calls `scrollTo` on the container
  - `newMessageCount` increments when messages arrive while scrolled up
  - `newMessageCount` resets to 0 when scrolled to bottom
  **Files**: `src/hooks/__tests__/use-scroll-anchor.test.ts` (new)
  **Acceptance**: `npm run test -- src/hooks/__tests__/use-scroll-anchor.test.ts` passes.

### Phase 2: Collapsible Tool Calls
> Independently shippable — no dependency on Phase 1 scroll changes.

- [ ] 5. **Create `CollapsibleToolCall` component**
  **What**: Replace the inline tool output rendering in `ToolCallItem` with an expandable component. Design:
  - **Collapsed state (default)**: Show current one-line format — tool icon, tool name, spinner/status, truncated output (60 chars). Add a `ChevronRight` icon that rotates to `ChevronDown` when expanded.
  - **Expanded state**: Show full tool output in a bordered panel below the one-liner. Contents:
    - **Input section**: If `state.input` exists, render as formatted JSON with syntax highlighting
    - **Output section**: Full `state.output` text (or `state.error` for errors)
    - **Copy button**: Copies the full output (or input+output) to clipboard
    - ~~**Duration**~~: Removed — `state.duration` does not exist on `AccumulatedToolPart` at runtime. Duration display is handled separately via inter-message duration separators in Phase 3 (Task 11).
  - Use the existing `Collapsible` / `CollapsibleTrigger` / `CollapsibleContent` primitives from `src/components/ui/collapsible.tsx`
  - For syntax highlighting of JSON: use a simple approach — detect if output is valid JSON, if so render with `<pre>` + Tailwind styling (highlight.js is already in the bundle but wiring it for arbitrary inline text is overkill — a JSON pretty-print with monospace is sufficient)
  - Skip expansion for `task` tool calls (they have their own `TaskDelegationItem`) and `todowrite` (has `TodoListInline`)
  **Files**: `src/components/session/collapsible-tool-call.tsx` (new)
  **Acceptance**: Tool calls expand/collapse on click. Full output visible when expanded. Copy button works.

- [ ] 6. **Integrate `CollapsibleToolCall` into `ToolCallItem`**
  **What**: Update `ToolCallItem` in `activity-stream-v1.tsx` to use the new `CollapsibleToolCall` component for non-special tool calls (i.e., not `task` or `todowrite`). The existing guard clauses for `isTaskToolCall` and `isTodoWriteTool` remain — `CollapsibleToolCall` is the new default path.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Tool calls in the stream are now collapsible. Special tool calls (task, todowrite) render as before.

- [ ] 7. **Clean up status bar dead code**
  **What**: Remove the empty ternary `sessionStatus === "busy" || status !== "connected" ? {} : {}` on lines 375–377. This is a no-op spread.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Status bar renders identically but without dead code. Build passes.

### Phase 3: Enhanced Timestamps
> Builds on the existing `formatTimestamp` implementation from issue #27.

- [ ] 8. **Add `formatRelativeTime` utility**
  **What**: Add a function to `format-utils.ts` that returns relative time strings:
  - < 30s: `"just now"`
  - < 60s: `"Xs ago"` (e.g., "45s ago")
  - < 60m: `"Xm ago"` (e.g., "5m ago")
  - < 24h: `"Xh ago"` (e.g., "2h ago")
  - ≥ 24h: fall back to `formatTimestamp()` (absolute)
  Takes a `timestamp: number` (unix ms) and `now?: number` (for testability).
  **Files**: `src/lib/format-utils.ts`
  **Acceptance**: Function exported, pure, handles edge cases.

- [ ] 9. **Add unit tests for `formatRelativeTime`**
  **What**: Test all time buckets:
  - "just now" for timestamps < 30s ago
  - "45s ago" for 45 seconds ago
  - "5m ago" for 5 minutes ago
  - "2h ago" for 2 hours ago
  - Falls back to absolute for > 24h
  - Handles undefined/null/0 gracefully
  **Files**: `src/lib/__tests__/format-utils.test.ts`
  **Acceptance**: All tests pass.

- [ ] 10. **Switch message timestamps to relative with absolute tooltip**
  **What**: Update `MessageItem` in `activity-stream-v1.tsx`:
  - Replace the current `formatTimestamp(message.createdAt)` call with `formatRelativeTime(message.createdAt)`
  - Wrap the timestamp `<span>` in a `Tooltip` / `TooltipTrigger` / `TooltipContent` that shows the absolute timestamp (`formatTimestamp(message.createdAt)`) on hover
  - The relative timestamps should auto-update — add a simple `useEffect` + `setInterval` (every 30s) that forces a re-render of the timestamp. Implement this as a small `RelativeTimestamp` component to isolate the timer.
  - Ensure `TooltipProvider` is present in the component tree (check if it's already in the layout — if not, add it to `ActivityStreamV1`)
  **Files**: 
  - `src/components/session/activity-stream-v1.tsx`
  - `src/components/session/relative-timestamp.tsx` (new — small component with auto-update)
  **Acceptance**: Timestamps show relative time. Hovering shows absolute. Timestamps update live.

- [ ] 11. **Add inter-message duration indicators**
  **What**: For gaps > 30 seconds between consecutive messages, show a subtle duration separator in the stream. Render a thin horizontal divider between `MessageItem` entries with text like "— 2m 15s —". This uses the existing `formatDuration` (from lines 32–37 in `activity-stream-v1.tsx`, which takes ms). Implementation:
  - In the `messages.map()` loop, compare `messages[i].createdAt` with `messages[i-1].completedAt ?? messages[i-1].createdAt`
  - If gap > 30s, render a `DurationSeparator` component before the message
  - Style: centered text, `text-[10px] text-muted-foreground`, with border lines on either side (flexbox with `border-t` dividers)
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Duration gaps shown between messages where gap > 30s. No separators for rapid-fire messages.

### Phase 4: Search & Filter
> Most complex phase. Independently shippable.

- [ ] 12. **Create `useActivityFilter` hook**
  **What**: A hook that manages filter/search state for the activity stream:
  - `searchQuery: string` — text to search for
  - `setSearchQuery(q: string): void`
  - `messageTypeFilter: Set<"user" | "assistant" | "tool">` — which types to show (default: all)
  - `toggleMessageType(type): void`
  - `agentFilter: string | null` — filter to a specific agent (null = show all)
  - `setAgentFilter(agent: string | null): void`
  - `filteredMessages: AccumulatedMessage[]` — the filtered list (memoized)
  - `matchingPartIds: Set<string>` — part IDs that contain search matches (for highlighting)
  - `isFiltering: boolean` — true if any filter is active
  - `clearFilters(): void`
  The hook accepts `messages: AccumulatedMessage[]` and returns the filtered view.
  Search should match against: text part content, tool names, tool output content.
  **Files**: `src/hooks/use-activity-filter.ts` (new)
  **Acceptance**: Hook filters messages correctly for all filter combinations. Memoized to avoid re-computation on every render.

- [ ] 13. **Add unit tests for `useActivityFilter`**
  **What**: Test filtering logic:
  - Search query filters to messages containing the text
  - Type filter excludes non-matching message types
  - Agent filter shows only messages from that agent
  - Combined filters work (search + type + agent)
  - `clearFilters` resets everything
  - `matchingPartIds` contains correct part IDs for search matches
  - Empty query returns all messages
  **Files**: `src/hooks/__tests__/use-activity-filter.test.ts` (new)
  **Acceptance**: All tests pass.

- [ ] 14. **Create `ActivityStreamToolbar` component**
  **What**: A toolbar rendered above the scroll area (below the connection banner, above the message list). Contains:
  - **Search input**: `Input` component with `Search` icon, bound to `searchQuery`. Placeholder: "Search messages…"
  - **Type filter buttons**: Three small `Button` (ghost, icon-xs) for User / Assistant / Tool — toggling filters. Use opacity or outline to show active state.
  - **Agent filter dropdown**: A `DropdownMenu` populated from the `agents` prop, allowing selection of a single agent to filter by. Show "All agents" as the default.
  - **Clear button**: Shown when `isFiltering` is true. Resets all filters.
  - **Result count**: "X of Y messages" when filtering
   - The toolbar should be hideable — **open** with `Ctrl+F` / `Cmd+F` (use `useKeyboardShortcut` with `platformModifier`). **Close** with `Escape` key (attach a `keydown` listener on the search input itself, since `useKeyboardShortcut` skips events when an `HTMLInputElement` is focused — `Ctrl+F` will not fire while the search input has focus). When hidden, no filters apply.
  - Compact design: single row, 32px height, matches the status bar aesthetic
  **Files**: `src/components/session/activity-stream-toolbar.tsx` (new)
  **Acceptance**: Toolbar toggles with Ctrl+F. Search input is focused on open. Filters update the stream in real-time.

- [ ] 15. **Integrate search/filter into `ActivityStreamV1`**
  **What**: Wire everything together:
  - Add `useActivityFilter(messages)` hook call
  - Pass `filteredMessages` (instead of `messages`) to the `.map()` render loop
  - Render `ActivityStreamToolbar` between the connection banner and the `ScrollArea`
  - Pass `matchingPartIds` to `MessageItem` for highlighting search matches
  - Update `MessageItem` to accept optional `highlightQuery?: string` prop — wrap matching text in `<mark>` elements with `bg-yellow-500/30 text-foreground` styling
  - Update the status bar message count to show `filteredMessages.length` of `messages.length` when filtering
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Ctrl+F opens search bar. Typing filters messages. Type and agent filters work. Matches highlighted. Status bar shows filter count.

- [ ] 16. **Add text highlighting utility**
  **What**: A pure function `highlightText(text: string, query: string): (string | ReactNode)[]` that splits text around query matches and wraps matches in `<mark>` elements. Case-insensitive. Returns the original string (in an array) if query is empty.
  **Files**: `src/lib/highlight-utils.ts` (new)
  **Acceptance**: Function correctly highlights all occurrences, handles empty query, handles regex-special characters in query.

- [ ] 17. **Add unit tests for `highlightText`**
  **What**: Test cases:
  - Empty query returns original text
  - Single match highlighted
  - Multiple matches highlighted
  - Case-insensitive matching
  - Regex-special characters in query are escaped
  - Empty text returns empty array
  **Files**: `src/lib/__tests__/highlight-utils.test.ts` (new)
  **Acceptance**: All tests pass.

## Files Summary

### New Files
| File | Phase | Description |
|------|-------|-------------|
| `src/hooks/use-scroll-anchor.ts` | 1 | Smart scroll behavior hook |
| `src/hooks/__tests__/use-scroll-anchor.test.ts` | 1 | Tests for scroll hook |
| `src/components/session/collapsible-tool-call.tsx` | 2 | Expandable tool call component |
| `src/components/session/relative-timestamp.tsx` | 3 | Self-updating relative timestamp |
| `src/hooks/use-activity-filter.ts` | 4 | Search and filter hook |
| `src/hooks/__tests__/use-activity-filter.test.ts` | 4 | Tests for filter hook |
| `src/components/session/activity-stream-toolbar.tsx` | 4 | Search/filter toolbar |
| `src/lib/highlight-utils.ts` | 4 | Text highlighting utility |
| `src/lib/__tests__/highlight-utils.test.ts` | 4 | Tests for highlighting |

### Modified Files
| File | Phases | Changes |
|------|--------|---------|
| `src/components/session/activity-stream-v1.tsx` | 1, 2, 3, 4 | Core component — scroll, tool calls, timestamps, search |
| `src/lib/format-utils.ts` | 3 | Add `formatRelativeTime` |
| `src/lib/__tests__/format-utils.test.ts` | 3 | Tests for `formatRelativeTime` |

### No New Dependencies Required
- `highlight.js` already in `package.json` (for `MarkdownRenderer`)
- `radix-ui` already provides `Collapsible`, `Tooltip` primitives
- `lucide-react` already provides all needed icons (`ChevronDown`, `ChevronRight`, `Search`, `Copy`, `Check`, `X`, `Filter`)
- No virtualization library needed for this issue

## Implementation Order

```
Phase 1 (Scroll)  ──→  Phase 3 (Timestamps)
                         ↑
Phase 2 (Tools)   ──→  Phase 4 (Search)
```

Phases 1 and 2 can be done in parallel — they touch different parts of the component. Phase 3 can follow either. Phase 4 is last because its filter logic needs to account for the collapsible tool calls and timestamp rendering from prior phases.

Each phase is independently shippable and can be merged separately.

## Verification
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm run lint` passes
- [ ] `npm run test` — all existing tests pass
- [ ] New hook tests pass (`use-scroll-anchor`, `use-activity-filter`)
- [ ] New utility tests pass (`formatRelativeTime`, `highlightText`)
- [ ] Manual verification: scroll lock works in a running session
- [ ] Manual verification: tool calls expand/collapse, copy works
- [ ] Manual verification: timestamps show relative with hover tooltip
- [ ] Manual verification: Ctrl+F opens search, filters work
- [ ] No performance regressions with 100+ messages in a session
