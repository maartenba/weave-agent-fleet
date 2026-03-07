# Remove Alerts and History Features

## TL;DR
> **Summary**: Delete the Alerts page, History page, and all supporting code (hooks, API routes, cleanup service, types, nav commands, keybindings). Session statuses in the sidebar make these features redundant.
> **Estimated Effort**: Quick

## Context
### Original Request
Remove the Alerts and History features entirely. Session statuses displayed next to each session label in the sidebar already provide the relevant information, making dedicated Alerts and History pages unnecessary.

### Key Findings
- **Alerts page** (`/alerts`) and **History page** (`/history`) are standalone Next.js pages with no cross-dependencies.
- `use-session-history` hook and `HistorySession`/`HistoryResponse` types are only consumed by the History page and its API route.
- `notification-cleanup.ts` is dynamically imported in `process-manager.ts` (line 668) — that import line must be removed.
- The notification cleanup test file also needs deletion.
- The broader **notification system** (context, hooks, NotificationBell, database functions) stays — only the dedicated Alerts page is removed.
- Sidebar uses `Bell`, `History` icons and `useNotifications`/`unreadCount` only for the Alerts/History nav links — safe to remove those imports. `Badge` import stays (used for Fleet session count).

## Objectives
### Core Objective
Clean removal of Alerts and History features with zero orphaned code.

### Deliverables
- [ ] All Alerts/History page routes, hooks, API routes, and supporting code deleted
- [ ] All navigation references (sidebar links, commands, keybindings) cleaned up
- [ ] Build passes with no errors

### Definition of Done
- [ ] `npm run build` succeeds
- [ ] No imports reference deleted files (`notification-cleanup`, `use-session-history`, `/alerts`, `/history`)
- [ ] `/alerts` and `/history` routes return 404

### Guardrails (Must NOT)
- Do NOT remove the notification system (context, hooks, NotificationBell, database functions, API endpoints for notifications)
- Do NOT remove session search or any shared infrastructure
- Do NOT modify database schema

## TODOs

### Phase 1: Delete Dead Files (7 files)

- [ ] 1. **Delete Alerts page**
  **What**: Delete the file
  **Files**: `src/app/alerts/page.tsx`
  **Acceptance**: File no longer exists

- [ ] 2. **Delete History page**
  **What**: Delete the file
  **Files**: `src/app/history/page.tsx`
  **Acceptance**: File no longer exists

- [ ] 3. **Delete session history hook**
  **What**: Delete the file
  **Files**: `src/hooks/use-session-history.ts`
  **Acceptance**: File no longer exists

- [ ] 4. **Delete history API route**
  **What**: Delete the file (and its parent `history/` directory)
  **Files**: `src/app/api/sessions/history/route.ts`
  **Acceptance**: File and directory no longer exist

- [ ] 5. **Delete notification cleanup service**
  **What**: Delete the file
  **Files**: `src/lib/server/notification-cleanup.ts`
  **Acceptance**: File no longer exists

- [ ] 6. **Delete notification cleanup test**
  **What**: Delete the test file
  **Files**: `src/lib/server/__tests__/notification-cleanup.test.ts`
  **Acceptance**: File no longer exists

### Phase 2: Remove References in Existing Files (5 files)

- [ ] 7. **Clean up process-manager.ts**
  **What**: Remove the dynamic import of `notification-cleanup` at line 668:
  ```
  import("./notification-cleanup").then((m) => m.startNotificationCleanup()).catch((err) => { log.warn("process-manager", "Failed to start notification cleanup", { err }); });
  ```
  **Files**: `src/lib/server/process-manager.ts`
  **Acceptance**: No reference to `notification-cleanup` in the file

- [ ] 8. **Clean up sidebar.tsx**
  **What**: 
  - Remove `Bell` and `History` from lucide-react import (line 10-11)
  - Remove `useNotifications` import (line 29) and its usage `const { unreadCount } = useNotifications()` (line 46)
  - Remove the `{/* Alerts */}` block (lines 320-365)
  - Remove the `{/* History */}` block (lines 367-398)
  **Files**: `src/components/layout/sidebar.tsx`
  **Acceptance**: No references to `/alerts`, `/history`, `Bell`, `History` icon, `unreadCount`, or `useNotifications` in the file

- [ ] 9. **Clean up navigation-commands.tsx**
  **What**:
  - Remove `Bell, History` from lucide-react import (line 5)
  - Remove `goToAlerts` and `goToHistory` callbacks (lines 16-17)
  - Remove the two `registerCommand` blocks for `nav-alerts` and `nav-history` (lines 38-55)
  - Remove `unregisterCommand("nav-alerts")` and `unregisterCommand("nav-history")` (lines 60-61)
  - Remove `goToAlerts` and `goToHistory` from the useEffect dependency array (lines 69-70)
  **Files**: `src/components/commands/navigation-commands.tsx`
  **Acceptance**: No references to `alerts`, `history`, `Bell`, or `History` in the file

- [ ] 10. **Clean up keybinding-types.ts**
  **What**: Remove the two entries from `DEFAULT_KEYBINDINGS`:
  ```
  "nav-alerts":         { paletteHotkey: "a", globalShortcut: null },
  "nav-history":        { paletteHotkey: "h", globalShortcut: null },
  ```
  **Files**: `src/lib/keybinding-types.ts`
  **Acceptance**: No `nav-alerts` or `nav-history` entries in DEFAULT_KEYBINDINGS

- [ ] 11. **Clean up keybindings-tab.tsx**
  **What**:
  - Remove `Bell` and `History` from lucide-react import (lines 7-8)
  - Remove the two entries from the `COMMANDS` array:
    ```
    { id: "nav-alerts",  label: "Go to Alerts",   icon: Bell,    category: "Navigation" },
    { id: "nav-history", label: "Go to History",   icon: History, category: "Navigation" },
    ```
  **Files**: `src/components/settings/keybindings-tab.tsx`
  **Acceptance**: No references to `nav-alerts`, `nav-history`, `Bell`, or `History` in the file

### Phase 3: Remove History/Alerts types from api-types.ts

- [ ] 12. **Remove dead types from api-types.ts**
  **What**: Remove the `HistorySession` interface and `HistoryResponse` interface (lines 254-271, including the section comment)
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: No `HistorySession` or `HistoryResponse` types in the file

## Verification

- [ ] `npm run build` succeeds with no errors
- [ ] `npx tsc --noEmit` passes (no type errors from orphaned references)
- [ ] Grep for orphaned references: no results for `use-session-history`, `notification-cleanup`, `HistorySession`, `HistoryResponse`, `nav-alerts`, `nav-history` in `src/`
- [ ] Application loads — sidebar shows Fleet and Settings links only (no Alerts/History)
