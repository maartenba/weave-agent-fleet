/**
 * Shared TypeScript types for the GitHub Device Authorization flow (RFC 8628).
 * Used by both the API routes and the frontend settings component.
 */

// ─── Client-facing types (sent over the wire) ─────────────────────────────────

/**
 * Response from POST /api/integrations/github/auth/device-code.
 * Contains the user-facing code and URL to display, plus the opaque
 * device_code the client must echo back when polling.
 */
export interface DeviceCodeResponse {
  /** The user-facing code to enter at verificationUri (e.g. "WDJB-MJHT") */
  userCode: string;
  /** The URL the user should navigate to (https://github.com/login/device) */
  verificationUri: string;
  /** Opaque code passed back to /poll. Safe to hold on the client — useless without server-side client_id. */
  deviceCode: string;
  /** Seconds until the device code expires (typically 900 = 15 minutes) */
  expiresIn: number;
  /** Minimum polling interval in seconds (typically 5) */
  interval: number;
}

/**
 * Request body for POST /api/integrations/github/auth/poll.
 */
export interface PollRequest {
  /** The opaque device_code returned by the device-code route */
  deviceCode: string;
}

/**
 * Response from POST /api/integrations/github/auth/poll.
 */
export interface PollResponse {
  /** Current authorization status */
  status: "pending" | "complete" | "expired" | "denied" | "error";
  /**
   * Updated polling interval in seconds — only present on slow_down errors.
   * The client must increase its interval to this value.
   */
  interval?: number;
  /** Human-readable message for terminal/error states */
  message?: string;
}

// ─── Internal server-only types (never sent to the client) ────────────────────

/**
 * Raw response from GitHub's device code endpoint.
 * @internal
 */
export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Raw response from GitHub's access token endpoint during polling.
 * @internal
 */
export interface GitHubAccessTokenResponse {
  access_token?: string;
  error?: string;
  /** Updated interval returned by GitHub on slow_down errors */
  interval?: number;
}
