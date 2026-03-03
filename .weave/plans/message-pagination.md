# Paginated Message Loading with Infinite Scroll

## TL;DR
> **Summary**: Add server-side message pagination and client-side infinite scroll to the activity stream, so only the last N messages load initially and older messages are fetched on scroll-up — while preserving SSE real-time delivery, scroll anchoring, and search/filter functionality.
> **Estimated Effort**: Large

## Context
### Original Request
Long-running agent sessions accumulate hundreds or thousands of messages. The current architecture fetches ALL messages from the SDK via `client.session.messages()` and sends them all to the browser in a single API response. This causes slow initial loads and high memory usage. We need "load last N, fetch more on scroll-up" behavior.

### Key Findings

**SDK Constraint**: `client.session.messages({ sessionID })` only supports a `limit` parameter — no offset, cursor, or pagination metadata. The backend must fetch all messages and slice server-side.

**Current Data Flow**:
1. `useSessionEvents` hook calls `loadMessages()` which fetches `GET /api/sessions/[id]?instanceId=xxx`
2. The API route (`src/app/api/sessions/[id]/route.ts`) calls `client.session.messages()` and returns ALL messages in a single response alongside session metadata
3. Messages are converted to `AccumulatedMessage[]` and stored in React state
4. SSE events (`handleEvent`) mutate the same state array for real-time updates
5. `ActivityStreamV1` receives messages, passes them through `useActivityFilter`, renders via `filteredMessages.map()`
6. `useScrollAnchor` handles stick-to-bottom and the jump-to-bottom FAB

**Scroll Position Architecture**: `useScrollAnchor` discovers the Radix `ScrollArea` viewport via `querySelector('[data-slot="scroll-area-viewport"]')` and attaches scroll listeners. It tracks `isAtBottom` (within 50px threshold) and auto-scrolls on new messages only when already at bottom. The viewport element ref is stored in `viewportRef.current`.

**Filter Integration**: `useActivityFilter` operates on the full `messages` array — it computes `filteredMessages` and `matchingPartIds` via `useMemo`. Search/filter must work across ALL loaded messages (not just the current page).

**Test Pattern**: Vitest with `environment: "node"` (no jsdom). Tests for hooks extract and test pure helper functions rather than rendering hooks. Pattern: export pure logic functions, test those, plus verify module shape.

## Objectives
### Core Objective
Paginate message loading so the initial fetch returns only the last N messages (default: 50), with scroll-up triggering fetch of older batches, while preserving all existing functionality.

### Deliverables
- [ ] New API endpoint `GET /api/sessions/[id]/messages` with pagination support (`limit`, `before` cursor)
- [ ] Server-side message slicing with pagination metadata in response
- [ ] `useMessagePagination` hook for paginated loading + scroll-triggered fetching
- [ ] Updated `useSessionEvents` to integrate with pagination (initial load uses paginated endpoint)
- [ ] Scroll position preservation when prepending older messages
- [ ] Loading indicator at top of activity stream during fetch
- [ ] Updated `useScrollAnchor` to support scroll-near-top detection
- [ ] Tests for pagination utilities and hook logic

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes (existing + new)
- [ ] Initial page load fetches only last 50 messages (verifiable via Network tab)
- [ ] Scrolling up near the top loads the next older batch
- [ ] New messages via SSE still appear at the bottom
- [ ] Search/filter works across all loaded messages
- [ ] No scroll position jumping when loading older messages
- [ ] Backward compatible: `GET /api/sessions/[id]` still returns all messages when no pagination params

### Guardrails (Must NOT)
- Do NOT modify the SSE event system (`/events` route or SSE subscription logic)
- Do NOT change the `AccumulatedMessage` or `AccumulatedPart` interfaces
- Do NOT add virtual scrolling (separate concern for a future plan)
- Do NOT break existing search/filter functionality
- Do NOT break the jump-to-bottom FAB or scroll anchoring behavior
- Do NOT break the existing `GET /api/sessions/[id]` response shape (backward compat)

## TODOs

- [ ] 1. **Create paginated messages API endpoint**
  **What**: Add a new `GET /api/sessions/[id]/messages` route that fetches all messages from the SDK, slices them server-side, and returns a paginated response. Support query params: `instanceId` (required), `limit` (default 50), `before` (message ID cursor — return messages older than this ID). Return pagination metadata alongside the messages.
  **Files**:
    - Create `src/app/api/sessions/[id]/messages/route.ts`
  **Details**:
    - Fetch all messages via `client.session.messages({ sessionID })` (SDK constraint — no server-side filtering)
    - Sort messages by `time.created` ascending (verify SDK returns this order; if not, sort explicitly)
    - If `before` param is provided, find the index of the message with that ID and return the `limit` messages preceding it
    - If no `before` param, return the last `limit` messages (tail of the array)
    - Response shape:
      ```typescript
      {
        messages: SDKMessage[],        // the raw SDK message objects (same shape as current)
        pagination: {
          hasMore: boolean,            // true if there are older messages not yet returned
          oldestMessageId: string | null,  // ID of oldest message in this batch (for next cursor)
          totalCount: number,          // total messages in session (for UI "X of Y messages")
        }
      }
      ```
    - Keep the existing `GET /api/sessions/[id]` route unchanged for backward compatibility — it still returns all messages (used by `loadMessages()` on reconnect recovery and metadata fetch)
  **Acceptance**: `GET /api/sessions/[id]/messages?instanceId=xxx&limit=5` returns only 5 messages with correct `pagination.hasMore` and `pagination.totalCount`. Passing `before=<messageId>` returns the 5 messages before that ID.

- [ ] 2. **Create pagination utility functions**
  **What**: Extract pure pagination logic into a utility module for testability. These functions handle message slicing, cursor resolution, and merging paginated batches with existing state.
  **Files**:
    - Create `src/lib/pagination-utils.ts`
  **Details**:
    - `sliceMessages(allMessages, { limit, before? })` — given a full message array, return the paginated slice + metadata. This is the core logic used by the API route.
    - `prependMessages(existing: AccumulatedMessage[], older: AccumulatedMessage[]): AccumulatedMessage[]` — merge older messages before existing ones, deduplicating by `messageId`. Must handle the case where SSE has already added a message that's also in the older batch.
    - `convertSDKMessageToAccumulated(msg)` — extract the SDK→AccumulatedMessage conversion from `useSessionEvents.loadMessages()` into a reusable function. This same logic exists on lines 79–116 of `use-session-events.ts` and will be needed in the pagination hook.
  **Acceptance**: Unit tests pass for all three functions.

- [ ] 3. **Write tests for pagination utilities**
  **What**: Comprehensive unit tests for `pagination-utils.ts`.
  **Files**:
    - Create `src/lib/__tests__/pagination-utils.test.ts`
  **Details**:
    - `sliceMessages`:
      - Returns last N messages when no cursor
      - Returns correct slice when `before` cursor is provided
      - Returns `hasMore: false` when returning from the beginning
      - Returns `hasMore: true` when there are older messages
      - Handles edge cases: empty array, cursor not found, limit > total count
      - Returns correct `totalCount` and `oldestMessageId`
    - `prependMessages`:
      - Prepends older messages before existing
      - Deduplicates by messageId (SSE may have already added the message)
      - Returns existing array unchanged if older is empty
      - Preserves order (older first, then existing)
    - `convertSDKMessageToAccumulated`:
      - Converts text parts correctly
      - Converts tool parts correctly
      - Accumulates step-finish cost/tokens
      - Handles missing optional fields
  **Acceptance**: `npm run test -- src/lib/__tests__/pagination-utils.test.ts` passes.

- [ ] 4. **Create `useMessagePagination` hook**
  **What**: A React hook that manages paginated message fetching, tracks pagination state (hasMore, loading, oldest cursor), and exposes a `loadOlderMessages()` function.
  **Files**:
    - Create `src/hooks/use-message-pagination.ts`
  **Details**:
    - State: `{ hasMore: boolean; isLoadingOlder: boolean; oldestMessageId: string | null; totalCount: number | null }`
    - `loadInitialMessages(sessionId, instanceId)` — fetches `GET /api/sessions/[id]/messages?instanceId=xxx&limit=50`, converts to `AccumulatedMessage[]`, returns them. Updates pagination state from response metadata.
    - `loadOlderMessages(sessionId, instanceId)` — fetches `GET /api/sessions/[id]/messages?instanceId=xxx&limit=50&before=<oldestMessageId>`. Returns the older `AccumulatedMessage[]` batch. Updates pagination state. Includes guard: no-op if `!hasMore` or `isLoadingOlder`.
    - Does NOT manage the main messages array itself — it returns the fetched batches for the caller (`useSessionEvents`) to merge. This keeps SSE event handling in one place.
    - Exports a `PaginationState` type for consumers.
  **Acceptance**: Hook exports correct types. Loading functions return converted messages and update pagination metadata.

- [ ] 5. **Integrate pagination into `useSessionEvents`**
  **What**: Modify `useSessionEvents` to use paginated initial load instead of fetching all messages, and expose pagination state + `loadOlderMessages` to consumers.
  **Files**:
    - Modify `src/hooks/use-session-events.ts`
  **Details**:
    - Import and use `useMessagePagination` hook
    - Change `loadMessages()` to call `pagination.loadInitialMessages()` instead of fetching `GET /api/sessions/[id]` for the initial load. On reconnect recovery, still use the full `GET /api/sessions/[id]` endpoint (which returns all messages) to ensure gap-free state — this is the safe recovery path.
    - Add `loadOlderMessages` callback that:
      1. Calls `pagination.loadOlderMessages()`
      2. Prepends returned messages to state using `prependMessages()`
    - Expose new fields in `UseSessionEventsResult`:
      ```typescript
      hasMoreMessages: boolean;
      isLoadingOlder: boolean;
      loadOlderMessages: () => Promise<void>;
      totalMessageCount: number | null;
      ```
    - The `handleEvent` function and SSE wiring remain completely unchanged
    - On reconnect recovery (`hasConnectedOnce === true`), continue using the full session endpoint to get complete state (no pagination) — this ensures no gaps after a disconnect
  **Acceptance**: Initial load only fetches 50 messages. `loadOlderMessages()` prepends older batch. SSE events still append new messages. Recovery still loads full state.

- [ ] 6. **Add scroll-near-top detection to `useScrollAnchor`**
  **What**: Extend `useScrollAnchor` to detect when the user scrolls near the top of the viewport, which triggers loading older messages.
  **Files**:
    - Modify `src/hooks/use-scroll-anchor.ts`
  **Details**:
    - Add a new output: `isNearTop: boolean` — true when `scrollTop <= NEAR_TOP_THRESHOLD` (e.g., 200px)
    - Add `NEAR_TOP_THRESHOLD = 200` constant
    - Update the `handleScroll` callback to also compute `isNearTop` and expose it via state
    - Add `preserveScrollPosition(callback: () => void | Promise<void>)` utility method:
      1. Capture `scrollHeight` before the callback
      2. Execute the callback (which prepends messages, causing DOM height change)
      3. In a `requestAnimationFrame`, compute `newScrollHeight - oldScrollHeight` and add it to `scrollTop`
      This prevents the viewport from jumping when content is prepended above the current view.
    - Do NOT change existing `isAtBottom`, `newMessageCount`, or `scrollToBottom` behavior
  **Acceptance**: `isNearTop` is `true` when scrolled within 200px of top. `preserveScrollPosition` prevents scroll jump on prepend.

- [ ] 7. **Update tests for `useScrollAnchor`**
  **What**: Add tests for the new `isNearTop` detection and `preserveScrollPosition` logic.
  **Files**:
    - Modify `src/hooks/__tests__/use-scroll-anchor.test.ts`
  **Details**:
    - Test `isNearTop` threshold calculation (within 200px = near top, beyond = not)
    - Test boundary conditions (exactly at 200px, at 201px, at 0px)
    - Test that `preserveScrollPosition` adjusts scrollTop by the delta in scrollHeight
    - Follow existing test pattern: test pure logic calculations, not React hook rendering
  **Acceptance**: `npm run test -- src/hooks/__tests__/use-scroll-anchor.test.ts` passes.

- [ ] 8. **Wire infinite scroll in `ActivityStreamV1`**
  **What**: Connect scroll-near-top detection to `loadOlderMessages()` and show a loading indicator at the top while fetching.
  **Files**:
    - Modify `src/components/session/activity-stream-v1.tsx`
  **Details**:
    - Add new props to `ActivityStreamV1Props`:
      ```typescript
      hasMoreMessages?: boolean;
      isLoadingOlder?: boolean;
      onLoadOlder?: () => void;
      totalMessageCount?: number | null;
      ```
    - Consume `isNearTop` and `preserveScrollPosition` from `useScrollAnchor` (extended in TODO 6)
    - Add a `useEffect` that triggers `onLoadOlder?.()` when `isNearTop && hasMoreMessages && !isLoadingOlder`. Use `preserveScrollPosition` to wrap the state update. Add a debounce/guard: don't re-trigger while a fetch is in progress (the `isLoadingOlder` guard handles this).
    - Render a loading indicator at the TOP of the message list (before the first message):
      ```tsx
      {isLoadingOlder && (
        <div className="flex items-center justify-center py-3 text-xs text-muted-foreground gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading older messages...</span>
        </div>
      )}
      {hasMoreMessages && !isLoadingOlder && (
        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
          <span>Scroll up for older messages</span>
        </div>
      )}
      ```
    - Update the status bar message count to show `totalMessageCount` when available (e.g., "50 of 200 messages loaded")
  **Acceptance**: Scrolling near the top triggers a fetch. Loading spinner appears at top during fetch. Scroll position doesn't jump when older messages appear. Status bar shows loaded/total count.

- [ ] 9. **Pass pagination props through from session page**
  **What**: Wire the new pagination props from `useSessionEvents` through the session page to `ActivityStreamV1`.
  **Files**:
    - Modify `src/app/sessions/[id]/page.tsx`
  **Details**:
    - Destructure new fields from `useSessionEvents`: `hasMoreMessages`, `isLoadingOlder`, `loadOlderMessages`, `totalMessageCount`
    - Pass them as props to `<ActivityStreamV1>`:
      ```tsx
      <ActivityStreamV1
        messages={messages}
        status={status}
        sessionStatus={sessionStatus}
        error={error}
        agents={agents}
        onReconnect={reconnect}
        reconnectAttempt={reconnectAttempt}
        hasMoreMessages={hasMoreMessages}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={loadOlderMessages}
        totalMessageCount={totalMessageCount}
      />
      ```
    - The sidebar's aggregate stats (totalCost, totalTokens, participatingAgents) currently compute across all loaded messages. Note: these will only reflect loaded messages, not all session messages. This is acceptable for now — the full stats are available when the user scrolls to load all messages. A follow-up could add a separate stats endpoint.
  **Acceptance**: Props flow through correctly. Activity stream shows pagination UI.

- [ ] 10. **Create API route tests**
  **What**: Unit tests for the new `/api/sessions/[id]/messages` route.
  **Files**:
    - Create `src/app/api/sessions/[id]/messages/__tests__/route.test.ts`
  **Details**:
    - Mock `getClientForInstance` to return a fake client whose `session.messages()` returns a known array
    - Test: default request returns last 50 messages with pagination metadata
    - Test: `limit=10` returns last 10 messages
    - Test: `before=<id>` returns 50 messages before that ID
    - Test: `before=<id>&limit=10` returns 10 messages before that ID
    - Test: returns `hasMore: false` when all messages fit in the response
    - Test: returns 400 when `instanceId` is missing
    - Test: returns 404 when instance not found
    - Follow existing test patterns (see `src/app/api/sessions/__tests__/route.test.ts`)
  **Acceptance**: `npm run test -- src/app/api/sessions/[id]/messages/__tests__/route.test.ts` passes.

- [ ] 11. **Handle edge cases and polish**
  **What**: Address edge cases for robust behavior.
  **Files**:
    - Modify `src/hooks/use-message-pagination.ts`
    - Modify `src/hooks/use-session-events.ts`
    - Modify `src/components/session/activity-stream-v1.tsx`
  **Details**:
    - **Error during fetch**: If `loadOlderMessages()` fails, set an error state but do NOT change `hasMore` — allow retry. Surface a subtle error indicator at the top of the stream.
    - **Rapid scrolling**: The `isLoadingOlder` guard prevents concurrent fetches. Add a cooldown (500ms minimum between fetches) to avoid hammering the API during fast scroll.
    - **Empty sessions**: If the session has 0 messages, pagination should gracefully show the existing empty state.
    - **Session with fewer than `limit` messages**: First fetch returns all messages with `hasMore: false`. No "load more" UI shown.
    - **SSE adds message that's also in a paginated batch**: `prependMessages` deduplication handles this via `messageId` matching.
    - **Search/filter with partial messages loaded**: `useActivityFilter` already operates on the `messages` array passed to it. When only 50 messages are loaded, search only covers those 50. This is acceptable — the status bar shows "X of Y loaded" to set expectations. A future enhancement could add server-side search.
    - **Reconnect recovery**: On SSE reconnect, the full session endpoint is used (all messages), which resets pagination state to "all loaded". This is intentional — recovery must be gap-free.
  **Acceptance**: No crashes or incorrect behavior in any of the listed edge cases.

## Implementation Order

```
TODO 2 (pagination-utils.ts) — pure functions, no dependencies
  ↓
TODO 3 (pagination-utils tests) — validates TODO 2
  ↓
TODO 1 (API endpoint) — uses sliceMessages from TODO 2
  ↓
TODO 10 (API route tests) — validates TODO 1
  ↓
TODO 4 (useMessagePagination hook) — uses pagination-utils, calls API from TODO 1
  ↓
TODO 6 (useScrollAnchor extensions) — independent of TODO 4
  ↓
TODO 7 (scroll anchor tests) — validates TODO 6
  ↓
TODO 5 (integrate into useSessionEvents) — combines TODO 4 + existing hook
  ↓
TODO 8 (ActivityStreamV1 wiring) — uses TODO 5 output + TODO 6 scroll detection
  ↓
TODO 9 (session page prop passthrough) — wires TODO 5 → TODO 8
  ↓
TODO 11 (edge cases + polish) — final hardening pass
```

## Verification
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes (all existing + new tests)
- [ ] Network tab shows initial load fetches only 50 messages (response payload size)
- [ ] Scrolling up near top triggers another fetch (visible in Network tab)
- [ ] Older messages appear without scroll jump
- [ ] SSE real-time messages still appear at bottom
- [ ] Jump-to-bottom FAB still works correctly
- [ ] Search/filter works across all loaded messages
- [ ] Reconnect recovery loads full state (no gaps)
- [ ] Edge cases: empty session, < 50 messages, rapid scroll, fetch error

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│  SessionDetailPage (page.tsx)                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  useSessionEvents                              │  │
│  │  ├── loadInitialMessages() ──→ GET /messages   │  │
│  │  │   (paginated: last 50)    ←── {messages,    │  │
│  │  │                                 pagination} │  │
│  │  ├── loadOlderMessages() ───→ GET /messages    │  │
│  │  │   (?before=X&limit=50)    ←── {older msgs}  │  │
│  │  ├── SSE EventSource ───────→ GET /events      │  │
│  │  │   (unchanged — real-time)                   │  │
│  │  └── messages[] state                          │  │
│  │      ├── prepend older (via prependMessages)   │  │
│  │      └── append new (via SSE handleEvent)      │  │
│  └───────────────────────────────────────────────┘  │
│                        │                            │
│  ┌─────────────────────▼─────────────────────────┐  │
│  │  ActivityStreamV1                              │  │
│  │  ├── useScrollAnchor (isNearTop, isAtBottom)   │  │
│  │  ├── useActivityFilter (search/filter)         │  │
│  │  ├── onLoadOlder() ← triggered by isNearTop   │  │
│  │  └── preserveScrollPosition() on prepend      │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Server: GET /api/sessions/[id]/messages            │
│  ├── client.session.messages() → ALL messages       │
│  ├── sliceMessages(all, {limit, before})            │
│  └── return {messages, pagination: {hasMore, ...}}  │
└─────────────────────────────────────────────────────┘
```

## Risk Notes

1. **SDK fetches all messages regardless**: The `client.session.messages()` call always returns everything. The server-side slicing only reduces the response payload to the client, not the server's memory usage. For extremely large sessions (10k+ messages), the SDK fetch itself could be slow. Mitigation: consider caching the full message array in memory per session with a TTL (future optimization, out of scope for this plan).

2. **Sidebar stats reflect only loaded messages**: Cost, tokens, and agent participation counts are computed from the loaded `messages[]` array. When only 50 messages are loaded, these stats are incomplete. This is acceptable as a known limitation — add a tooltip or "(loaded)" suffix to clarify. A dedicated stats endpoint is a future enhancement.

3. **Search only covers loaded messages**: When filtering, only the loaded messages are searchable. The status bar already shows "X of Y" counts. Server-side search is a future enhancement.

4. **Scroll position preservation is browser-dependent**: The `requestAnimationFrame` approach for adjusting `scrollTop` after prepend works in all modern browsers but relies on the Radix ScrollArea viewport behaving like a standard scrollable element. The existing `useScrollAnchor` already uses this pattern successfully.
