mod diagnostics;
pub mod error;
pub mod ipc;
pub mod player;
pub mod playlist;
pub mod settings;

use ipc::{start_player, AppState};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::init_logging();
    diagnostics::install_panic_hook();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resolver = app.path();
            let app_data = resolver
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("replay"));
            std::fs::create_dir_all(&app_data).ok();

            let state = Arc::new(AppState::new(app_data));
            app.manage(state.clone());

            let window = app.get_webview_window("main").expect("main window");
            let parent_wid = window_wid(&window).unwrap_or(0);
            start_player(app.handle(), &state, parent_wid);

            let cli_paths: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter(|a| std::path::Path::new(a).is_file())
                .collect();
            if !cli_paths.is_empty() {
                if let Some(player) = state.player.lock().as_ref() {
                    player.send(player::PlayerCommand::OpenPaths {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        paths: cli_paths,
                        replace: true,
                    });
                }
            }

            let state_resize = state.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Destroyed => {
                    tracing::info!("main window destroyed");
                }
                WindowEvent::Resized(size) => {
                    if let Some(player) = state_resize.player.lock().as_ref() {
                        player.send(player::PlayerCommand::SetHostBounds {
                            request_id: uuid::Uuid::new_v4().to_string(),
                            width: size.width,
                            height: size.height,
                        });
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::player_command,
            ipc::get_snapshot,
            ipc::get_settings,
            ipc::update_settings,
            ipc::open_media_paths,
            ipc::export_types,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Replay");

    app.run(|_app_handle, event| {
        if let RunEvent::Exit = event {
            tracing::info!("Replay shutting down");
        }
    });
}

fn window_wid(window: &tauri::WebviewWindow) -> Option<i64> {
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        #[cfg(windows)]
        RawWindowHandle::Win32(h) => Some(h.hwnd.get() as i64),
        #[cfg(all(unix, not(target_os = "macos")))]
        RawWindowHandle::Xlib(h) => Some(h.window as i64),
        #[cfg(all(unix, not(target_os = "macos")))]
        RawWindowHandle::Xcb(h) => Some(h.window.get() as i64),
        #[cfg(target_os = "macos")]
        RawWindowHandle::AppKit(h) => Some(h.ns_view.as_ptr() as i64),
        _ => None,
    }
}
