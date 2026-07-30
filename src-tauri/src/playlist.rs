use crate::error::{AppError, ErrorCode};
use crate::player::model::{
    display_name_for, validate_local_path, MediaItem, PlaylistSnapshot, RepeatMode,
    MAX_PLAYLIST_ITEMS,
};
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct Playlist {
    items: Vec<MediaItem>,
    current_index: Option<usize>,
    repeat: RepeatMode,
}

impl Playlist {
    pub fn snapshot(&self) -> PlaylistSnapshot {
        PlaylistSnapshot {
            items: self.items.clone(),
            current_index: self.current_index,
            repeat: self.repeat,
        }
    }

    pub fn set_repeat(&mut self, mode: RepeatMode) {
        self.repeat = mode;
    }

    pub fn repeat(&self) -> RepeatMode {
        self.repeat
    }

    pub fn current(&self) -> Option<&MediaItem> {
        self.current_index.and_then(|i| self.items.get(i))
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.current_index = None;
    }

    pub fn open_paths(&mut self, paths: &[String], replace: bool) -> Result<&MediaItem, AppError> {
        let mut validated = Vec::new();
        for p in paths {
            let path = validate_local_path(p)?;
            validated.push(MediaItem {
                id: Uuid::new_v4().to_string(),
                display_name: display_name_for(&path),
                path,
                duration_secs: None,
                last_position_secs: None,
            });
        }
        if validated.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "No playable files were provided.",
                true,
            ));
        }
        if replace {
            self.items = validated;
            if self.items.len() > MAX_PLAYLIST_ITEMS {
                self.items.truncate(MAX_PLAYLIST_ITEMS);
            }
            self.current_index = Some(0);
        } else {
            if self.items.len() + validated.len() > MAX_PLAYLIST_ITEMS {
                return Err(AppError::new(
                    ErrorCode::PlaylistBounds,
                    format!("Playlist is limited to {MAX_PLAYLIST_ITEMS} items."),
                    true,
                ));
            }
            let start = self.items.len();
            self.items.extend(validated);
            if self.current_index.is_none() {
                self.current_index = Some(start);
            }
        }
        self.current()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "Playlist current missing.", false))
    }

    pub fn play_index(&mut self, index: usize) -> Result<&MediaItem, AppError> {
        if index >= self.items.len() {
            return Err(AppError::new(
                ErrorCode::PlaylistBounds,
                "Playlist index out of range.",
                true,
            ));
        }
        self.current_index = Some(index);
        Ok(&self.items[index])
    }

    pub fn remove(&mut self, index: usize) -> Result<(), AppError> {
        if index >= self.items.len() {
            return Err(AppError::new(
                ErrorCode::PlaylistBounds,
                "Playlist index out of range.",
                true,
            ));
        }
        self.items.remove(index);
        self.current_index = match self.current_index {
            None => None,
            Some(_cur) if self.items.is_empty() => None,
            Some(cur) if index == cur => {
                if cur < self.items.len() {
                    Some(cur)
                } else if cur > 0 {
                    Some(cur - 1)
                } else {
                    None
                }
            }
            Some(cur) if index < cur => Some(cur - 1),
            Some(cur) => Some(cur),
        };
        Ok(())
    }

    pub fn reorder(&mut self, from: usize, to: usize) -> Result<(), AppError> {
        if from >= self.items.len() || to >= self.items.len() {
            return Err(AppError::new(
                ErrorCode::PlaylistBounds,
                "Playlist reorder out of range.",
                true,
            ));
        }
        let item = self.items.remove(from);
        self.items.insert(to, item);
        if let Some(cur) = self.current_index {
            self.current_index = Some(reorder_index(cur, from, to));
        }
        Ok(())
    }

    pub fn next_index(&self) -> Option<usize> {
        let cur = self.current_index?;
        let len = self.items.len();
        if len == 0 {
            return None;
        }
        match self.repeat {
            RepeatMode::One => Some(cur),
            RepeatMode::All => Some((cur + 1) % len),
            RepeatMode::Off => {
                if cur + 1 < len {
                    Some(cur + 1)
                } else {
                    None
                }
            }
        }
    }

    pub fn previous_index(&self) -> Option<usize> {
        let cur = self.current_index?;
        let len = self.items.len();
        if len == 0 {
            return None;
        }
        match self.repeat {
            RepeatMode::One => Some(cur),
            RepeatMode::All => Some(if cur == 0 { len - 1 } else { cur - 1 }),
            RepeatMode::Off => {
                if cur > 0 {
                    Some(cur - 1)
                } else {
                    Some(0)
                }
            }
        }
    }

    pub fn advance_next(&mut self) -> Option<&MediaItem> {
        let next = self.next_index()?;
        self.current_index = Some(next);
        self.current()
    }

    pub fn advance_previous(&mut self) -> Option<&MediaItem> {
        let prev = self.previous_index()?;
        self.current_index = Some(prev);
        self.current()
    }
}

fn reorder_index(cur: usize, from: usize, to: usize) -> usize {
    if cur == from {
        to
    } else if from < cur && to >= cur {
        cur - 1
    } else if from > cur && to <= cur {
        cur + 1
    } else {
        cur
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn open_and_next() {
        let a = NamedTempFile::new().unwrap();
        let b = NamedTempFile::new().unwrap();
        let mut pl = Playlist::default();
        pl.open_paths(
            &[
                a.path().to_string_lossy().into_owned(),
                b.path().to_string_lossy().into_owned(),
            ],
            true,
        )
        .unwrap();
        assert_eq!(pl.current_index, Some(0));
        pl.advance_next();
        assert_eq!(pl.current_index, Some(1));
    }

    #[test]
    fn rejects_url() {
        let mut pl = Playlist::default();
        let err = pl
            .open_paths(&["https://example.com/a.mp4".into()], true)
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::UrlRejected);
    }
}
