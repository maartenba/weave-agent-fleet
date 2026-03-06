# Session State Mismatch Fix

## TL;DR
> **Summary**: Fix three interrelated bugs causing sessions to get stuck in an unrecoverable "disconnected" state: add `"disconnected"` to the lifecycle status type, cascade session state in `recoverInstances()`, and add SSE reconnect abandonment so the UI can show the resume banner.
> **Estimated Effort**: Medium

## Context
### Original Request
Sessions become stuck in a "disconnected" state that users can't recover from without manual stop+resume. Three root causes work together to create this problem.

### Key Findings

**Problem 1 — `deriveLifecycleStatus("disconnected")` → `"running"`**
- `SessionLifecycleStatus` in `src/lib/types.ts` (lines 36-40) only has `"running" | "completed" | "stopped" | "error"` — no `"disconnected"`.
- `deriveLifecycleStatus()` in `src/lib/server/db-repository.ts` (lines 262-278) maps `"disconnected"` → `"running"` at line 269-270.
- Duplicate `deriveLifecycleStatus()` in `src/app/api/sessions/route.ts` (lines 371-386) maps both `"disconnected"` → `"running"` AND `"error"` → `"running"` at lines 378-380.
- The UI compensates with a fragile compound check: `lifecycleStatus === "running" && typedInstanceStatus === "stopped"` in three places.

**Problem 2 — `recoverInstances()` doesn't cascade to sessions**
- `recoverInstances()` in `src/lib/server/process-manager.ts` (lines 338-406) checks ports and marks dead instances as `"stopped"`, but the dead-instance branch (lines 393-400) only calls `updateInstanceStatus()` — never touches sessions.
- `getSessionsForInstance()` in `src/lib/server/db-repository.ts` (lines 280-283) only queries `status IN ('active', 'idle')` — won't find sessions already stuck as `"disconnected"`.
- After graceful shutdown: `destroyAll()` → `destroyInstance()` marks sessions as `"disconnected"` (line 558), then after restart, `recoverInstances()` marks instance `"stopped"` but sessions stay `"disconnected"`.
- After crash: sessions stay `"active"`/`"idle"` in DB with dead instances. `recoverInstances()` marks instance `"stopped"` but sessions stay `"active"`/`"idle"`.
- Note: `destroyInstance()` (lines 540-578) and the health check loop (lines 625-654) both correctly cascade to sessions using `getSessionsForInstance()` — only `recoverInstances()` is missing the cascade.

**Problem 3 — SSE reconnect bound to stale instanceId**
- `useSessionEvents` hook `es.onerror` handler (lines 163-175) retries with exponential backoff forever, never signaling abandonment.
- Session detail page metadata fetch (lines 118-141) runs once on mount and sets `isResumable` if it fails, but never re-runs.
- Safety net (lines 147-151) clears `isResumable` if SSE connects — but SSE never connects to a dead instance.

## Objectives
### Core Objective
Ensure disconnected sessions are properly represented in the type system, automatically cleaned up during instance recovery, and recoverable via the resume banner in the UI.

### Deliverables
- [ ] `"disconnected"` added to `SessionLifecycleStatus` type
- [ ] Both `deriveLifecycleStatus()` functions correctly map `"disconnected"` → `"disconnected"` and `"error"` → `"error"`
- [ ] `recoverInstances()` cascades to sessions when marking an instance as stopped
- [ ] UI compound checks replaced with direct `lifecycleStatus === "disconnected"`
- [ ] SSE reconnect abandonment signals the session detail page to show the resume banner
- [ ] All existing tests updated and new tests added

### Definition of Done
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run test` passes with zero test failures
- [ ] Manual: start a session, kill the opencode process, verify session shows as "disconnected" with resume banner

### Guardrails (Must NOT)
- Must NOT change the `SessionStatus` type (the "legacy" status) — it already has `"disconnected"`
- Must NOT break the resume flow — sessions must still be resumable from disconnected/stopped states
- Must NOT change `getSessionsForInstance()` semantics (other callers depend on it returning only active/idle)
- Must NOT remove the `typedInstanceStatus` field from `SessionListItem` — other UI logic still uses it

## TODOs

### Phase 1: Type System Update

- [ ] 1. Add `"disconnected"` to `SessionLifecycleStatus`
  **What**: Add `"disconnected"` as a new variant to the `SessionLifecycleStatus` union type.
  **Files**: `src/lib/types.ts`
  **Change**:
  ```typescript
  // OLD (lines 36-40):
  export type SessionLifecycleStatus =
    | "running"
    | "completed"
    | "stopped"
    | "error";

  // NEW:
  export type SessionLifecycleStatus =
    | "running"
    | "completed"
    | "stopped"
    | "error"
    | "disconnected";
  ```
  **Acceptance**: `npm run typecheck` passes. The re-export in `src/lib/api-types.ts` (line 11, line 16) works automatically since it re-exports the type by name.

### Phase 2: Backend Derivation Fix

- [ ] 2. Fix `deriveLifecycleStatus()` in `db-repository.ts`
  **What**: Map `"disconnected"` → `"disconnected"` instead of `"disconnected"` → `"running"`.
  **Files**: `src/lib/server/db-repository.ts`
  **Change**:
  ```typescript
  // OLD (lines 262-278):
  function deriveLifecycleStatus(
    status: DbSession["status"]
  ): SessionLifecycleStatus {
    switch (status) {
      case "active":
      case "idle":
      case "waiting_input":
      case "disconnected":
        return "running";
      case "completed":
        return "completed";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
    }
  }

  // NEW:
  function deriveLifecycleStatus(
    status: DbSession["status"]
  ): SessionLifecycleStatus {
    switch (status) {
      case "active":
      case "idle":
      case "waiting_input":
        return "running";
      case "disconnected":
        return "disconnected";
      case "completed":
        return "completed";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
    }
  }
  ```
  **Why**: `"disconnected"` is not a running state — it means the process is dead. Mapping it to `"running"` forces the UI to infer the real state via a fragile compound check.
  **Acceptance**: `updateSessionStatus(id, "disconnected")` writes `lifecycle_status = "disconnected"` to DB.

- [ ] 3. Fix `deriveLifecycleStatus()` in `route.ts`
  **What**: Map `"disconnected"` → `"disconnected"` and `"error"` → `"error"` instead of both mapping to `"running"`.
  **Files**: `src/app/api/sessions/route.ts`
  **Change**:
  ```typescript
  // OLD (lines 371-386):
  function deriveLifecycleStatus(
    sessionStatus: SessionListItem["sessionStatus"]
  ): SessionLifecycleStatus {
    switch (sessionStatus) {
      case "active":
      case "idle":
      case "waiting_input":
      case "disconnected":
      case "error":
        return "running";
      case "completed":
        return "completed";
      case "stopped":
        return "stopped";
    }
  }

  // NEW:
  function deriveLifecycleStatus(
    sessionStatus: SessionListItem["sessionStatus"]
  ): SessionLifecycleStatus {
    switch (sessionStatus) {
      case "active":
      case "idle":
      case "waiting_input":
        return "running";
      case "disconnected":
        return "disconnected";
      case "completed":
        return "completed";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
    }
  }
  ```
  **Why**: Two bugs: `"disconnected"` → `"running"` hides dead sessions; `"error"` → `"running"` hides errored sessions. Both should map to their own lifecycle status.
  **Acceptance**: GET `/api/sessions` returns `lifecycleStatus: "disconnected"` for disconnected sessions and `lifecycleStatus: "error"` for errored sessions.

### Phase 3: Recovery Cascade

- [ ] 4. Add `getNonTerminalSessionsForInstance()` query function
  **What**: Add a new DB query function that finds ALL non-terminal sessions for an instance (broader than `getSessionsForInstance` which only returns active/idle). This is needed because after a crash, sessions could be in any non-terminal state (`active`, `idle`, `waiting_input`, `disconnected`), and after a graceful shutdown they're in `disconnected`.
  **Files**: `src/lib/server/db-repository.ts`
  **New function** (insert after `getSessionsForInstance` at line 284):
  ```typescript
  /**
   * Get all sessions for an instance that are NOT in a terminal state.
   * Used during recovery to cascade instance death to orphaned sessions.
   * Unlike getSessionsForInstance() which only returns active/idle,
   * this includes disconnected/waiting_input sessions too.
   */
  export function getNonTerminalSessionsForInstance(instanceId: string): DbSession[] {
    return getDb()
      .prepare("SELECT * FROM sessions WHERE instance_id = ? AND status NOT IN ('stopped', 'completed', 'error')")
      .all(instanceId) as DbSession[];
  }
  ```
  **Why**: `getSessionsForInstance()` only queries `status IN ('active', 'idle')` — won't find sessions stuck as `"disconnected"` (graceful shutdown scenario) or `"waiting_input"`. We need a new function rather than modifying the existing one because `getSessionsForInstance()` is used by `destroyInstance()` and health checks where we only want active/idle sessions.
  **Acceptance**: Function returns sessions in `active`, `idle`, `waiting_input`, and `disconnected` states, but NOT `stopped`, `completed`, or `error`.

- [ ] 5. Update `recoverInstances()` to cascade to sessions
  **What**: In the dead-instance branch of `recoverInstances()`, after marking the instance as stopped, query for all non-terminal sessions on that instance and mark them as `"stopped"`.
  **Files**: `src/lib/server/process-manager.ts`
  **Change**: In the `else` branch at lines 393-400, after `updateInstanceStatus()`:
  ```typescript
  // OLD (lines 393-400):
  } else {
    // Mark as stopped in DB
    try {
      updateInstanceStatus(dbInst.id, "stopped", new Date().toISOString());
    } catch (err) {
      log.warn("process-manager", "Failed to mark unreachable instance as stopped in DB", { instanceId: dbInst.id, err });
    }
  }

  // NEW:
  } else {
    // Mark as stopped in DB
    const now = new Date().toISOString();
    try {
      updateInstanceStatus(dbInst.id, "stopped", now);
    } catch (err) {
      log.warn("process-manager", "Failed to mark unreachable instance as stopped in DB", { instanceId: dbInst.id, err });
    }
    // Cascade: mark all non-terminal sessions on this dead instance as stopped.
    // This handles both scenarios:
    //   - Graceful shutdown: sessions stuck as "disconnected"
    //   - Crash: sessions stuck as "active"/"idle"/"waiting_input"
    try {
      const orphanedSessions = getNonTerminalSessionsForInstance(dbInst.id);
      for (const session of orphanedSessions) {
        updateSessionStatus(session.id, "stopped", now);
      }
      if (orphanedSessions.length > 0) {
        log.info("process-manager", `Recovered ${orphanedSessions.length} orphaned session(s) for dead instance`, { instanceId: dbInst.id });
      }
    } catch (err) {
      log.warn("process-manager", "Failed to cascade session stops during recovery", { instanceId: dbInst.id, err });
    }
  }
  ```
  **Why**: Without this, sessions get stuck in non-terminal states after a server restart with dead instances. The health check and `destroyInstance()` both cascade — only `recoverInstances()` is missing this.
  **Import**: Add `getNonTerminalSessionsForInstance` to the imports from `db-repository` at the top of `process-manager.ts`.
  **Acceptance**: After server restart with dead instances, all orphaned sessions are marked as `"stopped"` with a `stopped_at` timestamp.

### Phase 4: UI Compound Check Cleanup

- [ ] 6. Replace compound check in `live-session-card.tsx`
  **What**: Replace `lifecycleStatus === "running" && isInstanceStopped` with `lifecycleStatus === "disconnected"`.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Change**:
  ```typescript
  // OLD (line 42):
  const isDisconnected = lifecycleStatus === "running" && isInstanceStopped;

  // NEW:
  const isDisconnected = lifecycleStatus === "disconnected";
  ```
  Also remove the now-unused `isInstanceStopped` variable at line 41 (`const isInstanceStopped = typedInstanceStatus === "stopped";`) IF it's not used elsewhere in the component. Check if it's referenced beyond `isDisconnected` before removing.
  **Acceptance**: Disconnected sessions render the `WifiOff` icon and "Disconnected" tooltip.

- [ ] 7. Replace compound check in `sidebar-session-item.tsx`
  **What**: Replace `lifecycleStatus === "running" && isInstanceStopped` with `lifecycleStatus === "disconnected"`.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Change**:
  ```typescript
  // OLD (lines 30-31):
  const isInstanceStopped = typedInstanceStatus === "stopped";
  const isDisconnected = lifecycleStatus === "running" && isInstanceStopped;

  // NEW:
  const isDisconnected = lifecycleStatus === "disconnected";
  ```
  Remove the `isInstanceStopped` variable (line 30) if not used elsewhere in the component.
  **Acceptance**: Sidebar sessions show correct disconnected state.

- [ ] 8. Replace compound check in `page.tsx` (fleet page)
  **What**: Replace `lifecycleStatus === "running" && isInstanceStopped` with `lifecycleStatus === "disconnected"`.
  **Files**: `src/app/page.tsx`
  **Change**:
  ```typescript
  // OLD (lines 250-251):
  const isInstanceStopped = s.typedInstanceStatus === "stopped";
  const isDisconnected = s.lifecycleStatus === "running" && isInstanceStopped;

  // NEW:
  const isDisconnected = s.lifecycleStatus === "disconnected";
  ```
  Remove `isInstanceStopped` variable (line 250) if not used elsewhere in the function.
  **Acceptance**: Fleet page groups disconnected sessions correctly.

- [ ] 9. Update `workspace-utils.ts` `hasRunningSession` logic
  **What**: The `groupSessionsByWorkspace` function checks `lifecycleStatus === "running" && typedInstanceStatus === "running"` to determine `hasRunningSession`. Now that disconnected sessions have `lifecycleStatus === "disconnected"`, the check `lifecycleStatus === "running"` alone would be sufficient to exclude disconnected sessions. However, the existing compound check is still correct and actually safer — a disconnected session will now have `lifecycleStatus === "disconnected"` so neither condition matches. **No code change needed**, but the test at line 186-195 needs updating (see Phase 6).
  **Files**: `src/lib/workspace-utils.ts` — NO CHANGE NEEDED
  **Acceptance**: Verify existing tests still pass after updating the test expectations.

- [ ] 10. Check `session-group.tsx` for compound checks
  **What**: `session-group.tsx` line 79 checks `s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed"` for `handleTerminateAll`. This needs to also exclude `"disconnected"` sessions from termination (they're already dead).
  **Files**: `src/components/fleet/session-group.tsx`
  **Change**:
  ```typescript
  // OLD (line 79):
  const active = group.sessions.filter((s) => s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed");

  // NEW:
  const active = group.sessions.filter((s) => s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed" && s.lifecycleStatus !== "disconnected");
  ```
  **Why**: Can't terminate a disconnected session (the instance is already dead). This prevents unnecessary `destroyInstance` calls on dead instances.
  **Acceptance**: "Terminate All" on a workspace group skips disconnected sessions.

### Phase 5: SSE Staleness Handling

- [ ] 11. Add SSE reconnect abandonment in `useSessionEvents`
  **What**: After a configurable number of failed reconnect attempts (e.g. 5), stop retrying and set the connection status to a new value `"abandoned"`. This signals to the session detail page that the instance is truly dead.
  **Files**: `src/hooks/use-session-events.ts`
  **Changes**:
  1. Add `"abandoned"` to `SessionConnectionStatus` type (line 18-23):
     ```typescript
     // OLD:
     export type SessionConnectionStatus =
       | "connecting"
       | "connected"
       | "recovering"
       | "disconnected"
       | "error";

     // NEW:
     export type SessionConnectionStatus =
       | "connecting"
       | "connected"
       | "recovering"
       | "disconnected"
       | "error"
       | "abandoned";
     ```
  2. Add a constant for max reconnect attempts (after line 49):
     ```typescript
     const MAX_RECONNECT_ATTEMPTS = 5;
     ```
  3. In `es.onerror` handler (lines 163-175), check attempt count and abandon if exceeded:
     ```typescript
     // OLD:
     es.onerror = () => {
       if (!isMounted.current) return;
       es.close();
       eventSourceRef.current = null;
       setStatus("disconnected");
       setReconnectAttempt((prev) => prev + 1);

       const delay = reconnectDelay.current;
       reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
       reconnectTimerRef.current = setTimeout(() => {
         if (isMounted.current) connectRef.current?.();
       }, delay);
     };

     // NEW:
     es.onerror = () => {
       if (!isMounted.current) return;
       es.close();
       eventSourceRef.current = null;

       setReconnectAttempt((prev) => {
         const next = prev + 1;
         if (next >= MAX_RECONNECT_ATTEMPTS) {
           setStatus("abandoned");
           // Don't schedule any more retries
           return next;
         }
         setStatus("disconnected");
         const delay = reconnectDelay.current;
         reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
         reconnectTimerRef.current = setTimeout(() => {
           if (isMounted.current) connectRef.current?.();
         }, delay);
         return next;
       });
     };
     ```
  **Why**: Retrying forever against a dead instance is pointless. After 5 attempts (covering ~31 seconds with exponential backoff: 1+2+4+8+16), the instance is certainly dead.
  **Note**: The manual `reconnect()` method (lines 207-221) still works — it resets attempt count and reconnects immediately, allowing users to manually retry if they want.
  **Acceptance**: After 5 failed reconnects, `status` becomes `"abandoned"` and no more retries are scheduled.

- [ ] 12. Handle SSE abandonment in session detail page
  **What**: When the SSE connection status transitions to `"abandoned"`, set `isResumable(true)` so the resume banner appears. Also clear `isResumable` on successful reconnect (already handled by the safety net at lines 147-151).
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Change**: Update the safety net `useEffect` (lines 147-151) to handle `"abandoned"`:
  ```typescript
  // OLD (lines 147-151):
  useEffect(() => {
    if (status === "connected" && isResumable && !isStopped) {
      setIsResumable(false);
    }
  }, [status, isResumable, isStopped]);

  // NEW:
  useEffect(() => {
    if (status === "connected" && isResumable && !isStopped) {
      setIsResumable(false);
    }
    if (status === "abandoned" && !isResumable && !isStopped) {
      setIsResumable(true);
    }
  }, [status, isResumable, isStopped]);
  ```
  **Why**: When SSE gives up, the user needs a recovery path. Showing the resume banner lets them start a new instance for the session.
  **Acceptance**: After SSE abandonment, the resume banner appears on the session detail page.

### Phase 6: Test Updates

- [ ] 13. Update `workspace-utils.test.ts` disconnected test
  **What**: The test at line 186-194 ("sets hasRunningSession false when disconnected") currently uses `lifecycleStatus: "running"` + `typedInstanceStatus: "stopped"` to represent a disconnected session. Update it to use `lifecycleStatus: "disconnected"`.
  **Files**: `src/lib/__tests__/workspace-utils.test.ts`
  **Change**:
  ```typescript
  // OLD (lines 186-195):
  it("sets hasRunningSession false when disconnected (running lifecycle, stopped instance)", () => {
    const session = makeSession({
      lifecycleStatus: "running",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  // NEW:
  it("sets hasRunningSession false when disconnected", () => {
    const session = makeSession({
      lifecycleStatus: "disconnected",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });
  ```
  **Acceptance**: Test passes with the new lifecycle status.

- [ ] 14. Add tests for `getNonTerminalSessionsForInstance`
  **What**: Add tests for the new query function in the session repository test suite.
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **New tests** (add to the "session repository" describe block):
  ```typescript
  it("GetNonTerminalSessionsForInstanceReturnsActiveIdleAndDisconnected", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId(); // active
    const id2 = mkSessionId(); // idle
    const id3 = mkSessionId(); // disconnected
    const id4 = mkSessionId(); // stopped (terminal)
    const id5 = mkSessionId(); // completed (terminal)

    for (const id of [id1, id2, id3, id4, id5]) {
      insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    }
    updateSessionStatus(id2, "idle");
    updateSessionStatus(id3, "disconnected");
    updateSessionStatus(id4, "stopped", new Date().toISOString());
    updateSessionStatus(id5, "completed", new Date().toISOString());

    const sessions = getNonTerminalSessionsForInstance(instId);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1); // active
    expect(ids).toContain(id2); // idle
    expect(ids).toContain(id3); // disconnected
    expect(ids).not.toContain(id4); // stopped
    expect(ids).not.toContain(id5); // completed
  });

  it("GetNonTerminalSessionsForInstanceReturnsEmptyWhenAllTerminal", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped", new Date().toISOString());

    const sessions = getNonTerminalSessionsForInstance(instId);
    expect(sessions.length).toBe(0);
  });
  ```
  **Import**: Add `getNonTerminalSessionsForInstance` to the import list at the top of the test file.
  **Acceptance**: Tests pass.

- [ ] 15. Update `v2-verification.test.ts` disconnected session cascade test
  **What**: The test "SessionsBecomeDisconnectedWhenInstanceStops" (lines 271-296) manually cascades session status — it should be updated to verify the new recovery cascade behavior. The test simulates what `recoverInstances()` *should* do after the fix: orphaned sessions should end up as `"stopped"`, not `"disconnected"`.
  **Files**: `src/lib/server/__tests__/v2-verification.test.ts`
  **Change**: Update the test to reflect the new expected behavior where recovery marks sessions as `"stopped"`:
  ```typescript
  // OLD (lines 271-295):
  it("SessionsBecomeDisconnectedWhenInstanceStops", () => {
    // ... marks sessions as "disconnected"
    for (const sess of allSessions) {
      expect(sess.status).toBe("disconnected");
    }
  });

  // NEW — update to reflect that recovery marks sessions as "stopped":
  it("SessionsBecomeStoppedWhenRecoveryMarksInstanceDead", () => {
    const dirs = [makeTempDir(), makeTempDir()].map(trackDir);
    const sessions = dirs.map((dir, i) =>
      setupFullSession({ directory: dir, port: 4097 + i })
    );

    // Simulate recovery: mark instances stopped, then cascade to sessions
    const now = new Date().toISOString();
    for (const s of sessions) {
      updateInstanceStatus(s.instId, "stopped", now);
      // Recovery cascades: find non-terminal sessions and mark them stopped
      const orphaned = getNonTerminalSessionsForInstance(s.instId);
      for (const os of orphaned) {
        updateSessionStatus(os.id, "stopped", now);
      }
    }

    // All sessions should now be stopped
    const allSessions = listSessions();
    for (const sess of allSessions) {
      expect(sess.status).toBe("stopped");
    }
    expect(listActiveSessions().length).toBe(0);
  });
  ```
  **Import**: Add `getNonTerminalSessionsForInstance` to the imports at the top of the test file.
  **Acceptance**: Test passes with updated recovery expectations.

- [ ] 16. Update `route.test.ts` lifecycle status expectations
  **What**: Verify that the GET `/api/sessions` tests account for the new `"disconnected"` lifecycle status. The test "ReturnsDisconnectedStatusWhenInstanceNotInLiveMapButDbSaysRunning" (lines 386-402) already expects `sessionStatus: "disconnected"` — verify that the `lifecycleStatus` field is also checked. If the test doesn't currently assert `lifecycleStatus`, add an assertion.
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Change**: Add lifecycle status assertion to the disconnected test:
  ```typescript
  // In "ReturnsDisconnectedStatusWhenInstanceNotInLiveMapButDbSaysRunning" test (line 386):
  // Add after existing assertions:
  expect(body[0].lifecycleStatus).toBe("disconnected");
  ```
  **Acceptance**: Test verifies that the API returns the correct lifecycle status for disconnected sessions.

- [ ] 17. Add test for `"error"` lifecycle status mapping
  **What**: Add a test in `route.test.ts` to verify that `"error"` session status maps to `lifecycleStatus: "error"` (not `"running"`).
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **New test** (add to the "GET /api/sessions" describe block):
  ```typescript
  it("ReturnsErrorLifecycleStatusWhenDbSessionIsInErrorState", async () => {
    const dbSession = makeDbSession({ status: "error" });
    mockListSessions.mockReturnValue([dbSession] as never);
    mockListInstances.mockReturnValue([]);
    mockGetInstance.mockReturnValue(undefined as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].sessionStatus).toBe("error");
    expect(body[0].lifecycleStatus).toBe("error");
  });
  ```
  **Acceptance**: Test passes, confirming the `"error"` → `"error"` mapping fix.

- [ ] 18. Verify resume test compatibility
  **What**: Review `src/app/api/sessions/__tests__/resume.test.ts` — it uses `status: "disconnected"` as default fixture (line 62). The resume flow shouldn't be affected by these changes since we're only changing how lifecycle status is derived, not how resume logic works. Verify all resume tests still pass with no changes needed.
  **Files**: `src/app/api/sessions/__tests__/resume.test.ts` — NO CHANGE expected
  **Acceptance**: All resume tests pass as-is.

## Verification
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run test` passes with zero test failures
- [ ] `npm run lint` passes
- [ ] Manual: create a session, kill the opencode process (e.g. `kill -9 <pid>`), observe:
  - Fleet page shows session as "disconnected" (not "running")
  - Session detail page shows resume banner after ~30s (SSE abandonment)
  - Clicking resume successfully restarts the session
- [ ] Manual: kill the Fleet server process, restart it, verify previously-active sessions are shown as "stopped" (not stuck as "active" or "disconnected")
