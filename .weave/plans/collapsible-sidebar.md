# Collapsible Sidebar

## TL;DR
> **Summary**: Add a collapsible sidebar that toggles between full-width (224px) with icons+text and a narrow strip (64px) with icon-only mode, persisted to localStorage, with keyboard shortcut and tooltips.
> **Estimated Effort**: Medium

## Context
### Original Request
Design a collapsible sidebar that can toggle between expanded (icons + text, 224px) and collapsed (icons only, 64px) states with smooth transitions, localStorage persistence, tooltips, and a keyboard shortcut.

### Key Findings

**Current sidebar structure** (`src/components/layout/sidebar.tsx`):
- Fixed `w-56` (224px) `<aside>` with `flex h-screen flex-col`
- Three sections: branding header (logo + "Weave" text), nav body (Fleet tree, Alerts, History), and footer (Settings)
- Fleet section uses Radix `Collapsible` with `usePersistedState` for expand/collapse of the workspace tree
- Nav items use a consistent pattern: `flex items-center gap-3 rounded-md px-3 py-2 text-sm` with a Lucide icon + `<span>` label
- Icons are all `h-4 w-4` Lucide components: `LayoutGrid`, `Bell`, `History`, `Settings`
- Badges appear on Fleet (session count) and Alerts (unread count)

**Layout integration** (`src/app/client-layout.tsx`):
- `<div className="flex h-screen overflow-hidden">` wraps `<Sidebar />` + `<main className="flex-1 overflow-auto">`
- `TooltipProvider` with `delayDuration={0}` already wraps everything
- `SessionsProvider` is the outermost context

**`usePersistedState` hook** (`src/hooks/use-persisted-state.ts`):
- Already exists, SSR-safe (checks `typeof window`), supports updater functions
- Used for fleet expanded state and pinned workspaces — perfect for sidebar collapsed state

**Tooltip components** (`src/components/ui/tooltip.tsx`):
- Already fully implemented using `radix-ui` (v1.4.3 — the new unified package)
- Exports `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`
- Already used in `sidebar-workspace-item.tsx` for workspace path tooltips
- `TooltipProvider` is already in `client-layout.tsx` with `delayDuration={0}`

**Child components**:
- `sidebar-workspace-item.tsx`: Complex component with context menus, inline editing, collapsible tree — entirely hidden when sidebar is collapsed
- `sidebar-session-item.tsx`: Leaf items inside workspace tree — also hidden when collapsed

**Existing patterns**:
- Transitions use Tailwind classes: `transition-colors`, `transition-transform duration-150`, `transition-all`
- No custom CSS animations — all Tailwind utility-based
- No existing keyboard shortcut hook — will need a simple `useEffect` with `keydown`
- No existing sidebar context — will create one

**No tailwind config file** found — using default Tailwind v4 (CSS-based config via `globals.css`). The `transition-all duration-200` utility classes work out of the box.

## Objectives
### Core Objective
Add a toggleable collapsed state to the sidebar that shows icon-only navigation at 64px width, with smooth transitions and persistent state.

### Deliverables
- [x] `SidebarContext` for collapse state management
- [x] Collapsible sidebar with smooth width transition
- [x] Icon-only mode with Radix tooltips when collapsed
- [x] Toggle button in the sidebar
- [x] `Cmd+B` / `Ctrl+B` keyboard shortcut
- [x] localStorage persistence of collapsed state
- [x] Main content area smoothly fills freed space

### Definition of Done
- [x] Sidebar toggles between 224px and 64px with smooth animation
- [x] Collapsed mode shows only icons for Fleet, Alerts, History, Settings
- [x] Hovering icons in collapsed mode shows tooltip with label text
- [x] Collapsed state survives page refresh (localStorage)
- [x] `Cmd+B` (macOS) / `Ctrl+B` (other) toggles sidebar
- [x] Fleet workspace tree is hidden when collapsed
- [x] Toggle button is visible and accessible
- [x] Keyboard navigation still works for the 4 main nav items when collapsed
- [x] No layout shift — main content smoothly expands/contracts
- [x] Build passes with no TypeScript errors

### Guardrails (Must NOT)
- Must NOT change existing component APIs or break existing functionality
- Must NOT introduce custom CSS files — use Tailwind utilities only
- Must NOT add new npm dependencies (Radix Tooltip and all needed utilities are already installed)
- Must NOT break SSR — collapsed state initialization must handle `typeof window === "undefined"`

## TODOs

- [x] 1. **Create `SidebarContext`**
  **What**: Create a React Context that exposes `collapsed: boolean` and `toggleSidebar: () => void` so any child component can read/react to the sidebar state. Use `usePersistedState` internally with key `"weave:sidebar:collapsed"` and default `false`.
  **Files**: Create `src/contexts/sidebar-context.tsx`
  **Details**:
  - Define `SidebarContextValue` interface: `{ collapsed: boolean; setCollapsed: (v: boolean) => void; toggleSidebar: () => void }`
  - `SidebarProvider` component uses `usePersistedState<boolean>("weave:sidebar:collapsed", false)`
  - Export `useSidebar()` hook that calls `useContext(SidebarContext)` with a meaningful error if used outside provider
  - Mark as `"use client"`
  **Acceptance**: Context file exists, exports `SidebarProvider` and `useSidebar`, compiles without errors.

- [x] 2. **Create `useKeyboardShortcut` hook**
  **What**: Create a reusable keyboard shortcut hook that registers a global `keydown` listener for `Cmd+B` / `Ctrl+B` to toggle the sidebar. Extracted as a generic hook for reuse.
  **Files**: Create `src/hooks/use-keyboard-shortcut.ts`
  **Details**:
  - Signature: `useKeyboardShortcut(key: string, callback: () => void, options?: { metaKey?: boolean; ctrlKey?: boolean })` 
  - Use `useEffect` to add/remove `keydown` listener on `document`
  - For the sidebar shortcut: listen for `key === "b"` with `metaKey` (macOS) or `ctrlKey` (other platforms)
  - Call `e.preventDefault()` to avoid browser default behavior (e.g., Chrome's bookmark shortcut won't conflict since `Cmd+B` is bold in text editors, not a Chrome shortcut)
  - Skip if focus is inside an `<input>`, `<textarea>`, or `[contenteditable]` to avoid interfering with text editing
  - Mark as `"use client"`
  **Acceptance**: Hook compiles, can be imported and called. Pressing `Cmd+B` triggers the callback when no text input is focused.

- [x] 3. **Integrate `SidebarProvider` into `ClientLayout`**
  **What**: Wrap the layout with `SidebarProvider` so `Sidebar` and any other component can access the collapsed state.
  **Files**: Modify `src/app/client-layout.tsx`
  **Details**:
  - Import `SidebarProvider` from `@/contexts/sidebar-context`
  - Wrap inside `SessionsProvider` (or alongside — order with `TooltipProvider` doesn't matter since they're independent): `<SessionsProvider><SidebarProvider><TooltipProvider>...`
  - No changes to the `<main>` element needed here — the transition will be handled by the sidebar width change and flexbox naturally
  **Acceptance**: `SidebarProvider` wraps the layout, app renders without errors.

- [x] 4. **Update `Sidebar` component for collapse/expand**
  **What**: Modify the sidebar component to read `collapsed` from `useSidebar()`, adjust its width, conditionally render text labels, add tooltips, hide the Fleet tree when collapsed, and add the toggle button.
  **Files**: Modify `src/components/layout/sidebar.tsx`
  **Details**:

  **4a. Width and transition on `<aside>`**:
  - Replace `w-56` with dynamic: `cn("flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ease-in-out", collapsed ? "w-16" : "w-56")`
  - Add `overflow-hidden` to prevent content from spilling during transition

  **4b. Branding header (collapsed)**:
  - When collapsed: hide the `<div>` containing "Weave" / "Agent Fleet" text. Show only the logo image centered.
  - Wrap in a conditional: `{!collapsed && <div>...<h1>Weave</h1>...</div>}`
  - When collapsed, center the logo: `className={cn("flex items-center border-b border-sidebar-border px-4 py-4", collapsed ? "justify-center" : "gap-3")}`

  **4c. Nav items — Fleet header**:
  - When collapsed: hide the chevron, the "Fleet" text `<span>`, and the session count `<Badge>`
  - Show only the `LayoutGrid` icon, centered
  - Wrap the `LayoutGrid` icon in `<Tooltip>` + `<TooltipTrigger>` / `<TooltipContent side="right">Fleet</TooltipContent>` (tooltip only active when collapsed)
  - The Fleet row becomes a simple icon button linking to `/` when collapsed
  - The entire `<Collapsible>` wrapper (workspace tree) is hidden when collapsed — replaced with just the icon link
  - When collapsed, adjust padding: `px-3 py-2` → `justify-center py-2 px-0` (icon centered in 64px strip)

  **4d. Nav items — Alerts, History**:
  - When collapsed: hide `<span>` text and `<Badge>` (for Alerts)
  - Wrap icon in tooltip: `<Tooltip><TooltipTrigger asChild><Link ...><Bell /></Link></TooltipTrigger><TooltipContent side="right">Alerts</TooltipContent></Tooltip>`
  - Adjust link styling when collapsed: remove `gap-3`, add `justify-center`
  - For Alerts unread badge when collapsed: show a small dot indicator on the icon instead (a tiny absolute-positioned `<span>` with `bg-destructive rounded-full h-2 w-2`) — OR simply hide badge and rely on tooltip. **Decision**: show a small red dot on the Bell icon when `unreadCount > 0` and sidebar is collapsed, for at-a-glance visibility.

  **4e. Footer — Settings**:
  - Same pattern as Alerts/History: hide text when collapsed, add tooltip, center icon
  
  **4f. Toggle button**:
  - Add a toggle button at the very bottom of the sidebar (below the Settings link, inside the footer `<div>`)
  - Use `PanelLeftClose` icon (from Lucide) when expanded, `PanelLeftOpen` when collapsed — these are purpose-built icons for this exact UX
  - Style: `flex items-center justify-center rounded-md py-2 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors`
  - When expanded: show icon + "Collapse" text (matching the nav item pattern)
  - When collapsed: show only icon, with tooltip "Expand sidebar"
  - `onClick={() => toggleSidebar()}`
  - Accessible: `aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}`

  **4g. Keyboard shortcut integration**:
  - Call `useKeyboardShortcut("b", toggleSidebar, { metaKey: true, ctrlKey: true })` inside the `Sidebar` component (or inside `SidebarProvider` — **Decision**: put it in `SidebarProvider` so it works globally regardless of focus location)

  **4h. Keyboard navigation when collapsed**:
  - The `treeRef` and `handleTreeKeyDown` only apply when the Fleet tree is visible (expanded sidebar). When collapsed, the 4 nav items (Fleet, Alerts, History, Settings) are just links — standard tab navigation works.
  - No special keyboard nav code needed for collapsed state.

  **Acceptance**: 
  - Sidebar renders at 64px when collapsed, 224px when expanded
  - Smooth 200ms transition between states
  - Icons centered and tooltips visible on hover when collapsed
  - Toggle button works, keyboard shortcut works
  - Fleet tree hidden when collapsed
  - Branding shows logo-only when collapsed

- [x] 5. **Handle `sidebar-session-item.tsx` visibility**
  **What**: Ensure session items don't render/appear when sidebar is collapsed. Since the entire Fleet `<Collapsible>` section (including `<SidebarWorkspaceItem>` which contains `<SidebarSessionItem>`) is conditionally hidden when collapsed (replaced by just the Fleet icon), **no changes needed** to these files. The parent component (`sidebar.tsx`) handles this by not rendering the `<Collapsible>` tree at all.
  **Files**: No changes to `src/components/layout/sidebar-workspace-item.tsx` or `src/components/layout/sidebar-session-item.tsx`
  **Acceptance**: Verify these components are simply not rendered when sidebar is collapsed.

- [x] 6. **Add visual polish and edge cases**
  **What**: Handle edge cases and polish the implementation.
  **Files**: Modify `src/components/layout/sidebar.tsx`
  **Details**:
  - **Overflow during transition**: The `overflow-hidden` on `<aside>` prevents text from wrapping awkwardly during the 200ms width animation. Text labels should use `whitespace-nowrap` to avoid wrapping during transition: add `whitespace-nowrap` to `<nav>` or each nav item.
  - **Badge dot in collapsed mode**: For the Alerts icon when `unreadCount > 0` and sidebar is collapsed, add a `relative` wrapper around `<Bell>` with `<span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />` to show a notification dot.
  - **Keyboard shortcut hint**: On the toggle button tooltip (when collapsed), show "Expand sidebar (⌘B)". On the expanded toggle button text, show as a small `<kbd>` or just keep it simple with no hint in the label.
  - **Transition for text opacity**: For extra polish, text labels can fade out during collapse with `transition-opacity duration-150`. When collapsed, apply `opacity-0` and when expanded `opacity-100`. However, since we're conditionally rendering (`{!collapsed && ...}`), a simpler approach is fine — the `overflow-hidden` + width transition handles visual smoothness.
  
  **Acceptance**: No visual glitches during transition, notification dot visible on collapsed Alerts icon.

- [x] 7. **Test the feature manually**
  **What**: Verify all acceptance criteria through manual testing.
  **Files**: No files — testing checklist.
  **Details**:
  - Click toggle button → sidebar collapses to 64px with smooth animation
  - Click toggle button again → sidebar expands to 224px
  - Hover each icon when collapsed → tooltip shows correct label
  - Refresh page → collapsed state persists
  - Press `Cmd+B` → sidebar toggles
  - Press `Ctrl+B` → sidebar toggles (on non-Mac)
  - Type in a text input, press `Cmd+B` → sidebar does NOT toggle
  - Navigate to each page (Fleet, Alerts, History, Settings) → correct active state styling
  - Expand sidebar → Fleet tree is visible and functional as before
  - Main content area fills available space in both states
  - No TypeScript errors: `npx tsc --noEmit`
  - Build succeeds: `npm run build`
  **Acceptance**: All items pass.

## Implementation Notes

### File Change Summary
| File | Action | Description |
|------|--------|-------------|
| `src/contexts/sidebar-context.tsx` | **Create** | SidebarContext + SidebarProvider + useSidebar hook |
| `src/hooks/use-keyboard-shortcut.ts` | **Create** | Reusable keyboard shortcut hook |
| `src/app/client-layout.tsx` | **Modify** | Wrap with SidebarProvider |
| `src/components/layout/sidebar.tsx` | **Modify** | Main implementation — conditional rendering, tooltips, toggle button, width transition |

### Dependencies
- Task 1 (Context) and Task 2 (Keyboard hook) are independent — can be done in parallel
- Task 3 (Layout integration) depends on Task 1
- Task 4 (Sidebar changes) depends on Tasks 1, 2, and 3
- Task 5 is a no-op verification
- Task 6 depends on Task 4
- Task 7 depends on all previous tasks

### Architectural Decisions
1. **Context over prop-drilling**: Collapse state in context because child components (workspace items) may need to know they're collapsed in the future, and the keyboard shortcut needs access from a global scope.
2. **Keyboard shortcut in SidebarProvider**: Rather than in the Sidebar component itself, to ensure it works regardless of which component tree has focus.
3. **Conditional rendering over CSS hiding**: Using `{!collapsed && <span>...}` instead of CSS `hidden` / `sr-only` because it's cleaner and the items genuinely shouldn't be in the DOM when collapsed (prevents tab navigation to hidden elements).
4. **`overflow-hidden` + `whitespace-nowrap`**: The key to smooth visual transitions — prevents text reflow during width animation.
5. **No changes to child components**: The sidebar component itself controls what renders, so workspace/session item components don't need to know about collapsed state.

## Verification
- [x] `npx tsc --noEmit` passes with no errors
- [x] `npm run build` succeeds
- [x] Sidebar toggles smoothly between collapsed (64px) and expanded (224px)
- [x] Collapsed state persists across page refreshes
- [x] `Cmd+B` / `Ctrl+B` keyboard shortcut works
- [x] Tooltips appear on hover for all icons when collapsed
- [x] Fleet tree is hidden when sidebar is collapsed
- [x] No regressions to existing sidebar functionality when expanded
