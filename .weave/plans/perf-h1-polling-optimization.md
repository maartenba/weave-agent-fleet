# H1: Polling Optimization — O(N) SDK Calls per 5-Second Poll

## Hypothesis Status: **CONFIRMED (with nuance)**

---

## 1. Confirmed Findings

### 1.1 The GET /api/sessions Handler (src/app/api/sessions/route.ts, lines 140–358)

The handler executes **two phases** of SDK calls on every poll:

**Phase 1 — Batch session.status() per instance (lines 192–207)**
- Iterates all **running** instances and calls `instance.client.session.status()` once per instance.
- This is O(M) where M = number of running instances.
- The comment on line 188 says "at most N network calls where N = number of live instances" — this is already batched per-instance (not per-session). **This is reasonable.**

**Phase 2 — Individual session.get() per running session (lines 296–326)**
- For every DB session where the instance is live and running, calls `liveInstance.client.session.get({ sessionID })` **individually**.
- This is O(N_running) where N_running = number of sessions on running instances.
- These calls are **sequential** — they're inside a `for...of` loop with `await`, not `Promise.allSettled`.
- **This is the primary bottleneck.**

**Additional DB calls per session (lines 279–293)**
- `getWorkspace(dbSession.workspace_id)` is called per session in the loop. These are local SQLite lookups (fast), not network calls.

### 1.2 The Poll Interval (src/hooks/use-sessions.ts, lines 13–54)

- Fixed 5-second interval (`DEFAULT_POLL_INTERVAL_MS = 5_000`).
- No backoff, no abort-on-overlap, no ETag support.
- Uses `setInterval(fetchSessions, pollIntervalMs)` — if a fetch takes >5s, the next fires while the previous is still in flight, causing **request stacking**.

### 1.3 The Fleet Summary Poll (src/hooks/use-fleet-summary.ts, lines 14–54)

- Fixed 10-second interval. DB-only (no SDK calls). **Not a concern.**

### 1.4 The Sessions Context (src/contexts/sessions-context.tsx, lines 70–139)

- Already has SSE-based activity status patching via `/api/notifications/stream`.
- SSE patches are ephemeral and cleared on each poll (poll is source of truth).
- The SSE infrastructure is **already in place** and working for activity status. This is a key enabler for further optimization.

### 1.5 Session Status Watcher (src/lib/server/session-status-watcher.ts)

- Already subscribes to per-instance event streams server-side.
- Persists busy/idle/waiting_input transitions to DB in real-time.
- The GET handler then **re-checks** via `session.status()` anyway (Phase 1), creating **redundant work**. The watcher already keeps DB status up-to-date.

---

## 2. Quantified Cost Per Poll

### Formula

For a fleet with **N total sessions** across **M running instances**, where **N_running** sessions are on running instances and **N_dead** are on stopped/dead instances:

| Call Type | Count | Parallelism | Target |
|---|---|---|---|
| `listSessions()` (DB) | 1 | — | Local SQLite |
| `listInstances()` (memory) | 1 | — | In-process Map |
| `session.status()` (SDK→HTTP) | M | `Promise.allSettled` (parallel) | OpenCode servers |
| `session.get()` (SDK→HTTP) | N_running | **Sequential `for...of`** | OpenCode servers |
| `getWorkspace()` (DB) | N | — | Local SQLite |
| `getInstance()` (DB) | N_dead | — | Local SQLite |

### Latency Model

Assume each SDK HTTP call takes ~20–50ms (localhost loopback):

| Sessions | Instances | Status calls | Get calls | Total SDK time (best) | Total SDK time (worst) |
|---|---|---|---|---|---|
| 5 | 3 | 50ms (parallel) | 5 × 30ms = 150ms | ~200ms | ~400ms |
| 10 | 5 | 50ms (parallel) | 10 × 30ms = 300ms | ~350ms | ~700ms |
| 20 | 10 | 50ms (parallel) | 20 × 30ms = 600ms | ~650ms | ~1.3s |
| 50 | 20 | 50ms (parallel) | 50 × 30ms = 1.5s | ~1.5s | ~3s |

**At 20 sessions, each poll takes 650ms–1.3s. At 50 sessions, it approaches the 5s interval → stacking begins.**

### Request Stacking Risk

With `setInterval` (not `setTimeout`), a new poll fires exactly every 5s regardless of whether the previous completed. If poll latency exceeds 5s:
- Concurrent requests pile up
- Server-side resources (connections, event loop) degrade
- Each subsequent poll takes longer (cascading failure)

---

## 3. Feasibility Assessment

### Approach A: Parallelize session.get() calls

**Feasibility: HIGH — Quick win, low risk**

The `session.get()` calls in the for-loop (lines 296–326) are sequential. Wrapping them in `Promise.allSettled` would reduce total time from O(N_running × latency) to O(latency) (bounded by the slowest single call).

- **Effort**: Small (~20 lines changed)
- **Impact**: Reduces 20-session poll from ~1s to ~100ms
- **Risk**: Slightly higher burst load on OpenCode servers (all calls at once instead of staggered). Mitigatable with concurrency limit (e.g., `p-limit`).
- **Dependency**: None

### Approach B: Skip SDK calls for stopped/disconnected sessions

**Feasibility: HIGH — Already partially done**

The handler already skips `session.get()` for non-running instances (line 296: `if (liveInstance && instanceStatus === "running")`). For dead instances, it synthesizes a stub. **This is already implemented.** No additional work needed.

### Approach C: Trust the session-status-watcher and skip Phase 1 status polling

**Feasibility: MEDIUM — Requires confidence in watcher reliability**

The `session-status-watcher.ts` already persists busy/idle transitions in real-time via SSE. The Phase 1 `session.status()` batch call (lines 192–207) exists as a **safety net** to catch transitions missed when no SSE observer was active.

- If we trust the watcher: remove Phase 1 entirely (saves M HTTP calls per poll).
- Risk: If the watcher's SSE stream silently disconnects, status transitions could be missed.
- Mitigation: Add watcher health monitoring (detect and reconnect on stream drop). The watcher already handles this (line 166–174), but a more robust reconnect with backoff would increase confidence.
- **Effort**: Small (remove ~15 lines, add health check logging)
- **Impact**: Saves M HTTP calls per poll. For 10 instances, saves ~50ms.

### Approach D: Cache session data server-side with TTL

**Feasibility: MEDIUM — Useful but not the root cause**

Add an in-memory cache for `session.get()` results with a short TTL (e.g., 3 seconds). Multiple browser tabs or concurrent poll requests would share cached data.

- **Effort**: Medium (~50 lines, add cache map with TTL eviction)
- **Impact**: Significant for multi-tab scenarios. Minimal for single-tab (still makes N calls per TTL window).
- **Risk**: Stale data shown briefly. Acceptable for a 2–3s TTL.
- **Dependency**: Works well with Approach A.

### Approach E: Use SSE push for full session list (replace polling)

**Feasibility: LOW-MEDIUM — High effort, high reward, architectural change**

Replace the polling loop entirely with SSE push. The server would push the full session list (or deltas) whenever state changes.

- SSE infrastructure already exists (`/api/notifications/stream`).
- But session list changes come from many sources (SDK events, DB updates, health checks, instance spawns). Wiring all of these to emit a "sessions-changed" event is substantial.
- **Effort**: High (~200+ lines across 5–6 files)
- **Impact**: Eliminates all polling latency. True real-time updates.
- **Risk**: Complexity. Must handle reconnects, initial state sync, SSE buffer pressure.
- **Note**: A simpler variant — SSE-triggered refetch — would push a lightweight "refresh" event and let the client call GET /api/sessions. This reduces poll frequency from fixed-interval to event-driven, while reusing existing code.

### Approach F: Smart interval with backoff

**Feasibility: HIGH — Easy to implement**

Poll faster when sessions are active (e.g., 3s), slower when idle (e.g., 15s). Prevent stacking by using `setTimeout` after completion instead of `setInterval`.

- **Effort**: Small (~20 lines in `use-sessions.ts`)
- **Impact**: Reduces unnecessary load when fleet is idle. Prevents stacking.
- **Risk**: Near zero.

### Approach G: ETag / If-None-Match to skip unchanged responses

**Feasibility: MEDIUM — Useful but doesn't eliminate server-side work**

Add ETag to the GET response. If sessions haven't changed, return 304.

- Problem: The server still needs to make all SDK calls to *determine* if data changed (to compute the ETag). The savings are only on response serialization and network transfer.
- A hash of DB session statuses + instance statuses could serve as a cheap ETag without SDK calls, but would miss session detail changes (messages, token counts).
- **Effort**: Medium
- **Impact**: Saves bandwidth, not latency.
- **Risk**: Low.

---

## 4. Recommended Solution

**Phased approach — combine A + F + C for maximum impact with minimum risk:**

### Phase 1: Quick wins (immediate)
1. **Parallelize session.get() calls** (Approach A) — largest single impact
2. **Switch to setTimeout-based polling with overlap prevention** (Approach F) — prevents stacking
3. **Add adaptive poll interval** (Approach F) — 3s when busy, 10s when all idle

### Phase 2: Remove redundancy (follow-up)
4. **Trust the watcher, remove Phase 1 status polling** (Approach C) — after adding watcher reconnect monitoring
5. **Add server-side cache** (Approach D) — for multi-tab scenarios

### Phase 3: Long-term (future)
6. **SSE-triggered refetch** (simplified Approach E) — emit "sessions-changed" event from server, client refetches on demand instead of polling

---

## 5. Implementation Steps

### Phase 1: Quick Wins

- [ ] **Parallelize `session.get()` calls in GET handler** — Refactor the `for...of` loop at `src/app/api/sessions/route.ts:209–356` to collect running-session items into a `Promise.allSettled` batch, similar to how `session.status()` is already batched at lines 192–207. Cap concurrency at 10 to avoid overwhelming a single OpenCode instance.

- [ ] **Replace `setInterval` with `setTimeout` in `use-sessions.ts`** — Change `src/hooks/use-sessions.ts:49` from `setInterval(fetchSessions, pollIntervalMs)` to a `setTimeout` scheduled after the fetch completes. This prevents request stacking when a poll takes longer than the interval.

- [ ] **Add adaptive poll interval based on fleet activity** — In `src/hooks/use-sessions.ts`, examine the returned sessions: if any have `activityStatus === 'busy'`, use a short interval (3s); if all are idle/stopped, use a longer interval (10–15s). Consider a middle tier for `waiting_input` state (5s).

- [ ] **Add tests for parallelized session.get()** — Add a test in `src/app/api/sessions/__tests__/route.test.ts` that verifies `session.get()` calls are made concurrently (not sequentially) and that failures for individual sessions don't break the overall response.

- [ ] **Add tests for adaptive poll interval** — Add tests in `src/hooks/` verifying the hook uses shorter intervals when sessions are busy and longer intervals when idle.

### Phase 2: Remove Redundancy

- [ ] **Add reconnect monitoring to session-status-watcher** — In `src/lib/server/session-status-watcher.ts`, add automatic reconnection with exponential backoff when the event stream drops. Log reconnect attempts so we can audit reliability.

- [ ] **Remove Phase 1 `session.status()` batch call** — Once watcher reliability is proven, remove lines 187–207 in `src/app/api/sessions/route.ts` and the associated status correction logic (lines 220–242). Rely entirely on DB status maintained by the watcher.

- [ ] **Add server-side in-memory cache for session.get() results** — Create a cache in `src/lib/server/session-cache.ts` with a 3-second TTL, keyed by `(instanceId, sessionId)`. The GET handler should check cache before making SDK calls. Invalidate on SSE status change events.

### Phase 3: SSE-Triggered Refetch

- [ ] **Add a "sessions-changed" event to the notification emitter** — Extend `src/lib/server/notification-emitter.ts` to emit a lightweight `sessions_changed` event (no payload, just a signal) whenever session state changes (create, delete, status change, instance spawn/death).

- [ ] **Wire session mutation points to emit the event** — In `src/app/api/sessions/route.ts` (POST), `src/app/api/sessions/[id]/route.ts` (DELETE, PATCH), `src/lib/server/session-status-watcher.ts`, and `src/lib/server/process-manager.ts` (health check death), emit `sessions_changed` after state mutations.

- [ ] **Client: switch from interval polling to SSE-triggered refetch** — In `src/contexts/sessions-context.tsx`, listen for `sessions_changed` events on the SSE stream and trigger `refetch()`. Keep a slow background poll (30s) as a fallback safety net.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Parallelized `session.get()` overwhelms an OpenCode instance with burst traffic | Low | Cap concurrency at 10. OpenCode servers handle individual sessions, so each call hits a different session's state. |
| Removing `session.status()` batch causes stale status in DB | Medium | Only remove after watcher reconnect logic is proven reliable. Keep the batch call behind a feature flag initially. |
| Adaptive poll interval causes UI to feel laggy when sessions activate | Low | SSE activity_status events already patch the sidebar in real-time (src/contexts/sessions-context.tsx:84–113). The poll is a background consistency mechanism, not the primary update path. |
| Server-side cache serves stale session data | Low | 3-second TTL is short. SSE events provide real-time patching for activity status. Cache only affects session detail fields (title, messages) which change infrequently. |
| `setTimeout` scheduling drift over long periods | Negligible | Drift is fine — the goal is preventing stacking, not precise timing. |
| Multi-tab scenarios make more SSE connections | Low | The notification emitter already supports up to 100 listeners (line 33 of notification-emitter.ts). |

---

## 7. Expected Improvement

| Metric | Before (20 sessions, 10 instances) | After Phase 1 | After Phase 2 |
|---|---|---|---|
| SDK calls per poll | 10 (status) + 20 (get) = 30 | 10 (status) + 20 (get, parallel) = 30 | 20 (get, parallel, cached) |
| Poll latency | ~650ms–1.3s (sequential) | ~100–150ms (parallel) | ~50ms (cache hit) |
| Polls per minute (idle fleet) | 12 (fixed 5s) | 4–6 (adaptive 10–15s) | 2 (30s fallback + SSE) |
| Stacking risk | High (setInterval) | None (setTimeout) | None |
