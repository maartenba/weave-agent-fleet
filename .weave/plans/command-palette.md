# Command Palette with Configurable Key Bindings

## TL;DR
> **Summary**: Add a Cmd+K command palette with a central command registry, palette hotkeys, and fuzzy search. Ships with 8 commands spanning session management, navigation, and view controls.
> **Estimated Effort**: Medium
> **GitHub Issue**: #30

## Context

### Original Request
Implement a command palette (Cmd+K / Ctrl+K) for the Weave Agent Fleet web app. The palette should be the single entry point for all keyboard-driven actions — displaying commands grouped by category, supporting fuzzy search, and providing single-key palette hotkeys that fire while the palette is open.

### Key Findings

**Existing infrastructure:**
- `cmdk` v1.1.1 is already installed — provides fuzzy filtering, keyboard navigation, and accessible primitives.
- `src/components/ui/command.tsx` has `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandEmpty` — all scaffolded and styled but unused.
- `src/hooks/use-keyboard-shortcut.ts` provides `useKeyboardShortcut(key, callback, { platformModifier })` with text-input protection and cross-platform modifier detection.
- `src/contexts/sidebar-context.tsx` already uses `useKeyboardShortcut("b", toggleSidebar, { platformModifier: true })` — this will be migrated to the registry.

**Actions discovered across the codebase (all candidates for palette commands):**

| Action | Current trigger | Source file |
|--------|----------------|-------------|
| New Session | Button in header | `header.tsx` → `new-session-dialog.tsx` |
| Toggle Sidebar | Cmd+B / button | `sidebar-context.tsx`, `sidebar.tsx` |
| Navigate to Fleet | Sidebar link | `sidebar.tsx` |
| Navigate to Alerts | Sidebar link | `sidebar.tsx` |
| Navigate to History | Sidebar link | `sidebar.tsx` |
| Navigate to Settings | Sidebar link | `sidebar.tsx` |
| Navigate to Templates | Sidebar link (mock page) | `templates/page.tsx` |
| Navigate to Pipelines | Sidebar link (mock page) | `pipelines/page.tsx` |
| Refresh sessions | Internal refetch | `sessions-context.tsx` |
| Mark all notifications read | Button in alerts page | `alerts/page.tsx`, `notification-bell.tsx` |
| Focus prompt input | Auto-focus on idle | `prompt-input.tsx` (inputRef) |

**Session-detail-page actions** (context-sensitive — only valid on `/sessions/[id]`):
- Stop/Terminate session (`useTerminateSession`)
- Resume session (`useResumeSession`)
- Delete session (`useDeleteSession`)
- Open workspace directory (`useOpenDirectory`)

These are Phase 2 candidates — they require session context that isn't globally available. The registry design must support them but we won't wire them up in Phase 1.

**New Session Dialog** uses a controlled `Sheet` with `open`/`onOpenChange` state. To trigger it from the palette, we need to lift the `open` state or expose an imperative `open()` callback.

**Design decisions (from requirements):**
- `Cmd+K` / `Ctrl+K` opens palette (not Cmd+P — browser print conflict)
- Two shortcut layers: global shortcuts (work anywhere) + palette hotkeys (single-key, only while palette open)
- Palette hotkeys shown as badges on command items
- Pressing palette hotkey immediately executes + closes
- Typing fuzzy-filters; Enter executes highlighted
- Escape closes

## Objectives

### Core Objective
Ship a fully functional command palette that becomes the primary keyboard-driven interface for the Weave Agent Fleet app.

### Deliverables
- [ ] Central command registry (React context + types)
- [ ] Command palette UI component using existing `CommandDialog`
- [ ] Palette hotkey interception layer
- [ ] Global `Cmd+K` shortcut to open/close palette
- [ ] ~8 static commands across 3 categories (Session, Navigation, View)
- [ ] Migration of existing `Cmd+B` from sidebar context to registry
- [ ] New Session dialog invokable from palette

### Definition of Done
- [ ] `Cmd+K` opens palette; typing filters commands; Enter executes; Escape closes
- [ ] Palette hotkeys (e.g., `N` for New Session) work while palette is open
- [ ] `Cmd+B` still toggles sidebar (now via registry, not standalone hook)
- [ ] No regressions — all existing keyboard shortcuts continue to work
- [ ] Accessible: proper ARIA roles (inherited from cmdk), focus management
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes

### Guardrails (Must NOT)
- Do NOT implement user-configurable keybinding UI (that's Phase 2, #13)
- Do NOT implement session-context-sensitive commands in Phase 1 (stop/resume/delete on active session)
- Do NOT rewrite `useKeyboardShortcut` — extend or compose with it
- Do NOT add new npm dependencies — `cmdk` and all UI primitives already exist

## TODOs

- [ ] 1. **Define command registry types**
  **What**: Create the `Command` type, `CommandRegistry` context type, and a `CommandRegistryProvider` that manages an `Map<string, Command>` of registered commands. Expose `registerCommand`, `unregisterCommand`, and `commands` (as a stable array). The registry must support dynamic registration so future components can add commands at mount time.
  **Files**:
    - Create `src/lib/command-registry.ts` — types only (`Command`, `GlobalShortcut`, `CommandCategory`)
    - Create `src/contexts/command-registry-context.tsx` — React context + provider
  **Acceptance**: Types compile. Provider renders children. `useCommandRegistry()` hook returns `{ commands, registerCommand, unregisterCommand }`.

  Command type shape:
  ```ts
  interface Command {
    id: string;                          // e.g. "new-session"
    label: string;                       // "New Session"
    description?: string;                // "Create a new agent session"
    icon?: LucideIcon;                   // Plus
    category: "Session" | "Navigation" | "View";
    paletteHotkey?: string;              // single char, e.g. "n"
    globalShortcut?: {
      key: string;
      platformModifier?: boolean;
      metaKey?: boolean;
      ctrlKey?: boolean;
    };
    action: () => void;                  // what to execute
    keywords?: string[];                 // extra fuzzy search terms
    disabled?: boolean;                  // grayed out when true
  }
  ```

  Key design decisions:
  - `action` is a plain `() => void` — commands that need async work can fire-and-forget.
  - `icon` uses `LucideIcon` type (the component type, not a JSX element) so the palette renders it.
  - `keywords` enables matching "home" for "Go to Fleet" or "dashboard" for the same.
  - `disabled` allows commands to exist but be non-executable (useful for session-context commands later).
  - The registry stores commands in a `Map<string, Command>` and exposes a memoized sorted array.

- [ ] 2. **Build global shortcut dispatcher**
  **What**: Inside `CommandRegistryProvider`, iterate over all commands that have a `globalShortcut` defined and register each using `useKeyboardShortcut`. This replaces the need for individual components to call `useKeyboardShortcut` for commands that are in the registry. Add a dedicated hook `useGlobalShortcuts(commands)` that handles the effect.
  **Files**:
    - Create `src/hooks/use-global-shortcuts.ts`
    - Modify `src/contexts/command-registry-context.tsx` — call `useGlobalShortcuts` inside provider
  **Acceptance**: Adding a command with `globalShortcut: { key: "k", platformModifier: true }` causes Cmd+K to fire its action.

  Implementation note: Since `useKeyboardShortcut` must be called with stable deps, the hook should maintain a ref to the current commands map and use a single `useEffect` with a raw `keydown` listener (mirroring the pattern in `use-keyboard-shortcut.ts` but iterating all registered global shortcuts in one handler). This avoids rules-of-hooks violations from dynamic `useKeyboardShortcut` calls.

- [ ] 3. **Build the CommandPalette UI component**
  **What**: Create the palette component that wraps `CommandDialog`. It should:
  - Accept `open` / `onOpenChange` props
  - Read commands from `useCommandRegistry()`
  - Group commands by `category` using `CommandGroup`
  - Render each command with icon, label, description, and hotkey badge
  - Show `CommandEmpty` when no results match
  - Intercept single-key presses for palette hotkeys while open (before cmdk's input captures them)
  **Files**:
    - Create `src/components/command-palette.tsx`
  **Acceptance**: Component renders all registered commands grouped by category. Selecting a command calls its `action` and closes the palette.

  Hotkey interception strategy:
  - cmdk's `<CommandInput>` captures all keystrokes for filtering. We need to intercept palette hotkeys *before* they become filter text.
  - Approach: Use `onKeyDown` on the `CommandInput`. If the pressed key matches a palette hotkey AND the current search input is empty, execute the command, call `e.preventDefault()`, and close.
  - If search input is non-empty, hotkeys are disabled — all keys go to fuzzy filter.
  - This gives a natural UX: open palette → press `N` → immediately creates session. But if you start typing "nav..." the `N` goes to search.

  **Critical: `Cmd+K` toggle-to-close handling:**
  - The global shortcut dispatcher (Task 2) skips firing when focus is inside an `<input>` element (mirroring `use-keyboard-shortcut.ts` behaviour). When the palette is open, focus is in `CommandInput` — so the global `Cmd+K` handler will NOT fire.
  - Fix: The `onKeyDown` interceptor on `CommandInput` must ALSO check for `Cmd+K` / `Ctrl+K`. If detected, call `e.preventDefault()`, close the palette via `onOpenChange(false)`. This ensures `Cmd+K` toggles the palette both open AND closed.
  - This keeps the global dispatcher simple (it doesn't need special-casing for text inputs) while the palette component owns its own close behaviour.

  Hotkey badge rendering:
  - Use the existing `CommandShortcut` component with styling to show a `<kbd>` badge.
  - For global shortcuts, show platform-aware modifier: `⌘B` on Mac, `Ctrl+B` elsewhere.

- [ ] 4. **Wire palette open/close with Cmd+K**
  **What**: Add palette open state to `CommandRegistryProvider` (or a sibling component). Register a `Cmd+K` global shortcut that toggles the palette. Mount `<CommandPalette>` in the root layout.
  **Files**:
    - Modify `src/contexts/command-registry-context.tsx` — add `paletteOpen` / `setPaletteOpen` state, expose via context
    - Modify `src/app/client-layout.tsx` — add `<CommandRegistryProvider>` wrapping everything, mount `<CommandPalette>`
  **Acceptance**: Pressing `Cmd+K` opens palette. Pressing again or `Escape` closes it. Palette is accessible from every page.

  Provider nesting order in `client-layout.tsx`:
  ```
  SessionsProvider
    SidebarProvider
      CommandRegistryProvider    ← new, needs access to sidebar + sessions
        TooltipProvider
          <div> Sidebar + main </div>
          <CommandPalette />     ← portal-rendered by Dialog
      </CommandRegistryProvider>
  ```

- [ ] 5. **Register static navigation commands**
  **What**: Register the navigation commands that use `router.push()`. These are "static" — they don't depend on session state.
  **Files**:
    - Create `src/components/commands/navigation-commands.tsx` — a headless component that registers on mount and unregisters on unmount
    - Modify `src/app/client-layout.tsx` — mount `<NavigationCommands />`
  **Acceptance**: Palette shows "Go to Fleet", "Go to Alerts", "Go to History", "Go to Settings" under "Navigation" category. Selecting one navigates to the page.

  Commands to register:
  | id | label | icon | paletteHotkey | keywords |
  |----|-------|------|---------------|----------|
  | `nav-fleet` | Go to Fleet | `LayoutGrid` | `f` | home, dashboard, sessions |
  | `nav-alerts` | Go to Alerts | `Bell` | `a` | notifications |
  | `nav-history` | Go to History | `History` | `h` | past, log |
  | `nav-settings` | Go to Settings | `Settings` | `,` | preferences, config |

  Implementation pattern — the headless registration component:
  ```tsx
  function NavigationCommands() {
    const { registerCommand, unregisterCommand } = useCommandRegistry();
    const router = useRouter();

    useEffect(() => {
      registerCommand({ id: "nav-fleet", ... action: () => router.push("/") });
      // ... etc
      return () => {
        unregisterCommand("nav-fleet");
        // ... etc
      };
    }, [registerCommand, unregisterCommand, router]);

    return null;
  }
  ```

- [ ] 6. **Register view commands (toggle sidebar)**
  **What**: Migrate the `Cmd+B` toggle sidebar from `sidebar-context.tsx` into the command registry. Register it as a view command with both a `globalShortcut` and a `paletteHotkey`.
  **Files**:
    - Create `src/components/commands/view-commands.tsx`
    - Modify `src/contexts/sidebar-context.tsx` — remove the `useKeyboardShortcut("b", toggleSidebar, ...)` call
    - Modify `src/app/client-layout.tsx` — mount `<ViewCommands />`
  **Acceptance**: `Cmd+B` still toggles sidebar. Palette shows "Toggle Sidebar" under "View" with `⌘B` shortcut badge. Pressing `B` while palette is open (with empty search) toggles sidebar and closes palette.

  Commands to register:
  | id | label | icon | paletteHotkey | globalShortcut | keywords |
  |----|-------|------|---------------|----------------|----------|
  | `toggle-sidebar` | Toggle Sidebar | `PanelLeftClose` | `b` | `{ key: "b", platformModifier: true }` | panel, menu, collapse |

- [ ] 7. **Register session commands (new session)**
  **What**: Make "New Session" invokable from the palette. This requires refactoring `NewSessionDialog` so its `open` state can be controlled externally (currently it's internal via `useState`). The cleanest approach: lift the dialog's open state to a shared ref or context-level callback.
  **Files**:
    - Modify `src/components/session/new-session-dialog.tsx` — accept optional `open` / `onOpenChange` props alongside the existing `trigger` prop (backward-compatible)
    - Create `src/components/commands/session-commands.tsx` — registers "New Session" command, owns the dialog open state, renders `<NewSessionDialog>` without a trigger
    - Modify `src/app/client-layout.tsx` — mount `<SessionCommands />`
    - Modify `src/components/layout/header.tsx` — `NewSessionButton` can stay as-is (it still uses the trigger-based API)
  **Acceptance**: Pressing `N` in the palette (with empty search) opens the New Session sheet. Selecting "New Session" from filtered results also opens it. The existing button in the header still works independently.

  Commands to register:
  | id | label | icon | paletteHotkey | globalShortcut | keywords |
  |----|-------|------|---------------|----------------|----------|
  | `new-session` | New Session | `Plus` | `n` | none | create, spawn, start |

  `NewSessionDialog` refactor approach:
  ```tsx
  // Before: only internal state
  export function NewSessionDialog({ trigger }: { trigger: ReactNode }) {
    const [open, setOpen] = useState(false);
    ...
  }

  // After: optionally controlled
  export function NewSessionDialog({
    trigger,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
  }: {
    trigger?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = controlledOnOpenChange ?? setInternalOpen;
    // Guard: only render SheetTrigger when trigger is provided
    // (Radix asChild requires a valid ReactElement child)
    ...
  }
  ```

- [ ] 8. **Register additional utility commands**
  **What**: Add remaining utility commands that improve power-user workflows.
  **Files**:
    - Modify `src/components/commands/session-commands.tsx` — add "Refresh Sessions"
    - Modify `src/components/commands/view-commands.tsx` — add "Mark All Notifications Read"
  **Acceptance**: All commands appear in palette under correct categories. Actions execute correctly.

  Additional commands:
  | id | label | icon | category | paletteHotkey | keywords |
  |----|-------|------|----------|---------------|----------|
  | `refresh-sessions` | Refresh Sessions | `RefreshCw` | Session | `r` | reload, update |
  | `mark-notifications-read` | Mark All Notifications Read | `CheckCheck` | View | none | clear, dismiss |

- [ ] 9. **Add palette footer with shortcut hints**
  **What**: Add a subtle footer to the palette showing keyboard navigation hints (↑↓ to navigate, Enter to select, Esc to close). This aids discoverability.
  **Files**:
    - Modify `src/components/command-palette.tsx` — add footer below `CommandList`
  **Acceptance**: Footer renders with keyboard hints. Does not interfere with command selection.

- [ ] 10. **Integration testing and polish**
  **What**: Manual verification of all commands, keyboard shortcuts, and edge cases. Fix any issues discovered.
  **Files**: Any files from above that need fixes.
  **Acceptance**:
    - All 8+ commands appear in palette, grouped correctly
    - Fuzzy search works (typing "set" matches "Go to Settings")
    - Palette hotkeys work only when search is empty
    - `Cmd+K` toggles palette from any page
    - `Cmd+B` toggles sidebar from any page (including when palette is closed)
    - Opening palette doesn't steal focus from modals/dialogs
    - Palette is keyboard-navigable (arrow keys, Enter, Escape)
    - No TypeScript errors
    - Build succeeds

## Architecture Summary

```
client-layout.tsx
├── SessionsProvider
│   └── SidebarProvider
│       └── CommandRegistryProvider         ← owns command map + palette state
│           ├── useGlobalShortcuts()        ← single keydown handler for all global shortcuts
│           ├── TooltipProvider
│           │   └── <div>
│           │       ├── <Sidebar />
│           │       └── <main>{children}</main>
│           ├── <NavigationCommands />      ← headless, registers on mount
│           ├── <ViewCommands />            ← headless, registers on mount
│           ├── <SessionCommands />         ← headless, registers + renders NewSessionDialog
│           └── <CommandPalette />          ← dialog, reads from registry
```

### File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/command-registry.ts` | Create | Type definitions |
| `src/contexts/command-registry-context.tsx` | Create | Registry provider + hook |
| `src/hooks/use-global-shortcuts.ts` | Create | Dispatches all registered global shortcuts |
| `src/components/command-palette.tsx` | Create | Palette UI component |
| `src/components/commands/navigation-commands.tsx` | Create | Registers navigation commands |
| `src/components/commands/view-commands.tsx` | Create | Registers view commands |
| `src/components/commands/session-commands.tsx` | Create | Registers session commands + renders dialog |
| `src/app/client-layout.tsx` | Modify | Add provider + mount headless components |
| `src/contexts/sidebar-context.tsx` | Modify | Remove `useKeyboardShortcut` call |
| `src/components/session/new-session-dialog.tsx` | Modify | Accept controlled `open`/`onOpenChange` |

## Verification

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run build` completes successfully
- [ ] `npm run test` — existing tests pass (no regressions)
- [ ] Manual: `Cmd+K` opens palette on all pages
- [ ] Manual: `Cmd+B` toggles sidebar (now via registry)
- [ ] Manual: palette hotkeys work (N, F, A, H, B, R, `,`)
- [ ] Manual: fuzzy search filters commands correctly
- [ ] Manual: New Session dialog opens from palette
- [ ] Manual: header "New Session" button still works independently
- [ ] Manual: Escape closes palette
- [ ] Manual: no console errors or warnings

## Pitfalls & Mitigations

| Risk | Mitigation |
|------|-----------|
| Rules of hooks — can't dynamically call `useKeyboardShortcut` per command | Use a single `useEffect` with raw `keydown` listener that iterates the commands map |
| Palette hotkeys conflict with cmdk input | Only intercept when search input is empty; otherwise let cmdk handle filtering |
| `NewSessionDialog` refactor breaks header button | Use controlled/uncontrolled pattern — existing trigger API unchanged |
| Palette stealing focus from other open dialogs | cmdk's `CommandDialog` uses Radix Dialog which handles stacking; palette should not open if another dialog is active (consider checking) |
| `Cmd+K` conflict with browser omnibar (some browsers) | Unlikely on most browsers; `e.preventDefault()` in the hook already handles this |
| `Cmd+K` cannot close palette when `CommandInput` is focused | Global dispatcher skips text inputs; handle `Cmd+K` close in `CommandInput`'s `onKeyDown` interceptor (see Task 3) |
| SSR hydration — command registry is client-only | All files use `"use client"` directive; provider is inside `ClientLayout` |
