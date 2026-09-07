//! Android Media3/ExoPlayer command map.
//!
//! Always compiled so desktop `cargo test` covers URI rejection and the
//! PlayerCommand → engine-call mapping. The JNI/Media3 actor lives behind
//! `cfg(target_os = "android")`.

use crate::error::{AppError, ErrorCode};
use crate::player::model::{validate_local_path, PlayerCommand, TrackKind};
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum AndroidEngineCall {
    Load {
        uri: String,
    },
    Play,
    Pause,
    TogglePause,
    Seek {
        position_ms: i64,
        absolute: bool,
    },
    SetVolume {
        volume: f64,
    },
    SetMuted {
        muted: bool,
    },
    SetSpeed {
        speed: f64,
    },
    SelectTrack {
        kind: TrackKind,
        track_id: Option<i64>,
    },
    AddSubtitle {
        uri: String,
    },
    RemoveSubtitle {
        track_id: i64,
    },
    /// Next/prev/repeat/reorder are applied in Rust; the actor Loads current after.
    Playlist,
    NoOp {
        reason: &'static str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AndroidMapError {
    UrlRejected,
    InvalidPath,
}

/// Map a typed overlay command onto a Media3 engine call.
///
/// Local `content://` / `file://` URIs and filesystem paths become `Load`.
/// `http://` and `https://` are rejected. Playlist mutations stay in Rust.
pub fn map_command(cmd: &PlayerCommand) -> Result<AndroidEngineCall, AndroidMapError> {
    match cmd {
        PlayerCommand::Play { .. } => Ok(AndroidEngineCall::Play),
        PlayerCommand::Pause { .. } => Ok(AndroidEngineCall::Pause),
        PlayerCommand::TogglePause { .. } => Ok(AndroidEngineCall::TogglePause),
        PlayerCommand::Seek {
            position_secs,
            absolute,
            ..
        } => Ok(AndroidEngineCall::Seek {
            position_ms: (position_secs * 1000.0) as i64,
            absolute: *absolute,
        }),
        PlayerCommand::SetVolume { volume, .. } => {
            Ok(AndroidEngineCall::SetVolume { volume: *volume })
        }
        PlayerCommand::SetMuted { muted, .. } => Ok(AndroidEngineCall::SetMuted { muted: *muted }),
        PlayerCommand::SetSpeed { speed, .. } => Ok(AndroidEngineCall::SetSpeed { speed: *speed }),
        PlayerCommand::SetAudioFx { .. } => Ok(AndroidEngineCall::NoOp { reason: "audio-fx" }),
        PlayerCommand::SetSubtitleStyle { .. } => Ok(AndroidEngineCall::NoOp {
            reason: "ass-style",
        }),
        PlayerCommand::SetHostBounds { .. } => Ok(AndroidEngineCall::NoOp {
            reason: "host-bounds",
        }),
        PlayerCommand::SetFullscreen { .. } => Ok(AndroidEngineCall::NoOp {
            reason: "fullscreen",
        }),
        PlayerCommand::OpenPaths { paths, .. } => {
            let first = paths.first().ok_or(AndroidMapError::InvalidPath)?;
            Ok(AndroidEngineCall::Load {
                uri: map_local_uri(first)?,
            })
        }
        PlayerCommand::AddSubtitle { path, .. } => Ok(AndroidEngineCall::AddSubtitle {
            uri: map_local_uri(path)?,
        }),
        PlayerCommand::RemoveSubtitle { track_id, .. } => Ok(AndroidEngineCall::RemoveSubtitle {
            track_id: *track_id,
        }),
        PlayerCommand::SelectTrack { kind, track_id, .. } => Ok(AndroidEngineCall::SelectTrack {
            kind: *kind,
            track_id: *track_id,
        }),
        PlayerCommand::Next { .. }
        | PlayerCommand::Previous { .. }
        | PlayerCommand::SetRepeat { .. }
        | PlayerCommand::ClearPlaylist { .. }
        | PlayerCommand::RemovePlaylistItem { .. }
        | PlayerCommand::PlayIndex { .. }
        | PlayerCommand::ReorderPlaylist { .. } => Ok(AndroidEngineCall::Playlist),
        PlayerCommand::ApplySettings { .. } => Ok(AndroidEngineCall::NoOp { reason: "settings" }),
        PlayerCommand::GetSnapshot { .. } => Ok(AndroidEngineCall::NoOp { reason: "snapshot" }),
        PlayerCommand::FlushNow { .. } => Ok(AndroidEngineCall::NoOp { reason: "flush" }),
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPlaybackState {
    pub position_secs: f64,
    pub duration_secs: f64,
    pub phase: crate::player::model::PlayerPhase,
    pub audio_tracks: Vec<crate::player::model::Track>,
    pub subtitle_tracks: Vec<crate::player::model::Track>,
    pub error: Option<String>,
    pub metadata: Option<crate::player::model::MediaMetadata>,
}

/// Native Media3 (or a test double) that executes mapped engine calls.
pub trait AndroidPlaybackEngine: Send {
    fn playback_state(&mut self) -> Result<Option<AndroidPlaybackState>, AppError> {
        Ok(None)
    }
    fn apply(&mut self, call: &AndroidEngineCall) -> Result<(), AppError>;
    fn set_surface_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        let _ = (x, y, w, h);
        Ok(())
    }
    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        let _ = visible;
        Ok(())
    }
}

/// Test double that records every call the actor forwards to the engine.
#[derive(Clone, Default)]
pub struct RecordingEngine {
    pub calls: Arc<Mutex<Vec<AndroidEngineCall>>>,
    pub state: Arc<Mutex<Option<AndroidPlaybackState>>>,
}

impl AndroidPlaybackEngine for RecordingEngine {
    fn playback_state(&mut self) -> Result<Option<AndroidPlaybackState>, AppError> {
        Ok(self.state.lock().clone())
    }
    fn apply(&mut self, call: &AndroidEngineCall) -> Result<(), AppError> {
        self.calls.lock().push(call.clone());
        Ok(())
    }
}

#[cfg(target_os = "android")]
pub struct MobileEngine {
    app: tauri::AppHandle,
}

#[cfg(target_os = "android")]
impl MobileEngine {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

#[cfg(target_os = "android")]
impl AndroidPlaybackEngine for MobileEngine {
    fn playback_state(&mut self) -> Result<Option<AndroidPlaybackState>, AppError> {
        let value = tauri_plugin_replay_media3::playback_state(&self.app)
            .map_err(|e| AppError::new(ErrorCode::EngineInit, e.to_string(), true))?;
        serde_json::from_value(value)
            .map(Some)
            .map_err(|e| AppError::new(ErrorCode::EngineInit, e.to_string(), true))
    }
    fn apply(&mut self, call: &AndroidEngineCall) -> Result<(), AppError> {
        tauri_plugin_replay_media3::invoke_engine_call(
            &self.app,
            call_name(call),
            call_payload(call),
        )
        .map_err(|e| AppError::new(ErrorCode::EngineInit, e.to_string(), true))
    }

    fn set_surface_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        tauri_plugin_replay_media3::invoke_engine_call(
            &self.app,
            "setSurface",
            serde_json::json!({ "x": x, "y": y, "w": w, "h": h }),
        )
        .map_err(|e| AppError::new(ErrorCode::RenderHost, e.to_string(), true))
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        tauri_plugin_replay_media3::invoke_engine_call(
            &self.app,
            "setVisible",
            serde_json::json!({ "visible": visible }),
        )
        .map_err(|e| AppError::new(ErrorCode::RenderHost, e.to_string(), true))
    }
}

pub fn call_name(call: &AndroidEngineCall) -> &'static str {
    match call {
        AndroidEngineCall::Load { .. } => "load",
        AndroidEngineCall::Play => "play",
        AndroidEngineCall::Pause => "pause",
        AndroidEngineCall::TogglePause => "togglePause",
        AndroidEngineCall::Seek { .. } => "seek",
        AndroidEngineCall::SetVolume { .. } => "setVolume",
        AndroidEngineCall::SetMuted { .. } => "setMuted",
        AndroidEngineCall::SetSpeed { .. } => "setSpeed",
        AndroidEngineCall::SelectTrack { .. } => "selectTrack",
        AndroidEngineCall::AddSubtitle { .. } => "addSubtitle",
        AndroidEngineCall::RemoveSubtitle { .. } => "removeSubtitle",
        AndroidEngineCall::Playlist => "playlist",
        AndroidEngineCall::NoOp { .. } => "noop",
    }
}

pub fn call_payload(call: &AndroidEngineCall) -> serde_json::Value {
    match call {
        AndroidEngineCall::Load { uri } => serde_json::json!({ "uri": uri }),
        AndroidEngineCall::Seek {
            position_ms,
            absolute,
        } => serde_json::json!({ "positionMs": position_ms, "absolute": absolute }),
        AndroidEngineCall::SetVolume { volume } => serde_json::json!({ "volume": volume }),
        AndroidEngineCall::SetMuted { muted } => serde_json::json!({ "muted": muted }),
        AndroidEngineCall::SetSpeed { speed } => serde_json::json!({ "speed": speed }),
        AndroidEngineCall::SelectTrack { kind, track_id } => {
            serde_json::json!({ "kind": kind, "trackId": track_id })
        }
        AndroidEngineCall::AddSubtitle { uri } => serde_json::json!({ "uri": uri }),
        AndroidEngineCall::RemoveSubtitle { track_id } => {
            serde_json::json!({ "trackId": track_id })
        }
        _ => serde_json::json!({}),
    }
}

fn map_local_uri(raw: &str) -> Result<String, AndroidMapError> {
    match validate_local_path(raw) {
        Ok(uri) => Ok(uri),
        Err(err) => match err.code {
            ErrorCode::UrlRejected => Err(AndroidMapError::UrlRejected),
            // Mapper must not require a real file; existence is the engine's problem.
            ErrorCode::FileNotFound => Ok(raw.trim().to_string()),
            _ => Err(AndroidMapError::InvalidPath),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::model::SubtitleStyle;

    fn rid() -> String {
        "t".into()
    }

    #[test]
    fn play_maps_to_play() {
        let mapped = map_command(&PlayerCommand::Play { request_id: rid() }).unwrap();
        assert_eq!(mapped, AndroidEngineCall::Play);
    }

    #[test]
    fn pause_maps_to_pause() {
        let mapped = map_command(&PlayerCommand::Pause { request_id: rid() }).unwrap();
        assert_eq!(mapped, AndroidEngineCall::Pause);
    }

    #[test]
    fn toggle_pause_is_distinct() {
        let mapped = map_command(&PlayerCommand::TogglePause { request_id: rid() }).unwrap();
        assert_eq!(mapped, AndroidEngineCall::TogglePause);
        assert_ne!(mapped, AndroidEngineCall::Play);
        assert_ne!(mapped, AndroidEngineCall::Pause);
    }

    #[test]
    fn seek_absolute_vs_relative() {
        let absolute = map_command(&PlayerCommand::Seek {
            request_id: rid(),
            position_secs: 1.5,
            absolute: true,
        })
        .unwrap();
        assert_eq!(
            absolute,
            AndroidEngineCall::Seek {
                position_ms: 1500,
                absolute: true,
            }
        );
        let relative = map_command(&PlayerCommand::Seek {
            request_id: rid(),
            position_secs: 0.25,
            absolute: false,
        })
        .unwrap();
        assert_eq!(
            relative,
            AndroidEngineCall::Seek {
                position_ms: 250,
                absolute: false,
            }
        );
    }

    #[test]
    fn set_audio_fx_is_noop() {
        let mapped = map_command(&PlayerCommand::SetAudioFx {
            request_id: rid(),
            enabled: true,
            preset: "Flat".into(),
        })
        .unwrap();
        assert_eq!(mapped, AndroidEngineCall::NoOp { reason: "audio-fx" });
    }

    #[test]
    fn set_subtitle_style_is_noop() {
        let mapped = map_command(&PlayerCommand::SetSubtitleStyle {
            request_id: rid(),
            style: SubtitleStyle::default(),
        })
        .unwrap();
        assert_eq!(
            mapped,
            AndroidEngineCall::NoOp {
                reason: "ass-style"
            }
        );
    }

    #[test]
    fn open_paths_content_uri_loads() {
        let uri = "content://media/external/video/media/1";
        let mapped = map_command(&PlayerCommand::OpenPaths {
            request_id: rid(),
            paths: vec![uri.into()],
            replace: true,
        })
        .unwrap();
        assert_eq!(
            mapped,
            AndroidEngineCall::Load {
                uri: uri.to_string(),
            }
        );
    }

    #[test]
    fn open_paths_file_uri_loads() {
        let uri = "file:///storage/emulated/0/Movies/a.mp4";
        let mapped = map_command(&PlayerCommand::OpenPaths {
            request_id: rid(),
            paths: vec![uri.into()],
            replace: true,
        })
        .unwrap();
        assert_eq!(
            mapped,
            AndroidEngineCall::Load {
                uri: uri.to_string(),
            }
        );
    }

    #[test]
    fn open_paths_https_is_rejected() {
        let err = map_command(&PlayerCommand::OpenPaths {
            request_id: rid(),
            paths: vec!["https://example.com/a.mp4".into()],
            replace: true,
        })
        .unwrap_err();
        assert_eq!(err, AndroidMapError::UrlRejected);
    }

    #[test]
    fn call_name_matches_kotlin_commands() {
        assert_eq!(call_name(&AndroidEngineCall::Play), "play");
        assert_eq!(
            call_name(&AndroidEngineCall::Load { uri: "x".into() }),
            "load"
        );
        assert_eq!(call_name(&AndroidEngineCall::TogglePause), "togglePause");
    }

    #[test]
    fn set_speed_maps() {
        let mapped = map_command(&PlayerCommand::SetSpeed {
            request_id: rid(),
            speed: 1.5,
        })
        .unwrap();
        assert_eq!(mapped, AndroidEngineCall::SetSpeed { speed: 1.5 });
    }
}
