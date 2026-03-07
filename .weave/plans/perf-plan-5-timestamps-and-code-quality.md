# Performance Plan 5: Timestamps & Code Quality

## TL;DR
> **Summary**: Replace per-instance `setInterval` timers in `RelativeTimestamp` with a shared singleton timer using `useSyncExternalStore`, and consolidate three duplicated `timeSince()` functions into the canonical `formatRelativeTime` utility.
> **Estimated Effort**: Short (1 day)

## Context
### Original Request
Each `RelativeTimestamp` component creates its own 30-second `setInterval` timer. With many timestamps visible, this creates unnecessary timer overhead. Additionally, three separate `timeSince()` implementations exist across different files, all producing identical output formats but accepting different input types.

### Key Findings
- **`relative-timestamp.tsx` lines 15–20**: Per-instance `setInterval(30_000)` to force re-render. Each mounted `RelativeTimestamp` creates its own timer.
- **`live-session-card.tsx` lines 11–18**: Exported `timeSince(timestamp: number)` — accepts numeric timestamp.
- **`session-card.tsx` line 56**: Private `timeSince(date: Date)` — accepts Date object.
- **`notification-bell.tsx` line 34**: Private `timeSince(dateString: string)` — accepts string, includes SQLite datetime normalization (appends 'Z' if missing timezone).
- **`format-utils.ts` line 67**: Canonical `formatRelativeTime(timestamp: number, now?: number)` — accepts number only, includes `>24h` absolute date fallback that none of the `timeSince` functions have.
- All three `timeSince` functions produce the same output format: "Xs ago", "Xm ago", "Xh ago" but lack the `>24h` fallback.

## Prerequisites
- None — this plan is independent of Plans 1–4 and can run in parallel.

## Expected Impact
- Timer count reduced from N (one per timestamp) to 1 (shared singleton)
- Code deduplication: 3 functions consolidated into 1
- Consistent timestamp formatting across all components

## Objectives
### Core Objective
Eliminate per-instance timer overhead and consolidate duplicated timestamp formatting.

### Deliverables
- [ ] Shared `useRelativeTime` hook using `useSyncExternalStore` with singleton timer
- [ ] `RelativeTimestamp` component refactored to use the shared hook
- [ ] All three `timeSince` functions replaced with calls to `formatRelativeTime`
- [ ] `formatRelativeTime` enhanced to accept `Date` and `string` inputs (not just `number`)

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass, including new/updated tests for `formatRelativeTime`
- [ ] No `setInterval` calls remain in `relative-timestamp.tsx`
- [ ] No `timeSince` functions remain in `live-session-card.tsx`, `session-card.tsx`, or `notification-bell.tsx`

### Guardrails (Must NOT)
- Must NOT change the visual output of any timestamp display
- Must NOT change the 30-second update interval (this is the correct cadence for "Xm ago" precision)

---

## TODOs

- [ ] 1. **Create `useRelativeTime` shared timer hook**
  **What**: A hook that returns the current "now" timestamp, updated every 30 seconds by a singleton timer. Uses `useSyncExternalStore` for React 18+ compatibility and automatic SSR safety.
  **Files**: `src/hooks/use-relative-time.ts` (new file)
  **Details**:
  Module-level singleton pattern (same as H3 proposes, consistent with `useGlobalSSE` in Plan 4):
  ```ts
  import { useSyncExternalStore } from "react";

  const TICK_INTERVAL_MS = 30_000;

  let now = Date.now();
  let subscribers = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function subscribe(callback: () => void): () => void {
    subscribers.add(callback);
    if (subscribers.size === 1 && timer === null) {
      timer = setInterval(() => {
        now = Date.now();
        for (const cb of subscribers) cb();
      }, TICK_INTERVAL_MS);
    }
    return () => {
      subscribers.delete(callback);
      if (subscribers.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  function getSnapshot(): number {
    return now;
  }

  function getServerSnapshot(): number {
    return Date.now();
  }

  /**
   * Returns the current timestamp, updated every 30 seconds via a shared singleton timer.
   * Only one setInterval runs regardless of how many components use this hook.
   */
  export function useRelativeTime(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }
  ```

  Key design points:
  - **Ref-counted timer**: Only runs when ≥1 subscriber exists
  - **`useSyncExternalStore`**: React 18+ concurrent-safe, handles SSR via `getServerSnapshot`
  - **Returns `number` (timestamp)**: Consumers pass this to `formatRelativeTime(timestamp, now)` to get formatted output
  **Acceptance**: 50 components using `useRelativeTime` create only 1 `setInterval`. Unmounting all stops the timer.

- [ ] 2. **Enhance `formatRelativeTime` to accept multiple input types**
  **What**: Extend `formatRelativeTime` to accept `Date` and `string` inputs in addition to `number`, making it a drop-in replacement for all three `timeSince` functions.
  **Files**: `src/lib/format-utils.ts`, `src/lib/__tests__/format-utils.test.ts`
  **Details**:
  ```ts
  // BEFORE (line 67)
  export function formatRelativeTime(timestamp: number, now?: number): string {

  // AFTER
  export function formatRelativeTime(
    timestamp: number | Date | string,
    now?: number
  ): string {
    let ts: number;
    if (typeof timestamp === "number") {
      ts = timestamp;
    } else if (timestamp instanceof Date) {
      ts = timestamp.getTime();
    } else {
      // String — handle SQLite datetime format (may lack timezone)
      const normalized = timestamp.endsWith("Z") || timestamp.includes("+")
        ? timestamp
        : timestamp + "Z";
      ts = new Date(normalized).getTime();
    }
    // ... rest of existing logic using ts instead of timestamp ...
  ```

  This handles:
  - `number` — as before (used by `live-session-card.tsx`)
  - `Date` — for `session-card.tsx`'s `timeSince(date: Date)`
  - `string` — for `notification-bell.tsx`'s `timeSince(dateString: string)` with SQLite normalization

  Add tests:
  - Accepts `number` input (existing behavior)
  - Accepts `Date` input (same output as equivalent number)
  - Accepts `string` input with timezone
  - Accepts `string` input without timezone (appends Z)
  - Returns ">24h" absolute date for old timestamps (existing behavior)
  **Acceptance**: All existing `format-utils.test.ts` tests still pass. New tests cover Date and string inputs.

- [ ] 3. **Refactor `RelativeTimestamp` to use `useRelativeTime`**
  **What**: Replace the per-instance `setInterval` in `RelativeTimestamp` with the shared `useRelativeTime` hook.
  **Files**: `src/components/session/relative-timestamp.tsx`
  **Details**:
  ```tsx
  // BEFORE (34 lines)
  export function RelativeTimestamp({ timestamp }: { timestamp: number }) {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
      const id = setInterval(() => forceUpdate(n => n + 1), 30_000);
      return () => clearInterval(id);
    }, []);
    return <span>{formatRelativeTime(timestamp)}</span>;
  }

  // AFTER (~10 lines)
  import { useRelativeTime } from "@/hooks/use-relative-time";

  export function RelativeTimestamp({ timestamp }: { timestamp: number }) {
    const now = useRelativeTime();
    return <span>{formatRelativeTime(timestamp, now)}</span>;
  }
  ```
  The component becomes a pure render function — no internal state, no effects, no timers.
  **Acceptance**: Component renders correctly. No `setInterval` in the component. 20 `RelativeTimestamp` instances → 1 timer total.

- [ ] 4. **Replace `timeSince` in `live-session-card.tsx`**
  **What**: Remove the exported `timeSince(timestamp: number)` function (lines 11–18) and replace all call sites with `formatRelativeTime`.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Details**:
  ```tsx
  // BEFORE (lines 11-18)
  export function timeSince(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  // AFTER — delete the function, import formatRelativeTime
  import { formatRelativeTime } from "@/lib/format-utils";
  // At call sites, replace timeSince(timestamp) with formatRelativeTime(timestamp)
  ```
  Check if `timeSince` is exported and used elsewhere — the `export` keyword at line 11 suggests it might be imported by other files. Grep for `timeSince` imports before removing.
  **Acceptance**: No `timeSince` function in the file. All timestamps display correctly.

- [ ] 5. **Replace `timeSince` in `session-card.tsx`**
  **What**: Remove the private `timeSince(date: Date)` function (line 56) and replace with `formatRelativeTime(date)` (which now accepts `Date` per Task 2).
  **Files**: `src/components/fleet/session-card.tsx`
  **Details**:
  ```tsx
  // BEFORE
  function timeSince(date: Date): string { ... }
  // Usage: timeSince(new Date(session.createdAt * 1000))

  // AFTER
  import { formatRelativeTime } from "@/lib/format-utils";
  // Usage: formatRelativeTime(new Date(session.createdAt * 1000))
  // Or even: formatRelativeTime(session.createdAt * 1000) // pass as number directly
  ```
  **Acceptance**: No `timeSince` function in the file. Timestamps display correctly.

- [ ] 6. **Replace `timeSince` in `notification-bell.tsx`**
  **What**: Remove the private `timeSince(dateString: string)` function (line 34) and replace with `formatRelativeTime(dateString)` (which now handles string inputs with SQLite normalization per Task 2).
  **Files**: `src/components/notifications/notification-bell.tsx`
  **Details**:
  ```tsx
  // BEFORE
  function timeSince(dateString: string): string {
    const normalized = dateString.endsWith("Z") ? dateString : dateString + "Z";
    const date = new Date(normalized);
    // ... same relative time logic ...
  }

  // AFTER
  import { formatRelativeTime } from "@/lib/format-utils";
  // Usage: formatRelativeTime(dateString)
  ```
  **Acceptance**: No `timeSince` function in the file. Notification timestamps display correctly.

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass, including new `formatRelativeTime` overload tests
- [ ] Grep for `timeSince` across `src/` returns 0 results (only in `format-utils` if renamed)
- [ ] Grep for `setInterval` in `relative-timestamp.tsx` returns 0 results
- [ ] Manual test: timestamps update every ~30 seconds on the fleet page and session detail page
- [ ] Manual test: notification bell timestamps show correct relative times
- [ ] Performance: React DevTools shows no unnecessary re-renders from timestamp components between 30s ticks
