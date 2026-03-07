# Performance Plan 3: Server-Side Optimization

## TL;DR
> **Summary**: Parallelize sequential `session.get()` SDK calls, parallelize sequential health checks, replace `setInterval` with `setTimeout` in polls, and use SQL aggregation for fleet summary instead of loading all rows.
> **Estimated Effort**: Short (1 day)

## Context
### Original Request
The `GET /api/sessions` endpoint makes sequential SDK calls that scale linearly with session count, causing poll response latency to grow. Health checks have the same sequential pattern. The fleet summary loads all session rows just to count them.

### Key Findings
- **`sessions/route.ts` lines 209–327**: `for...of` loop iterates through `dbSessions` with `await liveInstance.client.session.get()` inside (line 298). Each `session.get()` call takes ~50-100ms. With 20 sessions, this is 1-2 seconds of sequential waiting. Phase 1 (`session.status()`) at lines 192–207 is ALREADY parallelized via `Promise.allSettled` — only Phase 2 is sequential.
- **`process-manager.ts` lines 669–712**: Health check loop uses `for...of` with `await checkPortAlive()` (line 675). Each `checkPortAlive` has a 3-second timeout (line 441). With 10 instances, worst case is 30 seconds. `checkPortAlive` is a simple HTTP GET to `/session` (line 443).
- **`use-sessions.ts` line 49**: Uses `setInterval(fetchSessions, pollIntervalMs)` which can stack requests if a poll takes longer than the interval. If the server response takes 6 seconds and the interval is 5 seconds, a second request fires before the first completes.
- **`fleet/summary/route.ts` lines 18–21**: Calls `listSessions()` which executes `SELECT * FROM sessions ORDER BY created_at DESC` (db-repository.ts line 213), loading ALL session rows into memory. Then filters in JS: `sessions.filter(s => s.status === "active").length`. Should use `SELECT COUNT(*) ... GROUP BY status`.

## Prerequisites
- None — these are all independent server-side fixes that don't depend on Plan 1 or 2.

## Expected Impact
- Poll latency reduced from ~1.3s to ~100ms at 20 sessions (parallelized session.get)
- Health check cycle reduced from up to 30s to ~3s at 10 instances
- No more request stacking from setInterval
- Fleet summary endpoint: O(1) memory instead of O(N) — returns counts directly from SQL

## Objectives
### Core Objective
Reduce server-side latency and eliminate resource waste in polling and health check loops.

### Deliverables
- [ ] Parallelized `session.get()` calls in sessions route
- [ ] Parallelized health checks in process manager
- [ ] `setInterval` replaced with `setTimeout` in `useSessions` and `useFleetSummary`
- [ ] SQL aggregation for fleet summary

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass
- [ ] Manual test: `GET /api/sessions` with 10+ sessions responds in <200ms (measure via Network tab)

### Guardrails (Must NOT)
- Must NOT change the response shape of any API endpoint
- Must NOT change the health check failure threshold logic (3 consecutive failures)
- Must NOT remove the health check loop's sequential failure-counting logic — only parallelize the port checks

---

## TODOs

- [ ] 1. **Parallelize `session.get()` calls in sessions route**
  **What**: Replace the sequential `for...of` loop (lines 209–327) with a parallel `Promise.allSettled` pattern for the `session.get()` SDK calls, while keeping all other logic (status determination, workspace lookup) intact.
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  The current loop at lines 209–327 does three things per session:
  1. Determine instance/session status (lines 216–276) — synchronous DB lookups, fast
  2. Get workspace info (lines 278–293) — synchronous DB lookup, fast
  3. Call `session.get()` (lines 296–326) — async SDK call, SLOW

  Strategy: Split the loop into two passes:
  **Pass 1** (keep synchronous): Iterate all dbSessions, compute status and workspace info, and identify which sessions need a `session.get()` call. Collect them into a list.
  **Pass 2** (parallelize): Use `Promise.allSettled` to call `session.get()` for all identified sessions in parallel. Map results back.

  ```ts
  // Collect sessions that need live data
  interface PendingFetch {
    dbSession: DbSession;
    liveInstance: ManagedInstance;
    sessionStatus: string;
    workspaceInfo: { ... };
  }
  const pendingFetches: PendingFetch[] = [];
  const readyItems: SessionListItem[] = [];

  for (const dbSession of dbSessions) {
    // ... existing status determination logic (lines 216-276) ...
    // ... existing workspace lookup (lines 278-293) ...

    if (liveInstance && instanceStatus === "running") {
      pendingFetches.push({ dbSession, liveInstance, sessionStatus, workspaceInfo });
    } else {
      readyItems.push(/* stub item, same as current lines 330-370 */);
    }
  }

  // Parallel fetch
  const fetchResults = await Promise.allSettled(
    pendingFetches.map(async ({ dbSession, liveInstance }) => {
      const result = await liveInstance.client.session.get({
        sessionID: dbSession.opencode_session_id,
      });
      return result.data;
    })
  );

  // Merge results
  for (let i = 0; i < pendingFetches.length; i++) {
    const { dbSession, sessionStatus, workspaceInfo } = pendingFetches[i]!;
    const fetchResult = fetchResults[i]!;
    if (fetchResult.status === "fulfilled" && fetchResult.value) {
      // Build item with live data (same as current lines 306-322)
    } else {
      // Build stub item (same as current lines 330-370)
    }
  }
  ```

  **Important**: Add a concurrency limit to avoid overwhelming instances with too many simultaneous SDK calls. Use a simple chunking approach (e.g., 10 at a time) or a semaphore if >50 sessions:
  ```ts
  const PARALLEL_FETCH_LIMIT = 10;
  // Process in chunks of PARALLEL_FETCH_LIMIT
  ```
  **Acceptance**: `GET /api/sessions` response time with 20 sessions is <200ms (down from ~1.3s). Verify via `console.time`/`console.timeEnd` around the fetch section.

- [ ] 2. **Replace `setInterval` with `setTimeout` in `useSessions`**
  **What**: Replace `setInterval` with a self-rescheduling `setTimeout` that only starts the next timer after the current fetch completes. This prevents request stacking when polls take longer than the interval.
  **Files**: `src/hooks/use-sessions.ts`
  **Details**:
  ```ts
  // BEFORE (lines 45-54)
  useEffect(() => {
    isMounted.current = true;
    fetchSessions();
    const interval = setInterval(fetchSessions, pollIntervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [fetchSessions, pollIntervalMs]);

  // AFTER
  useEffect(() => {
    isMounted.current = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      await fetchSessions();
      if (isMounted.current) {
        timeoutId = setTimeout(poll, pollIntervalMs);
      }
    }

    poll();

    return () => {
      isMounted.current = false;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [fetchSessions, pollIntervalMs]);
  ```
  This guarantees at most one in-flight request at a time. The interval between fetches is measured from completion, not start, so the effective cycle time is `fetchDuration + pollIntervalMs`.
  **Acceptance**: Two concurrent `GET /api/sessions` requests never appear in DevTools Network tab. Even if a response takes 6 seconds, no second request fires until 5 seconds after the first completes.

- [ ] 3. **Replace `setInterval` with `setTimeout` in `useFleetSummary`**
  **What**: Same pattern as Task 2 but for the fleet summary hook.
  **Files**: `src/hooks/use-fleet-summary.ts`
  **Details**: Identical transformation to Task 2 — replace `setInterval` at line 49 with self-rescheduling `setTimeout`.
  **Acceptance**: No concurrent fleet summary requests.

- [ ] 4. **Parallelize health checks in process manager**
  **What**: Replace the sequential `for...of` loop in `startHealthCheckLoop` (lines 672–711) with `Promise.allSettled` for the `checkPortAlive` calls, while keeping the per-instance failure counting logic.
  **Files**: `src/lib/server/process-manager.ts`
  **Details**:
  The current loop:
  ```ts
  for (const [id, instance] of instances) {
    if (instance.status !== "running") continue;
    const alive = await checkPortAlive(instance.url); // SEQUENTIAL
    // ... failure counting logic ...
  }
  ```

  Replace with:
  ```ts
  // Collect running instances
  const running = [...instances.entries()].filter(([, i]) => i.status === "running");

  // Parallel port checks
  const results = await Promise.allSettled(
    running.map(async ([id, instance]) => ({
      id,
      instance,
      alive: await checkPortAlive(instance.url),
    }))
  );

  // Process results (same failure logic, just driven by results array)
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { id, instance, alive } = result.value;
    if (alive) {
      _healthFailCounts.delete(id);
    } else {
      // ... existing failure counting and cleanup logic (lines 679-708) ...
    }
  }
  ```
  **Acceptance**: With 5 running instances, the health check cycle completes in ~3s (one timeout period) instead of ~15s.

- [ ] 5. **Use SQL aggregation for fleet summary**
  **What**: Replace the `listSessions()` call in the fleet summary route with a dedicated SQL query that counts sessions by status directly.
  **Files**: `src/app/api/fleet/summary/route.ts`, `src/lib/server/db-repository.ts`
  **Details**:
  Add a new function to `db-repository.ts`:
  ```ts
  export function getSessionStatusCounts(): { active: number; idle: number } {
    const rows = getDb()
      .prepare(
        "SELECT status, COUNT(*) as count FROM sessions WHERE status IN ('active', 'idle') GROUP BY status"
      )
      .all() as Array<{ status: string; count: number }>;

    const counts = { active: 0, idle: 0 };
    for (const row of rows) {
      if (row.status === "active") counts.active = row.count;
      else if (row.status === "idle") counts.idle = row.count;
    }
    return counts;
  }
  ```

  Update `fleet/summary/route.ts`:
  ```ts
  // BEFORE
  import { listSessions } from "@/lib/server/db-repository";
  const sessions = listSessions();
  const activeSessions = sessions.filter((s) => s.status === "active").length;
  const idleSessions = sessions.filter((s) => s.status === "idle").length;

  // AFTER
  import { getSessionStatusCounts } from "@/lib/server/db-repository";
  const counts = getSessionStatusCounts();
  const activeSessions = counts.active;
  const idleSessions = counts.idle;
  ```

  Add a test to `src/lib/server/__tests__/db-repository.test.ts` for `getSessionStatusCounts`.
  **Acceptance**: The fleet summary endpoint no longer loads full session rows. Verify by checking that `listSessions` is no longer imported in the summary route.

---

## Verification
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` — all tests pass, including new `getSessionStatusCounts` test
- [ ] `GET /api/sessions` response time ≤200ms with 10+ sessions (Network tab)
- [ ] No concurrent poll requests visible in Network tab
- [ ] Health check log output shows all checks completing within one timeout period
- [ ] `GET /api/fleet/summary` returns correct counts (matches manual count of active/idle sessions)
