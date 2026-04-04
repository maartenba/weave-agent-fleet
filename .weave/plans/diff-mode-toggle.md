# Diff Mode Toggle — Session Changes vs Uncommitted

## TL;DR
> **Summary**: Add a toggle to the session page's Changes/Files tabs switching between "Session changes" (cumulative diff from session start) and "Uncommitted" (current HEAD diff), defaulting to "Session changes" so users always see what happened — even after the agent commits.
> **Estimated Effort**: Medium

## Context

### Original Request
After an agent commits changes during a session, the Changes tab and Files tab show nothing because `session.diff()` returns uncommitted changes against HEAD (which are empty post-commit). The user wants a toggle between cumulative session changes and uncommitted changes, defaulting to the former.

### Key Findings

1. **SDK supports `messageID` query param on `GET /session/{sessionID}/diff`**
   - Confirmed in `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts` (line 573-578):
     ```
     diff(parameters: { sessionID: string; messageID?: string; ... })
     ```
   - The SDK JSDoc says: "Get the file changes (diff) that resulted from a specific user message in the session."
   - When `messageID` is omitted → returns uncommitted changes (current behavior)
   - When `messageID` is provided → returns changes from that specific message

2. **Strategy for "all session changes"**: Pass the **first user message ID** as `messageID`. The SDK returns changes "that resulted from a specific user message" — passing the first user message should yield the cumulative diff from session start to current state (since all subsequent changes are layered on top of the first message's context).

3. **How to get the first user message ID**: The `messages` array in `page.tsx` (from `useSessionEvents`) contains `AccumulatedMessage` objects with `messageId` (string) and `role` (user/assistant). The first message with `role === "user"` gives us the first user message ID. **Important**: with pagination, the oldest messages may not be loaded yet — we'll need a fallback.

4. **Current data flow** (all changes happen along this path):
   - `page.tsx` → `useDiffs(sessionId, instanceId)` → `GET /api/sessions/[id]/diffs?instanceId=xxx` → `client.session.diff({ sessionID })`
   - Both `<DiffViewer>` (Changes tab) and `<FilesTabContent>` (Files tab) receive the same `diffs` prop
   - `fetchDiffs()` is called: on instanceId change, on "changes" tab activation, and from SSE handlers in `FilesTabContent`

5. **Existing toggle pattern in DiffViewer**: The split/unified toggle (line 246-258 of `diff-viewer.tsx`) is a `<Button variant="ghost" size="sm">` placed in the summary header bar — good pattern to follow for the diff mode toggle.

6. **No existing toggle-group or segmented-control component** in `src/components/ui/`. We'll use two adjacent `<Button>` elements with active/inactive styling (matching the existing split/unified toggle pattern) or a simple custom segmented control.

7. **`EventSessionDiff` SSE event exists** (type `"session.diff"`) but is not currently handled in the frontend SSE stream. This could be used in future for auto-refresh but is out of scope for this plan.

8. **API route** (`src/app/api/sessions/[id]/diffs/route.ts`) currently hard-codes `client.session.diff({ sessionID: sessionId })` with no `messageID` forwarding. Must be extended.

## Objectives

### Core Objective
Allow users to toggle between viewing all cumulative session changes and only uncommitted changes, with "Session changes" as the default.

### Deliverables
- [x] API route accepts and forwards `messageID` query parameter to SDK
- [x] `useDiffs` hook accepts a `mode` parameter and derives the correct API call
- [x] Session page provides first user message ID to the hook
- [x] Toggle UI appears in both Changes and Files tabs (shared state)
- [x] Default is "Session changes"; graceful fallback when no messages exist yet

### Definition of Done
- [ ] After agent commits, Changes tab still shows all session changes (not empty)
- [ ] User can switch to "Uncommitted" mode to see only uncommitted changes
- [ ] Toggle state is shared between Changes and Files tabs
- [ ] Existing tests pass: `npx vitest run src/app/api/sessions/[id]/diffs/__tests__/route.test.ts`
- [ ] New tests cover the `messageID` forwarding path

### Guardrails (Must NOT)
- Do NOT add polling or auto-refresh — keep the existing on-demand fetch pattern
- Do NOT change the `FileDiffItem` type or response shape — only the query mechanism changes
- Do NOT introduce a new UI component library dependency — use existing Button/Badge patterns
- Do NOT modify the OpenCode SDK — work within its existing `messageID` parameter

## TODOs

- [x] 1. **Extend the API route to forward `messageID`**
  **What**: Modify the `GET` handler to read an optional `messageID` query param from the request URL and pass it through to `client.session.diff()`. When `messageID` is present, include it in the SDK call as `{ sessionID, messageID }`. When absent, keep current behavior (no `messageID`).
  **Files**: `src/app/api/sessions/[id]/diffs/route.ts`
  **Details**:
  - Read `messageID` from `request.nextUrl.searchParams.get("messageID")`
  - Conditionally include it: `client.session.diff({ sessionID: sessionId, ...(messageID ? { messageID } : {}) })`
  - No validation needed — the SDK handles invalid messageIDs gracefully (returns empty or errors which we already catch)
  **Acceptance**: Hitting `GET /api/sessions/xxx/diffs?instanceId=yyy&messageID=zzz` forwards the messageID to the SDK

- [x] 2. **Add `messageID` forwarding tests**
  **What**: Add test cases to the existing test file verifying that `messageID` is forwarded when present and omitted when absent.
  **Files**: `src/app/api/sessions/[id]/diffs/__tests__/route.test.ts`
  **Details**:
  - Test: when `messageID` query param is provided, `client.session.diff` is called with `{ sessionID, messageID }`
  - Test: when `messageID` query param is absent, `client.session.diff` is called with just `{ sessionID }` (existing behavior)
  **Acceptance**: `npx vitest run src/app/api/sessions/[id]/diffs/__tests__/route.test.ts` passes

- [x] 3. **Extend `useDiffs` hook with diff mode support**
  **What**: Add a `messageID` parameter to `useDiffs`. When provided, append `&messageID=xxx` to the fetch URL. Update the `fetchDiffs` callback to be stable across mode changes (include `messageID` in the dependency array or accept it as a parameter).
  **Files**: `src/hooks/use-diffs.ts`
  **Details**:
  - Change signature: `useDiffs(sessionId: string, instanceId: string, messageID?: string)`
  - Update the fetch URL: `...diffs?instanceId=${instanceId}${messageID ? `&messageID=${encodeURIComponent(messageID)}` : ""}`
  - `fetchDiffs` should use the current `messageID` from the hook's closure (it's already a `useCallback` depending on `sessionId` and `instanceId` — add `messageID`)
  - Export the type: add `messageID` to `UseDiffsResult` is not needed since the caller controls the mode
  **Acceptance**: Calling `useDiffs(sid, iid, "msg-123")` produces a fetch to `/api/sessions/sid/diffs?instanceId=iid&messageID=msg-123`

- [x] 4. **Add diff mode state and first-message-ID derivation to session page**
  **What**: Add state for the diff mode toggle (`"session" | "uncommitted"`) in the session page, defaulted to `"session"`. Derive the first user message ID from the `messages` array. Pass the appropriate `messageID` (or undefined) to `useDiffs`.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - Add state: `const [diffMode, setDiffMode] = useState<"session" | "uncommitted">("session")`
  - Derive first user message ID:
    ```
    const firstUserMessageId = useMemo(
      () => messages.find((m) => m.role === "user")?.messageId ?? null,
      [messages]
    );
    ```
  - Pass to `useDiffs`:
    ```
    const effectiveMessageID = diffMode === "session" ? (firstUserMessageId ?? undefined) : undefined;
    const { diffs, ... } = useDiffs(sessionId, instanceId, effectiveMessageID);
    ```
  - **Edge case**: When `diffMode === "session"` but `firstUserMessageId` is null (no messages yet), `effectiveMessageID` will be undefined — falling back to uncommitted diff behavior. This is correct because if there are no messages, there are no session changes either.
  - **Edge case with pagination**: If older messages haven't been loaded and messages[0] is not actually the first message, the toggle may show partial session changes. This is acceptable — the messages array is populated oldest-first from the SSE stream, and the first message visible is typically the actual first message unless the user has scrolled to load only recent messages. If pagination has trimmed older messages, the first visible user message is a reasonable approximation.
  - Re-fetch when `diffMode` changes: Add `diffMode` and `firstUserMessageId` as triggers for re-fetching. The `useEffect` on line 106-110 already calls `fetchDiffs()` on `instanceId` change. Since `useDiffs`'s `fetchDiffs` callback will change when `messageID` changes (due to the dependency array), calling `fetchDiffs()` after mode change will use the new URL. Add a `useEffect` that calls `fetchDiffs` when `effectiveMessageID` changes.
  **Acceptance**: Toggle state exists, first message ID is derived, and `useDiffs` receives the correct messageID

- [x] 5. **Add the toggle UI component**
  **What**: Create a small `DiffModeToggle` component that renders the two-option toggle. Place it in the session page so it's visible when either the Changes or Files tab is active.
  **Files**: `src/components/session/diff-mode-toggle.tsx` (new file), `src/app/sessions/[id]/page.tsx`
  **Details**:
  - **Component design**: Two small adjacent buttons ("Session changes" / "Uncommitted") with active/inactive styling. Follow the split/unified toggle pattern in `diff-viewer.tsx` (line 246-258):
    ```
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ...">
    ```
  - Active state: `bg-accent text-foreground` or similar subtle highlight
  - Inactive state: `text-muted-foreground hover:text-foreground`
  - Props: `mode: "session" | "uncommitted"`, `onModeChange: (mode) => void`, `disabled?: boolean`
  - Optional: show a subtle label/tooltip explaining the modes
  - **Size**: Keep it compact — the two labels together should be ~200px max
  **Acceptance**: The component renders correctly with both states

- [x] 6. **Wire the toggle into the session page tabs**
  **What**: Place the `DiffModeToggle` in the session page so it's visible for both Changes and Files tabs but NOT the Activity tab. The ideal location is in the `TabsList` area or just below it.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - **Option A (Recommended)**: Place the toggle inside the `<TabsList>` at line 786, after the tab triggers but within the `TabsList` container, using `ml-auto` to push it to the right. This way it appears inline with the tab triggers. However, it should only be visible when "changes" or "files" tab is active.
  - **Option B**: Place it at the top of both `<TabsContent value="changes">` and `<TabsContent value="files">`. This duplicates the element but avoids complexity. Since the state is shared (lives in the parent), both instances reflect the same mode.
  - **Recommended approach**: Option A with conditional visibility. Track the active tab value with state:
    ```
    const [activeTab, setActiveTab] = useState("activity");
    ```
    Wire it to `<Tabs onValueChange>` (which already exists at line 782). Then conditionally render the toggle in the TabsList when `activeTab !== "activity"`.
  - Pass `diffMode` and `setDiffMode` as props
  - When toggle changes, the `useEffect` from TODO 4 will trigger a re-fetch
  **Acceptance**: Toggle appears when Changes or Files tab is active, disappears on Activity tab

- [x] 7. **Re-fetch diffs when mode changes**
  **What**: Ensure that switching the toggle triggers a fresh diff fetch with the correct `messageID`.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - The `useDiffs` hook's `fetchDiffs` is a `useCallback` that depends on `messageID`. When `diffMode` changes → `effectiveMessageID` changes → `fetchDiffs` reference changes → existing `useEffect` should re-fetch.
  - However, the current `useEffect` (line 106-110) only depends on `[instanceId, fetchDiffs]`. Since `fetchDiffs` will change when `messageID` changes, this should auto-trigger a re-fetch. Verify this behavior.
  - If not sufficient, add an explicit `useEffect`:
    ```
    useEffect(() => {
      if (instanceId) fetchDiffs();
    }, [diffMode, fetchDiffs, instanceId]);
    ```
  - Also ensure the `onValueChange` handler for tabs (line 782-784) still calls `fetchDiffs()` when switching to the "changes" tab — this already works since `fetchDiffs` will have the correct `messageID` baked in.
  - Ensure `FilesTabContent`'s SSE-driven `fetchDiffs()` calls (line 196) also work correctly — since `fetchDiffs` from the hook closure always uses the current mode, this should work automatically.
  **Acceptance**: Switching the toggle immediately shows the correct diff data for the selected mode

- [x] 8. **Handle edge cases**
  **What**: Ensure graceful behavior in edge cases.
  **Files**: `src/app/sessions/[id]/page.tsx`, `src/components/session/diff-mode-toggle.tsx`
  **Details**:
  - **No messages yet (fresh session)**: `firstUserMessageId` is null → `effectiveMessageID` is undefined → falls back to uncommitted diff (same as current behavior). The toggle should still appear but "Session changes" effectively shows the same as "Uncommitted". Could optionally disable "Session changes" button when `firstUserMessageId` is null, but this adds complexity with little benefit — both modes show the same thing when there's nothing committed yet.
  - **Messages loaded via pagination don't include the first message**: The first message in the `messages` array may not be the actual first session message if pagination has trimmed it. In practice, `useSessionEvents` loads messages newest-first and the oldest visible message approximates the first. If this becomes a problem, a future enhancement could fetch the first message ID separately via the messages API with `limit=1`. For now, use `messages.find(m => m.role === "user")` which looks at the oldest loaded messages (messages are ordered oldest→newest in the array).
  - **SDK returns error for invalid messageID**: Already caught by the existing `try/catch` in the API route (returns 500). The hook sets `error` state which `DiffViewer` displays.
  - **Session with only assistant messages (no user messages)**: Unlikely in normal operation. `firstUserMessageId` will be null, falling back to uncommitted mode.
  **Acceptance**: No crashes or confusing UI in any edge case

- [x] 9. **Update sidebar changes summary to reflect active mode**
  **What**: The sidebar (line 912-930 in `page.tsx`) shows a "Changes" section with file count and additions/deletions from `diffs`. Since `diffs` now depends on the active mode, the sidebar will automatically reflect whichever mode is active — no changes needed. However, consider adding a subtle label like "(session)" or "(uncommitted)" next to the Changes heading to clarify which mode is shown.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - In the sidebar `Changes` section (both desktop aside and mobile Sheet), optionally append the mode indicator:
    ```
    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
      Changes {diffMode === "session" ? "(session)" : "(uncommitted)"}
    </p>
    ```
  - This is low priority — skip if it clutters the sidebar
  **Acceptance**: Sidebar accurately reflects the active diff mode's data

## Verification
- [ ] All existing tests pass: `npx vitest run`
- [ ] New API route tests pass for `messageID` forwarding
- [ ] Manual test: start a session, make changes, commit them → "Session changes" mode shows the cumulative diff, "Uncommitted" mode shows empty
- [ ] Manual test: make changes without committing → both modes show the same diff
- [ ] Manual test: toggle persists correctly when switching between Changes and Files tabs
- [ ] Manual test: toggle disappears when on Activity tab
- [ ] Manual test: fresh session with no messages → toggle visible, both modes work without error
- [ ] No regressions in Files tab (file tree coloring, inline diff, git status indicators)
