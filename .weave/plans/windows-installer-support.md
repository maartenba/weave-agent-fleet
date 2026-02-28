# Windows Installer & Binary Distribution Support

## TL;DR
> **Summary**: Extend the existing macOS/Linux installer and release pipeline to support Windows — adding a PowerShell install script, a `.cmd` launcher, Windows build matrix entries in the release workflow, and addressing platform-specific runtime issues (path separators, signal handling, native addons).
> **Estimated Effort**: Large

## Context

### Original Request
Add Windows support to the Weave Agent Fleet installer and binary distribution. The project already ships macOS (arm64/x64) and Linux (x64/arm64) tarballs via a `curl | sh` installer. Extend this with an equivalent PowerShell installer, a `.cmd` launcher, and a Windows CI build.

### Key Findings

1. **`scripts/install.sh`** — POSIX shell installer that detects platform/arch, downloads `.tar.gz` from GitHub Releases, verifies SHA256, extracts to `~/.weave/fleet/`, modifies shell rc files for PATH. Fully functional for macOS/Linux. Already rejects unknown OS (`uname -s` match fails for Windows).

2. **`scripts/launcher.sh`** — POSIX shell launcher that resolves bundled `node` binary, checks for `opencode` on PATH, handles subcommands (`version`, `update`, `uninstall`, `help`), sets `NODE_ENV`/`PORT`/`HOSTNAME`, forwards signals via `trap`. Needs a `.cmd` equivalent for Windows.

3. **`.github/workflows/release.yml`** — 4-platform matrix build (darwin-arm64, darwin-x64, linux-x64, linux-arm64). Each downloads a Node.js binary from nodejs.org, packages with standalone Next.js output as `.tar.gz`, generates SHA256 checksums. The `release` job merges checksums and creates a GitHub Release with `softprops/action-gh-release`.

4. **`scripts/assemble-standalone.sh`** — Copies `.next/static/` and `public/` into standalone output, verifies `better-sqlite3` native addon, writes VERSION file. This script must be ported or made cross-platform for the Windows build step.

5. **`better-sqlite3` native addon** — Uses `prebuild-install` which downloads prebuilt `.node` files. On Windows these are `.dll`-format `.node` files. `npm ci` on `windows-latest` should download the correct Windows x64 prebuilt. The standalone output assembly needs to handle the Windows path (`build\Release\better_sqlite3.node`).

6. **`process-manager.ts` (line 75)** — `ORCHESTRATOR_WORKSPACE_ROOTS` splits on `:` which conflicts with Windows drive letters (`C:\foo`). This is a runtime bug on Windows.

7. **`process-manager.ts` (line 95)** — `resolved.startsWith(root + "/")` uses hardcoded `/` separator. On Windows, paths use `\`. This is a runtime bug.

8. **`process-manager.ts` (lines 411-422)** — Registers `SIGTERM`, `SIGINT`, `SIGHUP` handlers. Windows doesn't support `SIGHUP`. Node.js on Windows will throw if `process.kill(pid, 'SIGHUP')` is called, but `process.on('SIGHUP', ...)` is silently ignored — so this is safe.

9. **`database.ts`** — Uses `homedir()` for default DB path (`~/.weave/fleet.db`). On Windows, `homedir()` returns `C:\Users\<name>`, so the DB lands at `C:\Users\<name>\.weave\fleet.db`. This is fine — Node.js `path.resolve()` and `mkdirSync` handle Windows paths correctly.

10. **`workspace-manager.ts`** — Calls `execFileSync("git", ...)` which works on Windows if `git` is on PATH (Git for Windows is standard). No issues here.

11. **`opencode` CLI on Windows** — The `opencode` binary is a Go executable. OpenCode's install instructions (`curl -fsSL https://opencode.ai/install | bash`) are Unix-only. Need to verify Windows support exists. If not, this is a prerequisite gap that must be documented. The launcher must check for `opencode.exe` on Windows.

12. **Node.js Windows distribution** — nodejs.org provides `node-v{VERSION}-win-x64.zip` (not `.tar.gz`) containing `node.exe`. Also provides `node-v{VERSION}-win-arm64.zip` for arm64. GitHub Actions only has `windows-latest` (x64 runners), no arm64.

13. **Artifact patterns** — The release job's `files:` glob is `artifacts/weave-fleet-*.tar.gz`. Windows artifacts will be `.zip`, so this must be updated to also match `.zip` files.

14. **Checksum merging** — `cat artifacts/*.sha256 > artifacts/checksums.txt` uses shell `cat` in the release job (ubuntu-latest). This works since the release job runs on ubuntu, not Windows. The per-platform build step generates `.sha256` files.

## Objectives

### Core Objective
Ship Windows x64 as a supported platform with a PowerShell one-liner installer (`irm ... | iex`), making Weave Agent Fleet installable on Windows without Node.js, npm, or admin elevation.

### Deliverables
- [ ] PowerShell install script (`scripts/install.ps1`)
- [ ] Windows `.cmd` launcher (`scripts/launcher.cmd`)
- [ ] Release workflow updated with Windows x64 matrix entry
- [ ] Assembly script ported for Windows (or made cross-platform)
- [ ] `install.sh` updated with Windows detection (redirect to PowerShell)
- [ ] Runtime code fixes for Windows path handling
- [ ] README updated with Windows install instructions
- [ ] `.gitignore` updated for Windows build artifacts

### Definition of Done
- [ ] `irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex` successfully installs on a clean Windows x64 machine
- [ ] `weave-fleet` starts the Next.js production server on Windows
- [ ] `weave-fleet update` re-installs the latest version on Windows
- [ ] `weave-fleet version` prints the correct version on Windows
- [ ] `weave-fleet uninstall` removes the installation on Windows
- [ ] CI creates GitHub Releases with 5 platform archives (4 existing + Windows x64)
- [ ] All existing macOS/Linux platforms continue to work unchanged
- [ ] `better-sqlite3` native addon loads correctly on Windows

### Guardrails (Must NOT)
- Must NOT require administrator elevation for install (user-level only)
- Must NOT break existing macOS/Linux installer or release workflow
- Must NOT bundle `opencode` (separate install, separate lifecycle)
- Must NOT require PowerShell for day-to-day use (launcher is `.cmd`)
- Must NOT target Windows arm64 yet (no CI runner available — document as future work)
- Must NOT introduce Bash/POSIX dependencies on Windows (no Git Bash requirement for running)

## TODOs

### Phase 1: PowerShell Install Script

- [ ] 1. **Create `scripts/install.ps1`**
  **What**: PowerShell install script equivalent to `install.sh`. Invoked via `irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex`. Must:
  - Detect architecture via `$env:PROCESSOR_ARCHITECTURE` (map `AMD64`→`x64`, `ARM64`→`arm64`)
  - Only support `x64` initially; error on `ARM64` with "Windows arm64 not yet supported"
  - Determine latest version from GitHub Releases API (`Invoke-RestMethod`) or use `$env:WEAVE_VERSION`
  - Download `.zip` archive from GitHub Releases: `weave-fleet-v{VERSION}-windows-x64.zip`
  - Download `checksums.txt` and verify SHA256 via `Get-FileHash`
  - Install to `$env:LOCALAPPDATA\weave\fleet\` (default), or `$env:WEAVE_INSTALL_DIR` if set
  - Remove existing installation before extracting
  - Extract `.zip` with `Expand-Archive`
  - Add `$InstallDir\bin` to user-level `Path` via `[Environment]::SetEnvironmentVariable('Path', ..., 'User')`
  - Only add to PATH if not already present
  - Check if `opencode` is on PATH; warn if not found
  - Print success message with next steps ("Open a new terminal" / "Run: weave-fleet")
  - Handle errors gracefully with `try/catch` and clear messages
  - Set `$ErrorActionPreference = 'Stop'` at the top
  **Files**: `scripts/install.ps1` (new)
  **Acceptance**: On a Windows x64 machine, `irm <url> | iex` installs successfully. `weave-fleet` command is available after opening a new terminal.

- [ ] 2. **Update `scripts/install.sh` with Windows detection**
  **What**: Add a check at the top of `install.sh` to detect Windows environments (MSYS, Git Bash, Cygwin, WSL running Windows binaries) and print a redirect message:
  ```
  It looks like you're on Windows. Use the PowerShell installer instead:
    irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex
  ```
  Detection: Check `uname -s` for `MINGW*`, `MSYS*`, `CYGWIN*` patterns. Keep the existing `*) error "Unsupported..."` as fallback.
  **Files**: `scripts/install.sh`
  **Acceptance**: Running `install.sh` from Git Bash on Windows prints the redirect message instead of the "unsupported OS" error.

### Phase 2: Windows Launcher Script

- [ ] 3. **Create `scripts/launcher.cmd`**
  **What**: A Windows `.cmd` batch file equivalent to `launcher.sh`. Gets installed as `%LOCALAPPDATA%\weave\fleet\bin\weave-fleet.cmd`. Must:
  - Use `@echo off` and `setlocal enabledelayedexpansion`
  - Resolve `%~dp0` to find the install directory (`%~dp0..`)
  - Set `NODE_BIN=%INSTALL_DIR%\bin\node.exe`
  - Set `SERVER_JS=%INSTALL_DIR%\app\server.js`
  - Verify `node.exe` and `server.js` exist; print helpful error if not
  - Parse first argument as subcommand:
    - `(no args)` — start the server
    - `version` / `--version` / `-v` — print VERSION file content
    - `update` — invoke PowerShell: `powershell -NoProfile -Command "irm <install.ps1 URL> | iex"`
    - `uninstall` — remove `%INSTALL_DIR%` and print manual PATH removal instructions
    - `help` / `--help` / `-h` — print usage
  - Check `opencode` is on PATH via `where opencode >nul 2>nul`; error if not found
  - Set `NODE_ENV=production`, `PORT` (default 3000), `HOSTNAME` (default 0.0.0.0)
  - Ensure `%USERPROFILE%\.weave` directory exists (`if not exist ... mkdir`)
  - Print startup message: `Weave Fleet v{VERSION} starting on http://localhost:{PORT}`
  - Start Node.js: `"%NODE_BIN%" "%SERVER_JS%"`
  - Note: `.cmd` files don't have Unix signal forwarding. Node.js on Windows handles Ctrl+C via `SIGINT` natively when run in a console. No `trap` equivalent needed.
  **Files**: `scripts/launcher.cmd` (new)
  **Acceptance**: Running `weave-fleet` from a Windows CMD/PowerShell terminal starts the server. All subcommands work. Ctrl+C stops the server cleanly.

### Phase 3: Assembly Script for Windows

- [ ] 4. **Create `scripts/assemble-standalone.ps1` or make assembly cross-platform**
  **What**: The existing `assemble-standalone.sh` uses POSIX shell (`cp -r`, `chmod`, `node -e`). On `windows-latest` CI, we need an equivalent. Two options:
  - **Option A (recommended)**: Create `scripts/assemble-standalone.ps1` — PowerShell version of the assembly script
  - **Option B**: Rewrite assembly in Node.js (cross-platform), but heavier change

  The PowerShell script must:
  1. Find the standalone directory (`.next/standalone/server.js` or nested)
  2. Copy `.next/static/` into the standalone dir
  3. Copy `public/` into the standalone dir
  4. Verify `better-sqlite3` native addon exists (`better_sqlite3.node`); copy from `node_modules/` if missing
  5. Write `VERSION` file from `package.json`
  **Files**: `scripts/assemble-standalone.ps1` (new)
  **Acceptance**: On `windows-latest` runner, `pwsh scripts/assemble-standalone.ps1` produces a complete standalone directory.

### Phase 4: Release Workflow Update

- [ ] 5. **Add Windows x64 to the build matrix**
  **What**: Add a new matrix entry to `.github/workflows/release.yml`:
  ```yaml
  - os: windows-latest
    target: windows-x64
    node_arch: x64
    node_platform: win
  ```
  Key differences from Unix entries:
  - Node.js download URL uses `node-v{VERSION}-win-x64.zip` (not `.tar.gz`)
  - Node.js binary is `node.exe` (not `node`)
  - Package as `.zip` (not `.tar.gz`)
  - Use PowerShell assembly script
  - Checksum via `Get-FileHash` (PowerShell) or `certutil -hashfile`
  
  Structure: Use `if` conditionals or separate steps with `matrix.target` checks to handle Windows-specific vs Unix-specific build steps. The cleanest approach is to use shell-agnostic step names and conditionally run different commands based on `runner.os`.
  **Files**: `.github/workflows/release.yml`
  **Acceptance**: Pushing a `v*` tag builds 5 platform archives (4 existing + windows-x64.zip).

- [ ] 6. **Update Windows-specific build steps**
  **What**: Add/modify these steps for the Windows matrix entry:
  
  **Step: Download Node.js binary (Windows)**
  - Download `node-v{VERSION}-win-x64.zip` from nodejs.org
  - Extract with `Expand-Archive` or `7z`
  - Copy `node.exe` to `staging/bin/node.exe`
  
  **Step: Assemble standalone (Windows)**
  - Run `pwsh scripts/assemble-standalone.ps1` instead of `bash scripts/assemble-standalone.sh`
  
  **Step: Package archive (Windows)**
  - Create directory: `weave-fleet-v{VERSION}-windows-x64/`
  - Copy `node.exe` → `bin/node.exe`
  - Copy `launcher.cmd` → `bin/weave-fleet.cmd`
  - Copy standalone app → `app/`
  - Write `VERSION` file
  - Compress with `Compress-Archive` to `.zip`
  - Generate checksum: `(Get-FileHash -Algorithm SHA256 *.zip).Hash`
  - Write `.sha256` file in same format as Unix (`{hash}  {filename}`)
  
  **Files**: `.github/workflows/release.yml`
  **Acceptance**: Windows build step completes and uploads `weave-fleet-v*-windows-x64.zip` and `.sha256` artifacts.

- [ ] 7. **Update release job to handle `.zip` artifacts**
  **What**: The `release` job currently only globs `*.tar.gz` in the `files:` section. Update to also include `.zip`:
  ```yaml
  files: |
    artifacts/weave-fleet-*.tar.gz
    artifacts/weave-fleet-*.zip
    artifacts/checksums.txt
    scripts/install.sh
    scripts/install.ps1
  ```
  Also update artifact upload pattern in the build job to match `.zip`:
  ```yaml
  path: |
    weave-fleet-*.tar.gz
    weave-fleet-*.tar.gz.sha256
    weave-fleet-*.zip
    weave-fleet-*.zip.sha256
  ```
  **Files**: `.github/workflows/release.yml`
  **Acceptance**: GitHub Release contains all 5 platform archives + `checksums.txt` + both install scripts.

### Phase 5: Runtime Windows Compatibility Fixes

- [ ] 8. **Fix `ORCHESTRATOR_WORKSPACE_ROOTS` path separator**
  **What**: In `src/lib/server/process-manager.ts` line 75, `envRoots.split(":")` uses `:` as separator. On Windows, `C:\Users\foo` contains `:`. Change to use `;` on Windows and `:` on Unix:
  ```ts
  const separator = process.platform === "win32" ? ";" : ":";
  return envRoots.split(separator).map((r) => resolve(r.trim())).filter(Boolean);
  ```
  **Files**: `src/lib/server/process-manager.ts`
  **Acceptance**: Setting `ORCHESTRATOR_WORKSPACE_ROOTS=C:\Users\foo;D:\projects` on Windows correctly splits into two roots.

- [ ] 9. **Fix path comparison in `validateDirectory`**
  **What**: In `src/lib/server/process-manager.ts` line 95, `resolved.startsWith(root + "/")` uses hardcoded `/`. On Windows, paths use `\`. Use `path.sep` instead:
  ```ts
  import { sep } from "path";
  // ...
  const underAllowedRoot = roots.some(
    (root) => resolved === root || resolved.startsWith(root + sep)
  );
  ```
  **Files**: `src/lib/server/process-manager.ts`
  **Acceptance**: `validateDirectory("C:\\Users\\foo\\bar")` passes when `C:\\Users\\foo` is an allowed root.

- [ ] 10. **Verify `homedir()` usage is Windows-safe**
  **What**: Audit all uses of `homedir()` in:
  - `src/lib/server/database.ts` — `resolve(homedir(), ".weave", "fleet.db")` — safe (uses `path.resolve`)
  - `src/lib/server/process-manager.ts` — `resolve(homedir())` — safe
  - `src/lib/server/workspace-manager.ts` — `resolve(homedir(), ".weave", "workspaces")` — safe
  
  All use `path.resolve()` which handles Windows paths correctly. No code changes needed — this is a validation step.
  **Files**: No changes
  **Acceptance**: Manual review confirms all `homedir()` uses go through `path.resolve()`.

### Phase 6: Documentation & Project Hygiene

- [ ] 11. **Update README.md with Windows install instructions**
  **What**: Add Windows instructions alongside the existing macOS/Linux section:
  ```markdown
  ### Install
  
  **macOS / Linux:**
  ```sh
  curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh
  ```
  
  **Windows (PowerShell):**
  ```powershell
  irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex
  ```
  ```
  Also update the Configuration table to add Windows-specific defaults:
  - `WEAVE_INSTALL_DIR`: `~/.weave/fleet` (macOS/Linux), `%LOCALAPPDATA%\weave\fleet` (Windows)
  - `WEAVE_DB_PATH`: `~/.weave/fleet.db` (macOS/Linux), `%USERPROFILE%\.weave\fleet.db` (Windows)
  **Files**: `README.md`
  **Acceptance**: README clearly documents both install paths.

- [ ] 12. **Update `.gitignore` for Windows build artifacts**
  **What**: Add `.zip` pattern:
  ```
  weave-fleet-*.zip
  weave-fleet-*.zip.sha256
  ```
  **Files**: `.gitignore`
  **Acceptance**: `git status` doesn't show `.zip` build artifacts.

- [ ] 13. **Document Windows arm64 as future work**
  **What**: Add a note in the plan and/or a GitHub issue documenting that:
  - Node.js provides `win-arm64` binaries
  - GitHub Actions does not have Windows arm64 runners
  - The installer already detects `ARM64` architecture and errors with a clear message
  - When runners become available, add `windows-arm64` to the matrix
  **Files**: No code changes — create a GitHub issue or add a comment in `release.yml`
  **Acceptance**: The limitation is documented.

- [ ] 14. **Verify `opencode` CLI supports Windows**
  **What**: Check if the `opencode` CLI (`opencode.exe`) is available for Windows. The OpenCode install command (`curl -fsSL https://opencode.ai/install | bash`) is Unix-only. Options:
  - If OpenCode provides a Windows installer, document it in the install script's output
  - If not, document it as a prerequisite gap — Weave Fleet installs on Windows but can't function until `opencode` is available
  
  The installer should check `where opencode >nul 2>nul` and warn accordingly.
  **Files**: `scripts/install.ps1`, `scripts/launcher.cmd` (already covered in tasks 1 and 3)
  **Acceptance**: Install script and launcher both check for `opencode` and print appropriate messages.

## Implementation Order

```
Phase 1 (Tasks 1-2): Install script          ← Entry point, standalone
    ↓
Phase 2 (Task 3): Launcher script            ← Depends on install location conventions
    ↓
Phase 3 (Task 4): Assembly script            ← Needed by CI before packaging
    ↓
Phase 4 (Tasks 5-7): Release workflow        ← Depends on all scripts existing
    ↓
Phase 5 (Tasks 8-10): Runtime fixes          ← Independent of CI, can parallelize with Phase 4
    ↓
Phase 6 (Tasks 11-14): Docs & hygiene        ← Final polish
```

Phases 5 and 6 are independent of each other and can be done in parallel. Phase 5 can also be done in parallel with Phase 4 since it only touches runtime TypeScript, not CI config.

## Potential Pitfalls & Mitigations

### 1. `better-sqlite3` prebuilt not available for Windows x64 + Node 22 ABI
**Risk**: `prebuild-install` may not have a prebuilt binary for the exact Node.js ABI version on Windows. Falls back to compiling from source, which requires Visual Studio Build Tools.
**Mitigation**: `windows-latest` runners have MSVC build tools pre-installed. `npm ci` with `node-gyp` should work. Verify by checking the `npm ci` output for `prebuild-install` vs `node-gyp` on the Windows runner. If prebuilts exist (they likely do for popular combos), no issue.

### 2. Long paths on Windows
**Risk**: Windows has a 260-character path limit by default. Deeply nested `node_modules` or `.next` paths could exceed this.
**Mitigation**: Windows 10+ supports long paths when enabled. Node.js uses long path APIs. `npm ci` handles this correctly. The install directory `%LOCALAPPDATA%\weave\fleet\` is shorter than `~/.weave/fleet/` on most machines. Monitor for path-too-long errors in CI.

### 3. `Expand-Archive` on older PowerShell
**Risk**: `Expand-Archive` requires PowerShell 5.0+ (Windows 10+ ships with 5.1). Older Windows versions may not have it.
**Mitigation**: Windows 10 is the minimum supported target (aligns with Node.js 22 system requirements). PowerShell 5.1 is pre-installed. Document Windows 10+ as minimum.

### 4. User PATH modification on Windows
**Risk**: `[Environment]::SetEnvironmentVariable('Path', ..., 'User')` modifies the registry. The change only takes effect in new terminal sessions. If the user's PATH is very long, appending could hit the 2048-char registry value limit.
**Mitigation**: Check if already present before adding. Print clear "open a new terminal" instructions. The PATH entry is short (`C:\Users\<name>\AppData\Local\weave\fleet\bin`).

### 5. `.cmd` file not found on PATH
**Risk**: Windows PATH resolution finds `.cmd` files automatically when you type `weave-fleet`, but only if the directory is on PATH. The `PATHEXT` environment variable must include `.CMD` (it does by default).
**Mitigation**: The installer adds the `bin` directory to PATH. Windows default `PATHEXT` includes `.CMD;.EXE;.BAT;.COM` etc. No action needed, but verify in testing.

### 6. `assemble-standalone.sh` runs on Linux in CI for the release job
**Risk**: The `release` job (which merges artifacts) runs on `ubuntu-latest`. This job doesn't run assembly — it only downloads artifacts and creates the GitHub Release. No issue here.
**Mitigation**: None needed. Assembly happens in the per-platform `build` job.

### 7. Signal handling on Windows
**Risk**: `.cmd` files don't support `trap` for signal forwarding. If the user presses Ctrl+C, the console sends `SIGINT` to all processes in the console group (both `cmd.exe` and `node.exe`). Node.js handles this natively.
**Mitigation**: Node.js on Windows handles `Ctrl+C` via its own `SIGINT` handler (already registered in `process-manager.ts`). The `destroyAll()` cleanup runs correctly. No `.cmd`-level signal handling needed.

### 8. `HOSTNAME` environment variable conflict on Windows
**Risk**: The launcher sets `HOSTNAME=0.0.0.0`. On Windows, `HOSTNAME` is not a standard env var (Windows uses `COMPUTERNAME`). However, if something else sets it, it could conflict.
**Mitigation**: The launcher uses `set "HOSTNAME=0.0.0.0"` unconditionally (matching the Unix behavior). This is correct for Next.js standalone server binding.

### 9. Antivirus false positives
**Risk**: Windows Defender or other AV may quarantine `node.exe` downloaded from the internet or flag the `.cmd` script.
**Mitigation**: `node.exe` from nodejs.org is signed. The `.zip` archive is downloaded from GitHub Releases (trusted source). If users report issues, document adding an AV exclusion for `%LOCALAPPDATA%\weave\fleet\`.

## Verification
- [ ] `irm <install.ps1 URL> | iex` installs on a clean Windows x64 machine
- [ ] `weave-fleet` starts the server on Windows (http://localhost:3000 responds)
- [ ] `weave-fleet version` prints the correct version
- [ ] `weave-fleet update` downloads and installs the latest release
- [ ] `weave-fleet uninstall` removes the installation
- [ ] Ctrl+C in the terminal cleanly stops the server
- [ ] `better-sqlite3` loads and creates the database on Windows
- [ ] GitHub Actions release workflow builds all 5 platforms on tag push
- [ ] All 5 archives and `checksums.txt` appear in the GitHub Release
- [ ] Existing macOS/Linux install continues to work (no regression)
- [ ] `scripts/install.sh` from Git Bash on Windows prints the PowerShell redirect message
- [ ] All existing tests pass (`npm run test`)
- [ ] CI lint and typecheck pass (`npm run lint && npm run typecheck`)
