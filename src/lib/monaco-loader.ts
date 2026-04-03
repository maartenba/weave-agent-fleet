/**
 * Monaco Editor Loader Configuration
 *
 * Configures Monaco to use the locally installed `monaco-editor` package
 * instead of loading from CDN. This is critical for Tauri desktop builds
 * where CDN access isn't guaranteed (offline support).
 *
 * Import and call `configureMonacoLoader()` once before any Editor component mounts.
 * This is done inside the MonacoEditorWrapper via the `beforeMount` callback.
 */

import type { loader as LoaderType } from "@monaco-editor/react";

let configured = false;

export async function configureMonacoLoader(loader: typeof LoaderType): Promise<void> {
  if (configured) return;
  configured = true;

  // Point Monaco loader at the local npm package instead of CDN.
  // In a Next.js / Tauri environment, this prevents any outbound network
  // requests for the editor assets.
  const monaco = await import("monaco-editor");
  loader.config({ monaco });
}

export function resetMonacoLoaderConfig(): void {
  // Only used in tests
  configured = false;
}
