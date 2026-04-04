/**
 * Monaco Editor Loader Configuration
 *
 * Configures Monaco to use the locally installed `monaco-editor` package
 * instead of loading from CDN. This is critical for Tauri desktop builds
 * where CDN access isn't guaranteed (offline support).
 *
 * Also configures `MonacoEnvironment.getWorker` so that Monaco runs its
 * language services (tokenization, IntelliSense) in web workers instead of
 * on the main thread. Without this, the console warns:
 *   "Could not create web worker(s). Falling back to loading web worker
 *    code in main thread, which might cause UI freezes."
 *
 * Import and call `configureMonacoLoader()` once before any Editor component mounts.
 * This is done inside the MonacoEditorWrapper via the `beforeMount` callback.
 */

import type { loader as LoaderType } from "@monaco-editor/react";

let workersConfigured = false;

/**
 * Set up `window.MonacoEnvironment.getWorker` so Monaco can spawn web
 * workers for language services. Each language label maps to a dedicated
 * worker entry point; everything else falls back to the generic editor
 * worker.
 */
function configureMonacoWorkers(): void {
  if (typeof window === "undefined" || workersConfigured) return;
  workersConfigured = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
            { type: "module" }
          );
        case "css":
        case "scss":
        case "less":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
            { type: "module" }
          );
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
            { type: "module" }
          );
        case "typescript":
        case "javascript":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
            { type: "module" }
          );
        default:
          return new Worker(
            new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
            { type: "module" }
          );
      }
    },
  };
}

export async function configureMonacoLoader(loader: typeof LoaderType): Promise<void> {
  // Set up web workers (only once — window.MonacoEnvironment persists)
  configureMonacoWorkers();

  // Always (re-)configure the @monaco-editor/react loader. Its internal
  // state is cleared when the React component tree unmounts (e.g. tab
  // switch), so we must call `loader.config()` on every mount — not just
  // the first. The dynamic `import("monaco-editor")` is cached by the JS
  // module system, so the only real cost is the `loader.config()` call
  // which is idempotent.
  const monaco = await import("monaco-editor");
  loader.config({ monaco });
}

export function resetMonacoLoaderConfig(): void {
  // Only used in tests
  workersConfigured = false;
}
