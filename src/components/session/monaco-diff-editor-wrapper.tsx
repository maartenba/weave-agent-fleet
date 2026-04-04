"use client";

import { useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { BeforeMount, DiffOnMount } from "@monaco-editor/react";
import { useTheme } from "@/contexts/theme-context";
import { registerMonacoThemes, WEAVE_MONACO_THEME_MAP } from "@/lib/monaco-themes";
import { configureMonacoLoader } from "@/lib/monaco-loader";
import { Loader2 } from "lucide-react";

// ─── Dynamic import — client-only, never SSR ─────────────────────────────────

const MonacoDiffReactEditor = dynamic(
  () =>
    import("@monaco-editor/react").then((mod) => {
      return { default: mod.DiffEditor };
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

export interface MonacoDiffEditorWrapperProps {
  /** The git "before" content (original side) */
  original: string;
  /** The current file content (modified side) */
  modified: string;
  language: string;
  /** Called when the user edits the modified side */
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MonacoDiffEditorWrapper({
  original,
  modified,
  language,
  onChange,
  readOnly = false,
}: MonacoDiffEditorWrapperProps) {
  const { theme } = useTheme();
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null);
  const themesRegisteredRef = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const currentMonacoTheme = WEAVE_MONACO_THEME_MAP[theme] ?? "weave-default";

  // Keep a ref to the diff editor so we can dispose it before React unmounts
  const diffEditorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const contentListenerRef = useRef<{ dispose: () => void } | null>(null);

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

  // Configure the Monaco loader on mount (re-runs after tab-switch remounts)
  useEffect(() => {
    import("@monaco-editor/react").then((mod) => {
      configureMonacoLoader(mod.loader);
    });
  }, []);

  const handleMount: DiffOnMount = useCallback((editor) => {
    diffEditorRef.current = editor;
    const modifiedEditor = editor.getModifiedEditor();
    contentListenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
      const value = modifiedEditor.getValue();
      onChangeRef.current?.(value);
    });
  }, []);

  // Dispose the diff editor *before* React unmounts the DOM node.
  // This prevents the "TextModel disposed before DiffEditorWidget reset" race:
  // we tell the DiffEditor to release its model references first, then React
  // can safely tear down the DOM.
  useEffect(() => {
    return () => {
      contentListenerRef.current?.dispose();
      contentListenerRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
    };
  }, []);

  // When theme changes, update Monaco theme without remounting
  useEffect(() => {
    if (monacoRef.current && themesRegisteredRef.current) {
      monacoRef.current.editor.setTheme(currentMonacoTheme);
    }
  }, [currentMonacoTheme]);

  const sharedEditorOptions = {
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbers: "on" as const,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    padding: { top: 8, bottom: 8 },
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    wordWrap: "on" as const,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MonacoDiffReactEditor
        theme={currentMonacoTheme}
        language={language}
        original={original}
        modified={modified}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          ...sharedEditorOptions,
          readOnly,
          renderSideBySide: true,
          originalEditable: false,
        }}
        height="100%"
        width="100%"
      />
    </div>
  );
}
