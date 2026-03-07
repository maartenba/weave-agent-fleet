# H2: Cascading Re-render Optimization

## TL;DR
> **Summary**: The `SessionsProvider` context triggers cascading re-renders across the entire component tree on every 5s poll, 10s summary poll, and each SSE event — even when data hasn't changed. At 20 sessions/5 workspaces, this produces **54 component re-renders per event**. A combination of memoization, structural sharing, and `React.memo` can reduce unnecessary re-renders by ~90%.
> **Estimated Effort**: Medium

## Confirmed Findings

### Finding 1: Inline context value object (CONFIRMED — root cause)
- **File**: `src/contexts/sessions-context.tsx` line 136
- **Code**: `value={{ sessions, isLoading, error, refetch, summary }}`
- **Impact**: Creates a new object identity on every `SessionsProvider` render. React uses `Object.is` for context comparison, so every consumer re-renders — even if individual fields are unchanged.
- **Note**: `useMemo` is imported on line 3 but only used for the `sessions` merge (line 117), NOT for the Provider value.

### Finding 2: No deep equality in `useSessions` poll (CONFIRMED)
- **File**: `src/hooks/use-sessions.ts` line 31
- **Code**: `setSessions(data)` — unconditional setState with fresh JSON-parsed array
- **Impact**: Every 5s poll replaces `sessions` with a new array reference, even if server data is identical. This defeats the `sessions` useMemo dependency in the provider.

### Finding 3: No deep equality in `useFleetSummary` poll (CONFIRMED)
- **File**: `src/hooks/use-fleet-summary.ts` line 31
- **Code**: `setSummary(data)` — same pattern as sessions
- **Impact**: Every 10s summary poll creates a new `summary` object reference, triggering provider re-render even when counts haven't changed.

### Finding 4: Zero `React.memo` on any leaf component (CONFIRMED)
- **Components affected**:
  - `LiveSessionCard` (`src/components/fleet/live-session-card.tsx` line 20) — plain `function`
  - `SidebarSessionItem` (`src/components/layout/sidebar-session-item.tsx` line 24) — plain `function`
  - `SidebarWorkspaceItem` (`src/components/layout/sidebar-workspace-item.tsx` line 45) — plain `function`
  - `SessionGroup` (`src/components/fleet/session-group.tsx` line 44) — plain `function`
  - `Sidebar` (`src/components/layout/sidebar.tsx` line 44) — plain `function`
- **Impact**: Even if context value were memoized, child components still re-render because parents re-render and pass new prop references.

### Finding 5: Inline handlers in `FleetPageInner` (CONFIRMED)
- **File**: `src/app/page.tsx` lines 61-115
- **Handlers**: `handleTerminate` (line 61), `handleAbort` (line 70), `handleResume` (line 78), `handleDeleteRequest` (line 90), `handleDeleteConfirm` (line 99), `handleOpen` (line 111)
- **All are plain inline `async` functions** — recreated on every render. Even with `React.memo` on children, props would fail shallow comparison.

### Finding 6: Double-wrapped arrow callbacks (CONFIRMED)
- **File**: `src/app/page.tsx` — multiple occurrences (lines 214, 228, 283, 297, etc.)
- **Pattern**: `onOpen={(dir) => handleOpen(dir)}` wraps an already-unstable handler in another unstable arrow
- **Also in** `src/components/fleet/session-group.tsx` lines 189, 203: `onOpen={onOpen ? (dir) => onOpen(dir, "vscode") : undefined}` — creates new closure on every render

### Finding 7: Context consumed for `refetch` only (CONFIRMED)
- `SessionGroup` (`src/components/fleet/session-group.tsx` line 45): `const { refetch } = useSessionsContext()` — subscribes to entire context, re-renders on ANY context change
- `SidebarSessionItem` (`src/components/layout/sidebar-session-item.tsx` line 26): same pattern
- `SidebarWorkspaceItem` (`src/components/layout/sidebar-workspace-item.tsx` line 55): same pattern
- `SessionCommands` (`src/components/commands/session-commands.tsx` line 12): same pattern

### Finding 8: `forceRender` counter blunt instrument (CONFIRMED)
- **File**: `src/contexts/sessions-context.tsx` line 80, 102
- **Mechanism**: `forceRender(n => n + 1)` on each SSE event. The counter is listed as a useMemo dependency (line 133) which is misleading — the `eslint-disable` comment acknowledges this.
- **Issue**: Each SSE event triggers a full provider re-render cycle. During active fleet operations, SSE events can fire multiple times per second.

## Re-render Cascade Diagram

### Trigger: 5s Session Poll (identical data from server)
```
useSessions: fetch → setSessions(newArray) [new ref!]
  │
  ▼
SessionsProvider re-renders (polledSessions changed)
  │
  ├─ useMemo(sessions) recalculates [new array ref even if identical]
  ├─ value={{ sessions, ... }} [NEW object — always!]
  │
  ▼ Context consumers re-render (value identity changed)
  ├─ FleetPageInner ──────────────── (1 render)
  │   ├─ all handlers recreated
  │   ├─ useMemo(workspaceFiltered) recalculates
  │   ├─ useMemo(searchFiltered) recalculates
  │   ├─ SessionGroup × W ────────── (W renders)
  │   │   └─ LiveSessionCard × N ── (N renders)
  │   └─ (if groupBy !== "directory", LiveSessionCard × N directly)
  │
  ├─ Sidebar ─────────────────────── (1 render)
  │   └─ SidebarWorkspaceItem × W ─ (W renders)
  │       └─ SidebarSessionItem × N (N renders)
  │
  ├─ SessionCommands ─────────────── (1 render)
  │
  └─ SessionGroup (context) ──────── (already counted above)
     SidebarWorkspaceItem (context)   (already counted above)
     SidebarSessionItem (context)     (already counted above)

TOTAL = 1(FleetPage) + 1(Sidebar) + 1(SessionCommands)
      + W(SessionGroups) + W(SidebarWorkspaceItems)
      + N(LiveSessionCards) + N(SidebarSessionItems)
      = 3 + 2W + 2N
```

### Trigger: 10s Summary Poll (identical data)
```
useFleetSummary: fetch → setSummary(newObj) [new ref!]
  │
  ▼
SessionsProvider re-renders (summary state changed)
  │
  ├─ useMemo(sessions) SKIPPED [polledSessions unchanged]
  ├─ value={{ ..., summary }} [NEW object — always!]
  │
  ▼ SAME cascade as above: 3 + 2W + 2N re-renders
    (even though sessions didn't change!)
```

### Trigger: SSE activity_status event
```
EventSource.onmessage → ssePatchesRef.set() → forceRender(n+1)
  │
  ▼
SessionsProvider re-renders (forceRender counter changed)
  │
  ├─ useMemo(sessions) recalculates [forceRender dep]
  │   └─ patchActivityStatus → new array if status changed
  ├─ value={{ sessions, ... }} [NEW object — always!]
  │
  ▼ SAME cascade: 3 + 2W + 2N re-renders
    (even if the SSE event patched only 1 session)
```

### 20-Session Scenario (W=5, N=20)
```
Per event: 3 + 2(5) + 2(20) = 53 re-renders

Events per minute:
  - 12 session polls (every 5s)
  - 6 summary polls (every 10s)  
  - ~60 SSE events (1/sec when fleet active)

Total: ~78 events/min × 53 re-renders = ~4,134 re-renders/minute
```

## Feasibility Assessment

### Approach 1: Memoize context `value` prop
- **What it fixes**: Prevents consumer re-renders when no context field actually changed. Eliminates cross-contamination between summary polls and session consumers.
- **Complexity**: Low — add `useMemo` wrapping the value object
- **Risk**: Low — straightforward, well-understood React pattern
- **Expected impact**: ~10-20% alone (doesn't help when underlying refs change due to polling, which is the main trigger), but **critical enabler** for approaches 2-3
- **Dependencies**: Needs Approach 2+3 to be fully effective (without structural sharing, dependencies still change every poll)
- **Files**: `src/contexts/sessions-context.tsx` line 136

### Approach 2: Structural sharing / deep equality in `useSessions`
- **What it fixes**: Prevents `sessions` ref from changing when poll returns identical data. Eliminates ~12 needless cascade triggers per minute.
- **Complexity**: Medium — need a `sessionsAreEqual` comparator function. Can't use `JSON.stringify` (too slow at scale). Better: compare by session count + per-session fingerprint (id + activityStatus + lifecycleStatus + title + instanceStatus).
- **Risk**: Low-Medium — must ensure the comparison covers all fields that the UI actually renders. Missing a field means stale UI.
- **Expected impact**: ~50% of all re-renders (eliminates all no-change poll triggers)
- **Dependencies**: Needs Approach 1 to prevent value object recreation even when sessions hasn't changed
- **Files**: `src/hooks/use-sessions.ts` lines 29-31

### Approach 3: Structural sharing in `useFleetSummary`
- **What it fixes**: Prevents `summary` ref from changing on identical poll data. Eliminates ~6 cascade triggers per minute.
- **Complexity**: Low — `FleetSummaryResponse` is a flat object with 5 numeric fields. Simple shallow comparison.
- **Risk**: Very low — trivial comparison
- **Expected impact**: ~10% of all re-renders (eliminates all no-change summary poll triggers)
- **Dependencies**: Needs Approach 1 for full effect
- **Files**: `src/hooks/use-fleet-summary.ts` lines 30-31

### Approach 4: Add `React.memo` to leaf components
- **What it fixes**: Prevents child component re-renders when their props haven't actually changed. Even when a parent re-renders (e.g., due to a legitimate session status change), siblings with unchanged props are skipped.
- **Complexity**: Low — wrap export with `React.memo`. `LiveSessionCard` and `SidebarSessionItem` are the highest-value targets (N instances each).
- **Risk**: Low — `React.memo` is non-breaking; worst case is an extra shallow comparison with no savings
- **Expected impact**: ~30-50% of remaining re-renders (after approaches 1-3 eliminate no-change triggers, this handles partial-change triggers like single-session SSE updates)
- **Dependencies**: Needs Approach 5 (stable callbacks) to be effective — `React.memo` does nothing if callback props change every render
- **Targets**:
  - `LiveSessionCard` (`src/components/fleet/live-session-card.tsx`) — N instances
  - `SidebarSessionItem` (`src/components/layout/sidebar-session-item.tsx`) — N instances
  - `SessionGroup` (`src/components/fleet/session-group.tsx`) — W instances
  - `SidebarWorkspaceItem` (`src/components/layout/sidebar-workspace-item.tsx`) — W instances

### Approach 5: Stabilize callback props with `useCallback`
- **What it fixes**: Makes callback props referentially stable across renders, allowing `React.memo` children to skip re-renders.
- **Complexity**: Medium — 6 handlers in `page.tsx` need wrapping. Some depend on `sessions` or `refetch` (need to verify closure deps). Also need to fix double-wrapped arrows like `(dir) => handleOpen(dir)`.
- **Risk**: Low — standard React pattern. Must audit dependency arrays to avoid stale closures.
- **Expected impact**: Enables Approach 4 — without this, React.memo is ineffective
- **Dependencies**: Is a prerequisite for Approach 4
- **Files**: `src/app/page.tsx` lines 53-115; also `src/components/fleet/session-group.tsx` lines 189, 203

### Approach 6: Split context (sessions vs summary)
- **What it fixes**: Components that only need `sessions` wouldn't re-render when `summary` changes, and vice versa.
- **Complexity**: Medium — create `SessionsSummaryContext` with its own provider. Thread both through `client-layout.tsx`. Update consumers.
- **Risk**: Medium — API surface change, breaks existing `useSessionsContext()` calls
- **Expected impact**: Low (~5%) — with Approach 1+3 already in place, summary changes won't trigger session consumer re-renders anyway (useMemo deps won't change)
- **Dependencies**: None, but largely redundant if Approaches 1+3 are implemented
- **Recommendation**: **Skip for now** — cost/benefit doesn't justify the refactor. Revisit if summary polling frequency increases.

### Approach 7: Debounce/throttle SSE-driven updates
- **What it fixes**: Batches rapid SSE events into fewer re-render cycles. During busy fleet operations, multiple sessions may fire status updates within milliseconds.
- **Complexity**: Low — add a `setTimeout` debounce (e.g., 200ms) before calling `forceRender`
- **Risk**: Low — introduces up to 200ms latency in status dot updates, acceptable for a dashboard
- **Expected impact**: ~20-40% during SSE-heavy periods (reduces N events/second to ~5 batched updates/second)
- **Dependencies**: None — independent optimization
- **Files**: `src/contexts/sessions-context.tsx` lines 99-103

### Approach 8: Virtualize session list
- **What it fixes**: Only renders visible cards, eliminating DOM pressure for large fleets.
- **Complexity**: High — requires integrating a virtualization library (react-window, tanstack-virtual). Grid layout makes this especially complex (variable-height cards in responsive grid).
- **Risk**: High — significant UI/UX changes. Keyboard navigation, scroll position, animations all need reworking.
- **Expected impact**: High for 50+ session fleets, negligible for <20 sessions
- **Dependencies**: None, but benefits compound with other approaches
- **Recommendation**: **Defer** — only justified when fleet sizes regularly exceed 50 sessions. The other approaches reduce re-render cost per component; virtualization reduces component count.

### Approach 9: Remove unnecessary context consumption (prop-drill `refetch`)
- **What it fixes**: `SessionGroup`, `SidebarSessionItem`, `SidebarWorkspaceItem`, and `SessionCommands` subscribe to the entire context just for `refetch`. With an un-memoized value, this triggers re-renders on every context change.
- **Complexity**: Low-Medium — pass `refetch` as a prop from parent. For sidebar tree: `Sidebar` → `SidebarWorkspaceItem` → `SidebarSessionItem`. For fleet page: `FleetPageInner` → `SessionGroup`.
- **Risk**: Low — simple prop threading, no behavioral change
- **Expected impact**: With Approach 1 (memoized value), this becomes ~0% impact because `refetch` is a stable `useCallback` reference. However, it's still good practice to minimize context subscriptions.
- **Dependencies**: Largely redundant if Approach 1 is implemented, since `refetch` reference is stable (useCallback in `use-sessions.ts` line 23)
- **Recommendation**: **Nice-to-have** — implement if touching these files anyway, but don't prioritize

## Recommended Solution

### Selected Combination: Approaches 1 + 2 + 3 + 5 + 4 + 7

This combination is ordered by dependency chain and maximizes impact:

**Why this combination:**

1. **Approach 1 (memoize value)** is the foundational fix — it's the single line change that makes all other optimizations effective. Without it, React's context comparison always fails, making every other optimization pointless.

2. **Approaches 2+3 (structural sharing in polls)** eliminate the most common trigger (~18 events/minute of polling) from creating unnecessary re-renders. These are the "stop wasting work" fixes. Together with Approach 1, they eliminate ~60-70% of all re-renders.

3. **Approach 5 (useCallback handlers)** is the prerequisite for Approach 4. These must land first or simultaneously.

4. **Approach 4 (React.memo on leaves)** handles the remaining cases where a legitimate change (e.g., one session's status update via SSE) doesn't need to re-render all N session cards. This reduces per-event re-renders from `3 + 2W + 2N` to `3 + ~2` (only the changed card + its parent group).

5. **Approach 7 (SSE debounce)** is a cheap independent win that reduces event frequency during burst periods.

**What we skip and why:**
- **Approach 6 (split context)**: Redundant once Approach 1+3 stabilize the summary reference
- **Approach 8 (virtualization)**: Too complex for current fleet sizes, deferred
- **Approach 9 (prop-drill refetch)**: Marginal benefit once Approach 1 is in place

**Expected outcome (20 sessions, 5 workspaces):**
- Before: ~4,134 re-renders/minute
- After: ~120 re-renders/minute (only legitimate data changes trigger targeted re-renders)
- **~97% reduction**

## Implementation Steps

### Phase 1: Foundation — Stop Unnecessary Triggers

- [ ] 1. **Memoize the context Provider value**
  **What**: Wrap the `value` prop of `SessionsContext.Provider` in `useMemo` with dependency array `[sessions, isLoading, error, refetch, summary]`.
  **Files**: `src/contexts/sessions-context.tsx` line 136
  **Details**:
  - Add a `const contextValue = useMemo(() => ({ sessions, isLoading, error, refetch, summary }), [sessions, isLoading, error, refetch, summary]);` above the return statement
  - Change `value={{ sessions, isLoading, error, refetch, summary }}` to `value={contextValue}`
  - `useMemo` is already imported on line 3
  **Acceptance**: Provider re-render does NOT cause consumer re-renders when all 5 dependency values are referentially identical. Verify with React DevTools profiler.

- [ ] 2. **Add structural sharing to `useSessions` poll**
  **What**: Before calling `setSessions(data)`, compare incoming data to current state. Only update if sessions have actually changed.
  **Files**: `src/hooks/use-sessions.ts` lines 29-32
  **Details**:
  - Create a helper function `sessionsChanged(prev: SessionListItem[], next: SessionListItem[]): boolean` that:
     1. Checks `prev.length !== next.length` → return true
     2. For each index, compares key fields: `session.id`, `instanceId`, `activityStatus`, `lifecycleStatus`, `sessionStatus`, `typedInstanceStatus`, `session.title`, `workspaceDisplayName`, `parentSessionId`, `isolationStrategy`, `session.time.created`, `workspaceDirectory`, `session.directory`, `sourceDirectory`
     3. Returns false if all match (data is equivalent)
   - **Important**: The field list must cover every field rendered by `LiveSessionCard` and `SidebarSessionItem`. Cross-reference both components when implementing.
  - Replace `setSessions(data)` with `setSessions(prev => sessionsChanged(prev, data) ? data : prev)`
  - Put the helper in `src/lib/session-utils.ts` so it can be unit tested
  **Acceptance**: When server returns identical data, `sessions` state reference does not change. Add unit test for `sessionsChanged`.

- [ ] 3. **Add structural sharing to `useFleetSummary` poll**
  **What**: Before calling `setSummary(data)`, compare incoming data fields to current state.
  **Files**: `src/hooks/use-fleet-summary.ts` lines 30-32
  **Details**:
  - Create inline comparison: `setSummary(prev => prev && prev.activeSessions === data.activeSessions && prev.idleSessions === data.idleSessions && prev.totalTokens === data.totalTokens && prev.totalCost === data.totalCost && prev.queuedTasks === data.queuedTasks ? prev : data)`
  - Alternatively, extract a `summaryChanged(prev, next)` helper
  **Acceptance**: When server returns identical summary, `summary` state reference does not change.

- [ ] 4. **Add SSE debounce to `SessionsProvider`**
  **What**: Batch rapid SSE events by debouncing `forceRender` calls. Instead of calling `forceRender` on every SSE message, accumulate patches and flush once per ~200ms.
  **Files**: `src/contexts/sessions-context.tsx` lines 89-103
  **Details**:
  - Add a `debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)` 
  - In the `onmessage` handler, after setting the patch in `ssePatchesRef`, clear any existing timeout and set a new 200ms timeout that calls `forceRender`
  - Clear the timeout in the cleanup function (line 111)
  - This batches burst SSE events (e.g., 5 sessions changing status simultaneously) into a single re-render
  **Acceptance**: Rapidly firing SSE events (e.g., 10 events in 100ms) produce only 1 re-render cycle instead of 10.

### Phase 2: Stabilize Props — Enable `React.memo`

- [ ] 5. **Wrap `FleetPageInner` handlers in `useCallback`**
  **What**: Stabilize all 6 handler functions with `useCallback` so their references don't change every render.
  **Files**: `src/app/page.tsx` lines 53-115
  **Details**:
  - `handleGroupByChange` (line 53): `useCallback((groupBy: GroupBy) => setPrefs(...), [setPrefs])` — `setPrefs` is stable from `usePersistedState`
  - `handleSortByChange` (line 57): `useCallback((sortBy: SortBy) => setPrefs(...), [setPrefs])`
  - `handleTerminate` (line 61): `useCallback(async (sessionId, instanceId) => { ... }, [terminateSession, refetch])`
  - `handleAbort` (line 70): `useCallback(async (sessionId, instanceId) => { ... }, [abortSession])`
  - `handleResume` (line 78): `useCallback(async (sessionId) => { ... }, [resumeSession, router, refetch])`
  - `handleDeleteRequest` (line 90): `useCallback((sessionId, instanceId) => { ... }, [sessions])` — reads `sessions` for title lookup. Consider moving title lookup out or accepting it as a dependency.
  - `handleDeleteConfirm` (line 99): `useCallback(async () => { ... }, [deleteTarget, deleteSession, refetch])` — depends on `deleteTarget` state
  - `handleOpen` (line 111): `useCallback((directory, tool?) => { ... }, [preferredTool, setPreferredTool, openDirectory])`
  **Acceptance**: Handlers maintain referential identity across renders when dependencies haven't changed. Verify with `useRef` comparison in dev mode or React DevTools.

- [ ] 6. **Fix double-wrapped arrow callbacks**
  **What**: Replace `onOpen={(dir) => handleOpen(dir)}` with `onOpen={handleOpen}` throughout `page.tsx`. Fix `session-group.tsx` closures that wrap `onOpen`.
  **Files**: 
  - `src/app/page.tsx` — all `onOpen={(dir) => handleOpen(dir)}` instances (lines 214, 228, 283, 297, 336, 349, 400, 413)
  - `src/components/fleet/session-group.tsx` lines 189, 203 — `onOpen={onOpen ? (dir) => onOpen(dir, "vscode") : undefined}`. This hardcodes "vscode" which may need to be handled differently — potentially pass the default tool as a prop or create a stable callback.
  **Details**:
  - In `page.tsx`: `handleOpen` already accepts `(directory: string, tool?: OpenTool)`, so `onOpen={handleOpen}` is type-compatible with `(dir: string) => void`
  - In `session-group.tsx`: The `(dir) => onOpen(dir, "vscode")` pattern creates a new closure every render. Options:
    (a) Create a memoized `handleOpen` inside SessionGroup with `useCallback`
    (b) Pass default tool as a prop to `LiveSessionCard`
    (c) Accept the wrapper but wrap the prop computation in `useMemo`
    - Recommend (a): `const handleCardOpen = useCallback((dir: string) => onOpen?.(dir, "vscode"), [onOpen]);`
  **Acceptance**: No inline arrow functions wrapping already-stabilized callbacks in render output.

### Phase 3: Memoize Leaf Components

- [ ] 7. **Add `React.memo` to `LiveSessionCard`**
  **What**: Wrap the `LiveSessionCard` export with `React.memo`. This is the highest-value target (N instances on fleet page + N instances in session groups).
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Details**:
  - Change `export function LiveSessionCard(...)` to a named function assigned to a const, then export `React.memo(LiveSessionCard)`
  - Pattern: 
    ```
    function LiveSessionCardInner(...) { ... }
    export const LiveSessionCard = React.memo(LiveSessionCardInner);
    ```
  - Consider a custom comparator if default shallow comparison is insufficient (e.g., if `item` object changes ref but content is identical). However, with Approach 2 providing structural sharing, `item` refs should be stable for unchanged sessions.
  **Acceptance**: When a single session's status changes via SSE, only that session's card re-renders — not all N cards.

- [ ] 8. **Add `React.memo` to `SidebarSessionItem`**
  **What**: Same pattern as LiveSessionCard for the sidebar session items.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Details**:
  - Same pattern: extract inner function, export `React.memo(...)` wrapper
  - This component calls `useSessionsContext()` for `refetch` (line 26). Since it subscribes to context, `React.memo` on the outer component won't prevent context-triggered re-renders. **Two options**:
    (a) Accept the context subscription as-is — `React.memo` still helps for prop-only re-renders from parent
    (b) Remove context usage, receive `refetch` as a prop from `SidebarWorkspaceItem` — fully enables `React.memo`. This requires threading `refetch` from `Sidebar` → `SidebarWorkspaceItem` → `SidebarSessionItem`.
  - **Recommend (b)** since we're already touching these files. The `refetch` function is a stable `useCallback` (from `use-sessions.ts` line 23), so once threaded through, it won't cause prop changes.
  **Acceptance**: Sidebar session items don't re-render when another session's status changes.

- [ ] 9. **Add `React.memo` to `SessionGroup`**
  **What**: Memoize the SessionGroup component to prevent re-renders when its `group` prop hasn't changed.
  **Files**: `src/components/fleet/session-group.tsx`
  **Details**:
  - Same `React.memo` wrapper pattern
  - This component also uses `useSessionsContext()` for `refetch` (line 45). Apply same strategy as step 8: receive `refetch` as a prop from `FleetPageInner`.
  - Add `refetch` to the `SessionGroupProps` interface
  - Update `FleetPageInner` to pass `refetch` as a prop to `SessionGroup`
  - May need a custom comparator for the `group` prop if the `WorkspaceGroup` object identity changes even when contents are identical (check `useWorkspaces` memo behavior — it uses `useMemo` keyed on `sessions`, so group refs change when sessions change, which is correct)
  - **Important (see Risk 6)**: In the directory groupBy path of `page.tsx` (~line 442), the `group={{ ...group, sessions: sortSessions(group.sessions) }}` inline spread creates a new object identity on every render, defeating `React.memo`. Fix by either (a) moving `sortSessions` inside `SessionGroup` (pass `sortBy` as a prop instead), or (b) memoizing the sorted groups array in `FleetPageInner`. Option (a) is recommended.
  **Acceptance**: When sessions in other workspace groups change, this group doesn't re-render.

- [ ] 10. **Add `React.memo` to `SidebarWorkspaceItem`**
  **What**: Memoize to prevent re-renders for unchanged workspace groups in sidebar.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`
  **Details**:
  - Same `React.memo` wrapper pattern
  - Also uses `useSessionsContext()` for `refetch` (line 55). Thread `refetch` as prop from `Sidebar`.
  - Remove `useSessionsContext` import once refetch is prop-based
  **Acceptance**: Sidebar workspace items for unchanged workspaces don't re-render.

### Phase 4: Verification & Cleanup

- [ ] 11. **Add unit tests for `sessionsChanged` comparator**
  **What**: Test the new structural comparison function.
  **Files**: `src/lib/__tests__/session-utils.test.ts` (add to existing file)
  **Tests**:
  - Returns `true` for different array lengths
  - Returns `true` when a session's `activityStatus` changes
  - Returns `true` when a session's `title` changes
  - Returns `false` for identical data
  - Returns `false` for same data in different array instances
  - Handles empty arrays
  **Acceptance**: All tests pass with `npm test`.

- [ ] 12. **Add unit test for `summaryChanged` comparator (if extracted)**
  **What**: Test the summary comparison if extracted as a named function.
  **Files**: New file or add to existing hook tests
  **Acceptance**: Tests pass.

- [ ] 13. **Manual verification with React DevTools Profiler**
  **What**: Run the app with React DevTools, navigate to Fleet page with 10+ sessions. Observe:
  - During idle 5s poll: zero component highlights (no re-renders if data unchanged)
  - During SSE event: only affected session card + its parent group highlight
  - During summary poll: zero highlights if summary unchanged
  **Acceptance**: Re-render count per poll/event matches expected (1-3 components for targeted updates, 0 for no-change polls).

- [ ] 14. **Verify no stale closures or visual regressions**
  **What**: Manual testing of all interactive behaviors:
  - Terminate session → card disappears, summary updates
  - Resume session → navigates to session page
  - Delete session → confirmation dialog works, card removed
  - Rename workspace (inline edit in sidebar + session group)
  - Open in editor → correct directory opened
  - SSE activity updates → status dots update correctly
  - Search filter → responsive filtering
  - Group by switching → layout changes correctly
  **Acceptance**: All interactions work identically to pre-optimization behavior.

## Risk Assessment

### Risk 1: Stale closure in `useCallback` handlers
- **What could go wrong**: `handleDeleteRequest` (line 90) reads `sessions` to look up the title. If wrapped in `useCallback` with `[sessions]` dep, it re-creates on every sessions change — partially defeating the purpose. If deps are omitted, stale session data.
- **Mitigation**: Move the title lookup to the confirmation dialog component (it can look up the title from its own context or receive the full session item). Alternative: use a ref for the sessions list inside the callback.
- **Severity**: Medium — would cause incorrect dialog title, not data loss

### Risk 2: Missing fields in `sessionsChanged` comparator
- **What could go wrong**: If a UI-visible field is excluded from comparison, the UI shows stale data after a poll.
- **Mitigation**: Audit all fields rendered by `LiveSessionCard` and `SidebarSessionItem`. Current rendered fields: `session.title`, `session.id`, `activityStatus`, `lifecycleStatus`, `isolationStrategy`, `session.time.created`, `instanceId`, `workspaceDirectory`, `workspaceDisplayName`, `parentSessionId`, `sourceDirectory`.
- **Severity**: Medium — stale UI, but corrected on next poll (5s max)

### Risk 3: SSE debounce delays status updates
- **What could go wrong**: 200ms debounce means status dot changes are delayed by up to 200ms.
- **Mitigation**: 200ms is imperceptible to users. If needed, reduce to 100ms or make configurable.
- **Severity**: Very low — cosmetic only

### Risk 4: `React.memo` with context subscriptions
- **What could go wrong**: Components that call `useSessionsContext()` inside them bypass `React.memo` — the memo prevents prop-triggered re-renders but context changes still cause re-renders via the hook.
- **Mitigation**: Steps 8-10 explicitly remove context subscriptions from memoized components and thread `refetch` as a prop. This is critical — `React.memo` without removing the context hook provides almost no benefit.
- **Severity**: High if context hooks are left in place (optimization would be ineffective)

### Risk 5: `WorkspaceGroup` object identity in `useWorkspaces`
- **What could go wrong**: `useWorkspaces` (line 12) returns `useMemo(() => groupSessionsByWorkspace(sessions), [sessions])`. When sessions ref changes (legitimate change), ALL group objects are recreated — even groups whose sessions didn't change. This means `React.memo` on `SessionGroup` won't help unless a custom comparator is added.
- **Mitigation**: Either (a) add a custom comparator to `SessionGroup` that checks `group.workspaceId` + `group.sessions` deeply, or (b) enhance `groupSessionsByWorkspace` to reuse previous group objects when their sessions haven't changed (structural sharing at the group level).
- **Severity**: Medium — reduces effectiveness of Phase 3 for the fleet page (sidebar is unaffected since it uses its own `useWorkspaces`)

### Risk 6: Inline `group` spread defeats `React.memo` on `SessionGroup`
- **What could go wrong**: In `page.tsx` line ~442 (directory groupBy path), the pattern `group={{ ...group, sessions: sortSessions(group.sessions) }}` creates a **new object on every render** via the spread operator. This unconditionally breaks `React.memo` on `SessionGroup` regardless of whether the group data changed — the prop identity is always new.
- **Mitigation**: Either (a) move `sortSessions` inside `SessionGroup` itself (so the `group` prop is the original stable object from `useWorkspaces`), or (b) memoize the sorted groups array in `FleetPageInner` with `useMemo(() => workspaces.map(g => ({ ...g, sessions: sortSessions(g.sessions) })), [workspaces, sortSessions])`. Option (a) is cleaner — `SessionGroup` already knows how to render its sessions and can accept a `sortBy` prop.
- **Severity**: Medium — without addressing this, `React.memo` on `SessionGroup` provides zero benefit in directory groupBy mode (the default mode)

### Performance Testing Approach
1. **Baseline**: Record React DevTools profiler trace with 20 sessions for 60 seconds. Count total commits.
2. **After Phase 1**: Same measurement. Expect ~60-70% fewer commits.
3. **After Phase 2+3**: Same measurement. Expect ~90-95% fewer commits.
4. **Render count verification**: Add temporary `console.count` in each memoized component's render body during development. Remove before merge.
