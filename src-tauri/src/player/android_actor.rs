//! Android player actor.
//!
//! Playlist/settings live in Rust. Every playback command is mapped then
//! forwarded to an [`AndroidPlaybackEngine`] (Media3 on device, a recording
//! double in tests). The overlay snapshot is updated only after the engine
//! accepts the call.

use crate::error::{AppError, ErrorCode};
use crate::player::android_engine::{
    map_command, AndroidEngineCall, AndroidMapError, AndroidPlaybackEngine,
};
use crate::player::model::{
    PlayerCommand, PlayerEvent, PlayerPhase, PlayerSnapshot, Settings, TrackKind,
};
use crate::playlist::Playlist;
use crate::settings::SettingsStore;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

pub struct PlayerHandle {
    cmd_tx: Sender<PlayerCommand>,
    _join: JoinHandle<()>,
}

impl PlayerHandle {
    pub fn spawn(
        event_tx: Sender<PlayerEvent>,
        app_data: PathBuf,
        embed_wid: i64,
        engine: Box<dyn AndroidPlaybackEngine>,
    ) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("replay-android-player".into())
            .spawn(move || {
                let mut actor =
                    AndroidPlayerActor::new_with_engine(event_tx, app_data, embed_wid, engine);
                actor.run(cmd_rx);
            })
            .expect("spawn android player actor");
        Self {
            cmd_tx,
            _join: join,
        }
    }

    pub fn send(&self, cmd: PlayerCommand) {
        let _ = self.cmd_tx.send(cmd);
    }

    /// Settings persist on the actor thread; a best-effort nudge is all the
    /// close path needs on Android (no desktop-style inline flush).
    pub fn flush_now(&self) {
        // ponytail: no-op — the android actor flushes on each settings write.
    }

    pub fn flush_blocking(&self, _timeout: std::time::Duration) {
        // ponytail: no-op — same as flush_now; app exit does not wait.
    }
}

pub(crate) struct AndroidPlayerActor {
    event_tx: Sender<PlayerEvent>,
    playlist: Playlist,
    settings: SettingsStore,
    snapshot: PlayerSnapshot,
    engine: Box<dyn AndroidPlaybackEngine>,
    last_resume_save: std::time::Instant,
}

impl AndroidPlayerActor {
    pub(crate) fn new_with_engine(
        event_tx: Sender<PlayerEvent>,
        app_data: PathBuf,
        _embed_wid: i64,
        engine: Box<dyn AndroidPlaybackEngine>,
    ) -> Self {
        let settings = SettingsStore::load(&app_data);
        let mut playlist = Playlist::default();
        playlist.set_repeat(settings.get().repeat);
        let snapshot = PlayerSnapshot {
            volume: settings.get().volume,
            muted: settings.get().muted,
            speed: settings.get().speed,
            subtitle_style: settings.get().subtitle_style.clone(),
            playlist: playlist.snapshot(),
            ..PlayerSnapshot::default()
        };
        let _ = event_tx.send(PlayerEvent::Settings {
            settings: settings.get().clone(),
        });
        Self {
            event_tx,
            playlist,
            settings,
            snapshot,
            engine,
            last_resume_save: std::time::Instant::now(),
        }
    }

    fn run(&mut self, cmd_rx: Receiver<PlayerCommand>) {
        let interval = std::time::Duration::from_millis(250);
        let mut next_sample = std::time::Instant::now() + interval;
        loop {
            match cmd_rx
                .recv_timeout(next_sample.saturating_duration_since(std::time::Instant::now()))
            {
                Ok(cmd) => self.handle_command(cmd),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if std::time::Instant::now() >= next_sample {
                self.poll_engine();
                next_sample = std::time::Instant::now() + interval;
            }
        }
        let _ = self.settings.save();
    }

    fn poll_engine(&mut self) {
        if self.playlist.current().is_none() || self.snapshot.phase == PlayerPhase::Error {
            return;
        }
        match self.engine.playback_state() {
            Ok(Some(state)) => {
                if let Some(message) = state.error {
                    self.fail(AppError::new(ErrorCode::EngineInit, message, true));
                    return;
                }
                self.snapshot.position_secs = state.position_secs.max(0.0);
                self.snapshot.duration_secs = state.duration_secs.max(0.0);
                self.snapshot.metadata = state.metadata;
                self.snapshot.audio_tracks = state.audio_tracks;
                self.snapshot.subtitle_tracks = state.subtitle_tracks;
                let newly_ended = state.phase == PlayerPhase::Ended && !self.snapshot.eof_reached;
                self.snapshot.eof_reached = state.phase == PlayerPhase::Ended;
                if self.settings.get().resume_enabled {
                    if let Some(item) = self.playlist.current() {
                        self.settings.set_resume(
                            &item.path,
                            if self.snapshot.eof_reached {
                                0.0
                            } else {
                                self.snapshot.position_secs
                            },
                        );
                        if self.last_resume_save.elapsed() >= std::time::Duration::from_secs(5)
                            || state.phase != self.snapshot.phase
                        {
                            self.settings.save_async();
                            self.last_resume_save = std::time::Instant::now();
                        }
                    }
                }
                self.set_phase(state.phase);
                if newly_ended
                    && (self.settings.get().autoplay_next
                        || self.snapshot.playlist.repeat != crate::player::model::RepeatMode::Off)
                {
                    if let Err(err) = self.dispatch_playlist(PlayerCommand::Next {
                        request_id: "eof".into(),
                    }) {
                        self.fail(err);
                    }
                }
            }
            Ok(None) => {}
            Err(err) => self.fail(err),
        }
    }

    fn bump(&mut self) {
        self.snapshot.revision = self.snapshot.revision.saturating_add(1);
        self.snapshot.playlist = self.playlist.snapshot();
        self.snapshot.current = self.playlist.current().cloned();
    }

    fn emit_snapshot(&mut self) {
        self.bump();
        let _ = self.event_tx.send(PlayerEvent::Snapshot {
            snapshot: self.snapshot.clone(),
        });
    }

    fn emit_settings(&self) {
        let _ = self.event_tx.send(PlayerEvent::Settings {
            settings: self.settings.get().clone(),
        });
    }

    fn set_phase(&mut self, phase: PlayerPhase) {
        if self.snapshot.phase != phase {
            self.snapshot.phase = phase;
            self.bump();
            let _ = self.event_tx.send(PlayerEvent::PhaseChanged {
                load_generation: self.snapshot.load_generation,
                revision: self.snapshot.revision,
                phase,
            });
            let _ = self.event_tx.send(PlayerEvent::Snapshot {
                snapshot: self.snapshot.clone(),
            });
        } else {
            self.emit_snapshot();
        }
    }

    fn fail(&mut self, err: AppError) {
        crate::diagnostics::log_error("android player command", &err);
        self.snapshot.error = Some(err.clone());
        self.snapshot.phase = PlayerPhase::Error;
        self.bump();
        let _ = self.event_tx.send(PlayerEvent::Error {
            error: err,
            snapshot: self.snapshot.clone(),
        });
    }

    pub(crate) fn handle_command(&mut self, cmd: PlayerCommand) {
        let mapped = match map_command(&cmd) {
            Ok(call) => call,
            Err(AndroidMapError::UrlRejected) => {
                self.fail(AppError::new(
                    ErrorCode::UrlRejected,
                    "Network and stream URLs are not supported in v0.1. Open a local file instead.",
                    true,
                ));
                return;
            }
            Err(AndroidMapError::InvalidPath) => {
                self.fail(AppError::new(
                    ErrorCode::InvalidPath,
                    "Path is empty.",
                    true,
                ));
                return;
            }
        };
        if let Err(err) = self.dispatch(cmd, mapped) {
            self.fail(err);
        }
    }

    fn dispatch(&mut self, cmd: PlayerCommand, call: AndroidEngineCall) -> Result<(), AppError> {
        match call {
            AndroidEngineCall::Load { uri } => {
                if let PlayerCommand::OpenPaths { paths, replace, .. } = cmd {
                    let item = self.playlist.open_paths(&paths, replace)?.clone();
                    for p in &paths {
                        if let Ok(canon) = crate::player::model::validate_local_path(p) {
                            self.settings.remember_opened(&canon);
                        }
                    }
                    self.settings.save_async();
                    self.emit_settings();
                    self.engine.apply(&AndroidEngineCall::Load {
                        uri: item.path.clone(),
                    })?;
                    self.after_engine_load(&item.path);
                } else {
                    self.engine
                        .apply(&AndroidEngineCall::Load { uri: uri.clone() })?;
                    self.after_engine_load(&uri);
                }
            }
            AndroidEngineCall::Play => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.engine.apply(&AndroidEngineCall::Play)?;
                self.set_phase(PlayerPhase::Playing);
            }
            AndroidEngineCall::Pause => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.engine.apply(&AndroidEngineCall::Pause)?;
                self.set_phase(PlayerPhase::Paused);
            }
            AndroidEngineCall::TogglePause => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.engine.apply(&AndroidEngineCall::TogglePause)?;
                let playing = self.snapshot.phase == PlayerPhase::Playing;
                self.set_phase(if playing {
                    PlayerPhase::Paused
                } else {
                    PlayerPhase::Playing
                });
            }
            AndroidEngineCall::Seek {
                position_ms,
                absolute,
            } => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.engine.apply(&AndroidEngineCall::Seek {
                    position_ms,
                    absolute,
                })?;
                let delta = position_ms as f64 / 1000.0;
                self.snapshot.position_secs = if absolute {
                    delta.max(0.0)
                } else {
                    (self.snapshot.position_secs + delta).max(0.0)
                };
                self.set_phase(PlayerPhase::Seeking);
            }
            AndroidEngineCall::SetVolume { volume } => {
                self.engine
                    .apply(&AndroidEngineCall::SetVolume { volume })?;
                let volume = volume.clamp(0.0, 150.0);
                self.snapshot.volume = volume;
                self.settings.get_mut().volume = volume;
                self.settings.save_async();
                self.emit_snapshot();
            }
            AndroidEngineCall::SetMuted { muted } => {
                self.engine.apply(&AndroidEngineCall::SetMuted { muted })?;
                self.snapshot.muted = muted;
                self.settings.get_mut().muted = muted;
                self.settings.save_async();
                self.emit_snapshot();
            }
            AndroidEngineCall::SetSpeed { speed } => {
                self.engine.apply(&AndroidEngineCall::SetSpeed { speed })?;
                let speed = speed.clamp(0.25, 3.0);
                self.snapshot.speed = speed;
                self.settings.get_mut().speed = speed;
                self.settings.save_async();
                self.emit_snapshot();
            }
            AndroidEngineCall::SelectTrack { kind, track_id } => {
                self.engine
                    .apply(&AndroidEngineCall::SelectTrack { kind, track_id })?;
                match kind {
                    TrackKind::Audio => {
                        for t in &mut self.snapshot.audio_tracks {
                            t.selected = Some(t.id) == track_id;
                        }
                    }
                    TrackKind::Subtitle => {
                        for t in &mut self.snapshot.subtitle_tracks {
                            t.selected = Some(t.id) == track_id;
                        }
                    }
                    TrackKind::Video => {}
                }
                self.emit_snapshot();
            }
            AndroidEngineCall::AddSubtitle { uri } => {
                self.engine.apply(&AndroidEngineCall::AddSubtitle { uri })?;
                self.emit_snapshot();
            }
            AndroidEngineCall::RemoveSubtitle { track_id } => {
                self.engine
                    .apply(&AndroidEngineCall::RemoveSubtitle { track_id })?;
                self.emit_snapshot();
            }
            AndroidEngineCall::Playlist => self.dispatch_playlist(cmd)?,
            AndroidEngineCall::NoOp { .. } => self.dispatch_noop(cmd)?,
        }
        Ok(())
    }

    fn dispatch_playlist(&mut self, cmd: PlayerCommand) -> Result<(), AppError> {
        match cmd {
            PlayerCommand::Next { .. } => {
                if let Some(item) = self.playlist.advance_next().cloned() {
                    self.engine.apply(&AndroidEngineCall::Load {
                        uri: item.path.clone(),
                    })?;
                    self.after_engine_load(&item.path);
                } else {
                    self.emit_snapshot();
                }
            }
            PlayerCommand::Previous { .. } => {
                if self.snapshot.position_secs > 3.0 {
                    self.snapshot.position_secs = 0.0;
                    self.engine.apply(&AndroidEngineCall::Seek {
                        position_ms: 0,
                        absolute: true,
                    })?;
                    self.emit_snapshot();
                } else if let Some(item) = self.playlist.advance_previous().cloned() {
                    self.engine.apply(&AndroidEngineCall::Load {
                        uri: item.path.clone(),
                    })?;
                    self.after_engine_load(&item.path);
                } else {
                    self.emit_snapshot();
                }
            }
            PlayerCommand::SetRepeat { mode, .. } => {
                self.playlist.set_repeat(mode);
                self.settings.get_mut().repeat = mode;
                self.settings.save_async();
                self.emit_snapshot();
            }
            PlayerCommand::ClearPlaylist { .. } => {
                self.engine.apply(&AndroidEngineCall::Pause)?;
                self.playlist.clear();
                self.snapshot.position_secs = 0.0;
                self.snapshot.duration_secs = 0.0;
                self.snapshot.current = None;
                self.snapshot.metadata = None;
                self.set_phase(PlayerPhase::Idle);
            }
            PlayerCommand::RemovePlaylistItem { index, .. } => {
                let removing_current = self.playlist.snapshot().current_index == Some(index);
                self.playlist.remove(index)?;
                if removing_current {
                    if let Some(item) = self.playlist.current().cloned() {
                        self.engine.apply(&AndroidEngineCall::Load {
                            uri: item.path.clone(),
                        })?;
                        self.after_engine_load(&item.path);
                    } else {
                        self.engine.apply(&AndroidEngineCall::Pause)?;
                        self.snapshot.position_secs = 0.0;
                        self.snapshot.duration_secs = 0.0;
                        self.set_phase(PlayerPhase::Idle);
                    }
                } else {
                    self.emit_snapshot();
                }
            }
            PlayerCommand::PlayIndex { index, .. } => {
                let item = self.playlist.play_index(index)?.clone();
                self.engine.apply(&AndroidEngineCall::Load {
                    uri: item.path.clone(),
                })?;
                self.after_engine_load(&item.path);
            }
            PlayerCommand::ReorderPlaylist { from, to, .. } => {
                self.playlist.reorder(from, to)?;
                self.emit_snapshot();
            }
            PlayerCommand::FlushNow { .. } => {
                let _ = self.settings.save();
                self.emit_snapshot();
            }
            PlayerCommand::RemoveSubtitle { .. } => {
                // Native Media3 doesn't yet support per-track removal; nothing
                // to do here. The frontend will simply not show the row.
            }
            _ => self.emit_snapshot(),
        }
        Ok(())
    }

    fn dispatch_noop(&mut self, cmd: PlayerCommand) -> Result<(), AppError> {
        match cmd {
            PlayerCommand::ApplySettings { settings, .. } => self.apply_settings(settings),
            PlayerCommand::GetSnapshot { .. } => {
                self.emit_snapshot();
                Ok(())
            }
            PlayerCommand::FlushNow { .. } => {
                let _ = self.settings.save();
                Ok(())
            }
            PlayerCommand::SetFullscreen { fullscreen, .. } => {
                self.snapshot.fullscreen = fullscreen;
                self.emit_snapshot();
                Ok(())
            }
            PlayerCommand::SetAudioFx {
                enabled, preset, ..
            } => {
                self.settings.get_mut().fx_enabled = enabled;
                self.settings.get_mut().fx_preset = preset;
                self.settings.save_async();
                Ok(())
            }
            PlayerCommand::SetSubtitleStyle { style, .. } => {
                self.snapshot.subtitle_style = style.clone();
                self.settings.get_mut().subtitle_style = style;
                self.settings.save_async();
                self.emit_snapshot();
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn apply_settings(&mut self, incoming: Settings) -> Result<(), AppError> {
        let mut next = incoming.normalized();
        // Server-owned fields: merge from the live persisted state so a stale
        // overlay snapshot cannot clobber them.
        next.recent = self.settings.get().recent.clone();
        next.resume_positions = self.settings.get().resume_positions.clone();
        next.volume = self.settings.get().volume;
        next.muted = self.settings.get().muted;
        next.speed = self.settings.get().speed;
        next.repeat = self.settings.get().repeat;
        self.playlist.set_repeat(next.repeat);
        self.snapshot.volume = next.volume;
        self.snapshot.muted = next.muted;
        self.snapshot.speed = next.speed;
        self.snapshot.subtitle_style = next.subtitle_style.clone();
        self.settings.replace(next);
        self.settings.save_async();
        self.emit_settings();
        self.emit_snapshot();
        Ok(())
    }

    /// Snapshot + Ready only after [`AndroidPlaybackEngine::apply`] succeeded.
    fn after_engine_load(&mut self, uri: &str) {
        self.snapshot.load_generation = self.snapshot.load_generation.saturating_add(1);
        self.snapshot.error = None;
        self.snapshot.eof_reached = false;
        self.snapshot.metadata = None;
        self.snapshot.audio_tracks.clear();
        self.snapshot.subtitle_tracks.clear();
        self.snapshot.position_secs = 0.0;
        self.snapshot.duration_secs = 0.0;
        // Apply persisted playback preferences to the actual engine too.
        let calls = [
            AndroidEngineCall::SetVolume {
                volume: self.snapshot.volume,
            },
            AndroidEngineCall::SetMuted {
                muted: self.snapshot.muted,
            },
            AndroidEngineCall::SetSpeed {
                speed: self.snapshot.speed,
            },
        ];
        for call in calls {
            if let Err(err) = self.engine.apply(&call) {
                self.fail(err);
                return;
            }
        }
        if let Some(position) = self.settings.resume_for(uri) {
            if let Err(err) = self.engine.apply(&AndroidEngineCall::Seek {
                position_ms: (position * 1000.0) as i64,
                absolute: true,
            }) {
                self.fail(err);
                return;
            }
        }
        tracing::info!(
            path = %crate::player::model::redact_path(uri),
            "android load"
        );
        self.set_phase(PlayerPhase::Playing);
        let _ = self.event_tx.send(PlayerEvent::Ready {
            load_generation: self.snapshot.load_generation,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::android_engine::RecordingEngine;

    fn actor(engine: RecordingEngine) -> (AndroidPlayerActor, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel();
        let actor =
            AndroidPlayerActor::new_with_engine(tx, dir.path().to_path_buf(), 0, Box::new(engine));
        (actor, dir)
    }

    #[test]
    fn open_paths_play_pause_seek_hit_engine() {
        let engine = RecordingEngine::default();
        let calls = engine.calls.clone();
        let (mut actor, _dir) = actor(engine);
        let uri = "content://media/external/video/media/1";

        actor.handle_command(PlayerCommand::OpenPaths {
            request_id: "1".into(),
            paths: vec![uri.into()],
            replace: true,
        });
        actor.handle_command(PlayerCommand::Pause {
            request_id: "2".into(),
        });
        actor.handle_command(PlayerCommand::Play {
            request_id: "3".into(),
        });
        actor.handle_command(PlayerCommand::Seek {
            request_id: "4".into(),
            position_secs: 2.5,
            absolute: true,
        });

        let got = calls.lock().clone();
        assert_eq!(
            got,
            vec![
                AndroidEngineCall::Load { uri: uri.into() },
                AndroidEngineCall::SetVolume { volume: 100.0 },
                AndroidEngineCall::SetMuted { muted: false },
                AndroidEngineCall::SetSpeed { speed: 1.0 },
                AndroidEngineCall::Pause,
                AndroidEngineCall::Play,
                AndroidEngineCall::Seek {
                    position_ms: 2500,
                    absolute: true
                },
            ]
        );
        assert_eq!(actor.snapshot.phase, PlayerPhase::Seeking);
    }

    #[test]
    fn native_progress_updates_duration_and_recovers_from_seeking() {
        struct ProgressEngine;
        impl AndroidPlaybackEngine for ProgressEngine {
            fn apply(&mut self, _: &AndroidEngineCall) -> Result<(), AppError> {
                Ok(())
            }
            fn playback_state(
                &mut self,
            ) -> Result<Option<crate::player::android_engine::AndroidPlaybackState>, AppError>
            {
                Ok(Some(
                    serde_json::from_value(serde_json::json!({
                        "positionSecs": 150.0, "durationSecs": 300.0, "phase": "playing",
                        "audioTracks": [], "subtitleTracks": [], "error": null
                    }))
                    .unwrap(),
                ))
            }
        }
        let (mut actor, _dir) = actor(RecordingEngine::default());
        actor.engine = Box::new(ProgressEngine);
        actor.handle_command(PlayerCommand::OpenPaths {
            request_id: "1".into(),
            paths: vec!["content://media/1".into()],
            replace: true,
        });
        actor.snapshot.phase = PlayerPhase::Seeking;
        actor.poll_engine();
        assert_eq!(actor.snapshot.duration_secs, 300.0);
        assert_eq!(actor.snapshot.position_secs, 150.0);
        assert_eq!(actor.snapshot.phase, PlayerPhase::Playing);
    }

    #[test]
    fn eof_respects_autoplay_and_only_advances_once() {
        for autoplay in [false, true] {
            let engine = RecordingEngine::default();
            let state = engine.state.clone();
            let calls = engine.calls.clone();
            let (mut actor, _dir) = actor(engine);
            actor.settings.get_mut().autoplay_next = autoplay;
            actor.handle_command(PlayerCommand::OpenPaths {
                request_id: "1".into(),
                paths: vec!["content://media/1".into(), "content://media/2".into()],
                replace: true,
            });
            *state.lock() = Some(
                serde_json::from_value(serde_json::json!({
                    "positionSecs": 300, "durationSecs": 300, "phase": "ended",
                    "audioTracks": [], "subtitleTracks": [], "error": null
                }))
                .unwrap(),
            );
            calls.lock().clear();
            actor.poll_engine();
            assert_eq!(
                actor.playlist.snapshot().current_index,
                Some(if autoplay { 1 } else { 0 })
            );
            if autoplay {
                assert!(calls.lock().contains(&AndroidEngineCall::Load {
                    uri: "content://media/2".into()
                }));
            } else {
                actor.poll_engine();
                assert!(calls.lock().is_empty());
                assert_eq!(actor.snapshot.phase, PlayerPhase::Ended);
            }
        }
    }

    #[test]
    fn clearing_queue_pauses_native_playback_and_resets_time() {
        let engine = RecordingEngine::default();
        let calls = engine.calls.clone();
        let (mut actor, _dir) = actor(engine);
        actor.handle_command(PlayerCommand::OpenPaths {
            request_id: "1".into(),
            paths: vec!["content://media/1".into()],
            replace: true,
        });
        calls.lock().clear();
        actor.handle_command(PlayerCommand::ClearPlaylist {
            request_id: "2".into(),
        });
        assert_eq!(*calls.lock(), vec![AndroidEngineCall::Pause]);
        assert_eq!(actor.snapshot.position_secs, 0.0);
        assert_eq!(actor.snapshot.duration_secs, 0.0);
        assert_eq!(actor.snapshot.phase, PlayerPhase::Idle);
    }

    #[test]
    fn resume_seeks_native_player_when_enabled() {
        let engine = RecordingEngine::default();
        let calls = engine.calls.clone();
        let (mut actor, _dir) = actor(engine);
        actor.settings.get_mut().resume_enabled = true;
        actor.settings.set_resume("content://media/1", 80.0);
        actor.handle_command(PlayerCommand::OpenPaths {
            request_id: "1".into(),
            paths: vec!["content://media/1".into()],
            replace: true,
        });
        assert!(calls.lock().contains(&AndroidEngineCall::Seek {
            position_ms: 80000,
            absolute: true
        }));
    }

    #[test]
    fn https_open_does_not_touch_engine() {
        let engine = RecordingEngine::default();
        let calls = engine.calls.clone();
        let (mut actor, _dir) = actor(engine);
        actor.handle_command(PlayerCommand::OpenPaths {
            request_id: "1".into(),
            paths: vec!["https://example.com/a.mp4".into()],
            replace: true,
        });
        assert!(calls.lock().is_empty());
        assert_eq!(actor.snapshot.phase, PlayerPhase::Error);
    }

    #[test]
    fn play_without_media_does_not_touch_engine() {
        let engine = RecordingEngine::default();
        let calls = engine.calls.clone();
        let (mut actor, _dir) = actor(engine);
        actor.handle_command(PlayerCommand::Play {
            request_id: "1".into(),
        });
        assert!(calls.lock().is_empty());
    }
}
