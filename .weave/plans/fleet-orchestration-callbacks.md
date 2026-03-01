# Fleet Orchestration Callbacks

## TL;DR
> **Summary**: Add session orchestration via callbacks so a conductor session can spawn child sessions through the Fleet REST API and receive automatic notifications when children complete — no polling needed. Activated naturally when the Fleet Orchestration skill is installed.
> **Estimated Effort**: Medium

## Context
### Original Request
Enable a "conductor" session to spawn child sessions via the Fleet REST API and get automatic callback notifications when children finish. The pattern is: conductor creates a child session with an `onComplete` field → Fleet stores a callback registration → when the child's SSE handler detects a busy→idle transition, it fires the callback by sending a prompt to the conductor session.

### Key Findings
- **Schema location**: `src/lib/server/database.ts` — schema is in a single `db.exec()` block (lines 45–91), with column migrations below in try/catch blocks (lines 93–98). New tables go inside the `db.exec()` block after line 90.
- **Repository pattern**: `src/lib/server/db-repository.ts` — synchronous CRUD functions using `getDb().prepare().run/get/all()`. Row types are interfaces, insert types use `Pick` + `Partial<Pick>`. Functions are grouped by section with `// ─── Section ───` headers.
- **Best-effort pattern**: `src/lib/server/notification-service.ts` — all functions wrap DB writes in try/catch, never throw. Includes deduplication via `isDuplicate()`. Callbacks should follow this exact pattern.
- **SSE handler integration points**: `src/app/api/sessions/[id]/events/route.ts` — busy→idle transitions are detected at lines 121–131 (via `session.status` with `statusType === "idle" && lastSessionStatus === "busy"`) and lines 133–143 (via `session.idle`). Error events at lines 144–153. Callback fires should go immediately after the existing `createSessionCompletedNotification` / `createSessionErrorNotification` calls.
- **Session creation**: `src/app/api/sessions/route.ts` — `insertSession()` call at line 68, callback registration goes after line 79 (after the try/catch for insertSession).
- **Session delete**: `src/app/api/sessions/[id]/route.ts` — permanent delete path cleans up notifications at line 216. Callback cleanup goes alongside.
- **Prompt delivery**: `src/app/api/sessions/[id]/prompt/route.ts` — uses `client.session.promptAsync()` with `parts: [{ type: "text", text }]`. The callback service should use the same SDK method.
- **Diff retrieval**: `src/app/api/sessions/[id]/diffs/route.ts` — uses `client.session.diff({ sessionID })` returning `{ file, before, after, additions, deletions }` per file. The callback service uses this to summarize changes.
- **Process manager**: `getInstance(id)` returns `ManagedInstance | undefined` with `{ client, status, directory, ... }`. The callback service uses this to get the target instance's client for sending prompts.
- **`getClientForInstance()`**: `src/lib/server/opencode-client.ts` — throws if instance not found or dead. Callback service should use raw `getInstance()` instead to handle dead instances gracefully.
- **API types**: `src/lib/api-types.ts` — `CreateSessionRequest` at line 13, `CreateSessionResponse` at line 20. `onComplete` field extends the request.
- **Skill format**: Frontmatter with `name` and `description` fields, then markdown content. Example at `~/.config/opencode/skills/managing-pull-requests/SKILL.md`.
- **Session DB has `opencode_session_id`**: The Fleet session ID (UUID) is different from the OpenCode SDK session ID. The callback service needs the `opencode_session_id` for SDK calls (promptAsync, diff). The `getSession()` function returns `DbSession` which has both `id` (fleet DB id) and `opencode_session_id` (SDK session id).

## Objectives
### Core Objective
Enable conductor-child session orchestration with automatic completion callbacks, activated via an installable skill.

### Deliverables
- [ ] `session_callbacks` SQLite table for storing callback registrations
- [ ] DB repository CRUD functions for callback lifecycle
- [ ] Callback service that fires prompts to conductor sessions on child completion
- [ ] `onComplete` field on `CreateSessionRequest` API type
- [ ] Session creation route stores callback registration when `onComplete` is provided
- [ ] SSE handler fires callbacks on busy→idle and error transitions
- [ ] Session delete route cleans up associated callbacks
- [ ] Fleet Orchestration SKILL.md teaching agents how to use the orchestration API

### Definition of Done
- [ ] `bun run build` succeeds with no type errors
- [ ] Existing tests pass: `bun test`
- [ ] Manual test: create a session with `onComplete`, send it a prompt, verify callback prompt arrives at conductor session when child goes idle

### Guardrails (Must NOT)
- Must NOT add any new API endpoints — only extend existing ones
- Must NOT require a feature toggle — the feature is naturally inert when no callbacks are registered
- Must NOT break the SSE stream — all callback operations are best-effort (try/catch, never throw)
- Must NOT block SSE event forwarding — callback firing is fire-and-forget
- Must NOT introduce MCP server or plugin changes
- Must NOT modify the UI — this is entirely backend + skill

## TODOs

### Phase 1: Backend — Callback Infrastructure

- [ ] 1. **Database — Add `session_callbacks` table**
  **What**: Add the `session_callbacks` table to the schema block in `database.ts`. The table stores callback registrations linking a source (child) session to a target (conductor) session.
  **Files**: `src/lib/server/database.ts`
  **Details**:
  - Insert the following SQL inside the `db.exec()` template literal, after the `idx_notifications_created_at` index (after line 90, before the closing backtick+`);` on line 91):
    ```sql
    CREATE TABLE IF NOT EXISTS session_callbacks (
      id TEXT PRIMARY KEY,
      source_session_id TEXT NOT NULL,
      target_session_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_callbacks_source ON session_callbacks(source_session_id, status);
    ```
  - `source_session_id` = the child session (whose completion triggers the callback). This is the **Fleet DB session ID** (not the opencode session ID).
  - `target_session_id` = the conductor session to notify (Fleet DB session ID).
  - `target_instance_id` = the conductor's instance ID (needed to get the SDK client for sending prompts).
  - `status` = `'pending'` or `'fired'`.
  **Acceptance**: `bun run build` succeeds. The table is created on app startup.

- [ ] 2. **DB Repository — Add callback CRUD functions**
  **What**: Add typed CRUD functions for the `session_callbacks` table, following the existing repository pattern.
  **Files**: `src/lib/server/db-repository.ts`
  **Details**:
  - Add a new section header: `// ─── Session Callbacks ─────────────────────────────────────────────────────`
  - Add after the Notifications section (after line 330).
  - **Row type**:
    ```typescript
    export interface DbSessionCallback {
      id: string;
      source_session_id: string;
      target_session_id: string;
      target_instance_id: string;
      status: "pending" | "fired";
      created_at: string;
      fired_at: string | null;
    }
    ```
  - **Insert type**:
    ```typescript
    export type InsertSessionCallback = Pick<
      DbSessionCallback,
      "id" | "source_session_id" | "target_session_id" | "target_instance_id"
    >;
    ```
  - **`insertSessionCallback(cb: InsertSessionCallback): void`** — INSERT with default status='pending'.
    ```typescript
    export function insertSessionCallback(cb: InsertSessionCallback): void {
      getDb()
        .prepare(
          `INSERT INTO session_callbacks (id, source_session_id, target_session_id, target_instance_id)
           VALUES (@id, @source_session_id, @target_session_id, @target_instance_id)`
        )
        .run({
          id: cb.id,
          source_session_id: cb.source_session_id,
          target_session_id: cb.target_session_id,
          target_instance_id: cb.target_instance_id,
        });
    }
    ```
  - **`getPendingCallbacksForSession(sourceSessionId: string): DbSessionCallback[]`** — SELECT WHERE source_session_id = ? AND status = 'pending'.
    ```typescript
    export function getPendingCallbacksForSession(sourceSessionId: string): DbSessionCallback[] {
      return getDb()
        .prepare("SELECT * FROM session_callbacks WHERE source_session_id = ? AND status = 'pending'")
        .all(sourceSessionId) as DbSessionCallback[];
    }
    ```
  - **`markCallbackFired(id: string): void`** — UPDATE status='fired', fired_at=datetime('now').
    ```typescript
    export function markCallbackFired(id: string): void {
      getDb()
        .prepare("UPDATE session_callbacks SET status = 'fired', fired_at = datetime('now') WHERE id = ?")
        .run(id);
    }
    ```
  - **`getSessionByOpencodeId(opencodeSessionId: string): DbSession | undefined`** — **Already exists** at line 195 of `db-repository.ts`. Do NOT add this function — it's already implemented with the exact signature and SQL needed. The callback service imports it from the existing export.
  - **`deleteCallbacksForSession(sessionId: string): number`** — DELETE WHERE source_session_id = ? OR target_session_id = ?. Returns `result.changes`.
    ```typescript
    export function deleteCallbacksForSession(sessionId: string): number {
      const result = getDb()
        .prepare("DELETE FROM session_callbacks WHERE source_session_id = ? OR target_session_id = ?")
        .run(sessionId, sessionId);
      return result.changes;
    }
    ```
  **Acceptance**: All functions are synchronous (matching better-sqlite3 pattern). `bun run build` succeeds.

- [ ] 3. **Callback Service — `fireSessionCallbacks()` and `fireSessionErrorCallbacks()`**
  **What**: Create a new service module that fires callback prompts to conductor sessions when a child session completes or errors. Follows the `notification-service.ts` best-effort pattern.
  **Files**: `src/lib/server/callback-service.ts` (new file)
  **Details**:
  - Import from:
    - `./db-repository`: `getPendingCallbacksForSession`, `markCallbackFired`, `getSession`, `getSessionByOpencodeId`
    - `./process-manager`: `getInstance` (the process-manager one, for ManagedInstance)
    - `./opencode-client`: `getClientForInstance`
  - **`fireSessionCallbacks(sourceSessionId: string, instanceId: string): Promise<void>`**:
    1. Look up the Fleet DB session via `getSessionByOpencodeId(sourceSessionId)` to get the fleet DB id. If not found, return (child might not be tracked).
    2. Query `getPendingCallbacksForSession(dbSession.id)`. If empty, return immediately (no-op — zero cost when feature not used).
    3. For each callback:
       a. Get the target instance via `getInstance(callback.target_instance_id)` (process-manager).
       b. If target instance is undefined or dead, mark callback as fired (avoid infinite retries) and continue.
       c. Get the target session from DB via `getSession(callback.target_session_id)` to get its `opencode_session_id`.
       d. Gather a change summary from the completed child: call `getClientForInstance(instanceId)` then `client.session.diff({ sessionID: sourceSessionId })`. Wrap in try/catch — if diff fails, use a fallback message.
       e. Build a structured callback message:
           ```
           [Fleet Callback] Child session completed.
           Session ID: {dbSession.id}
           Title: {dbSession.title}
           Files changed: {count}
             added: file1.ts
             modified: file2.ts
           Status: idle (completed successfully)
           ```
        f. **Mark callback as fired BEFORE sending the prompt** via `markCallbackFired(callback.id)`. This prevents duplicate prompts: if the DB write succeeds but the subsequent prompt fails, the callback is already marked `fired` and will not re-fire on the next busy→idle event. Duplicate prompts to the conductor are worse than a missed callback (the conductor can always check child status manually), so we optimize for preventing duplicates.
        g. Send prompt to conductor: `targetInstance.client.session.promptAsync({ sessionID: targetDbSession.opencode_session_id, parts: [{ type: "text", text: callbackMessage }] })`. If this fails, the callback is already marked fired (acceptable loss — see rationale above).
    4. Entire function is wrapped in try/catch at the top level — never throws.
  - **`fireSessionErrorCallbacks(sourceSessionId: string, instanceId: string): Promise<void>`**:
    - Same structure as above, but the message includes error status:
      ```
      [Fleet Callback] Child session encountered an error.
      Session ID: {dbSession.id}
      Title: {dbSession.title}
      Status: error
      ```
    - No diff retrieval needed for error callbacks.
  - Add module-level JSDoc matching `notification-service.ts` style:
    ```typescript
    /**
     * Callback service — fires completion/error prompts to conductor sessions.
     *
     * All functions are best-effort: they wrap operations in try/catch so that
     * a callback failure never breaks the calling SSE stream.
     */
    ```
  **Acceptance**: `bun run build` succeeds. Function is async but callers can fire-and-forget.

- [ ] 4. **API Types — Add `onComplete` to `CreateSessionRequest`**
  **What**: Extend `CreateSessionRequest` with an optional `onComplete` field for callback registration.
  **Files**: `src/lib/api-types.ts`
  **Details**:
  - Add to the `CreateSessionRequest` interface (after `branch?: string;` on line 17):
    ```typescript
    onComplete?: {
      notifySessionId: string;
      notifyInstanceId: string;
    };
    ```
  - `notifySessionId` = the Fleet DB session ID of the conductor (the session to send the callback prompt to).
  - `notifyInstanceId` = the instance ID of the conductor (needed to get the SDK client).
  **Acceptance**: `bun run build` succeeds. Type is available to the session creation route.

- [ ] 5. **Session Creation Route — Store callback on create**
  **What**: When a session is created with an `onComplete` field, insert a callback registration into the database.
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - Add import at the top: `import { insertSessionCallback } from "@/lib/server/db-repository";`
  - After the `insertSession()` try/catch block (after line 79, before building the response on line 81), add:
    ```typescript
    // Step 5: Register completion callback if requested
    if (body.onComplete?.notifySessionId && body.onComplete?.notifyInstanceId) {
      try {
        insertSessionCallback({
          id: randomUUID(),
          source_session_id: sessionDbId,
          target_session_id: body.onComplete.notifySessionId,
          target_instance_id: body.onComplete.notifyInstanceId,
        });
      } catch {
        console.warn('[POST /api/sessions] Failed to register callback');
      }
    }
    ```
  - Note: `randomUUID` is already imported (line 5). `sessionDbId` is already defined (line 66).
  - The `source_session_id` is the Fleet DB id (`sessionDbId`), not the OpenCode SDK session id. This matches what the SSE handler will look up via `getSessionByOpencodeId()`.
  **Acceptance**: Creating a session with `onComplete` in the body inserts a row into `session_callbacks`. Creating without `onComplete` has zero side effects.

- [ ] 6. **SSE Handler — Fire callbacks on completion and error**
  **What**: When the SSE handler detects a busy→idle transition or error, fire any registered callbacks for that session.
  **Files**: `src/app/api/sessions/[id]/events/route.ts`
  **Details**:
  - Add import at the top:
    ```typescript
    import {
      fireSessionCallbacks,
      fireSessionErrorCallbacks,
    } from "@/lib/server/callback-service";
    ```
  - In the `session.status` idle transition block (lines 121–131), after `createSessionCompletedNotification(...)` on line 129, add:
    ```typescript
    fireSessionCallbacks(
      dbSession.opencode_session_id,
      instanceId
    );
    ```
  - In the `session.idle` block (lines 133–143), after `createSessionCompletedNotification(...)` on line 141, add:
    ```typescript
    fireSessionCallbacks(
      dbSession.opencode_session_id,
      instanceId
    );
    ```
  - In the `error` block (lines 144–153), after `createSessionErrorNotification(...)` on line 150, add:
    ```typescript
    fireSessionErrorCallbacks(
      dbSession.opencode_session_id,
      instanceId
    );
    ```
  - **Critical**: These calls are intentionally NOT awaited. `fireSessionCallbacks` is async but fire-and-forget from the SSE handler — it must never block event forwarding. The function handles its own errors internally.
  - The calls pass `dbSession.opencode_session_id` (the OpenCode SDK session ID), which the callback service uses to look up the Fleet DB session via `getSessionByOpencodeId()`.
  **Acceptance**: When a child session completes, any registered callbacks fire a prompt to the conductor session. SSE stream is never interrupted by callback failures.

- [ ] 7. **Session Delete Route — Clean up callbacks**
  **What**: When a session is permanently deleted, remove any callback registrations that reference it (as source or target).
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Details**:
  - Add `deleteCallbacksForSession` to the existing import from `@/lib/server/db-repository` (line 11).
  - In the permanent delete section, after the `deleteNotificationsForSession` call (after line 218), add:
    ```typescript
    // Step 5.5: Delete related callbacks
    try {
      deleteCallbacksForSession(resolvedDbId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Callback cleanup failed:`, err);
    }
    ```
  - This cleans up callbacks where this session is either the source (child) or target (conductor).
  **Acceptance**: Deleting a session removes its callback registrations. Failure is non-fatal.

### Phase 2: Skill — Fleet Orchestration

- [ ] 8. **Create the Fleet Orchestration skill**
  **What**: Create a SKILL.md file that teaches Weave agents how to orchestrate child sessions via the Fleet API with automatic callbacks.
  **Files**: `~/.config/opencode/skills/fleet-orchestration/SKILL.md` (new file)
  **Details**:
  - **Frontmatter**:
    ```yaml
    ---
    name: fleet-orchestration
    description: Orchestrates multi-session workflows via Fleet API. Use when spawning child sessions for parallel or delegated work.
    ---
    ```
  - **Content sections** (in order):
    1. **When to Orchestrate** — Multi-repo tasks, parallel independent work, explicit user request. Do NOT orchestrate for simple single-file changes.
    2. **Discovering Your Identity** — The agent must know its own session ID and instance ID to register callbacks. Teach it to:
       - Call `curl -s http://localhost:${FLEET_PORT:-3000}/api/sessions` to list all sessions
       - Match by directory or title to find its own entry
       - Extract `instanceId` and `session.id` (the OpenCode session ID) from the matching entry
       - Note: the Fleet DB session ID is NOT directly exposed in the list response. The agent should use the session list to find the right entry, then use the values from that entry.
    3. **Spawning a Child Session** — Full curl command:
       ```bash
       curl -s -X POST http://localhost:${FLEET_PORT:-3000}/api/sessions \
         -H "Content-Type: application/json" \
         -d '{
           "directory": "/path/to/project",
           "title": "Auth Module",
           "isolationStrategy": "worktree",
           "onComplete": {
             "notifySessionId": "MY_SESSION_ID",
             "notifyInstanceId": "MY_INSTANCE_ID"
           }
         }'
       ```
        - The response from `POST /api/sessions` returns a `CreateSessionResponse` with the child's `instanceId` and `session.id` (OpenCode session ID). Save these for sending prompts to the child later.
        - **Field Mapping for `onComplete`**: The agent needs two values from the **conductor's own** session list entry (obtained via `GET /api/sessions`):

          | API Response Field | Source | Maps to `onComplete` Field |
          |---|---|---|
          | `instanceId` | `GET /api/sessions` list item for the conductor | `notifyInstanceId` |
          | `session.id` | `GET /api/sessions` list item for the conductor (the OpenCode session ID) | `notifySessionId` |

          The session creation route internally resolves the OpenCode session ID to the Fleet DB id via `getSessionByOpencodeId()` before storing the callback (see Task 9).
    4. **Sending a Prompt to the Child** — Full curl command:
       ```bash
       curl -s -X POST http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_OPENCODE_SESSION_ID}/prompt \
         -H "Content-Type: application/json" \
         -d '{
           "instanceId": "CHILD_INSTANCE_ID",
           "text": "Implement the JWT auth module with refresh token support..."
         }'
       ```
    5. **Callback Message Format** — What the conductor receives when a child completes:
       ```
       [Fleet Callback] Child session completed.
       Session ID: abc-123
       Title: Auth Module
       Files changed: 3
         added: src/auth/auth.model.ts
         modified: prisma/schema.prisma
         modified: src/app.module.ts
       Status: idle (completed successfully)
       ```
    6. **After Receiving a Callback** — How to inspect child results:
       - Get diffs: `curl -s http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_SESSION_ID}/diffs?instanceId=${CHILD_INSTANCE_ID}`
       - Get messages: `curl -s http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_SESSION_ID}?instanceId=${CHILD_INSTANCE_ID}`
    7. **Error Callbacks** — Format of error notifications and how to handle them (retry, escalate to user).
    8. **Best Practices**:
       - Always explain to the user what you're doing before spawning children
       - Use `isolationStrategy: "worktree"` for parallel work on the same repo
       - Give children clear, scoped instructions
       - Don't spawn more than 3-4 children at once (resource constraints)
       - Wait for callbacks before proceeding — don't poll
  **Acceptance**: File exists at the specified path with valid frontmatter and comprehensive instructions.

### Phase 2.5: API Adjustment for Usable Session IDs

- [ ] 9. **Adjust `onComplete` to accept OpenCode session IDs**
  **What**: The `onComplete.notifySessionId` field should accept the OpenCode session ID (what the agent sees in API responses) rather than the internal Fleet DB id (which isn't exposed). The session creation route resolves it to the fleet DB id before storing.
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - Update the callback registration code (from Task 5) to resolve the OpenCode session ID to the Fleet DB id:
    ```typescript
    if (body.onComplete?.notifySessionId && body.onComplete?.notifyInstanceId) {
      try {
        // Resolve the OpenCode session ID to the Fleet DB session ID
        const targetDbSession = getSessionByOpencodeId(body.onComplete.notifySessionId);
        if (targetDbSession) {
          insertSessionCallback({
            id: randomUUID(),
            source_session_id: sessionDbId,
            target_session_id: targetDbSession.id,
            target_instance_id: body.onComplete.notifyInstanceId,
          });
        } else {
          console.warn('[POST /api/sessions] Callback target session not found:', body.onComplete.notifySessionId);
        }
      } catch {
        console.warn('[POST /api/sessions] Failed to register callback');
      }
    }
    ```
  - Add `getSessionByOpencodeId` to the import from `@/lib/server/db-repository` (if not already imported — check: it's not currently imported in `route.ts`, only `insertSession`, `listSessions`, `getWorkspace`, `getInstance`, `updateSessionStatus` are imported on line 4).
  - This means Task 5 and Task 9 are combined — when implementing, use this version (Task 9) which supersedes the simpler version in Task 5.
  **Acceptance**: An agent can pass the OpenCode session ID (from `session.id` in API responses) as `notifySessionId` and the callback is correctly registered.

### Phase 3: Verification

- [ ] 10. **Build verification**
  **What**: Verify the entire project builds cleanly with the new code.
  **Files**: None (verification only)
  **Details**:
  - Run `bun run build` — must pass with zero errors
  - Run `bun test` — all existing tests must pass
  **Acceptance**: Clean build, all tests green.

- [ ] 11. **Manual integration test**
  **What**: End-to-end verification of the callback flow.
  **Files**: None (manual testing)
  **Details**:
  1. Start Fleet: `bun run dev`
  2. Create a conductor session in the UI (pick any directory)
  3. Note the conductor's OpenCode session ID and instance ID from `curl http://localhost:3000/api/sessions`
  4. From a terminal, create a child session with a callback:
     ```bash
     curl -s -X POST http://localhost:3000/api/sessions \
       -H "Content-Type: application/json" \
       -d '{"directory":"/tmp/test-child","title":"Test Child","onComplete":{"notifySessionId":"<CONDUCTOR_SESSION_ID>","notifyInstanceId":"<CONDUCTOR_INSTANCE_ID>"}}'
     ```
  5. Send a simple prompt to the child:
     ```bash
     curl -s -X POST http://localhost:3000/api/sessions/<CHILD_SESSION_ID>/prompt \
       -H "Content-Type: application/json" \
       -d '{"instanceId":"<CHILD_INSTANCE_ID>","text":"Create a file called hello.txt with the text hello world"}'
     ```
  6. Wait for the child to go idle
  7. Verify the conductor session received a `[Fleet Callback]` prompt message
  8. Verify the child's callback row is marked as `fired` in the DB
  **Acceptance**: Callback prompt appears in the conductor session. No errors in the Fleet console.

## Verification
- [ ] `bun run build` succeeds with zero type errors
- [ ] `bun test` — all existing tests pass (no regressions)
- [ ] Creating a session without `onComplete` has zero side effects (feature is inert)
- [ ] Creating a session with `onComplete` inserts a callback row
- [ ] Child busy→idle transition fires callback prompt to conductor
- [ ] Child error fires error callback prompt to conductor
- [ ] Deleting a session cleans up its callback registrations
- [ ] Callback failure never breaks the SSE stream
- [ ] Skill file has valid frontmatter and is loadable by Weave

## Implementation Order & Dependencies
```
Task 1 (schema) → Task 2 (repository) → Task 3 (service) → Task 4 (types)
                                                              ↓
Task 4 (types) → Task 5+9 (session create) ─────────────────→ Task 6 (SSE handler)
                                                              ↓
                                              Task 7 (session delete)
                                                              ↓
Task 8 (skill) ──────────────────────────────────────────────→ Task 10 (build) → Task 11 (manual test)
```
Tasks 1→2→3 must be sequential (each depends on the previous). Task 4 can be done in parallel with 1–3. Tasks 5+9, 6, 7 depend on Tasks 2–4. Task 8 (skill) is independent of all backend tasks. Task 10 depends on all code tasks. Task 11 depends on Task 10.
