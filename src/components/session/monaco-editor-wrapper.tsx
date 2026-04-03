"use client";

import { useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { OnMount, BeforeMount } from "@monaco-editor/react";
import { useTheme } from "@/contexts/theme-context";
import { registerMonacoThemes, WEAVE_MONACO_THEME_MAP } from "@/lib/monaco-themes";
import { configureMonacoLoader } from "@/lib/monaco-loader";
import { Loader2 } from "lucide-react";

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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MonacoEditorWrapper({
  content,
  language,
  onChange,
  onSave,
  readOnly = false,
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
          glyphMargin: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
        }}
        height="100%"
        width="100%"
      />
    </div>
  );
}
