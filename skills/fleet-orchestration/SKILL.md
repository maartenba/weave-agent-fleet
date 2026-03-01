---
name: fleet-orchestration
description: Orchestrates multi-session workflows via Fleet API. Use when spawning child sessions for parallel or delegated work.
---

# Fleet Orchestration

This skill teaches you how to orchestrate multi-session workflows using the Weave Agent Fleet API. Use it when the user asks you to work on multiple independent issues, repositories, or modules in parallel.

## When to Orchestrate

**DO orchestrate when:**
- The user asks you to work on 2 or more independent issues or repositories
- Tasks are clearly separable with no shared state (e.g., fix issue #1, #4, and #5)
- The user explicitly asks for parallel work

**DO NOT orchestrate when:**
- The task touches a single file or module
- Tasks have sequential dependencies (A must finish before B starts)
- The total work is small enough for one session to handle efficiently

---

## Step 0: Analyze Parallelizability

Before spawning any children, determine whether tasks can safely run in parallel. This step is **mandatory** — skipping it risks merge conflicts, lost work, or wasted compute.

### Decision Framework

For each pair of tasks, assess **file overlap**:

| Overlap | Strategy | Example |
|---|---|---|
| **No overlap** — tasks touch completely different files/modules | Parallel with `worktree` | "Add auth tests" + "Fix dashboard CSS" |
| **Possible overlap** — tasks might touch shared files (configs, shared utils, types) | Sequential, or parallel with careful scoping | "Refactor auth module" + "Add auth rate limiting" |
| **Definite overlap** — tasks target the same files | Sequential only | "Fix login bug in auth.ts" + "Add MFA to auth.ts" |

### How to Assess Overlap

1. **Identify affected files** — For each task, list the files/directories it will likely touch. Consider:
   - Direct targets (the file mentioned in the task)
   - Shared dependencies (types, utils, configs, package.json, lock files)
   - Test files (if both tasks add tests to the same test file)
   - Build/config files (tsconfig, next.config, etc.)

2. **Check for shared boundaries** — Even if tasks target different features, they may conflict on:
   - Barrel exports (`index.ts`)
   - Route registrations
   - Database migrations (two tasks adding migrations simultaneously)
   - Package dependencies (both running `npm install`)

3. **When in doubt, serialize** — A sequential run that succeeds is better than parallel runs that produce merge conflicts.

### Communicate Your Decision

Always tell the user what you decided and why:

> *"I've analyzed the 3 tasks. Tasks 1 and 2 touch separate modules (auth vs. dashboard) — I'll run them in parallel using worktrees. Task 3 modifies shared types that Task 1 also touches, so I'll queue it after Task 1 completes."*

### Handling Mixed Parallel/Sequential

When some tasks can parallelize and others must be sequential:

1. **Group** independent tasks into a parallel batch
2. **Queue** dependent tasks to run after their dependencies complete
3. **Use callbacks** — when a parallel batch completes, spawn the next sequential task

Example flow:
```
Batch 1 (parallel): Task A + Task B (no overlap)
    ↓ both complete via callbacks
Batch 2 (sequential): Task C (depends on A's output)
    ↓ completes via callback
Done — report results to user
```

---

## Step 1: Discover Your Own Identity

Before spawning children, find your own session ID and instance ID. These will be used in the `onComplete` callback so children can notify you when they finish.

```bash
curl -s http://localhost:${FLEET_PORT:-3000}/api/sessions
```

The response is an array. Find your own entry by matching `workspaceDirectory` or `session.title` to your current context. Extract:
- `instanceId` → your instance ID
- `session.id` → your OpenCode session ID

> **Important**: Use these exact values from the API response — do NOT guess or invent them.

---

## Step 2: Spawn a Child Session

For each parallel task, create a child session with an `onComplete` callback pointing back to you:

```bash
curl -s -X POST http://localhost:${FLEET_PORT:-3000}/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "directory": "/path/to/project",
    "title": "Fix Issue #1 — Auth bug",
    "isolationStrategy": "worktree",
    "onComplete": {
      "notifySessionId": "YOUR_OPENCODE_SESSION_ID",
      "notifyInstanceId": "YOUR_INSTANCE_ID"
    }
  }'
```

**Field mapping for `onComplete`** — use values from your own session list entry:

| Value you need | Where to get it |
|---|---|
| `notifySessionId` | `session.id` from your entry in `GET /api/sessions` |
| `notifyInstanceId` | `instanceId` from your entry in `GET /api/sessions` |

The response contains the child's `instanceId` and `session.id` — save these to send it a prompt.

**Isolation strategies:**

| Strategy | Use When | Parallel-Safe |
|---|---|---|
| `"worktree"` | Parallel work on the same repo | Yes — each child gets its own git worktree and branch |
| `"clone"` | Completely isolated environments | Yes — each child gets a separate shallow clone |
| `"existing"` | Single session, or separate repos | **No** — multiple sessions share the same directory and will conflict |

> **Rule**: Never use `"existing"` when spawning multiple children on the same directory. Always use `"worktree"` or `"clone"`.

---

## Step 3: Send a Prompt to the Child

Once the child session is created, give it its task:

```bash
curl -s -X POST http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_SESSION_ID}/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "CHILD_INSTANCE_ID",
    "text": "Fix GitHub issue #1: the JWT token is not being refreshed correctly. The bug is in src/auth/token.service.ts. Write tests and ensure the build passes."
  }'
```

Use `session.id` (OpenCode session ID) from the `POST /api/sessions` response as `CHILD_SESSION_ID`.

**Write clear, scoped instructions** — the child has no context other than what you give it. Include:
- What to do
- Where to look
- What done looks like (tests pass, build succeeds, etc.)
- **File boundaries** — if parallelizing, tell the child which files/directories it owns to prevent accidental overlap

---

## Step 4: Wait for Callbacks

After spawning and prompting all children, **wait** — do NOT poll. When a child finishes, the Fleet automatically sends you a callback prompt in this format:

```
[Fleet Callback] Child session completed.
Session ID: <fleet-db-session-id>
Title: Fix Issue #1 — Auth bug
Files changed: 3
  added: src/auth/token.service.spec.ts
  modified: src/auth/token.service.ts
  modified: src/app.module.ts
Status: idle (completed successfully)
```

For errors:

```
[Fleet Callback] Child session encountered an error.
Session ID: <fleet-db-session-id>
Title: Fix Issue #1 — Auth bug
Status: error
```

Tell the user you are waiting: *"I've spawned 3 child sessions. Waiting for them to complete..."*

---

## Step 5: Inspect Child Results

After receiving a callback, inspect what the child did:

**Get diffs:**
```bash
curl -s "http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_SESSION_ID}/diffs?instanceId=${CHILD_INSTANCE_ID}"
```

**Get messages/conversation:**
```bash
curl -s "http://localhost:${FLEET_PORT:-3000}/api/sessions/${CHILD_SESSION_ID}?instanceId=${CHILD_INSTANCE_ID}"
```

### Post-Completion Conflict Check

After all parallel children complete, **verify there are no conflicts** before reporting success:

1. **Review the diff summaries** from all callbacks — look for files modified by more than one child
2. **If overlap detected** — inspect the diffs in detail and determine if changes are compatible
3. **If conflicts exist** — tell the user which children produced conflicting changes and recommend a resolution strategy (manual merge, re-run one task sequentially, etc.)

---

## Step 6: Handle Error Callbacks

When a child encounters an error:
1. **Inspect** — check the child's messages to understand what went wrong
2. **Decide** — retry with clarified instructions, or escalate to the user
3. **Retry** (optional): send a follow-up prompt to the same child session with corrected instructions
4. **Escalate**: tell the user what failed and ask for guidance

---

## Best Practices

- **Always analyze parallelizability first** — Step 0 is not optional
- **Always tell the user** what you're doing before spawning children: *"I'll work on these in parallel by spawning 3 child sessions..."*
- **Use `worktree` isolation** for parallel work on the same repo — avoids branch conflicts
- **Never use `existing` for parallel children** on the same directory
- **Limit to 3–4 children** at once — more than that strains system resources
- **Give each child a descriptive title** — it appears in the Fleet UI so the user can track progress
- **Scope each child's file boundaries** — tell children which files/directories they own
- **Don't poll** — wait for callbacks; the Fleet will notify you automatically
- **Track which children you're waiting on** — mention them to the user so they can watch progress in the Fleet UI
- **Check for conflicts after completion** — review diff summaries before reporting success
