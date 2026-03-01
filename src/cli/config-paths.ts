/**
 * Shared path resolution for Weave configuration files and skill directories.
 * Used by both CLI commands and server-side config managers.
 */

import { homedir } from "os";
import { join } from "path";

/**
 * Returns the user-level OpenCode config directory.
 * On all platforms: ~/.config/opencode/
 */
export function getUserConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

/**
 * Returns the path to the user-level weave-opencode.jsonc config file.
 */
export function getUserWeaveConfigPath(): string {
  return join(getUserConfigDir(), "weave-opencode.jsonc");
}

/**
 * Returns the path to the skills directory.
 * ~/.config/opencode/skills/
 */
export function getSkillsDir(): string {
  return join(getUserConfigDir(), "skills");
}

/**
 * Returns the project-level config directory path.
 * <projectDir>/.opencode/
 */
export function getProjectConfigDir(projectDir: string): string {
  return join(projectDir, ".opencode");
}

/**
 * Returns the path to the project-level weave-opencode.jsonc config file.
 * <projectDir>/.opencode/weave-opencode.jsonc
 */
export function getProjectWeaveConfigPath(projectDir: string): string {
  return join(getProjectConfigDir(projectDir), "weave-opencode.jsonc");
}
