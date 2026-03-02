# Issue #27: Add Timestamps to Messages

## TL;DR
> **Summary**: Display `createdAt` timestamps on every message in the activity stream. Data already flows through — this is purely a formatting + rendering change across 3 files.
> **Estimated Effort**: Quick

## Context
### Original Request
GitHub Issue #27 — users want to see when messages were sent in the session activity stream.

### Key Findings
- `AccumulatedMessage.createdAt` (unix ms) is already populated from the API via `useSessionEvents` → `info.time.created` and SSE updates.
- `MessageItem` in `activity-stream-v1.tsx` (line 129) renders the metadata row but does **not** display timestamps.
- The codebase has two existing time-formatting patterns:
  - `timeSince()` in `session-card.tsx` (relative: "5m ago") — used on fleet cards
  - `formatTime()` in legacy `activity-stream.tsx` (absolute: "14:34:05") — 24h, no date context
- Neither pattern is ideal. Messages need a smart format: time-only for today, date+time for older messages.
- `format-utils.ts` is the canonical home for shared formatting functions, with an existing test file at `src/lib/__tests__/format-utils.test.ts`.
- Two stale files (`TIMESTAMPS_ANALYSIS.md`, `TIMESTAMPS_QUICK_START.md`) should be deleted.

## Objectives
### Core Objective
Show a human-readable timestamp on every message (user and assistant) in the activity stream.

### Deliverables
- [ ] `formatTimestamp()` utility function in `format-utils.ts`
- [ ] Timestamp rendered in `MessageItem` metadata row
- [ ] Unit tests for the new formatter
- [ ] Stale analysis files removed

### Definition of Done
- [ ] Every message in the activity stream shows a timestamp
- [ ] Today's messages show time only (e.g., "2:34 PM")
- [ ] Older messages include the date (e.g., "Mar 1, 2:34 PM")
- [ ] `npm run test -- src/lib/__tests__/format-utils.test.ts` passes
- [ ] `npm run build` succeeds with no type errors

### Guardrails (Must NOT)
- Do NOT add any third-party date libraries (use native `Intl.DateTimeFormat` / `Date`)
- Do NOT modify `AccumulatedMessage` interface or data flow — it already works
- Do NOT change the legacy `activity-stream.tsx` — it's a separate component

## TODOs

- [ ] 1. **Add `formatTimestamp()` to format-utils.ts**
  **What**: Add a pure function that takes a unix-ms number and returns a display string. Logic:
  - If same calendar day as now → `"2:34 PM"` (time only, 12h with AM/PM)
  - If different day → `"Mar 1, 2:34 PM"` (short month + day + time)
  - If `undefined`/`null`/`NaN` → return `""` (graceful fallback)
  Use `Intl.DateTimeFormat` with `"en-US"` locale for consistency.
  **Files**: `src/lib/format-utils.ts`
  **Acceptance**: Function exported, handles all three cases correctly.

- [ ] 2. **Add unit tests for `formatTimestamp()`**
  **What**: Add a new `describe("formatTimestamp", ...)` block to the existing test file. Test cases:
  - Returns time-only string for a timestamp from today
  - Returns date+time string for a timestamp from a different day
  - Returns `""` for `undefined`
  - Returns `""` for `NaN`
  - Returns `""` for `0` (edge case — treat as missing)
  **Files**: `src/lib/__tests__/format-utils.test.ts`
  **Acceptance**: `npm run test -- src/lib/__tests__/format-utils.test.ts` passes, all new tests green.

- [ ] 3. **Render timestamp in MessageItem metadata row**
  **What**: In the `MessageItem` component, add the timestamp as the **last item** in the metadata row (after cost, before the row ends), pushed to the right with `ml-auto`. This keeps it visually distinct from the left-aligned identity/model/duration cluster.
  - Import `formatTimestamp` from `@/lib/format-utils`
  - Compute: `const timeStr = message.createdAt ? formatTimestamp(message.createdAt) : "";`
  - Render (after the cost `<span>`, still inside the `flex items-center gap-2 flex-wrap` div):
    ```tsx
    {timeStr && (
      <span className="text-[10px] text-muted-foreground ml-auto">
        {timeStr}
      </span>
    )}
    ```
  - This applies to **both** user and assistant messages since the timestamp span is outside the `isUser` conditional branches.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Acceptance**: Timestamps visible on all messages in the UI. Style matches existing metadata text (10px, muted-foreground).

  Updated metadata row structure:
  ```
  Icon (User/Bot)
  ├── "You" OR "▣ AgentName"
  ├── · modelID (assistant only)
  ├── · duration (assistant only)
  ├── $cost (if > 0)
  └── [ml-auto] 2:34 PM
  ```

- [ ] 4. **Delete stale analysis files**
  **What**: Remove the two files created by a previous agent that are no longer needed.
  **Files**:
  - `TIMESTAMPS_ANALYSIS.md` (project root)
  - `TIMESTAMPS_QUICK_START.md` (project root)
  **Acceptance**: Files no longer exist in the repository.

## Verification
- [ ] All existing tests still pass (`npm run test`)
- [ ] New `formatTimestamp` tests pass
- [ ] `npm run build` succeeds
- [ ] Visually confirm timestamps appear on messages in the UI
- [ ] No regressions in message rendering (tool calls, markdown, agent colors still work)
