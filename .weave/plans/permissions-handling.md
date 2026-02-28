# User-Controlled Permissions for Weave Agent Fleet

## TL;DR
> **Summary**: Replace hardcoded `"allow"` permission config with a configurable permission policy system that captures `permission.*` SSE events, surfaces pending permission requests in the UI with contextual detail, allows users to approve/reject/always-allow, and persists an audit trail of all permission decisions.
> **Estimated Effort**: Large

## Context

### Original Request
Add user-controlled permissions to the weave-agent-fleet orchestrator so users can configure which agent actions require approval, see pending permission requests in real-time, and approve/reject them through the UI — replacing the current hardcoded `{ edit: "allow", bash: "allow" }` config.

### Key Findings

1. **Hardcoded permissions at spawn** — `src/lib/server/process-manager.ts` line 256 passes `permission: { edit: "allow", bash: "allow" }` to `createOpencodeServer()`. The SDK `Config` type supports `edit`, `bash`, `webfetch`, `doom_loop`, and `external_directory` fields with values `"ask" | "allow" | "deny"`. The `bash` field also accepts a map of pattern-specific overrides.

2. **SDK Permission type** — The `@opencode-ai/sdk` exports a `Permission` type (from `types.gen.d.ts` line 369):
   ```typescript
   Permission = {
     id: string; type: string; pattern?: string | string[];
     sessionID: string; messageID: string; callID?: string;
     title: string; metadata: Record<string, unknown>;
     time: { created: number };
   }
   ```

3. **SDK Permission reply API** — `client.postSessionIdPermissionsPermissionId()` accepts `{ body: { response: "once" | "always" | "reject" }, path: { id, permissionID } }`. Returns `200: boolean`. This is the **only** method — there is no `sdk.permission.list()` or `sdk.permission.reply()` convenience wrapper. The raw method name is awkward but functional.

4. **SSE events already forwarded** — `src/lib/event-state.ts` lines 187-189 already detect `permission.*` events and filter by sessionID. The SSE proxy in `route.ts` forwards them. The client-side `handleEvent()` in `use-session-events.ts` does **not** handle them — they're silently dropped.

5. **Two permission events exist**:
   - `permission.updated` (type: `EventPermissionUpdated`) — fires when a new permission request is created. Carries the full `Permission` object as properties.
   - `permission.replied` (type: `EventPermissionReplied`) — fires when a permission is resolved. Carries `{ sessionID, permissionID, response }`.

6. **Notification system is established** — `notification-service.ts` writes to SQLite with dedup. `use-notifications.ts` polls every 10s. Bell icon shows unread count. Pattern is well-established for adding `permission_requested` notification type.

7. **No global event bus** — Each SSE connection is per-session. For fleet-wide permission awareness, we need either polling or the existing notification system (polling is the established pattern).

8. **Session detail page** — `src/app/sessions/[id]/page.tsx` uses `useSessionEvents` hook. The hook returns `{ messages, status, sessionStatus }`. Permission requests need a new return field. The page has a sidebar and activity stream where permission UI can be integrated.

9. **Fleet summary** — `src/app/api/fleet/summary/route.ts` returns aggregate stats. Can be extended with `pendingPermissions` count.

10. **Database pattern** — `database.ts` uses `better-sqlite3` (synchronous). Schema is created in `getDb()`. Migrations are ALTER TABLE in try/catch. `db-repository.ts` has typed CRUD functions.

11. **Test pattern** — Tests use `WEAVE_DB_PATH` env var pointed to tmpdir, `_resetDbForTests()`, vitest globals, `PascalCase` test names.

### Architecture Decisions

**Decision 1: Permission policy stored in a DB table, not config files.**
Config files are per-instance and lost on restart. A `permission_policies` table allows global defaults + per-workspace overrides, persists across restarts, and is editable via API.

**Decision 2: In-memory permission request tracking + DB audit trail.**
Pending permission requests are transient (they exist only while an agent is blocked). Track them in-memory via a Map in the SSE proxy, and persist every decision to a `permission_audit_log` table for compliance.

**Decision 3: Permission requests surfaced via SSE + notification system (no new polling endpoint).**
The SSE stream already delivers `permission.*` events to the session detail page. For fleet-wide awareness, create a notification when a permission is pending. The bell icon alerts users even when not viewing the blocked session.

**Decision 4: Phased delivery — each phase is independently shippable.**
Phase 1 gets the plumbing working (configurable spawn + reply API). Phase 2 adds the UI. Phase 3 adds policy management + audit trail.

## Objectives

### Core Objective
Enable the orchestrator to run OpenCode instances with `"ask"` permissions, capture pending permission requests, surface them to users with rich context, allow approval/rejection, and maintain an audit log of all decisions.

### Deliverables
- [ ] Configurable permission policy (global defaults + per-workspace overrides)
- [ ] Permission request capture from SSE events
- [ ] Permission reply API endpoint proxying to OpenCode SDK
- [ ] Permission approval UI in session detail page
- [ ] Pending permission indicators on session cards and fleet summary
- [ ] Notification integration for pending permissions
- [ ] Permission audit trail in SQLite
- [ ] Backward compatibility (existing "allow-all" behavior preserved as default)

### Definition of Done
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm run test` passes (including new permission tests)
- [ ] `npm run lint` passes
- [ ] Existing sessions with "allow" config continue to work without UI changes
- [ ] Sessions with "ask" permissions show permission requests inline
- [ ] Permission requests can be approved/rejected from the UI
- [ ] Permission decisions are persisted in the audit log
- [ ] Pending permissions create notifications and show on session cards

### Guardrails (Must NOT)
- Must NOT break existing session creation flow
- Must NOT require migration of existing data — new tables only
- Must NOT add a global SSE endpoint — use existing patterns (per-session SSE + polling)
- Must NOT block the SSE stream while waiting for permission reply

---

## TODOs

### Phase 1: Backend Plumbing (configurable permissions + reply API)

- [ ] 1. **Add permission policy database schema**
  **What**: Add two new tables to `database.ts`:
  - `permission_policies` — stores global and per-workspace permission configurations
  - `permission_audit_log` — stores every permission decision for compliance
  **Files**:
  - `src/lib/server/database.ts` — Add tables in `getDb()` schema block (after line 91)
  **Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS permission_policies (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,  -- NULL = global default
    permission_type TEXT NOT NULL,  -- 'edit', 'bash', 'webfetch', 'doom_loop', 'external_directory'
    action TEXT NOT NULL DEFAULT 'allow',  -- 'allow', 'ask', 'deny'
    pattern TEXT,  -- optional: for bash pattern-specific rules
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, permission_type, pattern)
  );

  CREATE TABLE IF NOT EXISTS permission_audit_log (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,  -- OpenCode's permission request ID
    permission_type TEXT NOT NULL,
    title TEXT NOT NULL,
    pattern TEXT,
    metadata TEXT,  -- JSON blob of the permission metadata
    response TEXT,  -- 'once', 'always', 'reject', or NULL if still pending
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_permission_audit_session ON permission_audit_log(session_id);
  CREATE INDEX IF NOT EXISTS idx_permission_audit_pending ON permission_audit_log(response) WHERE response IS NULL;
  ```
  **Acceptance**: `getDb()` creates both tables without error. Existing tables unaffected.

- [ ] 2. **Add permission policy and audit log repository functions**
  **What**: Add typed CRUD functions for the two new tables, following the established pattern in `db-repository.ts`.
  **Files**:
  - `src/lib/server/db-repository.ts` — Add new row types and functions after the Notifications section (after line 302)
  **Functions to add**:
  ```typescript
  // Row types
  interface DbPermissionPolicy { id, workspace_id, permission_type, action, pattern, created_at, updated_at }
  interface DbPermissionAuditLog { id, session_id, instance_id, permission_id, permission_type, title, pattern, metadata, response, responded_at, created_at }

  // Policies
  function getGlobalPermissionPolicies(): DbPermissionPolicy[]
  function getWorkspacePermissionPolicies(workspaceId: string): DbPermissionPolicy[]
  function getEffectivePermissionPolicies(workspaceId?: string): DbPermissionPolicy[]  // workspace overrides merged with globals
  function upsertPermissionPolicy(policy: InsertPermissionPolicy): void
  function deletePermissionPolicy(id: string): void

  // Audit log
  function insertPermissionAuditEntry(entry: InsertPermissionAuditEntry): void
  function updatePermissionAuditResponse(permissionId: string, response: string): void
  function listPermissionAuditLog(opts?: { sessionId?: string; limit?: number }): DbPermissionAuditLog[]
  function countPendingPermissions(sessionId?: string): number
  ```
  **Acceptance**: All functions work with the new tables. Unit tests pass.

- [ ] 3. **Add permission policy types to domain types**
  **What**: Add TypeScript types for permission policies and permission requests to the shared types files.
  **Files**:
  - `src/lib/types.ts` — Add new types after FleetSummary (after line 218)
  - `src/lib/api-types.ts` — Add request/response types for the new API endpoints (after line 104)
  **Types to add in `types.ts`**:
  ```typescript
  export type PermissionAction = "allow" | "ask" | "deny";
  export type PermissionType = "edit" | "bash" | "webfetch" | "doom_loop" | "external_directory";
  export type PermissionResponse = "once" | "always" | "reject";

  export interface PermissionPolicy {
    id: string;
    workspaceId?: string;
    permissionType: PermissionType;
    action: PermissionAction;
    pattern?: string;
  }

  export interface PendingPermission {
    id: string;
    sessionId: string;
    instanceId: string;
    type: string;
    title: string;
    pattern?: string | string[];
    metadata: Record<string, unknown>;
    createdAt: number;
  }
  ```
  **Types to add in `api-types.ts`**:
  ```typescript
  export interface PermissionReplyRequest {
    instanceId: string;
    response: "once" | "always" | "reject";
  }

  export interface PermissionPolicyRequest {
    workspaceId?: string;
    permissionType: string;
    action: "allow" | "ask" | "deny";
    pattern?: string;
  }
  ```
  Also add `"permission_requested"` to the `NotificationType` union in `types.ts` (line 188).
  Also add `pendingPermissions: number` to the `FleetSummary` interface (after line 217).
  **Acceptance**: Types compile with no errors. No runtime changes.

- [ ] 4. **Build permission config from policies at spawn time**
  **What**: Replace the hardcoded `permission: { edit: "allow", bash: "allow" }` in `process-manager.ts` with a function that reads policies from the DB and builds the appropriate config object.
  **Files**:
  - `src/lib/server/process-manager.ts` — Replace line 256 config, add `buildPermissionConfig()` helper
  **Logic**:
  ```typescript
  function buildPermissionConfig(workspaceId?: string): Config["permission"] {
    const policies = getEffectivePermissionPolicies(workspaceId);
    if (policies.length === 0) {
      // Backward compat: default to allow-all
      return { edit: "allow", bash: "allow" };
    }
    const config: Record<string, unknown> = {};
    for (const policy of policies) {
      if (policy.permission_type === "bash" && policy.pattern) {
        // Bash supports pattern-specific overrides
        if (!config.bash || typeof config.bash === "string") {
          config.bash = {};
        }
        (config.bash as Record<string, string>)[policy.pattern] = policy.action;
      } else {
        config[policy.permission_type] = policy.action;
      }
    }
    return config as Config["permission"];
  }
  ```
  Update `spawnInstance()` to accept an optional `workspaceId` parameter for policy lookup. The `POST /api/sessions` route already has the workspace ID available.
  **Acceptance**: With no policies in DB, behavior is identical to current (allow-all). With policies, the config is built correctly.

- [ ] 5. **Add permission reply API endpoint**
  **What**: Create an API route that proxies permission replies to the OpenCode SDK.
  **Files**:
  - `src/app/api/sessions/[id]/permissions/[permissionId]/route.ts` — **New file**
  **Endpoint**: `POST /api/sessions/[id]/permissions/[permissionId]`
  **Request body**: `{ instanceId: string, response: "once" | "always" | "reject" }`
  **Logic**:
  1. Validate inputs
  2. Get the OpenCode client for the instance
  3. Call `client.postSessionIdPermissionsPermissionId({ path: { id: sessionId, permissionID: permissionId }, body: { response } })`
  4. Update the audit log entry with the response
  5. Return 200 on success
  **Acceptance**: Calling the endpoint with a valid permission ID unblocks the agent. Audit log is updated.

- [ ] 6. **Capture permission events in SSE proxy and create audit entries + notifications**
  **What**: In the SSE event proxy, detect `permission.updated` and `permission.replied` events and:
  - On `permission.updated`: Insert a pending audit log entry + create a notification
  - On `permission.replied`: Update the audit log entry with the response
  **Files**:
  - `src/app/api/sessions/[id]/events/route.ts` — Add permission event handling (after the notification triggers block, ~line 108-146)
  - `src/lib/server/notification-service.ts` — Add `createPermissionRequestedNotification()` function
  **Logic in events/route.ts**:
  ```typescript
  // Inside the event loop, after existing notification triggers:
  if (type === "permission.updated") {
    const perm = properties as Permission;
    try {
      insertPermissionAuditEntry({
        id: randomUUID(),
        session_id: sessionId,
        instance_id: instanceId,
        permission_id: perm.id,
        permission_type: perm.type,
        title: perm.title,
        pattern: Array.isArray(perm.pattern) ? perm.pattern.join(", ") : perm.pattern ?? null,
        metadata: JSON.stringify(perm.metadata),
      });
      createPermissionRequestedNotification(sessionId, instanceId, perm.title);
    } catch { /* best-effort */ }
  }

  if (type === "permission.replied") {
    try {
      updatePermissionAuditResponse(properties.permissionID, properties.response);
    } catch { /* best-effort */ }
  }
  ```
  **Acceptance**: When an agent hits an "ask" permission, a notification appears and an audit entry is created. When replied, the audit entry is updated.

- [ ] 7. **Add permission policy CRUD API endpoints**
  **What**: Create API routes for managing permission policies.
  **Files**:
  - `src/app/api/permissions/policies/route.ts` — **New file**: `GET` (list all), `POST` (create/update)
  - `src/app/api/permissions/policies/[id]/route.ts` — **New file**: `DELETE` (remove)
  - `src/app/api/permissions/audit/route.ts` — **New file**: `GET` (list audit log, with optional `?sessionId=` filter)
  **Acceptance**: Can CRUD permission policies via API. Audit log is queryable.

- [ ] 8. **Update fleet summary to include pending permissions count**
  **What**: Add `pendingPermissions` to the fleet summary API response.
  **Files**:
  - `src/app/api/fleet/summary/route.ts` — Add `pendingPermissions: countPendingPermissions()` to the response (line 27)
  **Acceptance**: Fleet summary includes pending permission count.

- [ ] 9. **Write unit tests for permission repository and notification functions**
  **What**: Test the new DB functions and notification service additions.
  **Files**:
  - `src/lib/server/__tests__/permission-repository.test.ts` — **New file**
  - `src/lib/server/__tests__/notification-service.test.ts` — Add tests for `createPermissionRequestedNotification`
  **Test cases**:
  - Policy CRUD (insert, get global, get workspace, effective merge, delete)
  - Audit log (insert pending, update response, count pending, list with filters)
  - Permission notification creation and dedup
  - `buildPermissionConfig()` with various policy combinations
  - Default behavior with no policies (backward compat)
  **Acceptance**: All tests pass. `npm run test` green.

### Phase 2: Frontend — Permission Request UI

- [ ] 10. **Extend `useSessionEvents` hook to track pending permissions**
  **What**: Add permission request tracking to the session events hook. Handle `permission.updated` and `permission.replied` events to maintain a list of pending permissions.
  **Files**:
  - `src/hooks/use-session-events.ts` — Add `pendingPermissions` state and handlers in `handleEvent()`
  - `src/lib/api-types.ts` — Ensure `PendingPermission` type is importable client-side
  **Changes to `handleEvent()`** (after line 247):
  ```typescript
  if (type === "permission.updated") {
    const perm = properties;
    setPendingPermissions((prev) => {
      // Avoid duplicates
      if (prev.some((p) => p.id === perm.id)) return prev;
      return [...prev, {
        id: perm.id,
        sessionId: perm.sessionID,
        instanceId: "", // filled by hook
        type: perm.type,
        title: perm.title,
        pattern: perm.pattern,
        metadata: perm.metadata ?? {},
        createdAt: perm.time?.created ?? Date.now(),
      }];
    });
    return;
  }

  if (type === "permission.replied") {
    setPendingPermissions((prev) =>
      prev.filter((p) => p.id !== properties.permissionID)
    );
    return;
  }
  ```
  **Updated return type**:
  ```typescript
  interface UseSessionEventsResult {
    messages: AccumulatedMessage[];
    status: SessionConnectionStatus;
    sessionStatus: "idle" | "busy";
    pendingPermissions: PendingPermission[];
    error?: string;
  }
  ```
  **Acceptance**: Hook tracks pending permissions. When a permission event arrives, the list updates.

- [ ] 11. **Create `usePermissionReply` hook**
  **What**: A hook that calls the permission reply API endpoint.
  **Files**:
  - `src/hooks/use-permission-reply.ts` — **New file**
  **Interface**:
  ```typescript
  interface UsePermissionReplyResult {
    replyToPermission: (sessionId: string, permissionId: string, instanceId: string, response: "once" | "always" | "reject") => Promise<void>;
    isReplying: boolean;
    error?: string;
  }
  ```
  **Acceptance**: Hook can approve/reject a permission request. Loading and error states work.

- [ ] 12. **Create `PermissionRequestCard` component**
  **What**: A card component that displays a pending permission request with context and action buttons.
  **Files**:
  - `src/components/session/permission-request-card.tsx` — **New file**
  **Design**:
  - Shows permission type icon (shield for edit, terminal for bash, globe for webfetch)
  - Title: `perm.title` (e.g., "Edit src/lib/foo.ts")
  - Pattern: file paths or command patterns
  - Metadata preview: for edits show a brief diff summary, for bash show the command
  - Three action buttons: "Allow Once", "Always Allow", "Reject"
  - Timestamp showing how long the request has been pending
  - Subtle pulsing border to draw attention
  **Component props**:
  ```typescript
  interface PermissionRequestCardProps {
    permission: PendingPermission;
    onReply: (permissionId: string, response: "once" | "always" | "reject") => void;
    isReplying?: boolean;
  }
  ```
  **Acceptance**: Card renders with all fields. Buttons call `onReply`. Loading state shown during reply.

- [ ] 13. **Create `PermissionRequestBanner` component**
  **What**: A banner/bar component that appears at the top of the activity stream when permissions are pending, showing count and an expandable list.
  **Files**:
  - `src/components/session/permission-request-banner.tsx` — **New file**
  **Design**:
  - Amber/warning colored bar: "⚠ {n} permission request(s) waiting for approval"
  - Expandable: clicking reveals the list of `PermissionRequestCard` components
  - Auto-expands when there's only 1 pending request
  - Collapses smoothly when all permissions are resolved
  **Acceptance**: Banner appears when `pendingPermissions.length > 0`. Cards render inside. Actions work.

- [ ] 14. **Integrate permission UI into session detail page**
  **What**: Wire the permission banner and cards into the session detail page.
  **Files**:
  - `src/app/sessions/[id]/page.tsx` — Destructure `pendingPermissions` from `useSessionEvents`, render `PermissionRequestBanner` above the activity stream
  - `src/components/session/activity-stream-v1.tsx` — Optionally show inline permission indicators in the message stream (when a tool call is blocked on a permission)
  **Changes to page.tsx**:
  ```typescript
  const { messages, status, sessionStatus, pendingPermissions } = useSessionEvents(sessionId, instanceId);
  const { replyToPermission, isReplying } = usePermissionReply();

  // In the JSX, before <ActivityStreamV1>:
  <PermissionRequestBanner
    permissions={pendingPermissions}
    onReply={(permissionId, response) => replyToPermission(sessionId, permissionId, instanceId, response)}
    isReplying={isReplying}
  />
  ```
  **Acceptance**: Permission requests appear in the session detail page. Users can approve/reject. Agent unblocks after approval.

- [ ] 15. **Add pending permission indicator to session cards**
  **What**: Show a visual indicator on `LiveSessionCard` when a session has pending permissions.
  **Files**:
  - `src/components/fleet/live-session-card.tsx` — Add an amber badge or icon when pending permissions exist
  - `src/lib/api-types.ts` — Add optional `pendingPermissions?: number` to `SessionListItem`
  - `src/app/api/sessions/route.ts` — Enrich `SessionListItem` with pending permission count from the audit log
  **Design**: Small amber shield icon with count badge, positioned next to the session title. Pulsing animation to draw attention.
  **Acceptance**: Session cards show pending permission count. Fleet view makes it clear which sessions need attention.

- [ ] 16. **Add pending permissions to fleet summary bar**
  **What**: Show pending permissions count in the summary bar.
  **Files**:
  - `src/components/fleet/summary-bar.tsx` — Add a "Pending" item with a shield icon (after line 67)
  - `src/hooks/use-fleet-summary.ts` — Already fetches from `/api/fleet/summary`, just needs the new field
  - `src/lib/types.ts` — `FleetSummary` already updated in task 3
  **Acceptance**: Summary bar shows pending permission count.

- [ ] 17. **Add `permission_requested` to notification bell icon**
  **What**: The bell icon should show a shield icon for permission notifications and clicking navigates to the session.
  **Files**:
  - `src/components/notifications/notification-bell.tsx` — Add `permission_requested` case to `getNotificationIcon()` (after line 26), using a `Shield` icon from lucide-react
  **Acceptance**: Permission notifications appear in the bell dropdown with a shield icon.

### Phase 3: Policy Management UI + Audit Trail

- [ ] 18. **Create `usePermissionPolicies` hook**
  **What**: Hook for fetching and mutating permission policies.
  **Files**:
  - `src/hooks/use-permission-policies.ts` — **New file**
  **Interface**:
  ```typescript
  interface UsePermissionPoliciesResult {
    policies: PermissionPolicy[];
    isLoading: boolean;
    createPolicy: (policy: PermissionPolicyRequest) => Promise<void>;
    deletePolicy: (id: string) => Promise<void>;
    error?: string;
  }
  ```
  **Acceptance**: Hook fetches policies on mount, supports create/delete.

- [ ] 19. **Create permission policy settings UI**
  **What**: A settings panel (accessible from the header or a settings page) where users configure global permission defaults.
  **Files**:
  - `src/components/settings/permission-policy-editor.tsx` — **New file**
  **Design**:
  - Grid/table showing each permission type (edit, bash, webfetch, doom_loop, external_directory)
  - Each row has a three-way toggle: Allow / Ask / Deny
  - Separate section for workspace-specific overrides
  - Changes are saved immediately via the API
  - Clear indication of effective policy (global + overrides merged)
  **Acceptance**: Users can change permission policies. Changes persist and affect new instances.

- [ ] 20. **Create permission audit log viewer**
  **What**: A page or panel showing the history of all permission decisions.
  **Files**:
  - `src/app/permissions/page.tsx` — **New file**: Full permissions management page with policy editor and audit log
  - `src/hooks/use-permission-audit.ts` — **New file**: Hook for fetching audit log
  **Design**:
  - Table with columns: Time, Session, Permission Type, Title/Pattern, Decision, Response Time
  - Filterable by session, permission type, response
  - Shows pending items at the top with amber highlight
  - Links to session detail page for each entry
  **Acceptance**: Audit log is viewable. Shows all permission decisions with full context.

- [ ] 21. **Add permissions nav item to sidebar**
  **What**: Add a "Permissions" link to the sidebar navigation.
  **Files**:
  - `src/components/layout/sidebar.tsx` — Add nav item with Shield icon, pointing to `/permissions`
  **Acceptance**: Sidebar has a Permissions link. Badge shows pending count.

- [ ] 22. **Handle edge cases**
  **What**: Handle timeout, stale requests, bulk operations, and session termination while permissions are pending.
  **Files**:
  - `src/hooks/use-session-events.ts` — Clear pending permissions when session status becomes "idle" (agent gave up or was aborted)
  - `src/app/api/sessions/[id]/route.ts` — On DELETE, clear pending audit entries for the session
  - `src/components/session/permission-request-card.tsx` — Show "stale" state if permission has been pending for >2 minutes
  - `src/app/api/sessions/[id]/permissions/bulk/route.ts` — **New file**: `POST` endpoint for bulk approve/reject (accept array of permissionIds)
  **Edge cases**:
  - Agent aborted while permission pending → `session.idle` event clears pending permissions
  - Instance dies while permission pending → health check marks session disconnected, pending permissions become moot
  - Multiple permissions arrive simultaneously → banner shows all, each independently actionable
  - User rejects with feedback → `reject` response (the SDK's `response` field doesn't support message, but the rejection is sufficient to trigger a `CorrectedError` in OpenCode)
  - Permission resolved externally (another client replied) → `permission.replied` event clears it from the UI
  **Acceptance**: No orphaned pending permissions. Stale indicators appear. Bulk operations work.

- [ ] 23. **Write integration tests for the permission flow**
  **What**: End-to-end test verifying the permission request → notification → reply → unblock flow.
  **Files**:
  - `src/lib/server/__tests__/permission-integration.test.ts` — **New file**
  **Test scenarios**:
  - Policy with "ask" → spawn instance → agent triggers permission → audit entry created → notification created
  - Permission reply updates audit entry
  - Bulk permission reply
  - Default policy (no config) → allow-all behavior preserved
  - Session termination clears pending audit entries
  - Fleet summary includes pending count
  **Acceptance**: All integration tests pass.

## Verification

- [ ] All tests pass: `npm run test`
- [ ] Build succeeds: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] No regressions: existing sessions still work with allow-all defaults
- [ ] Permission flow works end-to-end: set policy to "ask", create session, trigger permission, approve from UI, agent continues
- [ ] Audit log shows all permission decisions
- [ ] Notifications fire for pending permissions
- [ ] Fleet summary and session cards show pending counts

## File Change Summary

### New Files (12)
| File | Purpose |
|------|---------|
| `src/app/api/sessions/[id]/permissions/[permissionId]/route.ts` | Permission reply API |
| `src/app/api/sessions/[id]/permissions/bulk/route.ts` | Bulk permission reply |
| `src/app/api/permissions/policies/route.ts` | Policy CRUD API |
| `src/app/api/permissions/policies/[id]/route.ts` | Policy delete API |
| `src/app/api/permissions/audit/route.ts` | Audit log API |
| `src/hooks/use-permission-reply.ts` | Permission reply hook |
| `src/hooks/use-permission-policies.ts` | Policy management hook |
| `src/hooks/use-permission-audit.ts` | Audit log hook |
| `src/components/session/permission-request-card.tsx` | Permission request UI card |
| `src/components/session/permission-request-banner.tsx` | Permission banner in session view |
| `src/components/settings/permission-policy-editor.tsx` | Policy settings UI |
| `src/app/permissions/page.tsx` | Permissions management page |

### Modified Files (14)
| File | Change |
|------|--------|
| `src/lib/server/database.ts` | Add `permission_policies` and `permission_audit_log` tables |
| `src/lib/server/db-repository.ts` | Add policy and audit CRUD functions |
| `src/lib/server/process-manager.ts` | Replace hardcoded permissions with `buildPermissionConfig()` |
| `src/lib/server/notification-service.ts` | Add `createPermissionRequestedNotification()` |
| `src/lib/types.ts` | Add permission types, update `NotificationType` and `FleetSummary` |
| `src/lib/api-types.ts` | Add permission request/response types |
| `src/app/api/sessions/[id]/events/route.ts` | Handle `permission.*` events (audit + notifications) |
| `src/app/api/fleet/summary/route.ts` | Add `pendingPermissions` to response |
| `src/app/api/sessions/route.ts` | Enrich session list with pending permission count |
| `src/app/api/sessions/[id]/route.ts` | Clear pending audit entries on DELETE |
| `src/hooks/use-session-events.ts` | Track `pendingPermissions` state |
| `src/app/sessions/[id]/page.tsx` | Render permission banner |
| `src/components/fleet/live-session-card.tsx` | Show pending permission indicator |
| `src/components/fleet/summary-bar.tsx` | Show pending permissions count |
| `src/components/notifications/notification-bell.tsx` | Add permission notification icon |
| `src/components/layout/sidebar.tsx` | Add Permissions nav item |

### New Test Files (2)
| File | Purpose |
|------|---------|
| `src/lib/server/__tests__/permission-repository.test.ts` | Unit tests for policy and audit CRUD |
| `src/lib/server/__tests__/permission-integration.test.ts` | Integration tests for permission flow |

### Modified Test Files (1)
| File | Change |
|------|--------|
| `src/lib/server/__tests__/notification-service.test.ts` | Add tests for permission notification |

## Dependency Graph

```
Phase 1 (Backend):
  1 (DB schema) → 2 (repository) → 3 (types) → 4 (spawn config) → 5 (reply API)
                                       ↓
                                  6 (SSE capture) → 7 (policy API) → 8 (fleet summary) → 9 (tests)

Phase 2 (Frontend):
  10 (hook) → 11 (reply hook) → 12 (card component) → 13 (banner component) → 14 (page integration)
                                                                                  ↓
                                                              15 (card indicator) → 16 (summary bar) → 17 (bell icon)

Phase 3 (Management):
  18 (policies hook) → 19 (policy editor) → 20 (audit viewer) → 21 (sidebar nav) → 22 (edge cases) → 23 (integration tests)
```

Tasks within a phase are sequential. Phases can overlap after the first few tasks of Phase 1 are complete (tasks 1-5 are prerequisites for Phase 2).
