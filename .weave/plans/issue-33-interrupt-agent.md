# Issue #33: Provide the Ability to Interrupt a Working Agent

## TL;DR
> **Summary**: Expose the existing `POST /api/sessions/[id]/abort` backend endpoint in the frontend by creating a `useAbortSession()` hook, adding an "Interrupt" button to the session detail page header, and adding an "Interrupt" action to session cards on the fleet page.
> **Estimated Effort**: Short
> **Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/33

## Context
### Original Request
Users need the ability to interrupt a working agent without fully terminating the session. The backend already supports this via `POST /api/sessions/[id]/abort?instanceId=xxx` which calls `client.session.abort()` from the OpenCode SDK. This is purely a frontend exposure task.

### Key Findings
- **Backend route exists**: `src/app/api/sessions/[id]/abort/route.ts` — accepts `POST` with `instanceId` as a query parameter, returns `{ message, sessionId, instanceId }` on success.
- **Hook pattern is well-established**: `use-terminate-session.ts` is the closest analog — uses `useState` for `isTerminating` and `error`, exposes an async function. No `useCallback` wrapping (unlike `use-send-prompt.ts` which does use `useCallback`). The abort hook should match `use-terminate-session.ts` exactly since it's the same shape (session action, no extra body params).
- **Session detail page** (`src/app/sessions/[id]/page.tsx`): Header actions area contains a Stop button with a two-click confirmation pattern (`stopConfirm` state toggle). The Interrupt button should sit beside it and use the same confirmation UX pattern for consistency.
- **Session status in detail page**: `sessionStatus` from `useSessionEvents` is either `"idle"` or `"busy"`. The Interrupt button should only be visible when `sessionStatus === "busy"` and the session is not stopped.
- **Live session card** (`src/components/fleet/live-session-card.tsx`): Action buttons are absolutely positioned in the top-right corner, stacked horizontally. Actions are passed as callback props from `page.tsx` through `LiveSessionCard`. The card's `sessionStatus` field (from `SessionListItem`) uses `"active" | "idle" | "stopped" | "completed" | "disconnected"`.
- **Fleet page** (`src/app/page.tsx`): Wires up `onTerminate`, `onResume`, `onDelete`, `onOpen` handlers and passes them to `LiveSessionCard`. A new `onAbort` prop will need to be threaded through all render paths (no grouping, status, source, directory).
- **Session group** (`src/components/fleet/session-group.tsx`): Also renders `LiveSessionCard` — needs the `onAbort` prop threaded through.
- **Icon choice**: The project already imports from `lucide-react`. `OctagonX` (stop sign with X) clearly communicates "interrupt/abort" without conflicting with the existing `Square` (stop) icon. `Hand` is another option for "halt". `CircleStop` is too similar to `Square`.

## Objectives
### Core Objective
Allow users to interrupt (abort) a busy agent session from both the session detail page and the fleet overview, without terminating the session.

### Deliverables
- [x] `useAbortSession()` hook in `src/hooks/use-abort-session.ts`
- [x] "Interrupt" button in session detail page header (`src/app/sessions/[id]/page.tsx`)
- [x] "Interrupt" action button on live session cards (`src/components/fleet/live-session-card.tsx`)
- [x] Wiring through fleet page and session group (`src/app/page.tsx`, `src/components/fleet/session-group.tsx`)

### Definition of Done
- [x] Clicking "Interrupt" on a busy session calls `POST /api/sessions/[id]/abort?instanceId=xxx` and the agent stops its current work
- [x] The Interrupt button is only visible when the session is actively busy/working
- [x] Accidental interrupts are prevented by a confirmation pattern (two-click)
- [x] The button is disabled while the abort request is in flight
- [x] `npm run build` passes with no type errors

### Guardrails (Must NOT)
- Must NOT modify the backend API route — it already works correctly
- Must NOT conflate interrupt with terminate — they are semantically different operations (abort cancels current work; terminate kills the session)
- Must NOT show the Interrupt button for idle, stopped, completed, or disconnected sessions

## TODOs

- [x] 1. **Create `useAbortSession` hook**
  **What**: Create a new React hook following the exact pattern of `use-terminate-session.ts`. The hook should:
  - Be a `"use client"` module
  - Export `UseAbortSessionResult` interface with `{ abortSession, isAborting, error? }`
  - `abortSession(sessionId: string, instanceId: string): Promise<void>` calls `POST /api/sessions/${encodeURIComponent(sessionId)}/abort?instanceId=${encodeURIComponent(instanceId)}`
  - Manage `isAborting` (boolean) and `error` (string | undefined) state via `useState`
  - Set `isAborting = true` before fetch, clear error, and reset in `finally`
  - Parse error from response body as `(body as { error?: string }).error ?? \`HTTP ${response.status}\``
  - Re-throw on error (matching terminate pattern)
  **Files**: `src/hooks/use-abort-session.ts` (new file)
  **Acceptance**: Hook compiles, exports correct types, calls correct endpoint

- [x] 2. **Add "Interrupt" button to session detail page header**
  **What**: Add an Interrupt button to the header actions `<div>` in `src/app/sessions/[id]/page.tsx`:
  - Import `useAbortSession` from `@/hooks/use-abort-session`
  - Import `OctagonX` (or `Hand`) from `lucide-react`
  - Destructure `{ abortSession, isAborting }` from `useAbortSession()`
  - Add `abortConfirm` state (boolean, default false) — mirrors `stopConfirm` pattern
  - Create `handleAbort` callback (mirrors `handleStop`):
    - First click: set `abortConfirm = true`
    - Second click: call `abortSession(sessionId, instanceId)`, reset `abortConfirm` in finally
  - Render the button in the header actions area, **before** the Stop button, only when `!isStopped && sessionStatus === "busy"`:
    ```tsx
    {!isStopped && sessionStatus === "busy" && (
      <Button
        variant={abortConfirm ? "destructive" : "outline"}
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        onClick={handleAbort}
        disabled={isAborting}
      >
        <OctagonX className="h-3 w-3" />
        {abortConfirm ? "Confirm interrupt?" : "Interrupt"}
      </Button>
    )}
    ```
  - Add a Cancel button next to it when `abortConfirm` is true (mirrors stop cancel pattern)
  - Reset `abortConfirm` to false when `sessionStatus` changes away from `"busy"` (useEffect cleanup) to prevent stale confirm state
  **Files**: `src/app/sessions/[id]/page.tsx` (modify)
  **Acceptance**: Button appears only when session is busy, two-click confirm works, abort API is called, button disables during request

- [x] 3. **Add `onAbort` prop to `LiveSessionCard` and render Interrupt button**
  **What**: Extend `LiveSessionCard` to accept an optional `onAbort` callback and render an interrupt button for active sessions:
  - Add `onAbort?: (sessionId: string, instanceId: string) => void` to the component props
  - Determine `canAbort` = session is `"active"` status (the card-level equivalent of "busy") AND `onAbort` is provided
  - Render an absolutely-positioned button (matching existing button style — `absolute top-2` positioned to the left of existing buttons):
    ```tsx
    {canAbort && (
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-[offset] h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAbort!(session.id, instanceId);
        }}
        title="Interrupt session"
      >
        <OctagonX className="h-3.5 w-3.5" />
      </Button>
    )}
    ```
  - Adjust the `right-` positioning of existing buttons (open, resume) to account for the new button. The positioning calculation follows the existing pattern where buttons shift left when more buttons are visible. The new interrupt button should sit between the open button and the terminate/delete button.
  - Import `OctagonX` from `lucide-react`
  **Files**: `src/components/fleet/live-session-card.tsx` (modify)
  **Acceptance**: Interrupt icon appears on hover for active session cards, click fires `onAbort`, does not appear for idle/stopped/completed/disconnected sessions

- [x] 4. **Wire `onAbort` through fleet page**
  **What**: Add abort handling in `src/app/page.tsx` and thread it to all `LiveSessionCard` instances:
  - Import `useAbortSession` from `@/hooks/use-abort-session`
  - Destructure `{ abortSession }` from `useAbortSession()`
  - Create `handleAbort` handler (matches `handleTerminate` pattern):
    ```tsx
    const handleAbort = async (sessionId: string, instanceId: string) => {
      try {
        await abortSession(sessionId, instanceId);
      } catch {
        // error surfaced inside useAbortSession
      }
    };
    ```
  - Pass `onAbort={handleAbort}` to every `<LiveSessionCard>` instance in the page — there are instances in:
    - `renderGroupedByStatus()` — 2 places (parent + child)
    - `renderGroupedBySource()` — 2 places (parent + child)
    - `renderContent()` for `groupBy === "none"` — 2 places (parent + child)
  **Files**: `src/app/page.tsx` (modify)
  **Acceptance**: All `LiveSessionCard` instances receive the `onAbort` prop

- [x] 5. **Wire `onAbort` through `SessionGroup`**
  **What**: Thread the `onAbort` prop through `SessionGroup` to its child `LiveSessionCard` components:
  - Add `onAbort?: (sessionId: string, instanceId: string) => void` to `SessionGroupProps` interface
  - Pass `onAbort={onAbort}` to all `<LiveSessionCard>` instances within `SessionGroup` (both parent and child cards)
  - Update the `SessionGroup` usage in `src/app/page.tsx` `renderContent()` default case (directory grouping) to pass `onAbort={handleAbort}` to `<SessionGroup>`
  **Files**: `src/components/fleet/session-group.tsx` (modify), `src/app/page.tsx` (modify — the directory grouping render path)
  **Acceptance**: Interrupt action works from session cards within workspace groups

## Verification
- [x] `npm run build` compiles with no TypeScript errors
- [x] No regressions — existing Stop, Resume, Delete actions still work
- [x] Interrupt button visible only on busy/active sessions
- [x] Interrupt button hidden on idle/stopped/completed/disconnected sessions
- [x] Two-click confirmation on session detail page prevents accidental interrupts
- [x] API call uses correct endpoint: `POST /api/sessions/{id}/abort?instanceId={id}`
- [x] Button shows loading/disabled state during abort request
