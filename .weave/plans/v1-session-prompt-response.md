# V1: Session Prompt & Response — First Vertical Slice

## TL;DR
> **Summary**: Wire up the full loop — spawn an OpenCode server, create a session, send a prompt, and stream the response back to the UI in real-time. Replaces mock data for the core interaction path.
> **Estimated Effort**: Medium

## Context

### Original Request
Enable the most fundamental user interaction: start a new session (spawn an OpenCode process), send a prompt to an agent, and see the response streamed back in real-time in the UI.

### Key Findings

**SDK API Surface** (`@opencode-ai/sdk` v1.2.15):
- `createOpencodeServer({ hostname, port, timeout, config })` — spawns `opencode serve` as a child process, returns `{ url, close() }`
- `createOpencodeClient({ baseUrl })` — creates typed client against a running server
- `createOpencode(options)` — convenience: spawns server + creates client in one call
- `client.session.create({ body: { title?, parentID? } })` — creates a session, returns `Session` (SDK type)
- `client.session.list()` — lists sessions
- `client.session.get({ path: { id } })` — retrieves a session
- `client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text }] } })` — sends prompt, returns 204 immediately
- `client.event.subscribe()` — SSE stream returning `Promise<{ stream: AsyncGenerator<Event> }>` with event types: `message.updated`, `message.part.updated`, `message.part.delta`, `session.status`, `session.created`, etc. **Note**: Must `await` the call, then iterate `.stream` — i.e. `const { stream } = await client.event.subscribe(...); for await (const event of stream) { ... }`
- Key SDK event types for streaming: `EventMessagePartUpdated` (contains `Part` with delta text), `EventMessageUpdated` (message lifecycle), `EventSessionStatus` (idle/busy)

**CRITICAL: XDG_CONFIG_HOME Isolation Required**
The global config at `~/.config/opencode/opencode.json` loads the `@opencode_weave/weave@0.6.0` plugin, which causes a **deadlock** in serve mode (plugin calls `GET /skill` back to the server during bootstrap). The process manager MUST set `XDG_CONFIG_HOME` to an isolated temp directory when spawning OpenCode instances. See `findings.md` § 6 for full root cause analysis.

**New event type discovered**: `message.part.delta` — not in the SDK TypeScript types but emitted during streaming. Contains `{ sessionID, messageID, partID, field: "text", delta: "..." }`. This is the primary event for real-time text streaming. The `message.part.updated` events contain the accumulated text after each delta.

**SDK Session type** differs from UI Session type:
```typescript
// SDK Session
{ id, projectID, directory, title, version, time: { created, updated }, parentID?, summary?, share?, revert? }

// UI Session (mock)
{ id, workspaceId, name, status, currentAgent, initialPrompt, source, tokens, cost, contextUsage, tags, modifiedFiles, ... }
```

**Event model**: The SDK uses message-part-based events (text parts with deltas), not the high-level event types in `src/lib/types.ts` (message, tool_call, delegation_start, etc.). The activity stream component must be adapted.

**Server spawning**: The SDK's `createOpencodeServer` handles the full lifecycle — spawns `opencode serve`, waits for the "listening" stdout line, and returns a URL. Default port is 4096. For multi-process, we need dynamic port allocation.

**Current UI state**: All components use mock data imported directly. No API routes exist. `PromptInput` has a `// TODO: Send via SDK` comment. Components are all client components (`"use client"`).

**Architecture constraint**: `createOpencodeServer` uses Node.js `child_process.spawn` — it can only run server-side (API routes, not client components). The SDK client makes HTTP calls, also best kept server-side to avoid CORS and keep the OpenCode server unexposed.

## Objectives

### Core Objective
Deliver a working end-to-end flow: user clicks "New Session" → OpenCode process spawns → user types a prompt → response streams back into the activity stream in real-time.

### Deliverables
- [x] Process manager that spawns/tracks OpenCode server instances with dynamic port allocation
- [x] SDK client factory that creates typed clients connected to running servers
- [x] Next.js API routes for session CRUD and prompt submission
- [x] SSE proxy endpoint that streams OpenCode events to the browser
- [x] UI wiring: fleet page shows real sessions, session detail shows real streamed events
- [x] Prompt input sends real prompts through the API

### Definition of Done
- [x] User can click "New Session", which spawns a real OpenCode process
- [x] User can type a prompt and submit it
- [x] Response text streams into the activity stream in real-time
- [x] Session appears in the fleet overview with live status
- [x] `npm run build` succeeds with no type errors

### Guardrails (Must NOT)
- Do NOT refactor all mock data at once — only replace what this slice touches
- Do NOT implement pipelines, queues, templates, or batch features
- Do NOT build workspace isolation (worktrees, clones) — use existing directories
- Do NOT handle authentication/authorization
- Do NOT implement the full event taxonomy (delegation, plan progress, etc.) — focus on text messages and tool calls

## Architecture Decisions

### 1. Server-side Process Management (Singleton Module)
The process manager lives as a server-side singleton module (`src/lib/server/process-manager.ts`). It tracks spawned OpenCode instances in a `Map<string, ProcessInfo>`. We use Node.js module-level state, which persists across API route invocations in the same Next.js server process.

**Port allocation**: Start from port 4097 and increment. Track used ports in the Map. On process death, reclaim the port.

### 2. SDK Client Per Process
Each spawned OpenCode server gets its own `OpencodeClient` instance, stored alongside the process info. The client is created immediately after the server reports ready.

### 3. API Route Layer (Next.js Route Handlers)
Use Next.js App Router route handlers (`src/app/api/...`). These are server-side only and can import Node.js modules. Three key routes:
- `POST /api/sessions` — spawn process + create session
- `POST /api/sessions/[id]/prompt` — send a prompt
- `GET /api/sessions/[id]/events` — SSE proxy

### 4. SSE Proxy Pattern
The OpenCode SDK's `event.subscribe()` returns an async generator. The API route wraps this into a standard SSE `ReadableStream` response. The browser uses `EventSource` or `fetch` with a streaming reader to consume events.

### 5. UI Event Model Adaptation
The SDK emits fine-grained events (`message.part.updated` with text deltas, `message.updated` for lifecycle). Rather than mapping these to the current `SessionEvent` type (which was designed for the mock), we introduce a simpler `StreamEvent` type for V1 that accumulates message parts into displayable messages.

### 6. State Management
Use React state + `useRef` for the event stream connection. No external state management library for V1. The session detail page owns the event stream lifecycle. The fleet page polls for session list.

## TODOs

### Layer 1: Dependencies & Foundation

- [x] 1. **Install the OpenCode SDK**
  **What**: Add `@opencode-ai/sdk` as a dependency
  **Files**: `package.json`, `package-lock.json`
  **Commands**: `npm install @opencode-ai/sdk`
  **Acceptance**: `import { createOpencode } from "@opencode-ai/sdk"` compiles without error

- [x] 2. **Configure Next.js for server-side Node.js APIs (REQUIRED)**
  **What**: Update `next.config.ts` to set `serverExternalPackages: ["@opencode-ai/sdk"]`. This is **required** because the SDK is ESM-only (`"type": "module"`) and uses `child_process` — without this, the Next.js build will fail with bundling errors.
  **Files**: `next.config.ts`
  **Acceptance**: `npm run build` succeeds; no "Module not found: child_process" errors

### Layer 2: Server-side Process & Client Management

- [x] 3. **Create the Process Manager**
  **What**: A server-side singleton that spawns OpenCode server instances, tracks them by ID, handles port allocation, and provides health status. Each "managed instance" stores: `{ id, port, url, directory, client, close(), status, createdAt }`. **CRITICAL**: Must isolate `XDG_CONFIG_HOME` to a temp directory before spawning to prevent the Weave plugin deadlock (see findings.md § 6).
  **Files**: `src/lib/server/process-manager.ts`
  **Key APIs**:
  - `spawnInstance(directory: string): Promise<ManagedInstance>` — sets `XDG_CONFIG_HOME` to isolated temp dir, calls `createOpencodeServer` with `config: { plugin: [], permission: { edit: "allow", bash: "allow" } }`, creates client, stores in Map
  - `getInstance(id: string): ManagedInstance | undefined`
  - `listInstances(): ManagedInstance[]`
  - `destroyInstance(id: string): void` — calls `close()`, removes from Map
  - Port allocation: start at 4097, scan for first unused port in range 4097-4200
  **Dependencies**: Task 1
  **Acceptance**: Unit-testable module; `spawnInstance("/some/dir")` spawns a process that listens on an allocated port; no Weave plugin deadlock

- [x] 4. **Create the SDK Client Wrapper**
  **What**: A thin helper that creates an `OpencodeClient` from a managed instance URL and provides typed session/event operations. This is more of a convenience layer that the API routes use.
  **Files**: `src/lib/server/opencode-client.ts`
  **Key APIs**:
  - `getClientForInstance(instanceId: string): OpencodeClient` — retrieves from process manager
  - Re-exports relevant SDK types for use in API routes
  **Dependencies**: Task 3
  **Acceptance**: Can call `client.session.create()` against a running instance

### Layer 3: API Routes

- [x] 5. **POST `/api/sessions` — Create Session**
  **What**: Accepts `{ directory: string, title?: string }`. Spawns an OpenCode instance (or reuses one for the same directory), creates a session via SDK, returns the session info. Maps the SDK `Session` type to the response.
  **Files**: `src/app/api/sessions/route.ts`
  **Request body**: `{ directory: string, title?: string }`
  **Response**: `{ instanceId: string, session: SDKSession }` (200)
  **Error cases**: Directory doesn't exist (400), spawn failure (500)
  **Dependencies**: Tasks 3, 4
  **Acceptance**: `curl -X POST /api/sessions -d '{"directory":"/tmp/test"}' ` returns a valid session

- [x] 6. **GET `/api/sessions` — List Sessions**
  **What**: Lists all sessions across all managed instances. Iterates process manager instances, calls `client.session.list()` on each, returns aggregated list with instance metadata.
  **Files**: `src/app/api/sessions/route.ts` (same file, GET handler)
  **Response**: `Array<{ instanceId, session, status }>`
  **Dependencies**: Tasks 3, 4
  **Acceptance**: Returns empty array when no instances running; returns sessions after creating one

- [x] 7. **GET `/api/sessions/[id]` — Get Session Detail**
  **What**: Given a session ID (which includes instance routing info), returns the session detail including messages. Looks up the instance, calls `client.session.get()` and `client.session.messages()`.
  **Files**: `src/app/api/sessions/[id]/route.ts`
  **Query params**: `instanceId` (required — identifies which OpenCode instance owns the session)
  **Response**: `{ session, messages: Array<{ info: Message, parts: Part[] }> }`
  **Dependencies**: Tasks 3, 4
  **Acceptance**: Returns session with messages after a prompt has been sent

- [x] 8. **POST `/api/sessions/[id]/prompt` — Send Prompt**
  **What**: Sends a prompt to a session using `client.session.promptAsync()`. Returns 204 immediately (fire-and-forget; results come via SSE).
  **Files**: `src/app/api/sessions/[id]/prompt/route.ts`
  **Request body**: `{ instanceId: string, text: string }`
  **Response**: 204 No Content
  **Dependencies**: Tasks 3, 4
  **Acceptance**: Prompt is accepted; events start appearing on the SSE stream

- [x] 9. **GET `/api/sessions/[id]/events` — SSE Event Stream**
  **What**: Proxies the OpenCode SDK's `event.subscribe()` as a standard SSE stream to the browser. The SDK returns `Promise<{ stream: AsyncGenerator }>` — must `await` it, then iterate `result.stream`. Filters events to only those relevant to the requested session. Sends keepalive comments every 15s.
  **Files**: `src/app/api/sessions/[id]/events/route.ts`
  **Query params**: `instanceId` (required)
  **Response**: `text/event-stream` with events formatted as `data: { type, properties }\n\n`
  **Event filtering**: Only forward events matching the session — use `properties.part?.sessionID` for `message.part.updated` events, `properties.info?.sessionID` for `message.updated` events, `properties.sessionID` for `session.*` events
  **Implementation pattern**:
  ```typescript
  const { stream } = await client.event.subscribe({ query: { directory } });
  for await (const event of stream) {
    // filter by sessionId, serialize, write to SSE response
  }
  ```
  **Connection lifecycle**: Stream stays open until client disconnects (AbortSignal) or instance dies
  **Dependencies**: Tasks 3, 4
  **Acceptance**: `curl -N /api/sessions/abc/events?instanceId=xyz` streams events in real-time when a prompt is sent

### Layer 4: Shared Types & Mapping

- [x] 10. **Define V1 API types and mappers**
  **What**: Create shared TypeScript types for the API layer — request/response shapes, and a mapper that converts SDK events into a simplified UI event model for V1. Don't try to map to the full `SessionEvent` type yet.
  **Files**: `src/lib/api-types.ts`
  **Key types**:
  - `CreateSessionRequest`, `CreateSessionResponse`
  - `SendPromptRequest`
  - `SessionListItem` — minimal session info for fleet view
  - `StreamedEvent` — union type: `{ type: "text", messageId, text, delta }` | `{ type: "delta", messageId, partId, delta }` | `{ type: "tool", messageId, tool, state }` | `{ type: "status", sessionId, status }` | `{ type: "message", messageId, role, cost?, tokens? }`
  **Note**: The SDK emits `message.part.delta` events for real-time text streaming (not in TypeScript types). These contain `{ sessionID, messageID, partID, field: "text", delta: "..." }`. The `message.part.updated` events contain the accumulated text after each delta.
  **Dependencies**: Task 1 (for SDK types)
  **Acceptance**: Types compile; mappers tested with sample SDK event payloads

### Layer 5: React Hooks

- [x] 11. **Create `useSessionEvents` hook**
  **What**: A React hook that connects to the SSE endpoint and accumulates events into renderable state. Manages the EventSource lifecycle, reconnection, and cleanup.
  **Files**: `src/hooks/use-session-events.ts`
  **API**:
  ```typescript
  function useSessionEvents(sessionId: string, instanceId: string): {
    messages: AccumulatedMessage[];  // messages with accumulated text
    status: "connecting" | "connected" | "disconnected" | "error";
    error?: string;
  }
  ```
  **Key behavior**:
  - Opens `EventSource` to `/api/sessions/${sessionId}/events?instanceId=${instanceId}`
  - On `message.part.updated` (where `part.sessionID` matches): accumulates delta text into the correct message
  - On `message.part.updated` with `type: "tool"`: tracks tool call state
  - On `message.updated`: creates/updates message metadata (role, cost, tokens)
  - On `session.status`: tracks idle/busy
  - On disconnect: attempts reconnect with backoff
  - Cleanup on unmount
  **Dependencies**: Task 9, 10
  **Acceptance**: Hook connects, receives events, and produces an array of messages with accumulated text

- [x] 12. **Create `useCreateSession` hook**
  **What**: A hook for creating a new session via the API. Handles loading state and errors.
  **Files**: `src/hooks/use-create-session.ts`
  **API**:
  ```typescript
  function useCreateSession(): {
    createSession: (directory: string, title?: string) => Promise<{ instanceId: string, session: Session }>;
    isLoading: boolean;
    error?: string;
  }
  ```
  **Dependencies**: Task 5
  **Acceptance**: Calling `createSession("/some/dir")` creates a real session and returns its ID

- [x] 13. **Create `useSendPrompt` hook**
  **What**: A hook for sending a prompt to a session.
  **Files**: `src/hooks/use-send-prompt.ts`
  **API**:
  ```typescript
  function useSendPrompt(): {
    sendPrompt: (sessionId: string, instanceId: string, text: string) => Promise<void>;
    isSending: boolean;
    error?: string;
  }
  ```
  **Dependencies**: Task 8
  **Acceptance**: Calling `sendPrompt` fires the API call and the response appears in the event stream

- [x] 14. **Create `useSessions` hook**
  **What**: A hook for fetching the session list with polling.
  **Files**: `src/hooks/use-sessions.ts`
  **API**:
  ```typescript
  function useSessions(pollIntervalMs?: number): {
    sessions: SessionListItem[];
    isLoading: boolean;
    error?: string;
    refetch: () => void;
  }
  ```
  **Behavior**: Fetches `GET /api/sessions` on mount and every `pollIntervalMs` (default 5000ms)
  **Dependencies**: Task 6
  **Acceptance**: Returns real session list from running instances

### Layer 6: UI Wiring

- [x] 15. **Wire up "New Session" button**
  **What**: The `NewSessionButton` in `header.tsx` currently does nothing. Add an `onClick` handler that opens a simple dialog/modal asking for a workspace directory, then calls `useCreateSession` and navigates to the new session page.
  **Files**:
  - `src/components/layout/header.tsx` — add onClick + dialog trigger
  - `src/components/session/new-session-dialog.tsx` — new component: simple form with directory input + submit
  **Behavior**: Click → dialog opens → enter directory → submit → spawn + create → navigate to `/sessions/[id]?instanceId=xxx`
  **Dependencies**: Task 12
  **Acceptance**: Clicking "New Session", entering a directory, and submitting creates a real session and navigates to its page

- [x] 16. **Wire up Session Detail page with real events**
  **What**: Replace mock data in `src/app/sessions/[id]/page.tsx` with real data. Use `useSessionEvents` for the activity stream. Read `instanceId` from query params. Fetch initial session data from API.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - Remove imports from `mock-data.ts`
  - Parse `instanceId` from URL search params
  - Use `useSessionEvents(sessionId, instanceId)` to get live event stream
  - Pass accumulated messages to a V1-compatible activity stream
  - Show connection status indicator
  **Dependencies**: Tasks 11, 17
  **Acceptance**: Session detail page shows real streamed messages from the OpenCode agent

- [x] 17. **Create V1 Activity Stream component**
  **What**: A simplified activity stream that renders accumulated messages from `useSessionEvents` instead of the mock `SessionEvent[]` format. Renders user messages and assistant messages with streaming text, plus tool call indicators.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Props**: `{ messages: AccumulatedMessage[], status: string }`
  **Rendering**:
  - User messages: show the prompt text
  - Assistant messages: show streamed text (updates in real-time as deltas arrive), show tool calls as collapsible items
  - Status indicator: "Thinking..." when busy, typing indicator
  - Auto-scroll to bottom on new content
  **Dependencies**: Task 11
  **Acceptance**: Messages render and update in real-time as the agent responds

- [x] 18. **Wire up Prompt Input with real submission**
  **What**: Update `PromptInput` to accept `sessionId` and `instanceId` props, use `useSendPrompt` to send the message, and show loading state while sending. Also optimistically add the user message to the activity stream.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  - Accept `onSend: (text: string) => Promise<void>` callback prop
  - Show spinner/disabled state while sending
  - Clear input on successful send
  - Disable when session is busy (agent is processing)
  **Dependencies**: Task 13
  **Acceptance**: Typing a message and pressing send delivers it to the agent; the input clears and disables while the agent processes

- [x] 19. **Wire up Fleet page with real session list**
  **What**: Replace mock session data on the fleet page with data from `useSessions`. The `SessionCard` needs to handle the new data shape (SDK Session + orchestrator metadata) or a mapper is used.
  **Files**:
  - `src/app/page.tsx` — use `useSessions` instead of `mockSessions`
  - `src/components/fleet/session-card.tsx` — accept the API's `SessionListItem` type (or map to existing `Session` type)
  **Changes**:
  - Import and use `useSessions` hook
  - Map API response to display format
  - Show loading skeleton while fetching
  - Link to session detail page with `instanceId` in URL
  - Update summary bar to compute from real data
  **Dependencies**: Task 14
  **Acceptance**: Fleet page shows real sessions; clicking a card navigates to the live session detail

### Layer 7: Resilience & Cleanup

- [x] 20. **Handle process lifecycle edge cases**
  **What**: Handle cases where the OpenCode process dies unexpectedly, the port is already in use, or the server takes too long to start. Add cleanup on Next.js server shutdown.
  **Files**: `src/lib/server/process-manager.ts`
  **Additions**:
  - Listen for process `exit` event → mark instance as dead, remove from map
  - Port conflict detection: if spawn fails, try next port
  - Configurable timeout (default 10s for server startup)
  - `destroyAll()` method for graceful shutdown
  - Register `process.on("exit", destroyAll)` for cleanup
  **Dependencies**: Task 3
  **Acceptance**: Killing an OpenCode process marks it as dead in the UI; re-spawning works; clean shutdown kills all processes

- [x] 21. **Add error states to UI**
  **What**: Show appropriate error states when: session creation fails, SSE connection drops, prompt fails to send, process dies mid-session.
  **Files**:
  - `src/components/session/activity-stream-v1.tsx` — connection lost banner
  - `src/components/session/prompt-input.tsx` — error toast on send failure
  - `src/components/session/new-session-dialog.tsx` — error display
  - `src/app/sessions/[id]/page.tsx` — error state when session not found or instance dead
  **Dependencies**: Tasks 15-19
  **Acceptance**: Each failure mode shows a user-friendly error; no uncaught exceptions in console

## Verification
- [x] `npm install` succeeds
- [x] `npm run build` succeeds with no type errors
- [x] Manual test: Create session → send prompt → see streamed response
- [x] Manual test: Fleet page shows the new session with live status
- [x] Manual test: Navigate back to session → reconnect event stream → see history
- [x] Manual test: Kill OpenCode process → UI shows error state
- [x] No mock data imports remain in the files modified by this slice (session detail, fleet page for sessions)
- [x] Other pages (pipelines, queue, templates, history, alerts) still work with their mock data

## Open Questions & Risks

1. **OpenCode binary availability**: The SDK spawns `opencode` from PATH. The binary must be installed on the machine. If not found, `spawnInstance` will fail. Consider adding a startup check or a config option for the binary path.

2. **Single-directory limitation**: Each `createOpencodeServer` call creates a server scoped to one directory. If the user wants multiple sessions in the same directory, they share one server instance. The process manager should handle this (reuse instance for same directory).

3. **CORS / Network**: The browser never talks to OpenCode directly — the Next.js API layer proxies everything. This avoids CORS issues but adds a hop for SSE events. Latency should be acceptable for V1.

4. **SSE reconnection**: If the Next.js server restarts (e.g., during development with hot reload), all SSE connections drop and all OpenCode processes are orphaned. For V1, this is acceptable — the user would need to create new sessions. Process cleanup (`SIGTERM`) on exit mitigates orphaned processes.

5. **Event volume**: OpenCode can emit a high volume of events (every text delta, every tool call step). The SSE proxy must be efficient — no unnecessary serialization or buffering. Using `ReadableStream` with direct writing should be sufficient.

6. **SDK `event.subscribe()` vs `global.event()`**: The SDK has two event streams: per-directory events (`event.subscribe`) and global events (`global.event`). For V1, use `event.subscribe` which is scoped to the instance's directory and requires a `directory` query param.

7. **Permission requests**: OpenCode may pause and request permission (e.g., to edit files, run bash commands). The SDK emits `permission.updated` events. V1 should either auto-approve all permissions (via config `permission: { edit: "allow", bash: "allow" }`) or show a basic permission UI. Recommend auto-approve for V1 and note this as a V2 feature.
