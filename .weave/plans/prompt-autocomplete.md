# Prompt Autocomplete — Slash Commands & Reference Mentions

## TL;DR
> **Summary**: Add autocomplete functionality to the prompt input that triggers on `/` (slash commands) and `@` (file/agent references), using a shared popup component backed by new API routes that proxy OpenCode SDK calls for commands, file search, and agents.
> **Estimated Effort**: Large

## Context
### Original Request
Add autocomplete to the session prompt input. When user types `/` at the start, show available commands from the OpenCode SDK. When user types `@` anywhere, show files and agents. Both share a common popup UI with keyboard navigation, filtering, and mouse selection.

### Key Findings
1. **Current prompt input** (`src/components/session/prompt-input.tsx`) is a bare `<Input>` (shadcn/ui) with simple `value`/`onChange` state. No autocomplete, no special key handling beyond form submission. 72 lines total.
2. **SDK client shape** — The `OpencodeClient` exposes exactly the methods we need:
   - `client.command.list()` → `Array<Command>` where `Command = { name, description?, agent?, model?, template, subtask? }`
   - `client.find.files({ query: { query, dirs? } })` → `Array<string>` (file paths)
   - `client.app.agents()` → `Array<Agent>` where `Agent = { name, description?, mode, builtIn, color?, ... }`
3. **SDK is server-only** — clients live in `process-manager.ts`, accessed via `getClientForInstance(instanceId)`. The browser needs API route proxies.
4. **Existing API route pattern** — All routes use `NextRequest`/`NextResponse`, accept `instanceId` as body field or query param, call `getClientForInstance()`, and return JSON. See `src/app/api/sessions/[id]/prompt/route.ts` for canonical pattern.
5. **Existing hooks pattern** — Client hooks use `useState`/`useCallback`, call `fetch()` to API routes, handle errors consistently. See `use-create-session.ts` and `use-send-prompt.ts`.
6. **No existing overlay components for autocomplete** — The project has DropdownMenu, ContextMenu, Sheet, Tooltip (all Radix). No Popover, Command/cmdk, or Combobox. We need to install `cmdk` (via shadcn) for the autocomplete popup.
7. **Session page** (`src/app/sessions/[id]/page.tsx`) passes `instanceId` and `sessionId` to `<PromptInput>` via the `handleSend` callback. For autocomplete, the PromptInput will also need `instanceId` to fetch commands/files/agents.
8. **`api-types.ts`** defines shared request/response types between API routes and hooks.
9. **`FindFilesData` query shape** — `{ query: string, dirs?: "true" | "false", directory?: string }` at URL `/find/file`. Returns `Array<string>`.
10. **`CommandListData`** — no required query params, URL `/command`. Returns `Array<Command>`.
11. **`AppAgentsData`** — no required query params, URL `/agent`. Returns `Array<Agent>`.

## Objectives
### Core Objective
Enable `/` slash-command autocomplete and `@` reference autocomplete in the session prompt input, powered by OpenCode SDK data fetched through new API routes.

### Deliverables
- [x] Three new API routes: commands, file search, agents
- [x] Shared autocomplete types in `api-types.ts`
- [x] React hooks for fetching autocomplete data (`useCommands`, `useFindFiles`, `useAgents`)
- [x] A shared `AutocompletePopup` component using cmdk
- [x] A `useAutocomplete` hook for trigger detection, cursor tracking, and keyboard handling
- [x] Modified `PromptInput` integrating the autocomplete system
- [x] Updated session page to pass `instanceId` to PromptInput

### Definition of Done
- [x] Typing `/` at start of empty input opens command autocomplete popup
- [x] Typing `@` anywhere in input opens reference autocomplete popup (files + agents)
- [x] Arrow keys navigate items, Enter selects, Escape dismisses
- [x] Mouse click selects an item
- [x] File search is debounced (300ms)
- [x] Commands and agents are fetched once per session (cached)
- [x] Empty states and loading states render gracefully
- [x] No TypeScript errors: `npx tsc --noEmit` passes
- [x] Dev server runs without errors: `npm run dev`
- [x] Existing prompt send behavior is unchanged

### Guardrails (Must NOT)
- Must not break the existing prompt send flow
- Must not call SDK client from the browser (all SDK calls go through API routes)
- Must not modify `process-manager.ts` or `opencode-client.ts`
- Must not modify the SSE event pipeline or `event-state.ts`
- Must not change any existing API route behavior

## TODOs

### Phase 1: Foundation — API Routes & Types

- [x] 1. **Add autocomplete types to api-types.ts**
  **What**: Define shared types for autocomplete API responses. Keep them simple — map closely to SDK types but expose only what the UI needs.
  ```ts
  // Autocomplete item types
  interface AutocompleteCommand { name: string; description?: string; }
  interface AutocompleteAgent { name: string; description?: string; mode: string; color?: string; }
  // File search returns Array<string> from SDK, no wrapper needed
  ```
  **Files**: `src/lib/api-types.ts` (modify — append new interfaces)
  **Acceptance**: Types compile, no existing type breakage

- [x] 2. **Create commands API route**
  **What**: `GET /api/instances/[id]/commands` — proxies `client.command.list()`. Accepts instance ID as path param. Returns `Array<AutocompleteCommand>`. Follow existing route patterns (error handling, `getClientForInstance()`).
  **Files**: `src/app/api/instances/[id]/commands/route.ts` (new)
  **Acceptance**: `curl http://localhost:3000/api/instances/<id>/commands` returns JSON array of commands

- [x] 3. **Create agents API route**
  **What**: `GET /api/instances/[id]/agents` — proxies `client.app.agents()`. Returns `Array<AutocompleteAgent>`. Same pattern as commands route.
  **Files**: `src/app/api/instances/[id]/agents/route.ts` (new)
  **Acceptance**: `curl http://localhost:3000/api/instances/<id>/agents` returns JSON array of agents

- [x] 4. **Create file search API route**
  **What**: `GET /api/instances/[id]/find/files?query=<q>` — proxies `client.find.files({ query: { query } })`. The `query` param is required and must be non-empty. Returns `Array<string>` (file paths). This is the only route that takes a dynamic search parameter.
  **Files**: `src/app/api/instances/[id]/find/files/route.ts` (new)
  **Acceptance**: `curl http://localhost:3000/api/instances/<id>/find/files?query=page` returns JSON array of file paths

### Phase 2: Client-Side Data Fetching Hooks

- [x] 5. **Create `useCommands` hook**
  **What**: Fetches command list for an instance. Calls `GET /api/instances/{instanceId}/commands`. Fetches once on mount (commands are static for a session). Returns `{ commands, isLoading, error }`. Memoize by `instanceId` — don't re-fetch if ID hasn't changed.
  **Files**: `src/hooks/use-commands.ts` (new)
  **Acceptance**: Hook returns command data when provided a valid instanceId

- [x] 6. **Create `useAgents` hook**
  **What**: Fetches agent list for an instance. Same pattern as `useCommands`. Calls `GET /api/instances/{instanceId}/agents`. Fetches once on mount.
  **Files**: `src/hooks/use-agents.ts` (new)
  **Acceptance**: Hook returns agent data when provided a valid instanceId

- [x] 7. **Create `useFindFiles` hook**
  **What**: Debounced file search hook. Accepts `instanceId` and `query` string. Only fires the fetch when `query.length >= 1` and after a 300ms debounce. Uses `AbortController` to cancel in-flight requests when query changes. Returns `{ files, isLoading, error }`. When `query` is empty, returns empty array immediately (no fetch).
  **Files**: `src/hooks/use-find-files.ts` (new)
  **Acceptance**: Hook debounces file search requests, cancels previous in-flight requests

### Phase 3: UI Components — Autocomplete Popup

- [x] 8. **Install shadcn Popover component**
  **What**: Run `npx shadcn@latest add popover` to install the Radix Popover primitive. This provides the floating container for the autocomplete popup. The project already has `radix-ui` as a dependency, so this just generates the component file.
  **Files**: `src/components/ui/popover.tsx` (new, generated by shadcn CLI)
  **Acceptance**: `import { Popover } from "@/components/ui/popover"` works

- [x] 9. **Install cmdk (Command) component**
  **What**: Run `npx shadcn@latest add command` to install `cmdk` (the Command palette primitive). This adds `cmdk` to `package.json` and generates `src/components/ui/command.tsx`. The `cmdk` library provides built-in keyboard navigation, filtering, grouping, and accessible listbox semantics — exactly what we need.
  **Files**: `src/components/ui/command.tsx` (new, generated by shadcn CLI), `package.json` (modified — adds `cmdk` dep)
  **Acceptance**: `import { Command } from "@/components/ui/command"` works, `cmdk` in package.json

- [x] 10. **Create `AutocompletePopup` component**
  **What**: A shared autocomplete popup component that renders inside a Popover, anchored to the prompt input. Uses `cmdk`'s `Command` component for the listbox. Props:
  ```ts
  interface AutocompletePopupProps {
    open: boolean;
    onSelect: (value: string) => void;
    onClose: () => void;
    items: AutocompleteItem[];
    isLoading: boolean;
    filterValue: string;     // controlled by parent (the typed text after trigger)
    anchorRef: React.RefObject<HTMLElement>;  // the input element for positioning
  }
  
  type AutocompleteItem = {
    id: string;
    label: string;
    description?: string;
    icon?: React.ReactNode;
    group: "command" | "file" | "agent";
    value: string;  // what gets inserted into the input
  };
  ```
  Layout: Popover opens **above** the input (side="top"), max-height 300px, scrollable. Groups items by `group` with section headers ("Commands", "Files", "Agents"). Shows loading spinner when `isLoading`. Shows "No results" when items is empty and not loading. Uses `cmdk`'s built-in filtering (disabled — parent controls filtering via which items it passes). Each item shows: icon (lucide) + label + description (muted, truncated).
  
  **Implementation notes**:
  - Use `Command` with `shouldFilter={false}` since filtering is done server-side for files and client-side in the hook for commands/agents
  - `Command.Empty` for no results state
  - `Command.Group` for grouping by type
  - `Command.Item` with `onSelect` callback
  - `Command.Loading` for loading state
  - Popover uses `Popover.Anchor` set to the input ref for positioning
  
  **Files**: `src/components/session/autocomplete-popup.tsx` (new)
  **Acceptance**: Component renders a floating list anchored above the input, keyboard navigation works

### Phase 4: Trigger Detection & Integration

- [x] 11. **Create `useAutocomplete` hook**
  **What**: Core orchestration hook that detects triggers, manages state, and coordinates data fetching. This is the "brain" of the autocomplete system.
  
  **State it manages**:
  - `trigger: { type: "slash" | "mention"; startIndex: number } | null` — active trigger
  - `filterText: string` — text typed after the trigger character
  - `selectedIndex: number` — currently highlighted item
  
  **Trigger detection logic** (runs on every `value` change):
  - **Slash**: If `value` starts with `/`, trigger type is `"slash"`, `filterText = value.slice(1)`. Only active when `/` is at position 0.
  - **Mention**: Scan backwards from cursor position to find `@`. If found and not preceded by a non-whitespace character (or is at position 0), trigger type is `"mention"`, `filterText = text between @ and cursor`.
  - **Dismiss**: If trigger is active but the trigger character is deleted, or cursor moves before the trigger character, clear the trigger.
  
  **Data coordination**:
  - When trigger type is `"slash"`: filter `commands` (from `useCommands`) by `filterText` (case-insensitive prefix match on `name`)
  - When trigger type is `"mention"`: combine `agents` (from `useAgents`, filtered by `filterText`) with `files` (from `useFindFiles` with `filterText` as query). Agents are filtered client-side, files are searched server-side (debounced).
  
  **Keyboard handling** (returns an `onKeyDown` handler for the input):
  - `ArrowDown` — move selection down (wrap to top)
  - `ArrowUp` — move selection up (wrap to bottom)
  - `Enter` — if popup is open, select current item (prevent form submit)
  - `Escape` — close popup (prevent event bubbling)
  - `Tab` — select current item (like Enter)
  
  **Selection handling**:
  - For slash commands: replace entire input value with `/<commandName> ` (with trailing space for args)
  - For mentions: replace the `@filterText` substring (from trigger startIndex to cursor) with the selected reference value (e.g., `@path/to/file.ts ` or `@agentName `)
  
  **Params**: `{ value, setValue, instanceId, inputRef, cursorPosition }`
  **Returns**: `{ trigger, items, isLoading, selectedIndex, onKeyDown, onSelect, isOpen }`
  
  **Files**: `src/hooks/use-autocomplete.ts` (new)
  **Acceptance**: Trigger detection works for both `/` and `@`, items are populated, keyboard handlers function correctly

- [x] 12. **Modify PromptInput to integrate autocomplete**
  **What**: Update `PromptInput` to:
  1. Accept `instanceId` as a new prop
  2. Track cursor position via `onSelect` / `onClick` events on the input (to know where `@` triggers start)
  3. Wire up `useAutocomplete` hook with the input's value, setValue, instanceId, and cursor position
  4. Attach the `onKeyDown` handler from `useAutocomplete` to the input (before form's own key handling)
  5. Render `AutocompletePopup` when `isOpen` is true, anchored to the input
  6. When the autocomplete selects an item, update the input value via `useAutocomplete`'s selection logic
  7. Ensure form submission (`Enter`) is suppressed when autocomplete is open and an item is highlighted
  
  **Key changes to the component**:
  - Add `instanceId` to `PromptInputProps`
  - Add cursor position tracking: `const [cursorPos, setCursorPos] = useState(0)` + update on `onChange`/`onSelect`/`onClick`
  - Call `useAutocomplete({ value, setValue, instanceId, inputRef, cursorPosition: cursorPos })`
  - Wrap the existing `<Input>` + add `<AutocompletePopup>` as a sibling
  - Modify the `<form>` `onSubmit` to check if autocomplete is open (if open, don't submit)
  - The input's `onKeyDown` calls `autocomplete.onKeyDown(e)` first; if it was handled (e.g. Enter while popup open), `e.preventDefault()` stops form submission
  
  **Files**: `src/components/session/prompt-input.tsx` (modify)
  **Acceptance**: Typing `/` shows command popup, typing `@` shows files+agents popup, selecting items works, Enter submits when popup is closed

- [x] 13. **Update session page to pass instanceId to PromptInput**
  **What**: The session page (`src/app/sessions/[id]/page.tsx`) currently renders `<PromptInput onSend={handleSend} disabled={...} sendError={...} />`. Add `instanceId` prop: `<PromptInput instanceId={instanceId} onSend={handleSend} ... />`.
  **Files**: `src/app/sessions/[id]/page.tsx` (modify — one line change)
  **Acceptance**: `instanceId` is passed through, autocomplete data fetching works in the session page

### Phase 5: Polish & Edge Cases

- [x] 14. **Handle autocomplete icons per item type**
  **What**: Assign appropriate lucide icons to each autocomplete item group:
  - Commands: `Terminal` icon
  - Files: `FileText` icon (or `Folder` if the path ends with `/` — but SDK `find.files` returns strings, so we can check for trailing `/` or use `FileText` universally)
  - Agents: `Bot` icon, with optional colored dot matching the agent's `color` property
  
  Apply these in the `useAutocomplete` hook when mapping data to `AutocompleteItem[]`.
  
  **Files**: `src/hooks/use-autocomplete.ts` (modify — icon mapping)
  **Acceptance**: Each item type shows its own icon in the popup

- [x] 15. **Handle edge cases**
  **What**: Ensure robust behavior for:
  - **Empty command list**: Show "No commands available" in popup
  - **File search returns 0 results**: Show "No files found" (only in files group, agents may still show)
  - **Network error on API routes**: Show inline error in popup, don't crash
  - **Very long file paths**: Truncate display with `...` prefix (show end of path), keep full path as value
  - **Large result sets**: Limit file results to 20 items in the API route response (prevent rendering 1000+ items). Commands and agents are naturally small lists.
  - **Special characters in search**: URL-encode the query param in `useFindFiles`
  - **Rapid typing**: Debounce handles this for files; commands/agents filter is instant (client-side)
  - **Input blur while popup is open**: Close popup on blur (with small delay to allow click-to-select)
  - **Typing after selecting**: After selecting a command like `/plan`, the user can continue typing arguments. The autocomplete should not re-trigger until a new `/` or `@` is typed.
  - **Multiple `@` references**: User types `@file1.ts some text @file2.ts` — each `@` triggers independently based on cursor position
  
  **Files**: `src/hooks/use-autocomplete.ts` (modify), `src/hooks/use-find-files.ts` (modify — add limit), `src/components/session/autocomplete-popup.tsx` (modify — truncation, error states)
  **Acceptance**: All edge cases handled without crashes or confusing UI

- [x] 16. **Accessibility**
  **What**: Ensure the autocomplete is accessible:
  - Input has `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
  - Popup list has `role="listbox"`
  - Items have `role="option"` and `aria-selected`
  - `cmdk` handles most of this natively, but verify the Popover wrapper doesn't break it
  - Screen reader announces "N results available" on popup open
  
  **Files**: `src/components/session/prompt-input.tsx` (modify — aria attrs on input), `src/components/session/autocomplete-popup.tsx` (verify — cmdk provides most of this)
  **Acceptance**: VoiceOver/NVDA can navigate the autocomplete list

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Session Page (page.tsx)                                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  PromptInput (prompt-input.tsx)                          │ │
│  │  ┌──────────────────────┐  ┌──────────────────────────┐ │ │
│  │  │  <Input>             │  │  AutocompletePopup       │ │ │
│  │  │  value / onChange    │  │  (autocomplete-popup.tsx) │ │ │
│  │  │  onKeyDown           │  │  cmdk Command component  │ │ │
│  │  └──────────────────────┘  └──────────────────────────┘ │ │
│  │          ↕                           ↑                   │ │
│  │  useAutocomplete (orchestrator)      │ items             │ │
│  │    ├── trigger detection             │                   │ │
│  │    ├── useCommands ──────────────────┤                   │ │
│  │    ├── useAgents ────────────────────┤                   │ │
│  │    └── useFindFiles (debounced) ─────┘                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓ fetch()                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  API Routes (Next.js)                                    │ │
│  │  GET /api/instances/[id]/commands     → client.command   │ │
│  │  GET /api/instances/[id]/agents       → client.app       │ │
│  │  GET /api/instances/[id]/find/files   → client.find      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓ SDK                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  OpenCode Server (process-manager.ts)                    │ │
│  │  getClientForInstance(id) → OpencodeClient                │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## File Inventory

| File | Action | Phase |
|------|--------|-------|
| `src/lib/api-types.ts` | Modify | 1 |
| `src/app/api/instances/[id]/commands/route.ts` | Create | 1 |
| `src/app/api/instances/[id]/agents/route.ts` | Create | 1 |
| `src/app/api/instances/[id]/find/files/route.ts` | Create | 1 |
| `src/hooks/use-commands.ts` | Create | 2 |
| `src/hooks/use-agents.ts` | Create | 2 |
| `src/hooks/use-find-files.ts` | Create | 2 |
| `src/components/ui/popover.tsx` | Create (shadcn CLI) | 3 |
| `src/components/ui/command.tsx` | Create (shadcn CLI) | 3 |
| `src/components/session/autocomplete-popup.tsx` | Create | 3 |
| `src/hooks/use-autocomplete.ts` | Create | 4 |
| `src/components/session/prompt-input.tsx` | Modify | 4 |
| `src/app/sessions/[id]/page.tsx` | Modify | 4 |
| `package.json` | Modified by shadcn (adds `cmdk`) | 3 |

## Verification
- [x] `npx tsc --noEmit` — no TypeScript errors
- [x] `npm run dev` — dev server starts without errors
- [x] Typing `/` at start of input opens command popup with correct commands
- [x] Typing `@` opens reference popup with agents (immediate) and files (after debounce)
- [x] Arrow keys navigate, Enter selects, Escape closes
- [x] Selected command replaces input text correctly
- [x] Selected file/agent inserts at cursor position correctly
- [x] Form submission works normally when popup is closed
- [x] Enter key does NOT submit form when popup is open
- [x] File search debounces and cancels previous requests
- [x] Empty state shows "No results" message
- [x] Loading state shows spinner
- [x] Existing prompt send behavior is completely unchanged
- [x] `npm run build` succeeds (production build)
