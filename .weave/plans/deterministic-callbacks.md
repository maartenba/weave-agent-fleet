# Deterministic Callback Firing

## TL;DR
> **Summary**: Fix broken callback mechanism where child session completion callbacks only fire when a browser tab is watching the SSE stream. Create a server-side callback monitor that subscribes to instance event streams independently of the browser, plus a polling safety net and atomic claim to prevent duplicate delivery.
> **Estimated Effort**: Medium

## Context
### Original Request
Child sessions complete their work but never fire callbacks to the conductor session unless a browser tab is actively connected to the child session's SSE endpoint. This makes the entire orchestration system unreliable.

### Key Findings
1. **SSE-only detection**: The busy→idle transition detection and `fireSessionCallbacks()` call happens exclusively in `src/app/api/sessions/[id]/events/route.ts` lines 125-148. This SSE handler only runs when a browser connects to watch the session — if no browser tab is open for the child session, the callback never fires.

2. **Race condition in callback delivery**: `deliverCallbacks()` in `callback-service.ts` reads pending callbacks via `getPendingCallbacksForSession()` (line 37) and marks them fired via `markCallbackFired()` (line 63) as separate operations. Two concurrent callers (SSE handler + future monitor) can both read the same pending callbacks before either marks them, causing duplicate `promptAsync()` calls to the conductor.

3. **Silent error swallowing**: `deliverCallbacks()` catches all errors silently (lines 70-72, 74-76) — no logging, making debugging impossible.

4. **globalThis singleton pattern**: `process-manager.ts` lines 177-187 establish the pattern for module singletons that survive Turbopack re-evaluations. The new monitor must follow this pattern.

5. **Existing infrastructure**: The codebase already has `client.event.subscribe({ directory })` for event streams (used in SSE handler), `client.session.status({ directory })` for status polling (used in GET /api/sessions), and the health check loop pattern in process-manager.ts (line 524-567) as a model for periodic background tasks.

6. **Session deletion cleanup**: DELETE route at `src/app/api/sessions/[id]/route.ts` already calls `deleteCallbacksForSession()` (line 224) but does not clean up any server-side monitoring subscriptions. The monitor must integrate here.

7. **Database**: Uses better-sqlite3 (synchronous), WAL mode, `result.changes` for checking affected rows (seen in `deleteSession()` line 251). Atomic claim via `UPDATE ... WHERE status='pending'` + checking `changes > 0` is the standard pattern.

## Objectives
### Core Objective
Ensure child session completion callbacks fire deterministically without depending on a browser SSE connection, while preventing duplicate delivery.

### Deliverables
- [x] New `src/lib/server/callback-monitor.ts` — server-side event subscription manager
- [x] Atomic `claimPendingCallback()` in `db-repository.ts`
- [x] `getAllPendingCallbacks()` in `db-repository.ts` for the polling fallback
- [x] Updated `callback-service.ts` using atomic claim instead of read-then-mark
- [x] Updated `POST /api/sessions` route to start monitoring after callback registration
- [x] Updated `DELETE /api/sessions/[id]` route to stop monitoring on deletion
- [x] Error logging in `deliverCallbacks()` for visibility
- [x] Tests for new db-repository functions and callback-monitor logic

### Definition of Done
- [x] `npm run build` succeeds with no type errors
- [x] `npm test` passes (existing + new tests)
- [x] Callback fires when child session completes, even with no browser tab open
- [x] Duplicate callbacks are impossible (atomic claim prevents it)
- [x] Subscriptions are cleaned up when callbacks fire or sessions are deleted

### Guardrails (Must NOT)
- Must NOT break existing SSE-based callback firing (it provides faster delivery when browser is connected)
- Must NOT create per-session subscriptions (one subscription per instance, shared across monitored sessions)
- Must NOT use module-level variables without globalThis wrapping (Turbopack compatibility)
- Must NOT throw from callback delivery (best-effort pattern must be preserved)
- Must NOT remove the existing `markCallbackFired()` function (other code may use it)

## TODOs

- [x] 1. Add `claimPendingCallback()` to `db-repository.ts`
  **What**: Add an atomic claim function that updates a callback row from `pending` to `fired` in a single statement, returning `true` only if the row was actually updated (preventing duplicates). Also add `getAllPendingCallbacks()` for the polling fallback.
  **Files**: `src/lib/server/db-repository.ts`
  **Details**:
  - Add `claimPendingCallback(id: string): boolean`:
    ```typescript
    export function claimPendingCallback(id: string): boolean {
      const result = getDb()
        .prepare(
          "UPDATE session_callbacks SET status = 'fired', fired_at = datetime('now') WHERE id = ? AND status = 'pending'"
        )
        .run(id);
      return result.changes > 0;
    }
    ```
  - Add `getAllPendingCallbacks(): DbSessionCallback[]`:
    ```typescript
    export function getAllPendingCallbacks(): DbSessionCallback[] {
      return getDb()
        .prepare("SELECT * FROM session_callbacks WHERE status = 'pending'")
        .all() as DbSessionCallback[];
    }
    ```
  - Export both functions
  **Acceptance**: Unit tests pass for `claimPendingCallback` (returns true on first call, false on second) and `getAllPendingCallbacks`

- [x] 2. Add unit tests for new db-repository functions
  **What**: Add test cases for `claimPendingCallback` and `getAllPendingCallbacks` to the existing test file.
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **Details**:
  - Import `claimPendingCallback` and `getAllPendingCallbacks`
  - Add tests within the existing `"session callback repository"` describe block:
    - `"claimPendingCallback returns true on first claim"` — insert a pending callback, claim it, verify returns true
    - `"claimPendingCallback returns false on second claim"` — claim same callback twice, verify second returns false
    - `"claimPendingCallback excludes from pending list"` — after claiming, `getPendingCallbacksForSession` returns empty
    - `"claimPendingCallback does not affect other callbacks"` — insert two callbacks, claim one, verify other is still pending
    - `"getAllPendingCallbacks returns all pending across sessions"` — insert callbacks for different source sessions, verify all returned
    - `"getAllPendingCallbacks excludes fired callbacks"` — fire one, verify not in list
    - `"getAllPendingCallbacks returns empty when none pending"` — verify empty array
  **Acceptance**: `npm test -- --testPathPattern=db-repository` passes with new tests

- [x] 3. Update `callback-service.ts` to use atomic claim
  **What**: Replace `markCallbackFired()` with `claimPendingCallback()` in `deliverCallbacks()` to eliminate the race condition. Add `console.error` logging to the currently-silent catch blocks.
  **Files**: `src/lib/server/callback-service.ts`
  **Details**:
  - Add `claimPendingCallback` to the import from `./db-repository`
  - In `deliverCallbacks()`, restructure the per-callback loop:
    - **Before** any work on the callback, attempt to claim it: `const claimed = claimPendingCallback(callback.id)`
    - If `!claimed`, `continue` (another caller already claimed it)
    - Remove the existing `markCallbackFired(callback.id)` call on line 63 (it's now done by `claimPendingCallback` above)
    - Keep the `markCallbackFired(callback.id)` calls on lines 47 and 54 (dead-target / missing-session guards) — actually, replace those with `claimPendingCallback` too for consistency, since they serve the same purpose
  - Wait — reviewing the flow more carefully: currently `markCallbackFired` is called in three places:
    1. Line 47: target instance is dead → mark fired to avoid infinite retries
    2. Line 54: target DB session not found → mark fired
    3. Line 63: just before sending the prompt (intentionally before to prevent duplicates on delivery failure)
  - New approach: Move the atomic claim to the **top** of the loop iteration. If claim fails, skip entirely. This handles all three cases because once claimed, no other caller can process it. The dead-target and missing-session cases still skip delivery (continue after claim) — they just don't need separate `markCallbackFired` calls because `claimPendingCallback` already set status='fired'.
  - Updated loop structure:
    ```typescript
    for (const callback of callbacks) {
      try {
        // Atomically claim this callback — prevents duplicate delivery
        if (!claimPendingCallback(callback.id)) continue;

        // a. Get target instance (conductor)
        const targetInstance = getInstance(callback.target_instance_id);
        if (!targetInstance || targetInstance.status === "dead") continue;

        // b. Get target session DB record
        const targetDbSession = getSession(callback.target_session_id);
        if (!targetDbSession) continue;

        // c. Build the message
        const callbackMessage = await buildMessage(dbSession, callback);

        // d. Send prompt to conductor
        await targetInstance.client.session.promptAsync({
          sessionID: targetDbSession.opencode_session_id,
          parts: [{ type: "text", text: callbackMessage }],
        });
      } catch (err) {
        console.error(`[callback-service] Failed to deliver callback ${callback.id}:`, err);
      }
    }
    ```
  - Add `console.error` to the top-level catch block (line 74) as well:
    ```typescript
    } catch (err) {
      console.error("[callback-service] deliverCallbacks failed:", err);
    }
    ```
  - Note: `markCallbackFired` can remain exported from db-repository for backward compatibility, but `deliverCallbacks` no longer uses it directly
  **Acceptance**: Build succeeds, existing callback tests still pass, `deliverCallbacks` now uses atomic claim

- [x] 4. Create `src/lib/server/callback-monitor.ts` — server-side event subscription manager
  **What**: Create the core monitoring module that subscribes to instance event streams server-side and fires callbacks when child sessions transition from busy→idle.
  **Files**: `src/lib/server/callback-monitor.ts` (new file)
  **Details**:
  - **globalThis singleton pattern** (following process-manager.ts lines 177-187):
    ```typescript
    const _g = globalThis as unknown as {
      __weaveCallbackMonitor?: CallbackMonitor;
      __weaveCallbackPollInterval?: ReturnType<typeof setInterval> | null;
      __weaveCallbackMonitorInit?: boolean;
    };
    ```
  - **`CallbackMonitor` class** (or plain object with functions — match codebase style which uses module-level Maps):
    - State:
      - `monitoredSessions: Map<string, MonitoredSession>` — keyed by Fleet DB session ID
        ```typescript
        interface MonitoredSession {
          dbSessionId: string;
          opencodeSessionId: string;
          instanceId: string;
        }
        ```
      - `instanceSubscriptions: Map<string, InstanceSubscription>` — keyed by instance ID
        ```typescript
        interface InstanceSubscription {
          instanceId: string;
          directory: string;
          sessionStates: Map<string, "idle" | "busy">; // keyed by opencode session ID
          monitoredDbSessionIds: Set<string>; // Fleet DB IDs being monitored on this instance
          abort: AbortController;
        }
        ```
    - **`startMonitoring(dbSessionId, opencodeSessionId, instanceId)`**:
      1. Add to `monitoredSessions` map
      2. Check if `instanceSubscriptions` already has an entry for this instance
         - If yes: add the session to that subscription's tracking sets
         - If no: create a new subscription (see below)
      3. Do an initial status poll: `client.session.status({ directory })` → check if the session is already idle
         - If already idle, fire the callback immediately (via `fireSessionCallbacks`) and clean up
      4. If not already idle, the event subscription will catch the transition
    - **Instance subscription setup** (when first session on an instance needs monitoring):
      1. Get the instance from `getInstance(instanceId)`; if dead, fire error callback and return
      2. `const subscribeResult = await client.event.subscribe({ directory: instance.directory })`
      3. Extract the event stream (same pattern as SSE handler lines 92-95)
      4. Start an async loop `processEventStream(instanceId, eventStream)` (fire-and-forget with `.catch(console.error)`)
    - **`processEventStream(instanceId, eventStream)`** — async function:
      1. `for await (const rawEvent of eventStream)` — same pattern as SSE handler line 100
      2. Check `abortController.signal.aborted` → break
      3. Parse `type` and `properties` (same as SSE handler lines 104-107)
      4. If type is `"session.status"`:
         - Extract `statusType` from `properties?.status?.type` (same as SSE handler line 117)
         - Extract session ID from `properties?.sessionID` or `properties?.info?.id`
         - Look up if this session is in the subscription's `sessionStates` map
         - If `statusType === "busy"`: set state to "busy"
         - If `statusType === "idle"` and previous state was "busy":
           - Look up the Fleet DB session ID from `monitoredSessions`
           - Call `fireSessionCallbacks(opencodeSessionId, instanceId)` (the atomic claim in deliverCallbacks prevents duplicates with SSE handler)
           - Also update DB status: `updateSessionStatus(dbSessionId, "idle")`
           - Also create notification: `createSessionCompletedNotification(...)`
           - Call `stopMonitoringSession(dbSessionId)` to clean up
      5. If type is `"session.idle"` — handle same as idle transition (same as SSE handler line 138)
      6. If type is `"error"`:
         - Extract session ID, check if monitored
         - Call `fireSessionErrorCallbacks(...)` and `createSessionErrorNotification(...)`
         - Call `stopMonitoringSession(dbSessionId)` to clean up
      7. On stream end or error: log it, clean up the subscription entry, check if any monitored sessions are orphaned
    - **`stopMonitoringSession(dbSessionId)`**:
      1. Remove from `monitoredSessions`
      2. Find the instance subscription, remove the session from its tracking sets
      3. If the instance subscription has no more monitored sessions, abort the subscription and remove it from `instanceSubscriptions`
    - **`stopMonitoring(dbSessionId)`** — public API (called from DELETE route):
      1. Delegates to `stopMonitoringSession(dbSessionId)`
    - **Error handling**: All operations wrapped in try/catch, console.error on failures, never throws
  - **Exports**:
    - `startMonitoring(dbSessionId: string, opencodeSessionId: string, instanceId: string): void`
    - `stopMonitoring(dbSessionId: string): void`
    - `startCallbackPollingLoop(): void` (for the safety net)
    - `_resetForTests(): void` (clears all state)
  **Acceptance**: File compiles, exports are correct, follows globalThis singleton pattern

- [x] 5. Add polling-based safety net to `callback-monitor.ts`
  **What**: Add a fallback polling loop that runs every 10 seconds, checking all pending callbacks and firing any whose sessions have gone idle. This catches cases where the event subscription misses a transition (e.g., subscription started after the session already completed, instance reconnected, etc.).
  **Files**: `src/lib/server/callback-monitor.ts` (continued from task 4)
  **Details**:
  - **`startCallbackPollingLoop()`**:
    1. Guard: if `_g.__weaveCallbackPollInterval` is already set, return (idempotent)
    2. Set interval at 10_000ms:
    ```typescript
    _g.__weaveCallbackPollInterval = setInterval(async () => {
      try {
        const pending = getAllPendingCallbacks();
        if (pending.length === 0) return;

        // Group by instance to batch status checks
        const byInstance = new Map<string, DbSessionCallback[]>();
        for (const cb of pending) {
          // Look up the source session to find its instance
          const sourceSession = getSession(cb.source_session_id);
          if (!sourceSession) {
            // Source session deleted — claim and skip
            claimPendingCallback(cb.id);
            continue;
          }
          const list = byInstance.get(sourceSession.instance_id) ?? [];
          list.push(cb);
          byInstance.set(sourceSession.instance_id, list);
        }

        for (const [instanceId, callbacks] of byInstance) {
          const instance = getInstance(instanceId);
          if (!instance || instance.status === "dead") {
            // Instance dead — fire error callbacks for each
            for (const cb of callbacks) {
              const sourceSession = getSession(cb.source_session_id);
              if (sourceSession) {
                void fireSessionErrorCallbacks(sourceSession.opencode_session_id, instanceId);
              }
            }
            continue;
          }

          // Poll session statuses
          try {
            const result = await instance.client.session.status({
              directory: instance.directory,
            });
            const statusMap = (result.data ?? {}) as Record<string, { type: string }>;

            for (const cb of callbacks) {
              const sourceSession = getSession(cb.source_session_id);
              if (!sourceSession) continue;

              const liveStatus = statusMap[sourceSession.opencode_session_id];
              if (liveStatus?.type === "idle") {
                // Session is idle — fire the callback
                void fireSessionCallbacks(sourceSession.opencode_session_id, instanceId);
                // Also update DB status
                if (sourceSession.status !== "idle") {
                  updateSessionStatus(sourceSession.id, "idle");
                }
                createSessionCompletedNotification(
                  sourceSession.opencode_session_id,
                  instanceId,
                  sourceSession.title
                );
                // Stop monitoring if we were monitoring
                stopMonitoringSession(sourceSession.id);
              }
            }
          } catch (err) {
            console.error(`[callback-monitor] Polling status for instance ${instanceId} failed:`, err);
          }
        }
      } catch (err) {
        console.error("[callback-monitor] Polling loop error:", err);
      }
    }, CALLBACK_POLL_INTERVAL_MS);
    ```
  - Import `getAllPendingCallbacks`, `claimPendingCallback`, `getSession`, `updateSessionStatus` from `./db-repository`
  - Import `getInstance` from `./process-manager`
  - Import `fireSessionCallbacks`, `fireSessionErrorCallbacks` from `./callback-service`
  - Import `createSessionCompletedNotification` from `./notification-service`
  - **Startup**: At module bottom, after recovery completes, start the polling loop:
    ```typescript
    if (!_g.__weaveCallbackMonitorInit) {
      _g.__weaveCallbackMonitorInit = true;
      // Import lazily to avoid circular dependency
      import("./process-manager").then(({ _recoveryComplete }) => {
        _recoveryComplete.then(() => {
          startCallbackPollingLoop();
        }).catch(() => {/* non-fatal */});
      }).catch(() => {/* non-fatal */});
    }
    ```
    Wait — this introduces a potential circular dependency (callback-monitor → process-manager → ???). Let me check: callback-monitor needs `getInstance` from process-manager, and process-manager doesn't import callback-monitor. So direct import is fine, no circular dependency. Use the same pattern as process-manager.ts lines 570-572:
    ```typescript
    if (!_g.__weaveCallbackMonitorInit) {
      _g.__weaveCallbackMonitorInit = true;
      _recoveryComplete.then(() => {
        startCallbackPollingLoop();
      }).catch(() => {/* non-fatal */});
    }
    ```
    Where `_recoveryComplete` is imported from `./process-manager`.
  **Acceptance**: Polling loop starts after recovery, catches idle sessions that event subscription missed

- [x] 6. Update `POST /api/sessions` to start monitoring after callback registration
  **What**: After inserting the session callback row, call `startMonitoring()` to begin server-side event subscription monitoring for the child session.
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - Add import at top: `import { startMonitoring } from "@/lib/server/callback-monitor";`
  - After the callback insert block (after line 109, inside the `if (parentDbSessionId && body.onComplete?.notifyInstanceId)` block), add:
    ```typescript
    // Start server-side monitoring so callback fires without browser SSE
    try {
      startMonitoring(sessionDbId, session.id, instance.id);
    } catch {
      console.warn('[POST /api/sessions] Failed to start callback monitoring');
    }
    ```
  - The call goes after the `insertSessionCallback` try/catch block but inside the `if` guard, so monitoring only starts when a callback is actually registered
  **Acceptance**: Build succeeds, `startMonitoring` is called when `onComplete` is provided

- [x] 7. Update `DELETE /api/sessions/[id]` to stop monitoring on deletion
  **What**: When permanently deleting a session, call `stopMonitoring()` to clean up any active server-side subscriptions for that session.
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Details**:
  - Add import at top: `import { stopMonitoring } from "@/lib/server/callback-monitor";`
  - Before or alongside the `deleteCallbacksForSession` call (line 224), add:
    ```typescript
    // Stop server-side callback monitoring for this session
    try {
      stopMonitoring(resolvedDbId);
    } catch {
      // Non-fatal
    }
    ```
  - Place this **before** `deleteCallbacksForSession` so the monitor is stopped before the callback rows are deleted (otherwise the monitor might try to fire a callback that no longer exists)
  - Also call `stopMonitoring` in the non-permanent termination path (before line 206) since a terminated session shouldn't fire callbacks either:
    ```typescript
    // Stop monitoring — terminated session shouldn't fire callbacks
    if (resolvedDbId) {
      try {
        stopMonitoring(resolvedDbId);
      } catch {
        // Non-fatal
      }
    }
    ```
  **Acceptance**: Build succeeds, monitoring is cleaned up on both terminate and permanent delete

- [x] 8. Ensure callback-monitor module is loaded on server startup
  **What**: The callback-monitor module must be imported somewhere that runs on server startup so its polling loop initializes. Since it uses the globalThis + init guard pattern, it just needs to be imported once.
  **Files**: `src/lib/server/callback-monitor.ts`, possibly `src/app/api/sessions/route.ts`
  **Details**:
  - Option A: The module's self-initializing code (the `if (!_g.__weaveCallbackMonitorInit)` block) runs on first import. Since `POST /api/sessions` and `DELETE /api/sessions/[id]` both import from it, the module will be loaded on the first API call involving sessions.
  - Option B: Import it from `process-manager.ts` to ensure it loads during recovery. But this adds a dependency that process-manager doesn't need.
  - **Decision**: Option A is sufficient. The polling loop starts on first import, which happens on the first session-related API call. This matches how process-manager.ts self-initializes on line 502-508. Any pending callbacks from before the server started will be picked up by the polling loop once it activates.
  - However, we should also consider: what if there are pending callbacks from a previous server run and no session API calls happen for a while? The polling loop won't start until someone hits a session endpoint. This is acceptable because:
    1. The orchestrator is an interactive application — session endpoints are hit frequently
    2. The callbacks are for conductor sessions that are actively waiting — someone is using the UI
    3. Recovery of instances happens on first API call anyway (`_recoveryComplete`)
  - If we want eager startup, add a side-effect import in `process-manager.ts` after recovery:
    ```typescript
    _recoveryComplete.then(() => {
      startHealthCheckLoop();
      // Ensure callback monitor is loaded
      import("./callback-monitor").catch(() => {/* non-fatal */});
    }).catch(() => {/* non-fatal */});
    ```
    This is the better approach — it ensures the polling loop starts alongside the health check loop.
  **Acceptance**: Callback polling loop starts after instance recovery completes

- [x] 9. Add tests for callback-monitor
  **What**: Add unit tests for the callback monitor's core logic. Focus on the testable parts: session tracking, subscription management, and cleanup.
  **Files**: `src/lib/server/__tests__/callback-monitor.test.ts` (new file)
  **Details**:
  - Test `startMonitoring` / `stopMonitoring`:
    - Starting monitoring adds the session to tracked state
    - Stopping monitoring removes it
    - Stopping a non-existent session is a no-op (no throw)
    - Double-starting the same session is idempotent
  - Test cleanup:
    - `_resetForTests()` clears all state
  - Note: Full integration testing (event stream subscription, callback firing) requires a running OpenCode instance and is out of scope for unit tests. The atomic claim in db-repository is already tested in task 2, and the callback delivery logic is unchanged (just uses claim instead of mark).
  - Mock `getInstance` and `getClientForInstance` to return test doubles where needed
  **Acceptance**: `npm test -- --testPathPattern=callback-monitor` passes

- [x] 10. Verify build and all tests pass
  **What**: Run the full build and test suite to confirm no regressions.
  **Files**: None (verification only)
  **Details**:
  - Run `npm run build` — verify no TypeScript errors
  - Run `npm test` — verify all tests pass (existing + new)
  - Manual verification: create a child session with `onComplete` callback, confirm callback fires without opening the child session in the browser
  **Acceptance**: `npm run build` exits 0, `npm test` exits 0

## Verification
- [x] `npm run build` succeeds with no type errors
- [x] `npm test` passes (all existing + new tests)
- [x] No regressions in existing SSE-based callback firing
- [x] `claimPendingCallback` returns false on second call (duplicate prevention verified)
- [x] `getAllPendingCallbacks` returns correct results
- [x] Callback monitor starts polling after recovery completes
- [x] Monitor cleans up subscriptions when sessions are deleted or callbacks fire

## Architecture Notes

### Data Flow (After Fix)

```
POST /api/sessions (with onComplete)
  ├── insertSessionCallback()     → DB row: status='pending'
  └── startMonitoring()           → callback-monitor subscribes to instance events

Child session completes (busy → idle):
  ├── SSE handler (if browser connected)  → fireSessionCallbacks() → claimPendingCallback()
  ├── callback-monitor (event stream)     → fireSessionCallbacks() → claimPendingCallback()
  └── callback-monitor (polling fallback) → fireSessionCallbacks() → claimPendingCallback()
      └── Only ONE of these succeeds (atomic claim), others see changes=0 and skip
```

### Key Design Decisions
1. **Atomic claim first, then deliver** — `claimPendingCallback()` is called at the top of the callback loop. If it returns false, the callback was already handled. This is simpler than claim-after-check and eliminates all race windows.
2. **One subscription per instance** — Multiple monitored sessions on the same OpenCode instance share one event stream subscription, filtered by session ID. When the last monitored session on an instance completes, the subscription is torn down.
3. **Polling as safety net, not primary** — The 10-second polling loop catches edge cases (subscription started after completion, stream disconnection) but the event subscription provides near-instant callback firing in the normal case.
4. **Three layers of redundancy**: SSE handler (instant, browser-dependent), event subscription (instant, server-side), polling (10s delay, catches everything). Atomic claim prevents duplicates across all three.
