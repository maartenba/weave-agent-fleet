"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import { useTheme } from "@/contexts/theme-context";
import { registerMonacoThemes, WEAVE_MONACO_THEME_MAP } from "@/lib/monaco-themes";
import { configureMonacoLoader } from "@/lib/monaco-loader";
import { Loader2 } from "lucide-react";
import { computeLineChanges, computeHunks, applyHunkRevert } from "@/lib/line-diff";
import type { Hunk } from "@/lib/line-diff";

// ─── Dynamic import — client-only, never SSR ─────────────────────────────────

const MonacoReactEditor = dynamic(
  () => import("@monaco-editor/react"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--background)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

// ─── Hover message helpers ────────────────────────────────────────────────────

function buildHoverMessage(hunk: Hunk, language: string): { value: string } {
  if (hunk.type === "added") {
    return { value: "*New lines — no previous content*" };
  }
  const oldCode = hunk.oldLines.join("\n");
  return { value: `**Previous:**\n\`\`\`${language}\n${oldCode}\n\`\`\`` };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MonacoEditorWrapperProps {
  content: string;
  language: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  filePath?: string;
  /** Git "before" content for inline diff decorations */
  gitBeforeContent?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MonacoEditorWrapper({
  content,
  language,
  onChange,
  onSave,
  readOnly = false,
  gitBeforeContent,
}: MonacoEditorWrapperProps) {
  const { theme } = useTheme();
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const themesRegisteredRef = useRef(false);
  const onSaveRef = useRef(onSave);
  // Refs for values needed by applyDecorations (called from both useEffect and handleMount)
  const gitBeforeContentRef = useRef(gitBeforeContent);
  const languageRef = useRef(language);
  // Ref to current hunks — updated by decoration effect, consumed by mouse handler
  const hunksRef = useRef<Hunk[]>([]);
  // Ref to current content — needed by revert handler without causing stale closure
  const contentRef = useRef(content);
  // Ref to debounced content — used by applyDecorations (called from handleMount)
  const debouncedContentRef = useRef(content);
  // Ref to the decoration-application function — allows handleMount to call it
  // without needing useState (which would cause a re-render during mount and
  // break tab switching).
  const applyDecorationsRef = useRef<() => void>(() => {});

  useEffect(() => {
    onSaveRef.current = onSave;
  });
  useEffect(() => {
    contentRef.current = content;
  });
  useEffect(() => {
    gitBeforeContentRef.current = gitBeforeContent;
  });
  useEffect(() => {
    languageRef.current = language;
  });

  const currentMonacoTheme = WEAVE_MONACO_THEME_MAP[theme] ?? "weave-default";

  // Register themes and configure loader before first mount.
  // `beforeMount` runs on every editor mount, so this survives tab switches.
  const handleBeforeMount: BeforeMount = useCallback(
    (monaco) => {
      monacoRef.current = monaco;
      if (!themesRegisteredRef.current) {
        registerMonacoThemes(monaco);
        themesRegisteredRef.current = true;
      }
    },
    []
  );

  // Configure the Monaco loader on mount. We use an effect rather than
  // beforeMount because configureMonacoLoader is async (it dynamically
  // imports monaco-editor). It must re-run after tab-switch remounts
  // because @monaco-editor/react resets its internal loader state on unmount.
  useEffect(() => {
    import("@monaco-editor/react").then((mod) => {
      configureMonacoLoader(mod.loader);
    });
  }, []);

  // Wire up Cmd+S / Ctrl+S save shortcut inside the editor
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Apply gutter decorations now that the editor is ready.
      // We call via a ref instead of using useState to avoid a re-render
      // during Monaco's internal mount sequence (which breaks tab switching).
      applyDecorationsRef.current();

      editor.addAction({
        id: "weave-save-file",
        label: "Save File",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          onSaveRef.current?.();
        },
      });

      // Register hunk revert via right-click context menu (keyboard accessible)
      editor.addAction({
        id: "weave-revert-hunk",
        label: "Revert This Change",
        contextMenuGroupId: "modification",
        contextMenuOrder: 1,
        run: (ed) => {
          const position = ed.getPosition();
          if (!position) return;
          applyHunkRevertInEditor(ed.getModel(), ed, position.lineNumber);
        },
      });

      // Wire gutter click for hunk revert (linesDecorationsClassName region)
      editor.onMouseDown((e) => {
        if (
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS &&
          e.target.element?.classList.contains("lines-decoration-git-revert")
        ) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber !== undefined) {
            applyHunkRevertInEditor(editor.getModel(), editor, lineNumber);
          }
        }
      });

      function applyHunkRevertInEditor(
        model: ReturnType<Parameters<OnMount>[0]["getModel"]>,
        ed: { executeEdits: Parameters<OnMount>[0]["executeEdits"]; getModel: () => typeof model },
        lineNumber: number
      ) {
        const hunks = hunksRef.current;
        const hunk = hunks.find(
          (h) => lineNumber >= h.afterStartLine && lineNumber <= h.afterEndLine
        );
        if (!hunk || !model) return;

        const currentContent = contentRef.current;
        const newContent = applyHunkRevert(currentContent, hunk);

        // Use executeEdits to push onto the undo stack
        const fullRange = model.getFullModelRange();
        ed.executeEdits("weave-hunk-revert", [
          {
            range: fullRange,
            text: newContent,
            forceMoveMarkers: true,
          },
        ]);
      }
    },
    []
  );

  // When theme changes, update Monaco theme without remounting
  useEffect(() => {
    if (monacoRef.current && themesRegisteredRef.current) {
      monacoRef.current.editor.setTheme(currentMonacoTheme);
    }
  }, [currentMonacoTheme]);

  // ── Git inline diff decorations ────────────────────────────────────────────

  // Debounce content changes to avoid recomputing diffs on every keystroke
  const diffDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [debouncedContent, setDebouncedContent] = useState(content);

  useEffect(() => {
    diffDebounceRef.current = setTimeout(() => {
      setDebouncedContent(content);
    }, 300);
    return () => clearTimeout(diffDebounceRef.current);
  }, [content]);

  // Keep debouncedContentRef in sync for applyDecorations
  useEffect(() => {
    debouncedContentRef.current = debouncedContent;
  });

  // Apply Monaco deltaDecorations for git line changes.
  // Stored in a ref so handleMount can call it on initial editor mount
  // without needing a useState trigger (which would cause re-render during
  // mount and break tab switching).
  const decorationsRef = useRef<string[]>([]);

  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) return;

    const beforeContent = gitBeforeContentRef.current;
    const currentContent = debouncedContentRef.current;
    const lang = languageRef.current;

    if (beforeContent === undefined) {
      // Clear decorations when no git context
      if (decorationsRef.current.length > 0) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }

    const changes = computeLineChanges(beforeContent, currentContent);

    // Also compute hunks for hover messages and hunk-revert icons
    const hunks = computeHunks(beforeContent, currentContent);

    // Keep hunks in a ref so the mouse-down handler can access them without a stale closure
    hunksRef.current = hunks;

    // Build a map from after-line-number → hunk for quick hover message lookup
    const lineToHunk = new Map<number, Hunk>();
    for (const hunk of hunks) {
      for (let l = hunk.afterStartLine; l <= hunk.afterEndLine; l++) {
        lineToHunk.set(l, hunk);
      }
    }

    // Track which lines already have a revert icon so we don't double-add
    const revertIconLines = new Set<number>();

    type DecorationItem = {
      range: InstanceType<typeof monaco.Range>;
      options: Record<string, unknown>;
    };

    const newDecorations: DecorationItem[] = changes.flatMap((change) => {
      const colorKey =
        change.type === "added" ? "git-added" :
        change.type === "modified" ? "git-modified" :
        "git-deleted";

      // Build hover message showing the old content for this change
      const hunk = lineToHunk.get(change.startLine);
      const hoverMessage = hunk ? buildHoverMessage(hunk, lang) : undefined;

      const baseDecoration: DecorationItem = change.type === "deleted"
        ? {
            range: new monaco.Range(change.startLine, 1, change.endLine, 1),
            options: {
              isWholeLine: true,
              glyphMarginClassName: `glyph-margin-${colorKey}`,
              glyphMarginHoverMessage: hoverMessage ? [hoverMessage] : undefined,
              overviewRuler: {
                color: "#ef4444",
                position: monaco.editor.OverviewRulerLane.Left,
              },
            },
          }
        : {
            range: new monaco.Range(change.startLine, 1, change.endLine, 1),
            options: {
              isWholeLine: true,
              className: `line-${colorKey}`,
              glyphMarginClassName: `glyph-margin-${colorKey}`,
              glyphMarginHoverMessage: hoverMessage ? [hoverMessage] : undefined,
              overviewRuler: {
                color: change.type === "added" ? "#22c55e" : "#f59e0b",
                position: monaco.editor.OverviewRulerLane.Left,
              },
            },
          };

      const result: DecorationItem[] = [baseDecoration];

      // Add a revert icon on the first line of the hunk (one per hunk)
      const firstLine = change.startLine;
      if (hunk && !revertIconLines.has(firstLine)) {
        revertIconLines.add(firstLine);
        result.push({
          range: new monaco.Range(firstLine, 1, firstLine, 1),
          options: {
            isWholeLine: false,
            linesDecorationsClassName: "lines-decoration-git-revert",
          },
        });
      }

      return result;
    });

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    );
  }, []);

  // Keep the ref pointing to the latest applyDecorations
  applyDecorationsRef.current = applyDecorations;

  // Re-apply decorations whenever relevant props change
  useEffect(() => {
    applyDecorations();
  }, [gitBeforeContent, debouncedContent, language, applyDecorations]);

  // Determine if glyph margin should be enabled (when git context is available)
  const hasGitContext = gitBeforeContent !== undefined;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MonacoReactEditor
        theme={currentMonacoTheme}
        language={language}
        value={content}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={(value) => onChange(value ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: "on",
          renderLineHighlight: "line",
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          padding: { top: 8, bottom: 8 },
          tabSize: 2,
          insertSpaces: true,
          formatOnPaste: false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: false, indentation: true },
          folding: true,
          glyphMargin: hasGitContext,
          overviewRulerLanes: hasGitContext ? 1 : 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
        }}
        height="100%"
        width="100%"
      />
    </div>
  );
}
