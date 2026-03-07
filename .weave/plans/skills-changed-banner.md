# Skills Changed Banner

## TL;DR
> **Summary**: Add a dismissible banner to the fleet page that warns users when skills have been installed or removed while active sessions exist, since those sessions won't pick up the changes until restarted.
> **Estimated Effort**: Short

## Context
### Original Request
When a user installs or removes a skill via Settings → Skills tab, existing OpenCode sessions won't pick up the changes because skills are cached at process startup. We need a visible-but-non-blocking banner on the fleet page informing users to restart sessions. We cannot modify the OpenCode codebase — this is purely a UI notification in weave-agent-fleet.

### Key Findings

1. **Skill mutation flow**: `useSkills()` hook exposes `installSkill()` and `removeSkill()`. Both are `async` functions that call the API and then `fetchSkills()`. There is no cross-component event emitted — the hook is local state only, so each `useSkills()` call is an independent instance.

2. **No shared skill-change event**: The skills hook uses local `useState`, not context or a global store. This means the fleet page has no way to know that skills changed unless we introduce a signaling mechanism.

3. **Session data**: `useSessionsContext()` provides `sessions: SessionListItem[]` with `lifecycleStatus` ("running" | "completed" | "stopped" | "error" | "disconnected") and `typedInstanceStatus` ("running" | "stopped"). A session is "active" when `lifecycleStatus === "running"`.

4. **Persisted state pattern**: `usePersistedState(key, default)` provides localStorage-backed state via `useSyncExternalStore` with cross-component reactivity — when one component writes, all components reading the same key re-render. This is the perfect mechanism to signal skill changes from the settings dialog to the fleet page.

5. **Existing banner/alert styling**: The codebase uses `rounded-md bg-{color}-500/10 border border-{color}-500/20 px-4 py-3 text-sm text-{color}-400` for inline error banners (see `page.tsx` line 482). The amber/yellow variant will work for an informational warning.

6. **Fleet page layout**: In `page.tsx`, content renders as: `Header → SummaryBar → FleetToolbar → [content]`. The banner should slot between `SummaryBar` and `FleetToolbar` for maximum visibility without disrupting layout.

## Design Decisions

### How to signal "skills changed"
Use `usePersistedState("weave:skills-changed-at", null)` to store a timestamp (epoch ms) of when skills were last mutated. The `useSkills` hook will write this timestamp after successful install/remove. The fleet page reads it and compares against session creation times.

**Why a timestamp instead of a boolean flag?**
- A timestamp lets us compare: "did skills change *after* sessions were started?" — this avoids false positives on page reload when skills were changed days ago but all sessions have since been restarted.
- A timestamp also naturally resets the "dismissed" state: if the user dismisses the banner but then changes skills again, `changedAt > dismissedAt` triggers the banner again.

### How to track dismissal
Use `usePersistedState("weave:skills-banner-dismissed-at", null)` storing the epoch ms when dismissed. Banner shows when `changedAt !== null && changedAt > (dismissedAt ?? 0)`.

### Where the banner state lives
- **Signal (write side)**: Inside `useSkills` hook — after successful `installSkill` or `removeSkill`, write the timestamp. This is minimal and surgical.
- **Display (read side)**: A new `<SkillsChangedBanner />` component rendered in `page.tsx`. It reads the persisted timestamp, checks if running sessions exist, and renders conditionally.

### When to show / hide
Show when ALL of these are true:
1. `skillsChangedAt` is not null
2. `skillsChangedAt > (dismissedAt ?? 0)` (not dismissed for this change)
3. At least one session has `lifecycleStatus === "running"` (active sessions exist)

Auto-clear (hide without explicit dismiss) when:
- No sessions have `lifecycleStatus === "running"` (all stopped/restarted)

### Component placement
New file `src/components/fleet/skills-changed-banner.tsx` — keeps fleet components organized. Rendered in `page.tsx` between `SummaryBar` and `FleetToolbar`.

## Objectives
### Core Objective
Inform users that skill changes require session restarts, with a dismissible banner that reappears on subsequent changes.

### Deliverables
- [ ] Signal mechanism: `useSkills` writes `skillsChangedAt` timestamp on install/remove
- [ ] Banner component: `SkillsChangedBanner` with dismiss button
- [ ] Integration: banner rendered on fleet page
- [ ] Auto-clear logic: banner hides when no running sessions remain

### Definition of Done
- [ ] Install a skill with active sessions → banner appears on fleet page
- [ ] Remove a skill with active sessions → banner appears on fleet page
- [ ] Click X on banner → banner disappears, survives page refresh
- [ ] Change skills again after dismissing → banner reappears
- [ ] No active sessions when skills change → no banner shown
- [ ] All sessions stopped after banner appeared → banner auto-clears
- [ ] `npm run build` succeeds with no type errors

### Guardrails (Must NOT)
- Must NOT modify the OpenCode codebase
- Must NOT introduce new npm dependencies
- Must NOT use React Context for this — `usePersistedState` is sufficient and simpler
- Must NOT block or overlay session cards — banner is inline and dismissible

## TODOs

- [ ] 1. **Add skill-change timestamp to `useSkills` hook**
  **What**: After successful `installSkill()` and `removeSkill()` calls, write `Date.now()` to `localStorage` key `"weave:skills-changed-at"`. Since `useSkills` is a plain hook (not context), we cannot use `usePersistedState` directly inside the async callbacks without causing stale closure issues. Instead, write directly to localStorage and call the `emitChange` mechanism. The cleanest approach: import and use `usePersistedState` at the top level of the hook, then call the setter in the success paths.
  **Files**: `src/hooks/use-skills.ts`
  **Changes**:
  - Add import: `import { usePersistedState } from "./use-persisted-state";`
  - Inside `useSkills()`, add: `const [, setSkillsChangedAt] = usePersistedState<number | null>("weave:skills-changed-at", null);`
  - In `installSkill`, after `await fetchSkills()` (line 51), add: `setSkillsChangedAt(Date.now());`
  - In `removeSkill`, after `await fetchSkills()` (line 72), add: `setSkillsChangedAt(Date.now());`
  **Acceptance**: After install/remove, `localStorage.getItem("weave:skills-changed-at")` contains a recent timestamp.

- [ ] 2. **Create `SkillsChangedBanner` component**
  **What**: A new component that reads the skills-changed timestamp, checks for running sessions, and renders a dismissible amber banner.
  **Files**: `src/components/fleet/skills-changed-banner.tsx` (new file)
  **Implementation details**:
  ```
  - "use client" directive
  - Import: usePersistedState, useSessionsContext, X icon from lucide-react
  - Read skillsChangedAt via usePersistedState<number | null>("weave:skills-changed-at", null)
  - Read dismissedAt via usePersistedState<number | null>("weave:skills-banner-dismissed-at", null)
  - Get sessions from useSessionsContext()
  - Derive hasRunningSessions: sessions.some(s => s.lifecycleStatus === "running")
  - Derive shouldShow: skillsChangedAt !== null && skillsChangedAt > (dismissedAt ?? 0) && hasRunningSessions
  - If !shouldShow, return null
  - Render an amber banner with:
    - Icon: AlertTriangle from lucide-react (consistent with sidebar warning pattern)
    - Text: "Skills have changed. New sessions will use updated skills — restart existing sessions to apply."
    - Dismiss button: X icon button on the right
    - On dismiss: setDismissedAt(Date.now())
  - Styling (matches existing error banner pattern but amber):
    rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400
    flex items-center gap-3
    The X button: ml-auto shrink-0, ghost-style hover
  ```
  **Acceptance**: Component renders when conditions met, returns null otherwise. Dismiss writes timestamp.

- [ ] 3. **Integrate banner into fleet page**
  **What**: Import and render `<SkillsChangedBanner />` in `page.tsx` between `SummaryBar` and `FleetToolbar`.
  **Files**: `src/app/page.tsx`
  **Changes**:
  - Add import: `import { SkillsChangedBanner } from "@/components/fleet/skills-changed-banner";`
  - In the JSX of `FleetPageInner`, between the `<SummaryBar>` (line 463) and `<FleetToolbar>` (line 465), add: `<SkillsChangedBanner />`
  - The banner is inside the `space-y-6` container so it gets consistent spacing automatically.
  **Acceptance**: Banner visible on fleet page after skill changes when sessions are running.

## Verification
- [ ] `npm run build` completes with no errors
- [ ] Manual test: start a session, install a skill → banner appears on fleet page
- [ ] Manual test: dismiss banner → banner gone; refresh page → still gone
- [ ] Manual test: install another skill → banner reappears (dismissed timestamp is older)
- [ ] Manual test: stop all sessions → banner auto-hides
- [ ] Manual test: change skills with no running sessions → no banner shown
- [ ] No regressions: settings skills tab still works, session cards unaffected

## Implementation Notes

### Why `usePersistedState` over a React Context
A dedicated context would require wrapping the app in a new provider, threading callbacks through the settings dialog, and managing state lifecycle — all for a single boolean-ish signal. `usePersistedState` already provides cross-component reactivity via `useSyncExternalStore` + localStorage, and it's the established pattern in this codebase (used for fleet prefs, sidebar state, etc.). Two components reading the same key automatically stay in sync.

### Why timestamps over a boolean flag
A boolean `skillsChanged` flag creates awkward state management: when do you clear it? A dismissed boolean plus a changed boolean requires coordinating two flags. Timestamps are self-describing: `changedAt > dismissedAt` is the complete condition. If skills change again, `changedAt` advances past `dismissedAt` and the banner resurfaces — no explicit "re-enable" logic needed.

### Edge case: multiple tabs
`usePersistedState` uses `useSyncExternalStore` which listens to the in-memory subscriber registry. It does NOT listen to the `storage` event (cross-tab). This means if a user changes skills in one tab, the banner won't appear in another tab until that tab reloads or the user navigates. This is acceptable — the same limitation applies to all `usePersistedState` usage in the app.

### File count
- 1 new file: `src/components/fleet/skills-changed-banner.tsx`
- 2 modified files: `src/hooks/use-skills.ts`, `src/app/page.tsx`
- Total: ~40 lines of new code
