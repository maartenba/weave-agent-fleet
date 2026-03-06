/**
 * Slash command parsing utilities.
 * Used to detect and parse /command-style input before routing to the SDK command API.
 */

export interface ParsedSlashCommand {
  /** The command name without the leading slash, e.g. "metrics" */
  command: string;
  /** Everything after the command name (trimmed), e.g. "arg1 arg2" */
  args: string;
}

/**
 * Parses a slash command string into its command name and arguments.
 * Returns null if the text does not start with a slash or has no command name.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;

  // Strip the leading slash and split on whitespace
  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.search(/\s/);

  let command: string;
  let args: string;

  if (spaceIndex === -1) {
    command = withoutSlash;
    args = "";
  } else {
    command = withoutSlash.slice(0, spaceIndex);
    args = withoutSlash.slice(spaceIndex + 1).trim();
  }

  // A bare "/" with nothing after it is not a valid command
  if (!command) return null;

  return { command, args };
}

/**
 * Returns true if the given text represents a slash command (starts with /).
 */
export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}
