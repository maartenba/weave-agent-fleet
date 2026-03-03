# OpenCode Dependency UX — First-Run Experience

## TL;DR
> **Summary**: When OpenCode CLI is missing, the Next.js server silently accepts requests then returns generic 500s. Add startup validation, specific ENOENT error propagation, frontend install instructions, and workspace cleanup on spawn failure.
> **Estimated Effort**: Medium

## Context
### Original Request
Improve the first-run experience when `opencode` CLI is not installed or not available on PATH. Four specific issues: no startup check, generic error on ENOENT, no frontend diagnostic, and orphaned workspaces on spawn failure.

### Key Findings

1. **`spawnOpencodeServer()` (process-manager.ts:64-154)** — Uses `spawn("opencode", ...)`. When `opencode` isn't on PATH, Node emits an `"error"` event with `err.code === "ENOENT"`. This error is caught at line 134 (`proc.on("error", ...)`), rejected as a raw Error, then re-thrown at line 489 as-is. The error message from Node is something like `"spawn opencode ENOENT"` — not user-friendly, and the calling code has no way to distinguish it from other spawn failures.

2. **Session creation route (route.ts:44-133)** — The entire spawn+create flow is in a single try/catch that returns `{ error: "Failed to create session" }` (line 129-132). The actual ENOENT error is only logged. Workspace is created at line 46-50 (Step 1) but never cleaned up if Steps 2-3 fail.

3. **`instrumentation.ts`** — Currently only does a version check. Perfect place to add a startup probe since it runs once on server boot (when `NEXT_RUNTIME === "nodejs"`).

4. **Frontend error display (new-session-dialog.tsx:170-175)** — Shows `error` string from `useCreateSession()` hook in a red alert box. The hook already extracts `data.error` from the API response (use-create-session.ts:44-45). So if the API returns a specific message, the frontend will display it — no changes needed to the plumbing, just the message content.

5. **Workspace cleanup** — `cleanupWorkspace()` exists in workspace-manager.ts and handles all three strategies correctly. For `existing` strategy, `createWorkspace()` reuses an existing DB record (line 94-96), so cleanup is safe (it just marks it cleaned, doesn't delete the user's directory).

6. **No health/status API exists** — There are no `/api/health` or `/api/status` endpoints currently.

## Objectives
### Core Objective
When `opencode` is missing, surface a clear, actionable error at every layer — server logs on startup, API responses with specific error codes, and frontend UI with install instructions.

### Deliverables
- [ ] Startup validation in `instrumentation.ts` that checks for `opencode` and logs a warning
- [ ] A lightweight `/api/health` endpoint exposing opencode availability
- [ ] Custom error type `OpencodeNotFoundError` in process-manager that distinguishes ENOENT from other failures
- [ ] Session route returns a specific error code/message when opencode is missing (not generic 500)
- [ ] Frontend `new-session-dialog.tsx` shows install instructions when it receives the opencode-missing error
- [ ] Workspace cleanup in session route when `spawnInstance()` or session creation fails

### Definition of Done
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm test` passes (existing + new tests)
- [ ] Manual test: with `opencode` removed from PATH, server logs a warning at startup, session creation shows install instructions in the UI
- [ ] Manual test: with `opencode` on PATH, no behavioral changes

### Guardrails (Must NOT)
- Do NOT change launcher scripts (`scripts/launcher.sh`, `scripts/launcher.cmd`) — they already work well
- Do NOT change install scripts — they already have soft warnings
- Do NOT block server startup if opencode is missing (it might be installed later)
- Do NOT add complex dependency management — just detection and messaging
- Do NOT change the `useCreateSession` hook's interface — the `error` string already flows to the UI

## TODOs

- [ ] 1. **Create `OpencodeNotFoundError` class in process-manager**
  **What**: Add a named error class that `spawnOpencodeServer()` throws when the spawn fails with `ENOENT`. This lets callers distinguish "opencode not installed" from "port conflict" or "timeout". In the `proc.on("error", ...)` handler (line 134), check if `(error as NodeJS.ErrnoException).code === "ENOENT"` and wrap it in the new error type before rejecting. Export the class so the session route can `instanceof` check it.
  **Files**: `src/lib/server/process-manager.ts`
  **Details**:
  - Define `export class OpencodeNotFoundError extends Error` near the top of the file (after imports, before `spawnOpencodeServer`).
  - In the `proc.on("error", ...)` handler at line 134:
    ```
    proc.on("error", (error) => {
      clearTimeout(id);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new OpencodeNotFoundError());
      } else {
        reject(error);
      }
    });
    ```
  - The error message should be: `"OpenCode CLI ('opencode') not found on PATH. Install it from https://opencode.ai or set OPENCODE_BIN to the full path."`
  - Also in `spawnInstance()` (line 480-485), when the retry loop catches an `OpencodeNotFoundError`, do NOT retry — break immediately and re-throw. ENOENT won't be fixed by trying a different port.
  **Acceptance**: `OpencodeNotFoundError` is exported; spawning with a missing binary throws this specific type; retry loop short-circuits on ENOENT.

- [ ] 2. **Add `checkOpencodeAvailability()` utility function**
  **What**: Create a reusable function that probes whether `opencode` is callable. Use `execFileSync("opencode", ["version"])` (or just attempt `which`/`where`) wrapped in a try/catch. Cache the result in a module-level variable so it's only checked once. Export the function for use by both `instrumentation.ts` and the health endpoint.
  **Files**: `src/lib/server/process-manager.ts`
  **Details**:
  - Add near the top (after the OPENCODE_BIN support block):
    ```typescript
    let _opencodeAvailable: boolean | null = null;

    export function checkOpencodeAvailability(): boolean {
      if (_opencodeAvailable !== null) return _opencodeAvailable;
      const command = process.env.OPENCODE_BIN ?? "opencode";
      try {
        execFileSync(command, ["version"], {
          stdio: "pipe",
          timeout: 5000,
          shell: process.platform === "win32",
        });
        _opencodeAvailable = true;
      } catch {
        _opencodeAvailable = false;
      }
      return _opencodeAvailable;
    }

    /** Reset cached availability — for tests or after install */
    export function _resetOpencodeAvailability(): void {
      _opencodeAvailable = null;
    }
    ```
  - Import `execFileSync` from `child_process` (already imports `spawn`; add `execFileSync` to that import).
  **Acceptance**: `checkOpencodeAvailability()` returns `true` when `opencode` is on PATH, `false` when it isn't. Result is cached.

- [ ] 3. **Add startup validation in `instrumentation.ts`**
  **What**: Call `checkOpencodeAvailability()` during server startup and log a prominent warning if opencode is not found. Do NOT block startup — this is advisory only.
  **Files**: `src/instrumentation.ts`
  **Details**:
  - After the version check, add:
    ```typescript
    const { checkOpencodeAvailability } = await import("@/lib/server/process-manager");
    if (!checkOpencodeAvailability()) {
      console.warn(
        "\n" +
        "  ⚠ WARNING: OpenCode CLI ('opencode') not found on PATH.\n" +
        "  Weave Fleet requires OpenCode to create and manage agent sessions.\n" +
        "  Sessions will fail until opencode is installed.\n" +
        "\n" +
        "  Install: curl -fsSL https://opencode.ai/install | bash\n" +
        "  Or set:  OPENCODE_BIN=/path/to/opencode\n"
      );
    }
    ```
  **Acceptance**: Starting the server without `opencode` on PATH prints a clear warning. Starting with `opencode` available prints nothing extra.

- [ ] 4. **Create `/api/health` endpoint**
  **What**: A lightweight GET endpoint that returns server health status including opencode availability. This lets the frontend (or monitoring) check prerequisites without attempting a session creation.
  **Files**: `src/app/api/health/route.ts` (new file)
  **Details**:
  - Returns JSON: `{ "status": "ok", "opencode": { "available": true|false, "message": "..." } }`
  - Uses `checkOpencodeAvailability()` from process-manager.
  - Always returns HTTP 200 (the server itself is healthy; opencode is a dependency status).
  - Keep it minimal — no auth, no DB access.
    ```typescript
    import { NextResponse } from "next/server";
    import { checkOpencodeAvailability } from "@/lib/server/process-manager";

    export async function GET() {
      const available = checkOpencodeAvailability();
      return NextResponse.json({
        status: "ok",
        opencode: {
          available,
          ...(!available && {
            message: "OpenCode CLI not found. Install from https://opencode.ai or set OPENCODE_BIN.",
          }),
        },
      });
    }
    ```
  **Acceptance**: `GET /api/health` returns `{ status: "ok", opencode: { available: true } }` when opencode is present, and includes a message when it's not.

- [ ] 5. **Return specific error from session creation route on ENOENT**
  **What**: In the POST handler's catch block, check if the error is `OpencodeNotFoundError` and return a specific error response with a distinct `code` field, a user-friendly message, and HTTP 503 (Service Unavailable — the dependency is missing, not an internal bug).
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - Import `OpencodeNotFoundError` from process-manager.
  - Replace the generic catch block (lines 127-133) with:
    ```typescript
    } catch (err) {
      // Clean up workspace if it was created but spawn/session failed
      if (workspace) {
        cleanupWorkspace(workspace.id).catch((cleanupErr) => {
          log.warn("sessions-route", "Failed to clean up workspace after session creation failure", { workspaceId: workspace.id, err: cleanupErr });
        });
      }

      if (err instanceof OpencodeNotFoundError) {
        return NextResponse.json(
          {
            error: "OpenCode CLI is not installed. Install it from https://opencode.ai or set the OPENCODE_BIN environment variable.",
            code: "OPENCODE_NOT_FOUND",
          },
          { status: 503 }
        );
      }

      log.error("sessions-route", "Failed to create session", { err });
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 }
      );
    }
    ```
  - Move the `workspace` variable declaration outside the try block so it's accessible in catch:
    ```typescript
    let workspace: WorkspaceInfo | undefined;
    try {
      workspace = await createWorkspace({ ... });
      // ... rest of the flow
    } catch (err) {
      // workspace is now accessible here for cleanup
    }
    ```
  - Import `cleanupWorkspace` from workspace-manager (add to existing import).
  - Import `type WorkspaceInfo` from workspace-manager for the variable type.
  **Acceptance**: When `opencode` is missing, POST `/api/sessions` returns `{ error: "...", code: "OPENCODE_NOT_FOUND" }` with HTTP 503. Workspace is cleaned up on any failure.

- [ ] 6. **Show install instructions in the frontend**
  **What**: In `new-session-dialog.tsx`, detect the `OPENCODE_NOT_FOUND` error code and render an enhanced error message with install instructions instead of the raw error string.
  **Files**: `src/components/session/new-session-dialog.tsx`, `src/hooks/use-create-session.ts`
  **Details**:
  - In `use-create-session.ts`, extend the error extraction to also capture the `code` field from the API response:
    ```typescript
    // Add a new state variable
    const [errorCode, setErrorCode] = useState<string | undefined>();

    // In the fetch error handling:
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
      const code = (data as { code?: string }).code;
      setError(message);
      setErrorCode(code);
      throw new Error(message);
    }

    // Clear on new attempt:
    setErrorCode(undefined);

    // Add to return:
    return { createSession, isLoading, error, errorCode };
    ```
  - Update `UseCreateSessionResult` interface to include `errorCode?: string`.
  - In `new-session-dialog.tsx`, destructure `errorCode` from the hook and render enhanced UI when `errorCode === "OPENCODE_NOT_FOUND"`:
    ```tsx
    {error && (
      <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <span>{error}</span>
          {errorCode === "OPENCODE_NOT_FOUND" && (
            <div className="text-muted-foreground">
              <p>Install OpenCode CLI:</p>
              <code className="block mt-1 px-2 py-1 bg-muted rounded text-xs font-mono">
                curl -fsSL https://opencode.ai/install | bash
              </code>
              <p className="mt-1">
                Or set <code className="font-mono">OPENCODE_BIN</code> to the binary path and restart the server.
              </p>
            </div>
          )}
        </div>
      </div>
    )}
    ```
  **Acceptance**: When session creation fails due to missing opencode, the dialog shows the error message plus install instructions with the `curl` command. For all other errors, behavior is unchanged.

- [ ] 7. **Add workspace cleanup on failure in session route**
  **What**: This is part of TODO 5 but deserves explicit attention. When `spawnInstance()` fails (any error, not just ENOENT) or when `instance.client.session.create()` fails, the workspace created in Step 1 should be cleaned up. For `existing` strategy, cleanup is a no-op (marks as cleaned but doesn't delete the directory). For `worktree`/`clone`, cleanup removes the ephemeral directory.
  **Files**: `src/app/api/sessions/route.ts`
  **Details**:
  - The workspace variable is already hoisted in TODO 5. The cleanup call in the catch block handles this.
  - Important: Only clean up `worktree` and `clone` workspaces (since `existing` workspaces may be shared). Actually, `cleanupWorkspace("existing")` just calls `markWorkspaceCleaned()` which is safe and idempotent. However, for `existing` strategy, `createWorkspace()` returns an existing record (line 94-96) — we should NOT clean up a pre-existing shared workspace just because one session creation failed. Add a guard:
    ```typescript
    // Only clean up if we actually created a new workspace (not reused)
    if (workspace && workspace.id === newlyCreatedWorkspaceId) {
      cleanupWorkspace(workspace.id).catch(...);
    }
    ```
  - Actually, simpler approach: track whether the workspace was newly created vs. reused. For `existing` strategy, `createWorkspace` returns an existing workspace's ID when one is found (workspace-manager.ts:94-96). We can compare the workspace ID to the UUID we'd expect from a new creation — but that's fragile. Better approach: only clean up for `worktree` and `clone` strategies, since those always create new workspaces:
    ```typescript
    if (workspace && workspace.strategy !== "existing") {
      cleanupWorkspace(workspace.id).catch(...);
    }
    ```
  **Acceptance**: After a failed session creation with `worktree` or `clone` strategy, the ephemeral workspace directory is cleaned up. With `existing` strategy, nothing is cleaned up (the user's directory is never touched).

- [ ] 8. **Add tests for new error handling**
  **What**: Add test cases to the existing session route test file and add a unit test for `OpencodeNotFoundError` propagation.
  **Files**: `src/app/api/sessions/__tests__/route.test.ts`
  **Details**:
  - Test: "Returns 503 with OPENCODE_NOT_FOUND when spawnInstance throws OpencodeNotFoundError"
    - Mock `spawnInstance` to throw `new OpencodeNotFoundError()`
    - Assert response status is 503
    - Assert response body has `code: "OPENCODE_NOT_FOUND"`
    - Assert response body has a user-friendly `error` message
  - Test: "Cleans up worktree workspace when spawnInstance fails"
    - Mock `createWorkspace` to return a worktree workspace
    - Mock `spawnInstance` to throw a generic error
    - Assert `cleanupWorkspace` was called with the workspace ID
  - Test: "Does NOT clean up existing workspace when spawnInstance fails"
    - Mock `createWorkspace` to return an existing workspace
    - Mock `spawnInstance` to throw a generic error
    - Assert `cleanupWorkspace` was NOT called
  - Test: "Cleans up workspace when session.create fails"
    - Mock `spawnInstance` to succeed
    - Mock `instance.client.session.create` to throw
    - Assert `cleanupWorkspace` was called
  - Add `OpencodeNotFoundError` to the mock/import setup.
  **Acceptance**: All new tests pass. Existing tests still pass.

- [ ] 9. **Add test for health endpoint**
  **What**: Basic tests for the `/api/health` endpoint.
  **Files**: `src/app/api/health/__tests__/route.test.ts` (new file)
  **Details**:
  - Test: "Returns 200 with opencode available true when check passes"
  - Test: "Returns 200 with opencode available false and message when check fails"
  - Mock `checkOpencodeAvailability` from process-manager.
  **Acceptance**: Tests pass and cover both states.

## Verification
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm test` passes (all existing + new tests)
- [ ] Manual: Remove `opencode` from PATH → server starts with warning, `GET /api/health` shows `available: false`, session creation shows install instructions in UI
- [ ] Manual: With `opencode` on PATH → no warning, health shows `available: true`, session creation works normally
- [ ] No regressions: existing launcher scripts and install scripts unchanged
