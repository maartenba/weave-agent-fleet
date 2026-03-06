# Status Terminology Cleanup — Separate Connection, Session, and Instance Status

## TL;DR
> **Summary**: Refactor the codebase to cleanly separate three distinct status concepts — connection status, session activity status, and instance liveness — that are currently conflated into a single hybrid `SessionStatus` type, a single DB column, and a single API field. This is a naming/terminology refactor only; UI behavior and appearance must remain identical.
> **Estimated Effort**: Large

## Context
### Original Request
The codebase conflates three distinct concepts into one "status" value:
1. **Connection Status** — is the SSE connection to the OpenCode server reachable?
2. **Session Activity Status** — is the agent busy working or idle?
3. **Instance Status** — is the OpenCode process alive or dead?

This makes the code confusing, causes naming mismatches (SDK emits `"busy"` but DB stores `"active"`), and leads to impossible states (a session can't be both `"disconnected"` and `"active"` simultaneously, yet nothing prevents it).

### Key Findings

**The hybrid `SessionStatus` type** in `src/lib/types.ts` has 7 values: `"active" | "idle" | "waiting_input" | "completed" | "error" | "stopped" | "disconnected"`. These mix:
- Activity states: `active`, `idle`, `waiting_input`
- Lifecycle states: `completed`, `stopped`, `error`
- Connection states: `disconnected`

**The SDK uses `"busy"`** but the DB stores `"active"` — translation happens in `session-status-watcher.ts` (line 96) and `callback-monitor.ts`. This is a constant source of confusion.

**`DbSession.status`** uses all 7 hybrid values in one TEXT column. This must be split into two columns: one for activity (`busy`/`idle`/`waiting_input`) and one for lifecycle (`running`/`completed`/`stopped`/`error`).

**`SessionListItem.sessionStatus`** in `api-types.ts` sends the hybrid blob to the frontend. It does have a separate `instanceStatus: "running" | "dead"` field which is already clean.

**`useSessionEvents` hook** already cleanly separates concepts locally:
- `status: SessionConnectionStatus` → `"connecting" | "connected" | "recovering" | "disconnected" | "error"`
- `sessionStatus: "idle" | "busy"` → clean activity state

**Instance status mismatch**: In-memory `ManagedInstance.status` uses `"running" | "dead"` but `DbInstance.status` uses `"running" | "stopped"`. These should be aligned to `"running" | "stopped"` (DB wins — "stopped" is more accurate than "dead" for a process that exited).

**Status utilities are duplicated** in three places: `format-utils.ts`, `mock-data.ts`, and `history/page.tsx`.

**`process-manager.ts`** cascades `"disconnected"` into `DbSession.status` when instances die (lines 548, 631). After the refactor, instance death should set the session lifecycle to `"stopped"`, not leak a connection concept into session status.

### Naming Decisions

| Concept | Old Values | New Values | Rationale |
|---------|-----------|------------|-----------|
| Session Activity | `"active"`, `"idle"`, `"waiting_input"` | `"busy"`, `"idle"`, `"waiting_input"` | Align with SDK terminology; `"busy"` is unambiguous |
| Session Lifecycle | `"completed"`, `"error"`, `"stopped"`, `"disconnected"` | `"running"`, `"completed"`, `"error"`, `"stopped"` | `"disconnected"` is a connection concept, not lifecycle; add explicit `"running"` |
| Connection Status | (mixed into session status) | `"connecting"`, `"connected"`, `"recovering"`, `"disconnected"`, `"error"` | Already exists in `useSessionEvents`, just needs to be the single source of truth |
| Instance Status | `"running"` / `"dead"` (memory) vs `"running"` / `"stopped"` (DB) | `"running"`, `"stopped"` | `"stopped"` is more precise than `"dead"`; align memory with DB |

## Objectives
### Core Objective
Split the hybrid 7-value `SessionStatus` into three distinct, well-named types so that every variable, column, API field, and UI reference uses the correct concept.

### Deliverables
- [ ] New type definitions: `SessionActivityStatus`, `SessionLifecycleStatus`, `SessionConnectionStatus` (already exists), `InstanceStatus`
- [ ] DB schema migration: split `sessions.status` into `sessions.activity_status` + `sessions.lifecycle_status`
- [ ] API response shape: `SessionListItem` gets `activityStatus` + `lifecycleStatus` instead of hybrid `sessionStatus`
- [ ] All server-side code uses new types and column names
- [ ] All frontend code uses the correctly-typed fields
- [ ] All tests updated and passing
- [ ] Status utility functions consolidated (remove duplicates)

### Definition of Done
- [ ] `npm run build` passes with zero errors
- [ ] `npm run test` passes (all existing + updated tests)
- [ ] UI looks and behaves identically (manual spot-check: fleet page, session detail, sidebar, history)
- [ ] No references to the old hybrid `SessionStatus` type remain (grep verification)
- [ ] No `"active"` string literal used for session status anywhere (replaced by `"busy"`)

### Guardrails (Must NOT)
- Must NOT change any user-visible behavior or appearance
- Must NOT break the SQLite database for existing users (migration must handle existing data)
- Must NOT change the SDK types or `@opencode-ai/sdk` dependency
- Must NOT rename `SessionConnectionStatus` in `use-session-events.ts` (it's already correct)

---

## TODOs

### Phase 1: New Type Definitions (no behavior change)

- [ ] 1. **Define new status types in `src/lib/types.ts`**
  **What**: Add three new type aliases alongside the existing `SessionStatus` (don't remove it yet). This allows incremental migration.
  **Files**: `src/lib/types.ts`
  **Changes**:
  ```typescript
  // NEW — add these types
  export type SessionActivityStatus = "busy" | "idle" | "waiting_input";
  export type SessionLifecycleStatus = "running" | "completed" | "stopped" | "error";
  export type InstanceStatus = "running" | "stopped";

  // KEEP the old SessionStatus for now (will be removed in Phase 5)
  // export type SessionStatus = "active" | "idle" | "waiting_input" | "completed" | "error" | "stopped" | "disconnected";
  ```
  **Acceptance**: `npm run build` passes; old code still compiles.

- [ ] 2. **Update `SessionListItem` in `src/lib/api-types.ts` to add new fields**
  **What**: Add `activityStatus` and `lifecycleStatus` fields to `SessionListItem`, keeping the old `sessionStatus` field temporarily for backward compatibility.
  **Files**: `src/lib/api-types.ts`
  **Changes**:
  ```typescript
  export interface SessionListItem {
    // ... existing fields ...
    sessionStatus: SessionStatus;           // KEEP temporarily
    activityStatus: SessionActivityStatus;  // NEW
    lifecycleStatus: SessionLifecycleStatus; // NEW
    instanceStatus: InstanceStatus;         // Already exists, retype with new alias
  }
  ```
  **Acceptance**: `npm run build` passes; new fields exist alongside old ones.

- [ ] 3. **Update `Session` interface in `src/lib/types.ts`**
  **What**: Add `activityStatus` and `lifecycleStatus` to the `Session` interface (used by mock data and legacy components), keeping old `status` field.
  **Files**: `src/lib/types.ts`
  **Changes**: Add `activityStatus?: SessionActivityStatus` and `lifecycleStatus?: SessionLifecycleStatus` to `Session` interface.
  **Acceptance**: `npm run build` passes.

### Phase 2: DB Schema Migration

- [ ] 4. **Add new columns to SQLite schema**
  **What**: Add `activity_status` and `lifecycle_status` columns to the `sessions` table. Keep the old `status` column for now. Add a migration that populates the new columns from the old one.
  **Files**: `src/lib/server/database.ts`
  **Changes**:
  - In the sessions table creation, add:
    ```sql
    activity_status TEXT NOT NULL DEFAULT 'idle',
    lifecycle_status TEXT NOT NULL DEFAULT 'running'
    ```
  - Add a post-creation migration block that runs:
    ```sql
    -- Populate new columns from old status column for existing rows
    UPDATE sessions SET
      activity_status = CASE
        WHEN status = 'active' THEN 'busy'
        WHEN status = 'idle' THEN 'idle'
        WHEN status = 'waiting_input' THEN 'waiting_input'
        ELSE 'idle'
      END,
      lifecycle_status = CASE
        WHEN status IN ('completed') THEN 'completed'
        WHEN status IN ('stopped', 'disconnected') THEN 'stopped'
        WHEN status IN ('error') THEN 'error'
        ELSE 'running'
      END
    WHERE activity_status = 'idle' AND lifecycle_status = 'running';
    ```
  **Acceptance**: App starts without DB errors; existing data is correctly migrated. Check with: `sqlite3 <db-path> "SELECT status, activity_status, lifecycle_status FROM sessions LIMIT 10;"`.

- [ ] 5. **Update `DbSession` type and repository functions**
  **What**: Add `activity_status` and `lifecycle_status` to `DbSession` interface. Create new repository functions `updateSessionActivityStatus()` and `updateSessionLifecycleStatus()`. Keep old `updateSessionStatus()` working but have it write to all three columns.
  **Files**: `src/lib/server/db-repository.ts`
  **Changes**:
  - Add to `DbSession`: `activity_status: string; lifecycle_status: string;`
  - Add function `updateSessionActivityStatus(sessionId: string, status: SessionActivityStatus)` — updates `activity_status` column
  - Add function `updateSessionLifecycleStatus(sessionId: string, status: SessionLifecycleStatus)` — updates `lifecycle_status` column
  - Modify `updateSessionStatus()` to also write to the new columns (bridge function):
    ```typescript
    // Map old hybrid status to new split columns
    const activityMap: Record<string, string> = { active: "busy", idle: "idle", waiting_input: "waiting_input" };
    const lifecycleMap: Record<string, string> = { completed: "completed", stopped: "stopped", disconnected: "stopped", error: "error" };
    ```
  - Update `getSessionsForWorkspace()` and `getAllSessions()` to SELECT the new columns too
  **Acceptance**: `npm run build` passes; `npm run test` passes for db-repository tests.

### Phase 3: Server-Side Callers — Write to New Columns

- [ ] 6. **Update `session-status-watcher.ts` to use new activity status**
  **What**: Replace calls to `updateSessionStatus("active")` with `updateSessionActivityStatus("busy")`. Replace `updateSessionStatus("idle")` with `updateSessionActivityStatus("idle")`.
  **Files**: `src/lib/server/session-status-watcher.ts`
  **Changes**:
  - Line ~96: `updateSessionStatus(dbSession.id, "active")` → `updateSessionActivityStatus(dbSession.id, "busy")`
  - Line ~101: `updateSessionStatus(dbSession.id, "idle")` → `updateSessionActivityStatus(dbSession.id, "idle")`
  - Import `updateSessionActivityStatus` from db-repository
  **Acceptance**: SDK status changes correctly update `activity_status` column. `npm run test` passes.

- [ ] 7. **Update `callback-monitor.ts` to use new activity status**
  **What**: Replace hybrid status writes with activity-specific writes.
  **Files**: `src/lib/server/callback-monitor.ts`
  **Changes**:
  - All `updateSessionStatus(id, "active")` → `updateSessionActivityStatus(id, "busy")`
  - All `updateSessionStatus(id, "idle")` → `updateSessionActivityStatus(id, "idle")`
  - Import the new function
  **Acceptance**: `npm run test` passes for callback-monitor tests.

- [ ] 8. **Update `process-manager.ts` to use lifecycle status**
  **What**: When an instance dies, update lifecycle status to `"stopped"` instead of setting session status to `"disconnected"`. Fix the `ManagedInstance.status` type from `"dead"` to `"stopped"` to align with DB.
  **Files**: `src/lib/server/process-manager.ts`
  **Changes**:
  - Lines ~548, ~631: `updateSessionStatus(sessionId, "disconnected")` → `updateSessionLifecycleStatus(sessionId, "stopped")`
  - `ManagedInstance` interface: `status: "running" | "dead"` → `status: InstanceStatus` (i.e., `"running" | "stopped"`)
  - All assignments `instance.status = "dead"` → `instance.status = "stopped"`
  - All checks `instance.status === "dead"` → `instance.status === "stopped"`
  - Import `InstanceStatus`, `updateSessionLifecycleStatus`
  **Acceptance**: `npm run build` passes; instance death correctly sets lifecycle to `"stopped"`.

- [ ] 9. **Update `api/sessions/route.ts` GET handler — populate new API fields**
  **What**: The GET handler constructs `SessionListItem` objects. Update it to populate `activityStatus` and `lifecycleStatus` from the new DB columns, while still populating the old `sessionStatus` field for backward compat.
  **Files**: `src/app/api/sessions/route.ts`
  **Changes**:
  - Read `activity_status` and `lifecycle_status` from `DbSession`
  - Map to `activityStatus` and `lifecycleStatus` on `SessionListItem`
  - For live sessions: override `activityStatus` from SDK status if available (same logic as current, but writing to new field)
  - Keep the existing `sessionStatus` derivation as-is for now
  **Acceptance**: API response includes both old and new fields. `npm run test` passes for route tests.

- [ ] 10. **Update `api/sessions/[id]/route.ts` DELETE handler**
  **What**: The DELETE handler sets status to `"completed"` or `"stopped"`. Update to use new lifecycle function.
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Changes**:
  - `updateSessionStatus(id, "completed")` → `updateSessionLifecycleStatus(id, "completed")` (also set activity to `"idle"`)
  - `updateSessionStatus(id, "stopped")` → `updateSessionLifecycleStatus(id, "stopped")` (also set activity to `"idle"`)
  **Acceptance**: Deleting/stopping a session correctly updates both new columns.

- [ ] 11. **Update `notification-service.ts` if it references hybrid status values**
  **What**: Check if notification types or logic reference old status values and update.
  **Files**: `src/lib/server/notification-service.ts`
  **Changes**: Update any `"active"` → `"busy"` references in notification event types.
  **Acceptance**: `npm run build` passes.

### Phase 4: Frontend — Consume New API Fields

- [ ] 12. **Update fleet dashboard (`src/app/page.tsx`) to use new fields**
  **What**: Replace `session.sessionStatus` reads with `session.activityStatus` and `session.lifecycleStatus`. The grouping/sorting logic should use `lifecycleStatus` for live vs completed, and `activityStatus` for busy vs idle.
  **Files**: `src/app/page.tsx`
  **Changes**:
  - `session.sessionStatus === "active"` → `session.activityStatus === "busy" && session.lifecycleStatus === "running"`
  - `session.sessionStatus === "idle"` → `session.activityStatus === "idle" && session.lifecycleStatus === "running"`
  - Active session count: filter by `activityStatus === "busy"`
  - Keep UI output identical (same labels, colors, dots)
  **Acceptance**: Fleet page renders identically. `npm run build` passes.

- [ ] 13. **Update `live-session-card.tsx` to use new fields**
  **What**: Replace hybrid `sessionStatus` checks with the correct new field.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Changes**:
  - Dot color logic: currently checks `sessionStatus` for `"disconnected"`, `"stopped"`, `"idle"`, `"completed"`, `"active"`. Split into:
    - `lifecycleStatus === "stopped"` → slate dot
    - `lifecycleStatus === "completed"` → blue dot
    - `lifecycleStatus === "error"` → red dot
    - `activityStatus === "busy"` → green pulsing dot
    - `activityStatus === "idle"` → yellow dot
  - Connection status (`"disconnected"`) comes from `instanceStatus === "stopped"` or a separate connection check
  **Acceptance**: Card dots and labels render identically to current behavior.

- [ ] 14. **Update `sidebar-session-item.tsx` to use new fields**
  **What**: Replace hybrid `sessionStatus` dot logic.
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Changes**:
  - Current: checks `sessionStatus` for disconnected/stopped/dead/else
  - New: check `instanceStatus` for dead/stopped, `lifecycleStatus` for stopped, `activityStatus` for busy/idle
  **Acceptance**: Sidebar dots render identically.

- [ ] 15. **Update `sidebar-workspace-item.tsx` to use new fields**
  **What**: Replace hybrid `sessionStatus` checks.
  **Files**: `src/components/layout/sidebar-workspace-item.tsx`
  **Changes**: Use `activityStatus` and `lifecycleStatus` from workspace group data.
  **Acceptance**: Workspace dots render identically.

- [ ] 16. **Update `session-group.tsx` to use new fields**
  **What**: Update group actions that filter by status.
  **Files**: `src/components/fleet/session-group.tsx`
  **Changes**: Replace `sessionStatus` filters with `activityStatus`/`lifecycleStatus`.
  **Acceptance**: Group actions work identically.

- [ ] 17. **Update `workspace-utils.ts` to use new fields**
  **What**: `hasRunningSession` logic currently checks `session.sessionStatus === "active" || session.sessionStatus === "idle"`. Update to use new fields.
  **Files**: `src/lib/workspace-utils.ts`
  **Changes**:
  - `sessionStatus === "active"` → `activityStatus === "busy"`
  - `sessionStatus === "idle"` → `activityStatus === "idle"`
  - `hasRunningSession` → check `lifecycleStatus === "running"`
  **Acceptance**: `npm run test` passes for workspace-utils tests.

- [ ] 18. **Update `history/page.tsx` status utilities**
  **What**: Replace the local `getStatusDot()` / `getStatusColor()` copies with imports from `format-utils.ts`, then update to use new field names.
  **Files**: `src/app/history/page.tsx`
  **Changes**:
  - Remove local status utility functions
  - Import from `format-utils.ts`
  - Update status field references from `sessionStatus` to `activityStatus`/`lifecycleStatus`
  **Acceptance**: History page renders identically.

- [ ] 19. **Update `session/[id]/page.tsx` session detail page**
  **What**: This page already uses `status` (connection) and `sessionStatus` (activity) from `useSessionEvents`. The data from the API route also needs to use new fields for the initial/fallback state.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**: Update any `sessionStatus` references from the API data to use `activityStatus`/`lifecycleStatus`.
  **Acceptance**: Session detail page renders identically.

- [ ] 20. **Update `activity-stream-v1.tsx`**
  **What**: Receives status props — ensure prop names align with new terminology.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**: Update prop types and internal references if they use the hybrid status.
  **Acceptance**: Activity stream renders identically.

### Phase 5: Consolidate Status Utilities & Clean Up

- [ ] 21. **Update `format-utils.ts` — single source of truth for status display**
  **What**: Update `getStatusColor()` and `getStatusDot()` to accept the new types. These should accept `activityStatus` + `lifecycleStatus` + `instanceStatus` as separate params instead of a single hybrid status.
  **Files**: `src/lib/format-utils.ts`
  **Changes**:
  ```typescript
  // OLD
  export function getStatusColor(status: SessionStatus): string
  // NEW
  export function getStatusColor(activity: SessionActivityStatus, lifecycle: SessionLifecycleStatus, instance?: InstanceStatus): string
  ```
  - Same mapping, just from three inputs instead of one
  - Update all callers (already done in Phase 4 tasks)
  **Acceptance**: All callers compile. Colors remain identical.

- [ ] 22. **Update `mock-data.ts` — remove duplicate status utilities**
  **What**: Remove the duplicate `getStatusColor()`/`getStatusDot()` from mock-data. Update mock `Session` objects to use new fields.
  **Files**: `src/lib/mock-data.ts`
  **Changes**:
  - Remove local status utility functions
  - Update mock data: `status: "active"` → `activityStatus: "busy", lifecycleStatus: "running"`
  **Acceptance**: `npm run build` passes.

- [ ] 23. **Update `session-card.tsx` (legacy component)**
  **What**: Uses `Session` from `types.ts` with old `status` field.
  **Files**: `src/components/fleet/session-card.tsx`
  **Changes**: Update to use `activityStatus`/`lifecycleStatus` from the updated `Session` interface.
  **Acceptance**: `npm run build` passes.

- [ ] 24. **Remove old hybrid `SessionStatus` type and `status` field**
  **What**: Now that all consumers use the new types, remove the old `SessionStatus` type from `types.ts`, remove the `status` field from `Session`, and remove the `sessionStatus` field from `SessionListItem`.
  **Files**: `src/lib/types.ts`, `src/lib/api-types.ts`
  **Changes**:
  - Delete `export type SessionStatus = "active" | "idle" | ...`
  - Remove `status: SessionStatus` from `Session` interface
  - Remove `sessionStatus: SessionStatus` from `SessionListItem`
  - Keep the re-export of SDK `SessionStatus` in `api-types.ts` if it's used by SDK integration code
  **Acceptance**: `npm run build` passes with zero references to old `SessionStatus` type (except SDK re-export).

- [ ] 25. **Remove old `status` column from DB (or leave as deprecated)**
  **What**: Either drop the old `status` column or mark it deprecated. Dropping requires careful consideration — if any external tools read the DB directly, this could break them. Recommendation: leave it but stop writing to it. Remove the bridge logic from `updateSessionStatus()`.
  **Files**: `src/lib/server/database.ts`, `src/lib/server/db-repository.ts`
  **Changes**:
  - Remove the bridge logic in `updateSessionStatus()` that writes to both old and new columns
  - Optionally rename `updateSessionStatus()` to something clearly deprecated, or remove it entirely if no callers remain
  - Remove `status` from `DbSession` interface (stop reading it)
  **Acceptance**: `npm run build` passes; `npm run test` passes.

### Phase 6: Test Updates

- [ ] 26. **Update `workspace-utils.test.ts`**
  **What**: Update test fixtures to use `activityStatus`/`lifecycleStatus` instead of `sessionStatus`.
  **Files**: `src/lib/__tests__/workspace-utils.test.ts`
  **Changes**: All mock `SessionListItem` objects need `activityStatus` and `lifecycleStatus` fields. Remove old `sessionStatus` field.
  **Acceptance**: All workspace-utils tests pass.

- [ ] 27. **Update `route.test.ts` (sessions API)**
  **What**: Update assertions and mock data for the new API response shape.
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Changes**: Assert `activityStatus` and `lifecycleStatus` in response instead of `sessionStatus`.
  **Acceptance**: All route tests pass.

- [ ] 28. **Update `db-repository.test.ts`**
  **What**: Update tests for new column names and new repository functions.
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **Changes**: Test `updateSessionActivityStatus()` and `updateSessionLifecycleStatus()`. Update existing tests that check `status` column.
  **Acceptance**: All db-repository tests pass.

- [ ] 29. **Update `callback-monitor.test.ts`**
  **What**: Update mock expectations from `"active"` to `"busy"`.
  **Files**: `src/lib/server/__tests__/callback-monitor.test.ts`
  **Changes**: All assertions checking `updateSessionStatus("active")` → `updateSessionActivityStatus("busy")`.
  **Acceptance**: All callback-monitor tests pass.

- [ ] 30. **Update remaining test files**
  **What**: Update `v2-integration.test.ts`, `v2-verification.test.ts`, `session-utils.test.ts`.
  **Files**: `src/lib/server/__tests__/v2-integration.test.ts`, `src/lib/server/__tests__/v2-verification.test.ts`, `src/lib/__tests__/session-utils.test.ts`
  **Changes**: Update any hybrid status references.
  **Acceptance**: All tests pass.

### Phase 7: Final Verification

- [ ] 31. **Grep verification — no stale references**
  **What**: Run grep across the entire codebase to confirm:
  - No references to old `SessionStatus` type (except SDK re-export)
  - No `"active"` string literal used as a session status value
  - No `"disconnected"` used as a session status value (only as connection status)
  - No `"dead"` used as an instance status value
  **Files**: All `src/**/*.{ts,tsx}`
  **Commands**:
  ```bash
  rg '"active"' src/ --include='*.ts' --include='*.tsx'  # Should only match non-status uses
  rg '"disconnected"' src/ --include='*.ts' --include='*.tsx'  # Should only be in connection status
  rg '"dead"' src/ --include='*.ts' --include='*.tsx'  # Should be zero
  rg 'SessionStatus' src/ --include='*.ts' --include='*.tsx'  # Should only be SDK re-export
  ```
  **Acceptance**: All greps return expected results.

- [ ] 32. **Full build and test verification**
  **What**: Run full build and test suite.
  **Commands**:
  ```bash
  npm run build
  npm run test
  ```
  **Acceptance**: Both pass with zero errors.

---

## Verification
- [ ] All tests pass (`npm run test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No stale hybrid status references remain (grep verification)
- [ ] UI appearance is identical (manual check: fleet dashboard, session detail, sidebar, history page)
- [ ] DB migration works for existing data (check `activity_status` and `lifecycle_status` columns populated correctly)
- [ ] Instance status aligned: no `"dead"` references remain, only `"running"` / `"stopped"`

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| DB migration corrupts existing data | Migration is additive (new columns), old column preserved. Mapping logic is deterministic. |
| Frontend/backend deploy out of sync | Phase 2-3 keeps old `sessionStatus` field populated. Frontend can be migrated gradually. |
| SDK re-export of `SessionStatus` conflicts with our new types | Keep SDK re-export under a separate name (`SdkSessionStatus`) or only import it where needed for SDK integration. |
| Forgetting a status reference somewhere | Phase 7 grep verification catches strays. |
| `"waiting_input"` status isn't well-tested | Audit existing tests in Phase 6 to ensure `waiting_input` paths are covered. |

## Implementation Order & Dependencies

```
Phase 1 (types)     → no dependencies, safe to land first
Phase 2 (DB)        → depends on Phase 1 types
Phase 3 (server)    → depends on Phase 2 DB columns
Phase 4 (frontend)  → depends on Phase 3 API serving new fields
Phase 5 (cleanup)   → depends on Phase 4 (all consumers migrated)
Phase 6 (tests)     → can be done incrementally alongside Phases 2-5
Phase 7 (verify)    → final, after everything else
```

Each phase can be landed as a separate PR for safer review, or phases 1-3 and 4-6 can be grouped into two PRs (backend + frontend).
