/**
 * V1 API types — request/response shapes for the orchestrator API layer.
 * These are the types shared between API routes, React hooks, and UI components.
 */

import type { Session, Part, SessionStatus } from "@opencode-ai/sdk";

// Re-export SDK types used across the UI
export type { Session as SDKSession, Part, SessionStatus };

// ─── Request/Response Shapes ───────────────────────────────────────────────

export interface CreateSessionRequest {
  directory: string;
  title?: string;
  isolationStrategy?: "existing" | "worktree" | "clone";
  branch?: string;
}

export interface CreateSessionResponse {
  instanceId: string;
  workspaceId: string;
  session: Session;
}

export interface SendPromptRequest {
  instanceId: string;
  text: string;
}

// ─── Session List ──────────────────────────────────────────────────────────

export interface SessionListItem {
  instanceId: string;
  workspaceId: string;
  workspaceDirectory: string;
  workspaceDisplayName: string | null;
  isolationStrategy: string;
  sessionStatus: "active" | "stopped" | "disconnected";
  session: Session;
  /** "running" means the OpenCode process is healthy */
  instanceStatus: "running" | "dead";
}

// ─── Streamed Event Model ──────────────────────────────────────────────────

/**
 * The simplified event model sent from the SSE proxy to the browser.
 * Each event carries the raw SDK event type + properties for the client
 * to handle — we avoid mapping here to stay close to the SDK source of truth.
 */
export interface SSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
}

// ─── Accumulated Message (for useSessionEvents) ────────────────────────────

export interface AccumulatedTextPart {
  partId: string;
  type: "text";
  text: string;
}

export interface AccumulatedToolPart {
  partId: string;
  type: "tool";
  tool: string;
  callId: string;
  state: Part extends { type: "tool"; state: infer S } ? S : unknown;
}

export type AccumulatedPart = AccumulatedTextPart | AccumulatedToolPart;

export interface AccumulatedMessage {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: AccumulatedPart[];
  /** Cost in USD — populated from step-finish parts */
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number };
  /** ISO timestamp */
  createdAt?: number;
}

// ─── Autocomplete Types ─────────────────────────────────────────────────────

/** Slim command shape returned by GET /api/instances/[id]/commands */
export interface AutocompleteCommand {
  name: string;
  description?: string;
}

/** Slim agent shape returned by GET /api/instances/[id]/agents */
export interface AutocompleteAgent {
  name: string;
  description?: string;
  mode: string;
  color?: string;
}

// File search returns Array<string> (file paths) — no wrapper type needed
