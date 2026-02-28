# Wire Up Idle and Completed Session Status

## TL;DR
> **Summary**: Extend the DB schema with `idle` and `completed` session statuses, persist state transitions detected in the SSE event stream, and update the fleet summary API so the summary bar displays accurate idle/completed counts.
> **Estimated Effort**: Medium

## Context
### Original Request
The session overview summary bar has "Idle" and "Completed" stat boxes that aren't properly wired. "Idle" is hardcoded to `0` and "Completed" maps from the overloaded `stopped` DB status which conflates user-terminated and naturally-completed sessions.

### Key Findings

1. **DB schema has only 3 session statuses**: `active | stopped | disconnected` (in `sessions` table, `database.ts` line 73). The `DbSession.status` type in `db-repository.ts` (line 40) mirrors this. The `updateSessionStatus` function (line 213) only accepts these 3 values.

2. **SSE stream already detects idle transitions**: In `events/route.ts` lines 109-133, when `session.status` transitions from `busy → idle`, it creates a `session_completed` notification via `createSessionCompletedNotification()`. However, it **never persists** this status change to the DB.

3. **Client-side tracks idle/busy**: `use-session-events.ts` maintains a `sessionStatus: "idle" | "busy"` state (line 40), but this is purely in-memory on the browser and not communicated back to the server.

4. **The fleet summary API** (`/api/fleet/summary/route.ts`) simply counts DB rows: `active` → activeSessions, `stopped` → completedSessions, `disconnected` → errorSessions, and hardcodes `idleSessions: 0`.

5. **Session list API** (`/api/sessions/route.ts`) computes `sessionStatus` by merging live instance state with DB state, but only uses 3 statuses: `active | stopped | disconnected`.

6. **DELETE `/api/sessions/[id]`** marks sessions as `stopped` (line 142) — this is a user-initiated termination.

7. **Process manager** marks sessions as `disconnected` when an instance fails health checks (process-manager.ts line 385).

8. **`SessionListItem.sessionStatus`** in `api-types.ts` (line 40) is typed as `"active" | "stopped" | "disconnected"` — needs expanding.

9. **`page.tsx`** (line 82) has sort order hardcoded to `{ active: 0, disconnected: 1, stopped: 2 }` — needs `idle` and `completed`.

10. **`live-session-card.tsx`** derives visual state (dot color, badge, label) from `sessionStatus` — only handles `active`, `stopped`, `disconnected`.

11. **`workspace-utils.ts`** checks `sessionStatus === "active"` for `hasRunningSession` — `idle` sessions should also count as running.

## Objectives
### Core Objective
Make the "Idle" and "Completed" summary bar boxes display real-time accurate counts by introducing them as distinct, persisted session states.

### Deliverables
- [ ] DB schema supports 5 session statuses: `active`, `idle`, `stopped`, `completed`, `disconnected`
- [ ] SSE event stream persists `idle` status to DB on busy→idle transition
- [ ] SSE event stream persists `completed` status when a session truly completes (distinct from user-terminated `stopped`)
- [ ] Fleet summary API returns real counts for idle and completed
- [ ] Session list API returns `idle` and `completed` as valid `sessionStatus` values
- [ ] UI (summary bar, session card, sort, workspace grouping) renders all 5 statuses correctly

### Definition of Done
- [ ] `npm run build` passes with no type errors
- [ ] `npm test` passes — all existing tests updated, new tests added
- [ ] Idle box shows count of sessions in idle state (busy→idle transition detected by SSE)
- [ ] Completed box shows count of sessions that naturally finished (not user-terminated)
- [ ] Stopped (user-terminated) sessions no longer inflate the Completed count

### Guardrails (Must NOT)
- Must NOT break existing `stopped` and `disconnected` session flows
- Must NOT require a full database reset — use additive SQLite migration (the `status` column is `TEXT`, so it already accepts any string value; only TypeScript types need updating)
- Must NOT change the SSE event format sent to the browser
- Must NOT introduce new API endpoints — extend existing ones

## TODOs

- [ ] 1. **Expand DB session status domain in TypeScript types**
  **What**: The `sessions.status` column is `TEXT` in SQLite, so no DDL change is needed — it already accepts any string. Update the TypeScript types and repository functions to accept the 2 new statuses.
  **Files**:
  - `src/lib/server/db-repository.ts` — Change `DbSession.status` type from `"active" | "stopped" | "disconnected"` to `"active" | "idle" | "stopped" | "completed" | "disconnected"`. Update the `updateSessionStatus()` parameter's `status` type to accept all 5 values.
  - `src/lib/api-types.ts` — Change `SessionListItem.sessionStatus` type from `"active" | "stopped" | "disconnected"` to `"active" | "idle" | "stopped" | "completed" | "disconnected"`.
  **Acceptance**: TypeScript compiles. No runtime behavior changes yet. Existing code that passes `"active" | "stopped" | "disconnected"` continues to work (wider union is backward-compatible).

- [ ] 2. **Persist idle status from SSE event stream + widen instance/active queries**
  **What**: When the SSE proxy detects a `busy → idle` transition (already detected at lines 109-133 in `events/route.ts`), persist it to the DB by calling `updateSessionStatus(dbSession.id, "idle")`. This should happen *alongside* the existing notification creation, not replacing it. Also, when `session.status` transitions to `busy`, update the DB back to `active` so the session is re-counted as active.

  **Critical**: Two existing queries filter `WHERE status = 'active'` and will silently skip idle sessions after this change, causing bugs in the process-manager recovery path and session cleanup:
  - `getSessionsForInstance()` (line 225-228) — used by process-manager (line 383) to mark sessions as `"disconnected"` when an instance dies, and by the DELETE handler (line 118 of `[id]/route.ts`) to check if other sessions are using the instance. Idle sessions on a dying instance would be silently missed.
  - `listActiveSessions()` (line 207-210) — used in process-manager recovery and verification tests. Idle sessions would not appear in "active session" counts.

  **Files**:
  - `src/app/api/sessions/[id]/events/route.ts` — Import `updateSessionStatus` from `db-repository`. In the notification try/catch block (lines 108-146):
    - On `statusType === "busy"`: look up `dbSession`, call `updateSessionStatus(dbSession.id, "active")` to transition back from idle.
    - On `statusType === "idle"` (when `lastSessionStatus === "busy"`): call `updateSessionStatus(dbSession.id, "idle")` right after (or before) `createSessionCompletedNotification`.
    - Similarly for the `session.idle` event block (lines 124-133): call `updateSessionStatus(dbSession.id, "idle")`.
  - `src/lib/server/db-repository.ts` — Two query changes:
    - [ ] `getSessionsForInstance()` (line 227): Change `WHERE instance_id = ? AND status = 'active'` to `WHERE instance_id = ? AND status IN ('active', 'idle')`. This ensures idle sessions on a dying instance still get the `"disconnected"` transition in process-manager.ts line 383-391.
    - [ ] `listActiveSessions()` (line 209): Change `WHERE status = 'active'` to `WHERE status IN ('active', 'idle')`. Idle sessions are still "alive" (the instance is running, the session just finished its current task) and should be included wherever active sessions are counted.
  **Acceptance**: After a session goes busy→idle, `SELECT status FROM sessions WHERE id = ?` returns `"idle"`. After it goes idle→busy again (new prompt sent), it returns `"active"`. `getSessionsForInstance()` returns both active AND idle sessions. When an instance dies with idle sessions, those sessions are correctly transitioned to `"disconnected"`.

- [ ] 3. **Introduce completed status and distinguish from stopped**
  **What**: "Completed" means the session finished its work naturally. "Stopped" means the user explicitly terminated it. Currently both map to `stopped`. The key insight: if a user terminates a session that is in `idle` state (i.e., it already finished its task), that's a cleanup action — the session *completed*. If they terminate while `active` (still processing), that's a user interruption — the session was *stopped*.
  **Files**:
  - `src/app/api/sessions/[id]/route.ts` — In the DELETE handler (lines 138-146), before unconditionally setting `stopped`:
    1. Read the current session from DB using `getSession(resolvedDbId)`.
    2. If `currentSession.status === "idle"`, call `updateSessionStatus(resolvedDbId, "completed", now)`.
    3. Otherwise, call `updateSessionStatus(resolvedDbId, "stopped", now)` (existing behavior).
  **Acceptance**: Terminating an idle session results in `completed` status in DB. Terminating an active/busy session results in `stopped` status.

- [ ] 4. **Update fleet summary API to count idle and completed**
  **What**: Replace the hardcoded `idleSessions: 0` with a real count, and properly count completed sessions.
  **Files**:
  - `src/app/api/fleet/summary/route.ts` — Update the filter logic:
    - `activeSessions` = sessions with status `"active"`
    - `idleSessions` = sessions with status `"idle"`
    - `completedSessions` = sessions with status `"completed"` OR `"stopped"` (both represent finished sessions; the distinction is preserved in the DB for future filtering but the summary box shows the total)
    - `errorSessions` = sessions with status `"disconnected"`
  **Acceptance**: `GET /api/fleet/summary` returns non-zero `idleSessions` when sessions are idle. `completedSessions` includes both stopped and completed sessions.

- [ ] 5. **Update sessions list API to return new statuses**
  **What**: The `GET /api/sessions` handler merges live instance state with DB state to compute `sessionStatus`. It needs to also surface `idle` and `completed`.
  **Files**:
  - `src/app/api/sessions/route.ts` — Changes needed:
    - Update the `sessionStatus` variable type (line 143) from `"active" | "stopped" | "disconnected"` to the full 5-value union.
    - When the instance is live and running (line 145-148): instead of always using `"active"`, check the DB session status — if it's `"idle"`, return `"idle"`. This respects the status persisted by the SSE stream in TODO #2.
    - When the instance is NOT live (lines 149-161): if DB status is `"completed"`, return `"completed"`. If DB status is `"idle"` and instance is dead, return `"completed"` (session was idle when instance died = naturally completed). Keep `"stopped"` and `"disconnected"` as-is.
    - In the fallback live-only listing (lines 110-133): keep `"active" | "stopped"` since without DB there's no idle info.
  **Acceptance**: `GET /api/sessions` returns `"idle"` for sessions whose DB status is `"idle"` with a running instance. Returns `"completed"` for sessions that completed naturally.

- [ ] 6. **Update UI to render idle and completed statuses**
  **What**: Multiple UI files handle `sessionStatus` and need to recognize the 2 new values.
  **Files**:
  - `src/components/fleet/live-session-card.tsx`:
    - Add `const isIdle = sessionStatus === "idle"` and `const isCompleted = sessionStatus === "completed"`.
    - Update `isInactive` to include `isCompleted`.
    - Dot color: idle → `bg-yellow-400`, completed → `bg-blue-500`.
    - Badge variant: idle → `"secondary"`, completed → `"outline"`.
    - Status label: idle → `"idle"`, completed → `"completed"`.
    - `canTerminate`: idle sessions should be terminatable (cleanup), completed should not.
  - `src/app/page.tsx`:
    - Sort order map (line 82): add `idle: 0` (same priority as active — it's still alive), `completed: 2` (same as stopped).
    - Status groups in `renderGroupedByStatus` (lines 115-149): add `"idle"` and `"completed"` to the `statusGroups` record and the render array.
    - The `idleSessions` fallback (line 99): change from `0` to `sessions.filter(s => s.sessionStatus === "idle").length`.
    - The `completedSessions` fallback (line 100): add `"completed"` to the filter alongside `"stopped"`.
  - `src/lib/workspace-utils.ts`:
    - `hasRunningSession` check (lines 47-48 and 69-70): change `session.sessionStatus === "active"` to `(session.sessionStatus === "active" || session.sessionStatus === "idle")` — idle sessions have a running instance and should count.
  **Acceptance**: Idle sessions show with yellow dot and "idle" label. Completed sessions show with blue dot and "completed" label. Sort and group operations include the new statuses. Workspace groups with idle sessions show as "running".

- [ ] 7. **Update existing tests**
  **What**: Multiple test files reference the 3-value status union and will need updates for the new status values.
  **Files**:
  - `src/lib/server/__tests__/db-repository.test.ts`:
    - Add test: `UpdatesSessionStatusToIdle` — insert session, call `updateSessionStatus(id, "idle")`, assert status is `"idle"`.
    - Add test: `UpdatesSessionStatusToCompleted` — insert session, call `updateSessionStatus(id, "completed", now)`, assert status is `"completed"` and `stopped_at` is set.
    - Add test: `GetSessionsForInstanceReturnsIdleSessions` — insert two sessions for an instance (one active, one idle), call `getSessionsForInstance(instanceId)`, assert both are returned.
    - Add test: `ListActiveSessionsIncludesIdleSessions` — insert sessions with statuses `active`, `idle`, `stopped`, `disconnected`, call `listActiveSessions()`, assert only `active` and `idle` sessions are returned.
  - `src/app/api/sessions/__tests__/route.test.ts`:
    - Update mock type for `updateSessionStatus` to accept the wider union.
    - Add test: when DB session status is `"idle"` and instance is running, `GET /api/sessions` returns `sessionStatus: "idle"`.
    - Add test: when DB session status is `"completed"`, `GET /api/sessions` returns `sessionStatus: "completed"`.
  - `src/lib/__tests__/workspace-utils.test.ts`:
    - Add test: session with `sessionStatus: "idle"` and `instanceStatus: "running"` sets `hasRunningSession: true`.
  - `src/lib/server/__tests__/v2-verification.test.ts` — Review and update any hardcoded status assertions that may conflict with new values.
  - `src/lib/server/__tests__/v2-integration.test.ts` — Review and update any hardcoded status assertions.
  **Acceptance**: `npm test` passes with all tests green.

- [ ] 8. **Handle edge case: sessions that go idle without an SSE observer**
  **What**: The idle transition is only detected when a client is connected via SSE (`events/route.ts`). If no browser tab is watching the session, the busy→idle transition fires in OpenCode but nobody persists it. This means sessions could remain `active` in the DB even though they've gone idle.

  **SDK research findings**: The SDK `Session` type (`@opencode-ai/sdk/v2`, `types.gen.d.ts` line 684) does **NOT** have a status field — it only contains `id`, `slug`, `projectID`, `directory`, `title`, `time`, etc. However, the SDK exposes a dedicated **`session.status()`** endpoint (`sdk.gen.d.ts` line 331-337) that returns a `{ [sessionId: string]: SessionStatus }` map, where `SessionStatus` is:
  ```typescript
  type SessionStatus = { type: "idle" } | { type: "retry"; attempt: number; message: string; next: number } | { type: "busy" };
  ```
  This endpoint is available as `client.session.status({ directory })` and returns the status of **all sessions** in a single call (no need to query per-session). It accepts an optional `directory` parameter.

  **Files**:
  - `src/app/api/sessions/route.ts` — In the `GET` handler, after fetching `dbSessions` and before the per-session loop (around line 155):
    1. For each live instance in the `instances` map, call `client.session.status({ directory: instance.directory })` once. Cache the result as a `Map<instanceId, Record<sessionId, SessionStatus>>`.
    2. Inside the per-session loop (line 180-197), after fetching `session.get()`, look up the session's OpenCode ID in the status map.
    3. If the status map entry has `type === "idle"` AND the DB session status is `"active"`, call `updateSessionStatus(dbSession.id, "idle")` and set `sessionStatus = "idle"`.
    4. If the status map entry has `type === "busy"` AND the DB session status is `"idle"`, call `updateSessionStatus(dbSession.id, "active")` and set `sessionStatus = "active"` (corrects stale idle state).
    5. Wrap the `session.status()` call in a try/catch — if it fails, fall through to existing behavior (no status correction).
  - `src/lib/api-types.ts` — Already re-exports `SessionStatus` from the SDK (line 9: `export type { Session as SDKSession, Part, SessionStatus }`), so no import changes needed in the route file — use the SDK `SessionStatus` type directly.
  **Acceptance**: Sessions that went idle without an SSE observer are detected as idle within one polling cycle (~5 seconds). The `session.status()` call is batched per-instance (not per-session), so it adds at most N network calls where N = number of live instances.

## Verification
- [ ] `npm run build` completes without errors
- [ ] `npm test` passes — all existing and new tests green
- [ ] Manual test: Start a session, send a prompt, watch it go active → idle in the summary bar
- [ ] Manual test: Terminate an idle session → Completed count increments
- [ ] Manual test: Terminate an active session → it appears as stopped (not completed)
- [ ] The summary bar Idle box shows non-zero when a session is waiting for input
- [ ] The summary bar Completed box shows the correct count of finished/terminated sessions
- [ ] No regressions: Active, Errors, and other stat boxes continue to work correctly
