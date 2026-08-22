mod diagnostics;
pub mod error;
pub mod ipc;
pub mod player;
pub mod playlist;
pub mod settings;

use ipc::{resize_video_host, start_player, AppState};
use player::host::ParentSurface;
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
            // Opaque black webview: sibling HWNDs do not alpha-blend, so a transparent
            // webview would reveal the desktop — not the video host underneath.
            // Video renders in an HWND_TOP child above this surface; chrome sits in a
            // reserved bottom strip (see apply_host_bounds / App.tsx sync).
            let _ = window.set_background_color(Some(tauri::window::Color(11, 13, 16, 255)));

            let parent = window_parent(&window);
            #[cfg(windows)]
            if parent.wid != 0 {
                apply_rounded_corners(parent.wid);
            }

            let size = window
                .inner_size()
                .unwrap_or(tauri::PhysicalSize::new(1100, 700));
            start_player(app.handle(), &state, parent, size.width, size.height);

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
                    // Destroy HWND on the UI thread that created it.
                    *state_resize.video_host.lock() = None;
                    #[cfg(windows)]
                    crate::player::host::uninstall_activity_hook();
                }
                WindowEvent::Resized(size) => {
                    tracing::debug!(w = size.width, h = size.height, "main window resized");
                    resize_video_host(&state_resize, size.width, size.height);
                }
                WindowEvent::ScaleFactorChanged {
                    scale_factor,
                    new_inner_size,
                    ..
                } => {
                    tracing::debug!(
                        scale_factor,
                        w = new_inner_size.width,
                        h = new_inner_size.height,
                        "scale factor changed"
                    );
                    resize_video_host(&state_resize, new_inner_size.width, new_inner_size.height);
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

fn window_parent(window: &tauri::WebviewWindow) -> ParentSurface {
    let Ok(handle) = window.window_handle() else {
        return ParentSurface { wid: 0, display: 0 };
    };
    match handle.as_raw() {
        #[cfg(windows)]
        RawWindowHandle::Win32(h) => ParentSurface {
            wid: h.hwnd.get() as i64,
            display: 0,
        },
        #[cfg(all(unix, not(target_os = "macos")))]
        RawWindowHandle::Xlib(h) => ParentSurface {
            wid: h.window as i64,
            display: h.display.as_ptr() as i64,
        },
        #[cfg(all(unix, not(target_os = "macos")))]
        RawWindowHandle::Xcb(h) => ParentSurface {
            wid: h.window.get() as i64,
            display: 0,
        },
        #[cfg(target_os = "macos")]
        RawWindowHandle::AppKit(h) => ParentSurface {
            wid: h.ns_view.as_ptr() as i64,
            display: 0,
        },
        _ => ParentSurface { wid: 0, display: 0 },
    }
}

/// Request Win11 DWM rounded corners for restored (non-maximized) windows.
/// Best-effort: older Windows / missing DWM support is ignored.
#[cfg(windows)]
fn apply_rounded_corners(wid: i64) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let hwnd = HWND(wid as *mut _);
    let preference = DWMWCP_ROUND;
    // Safety: HWND is the live main window; attribute is a POD enum value.
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const _,
            std::mem::size_of_val(&preference) as u32,
        )
    };
    if let Err(err) = result {
        tracing::debug!(?err, "DWM rounded corners unavailable");
    }
}
