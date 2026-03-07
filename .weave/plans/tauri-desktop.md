# Tauri v2 Desktop Application Wrapper

## TL;DR
> **Summary**: Wrap Weave Agent Fleet in a Tauri v2 native desktop application that spawns the Next.js standalone server as a sidecar process, displays the React UI in a webview, provides system tray support, and ships with auto-updates via GitHub Releases.
> **Estimated Effort**: XL

## Context

### Original Request
Create a native desktop application (Windows .msi, macOS .dmg, Linux .AppImage) using Tauri v2 that wraps the existing Weave Agent Fleet web application. The desktop app should feel native — system tray, auto-updates, single-instance enforcement — while reusing the existing Next.js codebase unmodified.

### Prerequisites
This is **Phase 2** of a two-phase project. Phase 1 (`.weave/plans/api-ui-split.md`) must be completed first. It delivers:
- `NEXT_PUBLIC_API_BASE_URL` env var for configurable API base URL
- `apiUrl()` / `sseUrl()` / `apiFetch()` API client module at `src/lib/api-client.ts`
- CORS middleware at `src/middleware.ts` for cross-origin API access
- All 30+ frontend `fetch()` calls migrated to use the API client

### Key Findings

**1. Architecture: Sidecar, Not Rust Port**
The Next.js standalone server (`server.js` + `node_modules/` + static assets) runs as a Tauri sidecar child process. Node.js binary (~35MB) is bundled alongside. The webview loads `http://localhost:<port>` from the sidecar. This means:
- The `externalBin` approach in Tauri bundles `node` as a sidecar binary
- The standalone app files (`server.js`, `.next/static/`, `public/`, `node_modules/`) are bundled as Tauri resources
- Tauri's Rust `main.rs` orchestrates: find free port → start sidecar → wait for health → load URL in webview

**2. Existing Build Pipeline**
- `next build` with `output: 'standalone'` produces `.next/standalone/server.js`
- `scripts/assemble-standalone.sh/.ps1` copies static assets, public/, cli.js, better-sqlite3 addon, VERSION
- Release workflow (`.github/workflows/release.yml`) builds per-platform with matrix: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`
- Node.js v22.16.0 (from `.node-version`) is downloaded and bundled in releases

**3. Tauri v2 Sidecar Mechanism**
- `bundle.externalBin` in `tauri.conf.json` expects binaries at `src-tauri/binaries/<name>-<target-triple>[.exe]`
- For Node.js: the sidecar binary is just the `node` executable itself, named with the target triple suffix
- The standalone app directory (server.js + node_modules + static) must be bundled as `bundle.resources`
- Sidecar is spawned from Rust via `tauri_plugin_shell::ShellExt` — `app.shell().sidecar("node").args([...]).spawn()`

**4. Tauri v2 System Tray**
- Enabled via `features = ["tray-icon"]` in `Cargo.toml`
- Built with `TrayIconBuilder` in Rust `setup()` hook
- Menu items: Show/Hide window, agent count display, Quit
- On tray click: show/focus window. On close button: minimize to tray (intercept close event)
- Tray tooltip can show live agent count by polling the `/api/fleet/summary` endpoint from Rust

**5. Tauri v2 Updater**
- Plugin: `tauri-plugin-updater` — checks a JSON endpoint for updates
- Endpoint format: static JSON file on GitHub Releases (e.g., `latest.json`)
- Requires signing: `tauri signer generate` creates a keypair; private key in CI env, public key in `tauri.conf.json`
- `tauri-action` GitHub Action can auto-generate `latest.json` and upload signed artifacts
- `createUpdaterArtifacts: true` in `tauri.conf.json`

**6. Dev Workflow**
- In dev mode, Tauri can point the webview at `http://localhost:3000` (the `next dev` server)
- `tauri.conf.json` `devUrl` config: `http://localhost:3000`
- `beforeDevCommand`: `npm run dev` (starts Next.js dev server)
- No sidecar needed during dev — the Next.js dev server handles everything

**7. Webview URL Strategy**
Option (b) is chosen: the sidecar Next.js server serves both UI + API on `http://localhost:<port>`. The webview loads this URL. This is simpler than extracting static files because:
- SSR pages work out of the box
- No need to handle Next.js routing client-side separately
- The standalone build already serves everything from a single process
- `NEXT_PUBLIC_API_BASE_URL` can be left unset (relative URLs work since UI + API are same-origin)

**8. Port Management**
- The sidecar must bind to a free port (avoid conflicts with existing services)
- Strategy: Rust code finds a free port by binding to `:0` via `TcpListener`, immediately closing, then passing the port to the sidecar via `PORT` env var
- Alternatively, Rust picks a random port in range 49152-65535 and checks availability
- The webview URL is then `http://localhost:{port}`

**9. Single Instance**
- `tauri-plugin-single-instance` prevents multiple app windows from launching
- On second launch, focuses the existing window instead

**10. CSP Considerations**
- Tauri's default CSP blocks `http://` connections from the webview
- Must configure `tauri.conf.json > app > security > csp` to allow connections to `http://localhost:*`
- Alternatively, since the webview loads `http://localhost:<port>` directly (not `tauri://localhost`), CSP is the web server's responsibility, not Tauri's

## Objectives

### Core Objective
Produce a cross-platform desktop application that bundles the Weave Agent Fleet as a native app with system tray and auto-update support, while keeping the existing standalone CLI deployment path fully functional.

### Deliverables
- [ ] Tauri v2 project structure under `src-tauri/`
- [ ] Sidecar setup: bundled Node.js + Next.js standalone output
- [ ] Rust main process: port discovery, sidecar lifecycle, health check, webview loading
- [ ] System tray: icon, menu (Show/Hide, agent count, Quit), minimize-to-tray
- [ ] Auto-updater: signed builds, GitHub Releases JSON endpoint
- [ ] Single-instance enforcement
- [ ] Build scripts: `npm run tauri:build` orchestrates Next.js build → assemble → Tauri build
- [ ] CI/CD: GitHub Actions workflow for producing .msi, .dmg, .AppImage per platform
- [ ] Dev workflow: `npm run tauri:dev` for local development

### Definition of Done
- [ ] `npm run tauri:build` produces platform-specific installers that launch successfully
- [ ] The desktop app starts the sidecar, displays the UI, and all features work (sessions, SSE, notifications)
- [ ] System tray shows and hides the window; tray menu works
- [ ] App updates itself from a GitHub Release
- [ ] Existing `npm run build:standalone` and `weave-fleet` CLI continue to work unchanged
- [ ] CI produces artifacts for Windows x64, macOS arm64, macOS x64, Linux x64

### Guardrails (Must NOT)
- Must NOT modify any existing source code in `src/` (the React UI, API routes, server modules)
- Must NOT break the existing standalone build pipeline or `weave-fleet` CLI
- Must NOT remove or replace any existing GitHub Actions workflows
- Must NOT port the API server to Rust — it stays as a Node.js sidecar
- Must NOT require users to have Node.js installed — it's bundled in the app

## Design Decisions

### Why Sidecar with Bundled Node.js (Not `pkg` or SEA)
- The standalone output includes `node_modules/better-sqlite3` with a native `.node` addon. Tools like `pkg` or Node.js Single Executable Applications (SEA) struggle with native addons.
- The existing release pipeline already downloads and bundles portable Node.js — same approach works for Tauri.
- Bundling Node.js as a sidecar binary + app files as resources is the most reliable and debuggable approach.

### Why `http://localhost` (Not `tauri://localhost`)
- The sidecar serves both UI + API. Loading via HTTP is the simplest path.
- SSR, API routes, SSE — all work identically to the standalone deployment.
- No need to extract static files or configure Tauri's built-in asset server.
- The `NEXT_PUBLIC_API_BASE_URL` env var from Phase 1 stays unset (relative URLs).

### Sidecar Binary Naming Convention
Tauri requires sidecar binaries at `src-tauri/binaries/<name>-<target-triple>[.exe]`:
- `node-x86_64-pc-windows-msvc.exe`
- `node-aarch64-apple-darwin`
- `node-x86_64-apple-darwin`
- `node-x86_64-unknown-linux-gnu`

A build script downloads the correct Node.js binary and renames it before `cargo tauri build`.

## TODOs

### Phase 1: Tauri Project Initialization

- [ ] 1. **Initialize Tauri v2 project structure**
  **What**: Create the `src-tauri/` directory with the standard Tauri v2 project layout. This is NOT done via `npm create tauri-app` (which scaffolds a new project). Instead, manually create the required files to add Tauri to the existing Next.js project.
  **Files**:
    - `src-tauri/Cargo.toml` — Rust project manifest
    - `src-tauri/src/main.rs` — Rust entry point (minimal bootstrap)
    - `src-tauri/src/lib.rs` — Tauri app setup (plugin init, window config)
    - `src-tauri/tauri.conf.json` — Tauri configuration
    - `src-tauri/capabilities/default.json` — Tauri permission capabilities
    - `src-tauri/build.rs` — Tauri build script
    - `src-tauri/icons/` — App icons (generate from `weave_logo.png` via `cargo tauri icon`)
  **Implementation notes**:
  `Cargo.toml`:
  ```toml
  [package]
  name = "weave-fleet"
  version = "0.7.2"  # Placeholder — synced from package.json at build time by TODO #26
  edition = "2021"

  [dependencies]
  tauri = { version = "2", features = ["tray-icon"] }
  tauri-plugin-shell = "2"
  tauri-plugin-updater = "2"
  tauri-plugin-process = "2"
  tauri-plugin-single-instance = "2"
  serde = { version = "1", features = ["derive"] }
  serde_json = "1"
  reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
  tokio = { version = "1", features = ["time"] }  # Only for tokio::time::sleep; Tauri uses tokio internally

  [build-dependencies]
  tauri-build = { version = "2", features = [] }
  ```

  `build.rs`:
  ```rust
  fn main() {
      tauri_build::build()
  }
  ```

  `src/main.rs`:
  ```rust
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

  fn main() {
      weave_fleet_lib::run()
  }
  ```

  `tauri.conf.json` (key fields — note: `version` is a placeholder, synced from `package.json` at build time by TODO #26):
  ```json
  {
    "$schema": "https://schema.tauri.app/config/2",
    "productName": "Weave Fleet",
    "version": "0.7.2",
    "identifier": "io.tryweave.fleet",
    "build": {
      "beforeDevCommand": "npm run dev",
      "devUrl": "http://localhost:3000",
      "beforeBuildCommand": "",
      "frontendDist": "./frontend-dist"
    },
    "app": {
      "withGlobalTauri": false,
      "security": {
        "dangerousDisableAssetCspModification": true
      },
      "windows": [
        {
          "title": "Weave Fleet",
          "width": 1280,
          "height": 800,
          "minWidth": 900,
          "minHeight": 600,
          "center": true,
          "visible": false
        }
      ]
    },
    "bundle": {
      "active": true,
      "createUpdaterArtifacts": true,
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ],
      "externalBin": ["binaries/node"],
      "resources": {
        "../src-tauri/app-bundle/": "app/"
      },
      "windows": {
        "wix": { "language": "en-US" }
      },
      "macOS": {
        "minimumSystemVersion": "11.0"
      }
    },
    "plugins": {
      "updater": {
        "pubkey": "",
        "endpoints": [
          "https://github.com/pgermishuys/weave-agent-fleet/releases/download/desktop-v__VERSION__/latest.json"
        ]
      }
    }
  }
  ```
  **Acceptance**: `src-tauri/` directory exists with valid Cargo.toml that compiles (`cargo check` in src-tauri)

- [ ] 2. **Add Tauri npm dependencies and scripts to package.json**
  **What**: Install `@tauri-apps/cli` as a devDependency and add convenience scripts.
  **Files**: `package.json` — add devDependencies and scripts
  **Implementation notes**:
  ```json
  {
    "devDependencies": {
      "@tauri-apps/cli": "^2"
    },
    "scripts": {
      "tauri": "tauri",
      "tauri:dev": "tauri dev",
      "tauri:build": "node scripts/tauri-prebuild.mjs && npx tauri build"
    }
  }
  ```
  Note: `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` are NOT needed as npm packages since we don't invoke Tauri APIs from the frontend JS — all Tauri plugin usage is in Rust only.
  **Acceptance**: `npx tauri info` runs and shows project information

- [ ] 3. **Generate app icons**
  **What**: Use `cargo tauri icon` to generate platform-specific icons from the existing `public/weave_logo.png`. Tauri needs icons in specific sizes and formats (`.ico`, `.icns`, `.png`).
  **Files**:
    - `src-tauri/icons/` — generated icon files (32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.ico)
  **Acceptance**: Icon files exist in `src-tauri/icons/` and are referenced in `tauri.conf.json`

- [ ] 4. **Add `src-tauri/` to .gitignore (selective)**
  **What**: Add Rust build artifacts to `.gitignore` but keep source files tracked.
  **Files**: `.gitignore` — add Tauri-specific ignores
  **Implementation notes**:
  ```gitignore
  # Tauri
  /src-tauri/target/
  /src-tauri/binaries/
  /src-tauri/frontend-dist/
  /src-tauri/app-bundle/
  /src-tauri/gen/
  ```
  The `binaries/` directory contains downloaded Node.js binaries (platform-specific, ~35MB each) — these should not be committed. The `app-bundle/` directory is the normalized standalone output copied during pre-build. The `gen/` directory contains auto-generated Tauri schemas.
  **Important**: `src-tauri/Cargo.lock` MUST be committed (not ignored). This is an application, not a library — `Cargo.lock` ensures reproducible builds in CI.
  **Acceptance**: `git status` does not show `target/` or `binaries/` directories; `Cargo.lock` is tracked

### Phase 2: Sidecar Setup

- [ ] 5. **Create the Tauri pre-build script (`scripts/tauri-prebuild.mjs`)**
  **What**: A Node.js script that runs before `tauri build`. It:
    1. Runs `next build` to produce the standalone output
    2. Runs the existing assemble-standalone script to copy static assets, public/, better-sqlite3 addon
    3. Downloads the platform-appropriate Node.js binary from nodejs.org
    4. Renames the Node.js binary to the Tauri sidecar naming convention (`node-<target-triple>[.exe]`)
    5. Places it in `src-tauri/binaries/`
    6. Creates a minimal `src-tauri/frontend-dist/index.html` placeholder (Tauri requires `frontendDist` to exist, but we load from localhost)
  **Files**:
    - `scripts/tauri-prebuild.mjs` — new file
  **Implementation notes**:
  The target triple is obtained via `rustc --print host-tuple`. The Node.js version is read from `.node-version`. Platform mapping:
  - `x86_64-pc-windows-msvc` → `node-v22.16.0-win-x64.zip` → extract `node.exe`
  - `aarch64-apple-darwin` → `node-v22.16.0-darwin-arm64.tar.gz` → extract `bin/node`
  - `x86_64-apple-darwin` → `node-v22.16.0-darwin-x64.tar.gz` → extract `bin/node`
  - `x86_64-unknown-linux-gnu` → `node-v22.16.0-linux-x64.tar.gz` → extract `bin/node`
  - `aarch64-unknown-linux-gnu` → `node-v22.16.0-linux-arm64.tar.gz` → extract `bin/node`

  The placeholder `frontend-dist/index.html`:
  ```html
  <!DOCTYPE html>
  <html><head><title>Loading...</title></head>
  <body><p>Loading Weave Fleet...</p></body></html>
  ```
  This is never actually displayed — the webview URL is overridden to `http://localhost:<port>` once the sidecar is ready.

  **Platform detection**: Since this is an `.mjs` script (not `.sh` or `.ps1`), it runs cross-platform via `node`. When calling the existing assemble-standalone script, detect the platform via `process.platform` and invoke the appropriate script (`.ps1` on Windows via `powershell -File`, `.sh` on macOS/Linux). Alternatively, inline the assemble logic in the `.mjs` script for full cross-platform support.

  **Checksum verification**: After downloading the Node.js binary, download the corresponding `SHASUMS256.txt` from `https://nodejs.org/dist/v{version}/SHASUMS256.txt` and verify the downloaded archive's SHA-256 hash matches. Abort the build if verification fails.

  **Acceptance**: After running the script, `src-tauri/binaries/node-<triple>[.exe]` exists and is executable; `.next/standalone/` is assembled; Node.js binary checksum is verified

- [ ] 6. **Configure resource bundling for standalone app in `tauri.conf.json`**
  **What**: The `bundle.resources` field in `tauri.conf.json` must map the assembled standalone directory into the app bundle. The assembled standalone directory contains: `server.js`, `.next/static/`, `public/`, `node_modules/`, `cli.js`, `VERSION`.
  **Files**: `src-tauri/tauri.conf.json` — configure `bundle.resources`
  **Implementation notes**:
  The `bundle.resources` field maps the normalized standalone output into the app bundle:
  ```json
  {
    "bundle": {
      "resources": {
        "../src-tauri/app-bundle/": "app/"
      }
    }
  }
  ```
  Note: The assemble-standalone script already copies `.next/static/` and `public/` into the standalone directory, so bundling the standalone directory alone should be sufficient.

  **Mandatory normalization**: The `package.json` name is `opencode-orchestrator`, so Next.js places standalone output at `.next/standalone/opencode-orchestrator/server.js` (not `.next/standalone/server.js`). The pre-build script (TODO #5/#18) **must** normalize this by copying the nested content to a flat `src-tauri/app-bundle/` directory. The `bundle.resources` path above points to this normalized location. Without this step, the Rust sidecar code will look for `app/server.js` but find `app/opencode-orchestrator/server.js`.

  The pre-build script should:
  1. Detect the nested path (check for `server.js` at `.next/standalone/server.js` or `.next/standalone/*/server.js`)
  2. Copy the correct directory contents to `src-tauri/app-bundle/`
  3. This matches the logic in `assemble-standalone.sh` lines 11-22

  **Acceptance**: `cargo tauri build --ci` includes the app files in the produced bundle; the resource directory at runtime contains `app/server.js` at the expected flat path

### Phase 3: Rust Main Process — Sidecar Lifecycle

- [ ] 7. **Implement port discovery in Rust**
  **What**: Write a function in `src-tauri/src/lib.rs` that finds a free TCP port for the sidecar to bind to. Bind to port 0 via `std::net::TcpListener` (no external crate needed).
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  ```rust
  fn find_free_port() -> u16 {
      let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
      listener.local_addr().unwrap().port()
  }
  ```
  Store the port in Tauri managed state so it's accessible from commands and the tray menu updater.
  **Acceptance**: Function reliably returns a port that is not in use

- [ ] 8. **Implement sidecar spawning and lifecycle management**
  **What**: In the Tauri `setup()` hook, spawn the Node.js sidecar with the correct arguments and environment variables. The sidecar command is:
  ```
  node <resource_dir>/app/server.js
  ```
  With environment variables: `PORT=<free_port>`, `HOSTNAME=127.0.0.1`, `NODE_ENV=production`.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  ```rust
  use tauri_plugin_shell::ShellExt;
  use tauri_plugin_shell::process::CommandEvent;
  use tauri::Manager;

  // In setup():
  let port = find_free_port();
  let resource_dir = app.path().resource_dir().unwrap();
  let server_js = resource_dir.join("app").join("server.js");

  // Security: validate the server.js path before spawning
  if !server_js.exists() || !server_js.is_file() {
      panic!("server.js not found at {:?}", server_js);
  }
  if !server_js.starts_with(&resource_dir) {
      panic!("server.js path escapes resource directory: {:?}", server_js);
  }

  let sidecar = app.shell()
      .sidecar("node")
      .unwrap()
      .args([server_js.to_str().unwrap()])
      .env("PORT", port.to_string())
      .env("HOSTNAME", "127.0.0.1")
      .env("NODE_ENV", "production");

  let (mut rx, child) = sidecar.spawn().expect("Failed to spawn sidecar");

  // Store child handle for cleanup
  app.manage(SidecarState { child: std::sync::Mutex::new(Some(child)), port });

  // Read stdout/stderr in background
  tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
          match event {
              CommandEvent::Stdout(line) => {
                  let line = String::from_utf8_lossy(&line);
                  println!("[sidecar] {}", line);
              }
              CommandEvent::Stderr(line) => {
                  let line = String::from_utf8_lossy(&line);
                  eprintln!("[sidecar] {}", line);
              }
              CommandEvent::Terminated(status) => {
                  eprintln!("[sidecar] terminated: {:?}", status);
                  break;
              }
              _ => {}
          }
      }
  });
  ```
  **Key consideration**: The sidecar must be killed when the Tauri app exits. Use `on_event` to handle `tauri::RunEvent::ExitRequested` and kill the child process.
  **Acceptance**: The sidecar starts, binds to the expected port, and logs output. It stops when the app closes.

- [ ] 9. **Implement health check and webview URL loading**
  **What**: After spawning the sidecar, poll `http://127.0.0.1:<port>/api/version` until it returns 200 (or timeout after 30s). Once healthy, navigate the webview to `http://127.0.0.1:<port>`.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  **Important**: Tauri's `setup()` callback is synchronous (it takes `&App`, not `async`). The health check and webview navigation must be spawned as an async task using `tauri::async_runtime::spawn`. Clone the window handle before the spawn closure.
  ```rust
  // In setup(), after spawning the sidecar:
  let window = app.get_webview_window("main").unwrap();
  let window_clone = window.clone();
  tauri::async_runtime::spawn(async move {
      // Health check loop
      let health_url = format!("http://127.0.0.1:{}/api/version", port);
      let client = reqwest::Client::new();
      let start = std::time::Instant::now();
      loop {
          if start.elapsed() > std::time::Duration::from_secs(30) {
              eprintln!("Sidecar failed to start within 30 seconds");
              // TODO: Show error dialog via window_clone
              return;
          }
          match client.get(&health_url).send().await {
              Ok(resp) if resp.status().is_success() => break,
              _ => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
          }
      }

      // Navigate webview (now on async task, window handle cloned before spawn)
      let url = format!("http://127.0.0.1:{}", port);
      let _ = window_clone.navigate(url.parse().unwrap());
      let _ = window_clone.show();
  });
  ```
  **Key consideration**: The main window is initially invisible (`visible: false` in `tauri.conf.json`) to avoid showing the placeholder HTML. It becomes visible only after the sidecar is ready.
  **Acceptance**: The webview shows the Weave Fleet UI after the sidecar starts; a loading indicator or splash screen appears during startup

- [ ] 10. **Handle sidecar crash recovery**
  **What**: If the sidecar process terminates unexpectedly, attempt to restart it. After 3 failed restart attempts, show an error dialog and quit.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  Monitor the `CommandEvent::Terminated` event from the sidecar's event receiver. On unexpected termination:
  1. Wait 1 second
  2. Find a new free port (the old port may still be in TIME_WAIT)
  3. Spawn a new sidecar
  4. Run health check
  5. Navigate webview to new URL
  Track restart count; cap at 3 attempts.
  **Acceptance**: If the sidecar is manually killed, the app restarts it and continues working

- [ ] 11. **Handle app shutdown — kill sidecar on exit**
  **What**: Ensure the sidecar Node.js process is terminated when the Tauri app exits. Use the `on_event` handler with `RunEvent::ExitRequested` and `RunEvent::Exit`.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  ```rust
  .on_event(|app, event| {
      if let tauri::RunEvent::Exit = event {
          if let Some(state) = app.try_state::<SidecarState>() {
              if let Ok(mut child) = state.child.lock() {
                  if let Some(child) = child.take() {
                      let _ = child.kill();
                  }
              }
          }
      }
  })
  ```
  **Acceptance**: After closing the app, no orphan Node.js process remains

### Phase 4: System Tray

- [ ] 12. **Create system tray with menu**
  **What**: Add a system tray icon with a context menu containing: "Show/Hide Window", a separator, "Agents: N active" (disabled info item), a separator, and "Quit". The tray icon uses the app icon.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  ```rust
  use tauri::{
      menu::{Menu, MenuItem, PredefinedMenuItem},
      tray::TrayIconBuilder,
  };

  // In setup():
  let show_hide = MenuItem::with_id(app, "show_hide", "Show Window", true, None::<&str>)?;
  let agent_count = MenuItem::with_id(app, "agent_count", "Agents: 0 active", false, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit Weave Fleet", true, None::<&str>)?;
  let sep1 = PredefinedMenuItem::separator(app)?;
  let sep2 = PredefinedMenuItem::separator(app)?;

  let menu = Menu::with_items(app, &[&show_hide, &sep1, &agent_count, &sep2, &quit])?;

  TrayIconBuilder::new()
      .icon(app.default_window_icon().unwrap().clone())
      .tooltip("Weave Fleet")
      .menu(&menu)
      .menu_on_left_click(false)
      .on_menu_event(|app, event| {
          match event.id.as_ref() {
              "show_hide" => {
                  if let Some(window) = app.get_webview_window("main") {
                      if window.is_visible().unwrap_or(false) {
                          let _ = window.hide();
                      } else {
                          let _ = window.show();
                          let _ = window.set_focus();
                      }
                  }
              }
              "quit" => {
                  app.exit(0);
              }
              _ => {}
          }
      })
      .on_tray_icon_event(|tray, event| {
          if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
              let app = tray.app_handle();
              if let Some(window) = app.get_webview_window("main") {
                  let _ = window.unminimize();
                  let _ = window.show();
                  let _ = window.set_focus();
              }
          }
      })
      .build(app)?;
  ```
  **Acceptance**: Tray icon appears on all platforms; menu items work

- [ ] 13. **Implement minimize-to-tray on window close**
  **What**: Override the window close behavior so that clicking the close button minimizes to tray instead of quitting. Only "Quit" from the tray menu or keyboard shortcut actually exits.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  Use the `on_window_event` handler:
  ```rust
  .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          // Prevent the window from closing
          api.prevent_close();
          // Hide the window instead
          let _ = window.hide();
      }
  })
  ```
  Update the "Show/Hide" menu item text dynamically when the window visibility changes.
  **Acceptance**: Clicking the close button hides the window to tray; the app keeps running

- [ ] 14. **Implement agent count polling for tray menu**
  **What**: Periodically (every 10 seconds) poll `http://127.0.0.1:<port>/api/fleet/summary` from Rust to get active agent count. Update the tray tooltip and menu item text to "Agents: N active".
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  Store the `MenuItem` handle and `TrayIcon` handle in app state so the polling task can update them:
  ```rust
  struct TrayState {
      agent_count_item: MenuItem<tauri::Wry>,
      tray: TrayIcon<tauri::Wry>,
  }

  // In setup(), after creating the tray:
  app.manage(TrayState {
      agent_count_item: agent_count.clone(),
      tray: tray_icon.clone(),
  });
  ```

  Spawn an async task in `setup()` that polls the fleet summary endpoint and updates both the menu item text and tray tooltip:
  ```rust
  let handle = app.handle().clone();
  let fleet_url = format!("http://127.0.0.1:{}/api/fleet/summary", port);
  tauri::async_runtime::spawn(async move {
      let client = reqwest::Client::new();
      loop {
          tauri::async_runtime::sleep(std::time::Duration::from_secs(10)).await;
          if let Ok(resp) = client.get(&fleet_url).send().await {
              if let Ok(body) = resp.json::<serde_json::Value>().await {
                  if let Some(count) = body.get("activeSessions").and_then(|v| v.as_u64()) {
                      let text = format!("Agents: {} active", count);
                      if let Some(state) = handle.try_state::<TrayState>() {
                          let _ = state.agent_count_item.set_text(&text);
                          let _ = state.tray.set_tooltip(Some(&format!("Weave Fleet — {}", text)));
                      }
                  }
              }
          }
      }
  });
  ```
  **Note on `cross-env`**: If `cross-env` is used in any npm scripts referenced during the Tauri build, ensure it is listed in `devDependencies` in `package.json`. Currently it is not a dependency — add it only if needed.
  **Acceptance**: Tray tooltip and menu item show the current active agent count, updated every 10 seconds

### Phase 5: Single Instance & Auto-Updater

- [ ] 15. **Configure single-instance plugin**
  **What**: Prevent multiple instances of the app from running simultaneously. When a second instance is launched, focus the first instance's window instead.
  **Files**: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`
  **Implementation notes**:
  ```rust
  use tauri_plugin_single_instance::init as single_instance_init;

  tauri::Builder::default()
      .plugin(single_instance_init(|app, _args, _cwd| {
          if let Some(window) = app.get_webview_window("main") {
              let _ = window.unminimize();
              let _ = window.show();
              let _ = window.set_focus();
          }
      }))
  ```
  **Acceptance**: Launching the app a second time focuses the existing window instead of opening a new one

- [ ] 16. **Generate updater signing keys**
  **What**: Generate the keypair for signing Tauri update artifacts. The public key goes in `tauri.conf.json`; the private key is a CI secret.
  **Files**: `src-tauri/tauri.conf.json` — set `plugins.updater.pubkey`
  **Command**: `npx tauri signer generate -w ~/.tauri/weave-fleet.key`
  **Implementation notes**:
  - Store the private key as GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`
  - Store an optional password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - Add the public key string to `tauri.conf.json` `plugins.updater.pubkey`
  **Acceptance**: Keypair exists; public key is in config

- [ ] 17. **Configure auto-updater plugin**
  **What**: Initialize the updater plugin in the Rust setup. Configure it to check for updates on startup and optionally show a notification to the user.
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  ```rust
  use tauri_plugin_updater::UpdaterExt;

  // In setup():
  #[cfg(desktop)]
  app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

  // Spawn update check
  let handle = app.handle().clone();
  tauri::async_runtime::spawn(async move {
      // Wait a bit after startup before checking
      tokio::time::sleep(std::time::Duration::from_secs(5)).await;
      match handle.updater().unwrap().check().await {
          Ok(Some(update)) => {
              println!("Update available: {}", update.version);
              // Optionally auto-install or notify via tray
          }
          Ok(None) => println!("No update available"),
          Err(e) => eprintln!("Update check failed: {}", e),
      }
  });
  ```
  For v1, the update check just logs — full UI integration (prompt dialog) can be added later.
  **Acceptance**: On startup, the app checks for updates and logs the result

### Phase 6: Build Pipeline & CI

- [ ] 18. **Create the Tauri build script (`scripts/tauri-prebuild.mjs`) — detailed implementation**
  **What**: Full implementation of the pre-build script from TODO #5. This script is the bridge between the Next.js build and the Tauri build.
  **Files**: `scripts/tauri-prebuild.mjs` — new file
  **Implementation notes**:
  Steps in order:
  1. `npm run build` (Next.js build with `output: 'standalone'`)
  2. `npm run build:cli` (esbuild cli.js)
  3. Run assemble-standalone logic (inline or call existing script)
  4. Determine target triple via `rustc --print host-tuple`
  5. Read Node.js version from `.node-version`
  6. Download Node.js binary for the target platform:
     - URL: `https://nodejs.org/dist/v{version}/node-v{version}-{platform}-{arch}.tar.gz` (or `.zip` for Windows)
     - Extract the `node` binary
  7. Rename to `src-tauri/binaries/node-{target-triple}[.exe]`
  8. Create `src-tauri/frontend-dist/index.html` placeholder
  9. Normalize the assembled standalone output to a known path for `bundle.resources`
  10. Download `SHASUMS256.txt` from `https://nodejs.org/dist/v{version}/SHASUMS256.txt`, compute SHA-256 of the downloaded archive, verify it matches — abort if not

  **Platform detection for assemble-standalone**: Use `process.platform` to determine whether to call `assemble-standalone.ps1` (via `powershell -File`) or `assemble-standalone.sh`. Alternatively, inline the assembly logic in the `.mjs` script to avoid the shell script dependency entirely.

  **Platform mapping** (target triple → Node.js dist):
  | Target Triple | Node.js Platform | Node.js Arch |
  |---|---|---|
  | `x86_64-pc-windows-msvc` | `win` | `x64` |
  | `aarch64-pc-windows-msvc` | `win` | `arm64` |
  | `x86_64-apple-darwin` | `darwin` | `x64` |
  | `aarch64-apple-darwin` | `darwin` | `arm64` |
  | `x86_64-unknown-linux-gnu` | `linux` | `x64` |
  | `aarch64-unknown-linux-gnu` | `linux` | `arm64` |

  **Acceptance**: Running `node scripts/tauri-prebuild.mjs` produces all required artifacts

- [ ] 19. **Create GitHub Actions workflow for Tauri desktop releases**
  **What**: Add `.github/workflows/release-desktop.yml` — a new workflow that builds the Tauri desktop app for all platforms. Triggered by tags matching `desktop-v*` (separate from the existing `v*` tags for standalone releases).
  **Files**: `.github/workflows/release-desktop.yml` — new file
  **Implementation notes**:
  Use `tauri-apps/tauri-action@v0` for the build. The workflow:
  1. Checkout
  2. Install system dependencies (Linux: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc.)
  3. Setup Node.js (from `.node-version`)
  4. Setup Rust stable
  5. Install cross-compile targets if needed (`rustup target add x86_64-apple-darwin` for macOS x64 builds on arm64 runners)
  6. Install npm dependencies (`bun install --frozen-lockfile`)
  7. Run `node scripts/tauri-prebuild.mjs` to build Next.js + download Node.js binary
  8. Run `tauri-apps/tauri-action@v0` which:
     - Builds the Rust binary
     - Bundles the sidecar + resources
     - Creates platform-specific installers
     - Uploads to GitHub Release
     - Generates `latest.json` for the updater

  Matrix:
  ```yaml
  strategy:
    fail-fast: false
    matrix:
      include:
        - platform: macos-latest
          args: '--target aarch64-apple-darwin'
        - platform: macos-latest
          args: '--target x86_64-apple-darwin'
        - platform: ubuntu-22.04
          args: ''
        - platform: windows-latest
          args: ''
  ```

  Environment variables for signing:
  ```yaml
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  ```

  **Important**: The `tauri-action` must be configured to include the updater JSON (`includeUpdaterJson: true`). This generates `latest.json` automatically from the built artifacts.

  **Note**: The existing `release.yml` workflow (triggered by `v*` tags) continues to produce standalone releases. Desktop releases use a different tag pattern.
  **Acceptance**: Pushing a `desktop-v*` tag produces GitHub Release with .msi, .dmg, .AppImage, and `latest.json`

- [ ] 20. **Configure `tauri-action` to generate updater JSON**
  **What**: Ensure the `tauri-action` in the CI workflow generates `latest.json` and uploads it as a release asset. This is the file the updater plugin fetches to check for updates.
  **Files**: `.github/workflows/release-desktop.yml`
  **Implementation notes**:
  ```yaml
  - uses: tauri-apps/tauri-action@v0
    with:
      tagName: desktop-v__VERSION__
      releaseName: 'Weave Fleet Desktop v__VERSION__'
      releaseBody: 'Desktop application release. See assets for platform-specific installers.'
      releaseDraft: false
      prerelease: false
      includeUpdaterJson: true
      args: ${{ matrix.args }}
  ```
  The `includeUpdaterJson: true` flag tells `tauri-action` to generate and upload `latest.json` to the GitHub Release. The updater endpoint in `tauri.conf.json` uses a tag-specific URL:
  `https://github.com/pgermishuys/weave-agent-fleet/releases/download/desktop-v__VERSION__/latest.json`

  Tauri's updater resolves `__VERSION__` to the current app version at runtime, so it always checks the correct release tag. This avoids the pitfall where a standalone `v*` release could become the repo's "latest" release and break the updater URL.

  **Acceptance**: `latest.json` is present in the GitHub Release assets with correct signatures and URLs

### Phase 7: Dev Experience

- [ ] 21. **Configure Tauri dev mode**
  **What**: Set up the `tauri dev` command to work with the existing Next.js dev server. In dev mode, no sidecar is needed — the webview points directly at the Next.js dev server on `http://localhost:3000`.
  **Files**: `src-tauri/tauri.conf.json`
  **Implementation notes**:
  The `build` section in `tauri.conf.json`:
  ```json
  {
    "build": {
      "beforeDevCommand": "npm run dev",
      "devUrl": "http://localhost:3000"
    }
  }
  ```
  In the Rust code, detect dev vs prod mode:
  ```rust
  // Only spawn sidecar in production
  if !cfg!(dev) {
      // spawn sidecar...
  }
  ```
  Or check at runtime:
  ```rust
  if !cfg!(debug_assertions) {
      // spawn sidecar in release builds only
  }
  ```
  In dev mode, the webview loads `devUrl` directly — no sidecar management needed.
  **Acceptance**: `npm run tauri:dev` opens a native window showing the Next.js dev server; hot reload works

- [ ] 22. **Create a development-only Tauri capability for dev tools**
  **What**: In development, enable Chrome DevTools in the webview for debugging.
  **Files**: `src-tauri/capabilities/default.json`
  **Implementation notes**:
  DevTools are automatically available in debug builds in Tauri v2. No explicit capability needed — they're gated by `#[cfg(debug_assertions)]`. Just ensure the Rust code doesn't disable them.
  Additionally, configure the capabilities file for the main window. Note: `shell:allow-spawn` and `shell:allow-kill` are **intentionally excluded** from frontend capabilities — the sidecar is spawned from Rust code only, not from webview JS. Granting shell permissions to the frontend would allow arbitrary code execution via the node sidecar.
  ```json
  {
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "default",
    "description": "Capability for the main window",
    "windows": ["main"],
    "permissions": [
      "core:default",
      "updater:default",
      "process:default"
    ]
  }
  ```
  The Rust sidecar spawn code in `lib.rs` uses `ShellExt` directly from the Rust process, which does not require frontend capability permissions — it runs with full backend trust.
  **Acceptance**: F12 opens DevTools in dev mode; sidecar spawns from Rust without frontend shell permissions

### Phase 8: Cross-Platform Considerations

- [ ] 23. **Handle Windows-specific concerns**
  **What**: Address Windows-specific issues:
    - `.exe` extension for the Node.js sidecar binary
    - MSI installer configuration via Wix
    - Windows code signing (optional for v1, required for distribution)
    - `better-sqlite3.node` addon must be the Windows build
    - Windows Defender SmartScreen warning without code signing
  **Files**: `src-tauri/tauri.conf.json` — Windows bundle config
  **Implementation notes**:
  ```json
  {
    "bundle": {
      "windows": {
        "wix": {
          "language": "en-US"
        },
        "nsis": {
          "installMode": "currentUser"
        }
      }
    }
  }
  ```
  Both MSI (Wix) and NSIS installer formats are produced by default. NSIS is preferred for the updater (`installMode: "passive"` for background updates).
  **Acceptance**: Windows build produces an .msi and/or .exe installer that installs and runs correctly

- [ ] 24. **Handle macOS-specific concerns**
  **What**: Address macOS-specific issues:
    - App bundle structure (.app)
    - Code signing and notarization (required for distribution without Gatekeeper warnings)
    - `minimumSystemVersion: "11.0"` for Apple Silicon support
    - Universal binary consideration (x64 + arm64)
    - macOS app menu (File, Edit, Window, Help) — Tauri provides default menus
  **Files**: `src-tauri/tauri.conf.json` — macOS bundle config
  **Implementation notes**:
  For code signing in CI, add to the workflow:
  ```yaml
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  ```
  Code signing is optional for the initial release — it can be added later.
  **Acceptance**: macOS build produces a .dmg that installs and runs correctly

- [ ] 25. **Handle Linux-specific concerns**
  **What**: Address Linux-specific issues:
    - AppImage format for distribution
    - System dependencies: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
    - Tray icon requires `libappindicator3` at runtime
    - File permissions: ensure the Node.js binary is executable in the AppImage
  **Files**: `.github/workflows/release-desktop.yml` — Linux dependency installation
  **Implementation notes**:
  The CI workflow must install Linux dependencies:
  ```yaml
  - name: Install system dependencies (Linux)
    if: matrix.platform == 'ubuntu-22.04'
    run: |
      sudo apt-get update
      sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```
  **Acceptance**: Linux build produces an .AppImage that runs on Ubuntu 22.04+

### Phase 9: Version Synchronization & Final Integration

- [ ] 26. **Synchronize version numbers between package.json and tauri.conf.json**
  **What**: Ensure the version in `src-tauri/tauri.conf.json` stays in sync with `package.json`. Either:
    - (a) Read from `package.json` at build time and inject into the Tauri config
    - (b) Use a script to update both files simultaneously
    - (c) Use `tauri.conf.json`'s `version` field set to the same value and keep them in sync manually
  **Files**: `scripts/tauri-prebuild.mjs` — add version sync step
  **Implementation notes**:
  The pre-build script reads `package.json` version and writes it to `tauri.conf.json` before the Tauri build:
  ```js
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const tauriConf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
  tauriConf.version = pkg.version;
  fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');
  ```
  **Acceptance**: `tauri.conf.json` version always matches `package.json` version at build time

- [ ] 27. **Handle `OPENCODE_BIN` and `opencode` CLI in Tauri context**
  **What**: The standalone `launcher.cmd`/`launcher.sh` checks for the `opencode` CLI on PATH. In the Tauri desktop app, the same requirement exists — `opencode` must be available for the sidecar to spawn agent sessions. The Tauri app should:
    1. Check if `opencode` is on PATH
    2. If not, show a dialog or notification to the user
    3. Allow setting `OPENCODE_BIN` via app settings or env var
  **Files**: `src-tauri/src/lib.rs`
  **Implementation notes**:
  On startup (before spawning the sidecar), check if `opencode` is findable:
  ```rust
  use std::process::Command as StdCommand;
  let opencode_available = StdCommand::new("opencode")
      .arg("version")
      .output()
      .is_ok();
  if !opencode_available {
      // Show a dialog or log a warning
      // The sidecar can still start, but sessions won't be able to spawn agents
  }
  ```
  This is a best-effort check — don't block startup, just warn.
  **Acceptance**: App shows a warning if `opencode` is not on PATH

- [ ] 28. **Write the complete `src-tauri/src/lib.rs` integrating all components**
  **What**: Combine all the Rust components (port discovery, sidecar lifecycle, health check, system tray, single instance, updater, close-to-tray) into the final `lib.rs`. This is the integration step.
  **Files**: `src-tauri/src/lib.rs` — final implementation
  **Implementation notes**:
  The complete flow:
  1. Initialize plugins in `Builder::default()` chain — **all plugins must be registered before `setup()` runs**:
     ```rust
     tauri::Builder::default()
         .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
             if let Some(window) = app.get_webview_window("main") {
                 let _ = window.unminimize();
                 let _ = window.show();
                 let _ = window.set_focus();
             }
         }))
         .plugin(tauri_plugin_shell::init())  // Required for app.shell().sidecar()
         .plugin(tauri_plugin_updater::Builder::new().build())
         .plugin(tauri_plugin_process::init())
         .setup(|app| {
             // ... setup logic (steps a–h below)
             Ok(())
         })
         // ... on_window_event, on_event
     ```
  2. In `setup()`:
     a. Find free port
     b. Spawn sidecar (prod only — guard with `#[cfg(not(debug_assertions))]`)
     c. Health check loop (in `tauri::async_runtime::spawn` — setup is synchronous)
     d. Navigate webview to sidecar URL (inside the async spawn)
     e. Show window (inside the async spawn, after health check passes)
     f. Create system tray
     g. Start agent count polling (in separate `tauri::async_runtime::spawn`)
     h. Start update check — delayed 5s (in separate `tauri::async_runtime::spawn`)
  3. `on_window_event`: minimize to tray on close
  4. `on_event`: kill sidecar on `RunEvent::Exit`
  **Acceptance**: The complete app lifecycle works end-to-end

- [ ] 29. **Update `.gitignore` with all Tauri artifacts**
  **What**: Ensure all generated/downloaded Tauri artifacts are properly ignored.
  **Files**: `.gitignore`
  **Implementation notes**:
  Add:
  ```gitignore
  # Tauri
  /src-tauri/target/
  /src-tauri/binaries/
  /src-tauri/frontend-dist/
  /src-tauri/app-bundle/
  /src-tauri/gen/
  ```
  **Note**: `src-tauri/Cargo.lock` must NOT be in `.gitignore` — it should be committed for reproducible builds.
  **Acceptance**: `git status` is clean after a build (except Cargo.lock which should be tracked)

- [ ] 30. **End-to-end verification**
  **What**: Verify the complete workflow works on at least one platform:
  1. `node scripts/tauri-prebuild.mjs` succeeds
  2. `npx tauri build` produces an installer
  3. Installing and launching the app starts the sidecar
  4. The UI is fully functional (sessions, SSE events, notifications)
  5. System tray works (show/hide, quit)
  6. Closing the window minimizes to tray
  7. The standalone build (`npm run build:standalone`) still works
  **Files**: none (verification only)
  **Acceptance**: All checks pass on the development machine

## Verification
- [ ] `npm run build` (standalone Next.js build) still works
- [ ] `npm run build:standalone` still works (assemble standalone)
- [ ] `npx tauri build` produces platform-specific installers
- [ ] Desktop app launches, sidecar starts, UI loads
- [ ] SSE events (session events, notifications) work in the webview
- [ ] System tray: icon visible, menu works, show/hide, quit
- [ ] Close button minimizes to tray (app stays running)
- [ ] Single instance: second launch focuses existing window
- [ ] Updater: checks for updates on startup (can be verified with a test JSON endpoint)
- [ ] No orphan Node.js processes after app exit
- [ ] CI produces artifacts for Windows, macOS (arm64 + x64), Linux

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `bundle.resources` can't handle the large standalone directory (1000+ files in `node_modules/`) | Build fails or produces corrupt bundles | Test early. If needed, tar.gz the standalone directory and extract at first launch. |
| Native addon (`better-sqlite3.node`) not found at runtime in bundled resources | Database operations fail, app crashes | The assemble-standalone script already verifies the addon. Add a runtime check in Rust before spawning the sidecar. |
| Webview CSP blocks `http://localhost` connections | UI can't communicate with sidecar API | Set `dangerousDisableAssetCspModification: true` in `tauri.conf.json` since we load from HTTP anyway. |
| Port conflict: chosen port is taken between discovery and sidecar bind | Sidecar fails to start | Retry with a new port. The health check loop handles this gracefully. |
| macOS Gatekeeper blocks unsigned app | Users can't install without right-clicking → "Open" | Document workaround initially. Add code signing in a follow-up. |
| Windows SmartScreen warns about unsigned app | Users may not trust the download | Document workaround. Add Authenticode signing later. |
| AppImage doesn't include system libraries (libwebkit2gtk) | App doesn't run on minimal Linux installs | AppImage bundles these. Document minimum requirements. |
| Sidecar stdout/stderr fills memory if not drained | Memory leak over long sessions | The event receiver loop drains output. Consider rotating/discarding old log lines. |
| Version drift between package.json and tauri.conf.json | Updater version comparisons fail | Pre-build script syncs versions automatically (TODO #26). |
| `opencode` CLI not available on PATH | Agent sessions can't start | Show a startup warning dialog (TODO #27). Don't block the app. |

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `src-tauri/Cargo.toml` | Rust project manifest with Tauri + plugin dependencies |
| `src-tauri/build.rs` | Tauri build script (`tauri_build::build()`) |
| `src-tauri/tauri.conf.json` | Tauri configuration (window, bundle, plugins, security) |
| `src-tauri/src/main.rs` | Rust entry point (calls `lib::run()`) |
| `src-tauri/src/lib.rs` | Core app logic: sidecar lifecycle, tray, updater |
| `src-tauri/capabilities/default.json` | Tauri security capabilities (updater, process permissions — no shell) |
| `src-tauri/icons/*` | App icons generated from `weave_logo.png` |
| `scripts/tauri-prebuild.mjs` | Pre-build: Next.js build + Node.js download + assembly |
| `.github/workflows/release-desktop.yml` | CI workflow for desktop releases |

### Modified Files
| File | Change |
|------|--------|
| `package.json` | Add `@tauri-apps/cli` devDep, `tauri:dev` and `tauri:build` scripts |
| `.gitignore` | Add Tauri build artifacts (`src-tauri/target/`, `src-tauri/binaries/`, etc.) |

### Unchanged Files
| File | Why |
|------|-----|
| All `src/` files | React UI, API routes, server modules — NO changes |
| `scripts/assemble-standalone.sh/.ps1` | Standalone build pipeline unchanged |
| `scripts/launcher.sh/.cmd` | CLI launcher unchanged |
| `.github/workflows/release.yml` | Standalone release workflow unchanged |
| `.github/workflows/ci.yml` | CI workflow unchanged |
| `next.config.ts` | No changes needed |
