# Weave Agent Fleet UI - Message Timestamps Analysis

## Executive Summary

The Weave Agent Fleet UI is a **Next.js 16 + React 19** application using **Tailwind CSS v4** for styling. Messages DO have timestamp fields defined in the data model, but the **primary message display component (ActivityStreamV1) does not currently render timestamps**. 

### Key Findings:
- ✅ `createdAt` timestamp field exists in `AccumulatedMessage` type (milliseconds since epoch)
- ✅ `completedAt` timestamp field also exists for message completion time
- ❌ ActivityStreamV1 component renders agent name, duration, cost, but NOT message timestamps
- ✅ Session metadata displays creation time using `timeSince()` format
- ✅ Timestamps are captured in SSE event processing
- ✅ Infrastructure ready for timestamp display

---

## 1. MESSAGE TYPE & DATA MODEL

### Full Message Type Definition
**File**: `/src/lib/api-types.ts` (lines 92-107)

```typescript
export interface AccumulatedMessage {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: AccumulatedPart[];
  /** Cost in USD — populated from step-finish parts */
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number };
  /** ISO timestamp (milliseconds since epoch) */
  createdAt?: number;
  /** The agent name — sourced from info.agent for both user and assistant messages (v2) */
  agent?: string;
  modelID?: string;
  /** Completion time (milliseconds since epoch) */
  completedAt?: number;
  parentID?: string;
}
```

**Timestamp Fields**:
- `createdAt`: Optional number (unix milliseconds) — when message was created
- `completedAt`: Optional number (unix milliseconds) — when assistant message finished streaming

---

## 2. MESSAGE RENDERING COMPONENTS

### Primary Component: ActivityStreamV1
**File**: `/src/components/session/activity-stream-v1.tsx` (350 lines)

#### Component Structure:
```
ActivityStreamV1 (root container)
├── Connection status banner (conditional)
├── ScrollArea (flex-1 min-h-0)
│   └── MessageItem (for each message)
│       ├── User/Bot icon (4px)
│       ├── Message metadata row
│       │   ├── "You" or "▣ AgentName"
│       │   ├── modelID badge (assistant only)
│       │   ├── Duration badge (assistant only)
│       │   └── Cost badge (if > 0)
│       ├── Tool calls (if present)
│       └── Text content (rendered markdown)
├── "Thinking" indicator (conditional)
└── Status bar (tokens count, connection status)
```

**Key Observations**:
- **Lines 129-225**: MessageItem component — currently renders agent name, model, duration, cost
- **Line 149**: Computes duration from `completedAt - parentID.createdAt`
- **NO TIMESTAMP DISPLAY**: The message's own `createdAt` field is NOT rendered

### Secondary Component: ActivityStream (Legacy)
**File**: `/src/components/session/activity-stream.tsx` (216 lines)
- Uses `SessionEvent` type from `/src/lib/types.ts` (has `timestamp: Date`)
- **Line 209**: Renders time via `formatTime()` as "HH:MM:SS"
- This is the legacy event stream; not used in current session display

### Session Card Component
**File**: `/src/components/fleet/session-card.tsx` (159 lines)
- **Lines 56-63**: Implements `timeSince()` function for relative time display
- **Line 137**: Displays session creation time: `{timeSince(session.createdAt)}`
- Output example: "2h ago", "45m ago", "30s ago"

---

## 3. MESSAGE DATA FLOW: API → STORE → COMPONENT

### 3a. Data Loading & Accumulation
**File**: `/src/hooks/use-session-events.ts` (268 lines)

#### Initial Load Path:
```
useSessionEvents hook
  └── loadMessages() [lines 58-115]
      └── GET /api/sessions/[id]?instanceId=...
          └── Parse SDK message format:
              {
                info: { 
                  id, sessionID, role, 
                  time: { created, completed },
                  agent, modelID, parentID
                },
                parts: [...]
              }
          └── Convert to AccumulatedMessage[]
              └── Extract timestamps:
                  - Line 97: createdAt = msg.info.time?.created
                  - Line 98: completedAt = msg.info.time?.completed
          └── setState(accumulated) [line 111]
```

#### Real-time Stream Path:
```
SSE Connection (EventSource)
  └── onmessage handler [lines 147-156]
      └── JSON.parse(event.data) as SSEEvent
          └── handleEvent() dispatcher [lines 201-268]
              ├── type: "message.updated" [lines 235-240]
              │   └── mergeMessageUpdate()
              │       └── Updates completedAt from info.time?.completed
              └── type: "message.part.updated" [lines 242-256]
                  └── applyPartUpdate()
                      └── Updates part state, cost, tokens
```

### 3b. Event State Management
**File**: `/src/lib/event-state.ts` (223 lines)

#### ensureMessage() - Creates new message
**Lines 13-36**:
```typescript
export function ensureMessage(prev, info) {
  const newMsg: AccumulatedMessage = {
    messageId: info.id,
    sessionId: info.sessionID ?? "",
    role: info.role === "user" ? "user" : "assistant",
    parts: [],
    createdAt: info.time?.created,  // ← Timestamp captured here
    agent: info.agent,
    modelID: info.modelID,
    parentID: info.parentID,
  };
  return [...prev, newMsg];
}
```

#### mergeMessageUpdate() - Updates message completion
**Lines 43-56**:
```typescript
export function mergeMessageUpdate(prev, info) {
  // Updates completedAt when message finishes streaming
  const completedAt = info.time?.completed;
  if (!completedAt || existing.completedAt) return prev;
  return [...prev, { ...existing, completedAt }];
}
```

### 3c. API Response Format
**File**: `/src/hooks/use-session-events.ts` lines 64-69
```typescript
const data = await response.json() as {
  messages?: Array<{
    info: { 
      id: string; 
      sessionID: string; 
      role: string; 
      time?: { created?: number; completed?: number };
      cost?: number; 
      tokens?: {...}; 
      agent?: string; 
      modelID?: string; 
      parentID?: string 
    };
    parts: Array<{...}>;
  }>;
};
```

---

## 4. FRONTEND TECHNOLOGY STACK

### Framework & Runtime
- **Next.js**: 16.1.6 (app router)
- **React**: 19.2.3
- **TypeScript**: 5.x
- **Node**: 20+ (from .node-version)

### Styling
- **Tailwind CSS**: v4 (via @tailwindcss/postcss)
- **shadcn/ui**: 3.8.5 — provides pre-built UI component library (Button, Badge, Card, etc.)
- **class-variance-authority**: 0.7.1 — for component variants
- **clsx**: 2.1.1 — classname utility
- **tailwind-merge**: 3.5.0 — merges Tailwind classes intelligently

**Styling Approach**:
- ✅ Pure **Tailwind utility classes** — NO CSS modules, NO styled-components
- ✅ Custom CSS for markdown/code blocks: `/src/app/globals.css` (190 lines)
- ✅ CSS custom properties (--foreground, --muted, --primary, etc.)
- ✅ Dark theme only (no light mode)

### UI Component Library
**shadcn/ui Components** (based on Radix UI primitives):
- Buttons, Badges, Cards
- Tabs, Dropdowns, Popovers
- Dialogs, AlertDialogs, Sheets
- ScrollArea, Collapsible
- All in `/src/components/ui/` directory (20 files)

### Content Rendering
- **react-markdown**: 10.1.0 — markdown parsing
- **remark-gfm**: 4.0.1 — GitHub-flavored markdown
- **rehype-highlight**: 7.0.2 — syntax highlighting
- **highlight.js**: 11.11.1 — language-specific code highlighting
- Custom MarkdownRenderer component: `/src/components/session/markdown-renderer.tsx` (222 lines)

### Icons
- **lucide-react**: 0.575.0 — modern icon library
- Examples: Clock, MessageSquare, Bot, User, Wrench, Coins, etc.

### Build & Development
- **PostCSS**: 4 (postcss.config.mjs)
- **ESBuild**: 0.27.3 (for CLI bundling)
- **Vitest**: 3.2.4 (unit testing)
- **ESLint**: 9 (code linting)

---

## 5. STYLING APPROACH - DETAILED

### Global Theme
**File**: `/src/app/globals.css`

#### Color System (Weave Dark Theme):
```css
:root {
  /* Background & Foreground */
  --background: #0F172A;      /* slate-900 */
  --foreground: #F8FAFC;      /* slate-100 */
  
  /* Card, Popover */
  --card: #1E293B;            /* slate-800 */
  --card-foreground: #F8FAFC;
  
  /* Primary (Weave purple) */
  --primary: #A855F7;
  --primary-foreground: #FFFFFF;
  
  /* Muted (secondary text) */
  --muted: #334155;           /* slate-700 */
  --muted-foreground: #94A3B8; /* slate-400 */
  
  /* Borders & Input */
  --border: rgba(255, 255, 255, 0.1);
  --input: rgba(255, 255, 255, 0.15);
  
  /* Weave Agent Colors */
  --color-agent-loom: #4A90D9;
  --color-agent-tapestry: #D94A4A;
  --color-agent-pattern: #9B59B6;
  /* ... more agent colors ... */
}
```

#### Example Component Styling (ActivityStreamV1):
```typescript
// Message container - Tailwind utilities only
<div className="flex gap-3 px-4 py-3 hover:bg-accent/20 border-b border-border/40 border-l-2">
  
// User/Bot icon
<div className="mt-0.5 shrink-0">
  {isUser ? (
    <User className="h-4 w-4 text-foreground" />
  ) : (
    <Bot className="h-4 w-4 text-muted-foreground" />
  )}
</div>

// Metadata (Agent name, model, duration, cost)
<div className="flex items-center gap-2 flex-wrap">
  <span className="text-xs font-medium">
    {message.agent ? toTitleCase(message.agent) : "Assistant"}
  </span>
  {message.modelID && (
    <span className="text-[10px] text-muted-foreground">
      · {message.modelID}
    </span>
  )}
  {durationStr && (
    <span className="text-[10px] text-muted-foreground">
      · {durationStr}
    </span>
  )}
</div>
```

### Markdown Styling
**File**: `/src/components/session/markdown-renderer.tsx`

Custom component overrides for `<ReactMarkdown>`:
- **Headings**: `text-xl`, `text-lg`, `text-base` with `font-semibold`
- **Code blocks**: Custom `CodeBlock` component with copy button
- **Inline code**: `bg-muted/50 text-primary/90 px-1 py-0.5 rounded text-xs font-mono`
- **Links**: `text-primary hover:underline`
- **Blockquotes**: `border-l-2 border-primary/50 italic`
- **Tables**: With striping and borders

---

## 6. CURRENT TIMESTAMP USAGE

### Where Timestamps Are Already Displayed:

#### 1. Session Created Time (Sidebar)
**File**: `/src/app/sessions/[id]/page.tsx` lines 387-395
```typescript
{metadata.createdAt && (
  <div className="space-y-1">
    <div className="flex items-center gap-1.5">
      <Clock className="h-3 w-3 text-muted-foreground" />
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Created</p>
    </div>
    <p className="text-xs">{new Date(metadata.createdAt).toLocaleString()}</p>
  </div>
)}
```

#### 2. Session Card - Relative Time
**File**: `/src/components/fleet/session-card.tsx` lines 56-63, 135-138
```typescript
function timeSince(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Used in:
<span className="ml-auto flex items-center gap-1">
  <Clock className="h-3 w-3" />
  {timeSince(session.createdAt)}
</span>
```

#### 3. Activity Stream (Legacy) - Exact Time
**File**: `/src/components/session/activity-stream.tsx` lines 37-44, 208-210
```typescript
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Used in:
<time className="text-[10px] text-muted-foreground whitespace-nowrap pt-0.5">
  {formatTime(event.timestamp)}
</time>
```

---

## 7. KEY FILES & THEIR ROLES

| File | Lines | Purpose | Relevant Features |
|------|-------|---------|-------------------|
| `/src/lib/api-types.ts` | 215 | Message & API types | `AccumulatedMessage` (has createdAt/completedAt) |
| `/src/components/session/activity-stream-v1.tsx` | 350 | **Main message display** | Renders agent, model, duration, cost — NO timestamps |
| `/src/components/session/activity-stream.tsx` | 216 | Legacy event stream | Displays timestamps (formatTime) |
| `/src/hooks/use-session-events.ts` | 268 | SSE + message loading | Captures & merges timestamps from API |
| `/src/lib/event-state.ts` | 223 | State update helpers | ensureMessage/mergeMessageUpdate preserve timestamps |
| `/src/app/sessions/[id]/page.tsx` | 498 | Session detail page | Shows session creation time in sidebar |
| `/src/components/fleet/session-card.tsx` | 159 | Session listing card | Displays relative time via timeSince() |
| `/src/lib/format-utils.ts` | 70 | Format utilities | formatTokens, formatCost, formatDuration |
| `/src/app/globals.css` | 190 | Global styles | Tailwind theme, color system, markdown prose |
| `/src/components/session/markdown-renderer.tsx` | 222 | Markdown → HTML | Custom code blocks with copy button |

---

## 8. SUMMARY: ADDING MESSAGE TIMESTAMPS

### Current State:
✅ **Timestamps captured in data model** — `createdAt` and `completedAt` fields on `AccumulatedMessage`
✅ **Loaded from API** — `use-session-events.ts` extracts `msg.info.time.created`
✅ **Merged in real-time** — SSE events update timestamps when messages complete
❌ **Not displayed** — ActivityStreamV1 component does NOT render message timestamps

### What's Ready:
1. **Type system** — `AccumulatedMessage.createdAt?: number` is defined
2. **Data flow** — Timestamps flow from SDK → API → hook → component
3. **Styling system** — Tailwind + shadcn/ui ready to style timestamp display
4. **Icon library** — lucide-react has Clock, Calendar, Zap icons
5. **Timestamp parsing** — SDK provides milliseconds since epoch
6. **Time formatting** — Can use `new Date(ms).toLocaleTimeString()` or similar

### To Add Timestamps:
1. **Modify MessageItem** in ActivityStreamV1 (line 129-225)
2. **Format timestamps** — Use ISO time, relative time, or "HH:MM" format
3. **Position** — Right side of metadata row (next to/instead of current duration)
4. **Styling** — Add `text-[10px] text-muted-foreground` class
5. **Icon** — Add Clock icon from lucide-react

---

## 9. TESTING & VERIFICATION

### Unit Tests Exist For:
- `/src/lib/__tests__/event-state.test.ts` (434 lines)
  - Tests `ensureMessage()` preserving createdAt (line 57-60)
  - Tests message creation flow

### No Component Tests For:
- MessageItem timestamp rendering (doesn't exist yet)

---

## 10. TECHNOLOGY STACK SUMMARY

| Category | Tech | Version | Purpose |
|----------|------|---------|---------|
| **Framework** | Next.js | 16.1.6 | App router, SSR, API routes |
| **UI Library** | React | 19.2.3 | Component framework |
| **Language** | TypeScript | 5.x | Type safety |
| **Styling** | Tailwind CSS | v4 | Utility-first CSS |
| **UI Components** | shadcn/ui | 3.8.5 | Pre-built accessible components |
| **Icons** | lucide-react | 0.575.0 | Icon library |
| **Markdown** | react-markdown | 10.1.0 | Markdown rendering |
| **Code Highlighting** | highlight.js + rehype | 11.11.1 | Syntax coloring |
| **Testing** | Vitest | 3.2.4 | Unit tests |
