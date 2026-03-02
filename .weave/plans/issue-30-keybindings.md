# Issue #30 — Configurable Key Bindings (Command Palette + User Configuration)

## TL;DR
> **Summary**: Build a `Cmd+K` command palette with a central command registry (Phase 1), then add user-configurable keybinding UI with persistence and conflict detection (Phase 2).
> **Estimated Effort**: Large
> **GitHub Issue**: #30

## Context

### Original Request
The app has a single hardcoded `Cmd+B` shortcut (sidebar toggle) via `useKeyboardShortcut`. We need a full command palette system: a central command registry, default keybindings with palette hotkeys, and eventually user-configurable bindings persisted to localStorage.

### Key Findings

**Existing infrastructure:**
- `cmdk` v1.1.1 is already installed — provides fuzzy filtering, keyboard navigation, and accessible primitives.
- `src/components/ui/command.tsx` has `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandEmpty` — all scaffolded and styled but **unused anywhere in the app**.
- `src/hooks/use-keyboard-shortcut.ts` provides `useKeyboardShortcut(key, callback, { platformModifier })` with text-input protection and cross-platform modifier detection.
- `src/contexts/sidebar-context.tsx` uses `useKeyboardShortcut("b", toggleSidebar, { platformModifier: true })` — the only current global shortcut.
- `src/hooks/use-persisted-state.ts` uses `useSyncExternalStore` + localStorage with cross-tab reactivity — perfect for persisting keybindings in Phase 2.

**Actions discovered across the codebase:**

| Action | Current trigger | Source file |
|--------|----------------|-------------|
| New Session | Button in header | `header.tsx` → `new-session-dialog.tsx` |
| Toggle Sidebar | `Cmd+B` / button | `sidebar-context.tsx`, `sidebar.tsx` |
| Navigate to Fleet | Sidebar link | `sidebar.tsx` |
| Navigate to Alerts | Sidebar link | `sidebar.tsx` |
| Navigate to History | Sidebar link | `sidebar.tsx` |
| Navigate to Settings | Sidebar link | `sidebar.tsx` |
| Focus Prompt Input | Auto-focus on idle | `prompt-input.tsx` (inputRef) |
| Refresh Sessions | Internal refetch | `sessions-context.tsx` |
| Mark All Notifications Read | Button in alerts page | `alerts/page.tsx` |

**Session-detail-page actions** (context-sensitive — only valid on `/sessions/[id]`):
- Focus Prompt Input (`inputRef.current?.focus()`)
- These need the prompt input to exist on the page, so the command is only registered when the session detail page is mounted.

**New Session Dialog** uses a controlled `Sheet` with internal `open`/`onOpenChange` state. To trigger from the palette, we need to refactor it to accept optional external controlled state.

**Provider nesting in `client-layout.tsx`:**
```
SessionsProvider
  NotificationsProvider
    SidebarProvider
      TooltipProvider
        <div> Sidebar + main </div>
```
The `CommandRegistryProvider` must be inserted inside `SidebarProvider` (to access `toggleSidebar`) and inside `NotificationsProvider` (to access `markAllAsRead`).

**Settings page** (`src/app/settings/page.tsx`) uses a `Tabs` component with 4 tabs (Skills, Agents, Notifications, About). Phase 2 will add a "Keybindings" tab.

**Test infrastructure**: Vitest with `node` environment. Tests are `src/**/*.test.ts` — no component tests (no jsdom). Phase 2 keybinding utilities (conflict detection, serialization) can be unit tested.

## Objectives

### Core Objective
Ship a command palette with a central registry (Phase 1), then user-configurable keybindings with conflict detection (Phase 2).

### Deliverables
- [ ] Central command registry (types, context, hook API)
- [ ] Command palette UI wired to `Cmd+K` / `Ctrl+K`
- [ ] 7+ default commands with palette hotkeys and/or global shortcuts
- [ ] Hotkey badges displayed inline in palette list items
- [ ] Palette hotkey interception (single-key while palette is open, search empty)
- [ ] Migration of `Cmd+B` from sidebar context into registry
- [ ] "Focus Prompt Input" command (page-sensitive)
- [ ] User-configurable keybinding Settings tab (Phase 2)
- [ ] localStorage persistence of custom bindings (Phase 2)
- [ ] Conflict detection with warnings (Phase 2)
- [ ] "Reset to defaults" option (Phase 2)

### Definition of Done
- [ ] `Cmd+K` opens palette; typing filters; Enter executes; Escape closes
- [ ] Palette hotkeys (e.g. `N`, `B`, `S`, `F`, `A`, `/`) work while palette is open with empty search
- [ ] `Cmd+B` toggles sidebar (via registry, not standalone hook)
- [ ] At least 7 commands registered with palette hotkeys
- [ ] Settings tab shows all keybindings with rebind UI (Phase 2)
- [ ] Custom bindings persist across page reloads (Phase 2)
- [ ] Conflict detection warns on duplicate bindings (Phase 2)
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes (no regressions + new unit tests)

### Guardrails (Must NOT)
- Do NOT add new npm dependencies — `cmdk` and all UI primitives already exist
- Do NOT rewrite `useKeyboardShortcut` — compose with it or mirror its pattern
- Do NOT break existing `Cmd+B` sidebar toggle during migration
- Do NOT render session-context commands on pages where they make no sense (disabled is OK)

---

## Phase 1 — Command Palette & Default Bindings

### TODOs

- [ ] 1. **Define command registry types**
  **What**: Create the `Command` interface and related types. This is the single source of truth for what a "command" is.
  **Files**: Create `src/lib/command-registry.ts`
  **Acceptance**: Types compile. Importing them works from any `src/` file.

  Type definitions:
  ```ts
  import type { LucideIcon } from "lucide-react";

  export type CommandCategory = "Session" | "Navigation" | "View";

  export interface GlobalShortcut {
    key: string;
    platformModifier?: boolean;  // ⌘ on macOS, Ctrl elsewhere
    metaKey?: boolean;
    ctrlKey?: boolean;
  }

  export interface Command {
    id: string;                    // e.g. "toggle-sidebar"
    label: string;                 // "Toggle Sidebar"
    description?: string;          // "Show or hide the sidebar panel"
    icon?: LucideIcon;             // PanelLeftClose
    category: CommandCategory;
    paletteHotkey?: string;        // single char, e.g. "b"
    globalShortcut?: GlobalShortcut;
    action: () => void;
    keywords?: string[];           // extra fuzzy search terms
    disabled?: boolean;            // grayed out when true
  }

  export interface CommandRegistryValue {
    commands: Command[];
    paletteOpen: boolean;
    setPaletteOpen: (open: boolean) => void;
    registerCommand: (command: Command) => void;
    unregisterCommand: (id: string) => void;
  }
  ```

  Key design decisions:
  - `action` is `() => void` — commands that need async can fire-and-forget.
  - `icon` is the `LucideIcon` component type, not a rendered element — the palette renders it.
  - `paletteHotkey` is always a single lowercase character.
  - `globalShortcut` mirrors the shape used by `useKeyboardShortcut`.
  - `disabled` allows commands to exist but be non-executable (e.g. "Focus Prompt" when not on session page).

- [ ] 2. **Create CommandRegistryProvider context**
  **What**: Build the React context and provider that stores registered commands in a `Map<string, Command>`, exposes `registerCommand` / `unregisterCommand`, and manages the palette open/close state. Also implement the global shortcut dispatcher inside the provider (single `keydown` listener iterating all commands with `globalShortcut`).
  **Files**:
    - Create `src/contexts/command-registry-context.tsx`
  **Acceptance**: `useCommandRegistry()` returns `{ commands, paletteOpen, setPaletteOpen, registerCommand, unregisterCommand }`. Adding a command with `globalShortcut` makes it fire on the specified key combo.

  Implementation notes:
  - Store commands in `useRef<Map<string, Command>>` with a state counter to trigger re-renders when commands change.
  - The global shortcut dispatcher should be a single `useEffect` with a raw `keydown` listener (mirroring `use-keyboard-shortcut.ts` logic) that iterates all registered commands. This avoids rules-of-hooks violations from dynamic `useKeyboardShortcut` calls.
  - Skip events when focus is in text inputs / contenteditable (same logic as `use-keyboard-shortcut.ts`).
  - Register `Cmd+K` / `Ctrl+K` to toggle `paletteOpen` inside the dispatcher itself (hardcoded, not a registered command — because it needs to always work).
  - Memoize the `commands` array (sorted by category then label) and only recompute when the map changes.
  - Wrap `registerCommand` and `unregisterCommand` in `useCallback` for stable refs.

- [ ] 3. **Build the CommandPalette UI component**
  **What**: Create the palette component wrapping `CommandDialog`. Reads commands from `useCommandRegistry()`, groups by category, renders with icons and hotkey badges, and intercepts palette hotkeys.
  **Files**: Create `src/components/command-palette.tsx`
  **Acceptance**: Component renders all registered commands grouped by category. Selecting a command calls its `action` and closes the palette. Palette hotkeys execute commands when search is empty.

  Implementation details:
  - Uses `CommandDialog` with `open={paletteOpen}` / `onOpenChange={setPaletteOpen}`.
  - Groups commands by `command.category` using `CommandGroup` with heading.
  - Each item renders: `{icon} {label}` on the left, `<CommandShortcut>` with hotkey badge on the right.
  - For global shortcuts, show platform-aware label: `⌘B` on Mac, `Ctrl+B` elsewhere (detect via `navigator.userAgent`).
  - For palette-only hotkeys, show the single character in a `<kbd>` styled element.
  - `CommandEmpty` shows "No commands found."
  - Disabled commands render with `data-disabled="true"` and don't execute.

  **Search state — IMPORTANT:** cmdk manages search internally, so you MUST lift the search state to detect "is search empty?" for hotkey interception. Use controlled input:
  ```tsx
  const [search, setSearch] = useState("");
  // ...
  <CommandInput value={search} onValueChange={setSearch} onKeyDown={handleKeyDown} />
  ```
  Then reference `search` (not the DOM) in `handleKeyDown` to check emptiness. Without this, hotkey interception will not work correctly.

  **Hotkey interception strategy:**
  - Use `onKeyDown` on `CommandInput`.
  - If the pressed key matches a `paletteHotkey` AND `search === ""` AND no modifier keys are pressed, execute the command, `e.preventDefault()`, and close the palette.
  - If search is non-empty, all keys go to fuzzy filter (no interception).
  - Also check for `Cmd+K` / `Ctrl+K` in the `onKeyDown` — if detected, close the palette. This is necessary because the global dispatcher skips events when focus is inside an `<input>` (which `CommandInput` is).

  **Hotkey badge rendering:**
  - Use `CommandShortcut` (existing shadcn component) which renders as a `<span>` with `ml-auto text-xs tracking-widest`.
  - Inside it, render `<kbd>` elements with styling: `pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground`.
  - For commands with both palette hotkey and global shortcut, show the global shortcut (it's more relevant since it works everywhere).

- [ ] 4. **Wire palette into root layout**
  **What**: Add `CommandRegistryProvider` to the provider tree and mount `<CommandPalette />` in the root layout.
  **Files**: Modify `src/app/client-layout.tsx`
  **Acceptance**: Pressing `Cmd+K` opens palette from any page. Escape closes it.

  Provider nesting order:
  ```
  SessionsProvider
    NotificationsProvider
      SidebarProvider
        CommandRegistryProvider    ← NEW
          TooltipProvider
            <div>
              <Sidebar />
              <main>{children}</main>
            </div>
            <CommandPalette />    ← NEW (portal-rendered by Dialog)
        </CommandRegistryProvider>
  ```

  The `CommandRegistryProvider` must be inside `SidebarProvider` and `NotificationsProvider` so that command registration components (Tasks 5–8) can access `useSidebar()`, `useNotifications()`, etc.

- [ ] 5. **Register navigation commands**
  **What**: Create a headless component that registers navigation commands on mount and unregisters on unmount. Uses `router.push()` for navigation.
  **Files**:
    - Create `src/components/commands/navigation-commands.tsx`
    - Modify `src/app/client-layout.tsx` — mount `<NavigationCommands />`
  **Acceptance**: Palette shows navigation commands under "Navigation" group. Selecting one navigates to the correct page.

  Commands to register:
  | id | label | icon | paletteHotkey | keywords |
  |----|-------|------|---------------|----------|
  | `nav-fleet` | Go to Fleet | `LayoutGrid` | `f` | home, dashboard, sessions |
  | `nav-settings` | Go to Settings | `Settings` | `s` | preferences, config |
  | `nav-alerts` | Go to Alerts | `Bell` | `a` | notifications |
  | `nav-history` | Go to History | `History` | `h` | past, log |

  Pattern:
  ```tsx
  "use client";
  import { useEffect } from "react";
  import { useRouter } from "next/navigation";
  import { useCommandRegistry } from "@/contexts/command-registry-context";
  import { LayoutGrid, Settings, Bell, History } from "lucide-react";

  export function NavigationCommands() {
    const { registerCommand, unregisterCommand } = useCommandRegistry();
    const router = useRouter();

    useEffect(() => {
      const commands = [
        { id: "nav-fleet", label: "Go to Fleet", icon: LayoutGrid,
          paletteHotkey: "f", keywords: ["home", "dashboard", "sessions"],
          action: () => router.push("/") },
        // ... etc
      ];
      commands.forEach((cmd) =>
        registerCommand({ ...cmd, category: "Navigation" as const })
      );
      return () => commands.forEach((cmd) => unregisterCommand(cmd.id));
    }, [registerCommand, unregisterCommand, router]);

    return null;
  }
  ```

- [ ] 6. **Register view commands (toggle sidebar)**
  **What**: Migrate the `Cmd+B` sidebar toggle from `sidebar-context.tsx` into the command registry. Register it as a view command with both a `globalShortcut` and a `paletteHotkey`.
  **Files**:
    - Create `src/components/commands/view-commands.tsx`
    - Modify `src/contexts/sidebar-context.tsx` — **remove** the `useKeyboardShortcut("b", toggleSidebar, { platformModifier: true })` line and the `useKeyboardShortcut` import (if no longer used).
    - Modify `src/app/client-layout.tsx` — mount `<ViewCommands />`
  **Acceptance**: `Cmd+B` still toggles sidebar (now via registry). Palette shows "Toggle Sidebar" under "View" with `⌘B` badge.

  Commands to register:
  | id | label | icon | paletteHotkey | globalShortcut | keywords |
  |----|-------|------|---------------|----------------|----------|
  | `toggle-sidebar` | Toggle Sidebar | `PanelLeftClose` | `b` | `{ key: "b", platformModifier: true }` | panel, menu, collapse, expand |

- [ ] 7. **Register session commands (new session)**
  **What**: Make "New Session" invokable from the palette. Refactor `NewSessionDialog` to accept optional controlled `open`/`onOpenChange` props while maintaining backward compatibility with the existing trigger-based API.
  **Files**:
    - Modify `src/components/session/new-session-dialog.tsx` — accept optional `open` / `onOpenChange` props
    - Create `src/components/commands/session-commands.tsx` — registers commands + renders `<NewSessionDialog>` without trigger
    - Modify `src/app/client-layout.tsx` — mount `<SessionCommands />`
  **Acceptance**: Pressing `N` in the palette (with empty search) opens the New Session sheet. The existing header button still works independently.

  `NewSessionDialog` refactor:
  ```tsx
  interface NewSessionDialogProps {
    trigger?: React.ReactNode;       // optional now (was required)
    open?: boolean;                   // controlled mode
    onOpenChange?: (open: boolean) => void;  // controlled mode
  }

  export function NewSessionDialog({
    trigger,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
  }: NewSessionDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = controlledOnOpenChange ?? setInternalOpen;
    // Only render SheetTrigger when trigger prop is provided
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        <SheetContent ...>
          ...
        </SheetContent>
      </Sheet>
    );
  }
  ```

  Commands to register:
  | id | label | icon | paletteHotkey | keywords |
  |----|-------|------|---------------|----------|
  | `new-session` | New Session | `Plus` | `n` | create, spawn, start |

  `SessionCommands` also registers:
  | id | label | icon | paletteHotkey | keywords |
  |----|-------|------|---------------|----------|
  | `refresh-sessions` | Refresh Sessions | `RefreshCw` | `r` | reload, update |

  For `refresh-sessions`, use `useSessionsContext().refetch`.

- [ ] 8. **Register "Focus Prompt Input" command**
  **What**: Register a palette command that focuses the prompt input on the session detail page. This command is page-sensitive — it should register only when `/sessions/[id]` is mounted and a prompt input exists.
  **Files**:
    - Modify `src/app/sessions/[id]/page.tsx` — register/unregister command using `useCommandRegistry`, and expose `inputRef` focusing
    - Modify `src/components/session/prompt-input.tsx` — accept an optional `ref` forwarding (using `React.forwardRef` or a callback ref prop) so the parent page can imperatively focus it
  **Acceptance**: When on a session page, pressing `/` in the palette focuses the prompt input and closes the palette. When not on a session page, the command doesn't appear in the palette.

  Implementation approach:
  - `PromptInput` already has `inputRef = useRef<HTMLInputElement>(null)`. Expose this by accepting a `ref` prop via `React.forwardRef`, or add a `onRef?: (el: HTMLInputElement | null) => void` callback prop.
  - In `SessionDetailPage`, get a ref to the input and register:
    ```ts
    const promptRef = useRef<HTMLInputElement>(null);
    const { registerCommand, unregisterCommand } = useCommandRegistry();

    useEffect(() => {
      registerCommand({
        id: "focus-prompt",
        label: "Focus Prompt Input",
        icon: MessageSquare, // or similar
        category: "Session",
        paletteHotkey: "/",
        keywords: ["message", "chat", "type", "input"],
        action: () => promptRef.current?.focus(),
      });
      return () => unregisterCommand("focus-prompt");
    }, [registerCommand, unregisterCommand]);
    ```
  - Pass the ref: `<PromptInput ref={promptRef} ... />`

- [ ] 9. **Add palette footer with keyboard hints**
  **What**: Add a subtle footer below the command list showing navigation hints: `↑↓ Navigate`, `↵ Select`, `Esc Close`. Improves discoverability.
  **Files**: Modify `src/components/command-palette.tsx`
  **Acceptance**: Footer renders below the command list. Does not interfere with command selection or keyboard navigation.

  Implementation:
  ```tsx
  <div className="flex items-center gap-4 border-t px-3 py-2 text-[10px] text-muted-foreground">
    <span><kbd>↑↓</kbd> Navigate</span>
    <span><kbd>↵</kbd> Select</span>
    <span><kbd>Esc</kbd> Close</span>
  </div>
  ```

- [ ] 10. **Phase 1 verification and polish**
  **What**: Verify all commands, shortcuts, edge cases, and accessibility. Fix any issues.
  **Files**: Any files from Tasks 1–9 as needed.
  **Acceptance**:
  - `Cmd+K` opens palette on all pages
  - `Cmd+K` when palette is open closes it (even though focus is in CommandInput)
  - `Cmd+B` toggles sidebar from anywhere (now via registry)
  - Palette hotkeys work only when search is empty
  - Fuzzy search works (typing "set" matches "Go to Settings")
  - New Session dialog opens from palette
  - Header "New Session" button still works independently
  - "Focus Prompt Input" appears only on session pages
  - Escape closes palette
  - Arrow keys navigate, Enter selects
  - Disabled commands show but don't execute
  - No TypeScript errors (`npm run typecheck`)
  - Build succeeds (`npm run build`)
  - Existing tests pass (`npm run test`)

---

## Phase 2 — User Configuration

### TODOs

- [ ] 11. **Create keybinding types and defaults map**
  **What**: Define types for user-customizable keybindings and create a `DEFAULT_KEYBINDINGS` map that serves as the source of truth for default values. Separate the "what binding is" from "what command does" — bindings are serializable config, commands have runtime callbacks.
  **Files**: Create `src/lib/keybinding-types.ts`
  **Acceptance**: Types compile. Default map contains entries for all Phase 1 commands.

  Types:
  ```ts
  export interface KeyBinding {
    paletteHotkey: string | null;     // single char or null
    globalShortcut: {
      key: string;
      platformModifier?: boolean;
      metaKey?: boolean;
      ctrlKey?: boolean;
    } | null;
  }

  // Serializable config — what gets persisted to localStorage
  export type KeyBindingsConfig = Record<string, KeyBinding>;

  export const DEFAULT_KEYBINDINGS: KeyBindingsConfig = {
    "nav-fleet":        { paletteHotkey: "f", globalShortcut: null },
    "nav-settings":     { paletteHotkey: "s", globalShortcut: null },
    "nav-alerts":       { paletteHotkey: "a", globalShortcut: null },
    "nav-history":      { paletteHotkey: "h", globalShortcut: null },
    "toggle-sidebar":   { paletteHotkey: "b", globalShortcut: { key: "b", platformModifier: true } },
    "new-session":      { paletteHotkey: "n", globalShortcut: null },
    "refresh-sessions": { paletteHotkey: "r", globalShortcut: null },
    "focus-prompt":     { paletteHotkey: "/", globalShortcut: null },
  };
  ```

- [ ] 12. **Create keybinding conflict detection utility**
  **What**: Create a pure function that checks a proposed keybinding against the current bindings map and returns any conflicts. This is a testable utility with no React dependencies.
  **Files**:
    - Create `src/lib/keybinding-utils.ts`
    - Create `src/lib/__tests__/keybinding-utils.test.ts`
  **Acceptance**: Unit tests pass for all conflict scenarios.

  Functions:
  ```ts
  export interface ConflictResult {
    type: "palette" | "global";
    conflictingCommandId: string;
    key: string;
  }

  // Check if a proposed palette hotkey conflicts with existing bindings
  export function detectPaletteConflict(
    commandId: string,
    newHotkey: string,
    bindings: KeyBindingsConfig
  ): ConflictResult | null;

  // Check if a proposed global shortcut conflicts with existing bindings
  export function detectGlobalConflict(
    commandId: string,
    newShortcut: GlobalShortcut,
    bindings: KeyBindingsConfig
  ): ConflictResult | null;

  // Serialize a GlobalShortcut to a display label (e.g. "⌘B" or "Ctrl+B")
  export function formatShortcut(shortcut: GlobalShortcut, isMac: boolean): string;

  // Merge user overrides with defaults (user wins, missing keys get defaults)
  export function mergeWithDefaults(
    userBindings: Partial<KeyBindingsConfig>,
    defaults: KeyBindingsConfig
  ): KeyBindingsConfig;
  ```

  Test cases:
  - No conflict when binding is unique
  - Conflict detected when two commands share palette hotkey
  - Conflict detected when two commands share global shortcut key+modifiers
  - Self-assignment is not a conflict (re-binding same key to same command)
  - `mergeWithDefaults` preserves user overrides and fills gaps with defaults
  - `formatShortcut` produces correct platform labels

- [ ] 13. **Create keybindings context (persistence layer)**
  **What**: Build a React context that manages the current keybindings config, merging user overrides (from localStorage via `usePersistedState`) with defaults. Exposes functions to update bindings, reset to defaults, and get the effective binding for a command.
  **Files**: Create `src/contexts/keybindings-context.tsx`
  **Acceptance**: `useKeybindings()` returns effective bindings. Calling `updateBinding` persists to localStorage. `resetToDefaults` clears overrides.

  API:
  ```ts
  interface KeybindingsContextValue {
    bindings: KeyBindingsConfig;                    // effective (merged) bindings
    updateBinding: (commandId: string, binding: Partial<KeyBinding>) => ConflictResult | null;
    resetBinding: (commandId: string) => void;      // reset single command
    resetToDefaults: () => void;                     // reset all
    hasCustomBindings: boolean;                      // true if user has any overrides
  }
  ```

  Implementation:
  - Use `usePersistedState<Partial<KeyBindingsConfig>>("weave:keybindings", {})` for user overrides.
  - Compute effective bindings: `mergeWithDefaults(userOverrides, DEFAULT_KEYBINDINGS)`.
  - `updateBinding` runs conflict detection before applying. Returns `ConflictResult` if conflict exists, `null` on success.
  - `resetToDefaults` clears the persisted state entirely.
  - `resetBinding` removes a single key from overrides.

  Provider placement in `client-layout.tsx`:
  ```
  SessionsProvider
    NotificationsProvider
      SidebarProvider
        KeybindingsProvider        ← NEW (Phase 2)
          CommandRegistryProvider   ← reads from KeybindingsProvider
            ...
  ```

- [ ] 14. **Wire keybindings context into command registry**
  **What**: Modify `CommandRegistryProvider` and the headless command registration components to read effective bindings from `useKeybindings()` instead of hardcoding `paletteHotkey` and `globalShortcut` values.
  **Files**:
    - Modify `src/contexts/command-registry-context.tsx` — read bindings from `useKeybindings()` when dispatching global shortcuts
    - Modify `src/components/commands/navigation-commands.tsx` — read `paletteHotkey` from bindings
    - Modify `src/components/commands/view-commands.tsx` — read `paletteHotkey` and `globalShortcut` from bindings
    - Modify `src/components/commands/session-commands.tsx` — read `paletteHotkey` from bindings
    - Modify `src/app/sessions/[id]/page.tsx` — read `paletteHotkey` from bindings for focus-prompt
    - Modify `src/app/client-layout.tsx` — add `<KeybindingsProvider>`
  **Acceptance**: Changing a binding via the keybindings context immediately updates the command's behavior in the palette and for global shortcuts. Hardcoded defaults still work when no overrides exist.

  Implementation approach:
  - Each headless command component calls `useKeybindings()` and spreads the effective binding into the `registerCommand` call.
  - The global shortcut dispatcher in `CommandRegistryProvider` already iterates `commands` — since commands now carry the user-configured bindings, no additional wiring is needed for dispatch.
  - When bindings change (user rebinds), the effect in the headless component re-runs: unregister old, register new.

- [ ] 15. **Build Keybindings Settings tab UI**
  **What**: Create a new settings tab that displays all commands with their current bindings and allows users to rebind them.
  **Files**:
    - Create `src/components/settings/keybindings-tab.tsx`
    - Modify `src/app/settings/page.tsx` — add "Keybindings" tab
  **Acceptance**: Settings shows all commands with current bindings. Users can click to rebind. Conflicts show inline warnings. "Reset to defaults" button works.

  UI design:
  - Table/list layout with columns: Command (icon + label), Palette Hotkey, Global Shortcut, Actions
  - Each binding cell is clickable → enters "recording" mode (shows "Press a key..." prompt)
  - Recording mode captures the next keypress and applies it
  - If conflict detected, show inline warning: "Conflicts with {other command label}" with option to override (swap) or cancel
  - "Reset" button per row restores that command's default
  - "Reset All to Defaults" button at the top resets everything
  - "Promote to Global" button on palette-only commands — allows adding a global shortcut (enters recording mode expecting modifier+key combo)

  Implementation:
  ```tsx
  export function KeybindingsTab() {
    const { bindings, updateBinding, resetBinding, resetToDefaults, hasCustomBindings } = useKeybindings();
    const { commands } = useCommandRegistry();
    // ... render table with rebind UI
  }
  ```

  Recording mode component:
  - Create a `KeyRecorder` sub-component that renders inline in the binding cell.
  - On mount, adds a `keydown` listener.
  - For palette hotkeys: captures single key (no modifiers), validates it's a printable char.
  - For global shortcuts: captures key + modifier (requires at least one modifier key), validates format.
  - Shows conflict warning if applicable.
  - Escape cancels recording.

  Group by category (Session, Navigation, View) matching the palette grouping.

- [ ] 16. **Add "Promote to Global Shortcut" UI**
  **What**: Allow palette-only commands to be promoted to global shortcuts via the Settings UI. User clicks "Add Global Shortcut" on a command that only has a palette hotkey, enters recording mode expecting modifier+key, and the binding is saved.
  **Files**: Modify `src/components/settings/keybindings-tab.tsx`
  **Acceptance**: User can add a global shortcut to "Go to Fleet" (which defaults to palette-only). The shortcut works globally after being set.

  Implementation:
  - Show an "Add" button in the Global Shortcut column when the current binding is `null`.
  - Clicking enters recording mode for global shortcut (requires modifier).
  - On capture, call `updateBinding(commandId, { globalShortcut: captured })`.
  - Conflict detection runs before saving.

- [ ] 17. **Phase 2 verification and unit tests**
  **What**: Write unit tests for keybinding utilities and verify the full user configuration flow.
  **Files**:
    - Add tests to `src/lib/__tests__/keybinding-utils.test.ts` (created in Task 12)
    - Manual verification of Settings UI
  **Acceptance**:
  - Unit tests pass for conflict detection, merging, formatting
  - Rebinding a palette hotkey in Settings changes its behavior in the palette
  - Rebinding a global shortcut in Settings changes which key combo fires the action
  - Conflict detection shows warning when two commands share a binding
  - "Reset to defaults" clears all custom bindings
  - Custom bindings survive page reload (localStorage)
  - Removing a global shortcut from a command works (set to null)
  - Promoting a palette-only command to global works
  - `npm run typecheck` passes
  - `npm run build` passes
  - `npm run test` passes

---

## Architecture Summary

### Phase 1 Component Tree
```
client-layout.tsx
├── SessionsProvider
│   └── NotificationsProvider
│       └── SidebarProvider
│           └── CommandRegistryProvider         ← owns command map + palette state + global shortcut dispatcher
│               ├── TooltipProvider
│               │   └── <div>
│               │       ├── <Sidebar />
│               │       └── <main>{children}</main>
│               ├── <NavigationCommands />      ← headless, registers on mount
│               ├── <ViewCommands />            ← headless, registers on mount
│               ├── <SessionCommands />         ← headless, registers + renders NewSessionDialog
│               └── <CommandPalette />          ← dialog, reads from registry
```

### Phase 2 Addition
```
client-layout.tsx
├── SessionsProvider
│   └── NotificationsProvider
│       └── SidebarProvider
│           └── KeybindingsProvider             ← NEW: owns user overrides + localStorage
│               └── CommandRegistryProvider
│                   ├── ... (same as Phase 1)
```

### File Summary

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `src/lib/command-registry.ts` | Create | 1 | Command type definitions |
| `src/contexts/command-registry-context.tsx` | Create | 1 | Registry provider + global shortcut dispatcher + palette state |
| `src/components/command-palette.tsx` | Create | 1 | Palette UI (dialog, groups, hotkey interception, badges) |
| `src/components/commands/navigation-commands.tsx` | Create | 1 | Registers Fleet/Settings/Alerts/History commands |
| `src/components/commands/view-commands.tsx` | Create | 1 | Registers Toggle Sidebar command |
| `src/components/commands/session-commands.tsx` | Create | 1 | Registers New Session + Refresh Sessions commands |
| `src/app/client-layout.tsx` | Modify | 1 | Add providers + mount headless components + CommandPalette |
| `src/contexts/sidebar-context.tsx` | Modify | 1 | Remove `useKeyboardShortcut` call (migrated to registry) |
| `src/components/session/new-session-dialog.tsx` | Modify | 1 | Accept controlled `open`/`onOpenChange` props |
| `src/components/session/prompt-input.tsx` | Modify | 1 | Forward ref for external focus |
| `src/app/sessions/[id]/page.tsx` | Modify | 1 | Register "Focus Prompt Input" command |
| `src/lib/keybinding-types.ts` | Create | 2 | Keybinding types + DEFAULT_KEYBINDINGS map |
| `src/lib/keybinding-utils.ts` | Create | 2 | Conflict detection, formatting, merging utilities |
| `src/lib/__tests__/keybinding-utils.test.ts` | Create | 2 | Unit tests for keybinding utilities |
| `src/contexts/keybindings-context.tsx` | Create | 2 | Persistence layer (localStorage via usePersistedState) |
| `src/components/settings/keybindings-tab.tsx` | Create | 2 | Settings UI for rebinding keys |
| `src/app/settings/page.tsx` | Modify | 2 | Add "Keybindings" tab |
| `src/contexts/command-registry-context.tsx` | Modify | 2 | Read effective bindings from KeybindingsProvider |
| `src/components/commands/navigation-commands.tsx` | Modify | 2 | Read bindings from context |
| `src/components/commands/view-commands.tsx` | Modify | 2 | Read bindings from context |
| `src/components/commands/session-commands.tsx` | Modify | 2 | Read bindings from context |
| `src/app/sessions/[id]/page.tsx` | Modify | 2 | Read bindings from context for focus-prompt |
| `src/app/client-layout.tsx` | Modify | 2 | Add KeybindingsProvider |

## Verification

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run build` completes successfully
- [ ] `npm run test` passes (existing + new tests)
- [ ] Manual: `Cmd+K` opens palette on all pages
- [ ] Manual: `Cmd+K` toggles palette closed when already open
- [ ] Manual: `Cmd+B` toggles sidebar (via registry)
- [ ] Manual: Palette hotkeys work (`N`, `F`, `S`, `A`, `H`, `B`, `R`, `/`)
- [ ] Manual: Palette hotkeys only fire when search is empty
- [ ] Manual: Fuzzy search filters commands correctly
- [ ] Manual: New Session dialog opens from palette
- [ ] Manual: Header "New Session" button still works
- [ ] Manual: "Focus Prompt Input" appears only on session page
- [ ] Manual: Escape closes palette
- [ ] Manual: No console errors or warnings
- [ ] Manual: Keybindings tab in Settings shows all commands (Phase 2)
- [ ] Manual: Rebinding works with conflict detection (Phase 2)
- [ ] Manual: Custom bindings persist across page reload (Phase 2)
- [ ] Manual: "Reset to Defaults" restores original bindings (Phase 2)

## Pitfalls & Mitigations

| Risk | Mitigation |
|------|-----------|
| Rules of hooks — can't dynamically call `useKeyboardShortcut` per command | Single `useEffect` with raw `keydown` listener iterating all commands |
| Palette hotkeys conflict with cmdk input | Only intercept when search input is empty; otherwise let cmdk handle filtering |
| `NewSessionDialog` refactor breaks header button | Controlled/uncontrolled pattern — existing trigger API unchanged |
| `Cmd+K` cannot close palette when `CommandInput` is focused | Handle `Cmd+K` close in `CommandInput`'s `onKeyDown` interceptor |
| Phase 2 binding changes not reflected until re-render | Headless command components re-register when bindings change (effect deps include bindings) |
| Conflict detection false positives on self-assignment | Exclude the command being edited from conflict checks |
| Key recording captures unintended keys (Tab, Shift alone) | Filter to printable characters for palette hotkeys; require at least one modifier for global shortcuts |
| SSR hydration — all state is client-only | All files use `"use client"` directive; providers are inside `ClientLayout`; `usePersistedState` handles SSR via `getServerSnapshot` |
| `PromptInput` ref forwarding breaks existing functionality | Use `React.forwardRef` wrapping — existing internal ref continues to work via `useImperativeHandle` or by merging refs |
