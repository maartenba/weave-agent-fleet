use std::sync::Mutex;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_updater::UpdaterExt;

/// Managed state holding the sidecar child process handle and port.
#[allow(dead_code)]
struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    port: u16,
}

/// Managed state holding tray menu item handles for dynamic updates.
struct TrayState {
    agent_count_item: MenuItem<tauri::Wry>,
}

/// Find a free TCP port by binding to port 0.
fn find_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to find a free port");
    listener.local_addr().unwrap().port()
}

/// Check if the `opencode` CLI is available on PATH.
fn check_opencode_available() -> bool {
    std::process::Command::new("opencode")
        .arg("version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok()
}

pub fn run() {
    tauri::Builder::default()
        // --- Plugins (must be registered before setup) ---
        .plugin(
            tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // --- Setup ---
        .setup(|app| {
            // (a) Check for opencode CLI
            if !check_opencode_available() {
                eprintln!(
                    "[weave-fleet] WARNING: 'opencode' CLI not found on PATH. \
                     Agent sessions will not be able to spawn."
                );
            }

            // (b) Find free port
            let port = find_free_port();
            println!("[weave-fleet] Using port {}", port);

            // (c) Spawn sidecar (production only)
            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app.path().resource_dir()
                    .expect("Failed to get resource directory");
                let server_js = resource_dir.join("app").join("server.js");

                // Validate server.js path
                if !server_js.exists() || !server_js.is_file() {
                    panic!("server.js not found at {:?}", server_js);
                }
                if !server_js.starts_with(&resource_dir) {
                    panic!("server.js path escapes resource directory: {:?}", server_js);
                }

                let sidecar = app
                    .shell()
                    .sidecar("node")
                    .expect("Failed to create sidecar command")
                    .args([server_js.to_str().unwrap()])
                    .env("PORT", port.to_string())
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production");

                let (mut rx, child) = sidecar.spawn().expect("Failed to spawn sidecar");

                // Store child handle for cleanup
                app.manage(SidecarState {
                    child: Mutex::new(Some(child)),
                    port,
                });

                // Drain stdout/stderr in background
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
            }

            // In dev mode, manage a dummy SidecarState so shutdown doesn't panic
            #[cfg(debug_assertions)]
            {
                app.manage(SidecarState {
                    child: Mutex::new(None),
                    port,
                });
            }

            // (d) Health check + webview navigation (production only)
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            #[cfg(not(debug_assertions))]
            {
                let window_clone = window.clone();
                tauri::async_runtime::spawn(async move {
                    let health_url = format!("http://127.0.0.1:{}/api/version", port);
                    let client = reqwest::Client::new();
                    let start = std::time::Instant::now();

                    loop {
                        if start.elapsed() > std::time::Duration::from_secs(30) {
                            eprintln!(
                                "[weave-fleet] Sidecar failed to start within 30 seconds"
                            );
                            // Show error in the placeholder page
                            let _ = window_clone.eval(
                                "document.body.innerHTML = '<h2>Failed to start server</h2><p>The application server did not respond within 30 seconds.</p>';"
                            );
                            let _ = window_clone.show();
                            return;
                        }
                        match client.get(&health_url).send().await {
                            Ok(resp) if resp.status().is_success() => break,
                            _ => {
                                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                            }
                        }
                    }

                    // Navigate webview to the sidecar
                    let url = format!("http://127.0.0.1:{}", port);
                    println!("[weave-fleet] Sidecar ready, navigating to {}", url);
                    let _ = window_clone.navigate(url.parse().unwrap());
                    let _ = window_clone.show();
                });
            }

            // In dev mode, window is shown immediately (devUrl handles it)
            #[cfg(debug_assertions)]
            {
                let _ = window.show();
            }

            // (e) System tray
            let show_hide =
                MenuItem::with_id(app, "show_hide", "Show Window", true, None::<&str>)?;
            let agent_count =
                MenuItem::with_id(app, "agent_count", "Agents: 0 active", false, None::<&str>)?;
            let quit =
                MenuItem::with_id(app, "quit", "Quit Weave Fleet", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;

            let menu =
                Menu::with_items(app, &[&show_hide, &sep1, &agent_count, &sep2, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Weave Fleet")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
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
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Store tray state for polling updates
            app.manage(TrayState {
                agent_count_item: agent_count,
            });

            // (f) Agent count polling (every 10 seconds)
            let handle = app.handle().clone();
            let fleet_url = format!("http://127.0.0.1:{}/api/fleet/summary", port);
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                // Wait for sidecar to be ready before starting to poll
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                loop {
                    if let Ok(resp) = client.get(&fleet_url).send().await {
                        if let Ok(body) = resp.json::<serde_json::Value>().await {
                            if let Some(count) =
                                body.get("activeSessions").and_then(|v| v.as_u64())
                            {
                                let text = format!("Agents: {} active", count);
                                if let Some(state) = handle.try_state::<TrayState>() {
                                    let _ = state.agent_count_item.set_text(&text);
                                }
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                }
            });

            // (g) Auto-update check (delayed 5s after startup)
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                match update_handle.updater() {
                    Ok(updater) => match updater.check().await {
                        Ok(Some(update)) => {
                            println!(
                                "[weave-fleet] Update available: {}",
                                update.version
                            );
                        }
                        Ok(None) => {
                            println!("[weave-fleet] No update available");
                        }
                        Err(e) => {
                            eprintln!("[weave-fleet] Update check failed: {}", e);
                        }
                    },
                    Err(e) => {
                        eprintln!("[weave-fleet] Updater not available: {}", e);
                    }
                }
            });

            Ok(())
        })
        // --- Minimize to tray on close ---
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // --- Kill sidecar on exit ---
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut child) = state.child.lock() {
                        if let Some(child) = child.take() {
                            println!("[weave-fleet] Killing sidecar on exit");
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
