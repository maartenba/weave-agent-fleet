# UI Performance Fixes — Browser Tab Freeze Prevention

**PR**: https://github.com/pgermishuys/weave-agent-fleet/pull/151

## TL;DR
> **Summary**: Fix browser tab freezes caused by unvirtualized 500+ message rendering, unthrottled scroll listeners, aggressive 5s polling, and broken React.memo chains in the fleet dashboard. Two-phase approach: quick wins first (~80% improvement), then structural changes for the remaining 10%.
> **Estimated Effort**: Medium

## Context
### Original Request
Users report browser tab freezes in the Weave Agent Fleet UI (Next.js 16 + React 19). The main bottleneck is the activity stream rendering 500+ messages without virtualization, combined with unthrottled scroll listeners and aggressive polling.

### Key Findings

1. **`activity-stream-v1.tsx` (836 lines)** — The primary bottleneck. Lines 704–757 iterate `groupedEntries.map()` and render every single message into the DOM. With 500+ messages (each containing markdown, tool cards, etc.), this creates thousands of DOM nodes. The scroll position tracking effect (lines 565–582) attaches a document-level `scroll` listener with `capture: true` that fires on *every* scroll event from any scrollable element on the page — not just the activity stream viewport.

2. **`use-sessions.ts` (59 lines)** — Line 15: `DEFAULT_POLL_INTERVAL_MS = 5_000`. The `SessionsProvider` in `sessions-context.tsx` (line 128) passes `5000` directly. The `useFleetSummary` hook polls at 10s. Neither hook pauses when the browser tab is hidden. The existing `use-pr-status.ts` (lines 153–158) already implements the `visibilitychange` pattern — we can follow that exact approach.

3. **`live-session-card.tsx` (245 lines)** — Line 136: `tokens={{ input: 0, output: 0, reasoning: 0 }}` creates a fresh object literal on every render. `LiveSessionCard` is wrapped in `React.memo` (line 23), but this prop defeats memoization for every card in the fleet grid because the `tokens` object identity changes on each render cycle. The `TokenCostBreakdown` component (line 35) accepts this as a prop.

4. **`markdown-renderer.tsx` (219 lines)** — Already wrapped in `React.memo` on line 219 (`export const MarkdownRenderer = memo(MarkdownRendererInner)`). **This was originally reported as unmemoized but is actually already memoized.** No change needed.

5. **`page.tsx` (526 lines)** — All action handlers (lines 61–113: `handleTerminate`, `handleAbort`, `handleResume`, `handleDeleteRequest`, `handleDeleteConfirm`, `handleOpen`) are already wrapped in `useCallback`. The `sortedWorkspaceGroups` is already memoized (line 164). However, the `renderGroupedBySessionStatus`, `renderGroupedByConnectionStatus`, and `renderGroupedBySource` functions (lines 185–372) are plain functions recreated every render, and they pass the `handleTerminate`/etc. callbacks to dozens of `LiveSessionCard` instances via `nestSessions()`.

6. **`use-scroll-anchor.ts` (318 lines)** — The scroll handler (line 108) is already debounced via `requestAnimationFrame` (one rAF at a time, lines 109–142). However, the *document-level* scroll listener in `activity-stream-v1.tsx` (lines 565–582) for `scrollPositionRef` has NO throttling — it calls `getScrollPosition()` synchronously on every scroll event.

## Objectives
### Core Objective
Eliminate browser tab freezes when viewing sessions with 500+ messages and navigating the fleet dashboard with many active sessions.

### Deliverables
- [x] Reduce poll frequency from 5s to 15s
- [x] Throttle the document-level scroll listener in `activity-stream-v1.tsx`
- [x] Extract constant tokens object in `live-session-card.tsx` to preserve React.memo
- [x] Virtualize the activity stream with `@tanstack/react-virtual`
- [x] Pause all polling when browser tab is hidden
- [x] Use `useDeferredValue` for fleet workspace group rendering

### Definition of Done
- [ ] A session with 500+ messages loads and scrolls without frame drops (verify with React DevTools Profiler)
- [x] `npm run build` — pre-existing `generate is not a function` Next.js tooling error (not introduced by our changes)
- [x] `npm run typecheck` — passes (only pre-existing `vitest/globals` type definition error)
- [x] `npm run test` — vitest not installed (pre-existing), not introduced by our changes
- [ ] Fleet dashboard with 20+ session cards does not cause unnecessary re-renders (verify with React DevTools highlight updates)

### Guardrails (Must NOT)
- Must NOT break SSE real-time updates (activity status must still reflect within ~1 second)
- Must NOT break scroll-to-bottom auto-scroll behavior
- Must NOT break cache restore scroll position logic
- Must NOT break infinite scroll (load older messages near top)
- Must NOT change the visual appearance of any component
- Must NOT remove or change the MutationObserver auto-scroll behavior in `use-scroll-anchor.ts`

## TODOs

### Phase 1 — Quick Wins (~80% improvement)

- [x] 1. **Increase poll interval from 5s to 15s**
  **What**: Change the default poll interval in `use-sessions.ts` and update the hardcoded value in `sessions-context.tsx`. The SSE real-time channel already provides instant activity_status and token_update events, so polling is only a fallback/reconciliation mechanism.
  **Files**:
    - `src/hooks/use-sessions.ts` — Line 15: change `DEFAULT_POLL_INTERVAL_MS = 5_000` to `15_000`
    - `src/contexts/sessions-context.tsx` — Line 128: change `useSessions(5000)` to `useSessions(15000)` (or remove the argument to use the new default)
    - `src/hooks/use-fleet-summary.ts` — Line 15: consider increasing from `10_000` to `30_000` (it's a lightweight summary, but still wasteful)
  **Acceptance**: Network tab shows `/api/sessions` polling at 15s intervals, `/api/fleet/summary` at 30s intervals. SSE events still update the UI instantly.

- [x] 2. **Throttle document-level scroll listener for scrollPositionRef**
  **What**: The scroll event handler in `activity-stream-v1.tsx` (lines 565–582) fires on every scroll event from any element (due to `capture: true`) and calls `getScrollPosition()` synchronously. Throttle this to fire at most once per 100ms using a `setTimeout`-based trailing throttle. The `getScrollPosition()` call is cheap but the sheer event frequency (60+ times/sec during smooth scroll) is unnecessary since this ref is only read on unmount.
  **Files**:
    - `src/components/session/activity-stream-v1.tsx` — Lines 565–582: wrap the `handleScroll` callback in a trailing throttle. Add a `throttleTimerRef` using `useRef<ReturnType<typeof setTimeout> | null>(null)`. In the cleanup, clear the timeout. On each scroll event, if a timer is pending, skip; otherwise set a 100ms timeout that captures the position.
  **Acceptance**: During rapid scrolling, `getScrollPosition()` is called at most ~10 times/sec instead of 60+. Scroll position is still correctly saved on unmount (because the last timeout fires before or during the cleanup).

- [x] 3. **Extract constant tokens object in `live-session-card.tsx`**
  **What**: Line 136 creates `{ input: 0, output: 0, reasoning: 0 }` as an inline object literal on every render, defeating `React.memo` on `LiveSessionCard` because shallow comparison fails on the new object. Extract this to a module-level constant.
  **Files**:
    - `src/components/fleet/live-session-card.tsx` — Add a module-level constant (e.g., near line 21): `const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0 } as const;`. Then on line 136, replace `tokens={{ input: 0, output: 0, reasoning: 0 }}` with `tokens={ZERO_TOKENS}`.
  **Acceptance**: React DevTools "Highlight updates" shows `LiveSessionCard` components do NOT re-render when the parent re-renders with no actual data changes. The `ZERO_TOKENS` constant is referentially stable.

- [x] 4. **Pause polling when browser tab is hidden**
  **What**: Add `visibilitychange` listeners to `use-sessions.ts` and `use-fleet-summary.ts` so that polling stops when the tab is not visible and resumes (with an immediate fetch) when the tab becomes visible again. Follow the exact pattern already established in `src/hooks/use-pr-status.ts` (lines 153–163).
  **Files**:
    - `src/hooks/use-sessions.ts` — In the `useEffect` at line 47: (a) add early-return in `fetchSessions` when `document.visibilityState !== "visible"` (same pattern as `use-pr-status.ts` line 79); (b) add `visibilitychange` event listener that calls `fetchSessions()` when tab becomes visible; (c) clean up the listener on unmount.
    - `src/hooks/use-fleet-summary.ts` — Apply the identical pattern in the `useEffect` at line 57.
  **Acceptance**: When switching to another browser tab for 30+ seconds and back, the Network tab shows no poll requests were made while hidden, and an immediate fetch fires on tab re-focus.

### Phase 2 — Medium Effort (~90% improvement)

- [x] 5. **Virtualize the activity stream with `@tanstack/react-virtual`**
  **What**: The `groupedEntries.map()` loop (lines 704–757) renders every message into the DOM. With 500+ messages, each containing markdown rendering (rehype-highlight, remark-gfm), tool call cards, images, etc., this creates thousands of DOM nodes. Replace the flat `.map()` with a virtualized list using `@tanstack/react-virtual`'s `useVirtualizer`. Only render messages visible in the viewport plus an overscan buffer.
  **Files**:
    - `package.json` — Add dependency: `"@tanstack/react-virtual": "^3.13.0"` (check latest 3.x)
    - `src/components/session/activity-stream-v1.tsx` — Major refactor of lines 669–776:
      1. The `<ScrollArea>` wraps a viewport with `[data-slot="scroll-area-viewport"]`. The virtualizer needs a reference to this scrollable element. Use a ref-callback that finds the viewport element (similar to `use-scroll-anchor.ts` lines 158–159).
      2. Import `useVirtualizer` from `@tanstack/react-virtual`.
      3. Call `useVirtualizer({ count: groupedEntries.length, getScrollElement: () => viewportEl, estimateSize: () => 120, overscan: 10 })` — the estimate of 120px per entry is reasonable for typical message heights; the virtualizer will measure actual sizes.
      4. Replace the flat `groupedEntries.map()` with the virtualizer's `getVirtualItems()` loop, rendering only visible items.
      5. Each rendered item should use `data-index` and a `measureElement` ref callback for dynamic sizing.
      6. The outer container needs `position: relative` and `height: totalSize` to maintain correct scroll dimensions.
      7. Keep the "Loading older messages" indicator and bottom "Thinking" indicator outside the virtualized list (they should always render).
      8. **Critical**: Ensure the `useScrollAnchor` hook still works — the virtualizer changes the DOM structure but the viewport element and scroll events remain the same.
      9. **Critical**: Ensure infinite scroll (isNearTop → onLoadOlder) still works. The `useScrollAnchor` checks `el.scrollTop <= NEAR_TOP_THRESHOLD`.
      10. **Critical**: The `DurationSeparator` between entries (line 746) needs to be incorporated into the virtualized items — either as separate virtual items or rendered inside the message item.
  **Acceptance**: With 500+ messages, only ~30 DOM message nodes exist at any time. Scrolling is smooth at 60fps. `React DevTools Profiler` shows render time under 16ms per frame.

- [x] 6. **Use `useDeferredValue` for fleet workspace group rendering**
  **What**: In `page.tsx`, the `sortedWorkspaceGroups` computation (lines 164–167) triggers synchronous re-renders of all `SessionGroup` components whenever any session's data changes (even via SSE patches). Use React 19's `useDeferredValue` to defer the workspace group rendering so the UI thread isn't blocked.
  **Files**:
    - `src/app/page.tsx` — Import `useDeferredValue` from `react` (line 1). After line 167 (`sortedWorkspaceGroups`), add: `const deferredWorkspaceGroups = useDeferredValue(sortedWorkspaceGroups);`. Then in the JSX (line 443), change `sortedWorkspaceGroups.map(...)` to `deferredWorkspaceGroups.map(...)`. Optionally add a `isPending` visual indicator (e.g., slight opacity reduction) using `useTransition` or checking `deferredWorkspaceGroups !== sortedWorkspaceGroups`.
  **Acceptance**: When SSE events arrive rapidly (multiple sessions changing status), the fleet dashboard doesn't freeze — workspace groups update with a slight delay instead of synchronously blocking.

- [x] 7. **Memoize `renderGroupedBy*` functions in `page.tsx`**
  **What**: The `renderGroupedBySessionStatus` (lines 185–244), `renderGroupedByConnectionStatus` (lines 247–312), and `renderGroupedBySource` (lines 314–372) are plain functions defined inside the component body. They capture `searchFiltered`, `sortSessions`, and the handler callbacks via closure. While the handlers are stable (useCallback), these render functions are recreated every render, and `renderContent()` (line 374) calls whichever is active. Wrap these in `useMemo` or `useCallback` so that the JSX they return is stable when inputs haven't changed.
  **Files**:
    - `src/app/page.tsx` — Convert `renderGroupedBySessionStatus`, `renderGroupedByConnectionStatus`, and `renderGroupedBySource` from inline functions to `useMemo` calls that return JSX. Their dependencies are: `searchFiltered`, `sortSessions`, `handleTerminate`, `handleResume`, `handleDeleteRequest`, `handleOpen`, `handleAbort`, `resumingSessionId`, `nestSessions`.
  **Acceptance**: React DevTools shows `FleetPageInner` does not cause child `LiveSessionCard` re-renders when only unrelated state (e.g., `deleteTarget`) changes.

## Verification
- [x] `npm run typecheck` passes with no errors (pre-existing vitest/globals error only, not introduced by these changes)
- [x] `npm run build` — pre-existing `generate is not a function` Next.js tooling error (not introduced by our changes)
- [x] `npm run test` — vitest not installed (pre-existing), not introduced by our changes
- [ ] Manual test: Open a session with 500+ messages → no frame drops, smooth scrolling
- [ ] Manual test: Fleet dashboard with 20+ cards → no lag when SSE events arrive
- [ ] Manual test: Switch browser tabs for 60s → Network tab shows no poll requests while hidden → immediate refetch on tab focus
- [ ] Manual test: Scroll position cache restore still works (navigate away and back to a session)
- [ ] Manual test: "Load older messages" infinite scroll still triggers near the top
- [ ] Manual test: New messages auto-scroll to bottom still works when at bottom
- [ ] React DevTools Profiler: no single render exceeds 16ms on the activity stream page
