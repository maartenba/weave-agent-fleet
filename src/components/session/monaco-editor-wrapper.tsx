"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import { useTheme } from "@/contexts/theme-context";
import { registerMonacoThemes, WEAVE_MONACO_THEME_MAP } from "@/lib/monaco-themes";
import { configureMonacoLoader } from "@/lib/monaco-loader";
import { Loader2 } from "lucide-react";
import { computeLineChanges } from "@/lib/line-diff";

// ─── Dynamic import — client-only, never SSR ─────────────────────────────────

const MonacoReactEditor = dynamic(
  () =>
    import("@monaco-editor/react").then((mod) => {
      // Configure local loader on first dynamic import
      return import("@monaco-editor/react").then((m) => {
        configureMonacoLoader(m.loader);
        return mod;
      });
    }),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--background)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

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
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const currentMonacoTheme = WEAVE_MONACO_THEME_MAP[theme] ?? "weave-default";

  // Register themes before first mount
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

  // Wire up Cmd+S / Ctrl+S save shortcut inside the editor
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      editor.addAction({
        id: "weave-save-file",
        label: "Save File",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          onSaveRef.current?.();
        },
      });
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

  // Apply Monaco deltaDecorations for git line changes
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) return;

    if (gitBeforeContent === undefined) {
      // Clear decorations when no git context
      if (decorationsRef.current.length > 0) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }

    const changes = computeLineChanges(gitBeforeContent, debouncedContent);
    const newDecorations = changes.map((change) => {
      const colorKey =
        change.type === "added" ? "git-added" :
        change.type === "modified" ? "git-modified" :
        "git-deleted";

      if (change.type === "deleted") {
        return {
          range: new monaco.Range(change.startLine, 1, change.endLine, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: `glyph-margin-${colorKey}`,
            overviewRuler: {
              color: "#ef4444",
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        };
      }

      return {
        range: new monaco.Range(change.startLine, 1, change.endLine, 1),
        options: {
          isWholeLine: true,
          className: `line-${colorKey}`,
          glyphMarginClassName: `glyph-margin-${colorKey}`,
          overviewRuler: {
            color: change.type === "added" ? "#22c55e" : "#f59e0b",
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      };
    });

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    );
  }, [gitBeforeContent, debouncedContent]);

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
