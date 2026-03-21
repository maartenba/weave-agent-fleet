# Icon Rail + Contextual Panel Sidebar Redesign

## TL;DR
> **Summary**: Redesign the sidebar from a single collapsible column to a VS Code-style two-column layout: a permanent 48px icon rail on the left with an adjacent collapsible contextual panel that shows content based on the active icon.
> **Estimated Effort**: Medium

## Context

### Original Request
Replace the current expand/collapse sidebar with a two-column layout:
- **Icon Rail** (~48px, always visible): Top icons for navigation views (Fleet, GitHub), bottom icons for page links (Integrations, Settings). Active icon has a left-border indicator. Clicking the active icon toggles the contextual panel.
- **Contextual Panel** (collapsible, resizable): Shows view-specific content (Fleet tree, GitHub placeholder, etc.). Replaces the old "expanded" state.

### Key Findings

**Current architecture (what we're changing):**
- `sidebar-context.tsx` tracks `collapsed: boolean` and `width: number` via `usePersistedState` (localStorage). Exports `SIDEBAR_COLLAPSED_WIDTH=64`, `SIDEBAR_MIN_WIDTH=180`, `SIDEBAR_MAX_WIDTH=480`, `SIDEBAR_DEFAULT_WIDTH=224`.
- `sidebar.tsx` (446 lines) is a single `<aside>` that conditionally renders collapsed (icon-only, 64px) or expanded (tree view, 180–480px). All tree content, footer links, resize handle, and branding live in one component.
- `use-sidebar-resize.ts` handles pointer-based drag resizing with min/max clamping. It's disabled when `collapsed=true`.
- `view-commands.tsx` wires `⌘B` to `toggleSidebar()` for expand/collapse.
- `client-layout.tsx` renders `<Sidebar />` beside `<main>` in a `flex h-screen` container.

**Components preserved as-is (no changes needed):**
- `sidebar-workspace-item.tsx` — Workspace tree items with context menus, inline rename, pin, terminate all.
- `sidebar-session-item.tsx` — Session tree items with context menus, status dots, inline rename.
- `new-session-dialog.tsx` — Dialog triggered from sidebar.
- `use-sidebar-resize.ts` — Reused for the contextual panel resize (just needs the offset adjusted).

**Consumers of sidebar context:**
- `sidebar.tsx` — primary consumer of all context values
- `view-commands.tsx` — calls `toggleSidebar()` (wired to `⌘B`)

## Objectives

### Core Objective
Transform the sidebar into a two-column icon-rail + contextual-panel layout while preserving all existing functionality (tree navigation, context menus, keyboard nav, resize, new session, integrations/settings links).

### Deliverables
- [x] Sidebar context extended with `activeView` state and new `panelOpen` semantics
- [x] Icon rail component (always visible, 48px)
- [x] Contextual panel component (collapsible, resizable)
- [x] Fleet panel content (extracted from current sidebar)
- [x] GitHub panel placeholder
- [x] Updated resize behavior (resizes contextual panel, not entire sidebar)
- [x] Preserved ⌘B toggle behavior
- [x] CSS variables for icon rail theming
- [x] ARIA roles for accessibility

### Definition of Done
- [x] Icon rail is always visible at 48px wide
- [x] Clicking Fleet icon shows Fleet tree in contextual panel
- [x] Clicking GitHub icon shows GitHub placeholder in contextual panel
- [x] Clicking active icon toggles contextual panel open/closed
- [x] Integrations and Settings icons in rail bottom navigate to their pages (not panels)
- [x] Active icon has a visible left-border indicator
- [x] Contextual panel is resizable between min/max width
- [x] ⌘B toggles the contextual panel
- [x] All tree navigation, context menus, keyboard nav, inline rename still work
- [x] Version info shown as tooltip on rail bottom
- [x] `npm run build` succeeds with no type errors
- [x] All 9 themes render correctly
- [x] localStorage state persists across page reloads
- [x] Upgrade from old localStorage state works (migration)
- [x] No accessibility regressions (screen reader, keyboard nav)
