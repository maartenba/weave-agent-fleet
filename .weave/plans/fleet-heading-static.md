# Make Fleet Sidebar Heading Non-Collapsible

## TL;DR
> **Summary**: Remove the expand/collapse mechanism from the "Fleet" heading in the sidebar so it becomes a static heading with session groups always visible.
> **Estimated Effort**: Quick

## Context
### Original Request
The "Fleet" heading in the sidebar is currently a collapsible section (using Radix `Collapsible`). The user wants it to be a plain, always-visible heading with the workspace tree always rendered below it.

### Key Findings
All changes are isolated to **one file**: `src/components/layout/sidebar.tsx`.

**Current mechanism (lines 241–317):**
- `Collapsible` wraps the entire Fleet section (line 241)
- `CollapsibleTrigger` renders a `<button>` with a `ChevronRight` icon that rotates 90° when expanded (lines 252–264)
- `CollapsibleContent` wraps the workspace tree and applies open/close animations (line 288)
- State: `fleetExpanded` via `usePersistedState` hook, persisted to `localStorage` key `"weave:sidebar:fleet-expanded"` (lines 42, 57–60)

**Things to remove:**
1. `FLEET_EXPANDED_KEY` constant (line 42)
2. `fleetExpanded` / `setFleetExpanded` state hook call (lines 57–60)
3. `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` wrappers (lines 241, 252–264, 288, 316–317)
4. `ChevronRight` icon import (line 8) — used only for the Fleet chevron
5. Collapsible import (lines 20–23) — only used for Fleet in this file

**Things to keep:**
- The heading `<div>` with "Fleet" text, `LayoutGrid` icon, session count badge, and `<Link href="/">`
- The workspace tree `<div ref={treeRef}>` and its contents
- The collapsed sidebar mode (icon-only) — untouched

**No other files reference `fleetExpanded` or `FLEET_EXPANDED_KEY`.**

## Objectives
### Core Objective
Replace the collapsible Fleet section with a static heading + always-visible workspace tree.

### Deliverables
- [ ] Fleet heading is always visible (not toggleable)
- [ ] Workspace tree is always rendered (no collapse animation)
- [ ] Chevron icon removed from Fleet heading
- [ ] Dead code cleaned up (state, constant, imports)

### Definition of Done
- [ ] `npm run build` succeeds with no errors
- [ ] Sidebar renders Fleet heading and workspace tree without collapse/expand behavior
- [ ] No `ChevronRight` or `Collapsible` references remain in `sidebar.tsx`
- [ ] `localStorage` key `weave:sidebar:fleet-expanded` is no longer written

### Guardrails (Must NOT)
- Do NOT change the collapsed sidebar mode (icon-only view)
- Do NOT change workspace item expand/collapse (those are separate `Collapsible` instances in `sidebar-workspace-item.tsx`)
- Do NOT remove the `Collapsible` UI component itself — it's used elsewhere

## TODOs

- [ ] 1. **Remove collapsible state and constant**
  **What**: Delete `FLEET_EXPANDED_KEY` constant (line 42) and the `usePersistedState` call for `fleetExpanded`/`setFleetExpanded` (lines 57–60).
  **Files**: `src/components/layout/sidebar.tsx`
  **Acceptance**: No references to `fleetExpanded`, `setFleetExpanded`, or `FLEET_EXPANDED_KEY` in the file.

- [ ] 2. **Replace Collapsible wrapper with static markup**
  **What**: In the expanded sidebar branch (lines 240–318), replace the `<Collapsible>` / `<CollapsibleTrigger>` / `<CollapsibleContent>` wrappers with plain `<div>` elements (or remove the wrappers entirely since the heading `<div>` and tree `<div>` can stand on their own). Specifically:
  - Remove `<Collapsible open={fleetExpanded} onOpenChange={setFleetExpanded}>` (line 241) and its closing tag (line 317) — replace with a fragment `<>...</>` or just remove the wrapper.
  - Remove the `<CollapsibleTrigger asChild>` button block (lines 252–264) — this is the chevron toggle button.
  - Remove `<CollapsibleContent className="...">` (line 288) and its closing tag (line 316) — the workspace tree `<div>` inside it stays, just unwrapped.
  - Adjust the heading `<div>` padding/gap since the chevron column is gone — the `gap-3` and `px-3` on the heading div (line 245) stay, but the left alignment will shift since the chevron button occupied space. The `LayoutGrid` icon at line 273 takes over as the leading element (already present), so no layout change needed beyond removing the chevron button.
  **Files**: `src/components/layout/sidebar.tsx`
  **Acceptance**: No `Collapsible`, `CollapsibleTrigger`, or `CollapsibleContent` elements in the Fleet section. Workspace tree renders unconditionally.

- [ ] 3. **Clean up imports**
  **What**: Remove unused imports:
  - `ChevronRight` from `lucide-react` (line 8) — only used for Fleet chevron
  - `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible` (lines 20–23)
  - `usePersistedState` from `@/hooks/use-persisted-state` (line 32) — only used for `fleetExpanded` in this file
  **Files**: `src/components/layout/sidebar.tsx`
  **Acceptance**: No unused imports. `npm run build` produces no "unused import" warnings for this file.

- [ ] 4. **Remove keyboard nav references to Fleet collapse (if any)**
  **What**: Review the `handleTreeKeyDown` handler (lines 94–177) — it references `aria-expanded` attributes on `treeitem` elements, but those are for workspace items, not Fleet. Confirm no changes needed. The handler operates on `[role='treeitem']` elements which are workspace items, not the Fleet heading.
  **Files**: `src/components/layout/sidebar.tsx`
  **Acceptance**: Keyboard navigation still works for workspace items. No dead references.

## Verification
- [ ] `npm run build` completes without errors
- [ ] No regressions — sidebar renders correctly in both expanded and collapsed modes
- [ ] Fleet heading shows "Fleet" text, LayoutGrid icon, and session count badge
- [ ] Workspace tree is always visible (never hidden behind a toggle)
- [ ] Workspace items within the tree still expand/collapse independently
