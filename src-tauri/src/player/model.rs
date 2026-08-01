//! Shared player contracts exported to TypeScript via ts-rs.

use crate::error::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const SETTINGS_VERSION: u32 = 3;
pub const MAX_PLAYLIST_ITEMS: usize = 500;
pub const MAX_RECENTS: usize = 50;
pub const MAX_RESUME_ENTRIES: usize = 200;
pub const POSITION_SAMPLE_HZ: f64 = 4.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum PlayerPhase {
    Idle,
    Loading,
    Ready,
    Playing,
    Paused,
    Seeking,
    Buffering,
    Ended,
    Error,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode {
    #[default]
    Off,
    One,
    All,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Audio,
    Subtitle,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub duration_secs: Option<f64>,
    pub last_position_secs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub kind: TrackKind,
    pub title: Option<String>,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub selected: bool,
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub date: Option<String>,
    pub comment: Option<String>,
    pub container: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSnapshot {
    pub items: Vec<MediaItem>,
    pub current_index: Option<usize>,
    pub repeat: RepeatMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub delay_secs: f64,
    pub scale: f64,
    pub position: f64,
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            delay_secs: 0.0,
            scale: 1.0,
            position: 100.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub revision: u64,
    pub load_generation: u64,
    pub phase: PlayerPhase,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f64,
    pub muted: bool,
    pub speed: f64,
    pub fullscreen: bool,
    pub current: Option<MediaItem>,
    pub playlist: PlaylistSnapshot,
    pub audio_tracks: Vec<Track>,
    pub subtitle_tracks: Vec<Track>,
    pub metadata: Option<MediaMetadata>,
    pub subtitle_style: SubtitleStyle,
    pub error: Option<AppError>,
    pub eof_reached: bool,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            load_generation: 0,
            phase: PlayerPhase::Idle,
            position_secs: 0.0,
            duration_secs: 0.0,
            volume: 100.0,
            muted: false,
            speed: 1.0,
            fullscreen: false,
            current: None,
            playlist: PlaylistSnapshot {
                items: Vec::new(),
                current_index: None,
                repeat: RepeatMode::Off,
            },
            audio_tracks: Vec::new(),
            subtitle_tracks: Vec::new(),
            metadata: None,
            subtitle_style: SubtitleStyle::default(),
            error: None,
            eof_reached: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlayerCommand {
    OpenPaths {
        request_id: String,
        paths: Vec<String>,
        replace: bool,
    },
    Play {
        request_id: String,
    },
    Pause {
        request_id: String,
    },
    TogglePause {
        request_id: String,
    },
    Seek {
        request_id: String,
        position_secs: f64,
        absolute: bool,
    },
    SetVolume {
        request_id: String,
        volume: f64,
    },
    SetMuted {
        request_id: String,
        muted: bool,
    },
    SetSpeed {
        request_id: String,
        speed: f64,
    },
    SetAudioFx {
        request_id: String,
        enabled: bool,
        preset: String,
    },
    SetFullscreen {
        request_id: String,
        fullscreen: bool,
    },
    SetHostBounds {
        request_id: String,
        width: u32,
        height: u32,
        /// Physical px to punch out at the bottom for HTML chrome. `0` = full-bleed.
        #[serde(default)]
        chrome_bottom: u32,
        /// Physical px to punch out at the top for the custom title bar. `0` = full-bleed.
        #[serde(default)]
        chrome_top: u32,
        /// Physical px to punch out on the right for drawers. `0` = none.
        #[serde(default)]
        chrome_right: u32,
        /// Measured ⋯ menu panel rect (physical px, client coords). Zero size = none.
        #[serde(default)]
        menu_x: u32,
        #[serde(default)]
        menu_y: u32,
        #[serde(default)]
        menu_w: u32,
        #[serde(default)]
        menu_h: u32,
    },
    Next {
        request_id: String,
    },
    Previous {
        request_id: String,
    },
    SetRepeat {
        request_id: String,
        mode: RepeatMode,
    },
    SelectTrack {
        request_id: String,
        kind: TrackKind,
        track_id: Option<i64>,
    },
    AddSubtitle {
        request_id: String,
        path: String,
    },
    SetSubtitleStyle {
        request_id: String,
        style: SubtitleStyle,
    },
    ClearPlaylist {
        request_id: String,
    },
    RemovePlaylistItem {
        request_id: String,
        index: usize,
    },
    PlayIndex {
        request_id: String,
        index: usize,
    },
    ReorderPlaylist {
        request_id: String,
        from: usize,
        to: usize,
    },
    GetSnapshot {
        request_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlayerEvent {
    Snapshot {
        snapshot: PlayerSnapshot,
    },
    Position {
        load_generation: u64,
        revision: u64,
        position_secs: f64,
        duration_secs: f64,
    },
    PhaseChanged {
        load_generation: u64,
        revision: u64,
        phase: PlayerPhase,
    },
    Error {
        error: AppError,
        snapshot: PlayerSnapshot,
    },
    Ready {
        load_generation: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub volume: f64,
    pub muted: bool,
    pub speed: f64,
    #[serde(default = "default_fx_enabled")]
    pub fx_enabled: bool,
    #[serde(default = "default_fx_preset")]
    pub fx_preset: String,
    pub repeat: RepeatMode,
    pub resume_enabled: bool,
    pub autoplay_next: bool,
    pub hardware_decode: bool,
    pub subtitle_style: SubtitleStyle,
    pub remember_window: bool,
    pub window_width: f64,
    pub window_height: f64,
    /// Keyboard seek step in seconds (←/→ and J/L).
    #[serde(default = "default_seek_step_secs")]
    pub seek_step_secs: f64,
    pub recent: Vec<MediaItem>,
    pub resume_positions: Vec<ResumeEntry>,
}

fn default_seek_step_secs() -> f64 {
    5.0
}

fn default_fx_enabled() -> bool {
    true
}
fn default_fx_preset() -> String {
    "Flat".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ResumeEntry {
    pub path: String,
    pub position_secs: f64,
    pub updated_at: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            volume: 100.0,
            muted: false,
            speed: 1.0,
            fx_enabled: default_fx_enabled(),
            fx_preset: default_fx_preset(),
            repeat: RepeatMode::Off,
            resume_enabled: true,
            autoplay_next: true,
            hardware_decode: true,
            subtitle_style: SubtitleStyle::default(),
            remember_window: true,
            window_width: 1100.0,
            window_height: 700.0,
            seek_step_secs: default_seek_step_secs(),
            recent: Vec::new(),
            resume_positions: Vec::new(),
        }
    }
}

impl PlayerCommand {
    pub fn request_id(&self) -> &str {
        match self {
            Self::OpenPaths { request_id, .. }
            | Self::Play { request_id }
            | Self::Pause { request_id }
            | Self::TogglePause { request_id }
            | Self::Seek { request_id, .. }
            | Self::SetVolume { request_id, .. }
            | Self::SetMuted { request_id, .. }
            | Self::SetSpeed { request_id, .. }
            | Self::SetAudioFx { request_id, .. }
            | Self::SetFullscreen { request_id, .. }
            | Self::SetHostBounds { request_id, .. }
            | Self::Next { request_id }
            | Self::Previous { request_id }
            | Self::SetRepeat { request_id, .. }
            | Self::SelectTrack { request_id, .. }
            | Self::AddSubtitle { request_id, .. }
            | Self::SetSubtitleStyle { request_id, .. }
            | Self::ClearPlaylist { request_id }
            | Self::RemovePlaylistItem { request_id, .. }
            | Self::PlayIndex { request_id, .. }
            | Self::ReorderPlaylist { request_id, .. }
            | Self::GetSnapshot { request_id } => request_id,
        }
    }
}

pub fn validate_local_path(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "Path is empty.",
            true,
        ));
    }
    if trimmed.contains("://") {
        return Err(AppError::new(
            ErrorCode::UrlRejected,
            "Network and stream URLs are not supported in v0.1. Open a local file instead.",
            true,
        ));
    }
    let path = std::path::PathBuf::from(trimmed);
    let canonical = std::fs::canonicalize(&path).map_err(|_| {
        AppError::new(
            ErrorCode::FileNotFound,
            format!("File not found: {}", redact_path(trimmed)),
            true,
        )
    })?;
    if !canonical.is_file() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "Path is not a file.",
            true,
        ));
    }
    // Spaces are fine; strip Windows `\\?\` extended prefixes that confuse FFmpeg/libmpv.
    Ok(path_for_mpv(canonical))
}

/// Convert a canonical OS path into a form libmpv/FFmpeg accept reliably.
pub fn path_for_mpv(canonical: std::path::PathBuf) -> String {
    let s = canonical.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix(r"UNC\") {
                return format!(r"\\{unc}");
            }
            return rest.to_string();
        }
    }
    s
}

pub fn display_name_for(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

pub fn redact_path(path: &str) -> String {
    let p = std::path::Path::new(path);
    match p.file_name().and_then(|s| s.to_str()) {
        Some(name) => format!("…/{name}"),
        None => "…".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_urls() {
        let err = validate_local_path("https://example.com/a.mp4").unwrap_err();
        assert_eq!(err.code, ErrorCode::UrlRejected);
    }

    #[test]
    fn rejects_empty() {
        let err = validate_local_path("  ").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidPath);
    }

    #[test]
    fn redacts_path() {
        assert_eq!(redact_path(r"C:\Users\me\video.mp4"), "…/video.mp4");
    }

    #[test]
    fn strips_windows_extended_prefix() {
        let p = std::path::PathBuf::from(r"\\?\C:\Users\me\My Video.mp4");
        let out = path_for_mpv(p);
        assert_eq!(out, r"C:\Users\me\My Video.mp4");
        let unc = path_for_mpv(std::path::PathBuf::from(r"\\?\UNC\server\share\a.mp4"));
        assert_eq!(unc, r"\\server\share\a.mp4");
    }
}
