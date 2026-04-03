/**
 * File/folder name validation utility.
 *
 * Validates names intended for individual path segments (not full paths).
 * Used by create and rename dialogs to give immediate inline feedback.
 */

/** Reserved OS names (Windows). Case-insensitive. */
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/** Characters forbidden in filenames (Windows + cross-platform safety). */
const FORBIDDEN_CHARS_RE = /[<>:"|?*\x00]/;

export interface FileNameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a single file or folder name (not a path).
 *
 * Rules:
 * 1. Not empty or whitespace-only
 * 2. No path separators (`/` or `\`)
 * 3. No null bytes or forbidden chars (`< > : " | ? *`)
 * 4. Not `.` or `..`
 * 5. No reserved OS names (CON, PRN, NUL, COM1–COM9, LPT1–LPT9)
 * 6. Max 255 characters
 * 7. No trailing dots or spaces (Windows compatibility)
 */
export function validateFileName(name: string): FileNameValidationResult {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Name cannot be empty" };
  }

  if (name.includes("/") || name.includes("\\")) {
    return { valid: false, error: "Name cannot contain path separators (/ or \\)" };
  }

  if (FORBIDDEN_CHARS_RE.test(name)) {
    return { valid: false, error: 'Name cannot contain the characters < > : " | ? * or null bytes' };
  }

  if (name === "." || name === "..") {
    return { valid: false, error: 'Name cannot be "." or ".."' };
  }

  if (name.length > 255) {
    return { valid: false, error: "Name cannot exceed 255 characters" };
  }

  // Check reserved names — also handles "NUL.txt" style (strip extension for check)
  const nameWithoutExt = name.includes(".") ? name.split(".")[0] : name;
  if (RESERVED_NAMES.has(nameWithoutExt.toUpperCase())) {
    return { valid: false, error: `"${nameWithoutExt}" is a reserved OS name and cannot be used` };
  }

  if (name.endsWith(".") || name.endsWith(" ")) {
    return { valid: false, error: "Name cannot end with a dot or space" };
  }

  return { valid: true };
}
