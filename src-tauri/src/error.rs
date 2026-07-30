use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// Stable application error returned across the IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub recoverable: bool,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export, export_to = "../../src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidPath,
    UrlRejected,
    FileNotFound,
    UnsupportedMedia,
    CodecFailure,
    EngineMissing,
    EngineInit,
    HardwareDecode,
    AudioDevice,
    RenderHost,
    PlaylistBounds,
    SettingsCorrupt,
    CommandRejected,
    Internal,
    PanicRecovered,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable,
            correlation_id: Uuid::new_v4().to_string(),
        }
    }

    pub fn with_correlation(mut self, id: impl Into<String>) -> Self {
        self.correlation_id = id.into();
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
