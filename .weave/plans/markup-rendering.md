# Markdown Rendering for Model Responses

## TL;DR
> **Summary**: Replace plain-text `<p>` rendering of model responses with full markdown rendering including syntax-highlighted code blocks, copy-to-clipboard, and streaming-safe memoization — all themed to the existing slate/purple dark UI.
> **Estimated Effort**: Medium

## Context
### Original Request
AI model responses currently render as plain text in a `<p>` tag (line 209 of `activity-stream-v1.tsx`). Models return markdown-formatted text (headers, bold, italic, code blocks, lists, links, tables, etc.) that needs proper rendering with syntax highlighting and copy-to-clipboard on code blocks.

### Key Findings
1. **Primary render site**: `activity-stream-v1.tsx` line 208–211 — `fullText` (concatenation of `AccumulatedTextPart.text` values) rendered inside `<p className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">{fullText}</p>`.
2. **Legacy render site**: `activity-stream.tsx` line 81–83 — `{data.text as string}` in a `<p>` tag. Same issue, lower priority (v0 stream, not actively used).
3. **Streaming architecture**: Text arrives via SSE `message.part.delta` events. `applyTextDelta()` in `event-state.ts` appends delta strings to `AccumulatedTextPart.text`. The accumulated `fullText` string grows character-by-character during streaming. React re-renders the `MessageItem` component on every delta.
4. **Performance concern**: During streaming, `fullText` changes on every delta (high-frequency). Naively re-parsing the entire markdown string on every character would be expensive. Strategy: use `React.memo` on the `MarkdownRenderer` component and `useMemo` on the parsed AST. `react-markdown` internally uses a unified/remark pipeline; wrapping it in `React.memo` with the text as dependency is the standard approach and performs well for typical message sizes.
5. **No existing markdown deps**: No `react-markdown`, `remark`, `rehype`, or `shiki` packages in `package.json`. Clean slate.
6. **Design system**: Dark-only app using Tailwind CSS v4, shadcn/ui (new-york style), slate-900 background (`#0F172A`), purple primary (`#A855F7`). Mono font is JetBrains Mono (`--font-mono`). The markdown styles must use these tokens.
7. **shadcn config**: `components.json` uses `@/components/ui` alias, `new-york` style, RSC-enabled. The markdown component should be a client component (`"use client"` — it needs interactivity for copy button).
8. **Test infrastructure**: Vitest with globals, `src/**/*.test.ts` pattern, node environment. Existing tests are pure-function unit tests (no React component tests). New tests should follow this pattern — test utility functions, not the React component itself.
9. **Existing pattern**: The `TodoListInline` component is a good precedent — a specialized rendering component extracted into its own file under `src/components/session/`, with a utility module in `src/lib/` for parsing logic.

## Objectives
### Core Objective
Render markdown-formatted model responses with proper typography, syntax-highlighted code blocks, and a copy-to-clipboard button — while maintaining streaming performance and dark-theme consistency.

### Deliverables
- [ ] `MarkdownRenderer` component with full GFM markdown support
- [ ] Syntax highlighting for fenced code blocks
- [ ] Copy-to-clipboard button on code blocks
- [ ] Dark-theme-consistent markdown typography styles
- [ ] Integration into `activity-stream-v1.tsx` (replace `<p>{fullText}</p>`)
- [ ] Integration into `activity-stream.tsx` (legacy stream, same treatment)
- [ ] Streaming performance: memoization to avoid re-parsing on every delta

### Definition of Done
- [ ] Markdown headings, bold, italic, lists, links, inline code, code blocks, tables, and blockquotes render correctly
- [ ] Fenced code blocks show syntax highlighting with language label
- [ ] Code blocks have a functional copy-to-clipboard button
- [ ] Styles match the existing dark theme (slate bg, purple accents, JetBrains Mono for code)
- [ ] Streaming text renders incrementally without visible jank or layout thrashing
- [ ] No TypeScript errors: `npx tsc --noEmit` passes
- [ ] All existing tests pass: `npm run test`
- [ ] Dev server runs without errors: `npm run dev`

### Guardrails (Must NOT)
- Must NOT modify `event-state.ts` or the SSE streaming pipeline
- Must NOT change the `AccumulatedMessage`/`AccumulatedTextPart` types
- Must NOT break rendering of tool calls, todo lists, or any non-text parts
- Must NOT introduce SSR-incompatible code (the component is `"use client"` but must not crash during SSR hydration)
- Must NOT add heavy dependencies that significantly increase bundle size (prefer `react-markdown` + `rehype-highlight` over heavier alternatives like `shiki` for initial implementation)

## TODOs

### Phase 1: Dependencies & Foundation

- [ ] 1. **Install markdown rendering dependencies**
  **What**: Add `react-markdown`, `remark-gfm`, and `rehype-highlight` (plus `highlight.js` for syntax themes) as production dependencies. These are the standard, lightweight choices for React markdown rendering with GFM support and code highlighting.
  **Files**: `package.json`
  **Commands**:
  ```bash
  npm install react-markdown remark-gfm rehype-highlight highlight.js
  ```
  **Why these choices**:
  - `react-markdown` (~40kB gzipped) — React component that renders markdown via remark/rehype pipeline. Streaming-friendly since it accepts a string prop and re-renders on change. Well-maintained, 12M+ weekly downloads.
  - `remark-gfm` — Adds GitHub Flavored Markdown support (tables, strikethrough, task lists, autolinks). Essential for AI model output.
  - `rehype-highlight` — Applies syntax highlighting to fenced code blocks via `highlight.js`. Much lighter than `shiki` (~200kB vs ~2MB) and sufficient for a dashboard.
  - `highlight.js` — Only needed for importing a dark CSS theme (`github-dark`). The actual highlighting is done by `rehype-highlight`.
  **Acceptance**: `npm ls react-markdown remark-gfm rehype-highlight` shows all three installed. `npx tsc --noEmit` still passes.

### Phase 2: MarkdownRenderer Component

- [ ] 2. **Create the `MarkdownRenderer` component**
  **What**: Create a new `"use client"` component that wraps `react-markdown` with custom component overrides for headings, code blocks, links, lists, tables, and other elements. The component accepts a `content: string` prop and renders it as styled markdown.
  **Files**: `src/components/session/markdown-renderer.tsx` (new)
  **Key implementation details**:
  - Import `ReactMarkdown` from `react-markdown`, `remarkGfm` from `remark-gfm`, `rehypeHighlight` from `rehype-highlight`.
  - Use `React.memo` on the exported component to prevent re-renders when the parent re-renders but `content` hasn't changed.
  - Use `useMemo` to memoize the `remarkPlugins` and `rehypePlugins` arrays (these are static, but new array references on every render cause `react-markdown` to re-process).
  - Define custom `components` object mapping markdown elements to styled React elements:
    - **`h1`–`h6`**: Sized text with `text-foreground` color, appropriate spacing. Use `text-lg`/`text-base`/`text-sm` etc. with `font-semibold`.
    - **`p`**: `text-sm text-foreground/90 leading-relaxed` (matching current plain-text style).
    - **`a`**: `text-primary hover:underline` (uses the purple primary color). Add `target="_blank" rel="noopener noreferrer"` for external links.
    - **`strong`**: `font-semibold text-foreground`.
    - **`em`**: `italic`.
    - **`ul`/`ol`**: Proper list styling with `list-disc`/`list-decimal`, `ml-4`, `space-y-1`.
    - **`li`**: `text-sm text-foreground/90`.
    - **`blockquote`**: `border-l-2 border-primary/50 pl-3 italic text-muted-foreground`.
    - **`table`**: `w-full text-xs border-collapse` with bordered cells.
    - **`th`/`td`**: `border border-border/60 px-2 py-1`.
    - **`hr`**: `border-border/40 my-3`.
    - **`code` (inline)**: `bg-muted/50 text-primary/90 px-1 py-0.5 rounded text-xs font-mono` — visually distinct inline code.
    - **`pre` + `code` (fenced block)**: Delegate to a `CodeBlock` sub-component (see next task).
  - The `components` object should be defined outside the component or memoized to maintain referential stability.
  - The wrapper `<div>` should use classes: `prose-weave space-y-2 text-sm` (the `prose-weave` class is for additional CSS overrides in `globals.css`, and `space-y-2` provides vertical rhythm between block elements).
  **Acceptance**: Component renders a test markdown string with headings, bold, lists, code blocks, and links. All elements are visually styled. No TypeScript errors.

- [ ] 3. **Create the `CodeBlock` sub-component with copy-to-clipboard**
  **What**: A dedicated component for rendering fenced code blocks with a language label and copy button. This is rendered by the custom `pre` component override in `MarkdownRenderer`.
  **Files**: `src/components/session/markdown-renderer.tsx` (same file, unexported sub-component)
  **Key implementation details**:
  - Receives `children` (the `<code>` element rendered by `react-markdown`/`rehype-highlight`) and extracts:
    - Language from the `className` prop on the `<code>` element (format: `language-{lang}` or `hljs language-{lang}`).
    - Raw text content for the copy button (traverse `children` to extract text nodes, or use a ref + `textContent`).
  - Renders a container `<div>` with:
    - Header bar: `flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40 rounded-t-md`.
      - Left: language label in `text-[10px] text-muted-foreground font-mono uppercase`.
      - Right: copy button using the `Copy`/`Check` icons from `lucide-react`. Uses `navigator.clipboard.writeText()`. Shows a "Copied!" state for 2 seconds via `useState`/`setTimeout`.
    - Code area: `<pre>` with `overflow-x-auto bg-muted/20 p-3 rounded-b-md text-xs font-mono`. The `<code>` child is rendered as-is (it already has highlight.js classes applied by `rehype-highlight`).
  - The copy button should be subtle (low opacity) and brighten on hover: `opacity-50 hover:opacity-100 transition-opacity`.
  - Use `useCallback` for the copy handler.
  **Acceptance**: Fenced code blocks display with language label, syntax highlighting, and a working copy button. Inline `code` elements do NOT get the code block treatment.

### Phase 3: Markdown Typography Styles

- [ ] 4. **Add markdown-specific CSS to `globals.css`**
  **What**: Add a `.prose-weave` class with CSS overrides for markdown content that integrates with the dark theme. This handles edge cases that Tailwind utility classes on individual elements can't cover (e.g., highlight.js theme tokens, nested list spacing, table hover).
  **Files**: `src/app/globals.css`
  **Key additions**:
  ```css
  /* ─── Markdown prose (Weave dark theme) ─────────────────── */

  /* Import a dark highlight.js theme — github-dark pairs well with slate */
  /* Note: rehype-highlight applies hljs classes; we need the theme CSS */

  .prose-weave pre code.hljs {
    background: transparent;
    padding: 0;
  }

  .prose-weave pre {
    scrollbar-width: thin;
    scrollbar-color: var(--muted) transparent;
  }

  /* Tight spacing between consecutive list items */
  .prose-weave li > p {
    margin: 0;
  }

  /* Table striping */
  .prose-weave table tr:nth-child(even) {
    background: var(--muted);
  }

  .prose-weave table th {
    background: var(--muted);
    font-weight: 600;
  }
  ```
  - For highlight.js theming: import `highlight.js/styles/github-dark.css` in the `MarkdownRenderer` component (CSS import, will be bundled by Next.js). This is simpler than duplicating all highlight.js token styles. Alternatively, if the CSS import causes issues with Tailwind v4's CSS layering, inline the theme tokens in `globals.css` under `.prose-weave`.
  **Acceptance**: Code blocks have proper syntax colors. Tables have subtle row striping. No style conflicts with existing components.

### Phase 4: Integration

- [ ] 5. **Integrate `MarkdownRenderer` into `activity-stream-v1.tsx`**
  **What**: Replace the plain-text `<p>` rendering of `fullText` with the new `MarkdownRenderer` component.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Add import: `import { MarkdownRenderer } from "./markdown-renderer";`
  - Replace lines 208–211:
    ```tsx
    {/* Text content */}
    {fullText && (
      <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
        {fullText}
      </p>
    )}
    ```
    With:
    ```tsx
    {/* Text content */}
    {fullText && (
      <MarkdownRenderer content={fullText} />
    )}
    ```
  - The `MarkdownRenderer` component handles all styling internally, so the wrapping `<p>` and its classes are removed entirely.
  - **User messages**: Consider whether user messages should also get markdown rendering. User prompts are typically short and rarely contain markdown. For now, render all messages (user + assistant) through `MarkdownRenderer` — the component handles plain text gracefully (it just renders it as a `<p>`). If user messages look odd, we can add a `className` prop or a `variant` prop later.
  **Acceptance**: Model responses render with formatted markdown in the v1 activity stream. Streaming still works — text appears incrementally. No layout shifts.

- [ ] 6. **Integrate `MarkdownRenderer` into `activity-stream.tsx` (legacy)**
  **What**: Apply the same markdown rendering to the legacy activity stream for consistency.
  **Files**: `src/components/session/activity-stream.tsx`
  **Changes**:
  - Add import: `import { MarkdownRenderer } from "./markdown-renderer";`
  - In the `EventContent` function, `case "message":` block (line 76–85), replace:
    ```tsx
    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
      {data.text as string}
    </p>
    ```
    With:
    ```tsx
    <div className="mt-0.5">
      <MarkdownRenderer content={data.text as string} className="text-xs" />
    </div>
    ```
  - This requires the `MarkdownRenderer` to accept an optional `className` prop for size overrides. Add this prop in task 2.
  **Acceptance**: Legacy activity stream also renders markdown. No regressions.

### Phase 5: Performance & Polish

- [ ] 7. **Optimize streaming performance with memoization**
  **What**: Ensure that the `MarkdownRenderer` is wrapped with `React.memo` and that `remarkPlugins`/`rehypePlugins`/`components` arrays are referentially stable (defined at module scope or memoized). Profile with React DevTools to verify that the markdown tree doesn't cause excessive re-renders.
  **Files**: `src/components/session/markdown-renderer.tsx`
  **Key details**:
  - `React.memo(MarkdownRenderer)` — only re-renders when `content` or `className` changes. During streaming, `content` changes on every delta, so this doesn't skip renders — but it prevents unnecessary re-renders from parent state changes (e.g., scroll position, other messages).
  - Move `remarkPlugins`, `rehypePlugins`, and `components` to module-level constants (outside the component function). This avoids recreating these objects on every render, which would cause `react-markdown` to rebuild its processing pipeline.
  - For the `components` object, the `CodeBlock` sub-component uses `useState` (for copy state), so it must be a proper component (not an inline arrow function). Defining it at module level is fine — it's already a named component.
  - **Do NOT debounce/throttle deltas** — the text should appear character-by-character for the real-time streaming feel. The memoization is sufficient for typical message sizes. If performance issues arise with very large messages (>50KB), that's a future optimization (e.g., virtualized rendering or raw HTML for completed messages).
  **Acceptance**: During streaming, the page remains responsive (no frame drops visible in React DevTools Profiler). Plugin/component arrays have stable references across renders.

- [ ] 8. **Handle edge cases and partial markdown during streaming**
  **What**: During streaming, `fullText` may contain incomplete markdown (e.g., an unclosed code fence `` ``` `` without its closing fence, or a partial link `[text](url`). `react-markdown` handles this gracefully — it renders what it can and treats unclosed constructs as plain text. Verify this behavior and document any workarounds needed.
  **Files**: `src/components/session/markdown-renderer.tsx` (potential adjustments)
  **Key considerations**:
  - **Unclosed code fences**: During streaming, a `` ```python `` without its closing `` ``` `` will render as a code block that grows as more text arrives. Once the closing fence arrives, the block completes. `react-markdown` (via `remark-parse`) handles this — the unclosed fence renders as a code block containing all subsequent text, which corrects itself when the closing fence arrives. This is acceptable behavior.
  - **Partial inline markup**: Half-typed `**bold` renders as `**bold` (literal asterisks) until the closing `**` arrives. This is expected and correct.
  - **Very long single-line code blocks**: Ensure `overflow-x-auto` is set on `<pre>` to prevent layout breakage.
  - **Image tags**: AI models occasionally include `![alt](url)` image references. Consider whether to render them or strip them. For a dashboard context, strip images to avoid loading unexpected external resources. Add `img: () => null` to the components override. Alternatively, render images but cap their size with `max-w-full max-h-64`.
  - **HTML in markdown**: `react-markdown` sanitizes HTML by default (does not render raw HTML tags). This is the desired behavior for security. Do NOT enable `rehype-raw`.
  **Acceptance**: Streaming partial markdown does not cause crashes or visual artifacts. Unclosed code fences render progressively. No external images load without user intent.

### Phase 6: Testing

- [ ] 9. **Add utility tests for code block language extraction**
  **What**: If any utility functions are extracted (e.g., a `extractLanguage(className: string): string` helper, or a `extractTextContent(node: ReactNode): string` helper for the copy button), add unit tests.
  **Files**: `src/lib/__tests__/markdown-utils.test.ts` (new, if utilities are extracted to `src/lib/markdown-utils.ts`)
  **Test cases**:
  - `extractLanguage("language-typescript")` → `"typescript"`
  - `extractLanguage("hljs language-python")` → `"python"`
  - `extractLanguage("")` → `""` (no language)
  - `extractLanguage(undefined)` → `""` (defensive)
  **Acceptance**: Tests pass with `npm run test`. Note: if all logic stays inline in the component with no extractable pure functions, this task can be skipped — do not force extraction just for testability.

- [ ] 10. **Manual QA checklist**
  **What**: Manually verify all markdown features render correctly with realistic model output.
  **Checklist**:
  - [ ] `# Heading 1` through `###### Heading 6` — different sizes, proper spacing
  - [ ] `**bold**` and `*italic*` — correct font weight/style
  - [ ] `- unordered` and `1. ordered` lists — proper bullets/numbers, nesting works
  - [ ] `` `inline code` `` — highlighted background, mono font
  - [ ] Fenced code block with language (` ```typescript `) — syntax highlighting, language label, copy button
  - [ ] Fenced code block without language (` ``` `) — plain preformatted text, copy button works
  - [ ] `[link text](url)` — purple colored, opens in new tab
  - [ ] `> blockquote` — left border, italic, muted color
  - [ ] `| table | header |` — bordered, striped rows
  - [ ] `---` horizontal rule — subtle divider
  - [ ] Streaming: start a prompt, watch text arrive character-by-character — no jank, code blocks build up progressively
  - [ ] Copy button: click copies code content to clipboard, shows check icon briefly
  - [ ] Long code blocks: horizontal scroll works, no layout overflow
  - [ ] Mixed content: message with text → code → text → list renders with proper spacing
  **Acceptance**: All checklist items pass visual inspection.

## Verification
- [ ] All TypeScript compiles cleanly: `npx tsc --noEmit`
- [ ] All existing tests pass: `npm run test`
- [ ] Dev server starts cleanly: `npm run dev`
- [ ] No regressions in tool call rendering, todo list rendering, or message layout
- [ ] Production build succeeds: `npm run build`

## Architecture Notes

### Component Hierarchy (after changes)
```
ActivityStreamV1
  └── MessageItem
        ├── ToolCallItem (unchanged)
        │     ├── TaskDelegationItem (unchanged)
        │     └── TodoListInline (unchanged)
        └── MarkdownRenderer (new — replaces <p>{fullText}</p>)
              └── CodeBlock (new — sub-component for fenced code)
```

### Data Flow (unchanged)
```
SSE → message.part.delta → applyTextDelta() → AccumulatedTextPart.text grows
    → MessageItem re-renders → fullText recalculated → MarkdownRenderer re-renders
```

### Bundle Impact Estimate
| Package | Gzipped Size | Notes |
|---|---|---|
| `react-markdown` | ~12kB | Core renderer |
| `remark-parse` | ~14kB | Pulled in by react-markdown |
| `remark-gfm` | ~2kB | GFM extension |
| `rehype-highlight` | ~1kB | Highlight bridge |
| `highlight.js` (common languages) | ~25kB | Only languages detected in code blocks are loaded |
| **Total** | ~54kB | Acceptable for a dashboard app |

### Alternative Considered: Shiki
Shiki produces higher-quality syntax highlighting (TextMate grammars, VS Code themes) but adds ~2MB to the bundle (all grammars) or requires async loading of grammars. For a dashboard where code blocks are supplementary (not a code editor), `highlight.js` via `rehype-highlight` is the better trade-off. Shiki can be swapped in later if needed — the `CodeBlock` component isolates the highlighting concern.
