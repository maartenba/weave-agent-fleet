# V2 Integration Test Checklist

Manual testing guide for **V2: Multi-Session & Workspace Isolation**.

Run these scenarios against a locally running `npm run dev` instance. Each scenario should be tested in order; earlier scenarios build state that later ones rely on.

## Prerequisites

```bash
# Start the dev server
npm run dev

# Open the fleet page
open http://localhost:3000
```

Ensure `opencode` is installed and in your PATH. Have at least two local git repositories ready (referred to as `<repo-a>` and `<repo-b>` below).

---

## Scenario 1: Create session with "existing" strategy

**Steps:**
1. Click **New Session** button on the fleet page.
2. Set Isolation Strategy → **Existing Directory**.
3. Enter a valid project directory (e.g. `<repo-a>`).
4. Enter an optional title (e.g. "Test session A").
5. Click **Create Session**.

**Expected:**
- Browser navigates to `/sessions/<id>?instanceId=<iid>`.
- Session detail page shows activity stream with connection indicator.
- Fleet page (navigate back) shows the card with green dot and "running" badge.
- Sidebar shows the workspace directory, "existing" isolation badge, and session timestamps.
- SQLite DB (`~/.weave/fleet.db`) has rows in `workspaces`, `instances`, and `sessions` tables.

---

## Scenario 2: Create session with "worktree" strategy

**Steps:**
1. Click **New Session**.
2. Set Isolation Strategy → **Git Worktree**.
3. Enter `<repo-a>` as the Source Repository.
4. Optionally set a branch name (e.g. `weave/test-worktree`).
5. Click **Create Session**.

**Expected:**
- A new git worktree directory is created under `~/.weave/workspaces/<workspace-id>/`.
- `git worktree list` inside `<repo-a>` shows the new worktree.
- Sidebar shows `worktree` badge and the worktree directory path.
- Fleet card shows purple "worktree" badge.

---

## Scenario 3: Create 3 concurrent sessions against different directories

**Steps:**
1. Create a session pointing at `<repo-a>` (existing).
2. Create a session pointing at `<repo-b>` (existing).
3. Create a session pointing at `<repo-a>` with worktree strategy (different branch).

**Expected:**
- Fleet page shows 3 cards, each with green dot.
- Each card has its own session ID and directory.
- The "Active" count in the summary bar reflects all 3 sessions.

---

## Scenario 4: Verify independent streaming

**Steps:**
1. With 3 sessions running, open session A's detail page.
2. Send a prompt to session A (e.g. "List files in the current directory").
3. Observe the activity stream — only session A responds.
4. Navigate to session B's detail page — it should be idle, no new messages.

**Expected:**
- Session A's activity stream shows the response.
- Session B and C are unaffected.
- Sessions A and B on different directories use different OpenCode instances (ports).
- Sessions on the same directory (if any) share one instance but have independent session IDs.

---

## Scenario 5: Terminate a session from the fleet page

**Steps:**
1. On the fleet page, hover over a running session card.
2. Click the trash icon (terminate button) that appears in the top-right corner.
3. Confirm the termination if prompted.

**Expected:**
- Session card transitions to "stopped" status (gray dot, opacity reduced).
- The terminated session's OpenCode process is no longer running (`lsof -i :<port>` shows nothing).
- The summary bar's Active count decreases by 1; Completed increases by 1.
- DB `sessions` table shows `status = 'stopped'` for the terminated session.

---

## Scenario 6: Terminate a session from the session detail page

**Steps:**
1. Navigate to an active session's detail page.
2. Click the **Stop** button in the header.
3. Click **Confirm stop?** to confirm.

**Expected:**
- Stopped banner appears above the activity stream.
- Prompt input is disabled.
- Status badge changes to "Stopped".
- Fleet page shows the session as "stopped".

---

## Scenario 7: Server restart — sessions show as "disconnected"

**Steps:**
1. With at least 2 active sessions, stop the Next.js dev server (`Ctrl+C`).
2. Restart: `npm run dev`.
3. Navigate to the fleet page.

**Expected:**
- Previously active sessions appear with amber dot and "disconnected" badge.
- Sessions are visible (not lost) — DB persistence working.
- Instance status in DB is updated to reflect disconnection (port no longer reachable).

---

## Scenario 8: Orphan recovery — sessions reconnect after server restart

**Steps:**
1. With active sessions, restart the Next.js dev server without killing the OpenCode processes.
   (Hot-reload in dev mode often leaves OpenCode processes running.)
2. Navigate to the fleet page within a few seconds.

**Expected:**
- Sessions previously active may show as "recovered" in process manager logs.
- Fleet page shows them as active (green dot) if the port is still reachable.
- Console logs show `[process-manager] Recovery: instance <id> recovered on port <port>`.

---

## Scenario 9: Cleanup worktree workspace

**Steps:**
1. Terminate a session created with "worktree" strategy using the fleet page trash button.
2. Optionally pass `cleanupWorkspace=true` via the API: `DELETE /api/sessions/<id>?instanceId=<iid>&cleanupWorkspace=true`.
3. Check the worktree directory.

**Expected:**
- When `cleanupWorkspace=true`: worktree directory under `~/.weave/workspaces/` is removed.
- `git worktree list` in the source repo no longer shows the worktree.
- When terminated without `cleanupWorkspace`: directory is preserved.

---

## Scenario 10: Fleet summary bar shows real data

**Steps:**
1. Create 2 active sessions and terminate 1.
2. Observe the summary bar.

**Expected:**
- "Active" = 1 (live session count from `GET /api/fleet/summary`).
- "Completed" = 1 (stopped sessions).
- "Pipelines" and "Queued" = 0 (not implemented in V2).

---

## Scenario 11: Other pages still work with mock data

**Steps:**
1. Navigate to Pipelines (`/pipelines`), Queue (`/queue`), Templates (`/templates`), Alerts (`/alerts`), History (`/history`).

**Expected:**
- All pages render without errors.
- Mock data is still displayed (V2 did not remove mock data from these pages).

---

## Post-Test Cleanup

```bash
# Remove all V2 test workspaces
rm -rf ~/.weave/workspaces/

# Remove the SQLite DB (reset state)
rm -f ~/.weave/fleet.db
```
