# H3: RelativeTimestamp Interval Proliferation Optimization

## TL;DR
> **Summary**: Replace per-component `setInterval` in `RelativeTimestamp` with a single shared timer, consolidate 3 duplicated `timeSince()` functions, and add age-adaptive update frequency to eliminate thousands of unnecessary re-renders per hour on long session pages.
> **Estimated Effort**: Medium

## Context

### Original Request
Investigate and optimize the RelativeTimestamp interval proliferation issue — each `RelativeTimestamp` component instance creates its own `setInterval`, leading to N intervals and N re-renders every 30 seconds on the session detail page.

### Hypothesis Status: Partially Confirmed

**Confirmed:**
- `RelativeTimestamp` creates 1 `setInterval(30s)` per component instance — verified in `src/components/session/relative-timestamp.tsx` (lines 15-20)
- On a session detail page with N messages, this produces N concurrent intervals and N re-renders every 30 seconds
- Intervals are not intentionally synchronized but effectively burst-synchronize because components mount near-simultaneously during page load
- For a session with 100 messages: 100 intervals → 200 re-renders/min → 12,000/hour

**Not Confirmed (hypothesis was wrong):**
- Fleet cards do NOT use `RelativeTimestamp` — they use static `timeSince()` functions with no auto-update
- The problem is scoped entirely to the session detail activity stream, not fleet/dashboard pages

### Key Findings

| File | Lines | What |
|------|-------|------|
| `src/components/session/relative-timestamp.tsx` | 1-34 | Component with per-instance `setInterval(30_000)` |
| `src/components/session/activity-stream-v1.tsx` | 19, 206 | Only consumer — 1 instance per `MessageItem` |
| `src/lib/format-utils.ts` | 67-82 | `formatRelativeTime()` — the canonical formatting function |
| `src/components/fleet/live-session-card.tsx` | 11-18 | `timeSince(timestamp: number)` — exported, static, no auto-update |
| `src/components/fleet/session-card.tsx` | 56-63 | `timeSince(date: Date)` — private, static, no auto-update |
| `src/components/notifications/notification-bell.tsx` | 34-44 | `timeSince(dateString: string)` — private, static, ISO string input |

### Impact Quantification

| Scenario | Intervals | Re-renders/30s | Re-renders/hour |
|----------|-----------|----------------|-----------------|
| Fleet page (20 sessions) | 0 | 0 | 0 |
| Session page (30 messages) | 30 | 30 | 3,600 |
| Session page (100 messages) | 100 | 100 | 12,000 |
| Session page (300 messages) | 300 | 300 | 36,000 |

**Synchronization behavior:** All intervals are 30,000ms with empty dep arrays `[]`. Since messages render in a single React commit during page load, all `useEffect` callbacks fire in the same microtask batch, causing all intervals to align. This produces a burst of N state updates within milliseconds every 30s, which React batches into ~1 render pass — but each component still reconciles individually (Tooltip + TooltipTrigger + TooltipContent + span per message).

### Additional Issue: 3 Duplicated `timeSince()` Functions

Three separate implementations of the same logic with different input types:
1. **`live-session-card.tsx:11`** — `timeSince(timestamp: number): string` — takes unix ms, exported
2. **`session-card.tsx:56`** — `timeSince(date: Date): string` — takes Date object, private
3. **`notification-bell.tsx:34`** — `timeSince(dateString: string): string` — takes ISO/SQLite string, private, includes SQLite normalization

All three produce identical output format (`Xs ago`, `Xm ago`, `Xh ago`) but none handle the `>24h` fallback that `formatRelativeTime` does. They also never auto-update — showing stale times that drift silently.

## Objectives

### Core Objective
Reduce per-message interval overhead from O(N) to O(1) and consolidate duplicated time-formatting logic.

### Deliverables
- [ ] Single shared timer mechanism replacing N per-component intervals
- [ ] Age-adaptive update frequency (recent timestamps update faster, old ones slower)
- [ ] Consolidated `timeSince` / `formatRelativeTime` into one canonical utility
- [ ] Fleet cards optionally opt into live updates via the shared timer
- [ ] Tests for the new hook/context and the consolidated utility

### Definition of Done
- [ ] `npx vitest run` — all tests pass
- [ ] `npm run build` — no build errors
- [ ] Session page with 100 messages creates exactly 1 timer (verified via React DevTools or a quick `console.log` audit)
- [ ] `formatRelativeTime` is the single source of truth for relative time strings across the app
- [ ] No `setInterval` calls remain in `relative-timestamp.tsx`

### Guardrails (Must NOT)
- Must NOT change the visual output or formatting of any timestamp
- Must NOT introduce a new React context provider (avoid provider proliferation — a module-level singleton is simpler and sufficient)
- Must NOT break the existing `formatRelativeTime` test suite
- Must NOT add external dependencies

## Feasibility Assessment

### Approach 1: Single Shared Timer (Module-Level Singleton Hook)
**Concept:** A custom hook `useRelativeTick()` backed by a module-level `setInterval`. A single interval runs when ≥1 subscriber exists. Components subscribe on mount, unsubscribe on unmount. The interval fires, increments a shared counter, and all subscribers re-render via `useSyncExternalStore`.

**Pros:**
- O(1) intervals regardless of component count
- `useSyncExternalStore` is the React-blessed pattern for external stores — works with concurrent mode, SSR-safe with `getServerSnapshot`
- Zero context providers needed — pure module-level singleton
- Trivial to add age-adaptive ticking (the store decides the interval frequency)

**Cons:**
- All subscribers re-render on each tick (same as today but from 1 source)
- Slightly more complex than the naive approach

**Verdict: ✅ Recommended — primary approach.**

### Approach 2: `requestAnimationFrame`-Based
**Concept:** Replace `setInterval` with a `requestAnimationFrame` loop that checks elapsed time.

**Pros:**
- Automatically pauses when tab is backgrounded (saves CPU)
- Smooth integration with browser render cycle

**Cons:**
- rAF fires ~60fps — checking 60 times/sec whether 30s elapsed is wasteful
- Would need throttling logic, adding complexity to achieve what `setInterval` does natively
- `setInterval` already doesn't fire in background tabs in modern browsers

**Verdict: ❌ Rejected — over-engineered for this use case. The tab-backgrounding benefit is already provided by modern browsers throttling `setInterval` in background tabs.**

### Approach 3: Stagger Intervals with Random Offset
**Concept:** Add `Math.random() * 5000` offset to each component's interval start to spread re-renders across time.

**Pros:**
- Simple 1-line change
- Reduces burst re-render density

**Cons:**
- Still O(N) intervals — doesn't solve the core problem
- Makes behavior harder to reason about (non-deterministic)
- Spreads the same total work across time instead of eliminating it

**Verdict: ❌ Rejected — treats the symptom, not the cause.**

### Approach 4: IntersectionObserver Visibility-Based Updates
**Concept:** Only tick timestamps that are currently visible in the viewport. Off-screen timestamps pause.

**Pros:**
- Truly eliminates wasted work for long scrollable lists
- Combines well with the shared timer (subscriber can skip update if not visible)

**Cons:**
- Adds complexity (IO setup per component)
- Marginal benefit given React 18 batching — off-screen components that re-render aren't expensive if they don't cause layout/paint
- The activity stream uses `ScrollArea` — need to verify IO works with the scroll container

**Verdict: ⚠️ Deferred — good optimization but premature. Combine with Approach 1 only if profiling shows paint cost from off-screen updates. Can be added later as the hook API remains compatible.**

### Approach 5: Adaptive Frequency Based on Age
**Concept:** Timestamps showing "just now" or "Xs ago" update every 30s. Timestamps showing "Xm ago" update every 60s. Timestamps showing "Xh ago" update every 5min. Timestamps showing a date never update.

**Pros:**
- Dramatically reduces re-renders for long sessions where most messages are old
- Session with 100 messages where 90 are >1h old: only 10 need 30s updates
- Naturally correct — there's no reason to re-render "2h ago" every 30 seconds

**Cons:**
- Slightly more complex timer logic (multiple tiers)
- Need to determine frequency per-subscriber based on timestamp age

**Implementation approach with shared timer:** Run the shared timer at the fastest needed interval (30s). Each subscriber stores its timestamp and the hook calculates whether it needs to re-render on this tick. Subscribers with old timestamps skip re-renders by comparing the new formatted string to the previous one.

**Verdict: ✅ Recommended — combine with Approach 1. Significant savings for real-world usage.**

### Approach 6: Consolidate 3 Duplicated `timeSince()` Functions
**Concept:** Replace all three `timeSince()` variants with `formatRelativeTime()` from `format-utils.ts`, adding input normalization (accept `number | Date | string`).

**Pros:**
- Single source of truth for relative time formatting
- Consistent output format (gains the `>24h` date fallback the others lack)
- Enables fleet cards to easily adopt auto-updating via the shared hook later

**Cons:**
- Minor breaking change if any consumer relies on `timeSince` by name (only `live-session-card.tsx` exports it — check for external imports)
- Need to handle the SQLite datetime normalization from notification-bell

**Verdict: ✅ Recommended — straightforward cleanup.**

## Recommended Solution

**Combine Approaches 1 + 5 + 6:**

1. **Shared timer via `useSyncExternalStore`** (Approach 1) — module-level singleton, O(1) intervals
2. **Age-adaptive skipping** (Approach 5) — subscribers compare prev/next formatted string, skip re-render if unchanged
3. **Consolidate `timeSince`** (Approach 6) — one function, flexible input types

The resulting architecture:
```
format-utils.ts            — formatRelativeTime(timestamp, now?) (enhanced to accept number|Date|string)
use-relative-time.ts       — useRelativeTime(timestamp): string (hook using useSyncExternalStore)
  └─ tickStore (module)    — single setInterval(30_000), subscriber count, tick counter
relative-timestamp.tsx     — simplified to: const text = useRelativeTime(timestamp); return <Tooltip>...
```

## TODOs

- [ ] 1. **Enhance `formatRelativeTime` to accept flexible input types**
  **What**: Overload or normalize input to accept `number | Date | string`. Add SQLite datetime normalization (from notification-bell.tsx line 37). Keep the existing `(timestamp: number, now?: number)` signature working for backward compat by checking input type at runtime.
  **Files**: `src/lib/format-utils.ts`
  **Acceptance**: Existing `formatRelativeTime` tests still pass. New tests cover Date and string inputs including SQLite format.

- [ ] 2. **Create `useRelativeTime` hook with shared timer**
  **What**: Create a new hook file. Implement a module-level tick store using `useSyncExternalStore`:
  - Module-level: `let tick = 0`, `let interval: NodeJS.Timeout | null`, `Set<() => void> listeners`
  - `subscribe(callback)`: add to listeners, start interval if first subscriber, return unsubscribe fn that stops interval when last subscriber leaves
  - `getSnapshot()`: return `tick`
  - `getServerSnapshot()`: return `0`
  - The hook: calls `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`, then returns `formatRelativeTime(timestamp)`. The tick value is consumed only to trigger re-evaluation — the actual return value comes from `formatRelativeTime(timestamp)` called with live `Date.now()`.
  - **Age-adaptive optimization**: After computing the formatted string, compare to a ref holding the previous value. If identical, the component tree below won't re-render (string equality means React bails out of child reconciliation). This naturally gives age-adaptive behavior — `"2h ago"` stays the same for ~60 minutes, so those components effectively skip re-renders.
  **Files**: `src/hooks/use-relative-time.ts` (new file)
  **Acceptance**: Hook returns correct relative time string. Only 1 `setInterval` exists regardless of subscriber count. Mounting 100 hooks creates 1 interval; unmounting all clears it.

- [ ] 3. **Refactor `RelativeTimestamp` to use `useRelativeTime`**
  **What**: Replace the internal `useState` + `useEffect` + `setInterval` with a single call to `useRelativeTime(timestamp)`. The component becomes stateless (no local state, no effects). Keep Tooltip rendering unchanged.
  **Files**: `src/components/session/relative-timestamp.tsx`
  **Acceptance**: Component renders identically. No `setInterval` in this file. No `useState` for tick. `useRelativeTime` is the only hook called (besides React's built-in via Tooltip).

- [ ] 4. **Replace `timeSince` in `live-session-card.tsx`**
  **What**: Remove the exported `timeSince` function. Replace usages with `formatRelativeTime` imported from `format-utils`. Since fleet cards don't auto-update (no hook), this is a pure formatting swap.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Acceptance**: Card renders the same time strings. No local `timeSince` function. `formatRelativeTime` imported from `@/lib/format-utils`.

- [ ] 5. **Replace `timeSince` in `session-card.tsx`**
  **What**: Remove the private `timeSince` function. Replace with `formatRelativeTime`. Adjust call site to pass `date.getTime()` (or rely on the new flexible input if implemented in step 1).
  **Files**: `src/components/fleet/session-card.tsx`
  **Acceptance**: Same as step 4. No local `timeSince`.

- [ ] 6. **Replace `timeSince` in `notification-bell.tsx`**
  **What**: Remove the private `timeSince` function (including SQLite normalization — that logic moves into `formatRelativeTime` in step 1). Replace with `formatRelativeTime`.
  **Files**: `src/components/notifications/notification-bell.tsx`
  **Acceptance**: Same as step 4. No local `timeSince`. SQLite datetime strings handled correctly.

- [ ] 7. **Verify no remaining imports of the old exported `timeSince`**
  **What**: Grep the codebase for `timeSince` imports. The only export was from `live-session-card.tsx` — verify nothing imports it.
  **Files**: None (verification step)
  **Acceptance**: `grep -r "timeSince" src/` returns zero results.

- [ ] 8. **Write tests for `useRelativeTime` hook**
  **What**: Test the hook using `@testing-library/react` `renderHook`. Test cases:
  - Returns correct formatted string on initial render
  - Re-renders when the shared timer ticks (use `vi.advanceTimersByTime(30_000)`)
  - Multiple hooks share one interval (spy on `setInterval` — called once)
  - Unmounting all hooks clears the interval
  - SSR snapshot returns a stable value
  **Files**: `src/hooks/__tests__/use-relative-time.test.ts` (new file)
  **Acceptance**: All tests pass with `npx vitest run src/hooks/__tests__/use-relative-time.test.ts`.

- [ ] 9. **Write tests for enhanced `formatRelativeTime`**
  **What**: Add test cases for Date and string inputs (including SQLite format `"2025-01-15 10:30:00"`) to the existing test file.
  **Files**: `src/lib/__tests__/format-utils.test.ts`
  **Acceptance**: All new and existing tests pass.

- [ ] 10. **Final integration verification**
  **What**: Run full test suite and build. Manually verify on a session detail page that timestamps still update correctly.
  **Files**: None
  **Acceptance**: `npx vitest run` passes. `npm run build` succeeds. No TypeScript errors.

## Verification
- [ ] `npx vitest run` — all tests pass (existing + new)
- [ ] `npm run build` — clean build, no errors
- [ ] No `setInterval` in `relative-timestamp.tsx`
- [ ] No `timeSince` function anywhere in `src/`
- [ ] `grep -r "setInterval" src/components/session/relative-timestamp.tsx` returns nothing
- [ ] Only 1 `setInterval` call in `use-relative-time.ts`

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `useSyncExternalStore` causes hydration mismatch | Low | Medium | Provide `getServerSnapshot` returning `0` so server render uses the initial `formatRelativeTime` call; client-side tick starts at `0` too, so first render matches |
| Removing `timeSince` export breaks external consumers | Low | Low | Grep confirms it's only used in `live-session-card.tsx` itself; if any import exists, redirect to `formatRelativeTime` |
| Age-adaptive skip changes visible behavior | None | None | Not actually skipping ticks — the hook always re-evaluates `formatRelativeTime()`. React's own bailout handles string equality. No component code changes needed |
| Fleet cards show stale times (existing issue, not new) | N/A | Low | Out of scope for this plan. The `useRelativeTime` hook is available for future fleet card adoption if desired |
| Module-level singleton leaks in tests | Medium | Low | Export a `resetTickStore()` for test cleanup, called in `afterEach` |
