use crate::error::{AppError, ErrorCode};
use crate::player::model::{
    display_name_for, MediaItem, ResumeEntry, Settings, MAX_RECENTS, MAX_RESUME_ENTRIES,
};
use chrono::Utc;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::thread;

pub struct SettingsStore {
    path: PathBuf,
    settings: Settings,
    /// Set when the on-disk file exists but could not be read (IO error).
    /// While blocked, saves are skipped so an unreadable file is never
    /// overwritten with in-memory defaults; the next launch re-reads it.
    persist_blocked: bool,
}

impl SettingsStore {
    pub fn load(app_data: &Path) -> Self {
        let path = app_data.join("settings.json");
        let (settings, persist_blocked) = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
                Ok(s) => (s.normalized(), false),
                Err(e) => {
                    // Corrupt file: preserve it for inspection, then fall back
                    // to defaults (replacing any previous .bak).
                    let bak = app_data.join("settings.json.bak");
                    if let Err(rename_err) = fs::rename(&path, &bak) {
                        tracing::warn!(error = %rename_err, "could not back up corrupt settings");
                    }
                    tracing::warn!("settings corrupt, backed up and resetting: {e}");
                    (Settings::default(), false)
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Settings::default(), false),
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "settings unreadable; using in-memory defaults without persisting"
                );
                (Settings::default(), true)
            }
        };
        Self {
            path,
            settings,
            persist_blocked,
        }
    }

    pub fn get(&self) -> &Settings {
        &self.settings
    }

    pub fn get_mut(&mut self) -> &mut Settings {
        &mut self.settings
    }

    pub fn save(&self) -> Result<(), AppError> {
        if self.persist_blocked {
            return Ok(());
        }
        atomic_write_json(&self.path, &self.settings)
    }

    /// Fire-and-forget persist so the player actor never blocks on disk I/O.
    /// Coalesces onto one writer thread so open/seek cannot spawn a thread storm.
    pub fn save_async(&self) {
        if self.persist_blocked {
            return;
        }
        let _ = persist_sender().send((self.path.clone(), self.settings.clone()));
    }

    /// Inline (synchronous) persist for the exit path, where the async writer
    /// thread may be torn down before it drains.
    pub fn save_sync(&self) -> Result<(), AppError> {
        if self.persist_blocked {
            return Ok(());
        }
        atomic_write_json(&self.path, &self.settings)
    }

    pub fn remember_opened(&mut self, path: &str) {
        let item = MediaItem {
            id: path.to_string(),
            path: path.to_string(),
            display_name: display_name_for(path),
            duration_secs: None,
            last_position_secs: None,
        };
        self.settings.recent.retain(|r| r.path != path);
        self.settings.recent.insert(0, item);
        self.settings.recent.truncate(MAX_RECENTS);
    }

    pub fn set_resume(&mut self, path: &str, position_secs: f64) {
        if position_secs < 3.0 {
            self.settings.resume_positions.retain(|e| e.path != path);
            return;
        }
        self.settings.resume_positions.retain(|e| e.path != path);
        self.settings.resume_positions.insert(
            0,
            ResumeEntry {
                path: path.to_string(),
                position_secs,
                updated_at: Utc::now().to_rfc3339(),
            },
        );
        self.settings.resume_positions.truncate(MAX_RESUME_ENTRIES);
    }

    pub fn resume_for(&self, path: &str) -> Option<f64> {
        if !self.settings.resume_enabled {
            return None;
        }
        self.settings
            .resume_positions
            .iter()
            .find(|e| e.path == path)
            .map(|e| e.position_secs)
    }

    pub fn replace(&mut self, next: Settings) {
        self.settings = next.normalized();
    }

    pub fn update(&mut self, next: Settings) -> Result<&Settings, AppError> {
        self.replace(next);
        self.save()?;
        Ok(&self.settings)
    }
}

fn persist_sender() -> Sender<(PathBuf, Settings)> {
    static PERSIST: OnceLock<Sender<(PathBuf, Settings)>> = OnceLock::new();
    PERSIST
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<(PathBuf, Settings)>();
            let _ = thread::Builder::new()
                .name("replay-settings".into())
                .spawn(move || {
                    while let Ok((path, settings)) = rx.recv() {
                        let mut last = (path, settings);
                        while let Ok(next) = rx.try_recv() {
                            last = next;
                        }
                        if let Err(err) = atomic_write_json(&last.0, &last.1) {
                            tracing::warn!(error = %err.message, "async settings save failed");
                        }
                    }
                });
            tx
        })
        .clone()
}

pub fn atomic_write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AppError::new(
                ErrorCode::SettingsCorrupt,
                format!("Failed to create settings directory: {e}"),
                true,
            )
        })?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(value).map_err(|e| {
        AppError::new(
            ErrorCode::SettingsCorrupt,
            format!("Failed to serialize settings: {e}"),
            true,
        )
    })?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| {
            AppError::new(
                ErrorCode::SettingsCorrupt,
                format!("Failed to write settings: {e}"),
                true,
            )
        })?;
        f.write_all(&data).map_err(|e| {
            AppError::new(
                ErrorCode::SettingsCorrupt,
                format!("Failed to write settings: {e}"),
                true,
            )
        })?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, path).map_err(|e| {
        AppError::new(
            ErrorCode::SettingsCorrupt,
            format!("Failed to finalize settings: {e}"),
            true,
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomic_roundtrip() {
        let dir = tempdir().unwrap();
        let mut store = SettingsStore::load(dir.path());
        store.remember_opened("/tmp/a.mp4");
        store.set_resume("/tmp/a.mp4", 42.0);
        store.save().unwrap();
        let loaded = SettingsStore::load(dir.path());
        assert_eq!(loaded.get().recent.len(), 1);
        assert_eq!(loaded.resume_for("/tmp/a.mp4"), Some(42.0));
    }
}
