# Image Attachments in Fleet Conversations

## TL;DR
> **Summary**: Add support for pasting images into the chat input and sending them as base64-encoded attachments to OpenCode sessions via the existing `FilePartInput` SDK type. Includes thumbnail previews, inline image display in message history, and proper validation.
> **Estimated Effort**: Medium
> **Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/52

## Context

### Original Request
Fleet should support uploading images/attachments to conversations. Users should be able to paste screenshots (`Cmd+V` / `Ctrl+V`) into the chat input, preview them before sending, and see them rendered inline in the conversation history.

### Key Findings

**SDK support is ready.** The OpenCode SDK's `promptAsync()` accepts `parts: Array<TextPartInput | FilePartInput | ...>` where `FilePartInput` is:
```ts
{ type: "file", mime: string, filename?: string, url: string, source?: FilePartSource }
```
The `url` field accepts data URIs (`data:image/png;base64,...`). The prompt API route (`route.ts:52`) currently only sends `[{ type: "text", text }]` — we need to append `FilePartInput` entries.

**Response messages can contain `FilePart`s.** The SDK's `Part` union includes `FilePart` (same shape: `type: "file"`, `mime`, `url`). Currently, `convertSDKMessageToAccumulated()` in `pagination-utils.ts:143-159` and `applyPartUpdate()` in `event-state.ts:81-118` only handle `text`, `tool`, and `step-finish` part types — `file` parts are silently dropped.

**No multipart needed.** The existing JSON `fetch()` in `use-send-prompt.ts` works fine. Base64 in JSON is the chosen transport. Screenshots are typically 300KB–2MB; base64 adds 33% → max ~2.7MB per image. Next.js default body limit is 1MB and needs bumping.

**The `PromptInput` component** (`prompt-input.tsx`) is a controlled `<Textarea>` with autocomplete and history. The `onSend` callback signature is `(text: string, agent?: string) => Promise<void>` — needs extending to accept attachments.

**The `ActivityStreamV1` message renderer** (`activity-stream-v1.tsx:134-236`) filters parts into `textParts` and `toolParts` — file parts need a third rendering path.

### Architecture Flow (Current)
```
PromptInput.onSend(text, agent)
  → SessionDetailPage.handleSend(text, agent)
    → useSendPrompt.sendPrompt(sessionId, instanceId, text, agent)
      → POST /api/sessions/[id]/prompt { instanceId, text, agent }
        → route.ts: client.session.promptAsync({ sessionID, parts: [{ type: "text", text }], agent })
```

### Architecture Flow (Proposed)
```
PromptInput.onSend(text, agent, attachments)
  → SessionDetailPage.handleSend(text, agent, attachments)
    → useSendPrompt.sendPrompt(sessionId, instanceId, text, agent, attachments)
      → POST /api/sessions/[id]/prompt { instanceId, text, agent, attachments: [{ mime, filename, data }] }
        → route.ts: client.session.promptAsync({ sessionID, parts: [
            { type: "text", text },
            { type: "file", mime, url: "data:${mime};base64,${data}" },
            ...
          ], agent })
```

## Objectives

### Core Objective
Enable users to paste images into the Fleet chat input and have them sent to the AI model as image attachments alongside the text prompt, with images displayed inline in the conversation history.

### Deliverables
- [ ] Extended API types and prompt route to accept image attachments
- [ ] Clipboard paste handler in the chat input
- [ ] Thumbnail preview UI for pending attachments
- [ ] Image rendering in the message history (both sent and received)
- [ ] Client-side and server-side validation

### Definition of Done
- [ ] User can paste a PNG/JPEG screenshot into the chat input and see a preview
- [ ] Pressing Enter sends both the text and image to the model
- [ ] The image appears inline in the conversation history (user message)
- [ ] Images in assistant responses (if any) are rendered inline
- [ ] Files > 5MB are rejected with a user-visible error
- [ ] Non-image MIME types are rejected
- [ ] `vitest run` passes with new tests for validation logic
- [ ] `next build` succeeds (no type errors)

### Guardrails (Must NOT)
- Do NOT implement drag-and-drop file upload (future scope)
- Do NOT implement file picker / browse button (future scope)
- Do NOT support non-image MIME types (PDF, etc. — future scope)
- Do NOT store attachments server-side — they live only in the SDK message parts
- Do NOT implement image compression/resizing — send original quality

## TODOs

### Phase 1: Shared Types & Constants

- [ ] 1. **Add attachment type and constants to `api-types.ts`**
  **What**: Define the `ImageAttachment` type and validation constants shared between client and server. Add `AccumulatedFilePart` to the part union used for rendering.
  **Files**: `src/lib/api-types.ts`
  **Changes**:
  ```ts
  // After line 41 (SendPromptRequest)
  export interface ImageAttachment {
    /** MIME type: image/png, image/jpeg, image/gif, image/webp */
    mime: string;
    /** Optional filename for display */
    filename?: string;
    /** Base64-encoded image data (NOT the full data URI — just the base64 payload) */
    data: string;
  }

  export interface SendPromptRequest {
    instanceId: string;
    text: string;
    agent?: string;
    attachments?: ImageAttachment[];  // ← add this field
  }

  // Add to AccumulatedPart union (after AccumulatedToolPart)
  export interface AccumulatedFilePart {
    partId: string;
    type: "file";
    mime: string;
    filename?: string;
    /** Full data URI or URL for rendering */
    url: string;
  }

  export type AccumulatedPart = AccumulatedTextPart | AccumulatedToolPart | AccumulatedFilePart;
  ```
  **Acceptance**: TypeScript compiles. `AccumulatedFilePart` is exported and part of `AccumulatedPart`.

- [ ] 2. **Add image validation utility**
  **What**: Create a shared validation module for image attachments (used by both client and server).
  **Files**: `src/lib/image-validation.ts` (new file)
  **Changes**:
  ```ts
  export const ALLOWED_IMAGE_MIMES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);

  /** 5MB — matches Claude's per-image limit */
  export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /** Maximum number of images per prompt */
  export const MAX_ATTACHMENTS_PER_PROMPT = 10;

  export interface ImageValidationError {
    index: number;
    message: string;
  }

  export function validateImageAttachment(attachment: {
    mime: string;
    data: string;
  }, index: number): ImageValidationError | null {
    if (!ALLOWED_IMAGE_MIMES.has(attachment.mime)) {
      return { index, message: `Unsupported image type: ${attachment.mime}` };
    }
    // Base64 string length → approximate byte size (each char = 6 bits)
    const approxBytes = Math.ceil(attachment.data.length * 3 / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return { index, message: `Image exceeds 5MB limit (${(approxBytes / 1024 / 1024).toFixed(1)}MB)` };
    }
    return null;
  }

  export function validateAttachments(attachments: Array<{ mime: string; data: string }>): ImageValidationError[] {
    const errors: ImageValidationError[] = [];
    if (attachments.length > MAX_ATTACHMENTS_PER_PROMPT) {
      errors.push({ index: -1, message: `Too many images (max ${MAX_ATTACHMENTS_PER_PROMPT})` });
    }
    for (let i = 0; i < attachments.length; i++) {
      const error = validateImageAttachment(attachments[i], i);
      if (error) errors.push(error);
    }
    return errors;
  }
  ```
  **Acceptance**: Utility importable from both `src/app/api/` (server) and `src/components/` (client).

- [ ] 3. **Add unit tests for image validation**
  **What**: Test the validation logic (allowed types, size limits, max attachments).
  **Files**: `src/lib/__tests__/image-validation.test.ts` (new file)
  **Acceptance**: `vitest run src/lib/__tests__/image-validation.test.ts` passes. Covers: valid MIME, invalid MIME, over-size, within-size, max count exceeded.

### Phase 2: Backend — Prompt Route

- [ ] 4. **Update the prompt API route to handle attachments**
  **What**: Parse `attachments` from the request body, validate them server-side, convert each to a `FilePartInput`, and include them in the `parts` array passed to `promptAsync()`.
  **Files**: `src/app/api/sessions/[id]/prompt/route.ts`
  **Changes**:
  - Import `validateAttachments` from `@/lib/image-validation`
  - Import `FilePartInput` from `@opencode-ai/sdk/v2` (or use inline type)
  - After extracting `{ instanceId, text, agent }`, also extract `attachments`
  - If attachments present, validate with `validateAttachments()` — return 400 with error details on failure
  - Build parts array:
    ```ts
    const parts: Array<TextPartInput | FilePartInput> = [
      { type: "text", text: text.trim() },
    ];
    if (attachments?.length) {
      for (const att of attachments) {
        parts.push({
          type: "file",
          mime: att.mime,
          filename: att.filename,
          url: `data:${att.mime};base64,${att.data}`,
        });
      }
    }
    ```
  - Pass `parts` to `promptAsync()`
  - Relax the `text` validation: when attachments are present, text can be empty (user might paste an image with no text). Update the check: `if (!text?.trim() && (!attachments || attachments.length === 0))` return 400.
  **Acceptance**: Route accepts attachments, validates them, passes `FilePartInput` entries to the SDK. Returns 400 for invalid MIME or oversized images.

- [ ] 5. **Bump Next.js body size limit for the prompt route**
  **What**: Set the body size limit to 10MB for the prompt API route. Next.js App Router supports route-level config exports.
  **Files**: `src/app/api/sessions/[id]/prompt/route.ts`
  **Changes**:
  ```ts
  // Add at top level of file (App Router route segment config)
  export const config = {
    api: {
      bodyParser: {
        sizeLimit: '10mb',
      },
    },
  };
  ```
  Note: In App Router, this may need to use `export const maxDuration` or the `NextRequest` has a built-in limit set via `next.config.ts`. Research the exact App Router mechanism:
  - Option A: Set `experimental.serverActions.bodySizeLimit` in `next.config.ts` (affects all routes)
  - Option B: Use a custom body parser check in the route itself
  - The most reliable approach for App Router is setting `bodySizeLimit` in `next.config.ts`:
    ```ts
    // next.config.ts
    const nextConfig: NextConfig = {
      // ... existing config
      experimental: {
        serverActions: {
          bodySizeLimit: '10mb',
        },
      },
    };
    ```
  **Acceptance**: A 5MB base64 payload (≈6.7MB JSON body) is accepted without a 413 error.

- [ ] 6. **Add/update tests for the prompt route**
  **What**: Add test cases for the prompt route covering attachment handling — valid attachments, invalid MIME, oversized file, mixed text+attachments, image-only (no text).
  **Files**: `src/app/api/sessions/[id]/prompt/__tests__/route.test.ts` (new file — no existing tests for prompt route)
  **Acceptance**: Tests pass. Covers: valid attachment forwarded to SDK, invalid MIME returns 400, oversized returns 400, empty text with attachment succeeds.

### Phase 3: Frontend — Clipboard Paste & State

- [ ] 7. **Add clipboard paste handler to `PromptInput`**
  **What**: Listen for `paste` events on the `<Textarea>`. When the clipboard contains image data (`clipboardData.items` with `type.startsWith("image/")`), read it as a `Blob`, convert to base64, and add to a `pendingAttachments` state array. Allow multiple pastes to accumulate.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  - Add state: `const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);`
  - Define type (local or shared):
    ```ts
    interface PendingAttachment {
      id: string;          // crypto.randomUUID() for React key
      mime: string;
      filename: string;    // "pasted-image-1.png"
      data: string;        // base64 (no prefix)
      previewUrl: string;  // object URL for thumbnail (revoke on remove)
    }
    ```
  - Add `onPaste` handler to the `<Textarea>`:
    ```ts
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter(item => item.type.startsWith("image/"));
      if (imageItems.length === 0) return; // let default paste behavior handle text
      e.preventDefault();
      for (const item of imageItems) {
        const blob = item.getAsFile();
        if (!blob) continue;
        // Client-side size check
        if (blob.size > MAX_IMAGE_BYTES) { /* show error */ continue; }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          setPendingAttachments(prev => [...prev, {
            id: crypto.randomUUID(),
            mime: blob.type,
            filename: `pasted-image-${prev.length + 1}.${blob.type.split("/")[1]}`,
            data: base64,
            previewUrl: URL.createObjectURL(blob),
          }]);
        };
        reader.readAsDataURL(blob);
      }
    };
    ```
  - Add `onPaste={handlePaste}` to the `<Textarea>` element
  - Clear `pendingAttachments` after send (in `handleSend`)
  - Revoke object URLs on removal and unmount (`useEffect` cleanup)
  - Update `canSend` logic: allow send when there are pending attachments even if text is empty:
    ```ts
    const canSend = (!!value.trim() || pendingAttachments.length > 0) && !isDisabled && !autocomplete.isOpen;
    ```
  **Acceptance**: Pasting an image via `Cmd+V` adds it to pending state. Pasting text still works normally.

- [ ] 8. **Add attachment preview UI below the input area**
  **What**: When `pendingAttachments.length > 0`, render a row of thumbnail previews above the text input (inside the prompt area). Each thumbnail has a small "×" remove button.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  - Add a preview strip between the error banner and the form:
    ```tsx
    {pendingAttachments.length > 0 && (
      <div className="flex gap-2 flex-wrap px-1">
        {pendingAttachments.map(att => (
          <div key={att.id} className="relative group">
            <img
              src={att.previewUrl}
              alt={att.filename}
              className="h-16 w-16 rounded-md object-cover border border-border"
            />
            <button
              onClick={() => removeAttachment(att.id)}
              className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove ${att.filename}`}
            >
              ×
            </button>
            <span className="text-[9px] text-muted-foreground truncate block w-16 text-center mt-0.5">
              {att.filename}
            </span>
          </div>
        ))}
      </div>
    )}
    ```
  - `removeAttachment` function revokes the object URL and removes from state
  **Acceptance**: Pasted images appear as 64×64 thumbnails. Remove button works. Thumbnails clear after send.

- [ ] 9. **Update `PromptInput.onSend` signature and `handleSend` to pass attachments**
  **What**: Extend the `onSend` callback to accept an optional `attachments` parameter. Wire the pending attachments into the send flow.
  **Files**: `src/components/session/prompt-input.tsx`, `src/app/sessions/[id]/page.tsx`
  **Changes**:
  - `prompt-input.tsx`: Update `PromptInputProps.onSend`:
    ```ts
    onSend?: (text: string, agent?: string, attachments?: ImageAttachment[]) => Promise<void>;
    ```
  - In `handleSend()`, map `pendingAttachments` to `ImageAttachment[]` (drop `id` and `previewUrl` fields) and pass to `onSend`:
    ```ts
    const attachments = pendingAttachments.map(a => ({
      mime: a.mime,
      filename: a.filename,
      data: a.data,
    }));
    await onSend?.(text, selectedAgent ?? undefined, attachments.length > 0 ? attachments : undefined);
    ```
  - `page.tsx` line 193-198: Update `handleSend`:
    ```ts
    const handleSend = useCallback(
      async (text: string, agent?: string, attachments?: ImageAttachment[]) => {
        await sendPrompt(sessionId, instanceId, text, agent, attachments);
      },
      [sendPrompt, sessionId, instanceId]
    );
    ```
  **Acceptance**: Attachments flow from PromptInput → page → hook.

- [ ] 10. **Update `use-send-prompt` hook to include attachments in the POST body**
  **What**: Add `attachments` parameter to the `sendPrompt` function and include it in the JSON body.
  **Files**: `src/hooks/use-send-prompt.ts`
  **Changes**:
  - Update `sendPrompt` signature:
    ```ts
    sendPrompt: (
      sessionId: string,
      instanceId: string,
      text: string,
      agent?: string,
      attachments?: ImageAttachment[]
    ) => Promise<void>;
    ```
  - Include in body: `body: JSON.stringify({ instanceId, text, agent, attachments })`
  **Acceptance**: Network tab shows attachments in POST body when pasted image is sent.

### Phase 4: Frontend — Displaying Images in Message History

- [ ] 11. **Handle `file` parts in `event-state.ts` (SSE streaming)**
  **What**: Update `applyPartUpdate()` to handle `part.type === "file"` — create an `AccumulatedFilePart` and add it to the message's parts array. This handles images that come back in real-time SSE events (e.g., if the user's message is echoed back or the model references images).
  **Files**: `src/lib/event-state.ts`
  **Changes**:
  - Add a `file` case in `applyPartUpdate()` (after the `tool` case, around line 118):
    ```ts
    if (part.type === "file") {
      const newPart: AccumulatedFilePart = {
        partId: part.id,
        type: "file",
        mime: part.mime ?? "",
        filename: part.filename,
        url: part.url ?? "",
      };
      const existing = msg.parts.find((p) => p.partId === part.id);
      if (existing) {
        return {
          ...msg,
          parts: msg.parts.map((p) => (p.partId === part.id ? newPart : p)),
        };
      }
      return { ...msg, parts: [...msg.parts, newPart] };
    }
    ```
  **Acceptance**: File parts from SSE events are accumulated into messages instead of being dropped.

- [ ] 12. **Handle `file` parts in `pagination-utils.ts` (initial load)**
  **What**: Update `convertSDKMessageToAccumulated()` to handle `file` parts when loading message history from the API.
  **Files**: `src/lib/pagination-utils.ts`
  **Changes**:
  - Add a `file` case in the `for (const part of msg.parts)` loop (after the `tool` case, around line 151):
    ```ts
    } else if (part.type === "file") {
      parts.push({
        partId: part.id,
        type: "file",
        mime: (part as any).mime ?? "",
        filename: (part as any).filename,
        url: (part as any).url ?? "",
      });
    }
    ```
  - Update `SDKMessagePart` interface to include optional file fields:
    ```ts
    export interface SDKMessagePart {
      // ... existing fields
      mime?: string;
      filename?: string;
      url?: string;
    }
    ```
  **Acceptance**: File parts in loaded message history are preserved and renderable.

- [ ] 13. **Render image parts inline in `ActivityStreamV1`**
  **What**: In the `MessageItem` component, extract `file` parts alongside `text` and `tool` parts, and render them as `<img>` elements inline in the message.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
  - Update the part filtering in `MessageItem` (around line 141-143):
    ```ts
    const textParts = message.parts.filter((p) => p.type === "text");
    const toolParts = message.parts.filter(
      (p): p is AccumulatedPart & { type: "tool" } => p.type === "tool"
    );
    const fileParts = message.parts.filter(
      (p): p is AccumulatedFilePart => p.type === "file"
    );
    ```
  - Add image rendering section (after tool calls, before text content, around line 218):
    ```tsx
    {/* Image attachments */}
    {fileParts.length > 0 && (
      <div className="flex gap-2 flex-wrap">
        {fileParts.map((part) => (
          <a
            key={part.partId}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <img
              src={part.url}
              alt={part.filename ?? "Image attachment"}
              className="max-h-48 max-w-xs rounded-md border border-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
        ))}
      </div>
    )}
    ```
  - Import `AccumulatedFilePart` from `@/lib/api-types`
  **Acceptance**: Images pasted by the user appear inline in their message bubble. Clicking opens full-size in new tab.

- [ ] 14. **Add tests for file part handling in event-state**
  **What**: Add test cases to the existing `event-state.test.ts` for `applyPartUpdate()` with `type: "file"` parts.
  **Files**: `src/lib/__tests__/event-state.test.ts`
  **Acceptance**: Tests verify that file parts are added, updated, and accumulated correctly.

### Phase 5: Polish & Edge Cases

- [ ] 15. **Handle large base64 in preview (memory management)**
  **What**: Ensure object URLs are properly revoked when attachments are removed or the component unmounts. Use `useEffect` cleanup.
  **Files**: `src/components/session/prompt-input.tsx`
  **Changes**:
  ```ts
  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      pendingAttachments.forEach(a => URL.revokeObjectURL(a.previewUrl));
    };
  }, []); // intentional: cleanup only on unmount, individual removals handle their own revoke
  ```
  **Acceptance**: No memory leaks from object URLs. DevTools memory panel shows cleanup on navigation.

- [ ] 16. **Show error feedback for paste validation failures**
  **What**: When a pasted image is too large or has an invalid type, show a transient error message in the prompt area (reuse the existing `sendError` pattern or add a local `pasteError` state).
  **Files**: `src/components/session/prompt-input.tsx`
  **Acceptance**: Pasting a 6MB PNG shows "Image exceeds 5MB limit" error. Error auto-clears after 5 seconds or on next valid paste.

## Verification

- [ ] All existing tests pass: `vitest run`
- [ ] New tests pass: `vitest run src/lib/__tests__/image-validation.test.ts src/lib/__tests__/event-state.test.ts`
- [ ] Build succeeds: `next build` (no type errors)
- [ ] Manual test: Paste a PNG screenshot into chat input → preview appears → send → image visible in conversation
- [ ] Manual test: Paste oversized image → error shown → not added to pending
- [ ] Manual test: Remove a pending attachment → thumbnail disappears → object URL revoked
- [ ] Manual test: Send text-only prompt still works as before (regression)
- [ ] Manual test: Send image-only (no text) works

## Implementation Order & Dependencies

```
Phase 1 (no deps):     Tasks 1, 2, 3   — types & validation
Phase 2 (needs 1,2):   Tasks 4, 5, 6   — backend route
Phase 3 (needs 1,2):   Tasks 7, 8, 9, 10 — frontend input
Phase 4 (needs 1):     Tasks 11, 12, 13, 14 — message display
Phase 5 (needs 7):     Tasks 15, 16    — polish

Phases 2, 3, 4 can run in parallel after Phase 1.
```

## Potential Pitfalls

| Risk | Mitigation |
|------|------------|
| Next.js App Router body limit is not configurable per-route | Use `next.config.ts` global config or intercept in the route handler with a manual size check before `request.json()` |
| Base64 data URIs in messages are huge and bloat SSE/pagination payloads | Acceptable for V1 — images are already stored as data URIs in the SDK. Future optimization: thumbnail in stream, full image on demand |
| `FilePartInput.url` might not accept data URIs in all SDK versions | Confirmed from SDK type: `url: string` — data URIs are valid URLs. Test with the actual SDK before shipping |
| Object URLs leak memory if not revoked | `useEffect` cleanup on unmount + explicit revoke on remove |
| User pastes non-image binary data from clipboard | Filter `clipboardData.items` by `type.startsWith("image/")` — anything else falls through to default paste behavior |
