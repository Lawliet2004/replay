use crate::error::{AppError, ErrorCode};
use crate::player::model::{
    display_name_for, MediaItem, ResumeEntry, Settings, MAX_RECENTS, MAX_RESUME_ENTRIES,
    SETTINGS_VERSION,
};
use chrono::Utc;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct SettingsStore {
    path: PathBuf,
    settings: Settings,
}

impl SettingsStore {
    pub fn load(app_data: &Path) -> Self {
        let path = app_data.join("settings.json");
        let settings = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
                Ok(mut s) => {
                    if s.version != SETTINGS_VERSION {
                        s.version = SETTINGS_VERSION;
                    }
                    s.recent.truncate(MAX_RECENTS);
                    s.resume_positions.truncate(MAX_RESUME_ENTRIES);
                    s
                }
                Err(e) => {
                    tracing::warn!("settings corrupt, resetting: {e}");
                    Settings::default()
                }
            },
            Err(_) => Settings::default(),
        };
        Self { path, settings }
    }

    pub fn get(&self) -> &Settings {
        &self.settings
    }

    pub fn get_mut(&mut self) -> &mut Settings {
        &mut self.settings
    }

    pub fn save(&self) -> Result<(), AppError> {
        atomic_write_json(&self.path, &self.settings)
    }

    /// Fire-and-forget persist so the player actor never blocks on disk I/O.
    pub fn save_async(&self) {
        let path = self.path.clone();
        let settings = self.settings.clone();
        std::thread::Builder::new()
            .name("replay-settings".into())
            .spawn(move || {
                if let Err(err) = atomic_write_json(&path, &settings) {
                    tracing::warn!(error = %err.message, "async settings save failed");
                }
            })
            .ok();
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

    pub fn update(&mut self, next: Settings) -> Result<&Settings, AppError> {
        let mut next = next;
        next.version = SETTINGS_VERSION;
        next.recent.truncate(MAX_RECENTS);
        next.resume_positions.truncate(MAX_RESUME_ENTRIES);
        next.volume = next.volume.clamp(0.0, 150.0);
        next.speed = next.speed.clamp(0.25, 3.0);
        // Allowed seek steps: 5 / 10 / 20 / 30 / 60 seconds.
        const ALLOWED: [f64; 5] = [5.0, 10.0, 20.0, 30.0, 60.0];
        if !ALLOWED
            .iter()
            .any(|v| (*v - next.seek_step_secs).abs() < f64::EPSILON)
        {
            next.seek_step_secs = 5.0;
        }
        self.settings = next;
        self.save()?;
        Ok(&self.settings)
    }
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
