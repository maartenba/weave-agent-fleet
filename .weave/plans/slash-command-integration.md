# Slash Command Integration — Native Execution via SDK

> **GitHub Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/66

## TL;DR
> **Summary**: Route `/command` inputs through `client.session.command()` instead of `client.session.promptAsync()`, and expose a dedicated API route for Fleet programmatic access. Currently, slash commands are sent as plain text — this change gives structured execution with proper error handling.
> **Estimated Effort**: Medium

## Context

### Original Request
Integrate native slash command execution into the opencode-orchestrator so that:
1. **UI-side**: When a user submits text starting with `/command`, the prompt flow detects the prefix and routes through `client.session.command()` (structured execution) rather than `client.session.promptAsync()` (plain text).
2. **Fleet API**: A dedicated `POST /api/sessions/[id]/command` route allows Loom (the Fleet orchestrator) to invoke any slash command programmatically.

### Key Findings

**SDK `client.session.command()` signature** (from `Session2` class in SDK v2):
```typescript
command(parameters: {
  sessionID: string;
  directory?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  arguments?: string;
  command?: string;
  variant?: string;
  parts?: Array<{ id?: string; type: "file"; mime: string; filename?: string; url: string; source?: FilePartSource }>;
}): RequestResult<SessionCommandResponses, SessionCommandErrors, ...>
```

**Response type** (`SessionCommandResponses`):
```typescript
{ 200: { info: AssistantMessage; parts: Array<Part> } }
```

**Error types** (`SessionCommandErrors`):
- `400: BadRequestError`
- `404: NotFoundError`

**Current prompt flow**:
1. `PromptInput.handleSend()` → calls `onSend(text, agent)` prop
2. Session page wires `onSend` to `handleSend` → calls `sendPrompt(sessionId, instanceId, text, agent)`
3. `useSendPrompt` hook → `POST /api/sessions/[id]/prompt` with `{ instanceId, text, agent }`
4. API route → `client.session.promptAsync({ sessionID, parts: [{ type: "text", text }], agent? })`
5. Returns `204 No Content` (fire-and-forget; results arrive via SSE)

**Key patterns**:
- `getClientForInstance(instanceId)` — all API routes use this, throws if instance not found/dead
- Error handling: try/catch around `getClientForInstance` → 404; try/catch around SDK call → 500
- `RouteContext { params: Promise<{ id: string }> }` — Next.js 16 async params
- Tests use vitest, mock `@/lib/server/opencode-client` and `@/lib/server/process-manager`
- `AutocompleteCommand` type has `name` and `description` only (slim shape for autocomplete)
- The `command()` SDK method is on the **same `client.session`** object — no new client needed

**Slash command text format** (from autocomplete): when user selects a command, autocomplete inserts `"/commandName "`. After the space comes the arguments text (or nothing). So a submitted prompt like `/plan create a thing` means `command="plan"`, `arguments="create a thing"`.

## Objectives

### Core Objective
Enable structured slash command execution that gives proper error responses and programmatic Fleet access, replacing the current "send as plain text and hope OpenCode parses it" approach.

### Deliverables
- [x] Pure utility function to parse slash command text into `{ command, arguments }` or `null`
- [x] New API route `POST /api/sessions/[id]/command` for structured command execution
- [x] New request/response types in `api-types.ts`
- [x] Modified `useSendPrompt` hook with command detection and routing
- [x] Tests for the parser utility
- [ ] Tests for the new API route

### Definition of Done
- [x] `npx vitest run` — all tests pass (existing + new)
- [x] `npx tsc --noEmit` — no type errors (compilation succeeds via `next build`)
- [x] Submitting `/plan some task` in the UI routes through the command API, not promptAsync
- [x] Submitting `hello world` (no slash) still routes through promptAsync as before
- [x] `POST /api/sessions/{id}/command` returns 200 with `{ success, sessionId }` on success (fire-and-forget)
- [x] `POST /api/sessions/{id}/command` returns 400/404/500 on errors

### Guardrails (Must NOT)
- Must NOT break existing prompt flow for non-slash-command text
- Must NOT change autocomplete behavior (discovery/selection stays the same)
- Must NOT introduce new dependencies
- Must NOT change the SSE event stream — command results still arrive via existing SSE

## TODOs

- [x] 1. **Add slash command parser utility**
  **What**: Create a pure function `parseSlashCommand(text: string): { command: string; arguments?: string } | null` that detects if text starts with `/commandName` and extracts the command name and optional arguments. Returns `null` for non-command text.
  **Files**: Create `src/lib/slash-command-utils.ts`
  **Implementation**:
  ```typescript
  /**
   * Parse a slash-command string into structured parts.
   * Returns null if the text is not a slash command.
   *
   * Examples:
   *   "/plan create a widget" → { command: "plan", arguments: "create a widget" }
   *   "/compact"              → { command: "compact" }
   *   "hello world"           → null
   *   "/ "                    → null (no command name)
   *   ""                      → null
   */
  export interface ParsedSlashCommand {
    command: string;
    arguments?: string;
  }

  export function parseSlashCommand(text: string): ParsedSlashCommand | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;

    // Match: slash + one-or-more non-whitespace chars (the command name)
    const match = trimmed.match(/^\/(\S+)(?:\s+(.+))?$/s);
    if (!match) return null;

    const command = match[1];
    const args = match[2]?.trim();
    return { command, arguments: args || undefined };
  }
  ```
  **Acceptance**: Unit tests pass for all edge cases (normal commands, commands with args, multi-line args, no slash, empty string, slash-only, slash-with-space-only).

- [x] 2. **Add API types for command execution**
  **What**: Add `SendCommandRequest` and `SendCommandResponse` types to `api-types.ts`.
  **Files**: Modify `src/lib/api-types.ts`
  **Implementation**: Add after the existing `SendPromptRequest` type:
  ```typescript
  /** Request body for POST /api/sessions/[id]/command */
  export interface SendCommandRequest {
    instanceId: string;
    command: string;
    arguments?: string;
    agent?: string;
    model?: string;
  }

  /** Response body for POST /api/sessions/[id]/command (mirrors SDK SessionCommandResponse) */
  export interface SendCommandResponse {
    info: {
      id: string;
      sessionID: string;
      role: "assistant";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
    parts: Part[];
  }
  ```
  **Acceptance**: `npx tsc --noEmit` passes; types are importable from `@/lib/api-types`.

- [x] 3. **Create API route `POST /api/sessions/[id]/command`**
  **What**: New API route that accepts `SendCommandRequest`, calls `client.session.command()`, and returns `SendCommandResponse`. Follows the exact same patterns as the prompt route (error handling, `RouteContext`, `getClientForInstance`).
  **Files**: Create `src/app/api/sessions/[id]/command/route.ts`
  **Implementation**:
  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { getClientForInstance } from "@/lib/server/opencode-client";
  import type { SendCommandRequest } from "@/lib/api-types";

  interface RouteContext {
    params: Promise<{ id: string }>;
  }

  // POST /api/sessions/[id]/command — execute a slash command in a session
  export async function POST(
    request: NextRequest,
    context: RouteContext
  ): Promise<NextResponse> {
    const { id: sessionId } = await context.params;

    let body: SendCommandRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { instanceId, command, arguments: args, agent, model } = body;

    if (!instanceId || typeof instanceId !== "string") {
      return NextResponse.json(
        { error: "instanceId is required" },
        { status: 400 }
      );
    }

    if (!command || typeof command !== "string" || !command.trim()) {
      return NextResponse.json(
        { error: "command is required and must be non-empty" },
        { status: 400 }
      );
    }

    let client;
    try {
      client = getClientForInstance(instanceId);
    } catch {
      return NextResponse.json(
        { error: "Instance not found or unavailable" },
        { status: 404 }
      );
    }

    try {
      const result = await client.session.command({
        sessionID: sessionId,
        command: command.trim(),
        ...(args ? { arguments: args } : {}),
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
      });

      // The SDK returns { data, error } — check for error
      if (result.error) {
        console.error(`[POST /api/sessions/${sessionId}/command] SDK error:`, result.error);
        return NextResponse.json(
          { error: "Command execution failed" },
          { status: 400 }
        );
      }

      return NextResponse.json(result.data ?? {}, { status: 200 });
    } catch (err) {
      console.error(`[POST /api/sessions/${sessionId}/command] Error:`, err);
      return NextResponse.json(
        { error: "Failed to execute command" },
        { status: 500 }
      );
    }
  }
  ```
  **Acceptance**: Route handles all error cases (invalid JSON, missing instanceId, missing command, instance not found, SDK error, unexpected throw). Returns 200 with `{ info, parts }` on success.

- [x] 4. **Modify `useSendPrompt` to detect and route slash commands**
  **What**: Update the `useSendPrompt` hook so that when the submitted text is a slash command, it calls `POST /api/sessions/[id]/command` instead of `POST /api/sessions/[id]/prompt`. Import and use `parseSlashCommand` to detect. The hook signature stays the same so no changes propagate to the session page or `PromptInput`.
  **Files**: Modify `src/hooks/use-send-prompt.ts`
  **Implementation**: The `sendPrompt` callback currently always calls `/api/sessions/.../prompt`. Modify it to:
  1. Import `parseSlashCommand` from `@/lib/slash-command-utils`
  2. Call `parseSlashCommand(text)` at the top of the callback
  3. If it returns a parsed command: call `POST /api/sessions/${sessionId}/command` with `{ instanceId, command: parsed.command, arguments: parsed.arguments, agent }`
  4. If it returns `null`: call the existing prompt endpoint as before
  5. Both paths share the same error handling pattern

  ```typescript
  // Inside sendPrompt callback:
  const parsed = parseSlashCommand(text);

  let url: string;
  let payload: Record<string, unknown>;

  if (parsed) {
    url = `/api/sessions/${encodeURIComponent(sessionId)}/command`;
    payload = {
      instanceId,
      command: parsed.command,
      arguments: parsed.arguments,
      agent,
    };
  } else {
    url = `/api/sessions/${encodeURIComponent(sessionId)}/prompt`;
    payload = { instanceId, text, agent };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  ```

  **Key detail**: The command route returns 200 with a body (unlike prompt's 204). Both are "ok" statuses, so the existing `!response.ok` check works for both. The hook doesn't need to do anything with the command response body — results still flow via SSE.

  **Acceptance**: Submitting `/plan foo` calls the command endpoint. Submitting `hello` calls the prompt endpoint. `isSending` and `error` state work identically for both paths.

- [x] 5. **Write unit tests for `parseSlashCommand`**
  **What**: Comprehensive tests for the parser utility covering all edge cases.
  **Files**: Create `src/lib/__tests__/slash-command-utils.test.ts`
  **Test cases**:
  ```
  - returns null for empty string
  - returns null for whitespace-only string
  - returns null for text not starting with /
  - returns null for "/" alone
  - returns null for "/ " (slash + space, no command name)
  - returns { command: "plan" } for "/plan"
  - returns { command: "plan" } for "/plan " (trailing space)
  - returns { command: "plan", arguments: "create a widget" } for "/plan create a widget"
  - returns { command: "compact" } for "/compact"
  - handles leading whitespace: "  /plan" → { command: "plan" }
  - handles multi-word arguments: "/plan create a multi-word task" → arguments = "create a multi-word task"
  - handles multi-line arguments (if args contain newlines)
  - handles special characters in command name: "/my-command" → { command: "my-command" }
  ```
  **Acceptance**: All test cases pass.

- [x] 6. **Write unit tests for `POST /api/sessions/[id]/command` route**
  **What**: Test the new API route following the exact pattern from `src/app/api/sessions/__tests__/route.test.ts` and `src/app/api/sessions/[id]/messages/__tests__/route.test.ts`.
  **Files**: Create `src/app/api/sessions/[id]/command/__tests__/route.test.ts`
  **Test cases**:
  ```
  - returns 400 for invalid JSON body
  - returns 400 when instanceId is missing
  - returns 400 when instanceId is not a string
  - returns 400 when command is missing
  - returns 400 when command is empty string
  - returns 404 when instance not found (getClientForInstance throws)
  - returns 200 with { info, parts } on successful command execution
  - passes arguments through to client.session.command when provided
  - passes agent through to client.session.command when provided
  - passes model through to client.session.command when provided
  - omits optional fields when not provided
  - returns 400 when SDK returns error (result.error is truthy)
  - returns 500 when client.session.command throws unexpectedly
  ```
  **Mock setup** (following existing patterns):
  ```typescript
  vi.mock("@/lib/server/process-manager", () => ({
    _recoveryComplete: Promise.resolve(),
  }));

  vi.mock("@/lib/server/opencode-client", () => ({
    getClientForInstance: vi.fn(),
  }));
  ```
  **Acceptance**: All test cases pass; pattern matches existing test conventions.

## Verification
- [ ] `npx vitest run` — all tests pass (new + existing)
- [ ] `npx tsc --noEmit` — no type errors
- [ ] No regressions: existing prompt submission, autocomplete, and SSE flows work unchanged
- [ ] Manual test: type `/compact` in UI → routes through command API
- [ ] Manual test: type `fix the bug` in UI → routes through prompt API as before
- [ ] Fleet API test: `curl -X POST .../api/sessions/{id}/command -d '{"instanceId":"...","command":"plan","arguments":"build a thing"}'` → returns 200

## File Summary

| File | Action | Task |
|------|--------|------|
| `src/lib/slash-command-utils.ts` | Create | 1 |
| `src/lib/api-types.ts` | Modify | 2 |
| `src/app/api/sessions/[id]/command/route.ts` | Create | 3 |
| `src/hooks/use-send-prompt.ts` | Modify | 4 |
| `src/lib/__tests__/slash-command-utils.test.ts` | Create | 5 |
| `src/app/api/sessions/[id]/command/__tests__/route.test.ts` | Create | 6 |

## Dependency Order

```
Task 1 (parser util) ─────┬──→ Task 4 (modify hook — depends on 1)
                           │
Task 2 (types) ────────────┼──→ Task 3 (API route — depends on 2)
                           │
Task 5 (parser tests — depends on 1) │
                                     │
Task 6 (route tests — depends on 3) ─┘
```

Recommended execution order: **1 → 2 → 3 → 5 → 6 → 4** (or parallelize 1+2, then 3+5 in parallel, then 4+6).
