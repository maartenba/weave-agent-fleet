/**
 * API client — configurable base URL for all frontend API calls.
 *
 * When `NEXT_PUBLIC_API_BASE_URL` is unset (default / standalone mode),
 * paths are returned as-is (relative URLs like `/api/sessions`).
 *
 * When set (e.g. `http://localhost:3000`), paths are prefixed with the
 * base URL to enable cross-origin split-mode development.
 *
 * This is a `NEXT_PUBLIC_` variable — inlined at build time by Next.js.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  ""
);

/**
 * Build a full API URL from a path.
 * @param path - Must start with "/" (e.g. "/api/sessions")
 */
export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

/**
 * Build a full SSE URL from a path. Semantically identical to `apiUrl`
 * but named distinctly for readability at EventSource call sites.
 */
export const sseUrl = apiUrl;

/**
 * Thin wrapper around `fetch()` that prepends the API base URL.
 * Drop-in replacement: `fetch("/api/foo")` → `apiFetch("/api/foo")`.
 */
export function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(apiUrl(path), init);
}
