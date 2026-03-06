# Fix Directory Picker Mouse Scroll Wheel Bug

> **GitHub Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/64

## TL;DR
> **Summary**: Mouse wheel scrolling doesn't work in the directory picker's CommandList. Fix by adding an explicit `onWheel` handler to the CommandList in `directory-picker.tsx` that programmatically scrolls the container.
> **Estimated Effort**: Quick

## Context

### Original Request
In the directory picker (used when creating a new session), keyboard arrow keys work for scrolling through the directory list, but the mouse scroll wheel does NOT work. The scrollbar is visible and keyboard navigation works, but wheel events don't reach the scrollable container.

### Key Findings

1. **cmdk's CommandList DOM structure**: Renders as `<div cmdk-list overflow-y-auto>` → `<div cmdk-list-sizer>` → children. The outer `cmdk-list` div is the scroll container with `max-h-[250px] overflow-y-auto`. Keyboard scrolling works because cmdk calls `scrollIntoView({ block: "nearest" })` on the selected item — it never relies on native scroll.

2. **Parent `overflow-hidden`**: The `Command` wrapper component applies `overflow-hidden` (command.tsx line 24). This is standard cmdk behavior but combined with Radix Popover's Portal rendering (which places content in a separate DOM layer), it can cause the browser to not properly route wheel events to the inner scrollable div.

3. **Radix Popover Portal**: `PopoverContent` renders via `PopoverPrimitive.Portal`, placing the content at the document root. The Popover doesn't explicitly block wheel events, but Portal-rendered content can exhibit scroll event routing issues in some browsers/contexts, especially when nested inside a Sheet (as this component is — the `NewSessionDialog` uses a `Sheet`).

4. **The Sheet → Popover → Command nesting**: The directory picker lives inside a `Sheet` (new-session-dialog.tsx). The Sheet's content overlay + Popover's Portal + Command's overflow-hidden creates a complex layering where native scroll event delivery to the inner `overflow-y-auto` div can fail.

5. **Other CommandList usages**: `CommandPalette` uses `CommandDialog` (which uses a Dialog, not a Popover) — may or may not have the same issue but is less noticeable since it has fewer items. `AutocompletePopup` renders directly in the DOM (no Portal) so it doesn't hit this issue.

6. **ScrollArea pattern**: The app uses Radix ScrollArea elsewhere (activity-stream, diff-viewer, session page) which handles all input methods correctly. However, wrapping CommandList in ScrollArea would create competing scroll containers.

### Approach Analysis

| Approach | Pros | Cons | Risk |
|----------|------|------|------|
| **A: Wrap in ScrollArea** | Consistent with app patterns; nice scrollbar styling | Two competing scroll containers; may break cmdk keyboard nav; complex DOM nesting | High |
| **B: Add `onWheel` handler** | Surgical fix; no DOM changes; preserves cmdk keyboard nav; isolated to directory-picker | Feels like a workaround; doesn't add styled scrollbar | Low |
| **C: Modify CommandList in command.tsx** | "Correct" fix at the component level | Affects all 3 CommandList usages (palette, autocomplete, directory picker); higher regression risk | Medium |

**Chosen approach: Option B** — Add an explicit `onWheel` handler to the `CommandList` in `directory-picker.tsx` only. This is the lowest-risk fix that solves the problem without affecting other components. The handler captures the wheel event and programmatically adjusts `scrollTop` on the `cmdk-list` container.

## Objectives

### Core Objective
Enable mouse wheel scrolling in the directory picker's file list while preserving keyboard navigation.

### Deliverables
- [ ] Mouse wheel scrolling works in the directory picker dropdown
- [ ] Keyboard arrow navigation continues to work
- [ ] No regressions in other CommandList usages (CommandPalette, AutocompletePopup)

### Definition of Done
- [ ] Open new session dialog → click browse → populate list with enough items to scroll → mouse wheel scrolls the list
- [ ] Arrow keys still navigate items and scroll them into view
- [ ] CommandPalette (⌘K) still works correctly
- [ ] Build passes: `npm run build`

### Guardrails (Must NOT)
- Do NOT modify `src/components/ui/command.tsx` — the fix is scoped to the directory picker only
- Do NOT replace CommandList with ScrollArea — the two would conflict
- Do NOT break cmdk's keyboard navigation or item selection

## TODOs

- [ ] 1. Add a ref to the CommandList element in `directory-picker.tsx`
  **What**: Create a `React.useRef<HTMLDivElement>` and attach it to the `<CommandList>` component. The `CommandList` forwards refs to its underlying `cmdk-list` div (confirmed from cmdk source — it uses `forwardRef`).
  **Files**: `src/components/session/directory-picker.tsx`
  **Acceptance**: Ref is attached; no runtime errors.

- [ ] 2. Add an `onWheel` event handler to CommandList
  **What**: Add an `onWheel` handler to the `<CommandList>` element that programmatically scrolls the container. The handler should:
  - Access the `cmdk-list` div via the ref
  - Apply `event.deltaY` to `ref.current.scrollTop`
  - Call `event.preventDefault()` only when the list can actually scroll in the requested direction (to avoid blocking page scroll when at bounds)
  
  Implementation:
  ```tsx
  const listRef = useRef<HTMLDivElement>(null);
  
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el) return;
    
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    
    // Only preventDefault when we can scroll in the requested direction
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
      e.preventDefault();
    }
    
    el.scrollTop += e.deltaY;
  };
  ```
  
  Then on the CommandList:
  ```tsx
  <CommandList 
    ref={listRef} 
    className="max-h-[250px]" 
    onWheel={handleWheel}
  >
  ```
  
  **Files**: `src/components/session/directory-picker.tsx`
  **Acceptance**: Mouse wheel scrolls the directory list up/down. Scrolling stops at bounds. Page doesn't scroll when the list can scroll.

- [ ] 3. Verify keyboard navigation still works
  **What**: Manually test that arrow keys still navigate items in the directory list and `scrollIntoView` still fires (cmdk handles this internally — our change doesn't interfere since we only handle `onWheel`, not keyboard events).
  **Files**: No file changes — manual verification
  **Acceptance**: Up/Down arrow keys navigate items; selected item scrolls into view.

- [ ] 4. Verify no regressions in other CommandList consumers
  **What**: Test that CommandPalette (⌘K) and autocomplete popup (type `/` or `@` in prompt) still work correctly. These components don't share any code with our fix since we only modified `directory-picker.tsx`.
  **Files**: No file changes — manual verification
  **Acceptance**: CommandPalette opens, navigates, and selects items. Autocomplete popup works.

## Verification
- [ ] Mouse wheel scrolls directory list in the picker popover
- [ ] Keyboard arrows still navigate the list
- [ ] `npm run build` passes with no errors
- [ ] CommandPalette and autocomplete popup unaffected
- [ ] No TypeScript errors introduced
