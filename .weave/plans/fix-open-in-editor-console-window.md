# Fix "Open in VS Code" Console Window Flash

Fixes #28

## TL;DR
> **Summary**: The "Open in VS Code/Cursor" buttons spawn a visible terminal/console window. Fix by using macOS `open -a` launch services and Windows `windowsHide: true`.
> **Estimated Effort**: Quick

## Context
### Original Request
Users report a terminal/console window flashing (or staying open) when clicking "Open in VS Code" or "Open in Cursor".

### Key Findings
The `spawnTool` function in `route.ts` has two platform-specific bugs:
- **macOS**: Spawns the `code`/`cursor` CLI wrapper script directly, which is a shell script that can trigger a terminal window. The `explorer` and `terminal` cases already use `open -a` correctly — the editor cases should follow the same pattern.
- **Windows**: Wraps the command in `cmd /c code <dir>`, spawning a visible `cmd.exe` window. Node's `windowsHide: true` spawn option exists precisely for this.

## Objectives
### Core Objective
Eliminate the console/terminal window flash when opening directories in VS Code or Cursor.

### Deliverables
- [ ] Update `vscode` case to use `open -a "Visual Studio Code"` on macOS and `windowsHide: true` on Windows
- [ ] Update `cursor` case to use `open -a "Cursor"` on macOS and `windowsHide: true` on Windows
- [ ] Update `options` type to include `windowsHide?: boolean`

### Definition of Done
- [ ] `npm run build` passes with no type errors
- [ ] On macOS: clicking "Open in VS Code" opens the editor with no terminal flash
- [ ] On Windows: clicking "Open in VS Code" opens the editor with no cmd.exe window

### Guardrails (Must NOT)
- Do NOT change the `terminal` case — users explicitly want a terminal window there
- Do NOT change the `explorer` case — it already works correctly
- Do NOT modify the security validation or API contract

## TODOs

- [ ] 1. **Update options type to include `windowsHide`**
  **What**: Add `windowsHide?: boolean` to the options type annotation on line 78.
  **Files**: `src/app/api/open-directory/route.ts` (line 78)
  **Change**:
  ```typescript
  // FROM:
  const options: { detached: boolean; stdio: "ignore"; cwd?: string; shell?: boolean } = {
  // TO:
  const options: { detached: boolean; stdio: "ignore"; cwd?: string; shell?: boolean; windowsHide?: boolean } = {
  ```
  **Acceptance**: TypeScript compiles without errors when `options.windowsHide = true` is set.

- [ ] 2. **Fix `vscode` case to use platform-appropriate launch**
  **What**: Replace the current two-branch (`isWindows`/else) logic with three branches (`isMac`/`isWindows`/else). On macOS use `open -a "Visual Studio Code"`. On Windows spawn `code` directly with `shell: true` and `windowsHide: true`. On Linux keep `code [directory]`.
  **Files**: `src/app/api/open-directory/route.ts` (lines 84–88)
  **Change**:
  ```typescript
  // FROM:
  case "vscode":
    command = isWindows ? "cmd" : "code";
    args = isWindows ? ["/c", "code", directory] : [directory];
    if (isWindows) options.shell = true;
    break;

  // TO:
  case "vscode":
    if (isMac) {
      command = "open";
      args = ["-a", "Visual Studio Code", directory];
    } else if (isWindows) {
      command = "code";
      args = [directory];
      options.shell = true;
      options.windowsHide = true;
    } else {
      command = "code";
      args = [directory];
    }
    break;
  ```
  **Acceptance**: On macOS, `spawn` is called with `open -a "Visual Studio Code" <dir>`. On Windows, no `cmd /c` wrapper and `windowsHide` is set.

- [ ] 3. **Fix `cursor` case to use platform-appropriate launch**
  **What**: Same three-branch pattern as vscode. On macOS use `open -a "Cursor"`. On Windows spawn `cursor` directly with `shell: true` and `windowsHide: true`. On Linux keep `cursor [directory]`.
  **Files**: `src/app/api/open-directory/route.ts` (lines 90–94)
  **Change**:
  ```typescript
  // FROM:
  case "cursor":
    command = isWindows ? "cmd" : "cursor";
    args = isWindows ? ["/c", "cursor", directory] : [directory];
    if (isWindows) options.shell = true;
    break;

  // TO:
  case "cursor":
    if (isMac) {
      command = "open";
      args = ["-a", "Cursor", directory];
    } else if (isWindows) {
      command = "cursor";
      args = [directory];
      options.shell = true;
      options.windowsHide = true;
    } else {
      command = "cursor";
      args = [directory];
    }
    break;
  ```
  **Acceptance**: On macOS, `spawn` is called with `open -a "Cursor" <dir>`. On Windows, no `cmd /c` wrapper and `windowsHide` is set.

## Verification
- [ ] `npm run build` passes with no type errors
- [ ] Manual test on macOS: "Open in VS Code" opens editor without terminal flash
- [ ] Manual test on macOS: "Open in Cursor" opens editor without terminal flash
- [ ] `terminal` and `explorer` cases remain unchanged
