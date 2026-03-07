# Unified Performance Analysis: Cross-Reference & Reconciliation

## TL;DR
> **Summary**: The broad performance audit (Source A) identified 13 issues. The four hypothesis-driven investigations (H1–H4) cover 12 of these 13 issues with deeper analysis, confirming most assessments while adding significant nuance — including 6 findings not present in Source A. One Source A issue (Issue 5: fleet summary loads all sessions) has no H-plan coverage. There are no critical conflicts between the two analyses; the H-plans generally agree with Source A's direction but refine severity, propose more sophisticated solutions, and uncover correctness bugs (e.g., the broken `forceRender` pattern). Coverage is sufficient to proceed with execution.

---

## 1. Issue Mapping Table

| # | Source A Issue | Sev (A) | H-Plan | H-Plan Finding/Approach | Agreement | Severity Diff |
|---|---------------|---------|--------|------------------------|-----------|---------------|
| 1 | Duplicate SSE Connections to `/api/notifications/stream` | Critical | **H4** Finding 1, Finding 9 | H4 confirms 2 independent `EventSource` connections. Proposes shared `useGlobalSSE` hook (Phase 2, Tasks 4-6). | **Agrees** | H4 rates as "High impact" — effectively same as Critical. No disagreement. |
| 2 | Sessions API N+M Network Calls | Critical | **H1** Finding 1.1 (Phase 1 & 2) | H1 confirms the two-phase SDK call pattern. Nuance: Phase 1 (`session.status()`) is already parallelized via `Promise.allSettled` and is O(M) not O(N). Phase 2 (`session.get()`) is sequential and is the real bottleneck. H1 proposes parallelizing Phase 2 and eventually eliminating Phase 1 by trusting the `session-status-watcher`. | **Agrees with nuance** | Both rate Critical. H1 adds that Phase 1 is "reasonable" as-is, shifting urgency to Phase 2's sequential nature — Source A proposed eliminating Phase 2 entirely, H1 proposes parallelizing first, then eliminating Phase 1 later. |
| 3 | Sessions Polling Without Change Detection | High | **H2** Finding 2; **H1** §1.2 | H2 confirms unconditional `setSessions(data)` on every poll (line 31). Proposes structural sharing with a field-by-field comparator (`sessionsChanged()`). H1 confirms the fixed 5s interval and adds request-stacking risk. | **Agrees** | Both rate High. H2 adds precise re-render quantification: 53 component re-renders per trigger event. |
| 4 | Fleet Summary Polling Without Change Detection | Medium | **H2** Finding 3; **H1** §1.3 | H2 confirms `setSummary(data)` unconditional setState. Proposes shallow field comparison (5 numeric fields). H1 notes the fleet summary poll is DB-only (10s, no SDK calls) and says "Not a concern" for latency — but H2 correctly identifies the re-render cascade it triggers. | **Agrees with nuance** | Source A: Medium. H1 downgrades concern ("Not a concern"). H2 confirms Medium — the polling itself is cheap but the re-render cascade is not. **H2's framing is more accurate**: the cost is React-side, not network-side. |
| 5 | Fleet Summary Loads All Sessions Into Memory | Medium | **None** | No H-plan covers this. H1 §1.3 mentions the fleet summary poll but only addresses its interval/network aspect, not the `listSessions()` → count pattern on the server side. | **Not covered** | — |
| 6 | Per-Instance `RelativeTimestamp` Timers | Medium | **H3** (entire plan) | H3 is entirely dedicated to this issue. Confirms per-instance `setInterval(30_000)`. Adds nuance: the problem is scoped to session detail pages only (fleet cards use static `timeSince()`, not `RelativeTimestamp`). Proposes `useSyncExternalStore` singleton with age-adaptive skipping. | **Agrees with nuance** | Source A: Medium. H3 agrees on severity but narrows the scope — fleet pages are unaffected. H3 also discovers the **3 duplicated `timeSince()` functions** (a new issue not in Source A). |
| 7 | Missing `React.memo` on Sidebar List Items | High | **H2** Finding 4, Approaches 4-5, Steps 7-10 | H2 confirms zero `React.memo` on leaf components. Expands the affected component list beyond Source A's two items to include `LiveSessionCard`, `SessionGroup`, and `Sidebar`. Adds critical prerequisite: `useCallback` on handler props (Approach 5) must land first, otherwise `React.memo` is ineffective. Also identifies that components consuming context for `refetch` bypass `React.memo` entirely (Risk 4). | **Agrees, adds critical nuance** | Both rate High. H2 reveals that `React.memo` alone is **insufficient** without callback stabilization and context subscription removal — a subtlety Source A missed. |
| 8 | Messages API Fetches ALL Then Slices | High | **H4** Finding 7 | H4 identifies unbounded message growth in `useSessionEvents` (client-side). The server-side "fetch all then slice" issue from Source A is complementary — Source A covers the API route, H4 covers the client hook. H4 proposes capping at 500 messages with eviction. | **Agrees (complementary angles)** | Both rate High. Source A focuses on server memory; H4 focuses on client memory. Both are valid — the problem exists on both sides. |
| 9 | Sequential Health Checks in Process Manager | Medium | **None directly**, but H1 Approach A is analogous | No H-plan targets health checks specifically. H1's parallelization approach for `session.get()` uses the same `Promise.allSettled` pattern Source A proposes for health checks — the technique is validated but the specific file isn't addressed. | **Not directly covered** | Source A's fix is straightforward and standalone. No H-plan needed — the pattern is well-understood. |
| 10 | Duplicate Event Subscriptions Per Instance | High | **H4** Finding 1 (partial) | H4 covers the client-side duplicate SSE (2 `EventSource` to same endpoint) but does **not** address the server-side triple subscription issue (session-status-watcher + callback-monitor + events route each calling `client.event.subscribe()`). Source A's Issue 10 is about server-side SDK subscriptions; H4's Finding 1 is about client-side browser connections. | **Partially covered** | Source A: High. H4 addresses the client half. The server-side subscription consolidation (shared event subscription manager) is not covered by any H-plan. |
| 11 | Session Detail Page Fetches All Messages on Reconnect | High | **H4** Finding 7, Finding 8 | H4 documents that `useSessionEvents` has reconnection logic (exponential backoff) and that `loadAllMessages` is called on reconnect. H4's message capping (Phase 3, Task 7) partially mitigates this by limiting the in-memory array, but doesn't address the incremental fetch (only loading messages since last known). | **Partially covered** | Both rate High. H4 addresses the symptom (cap messages) but not the root cause (full re-fetch on reconnect). Source A's `since` parameter proposal remains unaddressed. |
| 12 | EventEmitter Listener Leak Potential | Medium | **H4** Finding 6 (tangential) | H4 investigated NotificationsProvider reconnection and found it correctly handles cleanup (Finding 6). H4 does not specifically audit the `NotificationEmitter` max listeners cap or orphaned listener cleanup. | **Not directly covered** | Source A: Medium. H4 confirmed that the NotificationsProvider cleanup is correct, which partially addresses the concern, but the broader listener monitoring/sweep proposal is not covered. |
| 13 | Callback Monitor 10s Polling Loop | Low-Medium | **H1** §1.5 (tangential) | H1 notes that the session-status-watcher already keeps DB status up-to-date in real-time, making redundant polling (including callback-monitor's) unnecessary. H1 proposes trusting the watcher (Approach C), which would obsolete the callback monitor's polling fallback. | **Indirectly covered** | Source A: Low-Medium. H1 doesn't specifically target callback-monitor but its Approach C (trust the watcher) addresses the same category of redundant polling. |

---

## 2. Issues Found Only in Source A (Gaps in H-Plans)

### Gap 1: Issue 5 — Fleet Summary Loads All Sessions Into Memory
- **Summary**: `GET /api/fleet/summary` calls `listSessions()` loading ALL session rows into memory just to count active vs idle. Should use SQL `COUNT(*) GROUP BY status`.
- **Assessment**: **Genuine gap, but low priority**. This is a straightforward DB optimization (`Short` effort). It doesn't interact with any H-plan and can be executed independently. It's not a blocker for any other work. The H-plans correctly focused on higher-impact issues. No new plan needed — the fix is well-defined in Source A.

### Gap 2: Issue 9 — Sequential Health Checks (partially)
- **Summary**: Health check loop uses sequential `for...of` with `await`. Should use `Promise.allSettled`.
- **Assessment**: **Intentionally excluded** — this is a standalone `Quick` fix with no architectural implications. The pattern (`Promise.allSettled`) is already used and validated elsewhere in the codebase. Can be picked up as a standalone task without a dedicated plan.

### Gap 3: Issue 10 — Server-Side Duplicate Event Subscriptions (partially)
- **Summary**: Three subsystems (`session-status-watcher`, `callback-monitor`, `events/route`) each call `client.event.subscribe()` per instance, creating 3 event stream connections per instance on the server side.
- **Assessment**: **Genuine gap that may need a new plan**. H4 only addresses the client-side duplicate (2 browser EventSource connections). The server-side triple subscription consolidation is an architectural change (shared event subscription manager) that touches 3 files and requires careful event routing. This is Medium effort and warrants its own plan if pursued. However, it's lower priority than the client-side issues because server-side subscriptions are per-instance (not per-session), so the total count scales with instances (typically 5–20), not sessions.

### Gap 4: Issue 12 — EventEmitter Listener Leak Potential
- **Summary**: `NotificationEmitter` has `maxListeners = 100`. Listeners may not be reliably cleaned up on abrupt disconnects.
- **Assessment**: **Partially addressed by H4** (confirmed cleanup is correct in NotificationsProvider). The remaining concern (monitoring, periodic sweep, max listener cap) is a hardening task. Low urgency — only manifests with 50+ concurrent SSE connections, which is uncommon in typical usage. Can be addressed as part of Phase 4 (hardening) without a dedicated plan.

---

## 3. Issues Found Only in Source B (Gaps in Performance Analysis)

### H2 Finding 1: Inline Context Value Object (Root Cause of Re-Render Cascades)
- **Source**: H2, Finding 1 — `sessions-context.tsx` line 136
- **Summary**: The `value={{ sessions, isLoading, error, refetch, summary }}` prop creates a new object identity on every render. Since React uses `Object.is` for context comparison, ALL context consumers re-render on every `SessionsProvider` render — even when no field actually changed. `useMemo` is imported but not used for the value prop.
- **Significance**: **Critical**. This is the foundational cause of the re-render cascade. Source A identified symptoms (Issues 3, 4, 7) but missed this root cause. H2 correctly identifies that `React.memo` on children (Issue 7) is nearly useless without first memoizing the context value. **This should be the #1 fix in any execution order.**

### H2 Finding 5: Inline Handler Functions in `FleetPageInner`
- **Source**: H2, Finding 5 — `src/app/page.tsx` lines 61-115
- **Summary**: Six handler functions (`handleTerminate`, `handleAbort`, `handleResume`, `handleDeleteRequest`, `handleDeleteConfirm`, `handleOpen`) are plain inline `async` functions recreated on every render. Combined with Finding 6 (double-wrapped arrow callbacks), this defeats `React.memo` on child components.
- **Significance**: **High**. Without stabilizing these callbacks via `useCallback`, adding `React.memo` to `LiveSessionCard` and `SessionGroup` (Source A Issue 7) provides zero benefit. Source A's Issue 7 fix is incomplete without this prerequisite.

### H2 Finding 7: Context Consumed for `refetch` Only
- **Source**: H2, Finding 7 — multiple components
- **Summary**: `SessionGroup`, `SidebarSessionItem`, `SidebarWorkspaceItem`, and `SessionCommands` all call `useSessionsContext()` just to access `refetch`. This subscribes them to the entire context, causing re-renders on any context change — bypassing `React.memo` from the inside.
- **Significance**: **Medium-High**. A subtlety: `React.memo` prevents re-renders from prop changes, but a context subscription inside the component triggers re-renders regardless. The fix is to thread `refetch` as a prop instead of using the context hook. Source A's Issue 7 proposal would be ineffective for these components without this change.

### H4 Finding 2: `forceRender` Pattern is Broken
- **Source**: H4, Finding 2 — `sessions-context.tsx` lines 80, 102, 133
- **Summary**: The `useMemo` depends on `forceRender` (the **setter function**, not the counter value). The setter has a stable identity, so the dependency array never changes from SSE events. It only works by accident because `setState` triggers a re-render and `useMemo` re-runs during that render. Future React Compiler optimizations could break this.
- **Significance**: **Medium (correctness bug)**. Not a performance issue today, but a latent bug that could cause SSE updates to silently stop working with future React versions. Source A didn't identify this. The fix is trivial: expose the counter value and put it in the dependency array.

### H4 Finding 5: No Reconnection Logic in `SessionsProvider` SSE
- **Source**: H4, Finding 5 — `sessions-context.tsx` lines 84-113
- **Summary**: `SessionsProvider`'s EventSource has no `onerror` handler and no reconnection logic. If the SSE connection drops, real-time sidebar activity status updates are permanently lost until page reload. `NotificationsProvider` has reconnection; `SessionsProvider` does not.
- **Significance**: **High (reliability bug)**. This directly contributes to the "worsens with longer uptime" symptom reported by the user. After any network hiccup, the sidebar falls back to polling-only with 5s latency. Source A didn't identify this asymmetry.

### H3: Three Duplicated `timeSince()` Functions
- **Source**: H3, §Additional Issue
- **Summary**: Three separate implementations of relative time formatting exist in `live-session-card.tsx`, `session-card.tsx`, and `notification-bell.tsx` — each with different input types but identical output format. None handle the `>24h` fallback that the canonical `formatRelativeTime` does.
- **Significance**: **Low (code quality)**. Not a performance issue per se, but a maintenance concern. Consolidation into `formatRelativeTime` is a clean-up that piggybacks on the H3 timer work.

---

## 4. Conflicting Recommendations

### Conflict 1: Source A proposes eliminating Phase 2 (`session.get()`) entirely; H1 proposes parallelizing it first

- **Source A (Issue 2)**: "Eliminate Round 2: The session list from Round 1 should already contain sufficient data; avoid per-session detail fetches unless the user navigates to a specific session."
- **H1 (Approach A)**: "Parallelize session.get() calls — largest single impact." H1 also notes that `session.status()` (Phase 1) returns session status, while `session.get()` (Phase 2) returns session details (title, message counts, etc.) needed by the UI.
- **Assessment**: **H1 is more accurate.** Source A assumes `session.status()` returns all needed data — H1 investigated and found it doesn't (status vs. detail are different SDK calls). Eliminating Phase 2 would lose session titles, token counts, and other detail fields displayed in the UI. H1's phased approach (parallelize first, cache second, eventually move to SSE-push) is the correct path.

### Conflict 2: Source A's hash comparison vs. H2's structural sharing for change detection

- **Source A (Issue 3)**: Proposes `JSON.stringify(data)` hash comparison before calling `setSessions`.
- **H2 (Approach 2)**: Proposes a field-by-field `sessionsChanged()` comparator, explicitly noting that `JSON.stringify` is "too slow at scale."
- **Assessment**: **H2 is better.** `JSON.stringify` on a 50-session array with nested objects is expensive (creates a large temporary string on every 5s poll). A targeted field comparator checking only UI-visible fields (id, status, title, etc.) is faster and more maintainable. H2 also correctly integrates this with `setSessions(prev => sessionsChanged(prev, data) ? data : prev)` which leverages React's state update bailout.

### Conflict 3: SSE debounce approach — H2 uses `setTimeout(200ms)` vs. H4 uses `requestAnimationFrame`

- **Source A**: Does not propose SSE debouncing.
- **H2 (Approach 7)**: 200ms `setTimeout` debounce on `forceRender`.
- **H4 (Phase 1, Task 2)**: `requestAnimationFrame` to coalesce patches per frame (~16ms).
- **Assessment**: **Both are valid; H4's `requestAnimationFrame` is slightly better.** `rAF` ties the update to the browser's render cycle, ensuring at most 1 update per visual frame. A 200ms `setTimeout` introduces perceptible delay (200ms is noticeable to attentive users). `rAF` at ~16ms is imperceptible. **Recommend H4's approach.** If SSE bursts are very frequent (>60/sec), consider combining: `rAF` for normal flow, 200ms throttle as a ceiling.

### Conflict 4: Source A Issue 1 proposes `SSEProvider` context; H4 proposes `useGlobalSSE` hook (module singleton)

- **Source A (Issue 1)**: "Create a single shared SSE hook or context (e.g., `SSEProvider`)."
- **H4 (Phase 2, Task 4)**: Creates `useGlobalSSE` hook backed by a module-level singleton, explicitly avoiding a new React context provider.
- **Assessment**: **H4's hook approach is better.** A context provider adds a layer to the component tree and requires all consumers to be descendants. A module-level singleton with ref-counted subscriptions is simpler, doesn't need provider nesting, and avoids adding another context re-render source. H3 uses the same pattern (`useSyncExternalStore` with module singleton) for the shared timer, establishing consistency.

---

## 5. Unified Priority Order

### Tier 1: Foundation Fixes (Must-Do First — Days 1-2)
These are prerequisites that enable all subsequent optimizations. They are quick, low-risk, and have the highest leverage.

| # | Task | Source | Files | Effort | Why First |
|---|------|--------|-------|--------|-----------|
| 1 | **Memoize context `value` prop** | H2 Step 1 | `sessions-context.tsx` | Quick | Root cause of all re-render cascades. Everything else is ineffective without this. |
| 2 | **Fix `forceRender` broken pattern** | H4 Task 1 | `sessions-context.tsx` | Quick | Correctness bug. Must fix before React Compiler adoption. Same file as #1 — bundle together. |
| 3 | **Add structural sharing to `useSessions` poll** | H2 Step 2 | `use-sessions.ts`, `session-utils.ts` | Short | Eliminates ~12 needless cascade triggers/minute. |
| 4 | **Add structural sharing to `useFleetSummary` poll** | H2 Step 3 | `use-fleet-summary.ts` | Quick | Same pattern as #3. Eliminates ~6 triggers/minute. |
| 5 | **Batch SSE events via `requestAnimationFrame`** | H4 Task 2 | `sessions-context.tsx` | Quick | Prevents burst SSE events from causing N re-renders. Same file as #1-2. |
| 6 | **Add reconnection to `SessionsProvider` SSE** | H4 Task 3 | `sessions-context.tsx` | Short | Reliability fix — SSE currently dies silently. Same file as #1-2-5. |

> **File overlap note**: Tasks 1, 2, 5, 6 all touch `sessions-context.tsx` — execute these sequentially or bundle into one work session to avoid merge conflicts.

### Tier 2: React Rendering Optimization (Days 2-4)
These depend on Tier 1's memoized context value being in place. They can largely run in parallel with each other.

| # | Task | Source | Files | Effort | Dependencies |
|---|------|--------|-------|--------|-------------|
| 7 | **Wrap handlers in `useCallback`** | H2 Step 5 | `page.tsx` | Short | Tier 1 #1 (prerequisite for `React.memo` effectiveness) |
| 8 | **Fix double-wrapped arrow callbacks** | H2 Step 6 | `page.tsx`, `session-group.tsx` | Quick | Do alongside #7 |
| 9 | **Add `React.memo` to `LiveSessionCard`** | H2 Step 7 | `live-session-card.tsx` | Quick | Requires #7 |
| 10 | **Add `React.memo` to `SidebarSessionItem`** (+ thread `refetch` as prop) | H2 Step 8 | `sidebar-session-item.tsx`, `sidebar-workspace-item.tsx`, `sidebar.tsx` | Short | Requires #1 |
| 11 | **Add `React.memo` to `SessionGroup`** (+ thread `refetch` as prop) | H2 Step 9 | `session-group.tsx`, `page.tsx` | Short | Requires #7, #8 |
| 12 | **Add `React.memo` to `SidebarWorkspaceItem`** (+ thread `refetch` as prop) | H2 Step 10 | `sidebar-workspace-item.tsx`, `sidebar.tsx` | Quick | Requires #10 |

> **Parallelism**: Tasks 7-8 (page.tsx) can run in parallel with Tasks 10, 12 (sidebar files). Task 9 depends on 7. Task 11 depends on 7-8.

### Tier 3: Polling & Network Optimization (Days 4-6)
These reduce server-side load and network traffic. Independent of Tier 2.

| # | Task | Source | Files | Effort | Dependencies |
|---|------|--------|-------|--------|-------------|
| 13 | **Parallelize `session.get()` calls** | H1 Phase 1 | `sessions/route.ts` | Short | None |
| 14 | **Replace `setInterval` with `setTimeout` + adaptive interval** | H1 Phase 1 | `use-sessions.ts` | Short | None (compatible with #3) |
| 15 | **Parallelize health checks** | Source A Issue 9 | `process-manager.ts` | Quick | None (standalone) |
| 16 | **Use SQL aggregation for fleet summary** | Source A Issue 5 | `fleet/summary/route.ts`, `db-repository.ts` | Short | None (standalone) |

> **Parallelism**: All four tasks are fully independent — run in parallel.

### Tier 4: SSE Architecture (Days 6-8)
Requires Tier 1 SSE fixes (#5, #6) to be in place. Significant refactor.

| # | Task | Source | Files | Effort | Dependencies |
|---|------|--------|-------|--------|-------------|
| 17 | **Create shared `useGlobalSSE` hook** | H4 Phase 2 | `use-global-sse.ts` (new) | Medium | Tier 1 #5, #6 |
| 18 | **Migrate `SessionsProvider` to `useGlobalSSE`** | H4 Task 5 | `sessions-context.tsx` | Short | #17 |
| 19 | **Migrate `NotificationsProvider` to `useGlobalSSE`** | H4 Task 6 | `notifications-context.tsx` | Short | #17 |

> **Constraint**: Tasks 18-19 must be sequential or carefully coordinated — they share the new hook.

### Tier 5: Timestamp & Code Quality (Days 7-9)
Independent of Tiers 2-4. Can run in parallel.

| # | Task | Source | Files | Effort | Dependencies |
|---|------|--------|-------|--------|-------------|
| 20 | **Create `useRelativeTime` shared timer hook** | H3 Tasks 1-3 | `use-relative-time.ts` (new), `format-utils.ts`, `relative-timestamp.tsx` | Medium | None |
| 21 | **Consolidate `timeSince` functions** | H3 Tasks 4-7 | `live-session-card.tsx`, `session-card.tsx`, `notification-bell.tsx` | Short | #20 (uses enhanced `formatRelativeTime`) |

### Tier 6: Hardening & Long-Term (Days 9+)
Lower priority. Address after core optimizations prove stable.

| # | Task | Source | Files | Effort | Dependencies |
|---|------|--------|-------|--------|-------------|
| 22 | **Cap `useSessionEvents` message array** | H4 Phase 3 | `use-session-events.ts` | Short | None |
| 23 | **Add incremental message loading on SSE reconnect** | Source A Issue 11 | `use-session-events.ts`, messages route | Medium | #22 |
| 24 | **Make callback-monitor polling conditional** | Source A Issue 13 | `callback-monitor.ts` | Quick | None |
| 25 | **EventEmitter listener monitoring & cleanup** | Source A Issue 12 | `notification-emitter.ts` | Short | None |
| 26 | **Trust watcher, remove Phase 1 status polling** | H1 Phase 2 | `sessions/route.ts`, `session-status-watcher.ts` | Medium | Needs confidence from watcher monitoring |
| 27 | **Server-side session cache with TTL** | H1 Phase 2 | `session-cache.ts` (new) | Medium | #13 |
| 28 | **SSE-triggered refetch (replace polling)** | H1 Phase 3 | `notification-emitter.ts`, `sessions-context.tsx`, multiple mutation points | Large | #17-19, #26 |

> **Note**: Tasks 22-25 are independent and can run in parallel. Tasks 26-28 are sequential and depend on earlier tiers.

---

## 6. Coverage Summary

### Quantitative Coverage

| Metric | Value |
|--------|-------|
| Source A issues covered by H-plans | **12 of 13** (92%) |
| Fully covered (agrees or agrees with nuance) | **9 of 13** (69%) |
| Partially covered (only one aspect addressed) | **3 of 13** (23%) — Issues 10, 11, 12 |
| Not covered at all | **1 of 13** (8%) — Issue 5 (fleet summary SQL) |
| New findings in H-plans not in Source A | **6** |
| Critical new findings (must-fix) | **2** — unmemoized context value (H2), broken `forceRender` (H4) |

### Coverage Assessment

The H-plans provide **excellent coverage** of Source A's issues, with significantly deeper analysis. The single uncovered issue (Issue 5: fleet summary SQL aggregation) is a straightforward, well-defined fix that doesn't require its own investigation plan.

More importantly, the H-plans uncovered **two critical findings** that Source A missed:
1. **Unmemoized context value** (H2 Finding 1) — the root cause of ALL re-render cascades. Without fixing this first, Source A's Issue 7 (`React.memo`) would be ineffective.
2. **Broken `forceRender` pattern** (H4 Finding 2) — a latent correctness bug that could break SSE updates with future React versions.

### Readiness to Execute

**Yes, coverage is sufficient to proceed.** The combination of Source A + H-plans provides:
- A clear root-cause analysis (H2's re-render cascade diagram)
- Quantified impact (H1's latency model, H2's re-render counts)
- Validated solution approaches with feasibility ratings
- Identified prerequisites and dependency ordering (e.g., memoize context before adding `React.memo`)
- Risk assessments for each approach

The three partially-covered issues (10, 11, 12) and one uncovered issue (5) are all well-defined in Source A and can be executed from Source A's descriptions without additional investigation.

### Recommended Execution Strategy

Execute **Tiers 1-3 first** (Days 1-6). These cover the highest-impact, lowest-risk fixes and should resolve the user's primary complaint of "UI sluggishness that worsens with more sessions and longer uptime." After verifying improvement with profiling:
- **If symptoms persist**: proceed to Tiers 4-5 (SSE consolidation, timestamp optimization)
- **If resolved**: Tiers 4-6 become nice-to-have improvements for long-term health

**Expected combined impact of Tiers 1-3:**
- Re-renders reduced from ~4,134/min to ~120/min (per H2's estimate — 97% reduction)
- Poll latency reduced from ~1.3s to ~100ms at 20 sessions (per H1's estimate)
- No more request stacking (setTimeout replaces setInterval)
- Health checks drop from 3N seconds worst-case to 3 seconds
