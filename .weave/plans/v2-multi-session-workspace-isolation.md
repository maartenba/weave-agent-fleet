# V2: Multi-Session & Workspace Isolation

## TL;DR
> **Summary**: Enable running N independent OpenCode sessions against different projects simultaneously with workspace isolation, session persistence via SQLite, process lifecycle hardening, and session termination — delivering the core "Agent Fleet" value proposition.
> **Estimated Effort**: Large

## Context

### Original Request
V2 must deliver multi-session workspace isolation: the ability to run multiple independent OpenCode sessions against different projects simultaneously. This includes workspace isolation (sessions don't interfere), concurrent sessions with independent state/streaming/lifecycle, process lifecycle hardening (SSE reconnection, orphan cleanup), SQLite persistence (sessions survive restarts), and session termination with resource cleanup.

### Key Findings

**V1 State (complete):**
- Process manager (`src/lib/server/process-manager.ts`) is a module-level singleton using `Map<string, ManagedInstance>`. Tracks instances by ID with port allocation (4097–4200). Has directory-to-instance reuse. No persistence — all state lost on restart.
- API routes exist for session CRUD, prompt submission, and SSE proxying. All route through `instanceId` query params.
- Frontend has fleet page with `useSessions` (polling), session detail page with `useSessionEvents` (SSE + exponential backoff reconnection), and a "New Session" dialog.
- Tests exist for port allocation, directory validation, and event state accumulation.
- The `Workspace` type in `src/lib/types.ts` already models isolation strategy (`worktree | clone | existing`) but is unused mock-data infrastructure.

**Current Limitations V2 Must Address:**
1. **No workspace isolation** — All sessions point at the real project directory. Two sessions targeting the same repo will conflict (concurrent file edits, git state).
2. **No persistence** — Server restart kills all in-memory state. No way to recover sessions.
3. **No session termination** — Can't stop a session or clean up its OpenCode process/workspace.
4. **Orphan processes** — On Next.js hot reload, `process.on("exit")` fires but child processes may survive if `SIGTERM` isn't handled quickly enough. No recovery mechanism.
5. **Fleet page is thin** — Shows minimal session info (title, directory, timestamp). No cost/tokens/status aggregation from real data.
6. **Session detail sidebar** — Hardcoded "coming in V2" placeholder. No real metadata.

**Architecture Constraints:**
- OpenCode SDK's `createOpencodeServer` spawns one process per directory. Multiple sessions in the same directory share one process.
- The SDK is ESM-only and uses `child_process` — must stay in `serverExternalPackages`.
- `XDG_CONFIG_HOME` isolation is critical to prevent the Weave plugin deadlock.
- SSE proxy pattern: Browser → Next.js API → OpenCode SDK → OpenCode process.

## Objectives

### Core Objective
Enable simultaneous, isolated, persistent agent sessions across multiple projects — the defining feature of "Agent Fleet."

### Deliverables
- [x] Workspace isolation via configurable strategy (user-specified paths, git worktrees, or clones)
- [x] SQLite-backed session persistence (sessions, instances, workspaces survive restarts)
- [x] Multiple concurrent sessions displayed on the fleet page with independent streaming
- [x] Process lifecycle hardening (orphan cleanup, PID tracking, restart recovery)
- [x] Session termination (stop/kill with process and workspace cleanup)
- [x] Enriched fleet page with real aggregate stats (tokens, cost, status counts)
- [x] Session detail sidebar with real metadata

### Definition of Done
- [x] Can create 3+ sessions against different directories simultaneously
- [x] Each session streams independently — prompting session A doesn't affect session B
- [x] Killing the Next.js server and restarting shows previous sessions (with "disconnected" status)
- [x] Can terminate a session from the UI — OpenCode process is killed, workspace optionally cleaned
- [x] Fleet summary bar shows real aggregate stats from live sessions
- [x] `npm run build` succeeds with no type errors
- [x] `npm run test` passes — all existing + new tests green

### Guardrails (Must NOT)
- Do NOT implement pipelines, DAG orchestration, or task queues
- Do NOT implement templates or batch operations
- Do NOT implement authentication/authorization
- Do NOT implement alerts/notifications backend
- Do NOT implement the history page backend
- Do NOT remove mock data for pages not touched by V2 (pipelines, queue, templates, alerts, history)

## Architecture Decisions

### AD1: Workspace Isolation Strategy — User-Specified Paths with Optional Git Worktree Support

**Decision:** Support three isolation modes, selectable per session:
1. **`existing`** (default) — Use the directory as-is. Simplest. Risk of conflicts if two sessions target the same dir, but the process manager already reuses instances for same-directory sessions. This is fine for different projects.
2. **`worktree`** — Create a git worktree from the source repo. Best for same-repo parallelism (e.g., two agents working on different features of the same repo). Requires the source directory to be a git repo.
3. **`clone`** — Shallow clone of a git repo URL. Best for ephemeral, disposable workspaces.

**Rationale:** The Workspace type in `types.ts` already models these three strategies. User-specified paths are the simplest and most common case. Git worktrees are the key differentiator for "fleet" usage — running multiple agents on different branches of the same repo.

**Implementation:** The workspace manager creates isolated directories under a configurable workspace root (e.g., `~/.weave/workspaces/<session-id>/`). For `worktree`, it runs `git worktree add`. For `clone`, it runs `git clone --depth=1`. Cleanup removes the worktree/clone directory.

### AD2: SQLite for Persistence — `better-sqlite3`

**Decision:** Use `better-sqlite3` (synchronous SQLite bindings for Node.js) to persist session metadata, instance info, and workspace state.

**Rationale:** The project overview explicitly calls out SQLite for persistence. `better-sqlite3` is synchronous (simpler API, no async overhead for small reads), battle-tested, works well in Next.js API routes, and doesn't require a separate database process. It's the standard choice for embedded persistence in Node.js apps.

**Schema (3 tables):**
- `workspaces` — id, directory, source_directory, isolation_strategy, branch, created_at, cleaned_up_at
- `sessions` — id, workspace_id, instance_id, opencode_session_id, title, status, directory, created_at, stopped_at
- `instances` — id, port, pid, directory, url, status, created_at, stopped_at

The process manager will write to the DB when spawning/destroying instances. On startup, the DB is read to identify sessions that were running when the server last stopped.

### AD3: Process Manager Hardening — PID Tracking + Orphan Recovery

**Decision:** Track child process PIDs in the database. On startup, check if any previously-tracked PIDs are still running. If so, attempt to reattach (create a new SDK client pointing at the same port). If the process is dead, mark the session as "disconnected" in the DB.

**Rationale:** Next.js dev mode hot-reloads the server frequently, orphaning child processes. Without PID tracking, these processes leak ports and memory. The DB enables recovery.

**Implementation:**
- `process-manager.ts` stores PID alongside the instance.
- On startup: read `instances` table where `status = 'running'`. For each, check if PID is alive (`process.kill(pid, 0)`). If alive, create a new client; if dead, mark as `stopped`.
- New `recoveryAttempt()` function called once on module load.

### AD4: Session Termination — API Route + Process Kill + Workspace Cleanup

**Decision:** Add `DELETE /api/sessions/[id]` that:
1. Calls `instance.close()` to kill the OpenCode process
2. Updates the DB (session status = "stopped", instance status = "stopped")
3. Optionally cleans up the workspace directory (for worktree/clone — never for `existing`)

**Rationale:** Termination is essential for resource management. Users need to stop runaway agents and reclaim ports.

### AD5: Fleet Page Enhancement — Real-Time Aggregation

**Decision:** Compute fleet summary from real session data on the backend. Add a `GET /api/fleet/summary` endpoint that queries SQLite for aggregate stats and merges with live instance status.

**Rationale:** The current fleet page uses `mockFleetSummary` for most stats. V2 should compute active/idle/completed/error counts, total tokens, and total cost from real data.

## TODOs

### Phase 1: Persistence Layer (SQLite)

- [x] 1. **Install `better-sqlite3` dependency**
  **What**: Add `better-sqlite3` and `@types/better-sqlite3` as dependencies. Add `better-sqlite3` to `serverExternalPackages` in `next.config.ts` (it's a native module).
  **Files**: `package.json`, `next.config.ts`
  **Commands**: `npm install better-sqlite3 && npm install -D @types/better-sqlite3`
  **Acceptance**: `import Database from "better-sqlite3"` compiles without error; `npm run build` succeeds

- [x] 2. **Create the database module with schema**
  **What**: Create a server-side singleton that initializes the SQLite database at `~/.weave/fleet.db` (configurable via `WEAVE_DB_PATH` env var). Define the schema with three tables: `workspaces`, `sessions`, `instances`. Use WAL mode for concurrent read performance. Run migrations on startup (check a `schema_version` pragma or a `migrations` table).
  **Files**: `src/lib/server/database.ts`
  **Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    directory TEXT NOT NULL,
    source_directory TEXT,
    isolation_strategy TEXT NOT NULL DEFAULT 'existing',
    branch TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cleaned_up_at TEXT
  );

  CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    port INTEGER NOT NULL,
    pid INTEGER,
    directory TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    instance_id TEXT NOT NULL REFERENCES instances(id),
    opencode_session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    status TEXT NOT NULL DEFAULT 'active',
    directory TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at TEXT
  );
  ```
  **Key APIs**:
  - `getDb(): Database.Database` — lazy-init singleton, creates DB file + tables on first call
  - `_resetDbForTests(): void` — closes DB, deletes file (for tests)
  **Dependencies**: Task 1
  **Acceptance**: Unit test creates DB, inserts a row, reads it back; DB file created at expected path

- [x] 3. **Create database repository functions**
  **What**: Create typed CRUD functions for each table. These are thin wrappers around prepared statements. All functions are synchronous (better-sqlite3 is sync).
  **Files**: `src/lib/server/db-repository.ts`
  **Key APIs**:
  - **Workspaces**: `insertWorkspace(ws)`, `getWorkspace(id)`, `listWorkspaces()`, `markWorkspaceCleaned(id)`
  - **Instances**: `insertInstance(inst)`, `getInstance(id)`, `getInstanceByDirectory(dir)`, `listInstances()`, `updateInstanceStatus(id, status, stoppedAt?)`, `getRunningInstances()`
  - **Sessions**: `insertSession(sess)`, `getSession(id)`, `getSessionByOpencodeId(opencodeSessionId)`, `listSessions()`, `listActiveSessions()`, `updateSessionStatus(id, status, stoppedAt?)`, `getSessionsForInstance(instanceId)`
  **Types**: Define `DbWorkspace`, `DbInstance`, `DbSession` row types (plain objects matching table columns)
  **Dependencies**: Task 2
  **Acceptance**: Unit tests for each CRUD operation; round-trip insert → get works

- [x] 4. **Write tests for database module and repository**
  **What**: Unit tests for schema creation, CRUD operations, and edge cases (duplicate IDs, foreign key constraints, listing empty tables). Use an in-memory SQLite database or a temp file.
  **Files**: `src/lib/server/__tests__/database.test.ts`, `src/lib/server/__tests__/db-repository.test.ts`
  **Dependencies**: Tasks 2, 3
  **Acceptance**: `npm run test` passes; all repository functions are tested

### Phase 2: Workspace Manager

- [x] 5. **Create the workspace manager**
  **What**: A server-side module that creates and manages isolated workspace directories. Supports three strategies: `existing` (use as-is), `worktree` (git worktree add), `clone` (git clone --depth=1). Workspaces are created under a configurable root directory (`WEAVE_WORKSPACE_ROOT` env var, default `~/.weave/workspaces/`). Each workspace gets a unique subdirectory named by its ID.
  **Files**: `src/lib/server/workspace-manager.ts`
  **Key APIs**:
  - `createWorkspace(opts: { sourceDirectory: string, strategy: 'existing' | 'worktree' | 'clone', branch?: string }): Promise<{ id: string, directory: string }>` — Creates the workspace directory based on strategy, inserts into DB, returns the working directory path.
    - `existing`: validates the directory exists, records it in DB but doesn't copy/clone anything
    - `worktree`: runs `git worktree add <workspace-dir> -b <branch>` from sourceDirectory. Generates a unique branch name if not provided.
    - `clone`: runs `git clone --depth=1 <sourceDirectory> <workspace-dir>`. sourceDirectory is treated as a git URL or local path.
  - `cleanupWorkspace(id: string): Promise<void>` — For `worktree`: runs `git worktree remove`. For `clone`: removes the directory. For `existing`: no-op (never delete user's real directory). Updates DB.
  - `getWorkspaceDirectory(id: string): string` — Returns the resolved working directory for a workspace.
  **Dependencies**: Tasks 2, 3
  **Acceptance**: Can create a worktree workspace from a local git repo; working directory exists and is a valid git checkout; cleanup removes the worktree

- [x] 6. **Write tests for workspace manager**
  **What**: Unit tests for each isolation strategy. For `worktree` and `clone`, use a temp git repo created in the test setup. Test cleanup behavior (worktree removed, clone dir deleted, existing dir untouched).
  **Files**: `src/lib/server/__tests__/workspace-manager.test.ts`
  **Dependencies**: Task 5
  **Acceptance**: All three strategies tested; cleanup tested; edge cases (non-git dir for worktree) handled

### Phase 3: Process Manager Hardening

- [x] 7. **Integrate process manager with database persistence**
  **What**: Modify `process-manager.ts` to persist instance state to SQLite on spawn/destroy. The in-memory `Map` remains the source of truth for running instances, but the DB provides recovery data. On `spawnInstance`: insert into `instances` table (with PID). On `destroyInstance`: update `instances` status to `stopped`. On `destroyAll`: update all running instances to `stopped`.
  **Files**: `src/lib/server/process-manager.ts`
  **Changes**:
  - Import `insertInstance`, `updateInstanceStatus` from `db-repository`
  - After successful spawn, extract PID from the child process (the SDK's `createOpencodeServer` returns a `close()` function but not the PID directly — investigate if PID is accessible or if we need to wrap/extend the spawn)
  - **PID extraction strategy**: The SDK uses `child_process.spawn` internally. We may need to: (a) check if `server` object exposes the child process, (b) scan for the process by port using `lsof -i :PORT`, or (c) store port as the recovery key instead of PID. **Decision**: Use port as the primary recovery key — if a process is listening on the expected port, it's our process. Validate with an HTTP health check to the OpenCode server.
  - On spawn: `insertInstance({ id, port, pid: null, directory, url, status: 'running' })`
  - On destroy: `updateInstanceStatus(id, 'stopped', new Date().toISOString())`
  **Dependencies**: Tasks 2, 3
  **Acceptance**: After spawning an instance, a row exists in the `instances` table; after destroying, status is `stopped`

- [x] 8. **Add startup recovery for orphaned instances**
  **What**: On module load, the process manager reads `instances` with `status = 'running'` from the DB. For each, it checks if the port is still in use (attempt an HTTP GET to `url/session`). If reachable, it creates a new `OpencodeClient` and adds the instance back to the in-memory Map. If not reachable, it marks the instance as `stopped` in the DB.
  **Files**: `src/lib/server/process-manager.ts`
  **New function**: `recoverInstances(): Promise<void>` — called once on module init (lazy, on first API call)
  **Changes**:
  - Add a `recovered: boolean` flag on `ManagedInstance` to distinguish recovered vs freshly-spawned instances
  - Add `_recoveryComplete` promise that API routes can await before serving requests
  - Handle the case where the port is in use by a different process (health check response doesn't match expected format → mark as stopped, don't reuse)
  **Dependencies**: Task 7
  **Acceptance**: Start server → spawn instance → restart server → instance is recovered; start server → spawn instance → kill OpenCode process → restart server → instance marked as stopped

- [x] 9. **Integrate session creation with database persistence**
  **What**: Modify `POST /api/sessions` to persist sessions to SQLite. When creating a session, also create a workspace record. The flow becomes: validate directory → create workspace (DB) → spawn instance (or reuse) → create OpenCode session → persist session (DB) → return response. The response now includes `workspaceId` alongside `instanceId` and `session`.
  **Files**: `src/app/api/sessions/route.ts`, `src/lib/api-types.ts`
  **Changes to `CreateSessionResponse`**: Add `workspaceId: string`
  **Changes to `CreateSessionRequest`**: Add optional `isolationStrategy?: 'existing' | 'worktree' | 'clone'` and optional `branch?: string`
  **Dependencies**: Tasks 3, 5, 7
  **Acceptance**: After creating a session, rows exist in `workspaces`, `instances`, and `sessions` tables

- [x] 10. **Update `GET /api/sessions` to merge DB + live state**
  **What**: Modify the session list endpoint to read from SQLite and merge with live instance status. This enables showing sessions from previous server runs (with status "disconnected") alongside currently active sessions. The response should include workspace info.
  **Files**: `src/app/api/sessions/route.ts`, `src/lib/api-types.ts`
  **Changes to `SessionListItem`**: Add `workspaceId: string`, `workspaceDirectory: string`, `isolationStrategy: string`, `sessionStatus: 'active' | 'stopped' | 'disconnected'`
  **Logic**: Read all sessions from DB. For each, check if its instance is in the live Map. If yes → status from live instance. If no → check DB instance status. If DB says `running` but not in Map → "disconnected" (orphaned). If DB says `stopped` → "stopped".
  **Dependencies**: Tasks 3, 7, 9
  **Acceptance**: After server restart, previously active sessions appear with "disconnected" status; currently running sessions show "active"

- [x] 11. **Update existing process manager tests**
  **What**: Update the existing tests in `process-manager.test.ts` to account for the database integration. Mock or use a test database. Ensure `_resetForTests()` also resets the DB state.
  **Files**: `src/lib/server/__tests__/process-manager.test.ts`
  **Dependencies**: Tasks 7, 8
  **Acceptance**: All existing tests pass; new tests for persistence and recovery

### Phase 4: Session Termination

- [x] 12. **Add `DELETE /api/sessions/[id]` for session termination**
  **What**: Add a DELETE handler to the session detail route. Accepts `instanceId` and optional `cleanupWorkspace` boolean in query params. Kills the OpenCode process, updates session and instance status in DB, optionally cleans up the workspace directory.
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Logic**:
  1. Look up session in DB to get instance ID and workspace ID
  2. If instance is live in the Map: call `destroyInstance(instanceId)` — this kills the process and releases the port
  3. Update `sessions` table: status = 'stopped', stopped_at = now
  4. If `cleanupWorkspace=true` and workspace strategy is `worktree` or `clone`: call `cleanupWorkspace(workspaceId)`
  5. Return 200 with updated session info
  **Error handling**: If instance is already dead, still update DB status (idempotent). If session not found, return 404.
  **Dependencies**: Tasks 3, 5, 7
  **Acceptance**: DELETE request stops the OpenCode process; session status changes to "stopped" in the DB and in the fleet list; port is released

- [x] 13. **Create `useTerminateSession` hook**
  **What**: A React hook for terminating a session from the UI.
  **Files**: `src/hooks/use-terminate-session.ts`
  **API**:
  ```typescript
  function useTerminateSession(): {
    terminateSession: (sessionId: string, opts?: { cleanupWorkspace?: boolean }) => Promise<void>;
    isTerminating: boolean;
    error?: string;
  }
  ```
  **Dependencies**: Task 12
  **Acceptance**: Calling `terminateSession(id)` sends DELETE request and updates UI state

### Phase 5: Frontend — Multi-Session Fleet UX

- [x] 14. **Update New Session dialog with workspace isolation options**
  **What**: Enhance the New Session dialog to include an isolation strategy selector (dropdown: Existing / Git Worktree / Clone) and a branch name input (shown when Worktree is selected). The directory input label changes based on strategy ("Project Directory" for existing, "Source Repository" for worktree/clone).
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Changes**:
  - Add a select/dropdown for isolation strategy (default: "existing")
  - Conditionally show branch input when strategy is "worktree"
  - Update `createSession` call to pass `isolationStrategy` and `branch`
  - Update the `useCreateSession` hook to accept the new fields
  **Dependencies**: Task 9
  **Acceptance**: Can create sessions with different isolation strategies from the dialog

- [x] 15. **Update `useCreateSession` hook for new fields**
  **What**: Extend the hook to pass `isolationStrategy` and `branch` to the API.
  **Files**: `src/hooks/use-create-session.ts`, `src/lib/api-types.ts`
  **Dependencies**: Task 9
  **Acceptance**: Hook correctly sends the new fields in the POST body

- [x] 16. **Enhance fleet page session cards with richer metadata**
  **What**: Update the `LiveSessionCard` in `page.tsx` to show: isolation strategy badge, workspace directory (distinct from source directory for worktree/clone), session status (active/stopped/disconnected), and a terminate button (trash icon). Show total cost and token count if available. Add a visual distinction for stopped/disconnected sessions (grayed out, different dot color).
  **Files**: `src/app/page.tsx`
  **Changes**:
  - Show isolation strategy badge (e.g., "worktree", "clone", "existing") with distinct colors
  - Show `sessionStatus` with appropriate dot colors: green=active, gray=stopped, amber=disconnected
  - Add terminate button (icon button with trash icon) that calls `useTerminateSession`
  - Show disconnected sessions with reduced opacity
  **Dependencies**: Tasks 10, 13
  **Acceptance**: Fleet page shows sessions with isolation strategy, proper status, and terminate button

- [x] 17. **Enhance fleet summary bar with real aggregate data**
  **What**: Create a `GET /api/fleet/summary` endpoint that computes real aggregate stats from the database: active session count, stopped count, disconnected count, and total cost (sum across all sessions — this will be enhanced when we track cost per session). Update the `SummaryBar` component to fetch real data via a new `useFleetSummary` hook, falling back to zeros for stats not yet available (pipelines, queue).
  **Files**:
  - `src/app/api/fleet/summary/route.ts` — new API route
  - `src/hooks/use-fleet-summary.ts` — new hook
  - `src/components/fleet/summary-bar.tsx` — use real data
  - `src/app/page.tsx` — use `useFleetSummary` instead of `mockFleetSummary`
  **Dependencies**: Tasks 3, 10
  **Acceptance**: Summary bar shows real active/stopped/error counts from the database

- [x] 18. **Wire up session detail sidebar with real metadata**
  **What**: Replace the "coming in V2" placeholder in the session detail page sidebar with real session metadata. Show: workspace info (directory, isolation strategy, source), instance info (port, status), session timestamps, and cost/tokens (from accumulated message data in the event stream). Remove dependency on the mock `SessionSidebar` component.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Fetch session metadata from `GET /api/sessions/[id]?instanceId=xxx` on mount
  - Display workspace directory, isolation strategy, instance port
  - Show accumulated cost/tokens from the `useSessionEvents` hook (already tracks these)
  - Show session creation time
  **Dependencies**: Tasks 9, 10
  **Acceptance**: Session detail sidebar shows real workspace and instance metadata

- [x] 19. **Add session termination to session detail page**
  **What**: Add a "Stop Session" button in the session detail header. When clicked, shows a confirmation dialog, then terminates the session. After termination, disable the prompt input and show a "Session stopped" banner.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Add "Stop Session" button in the header actions area
  - Use `useTerminateSession` hook
  - After termination: disable prompt input, show stopped banner, update status display
  - Handle navigation back to fleet page after termination (optional — user can stay to view history)
  **Dependencies**: Task 13
  **Acceptance**: Can stop a session from the detail page; UI updates to reflect stopped state

### Phase 6: Process Lifecycle Hardening

- [x] 20. **Improve orphan process cleanup on server shutdown**
  **What**: Harden the `process.on("exit")` / `process.on("SIGTERM")` handlers. Add `process.on("SIGHUP")` for terminal disconnects. Ensure `destroyAll()` is called reliably. Add a `beforeExit` handler. Track whether cleanup has already run to avoid double-cleanup. On unclean shutdown (no signal handler runs), the DB still has `status = 'running'` entries — these are handled by the recovery logic (Task 8).
  **Files**: `src/lib/server/process-manager.ts`
  **Changes**:
  - Add `SIGHUP` handler
  - Add `beforeExit` handler
  - Add `cleanupRun` boolean to prevent double execution
  - Ensure `destroyAll` updates DB status before killing processes (so even if kill fails, DB reflects intent)
  **Dependencies**: Task 7
  **Acceptance**: Killing the Next.js server with SIGTERM, SIGINT, or SIGHUP properly stops all OpenCode processes and updates DB

- [x] 21. **Add health check polling for managed instances**
  **What**: Add a periodic health check (every 30s) that verifies each managed instance is still responsive. If an instance stops responding (3 consecutive failures), mark it as dead in both the in-memory Map and the DB. Emit a status change that the SSE stream can forward to connected clients.
  **Files**: `src/lib/server/process-manager.ts`
  **New function**: `startHealthCheckLoop(): void` — starts an interval timer
  **Health check**: HTTP GET to `${instance.url}/session` with a 5s timeout. If it returns any 2xx, instance is healthy.
  **Dependencies**: Task 7
  **Acceptance**: If an OpenCode process crashes mid-session, the fleet page updates within 30s to show "dead" status

- [x] 22. **Harden SSE reconnection with session state recovery**
  **What**: When the SSE connection drops and reconnects, the client may have missed events. On reconnection, fetch the full session messages from `GET /api/sessions/[id]` and rebuild the accumulated message state before resuming the event stream. This prevents gaps in the activity stream.
  **Files**: `src/hooks/use-session-events.ts`
  **Changes**:
  - On reconnect (after `es.onopen` fires following an error): fetch `GET /api/sessions/${sessionId}?instanceId=${instanceId}` to get current messages
  - Parse the response messages and rebuild `AccumulatedMessage[]` state
  - Then resume processing live SSE events on top of the recovered state
  - Add a `isRecovering` status to `SessionConnectionStatus`
  **Dependencies**: None (improves existing V1 code)
  **Acceptance**: Disconnect Wi-Fi → reconnect → activity stream shows all messages without gaps

### Phase 7: Integration & Cleanup

- [x] 23. **Remove mock data dependencies from fleet page**
  **What**: The fleet page (`src/app/page.tsx`) still imports `mockFleetSummary` from `mock-data.ts`. The `SummaryBar` imports `formatTokens` and `formatCost` from `mock-data.ts`. Extract the helper functions (`formatTokens`, `formatCost`, `formatDuration`, `getStatusColor`, `getStatusDot`) into a proper `src/lib/format-utils.ts` module and update all imports. Remove mock data imports from V2-touched files.
  **Files**:
  - `src/lib/format-utils.ts` — new file with extracted helpers
  - `src/app/page.tsx` — remove `mockFleetSummary` import
  - `src/components/fleet/summary-bar.tsx` — import from `format-utils` instead of `mock-data`
  - `src/components/fleet/session-card.tsx` — import from `format-utils` (this component is used by other pages with mock data — may need to keep it working with mock types too)
  **Dependencies**: Task 17
  **Acceptance**: No `mock-data` imports in fleet page or summary bar; other pages (pipelines, queue, templates, etc.) still work with their mock data

- [x] 24. **End-to-end integration test script**
  **What**: Create a manual integration test script/checklist that exercises the full V2 flow. Document it as a markdown file. This is a manual testing guide, not automated tests (automated E2E would require a running OpenCode binary which isn't suitable for CI).
  **Files**: `.weave/docs/v2-integration-test.md`
  **Test scenarios**:
  1. Create session with "existing" strategy → send prompt → see response
  2. Create session with "worktree" strategy → verify worktree directory exists → send prompt → see response
  3. Create 3 concurrent sessions → verify all stream independently
  4. Terminate a session → verify process stopped, fleet page updated
  5. Restart Next.js server → verify sessions show as "disconnected"
  6. With orphan recovery: restart server when instances still running → verify recovery
  7. Cleanup worktree workspace → verify directory removed
  **Acceptance**: Checklist exists and covers all V2 scenarios

## Verification
- [x] `npm install` succeeds
- [x] `npm run build` succeeds with no type errors
- [x] `npm run test` passes — all tests green (existing V1 tests + new V2 tests)
- [x] Manual: Create 3+ concurrent sessions against different directories
- [x] Manual: Each session streams independently (prompt one, others unaffected)
- [x] Manual: Terminate a session — process killed, fleet page shows "stopped"
- [x] Manual: Restart server — previous sessions visible as "disconnected"
- [x] Manual: Worktree isolation creates a real git worktree; cleanup removes it
- [x] Manual: Fleet summary bar shows real aggregate stats
- [x] Manual: Session detail sidebar shows real metadata (workspace, instance info)
- [x] Other pages (pipelines, queue, templates, alerts, history) still work with mock data

## Open Questions & Risks

1. **PID extraction from SDK**: The `createOpencodeServer` SDK function returns `{ url, close() }` — it doesn't expose the child process PID directly. We may need to: (a) read the SDK source to find if PID is accessible, (b) use port-based recovery instead of PID-based, or (c) wrap the SDK spawn with our own `child_process.spawn`. **Mitigation**: Use port-based recovery as the primary strategy (Task 8 design accounts for this).

2. **Git worktree requires git CLI**: The workspace manager shells out to `git` for worktree operations. If `git` is not in PATH or the source directory isn't a git repo, worktree creation will fail. **Mitigation**: Validate pre-conditions before attempting; fall back to clear error message.

3. **SQLite file locking in dev mode**: Next.js dev mode may create multiple server instances (or hot-reload). SQLite with WAL mode handles concurrent reads well, but two processes writing simultaneously could cause SQLITE_BUSY errors. **Mitigation**: Use WAL mode + busy_timeout (5000ms) to handle contention.

4. **Workspace disk usage**: Worktrees and clones consume disk space. Without cleanup, they accumulate. **Mitigation**: Session termination with `cleanupWorkspace=true` removes the directory. Could add a periodic cleanup job in a future version.

5. **better-sqlite3 native module**: This is a compiled native module. It needs to be compatible with the Node.js version used by Next.js. If the build environment differs from the runtime environment, it may fail. **Mitigation**: `better-sqlite3` has excellent Node.js version support; add to `serverExternalPackages` to prevent webpack bundling.

6. **Event stream for recovered sessions**: After recovery, if we create a new `OpencodeClient` pointing at a running OpenCode server, the SSE `event.subscribe()` will only deliver new events from that point forward — it won't replay historical events. **Mitigation**: Task 22 handles this by fetching full session messages on reconnect.

7. **Multiple sessions per instance**: The current design allows multiple SDK sessions to share one OpenCode instance (same directory → same process). When terminating one session, we must not kill the instance if other sessions are still using it. **Mitigation**: The DELETE handler should check `getSessionsForInstance(instanceId)` — only kill the process if no other active sessions remain.
