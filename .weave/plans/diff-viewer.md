# Diff Viewer — Session File Changes

## TL;DR
> **Summary**: Add a diff viewing feature to the session detail page that fetches file diffs from the OpenCode SDK (`client.session.diff()`) and renders them with a visual diff component using `react-diff-viewer-continued`.
> **Estimated Effort**: Medium

## Context
### Original Request
Add the ability to view file diffs (changes made by an agent session) in the session detail page. This requires a new API route, a React hook, a diff viewer component, and integration into the existing session page layout.

### Key Findings
1. **SDK `client.session.diff()` method** is already available. It takes `{ path: { id: sessionId }, query?: { directory?, messageID? } }` and returns `FileDiff[]` (response type `SessionDiffResponses`). The `FileDiff` type has: `file: string`, `before: string`, `after: string`, `additions: number`, `deletions: number`. Note: no `status` field in the actual SDK type — status must be inferred from `before`/`after` content (empty before = added, empty after = deleted, both present = modified).
2. **API route pattern** (see `src/app/api/sessions/[id]/route.ts`): Routes accept `instanceId` as a query parameter, use `getClientForInstance(instanceId)` to get the SDK client, and follow `NextRequest`/`NextResponse` patterns with `RouteContext { params: Promise<{ id: string }> }` for Next.js 16.
3. **Hook pattern** (see `src/hooks/use-sessions.ts`, `use-fleet-summary.ts`): Hooks use `useState`/`useEffect`/`useCallback` with `isMounted` ref for cleanup. They fetch from API routes and expose `{ data, isLoading, error }` shaped results.
4. **Session detail page** (`src/app/sessions/[id]/page.tsx`): Has a main content area (ActivityStreamV1 + PromptInput) on the left and a sidebar (session metadata, todos) on the right. The page already uses `Tabs`, `Badge`, `ScrollArea`, `Separator`, and `Collapsible` UI components from shadcn/ui.
5. **Theme**: Dark-only app. Background `#0F172A` (slate-900), card `#1E293B` (slate-800), muted foreground `#94A3B8`, border `rgba(255,255,255,0.1)`. All CSS variables defined in `src/app/globals.css`.
6. **Existing UI components**: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (radix-based), `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` (radix-based), `Badge`, `ScrollArea`, `Button` — all available for use.
7. **`react-diff-viewer-continued` v4.1.2** supports React 19 peer dependency. It's a client component and needs `"use client"` directive.
8. **Test pattern** (see `src/app/api/sessions/__tests__/route.test.ts`): Tests use vitest, mock modules via `vi.mock()`, create `NextRequest` objects directly, and test route handlers as functions. Test file names follow `__tests__/route.test.ts` convention.

## Objectives
### Core Objective
Let users view a visual diff of all file changes made during an agent session, accessible from the session detail page.

### Deliverables
- [ ] API route `GET /api/sessions/[id]/diffs` that proxies `client.session.diff()`
- [ ] `FileDiff` type re-exported from the SDK for frontend use
- [ ] `useDiffs(sessionId, instanceId)` React hook
- [ ] `DiffViewer` component that renders `FileDiff[]` with visual diff, collapsible file sections, and status badges
- [ ] Integration into session detail page as a tabbed view alongside the activity stream

### Definition of Done
- [ ] Navigating to a session detail page shows tabs: "Activity" (default) and "Changes"
- [ ] The "Changes" tab fetches and displays file diffs with additions/deletions highlighted
- [ ] Each file section is collapsible and shows file path, status badge, and +/- counts
- [ ] The diff viewer matches the dark theme
- [ ] No TypeScript errors: `npx tsc --noEmit` passes
- [ ] All tests pass: `npx vitest run`
- [ ] Dev server runs without errors: `npm run dev`

### Guardrails (Must NOT)
- Must not modify the ActivityStreamV1 component
- Must not break the existing session detail page layout or sidebar
- Must not change the SSE event pipeline or event-state.ts
- Must not modify the opencode-client.ts wrapper beyond re-exporting the `FileDiff` type

## TODOs

- [ ] 1. **Install `react-diff-viewer-continued`**
  **What**: Add the diff rendering library as a production dependency.
  **Command**: `bun add react-diff-viewer-continued`
  **Acceptance**: `package.json` lists `react-diff-viewer-continued` in dependencies. `bun install` completes without errors.

- [ ] 2. **Re-export `FileDiff` type from SDK**
  **What**: Add `FileDiff` to the re-exported types in `src/lib/server/opencode-client.ts` and add a matching type in `src/lib/api-types.ts` for frontend use.
  **Files**:
    - `src/lib/server/opencode-client.ts` — add `FileDiff` to the `export type { ... } from "@opencode-ai/sdk"` block
    - `src/lib/api-types.ts` — add a `FileDiffItem` interface that mirrors the SDK's `FileDiff` shape for frontend consumption (decouples frontend from SDK types):
      ```typescript
      export interface FileDiffItem {
        file: string;
        before: string;
        after: string;
        additions: number;
        deletions: number;
        status: "added" | "deleted" | "modified";
      }
      ```
  **Acceptance**: Types importable from both locations. No TS errors.

- [ ] 3. **Create API route `GET /api/sessions/[id]/diffs`**
  **What**: A Next.js route handler that calls `client.session.diff()` and returns `FileDiffItem[]`. Infers the `status` field from `before`/`after` content.
  **Files**: `src/app/api/sessions/[id]/diffs/route.ts` (new)
  **Details**:
    - Follow the exact pattern from `src/app/api/sessions/[id]/route.ts`:
      - `interface RouteContext { params: Promise<{ id: string }> }`
      - Extract `instanceId` from `request.nextUrl.searchParams`
      - Return 400 if `instanceId` missing
      - Get client via `getClientForInstance(instanceId)`
      - Return 404 if client not found
    - Call `client.session.diff({ path: { id: sessionId } })`
    - Map each `FileDiff` to `FileDiffItem` by computing `status`:
      - `before === "" || before == null` → `"added"`
      - `after === "" || after == null` → `"deleted"`
      - otherwise → `"modified"`
    - Return `NextResponse.json(fileDiffItems, { status: 200 })`
    - On SDK error, return `NextResponse.json({ error: "Failed to retrieve diffs" }, { status: 500 })`
  **Acceptance**: `GET /api/sessions/abc/diffs?instanceId=xyz` returns JSON array of `FileDiffItem`. Returns 400 without instanceId. Returns 404 for bad instance. Returns 500 on SDK error.

- [ ] 4. **Write tests for the diffs API route**
  **What**: Unit tests following the pattern in `src/app/api/sessions/__tests__/route.test.ts`.
  **Files**: `src/app/api/sessions/[id]/diffs/__tests__/route.test.ts` (new)
  **Details**:
    - Mock `@/lib/server/opencode-client` with `getClientForInstance: vi.fn()`
    - Test cases:
      - Returns 400 when `instanceId` query param is missing
      - Returns 404 when `getClientForInstance` throws
      - Returns 200 with mapped `FileDiffItem[]` on success
      - Correctly infers `status: "added"` when `before` is empty
      - Correctly infers `status: "deleted"` when `after` is empty
      - Correctly infers `status: "modified"` when both present
      - Returns 500 when `client.session.diff()` throws
      - Returns empty array `[]` when SDK returns no diffs (empty array or null data)
  **Acceptance**: All tests pass with `npx vitest run src/app/api/sessions/\\[id\\]/diffs`.

- [ ] 5. **Create `useDiffs` hook**
  **What**: A React hook that fetches diffs from the API route. Does NOT auto-poll (diffs are a point-in-time snapshot, fetched on demand).
  **Files**: `src/hooks/use-diffs.ts` (new)
  **Details**:
    ```typescript
    "use client";

    import { useState, useCallback, useRef } from "react";
    import type { FileDiffItem } from "@/lib/api-types";

    export interface UseDiffsResult {
      diffs: FileDiffItem[];
      isLoading: boolean;
      error?: string;
      fetchDiffs: () => void;
    }

    export function useDiffs(sessionId: string, instanceId: string): UseDiffsResult
    ```
    - Uses `useState` for `diffs`, `isLoading`, `error`
    - `fetchDiffs` is a `useCallback` that calls `GET /api/sessions/${sessionId}/diffs?instanceId=${instanceId}`
    - Uses `isMounted` ref pattern from existing hooks
    - Does NOT auto-fetch on mount — caller invokes `fetchDiffs` when the tab activates (lazy loading)
  **Acceptance**: Hook exports the correct interface. Can be imported and called from a client component.

- [ ] 6. **Create `DiffViewer` component**
  **What**: A React component that renders a list of `FileDiffItem` objects as a visual diff. Uses `react-diff-viewer-continued` for the actual diff rendering.
  **Files**: `src/components/session/diff-viewer.tsx` (new)
  **Details**:
    - Props interface:
      ```typescript
      interface DiffViewerProps {
        diffs: FileDiffItem[];
        isLoading: boolean;
        error?: string;
      }
      ```
    - **Overall structure**: A vertical list of collapsible file sections inside a `ScrollArea`
    - **Each file section** uses `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent`:
      - **Trigger row** (always visible): File path (mono font, truncated), status `Badge` (green "Added" / amber "Modified" / red "Deleted"), and `+N / -N` counts in green/red text. A chevron icon indicating open/close state.
      - **Content** (collapsible): The `ReactDiffViewer` component from `react-diff-viewer-continued` in unified mode, rendering `before` vs `after`
    - **`react-diff-viewer-continued` configuration**:
      - `splitView={false}` — unified diff view
      - `useDarkTheme={true}` — always dark
      - `styles` — custom style overrides to match the Weave theme:
        - Background colors: use `var(--card)` / `#1E293B` for the diff container
        - Added line background: `rgba(34, 197, 94, 0.1)` (green-500/10)
        - Removed line background: `rgba(239, 68, 68, 0.1)` (red-500/10)
        - Added gutter: `rgba(34, 197, 94, 0.2)`
        - Removed gutter: `rgba(239, 68, 68, 0.2)`
        - Line number color: `var(--muted-foreground)` / `#94A3B8`
        - Content text: `var(--foreground)` / `#F8FAFC`
        - Font: `var(--font-mono)` / JetBrains Mono
      - `hideLineNumbers={false}`
    - **Empty state**: When `diffs` is empty and not loading, show "No changes detected" message
    - **Loading state**: Show a `Loader2` spinner with "Loading diffs…" text
    - **Error state**: Show error message in red
    - **Summary header**: Show total files changed, total additions, total deletions at the top
    - All file sections default to collapsed when there are >3 files, expanded when ≤3
    - Must have `"use client"` directive (uses state for collapsible and the diff library is client-only)
  **Acceptance**: Component renders correctly with mock data. Collapsible sections work. Matches dark theme. No TypeScript errors.

- [ ] 7. **Integrate into session detail page**
  **What**: Add a tabbed view to the session detail page so users can switch between "Activity" and "Changes".
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
    - Import `useDiffs` hook and `DiffViewer` component
    - Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
    - Import `GitCompare` icon from `lucide-react` (for the Changes tab icon)
    - Wrap the main content area (currently `<div className="flex flex-1 flex-col overflow-hidden">`) with `Tabs` component:
      ```tsx
      <Tabs defaultValue="activity" onValueChange={(value) => {
        if (value === "changes") fetchDiffs();
      }}>
        <TabsList variant="line" className="px-4 border-b">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="changes">
            <GitCompare className="h-3.5 w-3.5" />
            Changes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="flex-1 overflow-hidden flex flex-col">
          {/* existing activity stream + prompt input */}
        </TabsContent>
        <TabsContent value="changes" className="flex-1 overflow-hidden">
          <DiffViewer diffs={diffs} isLoading={diffsLoading} error={diffsError} />
        </TabsContent>
      </Tabs>
      ```
    - Call `useDiffs(sessionId, instanceId)` at the top of the component alongside other hooks
    - The `fetchDiffs` call is triggered when the "Changes" tab is selected (lazy load)
    - The "stopped" banner should appear above the tabs (it currently appears above the activity stream)
    - The `PromptInput` should only be visible when the "Activity" tab is selected (move it inside the activity `TabsContent`)
    - The sidebar remains unchanged and visible regardless of active tab
  **Acceptance**:
    - Session detail page shows "Activity" and "Changes" tabs
    - Clicking "Changes" fetches diffs and renders the DiffViewer
    - "Activity" tab shows the existing activity stream + prompt input (no visual regression)
    - Sidebar remains visible in both tabs
    - Tab state does not interfere with SSE connection or message streaming

- [ ] 8. **Add diff stats to sidebar**
  **What**: Show a summary of file changes in the session sidebar when diffs have been loaded.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
    - After the "Cost" section and before the "Connection" section in the sidebar, add a new "Changes" section (conditionally rendered when `diffs.length > 0`):
      ```tsx
      {diffs.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <GitCompare className="h-3 w-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Changes</p>
            </div>
            <p className="text-xs font-mono">
              {diffs.length} file{diffs.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs font-mono">
              <span className="text-green-500">+{totalAdditions}</span>{" "}
              <span className="text-red-500">-{totalDeletions}</span>
            </p>
          </div>
        </>
      )}
      ```
    - Compute `totalAdditions` and `totalDeletions` by reducing over `diffs` array
  **Acceptance**: Sidebar shows change summary when diffs are loaded. Hidden when no diffs. Matches existing sidebar styling.

## Verification
- [ ] `bun run typecheck` (or `npx tsc --noEmit`) — no TypeScript errors
- [ ] `bun run test` (or `npx vitest run`) — all tests pass including new diffs route tests
- [ ] `bun run build` — production build succeeds
- [ ] `bun run dev` — dev server starts, navigate to session detail, verify:
  - Activity tab works as before (no regression)
  - Changes tab loads diffs on click
  - Diff viewer displays with correct dark theme
  - Collapsible file sections work
  - Status badges show correct colors
  - Sidebar shows change summary
- [ ] No console errors or warnings related to new components
