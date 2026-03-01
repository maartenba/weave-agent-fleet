# Session Resume

## TL;DR
> **Summary**: Add a "Resume Session" feature that lets users reconnect to disconnected/stopped sessions by spawning a new opencode instance for the same directory and re-establishing the SSE event stream with full chat history.
> **Estimated Effort**: Medium

## Context

### Original Request
When a user navigates to a disconnected or stopped session in the Fleet UI, they should see a "Resume" button. Clicking it should spawn a new opencode instance, connect to the existing opencode session ID, re-establish SSE events, and allow the user to continue chatting with full history.

### Key Findings

1. **Session data model supports resumption** — `DbSession` (`src/lib/server/db-repository.ts`, line 34-44) stores `opencode_session_id`, `instance_id`, `workspace_id`, `directory`, and `status`. The `status` field supports `"active" | "idle" | "stopped" | "completed" | "disconnected"`. For resumption we need to update `instance_id` when a new instance is assigned — currently there is **no `updateSessionInstanceId` function** in the repository. One must be added.

2. **Session creation flow** — `POST /api/sessions` (`src/app/api/sessions/route.ts`, lines 13-94) follows: validate directory → create workspace → spawn instance → `client.session.create()` → insert session to DB. Resume is similar but skips workspace creation and session creation — instead it reuses the existing workspace/session and calls `client.session.get()` to verify the session exists in the opencode instance's SQLite database.

3. **Instance reuse by directory** — `spawnInstance()` (`src/lib/server/process-manager.ts`, lines 352-418) already reuses a running instance if one exists for the same directory. This means if two sessions share a directory and one is resumed, it won't spawn a duplicate instance. This is exactly the behavior we want.

4. **OpenCode stores sessions per-project directory** — OpenCode's SQLite database lives in a `.opencode/` directory within the project (per `OPENCODE_SESSION_RESUMPTION.md`). When a new `opencode serve` is spawned for the same directory, it reads from the same database, so the existing session ID, messages, and parts are all available. This is the key architectural fact that makes resumption work.

5. **SDK supports session retrieval** — The opencode SDK client exposes `client.session.get({ sessionID })` and `client.session.messages({ sessionID })` which work against the local opencode SQLite database. The `client.session.promptAsync()` works with any existing session ID. No special "resume" API is needed — just spawning the server for the right directory is sufficient.

6. **Session detail page** — `src/app/sessions/[id]/page.tsx` (403 lines) currently shows an `isStopped` banner at line 206-209 when a session is stopped. However, it doesn't handle the `disconnected` state explicitly — it only tracks `isStopped` as local state set by the terminate button. The page depends on `instanceId` from the URL query parameter, and if the instance is dead, the SSE connection fails silently and the hook sets status to `"disconnected"`.

7. **SSE events route** — `GET /api/sessions/[id]/events` (`src/app/api/sessions/[id]/events/route.ts`) returns 404 if the instance is not found or dead (line 35-39). After resume, the new instance ID must be used.

8. **Session list shows disconnected state** — `LiveSessionCard` (`src/components/fleet/live-session-card.tsx`, lines 28-59) already displays "disconnected" status with amber dot. The card links to the session page with the (now-dead) `instanceId` in the URL, which needs updating on resume.

9. **No `updateSessionInstanceId` exists** — The db-repository has `updateSessionStatus()` but no function to update `instance_id`. A new function is needed.

10. **Fleet page session list** — The `GET /api/sessions` handler already correctly determines `sessionStatus` as `"disconnected"` when the instance is dead but session was active (line 210-221). After resume, the session row's `instance_id` will point to the new running instance.

### Architecture Decision: Resume API Endpoint

**Decision**: Create a dedicated `POST /api/sessions/[id]/resume` endpoint rather than overloading the existing `POST /api/sessions`.

**Why?** The creation flow (`POST /api/sessions`) creates a new workspace, new opencode session, and new DB record. Resume reuses all existing records and only spawns/reuses an instance. The logic is sufficiently different that a separate endpoint is clearer and avoids adding conditional branches to the creation flow.

**Flow**:
1. Look up the DB session by `id` (the fleet DB id or opencode session id)
2. Get the workspace to find the `directory`
3. `spawnInstance(directory)` — reuses existing if one is running for that directory
4. Verify the opencode session still exists: `client.session.get({ sessionID: opencode_session_id })`
5. Update the DB session: set `instance_id` to new instance, set `status` to `"active"`, clear `stopped_at`
6. Return the new `instanceId` + session data so the UI can redirect

### Architecture Decision: UI Resume Flow

**Decision**: Show a Resume button in **two** places:
1. **Fleet page** — on `LiveSessionCard` when status is `disconnected` (inline button, similar to the existing Trash2 terminate button)
2. **Session detail page** — a prominent banner + button when the session is disconnected/stopped

After resume, the page navigates to the session with the **new** `instanceId` in the URL, which re-establishes the SSE connection.

## Objectives

### Core Objective
Allow users to resume disconnected or stopped sessions by spawning a new opencode instance and reconnecting to the existing opencode session, preserving full conversation history.

### Deliverables
- [x] `updateSessionInstanceId()` function in db-repository
- [x] `POST /api/sessions/[id]/resume` API endpoint
- [x] `useResumeSession` React hook
- [x] Resume button on session detail page (banner for disconnected/stopped state)
- [x] Resume button on fleet page `LiveSessionCard`
- [x] Tests for the resume API endpoint
- [x] Tests for the new db-repository function

### Definition of Done
- [x] `npm run build` succeeds with zero errors
- [x] `npm run test` passes (including new resume tests)
- [x] `npm run lint` passes
- [x] User can resume a disconnected session and continue chatting
- [x] Session history is fully preserved after resume
- [x] Fleet page shows session as active after resume

### Guardrails (Must NOT)
- Must NOT create a new opencode session — must reuse the existing `opencode_session_id`
- Must NOT create a new workspace — must reuse the existing workspace record
- Must NOT allow resuming sessions whose workspace directory no longer exists (e.g., cleaned-up worktree/clone)
- Must NOT allow resuming sessions that are already active (already have a running instance)

## TODOs

- [x] 1. **Add `updateSessionInstanceId` to db-repository**
  **What**: Add a function that updates a session's `instance_id` and resets its status to `"active"` and clears `stopped_at`. This is needed because when a session is resumed, it gets assigned to a new (or reused) instance.
  **Files**:
    - `src/lib/server/db-repository.ts` — add `updateSessionForResume(id: string, instanceId: string): void` function. SQL: `UPDATE sessions SET instance_id = @instance_id, status = 'active', stopped_at = NULL WHERE id = @id`
  **Acceptance**: Function exists, is exported, and is tested.

- [x] 2. **Add db-repository tests for `updateSessionForResume`**
  **What**: Add test cases for the new function following the existing test pattern in `db-repository.test.ts`.
  **Files**:
    - `src/lib/server/__tests__/db-repository.test.ts` — add test cases:
      - Updates instance_id and status to active
      - Clears stopped_at
      - Works with disconnected session
      - Works with stopped session
      - No-op for non-existent session ID (doesn't throw)
  **Acceptance**: `npm run test -- db-repository` passes with new tests.

- [x] 3. **Create `POST /api/sessions/[id]/resume` API route**
  **What**: New API endpoint that resumes a disconnected/stopped session.
  **Files**:
    - `src/app/api/sessions/[id]/resume/route.ts` — new file

  **Implementation details**:
  ```
  POST /api/sessions/[id]/resume
  Request body: (none needed — all info comes from DB)
  Response 200: { instanceId: string, session: SDKSession }
  ```

  **Logic**:
  1. Await `_recoveryComplete` (same as other endpoints)
  2. Resolve the session from DB: try `getSession(id)`, fall back to `getSessionByOpencodeId(id)`
  3. Validate: session must exist (404 if not), must be in `disconnected` or `stopped` status (409 if already active/idle)
  4. Get the workspace via `getWorkspace(session.workspace_id)` — validate directory still exists (400 if cleaned up or directory missing)
  5. Call `validateDirectory(workspace.directory)` to ensure it's still safe
  6. Call `spawnInstance(workspace.directory)` to get or create an instance
  7. Verify the opencode session exists: `instance.client.session.get({ sessionID: session.opencode_session_id })`. If it doesn't exist (SDK throws/returns null), return 404 with message "Session no longer exists in opencode — it may have been deleted"
  8. Call `updateSessionForResume(session.id, instance.id)` to update DB
  9. Return `{ instanceId: instance.id, session: sdkSession }`

  **Error handling**:
  - 404: Session not found in fleet DB
  - 409: Session is already active/idle (not resumable)
  - 400: Workspace directory doesn't exist or is invalid
  - 404: Opencode session not found in the instance's DB
  - 500: Instance spawn failure or unexpected error

  **Acceptance**: Endpoint returns 200 with instanceId and session data for a disconnected session.

- [x] 4. **Add API route tests for resume endpoint**
  **What**: Unit tests following the established pattern in `src/app/api/sessions/__tests__/route.test.ts`.
  **Files**:
    - `src/app/api/sessions/__tests__/resume.test.ts` — new file

  **Test cases**:
  - Returns 404 when session not found in DB
  - Returns 409 when session is already active
  - Returns 409 when session is idle (still running)
  - Returns 200 for disconnected session with valid directory
  - Returns 200 for stopped session with valid directory
  - Returns 400 when workspace directory no longer exists
  - Returns 400 when validateDirectory throws
  - Returns 404 when opencode session not found in instance
  - Returns 500 when spawnInstance throws
  - Updates session instance_id in DB on success
  - Reuses existing running instance for the same directory
  - Returns correct instanceId and session data in response

  **Acceptance**: `npm run test -- resume` passes.

- [x] 5. **Create `useResumeSession` React hook**
  **What**: Client-side hook that calls the resume endpoint and handles loading/error state, following the pattern of `useTerminateSession`.
  **Files**:
    - `src/hooks/use-resume-session.ts` — new file

  **Interface**:
  ```typescript
  export interface ResumeSessionResult {
    instanceId: string;
    session: SDKSession;
  }

  export interface UseResumeSessionResult {
    resumeSession: (sessionId: string) => Promise<ResumeSessionResult>;
    isResuming: boolean;
    error?: string;
  }
  ```

  **Implementation**: `fetch(`/api/sessions/${sessionId}/resume`, { method: "POST" })` — parse response, return `{ instanceId, session }`.

  **Acceptance**: Hook exports correctly, handles loading/error states.

- [x] 6. **Add Resume button to session detail page**
  **What**: When the session is disconnected or stopped (and not completed), show a banner with a Resume button. On click, call `resumeSession`, then navigate to the same session page with the new `instanceId` in the URL query params.
  **Files**:
    - `src/app/sessions/[id]/page.tsx` — modify

  **Changes**:
  1. Import `useResumeSession` hook and `useRouter` from `next/navigation`
  2. Add a `isDisconnected` state derived from session status — detect when SSE status is `"error"` or `"disconnected"` AND the session metadata indicates the instance is dead. Also detect via the session list data if possible.
  3. Add a new state to track whether we need to show the resume banner. The simplest approach: fetch session metadata on mount (already done at line 58-72), and check if the `sessionStatus` from the list API is `"disconnected"` or `"stopped"`. Add `sessionStatus` to the metadata fetch.
  4. **Alternative (simpler) approach**: The page already fetches `/api/sessions/{id}?instanceId={instanceId}`. If this fetch returns a 404 (instance dead), show the resume banner. The SSE hook will also end up in `"error"` or `"disconnected"` status.
  5. Add a banner similar to the existing `isStopped` banner (line 206-209) but with amber/yellow styling and a "Resume Session" button:
     ```tsx
     {isResumable && (
       <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
         <span className="text-sm text-amber-400">
           Session disconnected — the opencode instance is no longer running.
         </span>
         <Button
           variant="outline"
           size="sm"
           onClick={handleResume}
           disabled={isResuming}
         >
           {isResuming ? "Resuming…" : "Resume Session"}
         </Button>
       </div>
     )}
     ```
  6. `handleResume` calls `resumeSession(sessionId)`, then on success: `router.replace(`/sessions/${sessionId}?instanceId=${result.instanceId}`)` — this causes the page to re-mount with the new instanceId, re-establishing SSE.
  7. Disable the PromptInput when session is disconnected (it's already disabled when `status === "error"`).

  **Acceptance**: Disconnected session shows resume banner, clicking it resumes and reconnects.

- [x] 7. **Add Resume button to LiveSessionCard on fleet page**
  **What**: Add a Resume button (Play icon) on `LiveSessionCard` when `sessionStatus === "disconnected"`, positioned similarly to the existing Trash2 terminate button.
  **Files**:
    - `src/components/fleet/live-session-card.tsx` — modify

  **Changes**:
  1. Accept a new `onResume` prop: `onResume: (sessionId: string) => void`
  2. When `sessionStatus === "disconnected"`, show a Play/RotateCcw icon button alongside the existing terminate button (or replacing it since disconnected sessions can't be "terminated" in a meaningful way — but the terminate button already filters via `canTerminate`):
     ```tsx
     {isDisconnected && (
       <Button
         variant="ghost"
         size="icon"
         className="absolute top-2 right-10 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-green-500 hover:bg-green-500/10"
         onClick={(e) => {
           e.preventDefault();
           e.stopPropagation();
           onResume(session.id);
         }}
         title="Resume session"
       >
         <RotateCcw className="h-3.5 w-3.5" />
       </Button>
     )}
     ```
  3. The terminate button is already hidden for stopped/completed but still shown for disconnected. Keep the terminate button for disconnected sessions (user might want to mark it as stopped rather than resume).

  **Acceptance**: Disconnected session cards show a resume icon button on hover.

- [x] 8. **Wire resume handler in fleet page**
  **What**: Connect the `onResume` prop from `LiveSessionCard` through the fleet page to actually call the resume API and navigate.
  **Files**:
    - `src/app/page.tsx` — modify
    - `src/components/fleet/session-group.tsx` — modify (pass through `onResume` prop)

  **Changes in `src/app/page.tsx`**:
  1. Import `useResumeSession` and `useRouter`
  2. Add `handleResume` callback:
     ```typescript
     const handleResume = async (sessionId: string) => {
       try {
         const result = await resumeSession(sessionId);
         router.push(`/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}`);
       } catch {
         // error surfaced inside useResumeSession
         refetch(); // refresh list to show updated state
       }
     };
     ```
  3. Pass `onResume={handleResume}` to all `LiveSessionCard` instances.

  **Changes in `src/components/fleet/session-group.tsx`**:
  1. Accept `onResume` prop and pass it through to `LiveSessionCard`.

  **Acceptance**: Clicking resume on a disconnected card in the fleet page navigates to the resumed session.

- [x] 9. **Handle edge case: session already active on resume attempt**
  **What**: If a user tries to resume a session that's already active (e.g., another tab already resumed it, or the poll hasn't updated yet), the API returns 409. The hook should surface this as a user-friendly error. The fleet page should just refetch to show the updated state.
  **Files**:
    - `src/hooks/use-resume-session.ts` — ensure 409 error message is user-friendly
    - `src/app/page.tsx` — `handleResume` catch block already calls `refetch()`

  **Acceptance**: Attempting to resume an already-active session shows a non-destructive error and the UI refreshes.

- [x] 10. **Add ResumeSessionResponse to api-types**
  **What**: Define the response type for the resume endpoint so it's shared between API route and hook.
  **Files**:
    - `src/lib/api-types.ts` — add:
      ```typescript
      export interface ResumeSessionResponse {
        instanceId: string;
        session: Session;
      }
      ```

  **Acceptance**: Type is exported and used by both the API route and the hook.

## Implementation Order

```
1. db-repository function (no dependencies)
2. db-repository tests (depends on 1)
3. api-types (no dependencies)
4. Resume API route (depends on 1, 3)
5. Resume API tests (depends on 4)
6. useResumeSession hook (depends on 3)
7. Session detail page resume banner (depends on 6)
8. LiveSessionCard resume button (depends on 6)
9. Fleet page + SessionGroup wiring (depends on 8)
10. Edge case handling (depends on 6)
```

Tasks 1-3 can be done in parallel. Tasks 4-5 in sequence. Tasks 6-9 can partially overlap. Task 10 is a refinement pass.

## Verification

- [x] `npm run build` succeeds with zero errors
- [x] `npm run test` passes with all new tests
- [x] `npm run lint` passes
- [x] Manual test: create session → terminate it → verify "disconnected" shows → click Resume → verify session is active with full history
- [x] Manual test: resume from fleet page card → navigates to resumed session
- [x] Manual test: resume from session detail page banner → reconnects SSE and shows messages
- [x] Manual test: try to resume already-active session → shows appropriate error
- [x] Manual test: try to resume session whose directory was cleaned up → shows appropriate error
