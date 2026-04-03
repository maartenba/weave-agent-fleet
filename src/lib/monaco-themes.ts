/**
 * Monaco Editor Theme Definitions
 *
 * Defines 9 custom Monaco themes that match each Weave Fleet theme's CSS palette.
 * Themes are registered once via `registerMonacoThemes(monaco)` before the editor mounts.
 *
 * Theme map:
 *   default         → weave-default    (dark slate / vs-dark base)
 *   black           → weave-black      (OLED / vs-dark base)
 *   light           → weave-light      (light / vs base)
 *   nord            → weave-nord       (nord / vs-dark base)
 *   dracula         → weave-dracula    (dracula / vs-dark base)
 *   solarized-dark  → weave-solarized-dark
 *   solarized-light → weave-solarized-light
 *   monokai         → weave-monokai
 *   github-dark     → weave-github-dark
 */

import type { Theme } from "@/contexts/theme-context";

// Monaco's editor module type (avoid importing the heavy bundle at the module level)
type Monaco = typeof import("monaco-editor");

export const WEAVE_MONACO_THEME_MAP: Record<Theme, string> = {
  default: "weave-default",
  black: "weave-black",
  light: "weave-light",
  nord: "weave-nord",
  dracula: "weave-dracula",
  "solarized-dark": "weave-solarized-dark",
  "solarized-light": "weave-solarized-light",
  monokai: "weave-monokai",
  "github-dark": "weave-github-dark",
};

export function registerMonacoThemes(monaco: Monaco): void {
  // ── Default (dark slate) ────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-default", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "94A3B8", fontStyle: "italic" },
      { token: "keyword", foreground: "A855F7" },
      { token: "string", foreground: "86EFAC" },
      { token: "number", foreground: "FB923C" },
      { token: "type", foreground: "67E8F9" },
      { token: "class", foreground: "FDE047" },
      { token: "function", foreground: "60A5FA" },
      { token: "variable", foreground: "F8FAFC" },
      { token: "constant", foreground: "F472B6" },
    ],
    colors: {
      "editor.background": "#0F172A",
      "editor.foreground": "#F8FAFC",
      "editor.lineHighlightBackground": "#1E293B",
      "editor.selectionBackground": "#A855F740",
      "editor.inactiveSelectionBackground": "#A855F720",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94A3B8",
      "editorGutter.background": "#0F172A",
      "editorWidget.background": "#1E293B",
      "editorWidget.border": "#334155",
      "editorSuggestWidget.background": "#1E293B",
      "editorSuggestWidget.border": "#334155",
      "editorSuggestWidget.selectedBackground": "#334155",
      "editorCursor.foreground": "#A855F7",
      "editor.findMatchBackground": "#A855F740",
      "editor.findMatchHighlightBackground": "#A855F720",
      "editorIndentGuide.background1": "#1E293B",
      "editorIndentGuide.activeBackground1": "#334155",
      "scrollbarSlider.background": "#33415580",
      "scrollbarSlider.hoverBackground": "#475569",
      "scrollbarSlider.activeBackground": "#64748B",
    },
  });

  // ── Black (OLED) ────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-black", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "A1A1AA", fontStyle: "italic" },
      { token: "keyword", foreground: "A855F7" },
      { token: "string", foreground: "86EFAC" },
      { token: "number", foreground: "FB923C" },
      { token: "type", foreground: "67E8F9" },
      { token: "class", foreground: "FDE047" },
      { token: "function", foreground: "60A5FA" },
      { token: "variable", foreground: "FAFAFA" },
      { token: "constant", foreground: "F472B6" },
    ],
    colors: {
      "editor.background": "#000000",
      "editor.foreground": "#FAFAFA",
      "editor.lineHighlightBackground": "#0A0A0A",
      "editor.selectionBackground": "#A855F740",
      "editor.inactiveSelectionBackground": "#A855F720",
      "editorLineNumber.foreground": "#3F3F46",
      "editorLineNumber.activeForeground": "#A1A1AA",
      "editorGutter.background": "#000000",
      "editorWidget.background": "#0A0A0A",
      "editorWidget.border": "#1A1A1A",
      "editorSuggestWidget.background": "#0A0A0A",
      "editorSuggestWidget.border": "#1A1A1A",
      "editorSuggestWidget.selectedBackground": "#1A1A1A",
      "editorCursor.foreground": "#A855F7",
      "editor.findMatchBackground": "#A855F740",
      "editor.findMatchHighlightBackground": "#A855F720",
      "editorIndentGuide.background1": "#0A0A0A",
      "editorIndentGuide.activeBackground1": "#1A1A1A",
      "scrollbarSlider.background": "#1A1A1A80",
      "scrollbarSlider.hoverBackground": "#2A2A2A",
      "scrollbarSlider.activeBackground": "#3F3F46",
    },
  });

  // ── Light ───────────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "64748B", fontStyle: "italic" },
      { token: "keyword", foreground: "9333EA" },
      { token: "string", foreground: "16A34A" },
      { token: "number", foreground: "EA580C" },
      { token: "type", foreground: "0284C7" },
      { token: "class", foreground: "B45309" },
      { token: "function", foreground: "2563EB" },
      { token: "variable", foreground: "0F172A" },
      { token: "constant", foreground: "DB2777" },
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#0F172A",
      "editor.lineHighlightBackground": "#F1F5F9",
      "editor.selectionBackground": "#9333EA30",
      "editor.inactiveSelectionBackground": "#9333EA18",
      "editorLineNumber.foreground": "#CBD5E1",
      "editorLineNumber.activeForeground": "#64748B",
      "editorGutter.background": "#FFFFFF",
      "editorWidget.background": "#FFFFFF",
      "editorWidget.border": "#E2E8F0",
      "editorSuggestWidget.background": "#FFFFFF",
      "editorSuggestWidget.border": "#E2E8F0",
      "editorSuggestWidget.selectedBackground": "#F1F5F9",
      "editorCursor.foreground": "#9333EA",
      "editor.findMatchBackground": "#9333EA30",
      "editor.findMatchHighlightBackground": "#9333EA18",
      "editorIndentGuide.background1": "#E2E8F0",
      "editorIndentGuide.activeBackground1": "#CBD5E1",
      "scrollbarSlider.background": "#CBD5E180",
      "scrollbarSlider.hoverBackground": "#94A3B8",
      "scrollbarSlider.activeBackground": "#64748B",
    },
  });

  // ── Nord ────────────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-nord", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "616E88", fontStyle: "italic" },
      { token: "keyword", foreground: "81A1C1" },
      { token: "string", foreground: "A3BE8C" },
      { token: "number", foreground: "B48EAD" },
      { token: "type", foreground: "8FBCBB" },
      { token: "class", foreground: "EBCB8B" },
      { token: "function", foreground: "88C0D0" },
      { token: "variable", foreground: "ECEFF4" },
      { token: "constant", foreground: "D08770" },
    ],
    colors: {
      "editor.background": "#2E3440",
      "editor.foreground": "#ECEFF4",
      "editor.lineHighlightBackground": "#3B4252",
      "editor.selectionBackground": "#88C0D030",
      "editor.inactiveSelectionBackground": "#88C0D018",
      "editorLineNumber.foreground": "#4C566A",
      "editorLineNumber.activeForeground": "#D8DEE9",
      "editorGutter.background": "#2E3440",
      "editorWidget.background": "#3B4252",
      "editorWidget.border": "#434C5E",
      "editorSuggestWidget.background": "#3B4252",
      "editorSuggestWidget.border": "#434C5E",
      "editorSuggestWidget.selectedBackground": "#434C5E",
      "editorCursor.foreground": "#88C0D0",
      "editor.findMatchBackground": "#88C0D030",
      "editor.findMatchHighlightBackground": "#88C0D018",
      "editorIndentGuide.background1": "#3B4252",
      "editorIndentGuide.activeBackground1": "#434C5E",
      "scrollbarSlider.background": "#434C5E80",
      "scrollbarSlider.hoverBackground": "#4C566A",
      "scrollbarSlider.activeBackground": "#616E88",
    },
  });

  // ── Dracula ─────────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-dracula", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6272A4", fontStyle: "italic" },
      { token: "keyword", foreground: "FF79C6" },
      { token: "string", foreground: "F1FA8C" },
      { token: "number", foreground: "BD93F9" },
      { token: "type", foreground: "8BE9FD" },
      { token: "class", foreground: "50FA7B" },
      { token: "function", foreground: "50FA7B" },
      { token: "variable", foreground: "F8F8F2" },
      { token: "constant", foreground: "BD93F9" },
    ],
    colors: {
      "editor.background": "#282A36",
      "editor.foreground": "#F8F8F2",
      "editor.lineHighlightBackground": "#44475A",
      "editor.selectionBackground": "#BD93F940",
      "editor.inactiveSelectionBackground": "#BD93F920",
      "editorLineNumber.foreground": "#6272A4",
      "editorLineNumber.activeForeground": "#BFBFBF",
      "editorGutter.background": "#282A36",
      "editorWidget.background": "#343746",
      "editorWidget.border": "#44475A",
      "editorSuggestWidget.background": "#343746",
      "editorSuggestWidget.border": "#44475A",
      "editorSuggestWidget.selectedBackground": "#44475A",
      "editorCursor.foreground": "#BD93F9",
      "editor.findMatchBackground": "#BD93F940",
      "editor.findMatchHighlightBackground": "#BD93F920",
      "editorIndentGuide.background1": "#343746",
      "editorIndentGuide.activeBackground1": "#44475A",
      "scrollbarSlider.background": "#44475A80",
      "scrollbarSlider.hoverBackground": "#6272A4",
      "scrollbarSlider.activeBackground": "#BD93F9",
    },
  });

  // ── Solarized Dark ──────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-solarized-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "586E75", fontStyle: "italic" },
      { token: "keyword", foreground: "859900" },
      { token: "string", foreground: "2AA198" },
      { token: "number", foreground: "D33682" },
      { token: "type", foreground: "268BD2" },
      { token: "class", foreground: "B58900" },
      { token: "function", foreground: "268BD2" },
      { token: "variable", foreground: "FDF6E3" },
      { token: "constant", foreground: "CB4B16" },
    ],
    colors: {
      "editor.background": "#002B36",
      "editor.foreground": "#FDF6E3",
      "editor.lineHighlightBackground": "#073642",
      "editor.selectionBackground": "#268BD240",
      "editor.inactiveSelectionBackground": "#268BD220",
      "editorLineNumber.foreground": "#586E75",
      "editorLineNumber.activeForeground": "#839496",
      "editorGutter.background": "#002B36",
      "editorWidget.background": "#073642",
      "editorWidget.border": "#0A4655",
      "editorSuggestWidget.background": "#073642",
      "editorSuggestWidget.border": "#0A4655",
      "editorSuggestWidget.selectedBackground": "#0A4655",
      "editorCursor.foreground": "#268BD2",
      "editor.findMatchBackground": "#268BD240",
      "editor.findMatchHighlightBackground": "#268BD220",
      "editorIndentGuide.background1": "#073642",
      "editorIndentGuide.activeBackground1": "#0A4655",
      "scrollbarSlider.background": "#0A465580",
      "scrollbarSlider.hoverBackground": "#586E75",
      "scrollbarSlider.activeBackground": "#839496",
    },
  });

  // ── Solarized Light ─────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-solarized-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "93A1A1", fontStyle: "italic" },
      { token: "keyword", foreground: "859900" },
      { token: "string", foreground: "2AA198" },
      { token: "number", foreground: "D33682" },
      { token: "type", foreground: "268BD2" },
      { token: "class", foreground: "B58900" },
      { token: "function", foreground: "268BD2" },
      { token: "variable", foreground: "073642" },
      { token: "constant", foreground: "CB4B16" },
    ],
    colors: {
      "editor.background": "#FDF6E3",
      "editor.foreground": "#073642",
      "editor.lineHighlightBackground": "#EEE8D5",
      "editor.selectionBackground": "#268BD230",
      "editor.inactiveSelectionBackground": "#268BD218",
      "editorLineNumber.foreground": "#C8BBA0",
      "editorLineNumber.activeForeground": "#657B83",
      "editorGutter.background": "#FDF6E3",
      "editorWidget.background": "#EEE8D5",
      "editorWidget.border": "#D6CDB7",
      "editorSuggestWidget.background": "#EEE8D5",
      "editorSuggestWidget.border": "#D6CDB7",
      "editorSuggestWidget.selectedBackground": "#D6CDB7",
      "editorCursor.foreground": "#268BD2",
      "editor.findMatchBackground": "#268BD230",
      "editor.findMatchHighlightBackground": "#268BD218",
      "editorIndentGuide.background1": "#EEE8D5",
      "editorIndentGuide.activeBackground1": "#D6CDB7",
      "scrollbarSlider.background": "#D6CDB780",
      "scrollbarSlider.hoverBackground": "#93A1A1",
      "scrollbarSlider.activeBackground": "#657B83",
    },
  });

  // ── Monokai ─────────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-monokai", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "75715E", fontStyle: "italic" },
      { token: "keyword", foreground: "F92672" },
      { token: "string", foreground: "E6DB74" },
      { token: "number", foreground: "AE81FF" },
      { token: "type", foreground: "66D9EF" },
      { token: "class", foreground: "A6E22E" },
      { token: "function", foreground: "A6E22E" },
      { token: "variable", foreground: "F8F8F2" },
      { token: "constant", foreground: "AE81FF" },
    ],
    colors: {
      "editor.background": "#272822",
      "editor.foreground": "#F8F8F2",
      "editor.lineHighlightBackground": "#3E3D32",
      "editor.selectionBackground": "#49483E",
      "editor.inactiveSelectionBackground": "#49483E80",
      "editorLineNumber.foreground": "#75715E",
      "editorLineNumber.activeForeground": "#B3B3A6",
      "editorGutter.background": "#272822",
      "editorWidget.background": "#3E3D32",
      "editorWidget.border": "#49483E",
      "editorSuggestWidget.background": "#3E3D32",
      "editorSuggestWidget.border": "#49483E",
      "editorSuggestWidget.selectedBackground": "#49483E",
      "editorCursor.foreground": "#F8F8F2",
      "editor.findMatchBackground": "#E6DB7440",
      "editor.findMatchHighlightBackground": "#E6DB7420",
      "editorIndentGuide.background1": "#3E3D32",
      "editorIndentGuide.activeBackground1": "#49483E",
      "scrollbarSlider.background": "#49483E80",
      "scrollbarSlider.hoverBackground": "#75715E",
      "scrollbarSlider.activeBackground": "#B3B3A6",
    },
  });

  // ── GitHub Dark ─────────────────────────────────────────────────────────
  monaco.editor.defineTheme("weave-github-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B949E", fontStyle: "italic" },
      { token: "keyword", foreground: "FF7B72" },
      { token: "string", foreground: "A5D6FF" },
      { token: "number", foreground: "79C0FF" },
      { token: "type", foreground: "FFA657" },
      { token: "class", foreground: "7EE787" },
      { token: "function", foreground: "D2A8FF" },
      { token: "variable", foreground: "E6EDF3" },
      { token: "constant", foreground: "79C0FF" },
    ],
    colors: {
      "editor.background": "#0D1117",
      "editor.foreground": "#E6EDF3",
      "editor.lineHighlightBackground": "#161B22",
      "editor.selectionBackground": "#58A6FF40",
      "editor.inactiveSelectionBackground": "#58A6FF20",
      "editorLineNumber.foreground": "#484F58",
      "editorLineNumber.activeForeground": "#8B949E",
      "editorGutter.background": "#0D1117",
      "editorWidget.background": "#161B22",
      "editorWidget.border": "#30363D",
      "editorSuggestWidget.background": "#161B22",
      "editorSuggestWidget.border": "#30363D",
      "editorSuggestWidget.selectedBackground": "#21262D",
      "editorCursor.foreground": "#58A6FF",
      "editor.findMatchBackground": "#58A6FF40",
      "editor.findMatchHighlightBackground": "#58A6FF20",
      "editorIndentGuide.background1": "#161B22",
      "editorIndentGuide.activeBackground1": "#21262D",
      "scrollbarSlider.background": "#21262D80",
      "scrollbarSlider.hoverBackground": "#30363D",
      "scrollbarSlider.activeBackground": "#484F58",
    },
  });
}
