use crate::error::AppError;
use crate::player::host::{create_host, ChromeCutout, VideoHost};
use crate::player::model::{PlayerCommand, PlayerEvent, PlayerSnapshot, Settings};
use crate::player::PlayerHandle;
use crate::settings::SettingsStore;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// Last applied video-host layout (physical pixels). `video_h == 0` means hidden.
#[derive(Debug, Clone, Copy)]
pub struct HostLayout {
    pub client_w: u32,
    pub client_h: u32,
    pub video_h: u32,
    /// Top cutout for custom title bar (physical px).
    pub chrome_top: u32,
    /// Bottom cutout for HTML chrome (physical px). Independent of JS/parent height skew.
    pub chrome_bottom: u32,
    /// Right cutout for drawers (physical px).
    pub chrome_right: u32,
    /// Measured ⋯ menu panel rect (physical px, client coords). Zero size = none.
    pub menu_x: u32,
    pub menu_y: u32,
    pub menu_w: u32,
    pub menu_h: u32,
    pub visible: bool,
}

impl HostLayout {
    fn cutout(&self) -> ChromeCutout {
        ChromeCutout {
            top: self.chrome_top,
            bottom: self.chrome_bottom,
            right: self.chrome_right,
            menu_x: self.menu_x,
            menu_y: self.menu_y,
            menu_w: self.menu_w,
            menu_h: self.menu_h,
        }
    }

    /// Drop the ⋯ menu hole. The rect was measured against a specific client
    /// size, so it is meaningless once that size changes or the host hides.
    fn clear_menu(&mut self) {
        self.menu_x = 0;
        self.menu_y = 0;
        self.menu_w = 0;
        self.menu_h = 0;
    }
}

impl Default for HostLayout {
    fn default() -> Self {
        Self {
            client_w: 1100,
            client_h: 700,
            video_h: 0,
            chrome_top: 0,
            chrome_bottom: 0,
            chrome_right: 0,
            menu_x: 0,
            menu_y: 0,
            menu_w: 0,
            menu_h: 0,
            visible: false,
        }
    }
}

pub struct AppState {
    pub player: Mutex<Option<PlayerHandle>>,
    pub video_host: Mutex<Option<Box<dyn VideoHost>>>,
    pub latest: Mutex<PlayerSnapshot>,
    pub settings_path: Mutex<PathBuf>,
    pub parent_wid: Mutex<i64>,
    pub host_layout: Mutex<HostLayout>,
}

impl AppState {
    pub fn new(app_data: PathBuf) -> Self {
        Self {
            player: Mutex::new(None),
            video_host: Mutex::new(None),
            latest: Mutex::new(PlayerSnapshot::default()),
            settings_path: Mutex::new(app_data),
            parent_wid: Mutex::new(0),
            host_layout: Mutex::new(HostLayout::default()),
        }
    }
}

#[tauri::command]
pub fn player_command(
    state: State<'_, Arc<AppState>>,
    command: PlayerCommand,
) -> Result<PlayerSnapshot, AppError> {
    // Host HWND lives on the UI thread — apply bounds here, never in the actor.
    if let PlayerCommand::SetHostBounds {
        width,
        height,
        chrome_bottom,
        chrome_top,
        chrome_right,
        menu_x,
        menu_y,
        menu_w,
        menu_h,
        ..
    } = &command
    {
        apply_host_bounds(
            &state,
            *width,
            *height,
            *chrome_top,
            *chrome_bottom,
            *chrome_right,
            ChromeCutout {
                menu_x: *menu_x,
                menu_y: *menu_y,
                menu_w: *menu_w,
                menu_h: *menu_h,
                ..Default::default()
            },
        );
    }

    if let Some(player) = state.player.lock().as_ref() {
        player.send(command);
        Ok(state.latest.lock().clone())
    } else {
        Err(AppError::new(
            crate::error::ErrorCode::EngineMissing,
            "Player is not initialized yet.",
            true,
        ))
    }
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, Arc<AppState>>) -> PlayerSnapshot {
    state.latest.lock().clone()
}

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> Settings {
    let path = state.settings_path.lock().clone();
    SettingsStore::load(&path).get().clone()
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<Settings, AppError> {
    let path = state.settings_path.lock().clone();
    let mut store = SettingsStore::load(&path);
    let saved = store.update(settings)?.clone();
    Ok(saved)
}

#[tauri::command]
pub fn open_media_paths(
    state: State<'_, Arc<AppState>>,
    paths: Vec<String>,
    replace: bool,
) -> Result<PlayerSnapshot, AppError> {
    let cmd = PlayerCommand::OpenPaths {
        request_id: Uuid::new_v4().to_string(),
        paths,
        replace,
    };
    player_command(state, cmd)
}

#[tauri::command]
pub fn export_types() -> Result<(), String> {
    // Invoked by `cargo test` / build scripts to refresh TS contracts.
    use crate::error::{AppError, ErrorCode};
    use crate::player::model::*;
    use ts_rs::TS;

    MediaItem::export_all().map_err(|e| e.to_string())?;
    Track::export_all().map_err(|e| e.to_string())?;
    MediaMetadata::export_all().map_err(|e| e.to_string())?;
    PlaylistSnapshot::export_all().map_err(|e| e.to_string())?;
    SubtitleStyle::export_all().map_err(|e| e.to_string())?;
    PlayerSnapshot::export_all().map_err(|e| e.to_string())?;
    PlayerCommand::export_all().map_err(|e| e.to_string())?;
    PlayerEvent::export_all().map_err(|e| e.to_string())?;
    Settings::export_all().map_err(|e| e.to_string())?;
    ResumeEntry::export_all().map_err(|e| e.to_string())?;
    PlayerPhase::export_all().map_err(|e| e.to_string())?;
    RepeatMode::export_all().map_err(|e| e.to_string())?;
    TrackKind::export_all().map_err(|e| e.to_string())?;
    AppError::export_all().map_err(|e| e.to_string())?;
    ErrorCode::export_all().map_err(|e| e.to_string())?;
    Ok(())
}

/// Create the video host on the UI thread, then spawn the libmpv actor with the embed wid.
pub fn start_player(
    app: &AppHandle,
    state: &Arc<AppState>,
    parent_wid: i64,
    width: u32,
    height: u32,
) {
    *state.parent_wid.lock() = parent_wid;
    {
        let mut layout = state.host_layout.lock();
        layout.client_w = width.max(1);
        layout.client_h = height.max(1);
        layout.video_h = 0;
        layout.visible = false;
    }

    let embed_wid = match create_host(parent_wid, width, height) {
        Ok(host) => {
            let wid = host.handle().wid;
            *state.video_host.lock() = Some(host);
            wid
        }
        Err(err) => {
            tracing::error!(error = %err.message, "failed to create video host");
            let snap = PlayerSnapshot {
                phase: crate::player::PlayerPhase::Error,
                error: Some(err.clone()),
                ..PlayerSnapshot::default()
            };
            *state.latest.lock() = snap.clone();
            let _ = app.emit(
                "player://event",
                PlayerEvent::Error {
                    error: err,
                    snapshot: snap,
                },
            );
            0
        }
    };

    let (tx, rx) = mpsc::channel::<PlayerEvent>();
    let app_data = state.settings_path.lock().clone();
    let handle = PlayerHandle::spawn(tx, app_data, embed_wid);
    *state.player.lock() = Some(handle);

    // The HWND_TOP video host swallows pointer input, so chrome reveal on mouse
    // movement is driven by a low-level hook that sees input regardless of which
    // HWND owns it.
    #[cfg(windows)]
    crate::player::host::install_activity_hook(parent_wid, app.clone());

    let app2 = app.clone();
    let state2 = Arc::clone(state);
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            match &event {
                PlayerEvent::Snapshot { snapshot } | PlayerEvent::Error { snapshot, .. } => {
                    *state2.latest.lock() = snapshot.clone();
                }
                PlayerEvent::Position {
                    load_generation,
                    revision,
                    position_secs,
                    duration_secs,
                } => {
                    let mut snap = state2.latest.lock();
                    if *load_generation == snap.load_generation {
                        snap.position_secs = *position_secs;
                        snap.duration_secs = *duration_secs;
                        snap.revision = *revision;
                    }
                }
                PlayerEvent::PhaseChanged {
                    load_generation,
                    revision,
                    phase,
                } => {
                    let mut snap = state2.latest.lock();
                    if *load_generation == snap.load_generation {
                        snap.phase = *phase;
                        snap.revision = *revision;
                    }
                }
                PlayerEvent::Ready { .. } => {}
            }
            let _ = app2.emit("player://event", event);
        }
    });
}

/// Apply explicit video rect from the overlay (physical pixels).
/// `width`/`height` are the client size; cutout args punch HTML overlay regions
/// (`0` = no cutout). `height == 0` hides the host.
pub fn apply_host_bounds(
    state: &AppState,
    width: u32,
    height: u32,
    chrome_top: u32,
    chrome_bottom: u32,
    chrome_right: u32,
    menu: ChromeCutout,
) {
    {
        let mut layout = state.host_layout.lock();
        if width > 0 {
            layout.client_w = width;
        }
        if height == 0 {
            layout.video_h = 0;
            layout.chrome_top = 0;
            layout.chrome_bottom = 0;
            layout.chrome_right = 0;
            layout.clear_menu();
            layout.visible = false;
        } else {
            layout.client_h = height;
            let top = chrome_top.min(height.saturating_sub(1));
            let bottom = chrome_bottom.min(height.saturating_sub(1 + top));
            layout.chrome_top = top;
            layout.chrome_bottom = bottom;
            layout.chrome_right = chrome_right.min(width.saturating_sub(1));
            layout.menu_x = menu.menu_x.min(width);
            layout.menu_y = menu.menu_y.min(height);
            layout.menu_w = menu.menu_w.min(width);
            layout.menu_h = menu.menu_h.min(height);
            // Host stays full client height; cutouts are region-only on Windows.
            layout.video_h = height.max(1);
            layout.visible = true;
        }
    }
    commit_host_layout(state);
}

/// Re-apply layout after a native window resize.
/// Preserves chrome cutouts when chrome is shown; keeps full-bleed when hidden.
pub fn resize_video_host(state: &AppState, client_w: u32, client_h: u32) {
    if client_w == 0 || client_h == 0 {
        return;
    }
    {
        let mut layout = state.host_layout.lock();
        let top = if layout.visible && layout.chrome_top > 0 {
            layout.chrome_top.min(client_h.saturating_sub(1))
        } else {
            0
        };
        let bottom = if layout.visible && layout.chrome_bottom > 0 {
            layout.chrome_bottom.min(client_h.saturating_sub(1 + top))
        } else {
            0
        };
        let right = if layout.visible && layout.chrome_right > 0 {
            layout.chrome_right.min(client_w.saturating_sub(1))
        } else {
            0
        };
        layout.client_w = client_w;
        layout.client_h = client_h;
        layout.chrome_top = top;
        layout.chrome_bottom = bottom;
        layout.chrome_right = right;
        // The overlay re-measures and re-sends the panel rect after a resize.
        layout.clear_menu();
        if layout.visible && layout.video_h > 0 {
            layout.video_h = client_h.max(1);
        }
    }
    commit_host_layout(state);
}

fn commit_host_layout(state: &AppState) {
    let layout = *state.host_layout.lock();
    if let Some(host) = state.video_host.lock().as_mut() {
        if !layout.visible || layout.video_h == 0 {
            if let Err(err) = host.set_visible(false) {
                tracing::warn!(error = %err.message, "video host hide failed");
            }
            tracing::debug!(diag = %host.diagnose(), "video host hidden");
            return;
        }
        if let Err(err) = host.set_chrome_cutout(layout.cutout()) {
            tracing::warn!(error = %err.message, "video host chrome cutout failed");
        }
        if let Err(err) = host.set_bounds(0, 0, layout.client_w.max(1), layout.video_h.max(1)) {
            tracing::warn!(error = %err.message, "video host resize failed");
        } else {
            tracing::info!(
                w = layout.client_w,
                h = layout.client_h,
                video_h = layout.video_h,
                chrome_top = layout.chrome_top,
                chrome = layout.chrome_bottom,
                chrome_right = layout.chrome_right,
                cutout = ?layout.cutout(),
                diag = %host.diagnose(),
                "video host committed above webview"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HostLayout;

    #[test]
    fn host_layout_defaults_hidden() {
        let h = HostLayout::default();
        assert!(!h.visible);
        assert_eq!(h.video_h, 0);
        assert_eq!(h.chrome_top, 0);
        assert_eq!(h.chrome_bottom, 0);
        assert_eq!(h.chrome_right, 0);
        assert_eq!(h.menu_w, 0);
        assert_eq!(h.menu_h, 0);
    }

    #[test]
    fn cutout_carries_measured_menu_rect() {
        let layout = HostLayout {
            chrome_bottom: 98,
            menu_x: 1386,
            menu_y: 700,
            menu_w: 220,
            menu_h: 200,
            visible: true,
            ..HostLayout::default()
        };
        let cutout = layout.cutout();
        assert_eq!(cutout.bottom, 98);
        assert_eq!((cutout.menu_x, cutout.menu_y), (1386, 700));
        assert_eq!((cutout.menu_w, cutout.menu_h), (220, 200));
    }

    #[test]
    fn clear_menu_drops_stale_rect() {
        let mut layout = HostLayout {
            menu_x: 1386,
            menu_y: 700,
            menu_w: 220,
            menu_h: 200,
            ..HostLayout::default()
        };
        layout.clear_menu();
        assert_eq!(layout.cutout(), Default::default());
    }

    #[test]
    fn chrome_inset_preserved_on_resize_math() {
        let mut layout = HostLayout {
            client_w: 1100,
            client_h: 700,
            video_h: 700,
            chrome_top: 40,
            chrome_bottom: 140,
            chrome_right: 0,
            menu_x: 0,
            menu_y: 0,
            menu_w: 0,
            menu_h: 0,
            visible: true,
        };
        let top = layout.chrome_top;
        let bottom = layout.chrome_bottom;
        assert_eq!(top, 40);
        assert_eq!(bottom, 140);
        layout.client_h = 900;
        layout.chrome_top = top.min(layout.client_h.saturating_sub(1));
        layout.chrome_bottom = bottom.min(layout.client_h.saturating_sub(1 + layout.chrome_top));
        layout.video_h = layout.client_h.max(1);
        assert_eq!(layout.video_h, 900);
        assert_eq!(layout.chrome_top, 40);
        assert_eq!(layout.chrome_bottom, 140);
    }
}
