use crate::error::AppError;
use crate::player::model::{PlayerCommand, PlayerEvent, PlayerSnapshot, Settings};
use crate::player::PlayerHandle;
use crate::settings::SettingsStore;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct AppState {
    pub player: Mutex<Option<PlayerHandle>>,
    pub latest: Mutex<PlayerSnapshot>,
    pub settings_path: Mutex<PathBuf>,
    pub parent_wid: Mutex<i64>,
}

impl AppState {
    pub fn new(app_data: PathBuf) -> Self {
        Self {
            player: Mutex::new(None),
            latest: Mutex::new(PlayerSnapshot::default()),
            settings_path: Mutex::new(app_data),
            parent_wid: Mutex::new(0),
        }
    }
}

#[tauri::command]
pub fn player_command(
    state: State<'_, Arc<AppState>>,
    command: PlayerCommand,
) -> Result<PlayerSnapshot, AppError> {
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

pub fn start_player(app: &AppHandle, state: &Arc<AppState>, parent_wid: i64) {
    *state.parent_wid.lock() = parent_wid;
    let (tx, rx) = mpsc::channel::<PlayerEvent>();
    let app_data = state.settings_path.lock().clone();
    let handle = PlayerHandle::spawn(tx, app_data, parent_wid, 1100, 700);
    *state.player.lock() = Some(handle);

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
