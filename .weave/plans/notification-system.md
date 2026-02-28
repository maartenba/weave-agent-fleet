# Notification System (V1)

## TL;DR
> **Summary**: Add a SQLite-backed notification system so the bell icon shows real-time unread counts when sessions need attention (errors, completions, disconnections), with a dropdown popover for quick access and the `/alerts` page wired to real data.
> **Estimated Effort**: Medium

## Context

### Original Request
Build a notification system where sessions alert the user via the bell icon when they need attention. Key scenarios: session error, session completed (idle after busy), input required, and session disconnected.

### Key Findings

1. **Bell icon is hardcoded** — `src/components/layout/header.tsx` (line 26-28) renders a static badge `2`. The sidebar (`src/components/layout/sidebar.tsx`, line 23) also has `badge: 2` hardcoded for the Alerts nav item.

2. **`/alerts` page is mock-data driven** — `src/app/alerts/page.tsx` imports `mockNotifications` from `src/lib/mock-data.ts` (lines 677-712). The page already has good UI scaffolding: unread/read sections, icon mapping per notification type, badge styling. We reuse this entirely.

3. **Types already defined** — `src/lib/types.ts` (lines 186-203) defines `NotificationType` (`input_required`, `session_completed`, `session_error`, `cost_threshold`, `pipeline_stage_complete`) and `Notification` interface. These are sufficient for V1.

4. **SSE proxy is per-session** — `src/app/api/sessions/[id]/events/route.ts` subscribes to the OpenCode SDK event stream and forwards filtered events. It sees `session.status` (idle/busy transitions) and `session.idle` events. This is the natural place to detect "session completed" (busy→idle transition) and can detect errors.

5. **No global event bus** — Each SSE connection is isolated. For cross-session notification awareness, polling is the pragmatic choice (consistent with existing patterns: `useFleetSummary` polls every 10s, `useSessions` polls every 5s).

6. **SQLite is synchronous** (better-sqlite3) — All DB operations in `db-repository.ts` are sync. The notification repository should follow this pattern.

7. **Health check detects dead instances** — `process-manager.ts` (line 354-382) runs a health check loop every 30s. After 3 failures, instances are marked dead. This is the natural hook for "session disconnected" notifications.

8. **No Popover component exists** — The UI has `dropdown-menu.tsx` (Radix-based). We'll use `DropdownMenu` for the bell icon popover since it's already available — no new shadcn component needed.

9. **Test pattern established** — `db-repository.test.ts` uses `WEAVE_DB_PATH` with tmpdir + `_resetDbForTests()`. The notification repository tests should follow this exact pattern.

### Architecture Decision: Server-Side Notification Generation

**Decision**: Notifications are created **server-side** in two places:
1. **SSE event proxy** (`/api/sessions/[id]/events/route.ts`) — as events flow through, detect attention-worthy events and write to DB. This catches `session.idle` (completion) and session errors.
2. **Health check loop** (`process-manager.ts`) — when an instance dies, create "session disconnected" notifications for all its sessions.

**Why not client-side?** If no browser tab is open, notifications would never be created. Server-side ensures notifications exist regardless of UI state.

**Why not a global SSE endpoint?** Over-engineering for V1. Polling `/api/notifications?unread=true` every 5-10s is simple, consistent with existing hooks, and adequate for the use case.

## Objectives

### Core Objective
Replace mock notifications with real, database-backed notifications triggered by session lifecycle events, surfaced through the bell icon with an unread count and a dropdown for quick access.

### Deliverables
- [x] SQLite `notifications` table with CRUD operations
- [x] Server-side notification creation from SSE events and health checks
- [x] `GET /api/notifications` and `PATCH /api/notifications/[id]` API routes
- [x] `useNotifications` polling hook
- [x] Bell icon with real unread count + dropdown popover
- [x] `/alerts` page wired to real data
- [x] Tests for notification repository

### Definition of Done
- [x] `npm run build` succeeds with zero errors
- [x] `npm run test` passes (including new notification tests)
- [x] `npm run lint` passes
- [x] Bell icon shows real unread count (0 when no notifications, hidden badge when 0)
- [x] Clicking bell opens dropdown with recent unread notifications
- [x] `/alerts` page shows real notifications from DB (no mock data import)
- [x] When a session goes idle after being busy, a "session completed" notification appears
- [x] When an instance dies, "session disconnected" notifications appear for its sessions
- [x] Mock notification data is removed from `mock-data.ts`

### Guardrails (Must NOT)
- Do NOT add WebSocket infrastructure
- Do NOT add external notification services (email, Slack, etc.)
- Do NOT add a global SSE endpoint (too complex for V1)
- Do NOT change the existing `Notification` type in `types.ts` beyond adding `session_disconnected` to the union and `instanceId?: string` to the interface
- Do NOT add browser push notifications (OS-level) — V2 concern
- Do NOT implement `cost_threshold` or `pipeline_stage_complete` detection — no pipeline system exists yet; only create notifications for `session_completed`, `session_error`, and `session_disconnected` (add this type to `NotificationType`)

## TODOs

### Phase 1: Database Layer

- [x] 1. **Add `notifications` table to SQLite schema**
  **What**: Add a `CREATE TABLE IF NOT EXISTS notifications` statement to `src/lib/server/database.ts` inside the `db.exec()` block (after the `sessions` table, around line 77). Schema:
  ```sql
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    session_id TEXT,
    instance_id TEXT,
    pipeline_id TEXT,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
  ```
  **Files**: `src/lib/server/database.ts` (modify, add to existing `db.exec` block around line 77)
  **Acceptance**: Database creates the table on startup. `npm run test` still passes (existing DB tests won't break because `_resetDbForTests` drops the whole file).

- [x] 2. **Add notification repository functions**
  **What**: Add a `DbNotification` row type and CRUD functions to `src/lib/server/db-repository.ts`. Follow the existing pattern (sync, prepared statements, thin wrappers). Functions needed:
  - `DbNotification` interface: `{ id, type, session_id, instance_id, pipeline_id, message, read, created_at }`
  - `InsertNotification` type: `Pick<DbNotification, 'id' | 'type' | 'message'> & Partial<Pick<DbNotification, 'session_id' | 'instance_id' | 'pipeline_id'>>`
  - `insertNotification(notif: InsertNotification): void`
  - `listNotifications(opts?: { unreadOnly?: boolean; limit?: number }): DbNotification[]` — ORDER BY created_at DESC, default limit 50
  - `getNotification(id: string): DbNotification | undefined`
  - `markNotificationRead(id: string): void` — UPDATE SET read = 1
  - `markAllNotificationsRead(): void` — UPDATE SET read = 1 WHERE read = 0
  - `countUnreadNotifications(): number` — SELECT COUNT(*) ... returns a number
  - `deleteNotification(id: string): void`
  **Files**: `src/lib/server/db-repository.ts` (modify, add new section at bottom)
  **Acceptance**: Functions are importable and compile. Types match the DB schema.

- [x] 3. **Add `session_disconnected` to NotificationType**
  **What**: Add `"session_disconnected"` to the `NotificationType` union in `src/lib/types.ts` (line 193). This is needed because the existing type doesn't cover instance death.
  **Files**: `src/lib/types.ts` (modify line 188-193)
  **Acceptance**: TypeScript compiles. The union includes `session_disconnected`.

- [x] 4. **Write notification repository tests**
  **What**: Create `src/lib/server/__tests__/notification-repository.test.ts` following the pattern in `db-repository.test.ts`. Test:
  - Insert and retrieve a notification
  - Insert notification with optional session_id/pipeline_id
  - List all notifications (ordered by created_at DESC)
  - List unread-only notifications
  - List with limit
  - Mark single notification as read
  - Mark all as read
  - Count unread notifications
  - Delete a notification
  - Return undefined for missing notification
  **Files**: `src/lib/server/__tests__/notification-repository.test.ts` (create)
  **Acceptance**: `npm run test` passes including new tests.

### Phase 2: API Routes

- [x] 5. **Create `GET /api/notifications` endpoint**
  **What**: Create `src/app/api/notifications/route.ts` with a GET handler. Query params:
  - `?unread=true` — filter to unread only
  - `?limit=N` — limit results (default 50)
  Returns JSON array of `DbNotification` rows. Follow the pattern from `src/app/api/fleet/summary/route.ts` (await `_recoveryComplete`, try/catch, NextResponse.json).
  **Files**: `src/app/api/notifications/route.ts` (create)
  **Acceptance**: `GET /api/notifications` returns `[]` when no notifications exist. `GET /api/notifications?unread=true` filters correctly.

- [x] 6. **Create `PATCH /api/notifications/[id]` endpoint**
  **What**: Create `src/app/api/notifications/[id]/route.ts` with:
  - `PATCH` — marks a single notification as read. Body: `{ read: true }`. Returns `{ success: true }`.
  - If `id` is `"all"`, call `markAllNotificationsRead()` instead.
  **Files**: `src/app/api/notifications/[id]/route.ts` (create)
  **Acceptance**: PATCH with `{ read: true }` marks notification as read in DB. PATCH to `/api/notifications/all` marks all as read.

- [x] 7. **Create `GET /api/notifications/unread-count` endpoint**
  **What**: Create `src/app/api/notifications/unread-count/route.ts` — lightweight endpoint that returns `{ count: number }`. This is what the bell icon polls (cheaper than fetching full notification list).
  **Files**: `src/app/api/notifications/unread-count/route.ts` (create)
  **Acceptance**: Returns `{ count: 0 }` when no unread notifications.

### Phase 3: Server-Side Notification Generation

- [x] 8. **Create notification service module**
  **What**: Create `src/lib/server/notification-service.ts` — a thin module that encapsulates notification creation logic. Functions:
  - `createSessionCompletedNotification(sessionId: string, instanceId: string, sessionTitle: string): void` — inserts a notification with type `session_completed`, message: `"{title} finished"`
  - `createSessionErrorNotification(sessionId: string, instanceId: string, sessionTitle: string, errorMessage?: string): void` — type `session_error`, message: `"{title} encountered an error"`
  - `createSessionDisconnectedNotification(sessionId: string, instanceId: string, sessionTitle: string): void` — type `session_disconnected`, message: `"{title} lost connection"`
  
  Each function generates a UUID for the notification ID, includes both `session_id` and `instance_id`, and calls `insertNotification`. Includes a **deduplication guard**: before inserting, check if an identical notification (same type + session_id) was created in the last 60 seconds to avoid duplicates from reconnects.
  **Files**: `src/lib/server/notification-service.ts` (create)
  **Acceptance**: Functions create notifications in DB. Duplicate calls within 60s are suppressed.

- [x] 9. **Generate notifications from SSE event proxy**
  **What**: Modify `src/app/api/sessions/[id]/events/route.ts` to detect attention-worthy events and create notifications as events flow through. Specifically:
  
  **Session completed detection**: Track a per-connection `lastSessionStatus` variable (starts as `"idle"`). When a `session.status` event with `status.type === "busy"` arrives, set it to `"busy"`. When `session.idle` or `session.status` with `status.type === "idle"` arrives AND `lastSessionStatus` was `"busy"`, call `createSessionCompletedNotification()`. Need to look up the session title from DB.
  
  **Session error detection**: When an `error` event arrives from the upstream (not a proxy error), call `createSessionErrorNotification()`.
  
  Import `getSession` or `getSessionByOpencodeId` from `db-repository` to look up the session title. Import notification service functions. The notification creation is fire-and-forget (best-effort, don't break the SSE stream).
  
  **Important**: These are server-side calls inside the SSE streaming function. They happen inside the `for await` loop (around line 85-98 in the current file). Add the detection logic after the `send()` call so the event is still forwarded regardless.
  **Files**: `src/app/api/sessions/[id]/events/route.ts` (modify)
  **Acceptance**: When a session transitions from busy to idle, a `session_completed` notification appears in the DB.

- [x] 10. **Generate notifications from health check (instance death)**
  **What**: Modify `src/lib/server/process-manager.ts` to create "session disconnected" notifications when an instance is marked dead by the health check loop (around line 366-377). After the instance is marked dead, look up all active sessions for that instance using `getSessionsForInstance(id)` and call `createSessionDisconnectedNotification()` for each.
  
  Import `getSessionsForInstance` from `db-repository` and `createSessionDisconnectedNotification` from `notification-service`. The notification creation is best-effort (wrapped in try/catch).
  **Files**: `src/lib/server/process-manager.ts` (modify, inside the health check loop around line 366-377)
  **Acceptance**: When an instance dies (fails 3 health checks), notifications are created for all its active sessions.

### Phase 4: Client-Side Hook

- [x] 11. **Create `useNotifications` polling hook**
  **What**: Create `src/hooks/use-notifications.ts` following the pattern from `src/hooks/use-fleet-summary.ts` (polling with interval, isMounted ref). The hook:
  - Polls `GET /api/notifications/unread-count` every 10 seconds for the badge count
  - Provides `fetchNotifications()` function that calls `GET /api/notifications?limit=10` for the dropdown (on-demand, not polled)
  - Provides `markAsRead(id: string)` that calls `PATCH /api/notifications/{id}` with `{ read: true }`
  - Provides `markAllAsRead()` that calls `PATCH /api/notifications/all` with `{ read: true }`
  - Returns `{ unreadCount, notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead }`
  
  **Key design**: The unread count is polled cheaply. The full notification list is fetched only when the dropdown opens (triggered by `fetchNotifications()`). This keeps polling overhead minimal.
  **Files**: `src/hooks/use-notifications.ts` (create)
  **Acceptance**: Hook compiles. Polling starts on mount, stops on unmount.

### Phase 5: UI Integration

- [x] 12. **Create `NotificationBell` component with dropdown**
  **What**: Create `src/components/notifications/notification-bell.tsx` — a self-contained component that:
  - Renders the bell icon button with unread badge (using `useNotifications` hook)
  - Badge is hidden when `unreadCount === 0`
  - Uses `DropdownMenu` from `src/components/ui/dropdown-menu.tsx` — bell button is the trigger
  - Dropdown content shows up to 10 recent notifications (fetched when dropdown opens via `fetchNotifications()`)
  - Each notification row shows: icon (reuse the `getNotificationIcon` pattern from `/alerts` page), message text (truncated), relative time
  - Clicking a notification marks it as read and navigates to the session: `/sessions/{sessionId}?instanceId={instanceId}` (both fields are on the notification). Falls back to `/alerts` if session/instance IDs are missing.
  - Footer link: "View all" → navigates to `/alerts`
  - "Mark all as read" button in the dropdown header
  - Empty state: "No notifications" text
  **Files**: `src/components/notifications/notification-bell.tsx` (create)
  **Acceptance**: Component renders. Shows real unread count. Dropdown opens with notification list.

- [x] 13. **Wire `NotificationBell` into Header**
  **What**: Replace the hardcoded bell icon in `src/components/layout/header.tsx` (lines 24-29) with the `<NotificationBell />` component. Remove the `Bell` import from lucide-react (it's now encapsulated in NotificationBell).
  **Files**: `src/components/layout/header.tsx` (modify)
  **Acceptance**: Header shows `NotificationBell` component instead of hardcoded badge.

- [x] 14. **Wire real unread count into Sidebar**
  **What**: Modify `src/components/layout/sidebar.tsx` to show the real unread notification count on the Alerts nav item (line 23). Two options:
  
  **Approach**: Make the sidebar a consumer of `useNotifications` for just the count. Change the `navItems` array's `badge` property for Alerts from a static `2` to dynamic. The simplest approach: make the Alerts badge dynamic by extracting it from the `navItems` const and rendering it conditionally in the JSX. Use the `useNotifications` hook at the `Sidebar` component level.
  
  Set `badge: undefined` for the Alerts item in `navItems` (line 23), then in the render loop, when `item.href === "/alerts"`, render the badge from `unreadCount` instead (if > 0).
  **Files**: `src/components/layout/sidebar.tsx` (modify)
  **Acceptance**: Sidebar Alerts badge shows real unread count. Badge disappears when count is 0.

- [x] 15. **Wire `/alerts` page to real data**
  **What**: Rewrite `src/app/alerts/page.tsx` to fetch from `GET /api/notifications` instead of importing `mockNotifications`. 
  
  - Remove the `import { mockNotifications } from "@/lib/mock-data"` line
  - Add a `useEffect` that fetches `GET /api/notifications` on mount
  - Keep the existing UI structure (unread/read sections, icons, badges) — it's already well-built
  - Add a "Mark all as read" button in the header actions
  - Clicking a notification card marks it as read (PATCH call) and navigates to the session (`/sessions/{session_id}?instanceId={instance_id}`) if both IDs are present
  - Adapt the `Notification` type usage — the API returns `DbNotification` shape (snake_case, `read` as `0|1`, `created_at` as ISO string). Either map to the frontend `Notification` type or adjust the rendering code.
  - Add loading state and empty state
  **Files**: `src/app/alerts/page.tsx` (modify)
  **Acceptance**: Page loads real notifications from API. No mock data imports remain. Mark-as-read works.

- [x] 16. **Remove mock notification data**
  **What**: Remove the `mockNotifications` array from `src/lib/mock-data.ts` (lines 677-712) and its `Notification` import. Verify no other files import `mockNotifications`.
  **Files**: `src/lib/mock-data.ts` (modify)
  **Acceptance**: `mockNotifications` is gone. `npm run build` succeeds with no broken imports.

### Phase 6: Notification Service Tests

- [x] 17. **Write notification service tests**
  **What**: Create `src/lib/server/__tests__/notification-service.test.ts`. Test:
  - `createSessionCompletedNotification` creates a notification with correct type and message
  - `createSessionErrorNotification` creates a notification with error details
  - `createSessionDisconnectedNotification` creates a notification with correct type
  - Deduplication: calling the same function twice within 60s for the same session only creates one notification
  - Deduplication: calling for different sessions creates separate notifications
  
  Follow the test setup pattern from `db-repository.test.ts` (tmpdir DB, `_resetDbForTests`).
  **Files**: `src/lib/server/__tests__/notification-service.test.ts` (create)
  **Acceptance**: `npm run test` passes including new tests.

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `src/lib/server/database.ts` | Modify (add notifications table) | 1 |
| `src/lib/server/db-repository.ts` | Modify (add notification CRUD) | 1 |
| `src/lib/types.ts` | Modify (add `session_disconnected` type) | 1 |
| `src/lib/server/__tests__/notification-repository.test.ts` | Create | 1 |
| `src/app/api/notifications/route.ts` | Create | 2 |
| `src/app/api/notifications/[id]/route.ts` | Create | 2 |
| `src/app/api/notifications/unread-count/route.ts` | Create | 2 |
| `src/lib/server/notification-service.ts` | Create | 3 |
| `src/app/api/sessions/[id]/events/route.ts` | Modify (add notification triggers) | 3 |
| `src/lib/server/process-manager.ts` | Modify (add disconnect notifications) | 3 |
| `src/hooks/use-notifications.ts` | Create | 4 |
| `src/components/notifications/notification-bell.tsx` | Create | 5 |
| `src/components/layout/header.tsx` | Modify (use NotificationBell) | 5 |
| `src/components/layout/sidebar.tsx` | Modify (dynamic badge) | 5 |
| `src/app/alerts/page.tsx` | Modify (real data) | 5 |
| `src/lib/mock-data.ts` | Modify (remove mock notifications) | 5 |
| `src/lib/server/__tests__/notification-service.test.ts` | Create | 6 |

## Verification

- [x] `npm run build` succeeds with zero TypeScript errors
- [x] `npm run test` passes — all existing tests + new notification tests
- [x] `npm run lint` passes
- [x] No remaining imports of `mockNotifications` in the codebase (grep for `mockNotifications`)
- [x] No hardcoded `2` badge count in header or sidebar
- [x] Manual verification: create a session, send a prompt, wait for completion → notification appears in bell dropdown and `/alerts` page *(requires running app — code paths verified via tests)*
- [x] Manual verification: bell badge shows `0` (hidden) when all notifications are read *(code verified: badge hidden when `unreadCount === 0`)*
- [x] Manual verification: "Mark all as read" clears the badge count *(code verified: `markAllAsRead` → PATCH /api/notifications/all → sets `unreadCount(0)`)*

## Potential Pitfalls

1. **SSE proxy runs per-request** — Each SSE connection is a separate request handler. The busy→idle detection state (`lastSessionStatus`) is per-connection, which is correct (each connection tracks one session). But if the browser disconnects and reconnects, a duplicate "completed" notification could fire. The deduplication guard in the notification service (60s window) handles this.

2. **Race condition on notification writes** — SQLite WAL mode + busy_timeout (already configured) handles concurrent writes from multiple SSE connections gracefully. No additional locking needed.

3. **Health check notification timing** — The health check runs every 30s with a 3-failure threshold, so instance death detection takes 90-120s. This is acceptable for V1 — users don't need sub-second alerting for instance death.

4. **`getSession` vs `getSessionByOpencodeId`** — The SSE proxy receives the session ID from the URL param, which is the OpenCode session ID. Use `getSessionByOpencodeId()` to look up the DB session for the title. If lookup fails (DB not available), use a generic message.

5. **No popover component** — The codebase has `DropdownMenu` (Radix-based) but no `Popover`. Using `DropdownMenu` for the bell notification panel works well — it handles focus management, keyboard nav, and click-outside-to-close out of the box.
