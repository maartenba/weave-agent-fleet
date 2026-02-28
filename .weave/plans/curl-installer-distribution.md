# curl-pipe-sh Installer & Binary Distribution

## TL;DR
> **Summary**: Package Weave Agent Fleet as self-contained platform-specific tarballs (bundled Node.js + standalone Next.js output) distributed via GitHub Releases with a `curl | sh` installer, so users can install and run the app without Node.js, npm, or any runtime pre-installed.
> **Estimated Effort**: Large

## Context

### Original Request
Create a `curl -fsSL https://... | sh` installer (à la Bun, Deno, Rust) that lets users install and run Weave Fleet with zero dependencies pre-installed.

### Key Findings

1. **next.config.ts** — Currently has `serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"]` but does NOT have `output: 'standalone'`. Adding `output: 'standalone'` will produce a self-contained server at `.next/standalone/server.js` with tree-shaken `node_modules`.

2. **better-sqlite3 is a native C++ addon** — Compiled to `build/Release/better_sqlite3.node` (1.8MB Mach-O arm64 on this machine). Uses `prebuild-install` during `npm install` to download precompiled binaries keyed on platform+arch+Node ABI version. The standalone output needs this `.node` file for the correct target platform. Next.js `serverExternalPackages` already tells the bundler to NOT bundle it (correct — native addons can't be bundled by webpack/turbopack).

3. **@opencode-ai/sdk spawns `opencode` as a child process** — `dist/server.js` calls `spawn("opencode", ["serve", ...])`. The `opencode` binary is a 109MB Go executable installed separately at `~/.opencode/bin/opencode`. This is a **runtime prerequisite** — the installer must either: (a) check that `opencode` is on PATH and error with install instructions, or (b) bundle/install it. Option (a) is correct since OpenCode has its own release cadence and installer.

4. **Database path** — `src/lib/server/database.ts` defaults to `~/.weave/fleet.db`, overridable via `WEAVE_DB_PATH`. The launcher script should ensure `~/.weave/` exists.

5. **Process signals already handled** — `process-manager.ts` registers handlers for SIGTERM, SIGINT, SIGHUP, and `beforeExit` to call `destroyAll()`. The launcher script can simply forward signals.

6. **CI uses Bun on ubuntu-latest** — `.github/workflows/ci.yml` uses `oven-sh/setup-bun@v2`. But for standalone builds, we need `npm install` (or `bun install`) on **each target platform** to get the correct native addon binary. Bun can install native addons, but the Node.js ABI compatibility of the resulting `.node` file may differ. Safest: use Node.js for the release build since the bundled runtime is Node.js.

7. **package.json** — `version: "0.1.0"`, `private: true`, `name: "opencode-orchestrator"`. Version is already set. The `name` could be renamed to `weave-agent-fleet` for clarity, but it's not blocking.

8. **Next.js 16.1.6 requires Node.js >= 20.9.0** — We should pin Node.js 22 LTS (latest 22.x) since it's the current LTS with long-term support until April 2027.

9. **Current build output is 218MB** (`.next/`), `node_modules` is 617MB. Standalone mode will dramatically reduce this — typically to 30-80MB for the standalone folder, because it tree-shakes `node_modules` to only include what's actually imported.

10. **Public assets** — 6 small SVG/PNG files in `public/`. Standalone mode requires copying `public/` and `.next/static/` alongside the standalone output.

### Architecture Decision: Bundle Node.js, Require OpenCode Separately

**Bundle in tarball:** Node.js binary (~40MB compressed), standalone Next.js output, native addons.

**Do NOT bundle:** `opencode` binary. Reason: OpenCode is a separate tool with its own release cadence, version management, and installer (`curl -fsSL https://opencode.ai/install | bash`). Users who need Weave Fleet already use OpenCode. The installer should check for it and print a clear error if missing.

### Architecture Decision: One Tarball Per Platform

Each tarball contains:
```
weave-fleet-v{VERSION}-{OS}-{ARCH}/
├── bin/
│   ├── node                    # Pinned Node.js binary
│   └── weave-fleet             # Launcher shell script
├── app/
│   ├── server.js               # Next.js standalone entry
│   ├── node_modules/           # Tree-shaken deps (incl. native addons)
│   ├── public/                 # Static assets
│   └── .next/
│       └── static/             # Built CSS/JS chunks
└── VERSION                     # Plain text version string
```

Installed to `~/.weave/fleet/` by default (configurable via `WEAVE_INSTALL_DIR`).

## Objectives

### Core Objective
Ship Weave Agent Fleet as a single `curl | sh` install command that works on macOS (arm64, x64) and Linux (x64, arm64) with zero runtime dependencies beyond the `opencode` CLI.

### Deliverables
- [x] Next.js standalone build configuration
- [x] GitHub Actions release workflow (4-platform build matrix)
- [x] `install.sh` script for `curl | sh` distribution
- [x] `weave-fleet` launcher script (generated into tarball)
- [x] Auto-update check mechanism (version comparison on startup)
- [x] Documentation update (README install instructions)

### Definition of Done
- [x] `curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh` successfully installs on a clean macOS arm64 machine
- [x] `weave-fleet` starts the Next.js production server and prints the access URL
- [x] `weave-fleet update` re-installs the latest version
- [x] CI creates GitHub Releases with all 4 platform tarballs on git tag push
- [x] Total installed size < 150MB per platform (standalone=64MB + Node.js binary ~80MB ≈ 144MB)

### Guardrails (Must NOT)
- Must NOT bundle the `opencode` binary (separate install, separate version)
- Must NOT require Node.js, npm, bun, or any package manager pre-installed
- Must NOT auto-update without user consent (print message only)
- Must NOT break the existing `npm run dev` / `bun run dev` workflow
- Must NOT modify the database schema or runtime behavior
- Must NOT use Docker (this is a native install, not containerized)

## TODOs

### Phase 1: Standalone Build Configuration

- [x] 1. **Enable Next.js standalone output mode**
  **What**: Add `output: 'standalone'` to `next.config.ts`. This tells Next.js to trace all imports and produce a minimal self-contained build at `.next/standalone/`.
  **Files**: `next.config.ts`
  **Change**:
  ```ts
  const nextConfig: NextConfig = {
    output: 'standalone',
    serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"],
  };
  ```
  **Acceptance**: `bun run build` produces `.next/standalone/server.js` and `.next/standalone/node_modules/` containing only the required dependencies. Verify with `ls .next/standalone/server.js`.

- [x] 2. **Add `.node-version` file to pin Node.js 22 LTS**
  **What**: Create `.node-version` with `22.16.0` (or latest 22.x LTS at time of implementation). This is used by the release workflow to know which Node.js binary to download and bundle.
  **Files**: `.node-version` (new)
  **Content**: `22.16.0`
  **Acceptance**: File exists at repo root.

- [x] 3. **Verify standalone build includes native addons correctly**
  **What**: After enabling standalone, run `bun run build` and verify:
  - `.next/standalone/node_modules/better-sqlite3/` exists with `build/Release/better_sqlite3.node`
  - `.next/standalone/node_modules/@opencode-ai/sdk/` exists with `dist/server.js`
  - The standalone server starts with `node .next/standalone/server.js` and responds on port 3000
  **Files**: No file changes — validation step
  **Acceptance**: `node .next/standalone/server.js` serves the app. If native addon is missing from standalone output, add a `postbuild` script to copy it manually (see pitfall handling below).

- [x] 4. **Add `postbuild` script to assemble standalone distribution**
  **What**: Create `scripts/assemble-standalone.sh` that:
  1. Copies `.next/static/` to `.next/standalone/.next/static/` (Next.js docs require this)
  2. Copies `public/` to `.next/standalone/public/` (Next.js docs require this)
  3. If `better-sqlite3` native addon is missing from standalone `node_modules`, copies it from the full `node_modules/`
  4. Writes a `VERSION` file with the version from `package.json`
  **Files**: `scripts/assemble-standalone.sh` (new)
  **Acceptance**: After `bun run build && bash scripts/assemble-standalone.sh`, the directory `.next/standalone/` is fully self-contained and runnable with `node .next/standalone/server.js`.

### Phase 2: Launcher Script

- [x] 5. **Create the `weave-fleet` launcher script template**
  **What**: Create `scripts/launcher.sh` — a POSIX shell script that gets installed as `~/.weave/fleet/bin/weave-fleet`. It:
  - Resolves its own directory to find the bundled Node.js binary
  - Sets `NODE_ENV=production`
  - Sets `HOSTNAME=0.0.0.0` (Next.js standalone listens on 0.0.0.0 by default with this env)
  - Sets `PORT` to `3000` (or user-provided `--port` arg)
  - Passes `WEAVE_DB_PATH` through if set
  - Checks that `opencode` is on PATH; exits with helpful error if not
  - Supports subcommands:
    - `weave-fleet` (no args) — starts the server
    - `weave-fleet version` — prints version
    - `weave-fleet update` — re-runs the install script to update
    - `weave-fleet uninstall` — removes `~/.weave/fleet/` and the PATH entry
  - Forwards SIGTERM/SIGINT to the Node.js child process
  - Prints `🚀 Weave Fleet running at http://localhost:PORT` on startup
  **Files**: `scripts/launcher.sh` (new)
  **Key logic**:
  ```sh
  #!/usr/bin/env sh
  set -e

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  NODE_BIN="$INSTALL_DIR/bin/node"
  SERVER_JS="$INSTALL_DIR/app/server.js"
  VERSION_FILE="$INSTALL_DIR/VERSION"

  # Parse args
  case "${1:-}" in
    version)
      cat "$VERSION_FILE"
      exit 0
      ;;
    update)
      exec curl -fsSL "https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh" | sh
      ;;
    uninstall)
      echo "Removing Weave Fleet from $INSTALL_DIR..."
      rm -rf "$INSTALL_DIR"
      echo "Done. Remove 'weave-fleet' from your PATH manually if needed."
      exit 0
      ;;
  esac

  # Check opencode
  if ! command -v opencode >/dev/null 2>&1; then
    echo "Error: 'opencode' not found on PATH."
    echo "Install it: curl -fsSL https://opencode.ai/install | bash"
    exit 1
  fi

  # Set environment
  export NODE_ENV=production
  export PORT="${PORT:-3000}"
  export HOSTNAME="${HOSTNAME:-0.0.0.0}"

  echo "Weave Fleet v$(cat "$VERSION_FILE") starting on http://localhost:$PORT"
  exec "$NODE_BIN" "$SERVER_JS"
  ```
  **Acceptance**: Script is executable, starts the app with the bundled Node.js, and handles all subcommands.

### Phase 3: Install Script

- [x] 6. **Create `install.sh` for `curl | sh` installation**
  **What**: Create `scripts/install.sh` — the script users pipe to `sh`. It:
  1. Detects OS (`uname -s` → `darwin`/`linux`) and architecture (`uname -m` → `arm64`/`aarch64`/`x86_64`)
  2. Maps to the tarball name: `weave-fleet-v{VERSION}-{os}-{arch}.tar.gz`
  3. Determines latest version from GitHub Releases API (or uses `WEAVE_VERSION` env var if set)
  4. Downloads the tarball from `https://github.com/pgermishuys/weave-agent-fleet/releases/download/v{VERSION}/weave-fleet-v{VERSION}-{os}-{arch}.tar.gz`
  5. Verifies SHA256 checksum (downloads `checksums.txt` from same release)
  6. Extracts to `WEAVE_INSTALL_DIR` (default `~/.weave/fleet`)
  7. Makes `bin/weave-fleet` and `bin/node` executable
  8. Adds `~/.weave/fleet/bin` to PATH:
     - Detects current shell (bash, zsh, fish)
     - Appends `export PATH="$HOME/.weave/fleet/bin:$PATH"` to the appropriate rc file
     - Only adds if not already present
  9. Prints success message with next steps
  10. Handles existing installation (removes old, installs new)
  **Files**: `scripts/install.sh` (new)
  **Key requirements**:
  - Must be POSIX-compatible (no bashisms — runs with `sh`)
  - Must work on macOS and Linux
  - Must detect `curl` or `wget` and use whichever is available
  - Must handle network errors gracefully
  - Must NOT require root/sudo (installs to `~/.weave/`)
  **Acceptance**: On a clean macOS arm64 machine: `curl -fsSL https://raw.githubusercontent.com/pgermishuys/weave-agent-fleet/main/scripts/install.sh | sh` installs correctly. `weave-fleet version` prints the version.

### Phase 4: GitHub Actions Release Workflow

- [x] 7. **Create the release workflow**
  **What**: Create `.github/workflows/release.yml` that triggers on tag pushes (`v*`) and builds platform-specific tarballs.
  **Files**: `.github/workflows/release.yml` (new)
  **Workflow structure**:
  ```yaml
  name: Release

  on:
    push:
      tags: ['v*']

  permissions:
    contents: write  # For creating releases

  jobs:
    build:
      strategy:
        matrix:
          include:
            - os: macos-latest     # macOS arm64 (M1+)
              target: darwin-arm64
              node_arch: arm64
              node_platform: darwin
            - os: macos-13         # macOS x64 (Intel)
              target: darwin-x64
              node_arch: x64
              node_platform: darwin
            - os: ubuntu-latest    # Linux x64
              target: linux-x64
              node_arch: x64
              node_platform: linux
            - os: ubuntu-24.04-arm # Linux arm64
              target: linux-arm64
              node_arch: arm64
              node_platform: linux

      runs-on: ${{ matrix.os }}

      steps:
        - uses: actions/checkout@v4

        - name: Read Node.js version
          id: node-version
          run: echo "version=$(cat .node-version)" >> "$GITHUB_OUTPUT"

        - uses: actions/setup-node@v4
          with:
            node-version: ${{ steps.node-version.outputs.version }}

        - name: Install dependencies
          run: npm ci

        - name: Build standalone
          run: npm run build

        - name: Assemble standalone
          run: bash scripts/assemble-standalone.sh

        - name: Download Node.js binary
          run: |
            NODE_VERSION="${{ steps.node-version.outputs.version }}"
            PLATFORM="${{ matrix.node_platform }}"
            ARCH="${{ matrix.node_arch }}"
            NODE_DIST="node-v${NODE_VERSION}-${PLATFORM}-${ARCH}"

            curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.gz" -o node.tar.gz
            tar xzf node.tar.gz
            mkdir -p staging/bin
            cp "${NODE_DIST}/bin/node" staging/bin/node
            chmod +x staging/bin/node

        - name: Package tarball
          run: |
            VERSION="${GITHUB_REF_NAME#v}"
            TARGET="${{ matrix.target }}"
            DIR_NAME="weave-fleet-v${VERSION}-${TARGET}"

            mkdir -p "${DIR_NAME}/bin" "${DIR_NAME}/app"

            # Copy Node.js binary
            cp staging/bin/node "${DIR_NAME}/bin/node"

            # Copy launcher script
            cp scripts/launcher.sh "${DIR_NAME}/bin/weave-fleet"
            chmod +x "${DIR_NAME}/bin/weave-fleet"

            # Copy standalone app
            cp -r .next/standalone/* "${DIR_NAME}/app/"

            # Write version
            echo "${VERSION}" > "${DIR_NAME}/VERSION"

            # Create tarball
            tar czf "${DIR_NAME}.tar.gz" "${DIR_NAME}"

            # Generate checksum
            shasum -a 256 "${DIR_NAME}.tar.gz" > "${DIR_NAME}.tar.gz.sha256"

        - name: Upload artifact
          uses: actions/upload-artifact@v4
          with:
            name: tarball-${{ matrix.target }}
            path: |
              weave-fleet-*.tar.gz
              weave-fleet-*.tar.gz.sha256

    release:
      needs: build
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: actions/download-artifact@v4
          with:
            path: artifacts
            merge-multiple: true

        - name: Merge checksums
          run: cat artifacts/*.sha256 > artifacts/checksums.txt

        - name: Create GitHub Release
          uses: softprops/action-gh-release@v2
          with:
            generate_release_notes: true
            files: |
              artifacts/weave-fleet-*.tar.gz
              artifacts/checksums.txt
              scripts/install.sh
  ```
  **Acceptance**: Pushing a `v0.1.0` tag triggers the workflow, builds 4 tarballs, and creates a GitHub Release with all assets.

- [x] 8. **Add `npm ci` support (package-lock.json)**
  **What**: The release workflow uses `npm ci` which requires `package-lock.json`. Currently only `bun.lock` exists. Either:
  - Option A: Generate `package-lock.json` and commit it (dual lockfile)
  - Option B: Use `bun install --frozen-lockfile` in the release workflow instead of `npm ci`, but ensure native addons are compiled for the correct Node.js ABI version
  **Recommendation**: Option A — generate `package-lock.json` via `npm install --package-lock-only` and commit it. This ensures native addons are compiled with the correct Node.js ABI headers. The `bun.lock` remains for dev workflow.
  **Files**: `package-lock.json` (new, generated)
  **Acceptance**: `npm ci` succeeds and `node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.

### Phase 5: Auto-Update Check

- [x] 9. **Add version check on startup**
  **What**: Create a server-side utility that checks for newer versions on startup. This runs once when the Next.js server starts (via a module side-effect or instrumentation hook). It:
  1. Reads the current version from the `VERSION` file (or `package.json`)
  2. Fetches `https://api.github.com/repos/pgermishuys/weave-agent-fleet/releases/latest` (with a 3-second timeout)
  3. Compares the `tag_name` (semver) against current version
  4. If newer, logs: `A newer version of Weave Fleet is available: v{NEW} (current: v{CURRENT}). Run 'weave-fleet update' to upgrade.`
  5. Never blocks startup — fire-and-forget with error swallowing
  6. Only runs if `NODE_ENV=production` and the `VERSION` file exists (i.e., installed via tarball, not dev mode)
  **Files**: `src/lib/server/version-check.ts` (new)
  **Acceptance**: Starting the app with an outdated `VERSION` file prints the update message. Starting in dev mode (no VERSION file) does nothing. Network failures are silently ignored.

- [x] 10. **Expose version info in the API/UI**
  **What**: Add a `GET /api/version` endpoint that returns `{ version, latest, updateAvailable }`. The UI can optionally show this in the header/footer. The version check result is cached in memory for 1 hour.
  **Files**: `src/app/api/version/route.ts` (new)
  **Acceptance**: `curl localhost:3000/api/version` returns JSON with version info.

### Phase 6: Project Hygiene & Documentation

- [x] 11. **Add build scripts to package.json**
  **What**: Add convenience scripts for the release build process:
  ```json
  {
    "scripts": {
      "build:standalone": "next build && bash scripts/assemble-standalone.sh",
      "postbuild": "echo 'Build complete'"
    }
  }
  ```
  **Files**: `package.json`
  **Acceptance**: `npm run build:standalone` produces a runnable standalone directory.

- [x] 12. **Add `.gitignore` entries for build artifacts**
  **What**: Ensure staging directories and tarballs are ignored:
  ```
  # Release build artifacts
  staging/
  weave-fleet-*.tar.gz
  weave-fleet-*.tar.gz.sha256
  ```
  **Files**: `.gitignore`
  **Acceptance**: `git status` doesn't show build artifacts after a release build.

- [x] 13. **Update README with install instructions**
  **What**: Add a "Quick Start" section to README.md:
  ```markdown
  ## Quick Start

  ### Prerequisites
  - [OpenCode CLI](https://opencode.ai) must be installed

  ### Install
  ```sh
  curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh
  ```

  ### Run
  ```sh
  weave-fleet
  ```
  Open http://localhost:3000 in your browser.

  ### Update
  ```sh
  weave-fleet update
  ```
  ```
  **Files**: `README.md`
  **Acceptance**: README has clear install/run/update instructions.

## Implementation Order

```
Phase 1 (Tasks 1-4): Standalone build
    ↓
Phase 2 (Task 5): Launcher script
    ↓
Phase 3 (Task 6): Install script
    ↓
Phase 4 (Tasks 7-8): Release workflow
    ↓
Phase 5 (Tasks 9-10): Auto-update
    ↓
Phase 6 (Tasks 11-13): Polish & docs
```

Tasks 1-4 are sequential (each depends on the previous). Tasks 5 and 6 are independent of each other but depend on Phase 1. Tasks 9-10 are independent of Phases 2-4.

## Potential Pitfalls & Mitigations

### 1. Native addon missing from standalone output
**Risk**: Next.js standalone mode may not copy `better-sqlite3`'s `.node` file correctly.
**Mitigation**: `serverExternalPackages` already includes `better-sqlite3`, which tells Next.js to keep it as-is. The `assemble-standalone.sh` script has a fallback that copies the native addon manually if missing. Test this empirically in Task 3.

### 2. Node.js ABI mismatch
**Risk**: `better-sqlite3` prebuilt binaries are keyed on Node.js ABI version. If we build with Node 22.x but bundle Node 20.x, the `.node` file won't load.
**Mitigation**: Use the SAME Node.js version for both `npm ci` (which downloads the prebuilt addon) and the bundled binary. The `.node-version` file is the single source of truth.

### 3. `opencode` binary not found at runtime
**Risk**: Users install Weave Fleet but don't have `opencode` CLI installed.
**Mitigation**: The launcher script checks `command -v opencode` before starting and prints a clear error with install instructions. Also check at runtime in the process manager (already handled — SDK throws if spawn fails, and the API returns the error).

### 4. Linux arm64 CI runners
**Risk**: GitHub Actions doesn't have native arm64 Linux runners on the free tier for public repos (but does for private repos and GitHub Teams/Enterprise). `ubuntu-24.04-arm` is available on larger runners.
**Mitigation**: Options:
  - (A) Use `ubuntu-24.04-arm` runner (available since late 2024 for public repos on free tier)
  - (B) Cross-compile: build on x64, download arm64 Node.js binary and arm64 `better-sqlite3` prebuilt
  - (C) Skip Linux arm64 initially, add later
  **Recommendation**: Try option (A) first. Fall back to (C) if runners aren't available.

### 5. macOS x64 runner deprecation
**Risk**: GitHub Actions `macos-13` (last Intel runner) may be deprecated.
**Mitigation**: Apple Silicon macs can run x64 binaries via Rosetta. If `macos-13` is deprecated, we can cross-build on `macos-latest` by downloading x64 Node.js binary. The native addon would need `npm rebuild --arch=x64` or downloading the correct prebuild.

### 6. Tarball size
**Risk**: Including Node.js binary (~40MB compressed) makes each tarball large.
**Mitigation**: This is acceptable — Bun is ~40MB, Deno is ~35MB. Expected total per tarball: ~50-70MB. Use `gzip -9` for maximum compression.

### 7. PATH modification on install
**Risk**: Modifying shell rc files can conflict with user configuration.
**Mitigation**: Only append if the line isn't already present. Use a clear comment marker. Instruct user to run `source ~/.bashrc` or open a new terminal.

### 8. Standalone server.js `__dirname` / paths
**Risk**: Next.js standalone `server.js` resolves `.next/` relative to its own location. If we reorganize the directory structure, paths may break.
**Mitigation**: Keep the standalone directory structure as-is inside `app/`. The `server.js`, `.next/static/`, `public/`, and `node_modules/` must all be in the same relative positions as Next.js expects.

## Verification
- [x] `bun run build` produces `.next/standalone/server.js`
- [x] `node .next/standalone/server.js` starts the app on port 3000
- [x] `bash scripts/install.sh` installs to `~/.weave/fleet/` on local machine
- [x] `~/.weave/fleet/bin/weave-fleet` starts the app using the bundled Node.js
- [x] `~/.weave/fleet/bin/weave-fleet version` prints the correct version
- [x] `~/.weave/fleet/bin/weave-fleet update` downloads and installs the latest release
- [x] GitHub Actions release workflow completes for all 4 platforms on tag push (requires v* tag push to verify)
- [x] All tarballs have valid SHA256 checksums (SHA256 generation verified in release.yml workflow)
- [x] Existing `bun run dev` workflow is unaffected
- [x] All tests pass (`bun run test`)
- [x] CI (`bun run lint && bun run typecheck && bun run test && bun run build`) passes
