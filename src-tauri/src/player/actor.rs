//! Single-owner player actor thread.
//!
//! Owns libmpv only. The platform video host HWND/view is created and resized on
//! the UI thread; this actor receives an embed `wid` and never touches Win32
//! window APIs (avoids HWND thread-affinity deadlocks).

use crate::error::{AppError, ErrorCode};
use crate::player::model::{
    MediaMetadata, PlayerCommand, PlayerEvent, PlayerPhase, PlayerSnapshot, Settings,
    SubtitleStyle, Track, TrackKind, POSITION_SAMPLE_HZ,
};
use crate::player::mpv::{Mpv, MpvClientEvent};
use crate::playlist::Playlist;
use crate::settings::SettingsStore;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct PlayerHandle {
    cmd_tx: Sender<PlayerCommand>,
    _join: JoinHandle<()>,
}

impl PlayerHandle {
    pub fn spawn(event_tx: Sender<PlayerEvent>, app_data: PathBuf, embed_wid: i64) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("replay-player".into())
            .spawn(move || {
                let mut actor = match PlayerActor::new(event_tx.clone(), app_data, embed_wid) {
                    Ok(a) => a,
                    Err(err) => {
                        let snap = PlayerSnapshot {
                            phase: PlayerPhase::Error,
                            error: Some(err.clone()),
                            ..PlayerSnapshot::default()
                        };
                        let _ = event_tx.send(PlayerEvent::Error {
                            error: err,
                            snapshot: snap,
                        });
                        // Keep thread alive to accept stop/get_snapshot until process exits.
                        drain_until_shutdown(cmd_rx, event_tx);
                        return;
                    }
                };
                actor.run(cmd_rx);
            })
            .expect("spawn player actor");
        Self {
            cmd_tx,
            _join: join,
        }
    }

    pub fn send(&self, cmd: PlayerCommand) {
        let _ = self.cmd_tx.send(cmd);
    }
}

fn engine_unavailable_snapshot() -> PlayerSnapshot {
    PlayerSnapshot {
        phase: PlayerPhase::Error,
        error: Some(AppError::new(
            ErrorCode::EngineMissing,
            "Playback engine unavailable.",
            false,
        )),
        ..PlayerSnapshot::default()
    }
}

fn drain_until_shutdown(rx: Receiver<PlayerCommand>, tx: Sender<PlayerEvent>) {
    // Engine failed to start — every command must still produce an error so Open
    // is not a silent no-op.
    while let Ok(_cmd) = rx.recv() {
        let snap = engine_unavailable_snapshot();
        let err = snap.error.clone().expect("engine error");
        let _ = tx.send(PlayerEvent::Error {
            error: err,
            snapshot: snap.clone(),
        });
        let _ = tx.send(PlayerEvent::Snapshot { snapshot: snap });
    }
}

struct PlayerActor {
    event_tx: Sender<PlayerEvent>,
    mpv: Mpv,
    playlist: Playlist,
    settings: SettingsStore,
    snapshot: PlayerSnapshot,
    last_position_emit: Instant,
    settings_dirty: bool,
    last_settings_save: Instant,
    hw_retried: bool,
}

impl PlayerActor {
    fn new(
        event_tx: Sender<PlayerEvent>,
        app_data: PathBuf,
        embed_wid: i64,
    ) -> Result<Self, AppError> {
        let settings = SettingsStore::load(&app_data);
        if embed_wid == 0 {
            tracing::warn!("embed wid is 0; video host may be unavailable");
        }
        // wid must be applied before initialize so the first VO targets our HWND.
        let mpv = Mpv::new_with_wid(embed_wid)?;
        mpv.observe_core_props()?;
        if !settings.get().hardware_decode {
            mpv.retry_software_decode()?;
        }
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
        // Optional prefs must not kill the whole actor if libmpv rejects them.
        // A hard fail here used to leave the player dead so Open did nothing while
        // the sticky banner still showed "libmpv command: invalid parameter".
        if let Err(e) = mpv.set_volume(snapshot.volume) {
            tracing::warn!(error = %e.message, "set_volume on init failed");
        }
        if let Err(e) = mpv.set_mute(snapshot.muted) {
            tracing::warn!(error = %e.message, "set_mute on init failed");
        }
        if let Err(e) = mpv.set_speed(snapshot.speed) {
            tracing::warn!(error = %e.message, "set_speed on init failed");
        }
        if let Err(e) = mpv.set_audio_fx(settings.get().fx_enabled, &settings.get().fx_preset) {
            tracing::warn!(error = %e.message, "set_audio_fx on init failed");
        }
        if let Err(e) = apply_sub_style(&mpv, &snapshot.subtitle_style) {
            tracing::warn!(error = %e.message, "apply_sub_style on init failed");
        }

        let _ = event_tx.send(PlayerEvent::Settings {
            settings: settings.get().clone(),
        });

        Ok(Self {
            event_tx,
            mpv,
            playlist,
            settings,
            snapshot,
            last_position_emit: Instant::now() - Duration::from_secs(1),
            settings_dirty: false,
            last_settings_save: Instant::now(),
            hw_retried: false,
        })
    }

    fn run(&mut self, cmd_rx: Receiver<PlayerCommand>) {
        loop {
            loop {
                match cmd_rx.try_recv() {
                    Ok(cmd) => self.handle_command(cmd),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        self.flush_settings();
                        return;
                    }
                }
            }

            // Block up to 50ms for an mpv event (replaces a 125 Hz sleep).
            match self.mpv.wait_event(0.05) {
                MpvClientEvent::None => {}
                MpvClientEvent::Shutdown => {
                    self.flush_settings();
                    return;
                }
                ev => self.handle_mpv_event(ev),
            }

            // Drain remaining events so FileLoaded / property storms don't backlog.
            for _ in 0..64 {
                match self.mpv.wait_event(0.0) {
                    MpvClientEvent::None => break,
                    MpvClientEvent::Shutdown => {
                        self.flush_settings();
                        return;
                    }
                    ev => self.handle_mpv_event(ev),
                }
            }

            self.sample_position_if_due();
            self.maybe_flush_settings();
        }
    }

    fn mark_settings_dirty(&mut self) {
        self.settings_dirty = true;
    }

    fn maybe_flush_settings(&mut self) {
        if self.settings_dirty && self.last_settings_save.elapsed() >= Duration::from_millis(400) {
            self.flush_settings();
        }
    }

    fn flush_settings(&mut self) {
        if !self.settings_dirty {
            return;
        }
        // Persist off the hot path so open/seek never wait on disk sync.
        self.settings.save_async();
        self.settings_dirty = false;
        self.last_settings_save = Instant::now();
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
        }
    }

    fn handle_command(&mut self, cmd: PlayerCommand) {
        let result = self.dispatch(cmd);
        if let Err(err) = result {
            crate::diagnostics::log_error("player command", &err);
            self.snapshot.error = Some(err.clone());
            // Fatal engine/host + failed open/load → Error phase (UI banner, host hide).
            // Transient seek/volume/etc. keep the current phase and only set error.
            if matches!(
                err.code,
                ErrorCode::EngineMissing
                    | ErrorCode::EngineInit
                    | ErrorCode::RenderHost
                    | ErrorCode::UnsupportedMedia
                    | ErrorCode::CodecFailure
                    | ErrorCode::FileNotFound
                    | ErrorCode::InvalidPath
                    | ErrorCode::UrlRejected
            ) {
                self.snapshot.phase = PlayerPhase::Error;
            }
            self.bump();
            let _ = self.event_tx.send(PlayerEvent::Error {
                error: err,
                snapshot: self.snapshot.clone(),
            });
        }
    }

    fn dispatch(&mut self, cmd: PlayerCommand) -> Result<(), AppError> {
        match cmd {
            PlayerCommand::GetSnapshot { .. } => {
                self.emit_snapshot();
            }
            PlayerCommand::OpenPaths { paths, replace, .. } => {
                self.open_paths(paths, replace)?;
            }
            PlayerCommand::Play { .. } => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.mpv.set_pause(false)?;
                self.set_phase(PlayerPhase::Playing);
            }
            PlayerCommand::Pause { .. } => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.mpv.set_pause(true)?;
                self.set_phase(PlayerPhase::Paused);
            }
            PlayerCommand::TogglePause { .. } => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                let paused = self.mpv.get_flag("pause").unwrap_or(true);
                self.mpv.set_pause(!paused)?;
                self.set_phase(if paused {
                    PlayerPhase::Playing
                } else {
                    PlayerPhase::Paused
                });
            }
            PlayerCommand::Seek {
                position_secs,
                absolute,
                ..
            } => {
                if self.playlist.current().is_none() {
                    return Ok(());
                }
                self.set_phase(PlayerPhase::Seeking);
                let target = if absolute {
                    position_secs.max(0.0)
                } else {
                    (self.snapshot.position_secs + position_secs).max(0.0)
                };
                self.mpv.seek_absolute(target)?;
            }
            PlayerCommand::SetVolume { volume, .. } => {
                let volume = volume.clamp(0.0, 150.0);
                self.mpv.set_volume(volume)?;
                self.snapshot.volume = volume;
                self.settings.get_mut().volume = volume;
                self.mark_settings_dirty();
                self.emit_snapshot();
            }
            PlayerCommand::SetMuted { muted, .. } => {
                self.mpv.set_mute(muted)?;
                self.snapshot.muted = muted;
                self.settings.get_mut().muted = muted;
                self.mark_settings_dirty();
                self.emit_snapshot();
            }
            PlayerCommand::SetSpeed { speed, .. } => {
                let speed = speed.clamp(0.25, 3.0);
                self.mpv.set_speed(speed)?;
                self.snapshot.speed = speed;
                self.settings.get_mut().speed = speed;
                self.mark_settings_dirty();
                self.emit_snapshot();
            }
            PlayerCommand::SetAudioFx {
                enabled, preset, ..
            } => {
                self.mpv.set_audio_fx(enabled, &preset)?;
                self.settings.get_mut().fx_enabled = enabled;
                self.settings.get_mut().fx_preset = preset;
                self.mark_settings_dirty();
            }
            PlayerCommand::SetFullscreen { fullscreen, .. } => {
                self.snapshot.fullscreen = fullscreen;
                self.emit_snapshot();
            }
            PlayerCommand::SetHostBounds { .. } => {
                // Host HWND is resized on the UI thread; ignore here.
            }
            PlayerCommand::Next { .. } => {
                self.persist_resume();
                if let Some(item) = self.playlist.advance_next().cloned() {
                    self.load_current(&item.path)?;
                }
            }
            PlayerCommand::Previous { .. } => {
                if self.snapshot.position_secs > 3.0 {
                    self.mpv.seek_absolute(0.0)?;
                } else {
                    self.persist_resume();
                    if let Some(item) = self.playlist.advance_previous().cloned() {
                        self.load_current(&item.path)?;
                    }
                }
            }
            PlayerCommand::SetRepeat { mode, .. } => {
                self.playlist.set_repeat(mode);
                self.settings.get_mut().repeat = mode;
                self.mark_settings_dirty();
                self.emit_snapshot();
            }
            PlayerCommand::SelectTrack { kind, track_id, .. } => match kind {
                TrackKind::Audio => {
                    self.mpv.set_aid(track_id)?;
                    for t in &mut self.snapshot.audio_tracks {
                        t.selected = Some(t.id) == track_id;
                    }
                    self.emit_snapshot();
                }
                TrackKind::Subtitle => {
                    self.mpv.set_sid(track_id)?;
                    for t in &mut self.snapshot.subtitle_tracks {
                        t.selected = Some(t.id) == track_id;
                    }
                    self.emit_snapshot();
                }
                TrackKind::Video => {}
            },
            PlayerCommand::AddSubtitle { path, .. } => {
                let path = crate::player::model::validate_local_path(&path)?;
                self.mpv.add_sub(&path)?;
                self.refresh_tracks();
                self.emit_snapshot();
            }
            PlayerCommand::SetSubtitleStyle { style, .. } => {
                apply_sub_style(&self.mpv, &style)?;
                self.snapshot.subtitle_style = style.clone();
                self.settings.get_mut().subtitle_style = style;
                self.mark_settings_dirty();
                self.emit_snapshot();
            }
            PlayerCommand::ClearPlaylist { .. } => {
                self.persist_resume();
                self.mpv.stop()?;
                self.playlist.clear();
                self.snapshot.current = None;
                self.snapshot.metadata = None;
                self.set_phase(PlayerPhase::Idle);
            }
            PlayerCommand::RemovePlaylistItem { index, .. } => {
                let removing_current = self.playlist.snapshot().current_index == Some(index);
                self.playlist.remove(index)?;
                if removing_current {
                    if let Some(item) = self.playlist.current().cloned() {
                        self.load_current(&item.path)?;
                    } else {
                        self.mpv.stop()?;
                        self.set_phase(PlayerPhase::Idle);
                    }
                } else {
                    self.emit_snapshot();
                }
            }
            PlayerCommand::PlayIndex { index, .. } => {
                self.persist_resume();
                let item = self.playlist.play_index(index)?.clone();
                self.load_current(&item.path)?;
            }
            PlayerCommand::ReorderPlaylist { from, to, .. } => {
                self.playlist.reorder(from, to)?;
                self.emit_snapshot();
            }
            PlayerCommand::ApplySettings { settings, .. } => {
                self.apply_settings(settings)?;
            }
        }
        Ok(())
    }

    fn emit_settings(&self) {
        let _ = self.event_tx.send(PlayerEvent::Settings {
            settings: self.settings.get().clone(),
        });
    }

    fn apply_settings(&mut self, incoming: Settings) -> Result<(), AppError> {
        let mut next = incoming.normalized();
        // Recents / resume positions are actor-owned; overlay prefs must not clobber them.
        next.recent = self.settings.get().recent.clone();
        next.resume_positions = self.settings.get().resume_positions.clone();

        if let Err(e) = self.mpv.set_volume(next.volume) {
            tracing::warn!(error = %e.message, "apply_settings volume failed");
        }
        if let Err(e) = self.mpv.set_mute(next.muted) {
            tracing::warn!(error = %e.message, "apply_settings mute failed");
        }
        if let Err(e) = self.mpv.set_speed(next.speed) {
            tracing::warn!(error = %e.message, "apply_settings speed failed");
        }
        if let Err(e) = self.mpv.set_audio_fx(next.fx_enabled, &next.fx_preset) {
            tracing::warn!(error = %e.message, "apply_settings fx failed");
        }
        if let Err(e) = apply_sub_style(&self.mpv, &next.subtitle_style) {
            tracing::warn!(error = %e.message, "apply_settings sub style failed");
        }
        if let Err(e) = self.mpv.set_hwdec(next.hardware_decode) {
            tracing::warn!(error = %e.message, "apply_settings hwdec failed");
        }

        self.playlist.set_repeat(next.repeat);
        self.snapshot.volume = next.volume;
        self.snapshot.muted = next.muted;
        self.snapshot.speed = next.speed;
        self.snapshot.subtitle_style = next.subtitle_style.clone();
        self.settings.replace(next);
        self.mark_settings_dirty();
        self.emit_settings();
        self.emit_snapshot();
        Ok(())
    }

    fn open_paths(&mut self, paths: Vec<String>, replace: bool) -> Result<(), AppError> {
        let had_current = self.playlist.current().is_some();
        let item = self.playlist.open_paths(&paths, replace)?.clone();
        for p in &paths {
            if let Ok(canon) = crate::player::model::validate_local_path(p) {
                self.settings.remember_opened(&canon);
            }
        }
        self.mark_settings_dirty();
        self.emit_settings();
        // Append while something is already current: grow queue only.
        if replace || !had_current {
            self.load_current(&item.path)
        } else {
            self.emit_snapshot();
            Ok(())
        }
    }

    fn load_current(&mut self, path: &str) -> Result<(), AppError> {
        self.snapshot.load_generation = self.snapshot.load_generation.saturating_add(1);
        self.snapshot.error = None;
        self.snapshot.eof_reached = false;
        self.snapshot.metadata = None;
        self.snapshot.audio_tracks.clear();
        self.snapshot.subtitle_tracks.clear();
        self.hw_retried = false;
        self.set_phase(PlayerPhase::Loading);
        tracing::info!(path = %crate::player::model::redact_path(path), "loadfile");
        self.mpv.loadfile(path)?;
        if let Some(pos) = self.settings.resume_for(path) {
            // Seek after file-loaded event; stash for then.
            self.snapshot.position_secs = pos;
        } else {
            self.snapshot.position_secs = 0.0;
        }
        self.emit_snapshot();
        Ok(())
    }

    fn handle_mpv_event(&mut self, ev: MpvClientEvent) {
        let gen = self.snapshot.load_generation;
        match ev {
            MpvClientEvent::FileLoaded => {
                if let Ok(dur) = self.mpv.get_double("duration") {
                    self.snapshot.duration_secs = dur;
                }
                self.refresh_tracks();
                self.refresh_metadata();
                let resume = self.snapshot.position_secs;
                if resume > 3.0 && resume < self.snapshot.duration_secs.saturating_sub_f64(2.0) {
                    let _ = self.mpv.seek_absolute(resume);
                }
                let _ = self.mpv.set_pause(false);
                self.set_phase(PlayerPhase::Playing);
                let _ = self.event_tx.send(PlayerEvent::Ready {
                    load_generation: gen,
                });
            }
            MpvClientEvent::EndFile { reason, error } => {
                // reason 0 = eof, 2 = error, 3 = redirect, etc.
                if error < 0 && !self.hw_retried {
                    self.hw_retried = true;
                    tracing::warn!("hwdec/end error; retrying software decode");
                    let _ = self.mpv.retry_software_decode();
                    if let Some(item) = self.playlist.current().cloned() {
                        let _ = self.load_current(&item.path);
                    }
                    return;
                }
                if reason == 0 {
                    self.snapshot.eof_reached = true;
                    self.persist_resume_clear();
                    if self.settings.get().autoplay_next {
                        if let Some(item) = self.playlist.advance_next().cloned() {
                            let _ = self.load_current(&item.path);
                            return;
                        }
                    }
                    self.set_phase(PlayerPhase::Ended);
                } else if error < 0 {
                    let err = AppError::new(
                        ErrorCode::UnsupportedMedia,
                        "Unable to play this file. The format or codec may be unsupported.",
                        true,
                    );
                    self.snapshot.error = Some(err.clone());
                    self.set_phase(PlayerPhase::Error);
                    let _ = self.event_tx.send(PlayerEvent::Error {
                        error: err,
                        snapshot: self.snapshot.clone(),
                    });
                }
            }
            MpvClientEvent::Seek => self.set_phase(PlayerPhase::Seeking),
            MpvClientEvent::PlaybackRestart => {
                // Never promote Idle → Playing/Paused without a loaded item
                // (mpv can fire restart/pause observes during engine init).
                if self.snapshot.current.is_some() {
                    let paused = self.mpv.get_flag("pause").unwrap_or(false);
                    self.set_phase(if paused {
                        PlayerPhase::Paused
                    } else {
                        PlayerPhase::Playing
                    });
                }
            }
            MpvClientEvent::PropertyChange { name } => {
                if name == "track-list" {
                    self.refresh_tracks();
                    self.emit_snapshot();
                } else if name == "pause" {
                    if let Ok(paused) = self.mpv.get_flag("pause") {
                        if self.snapshot.current.is_some()
                            && self.snapshot.phase != PlayerPhase::Seeking
                            && self.snapshot.phase != PlayerPhase::Loading
                        {
                            self.set_phase(if paused {
                                PlayerPhase::Paused
                            } else {
                                PlayerPhase::Playing
                            });
                        }
                    }
                } else if name == "eof-reached" {
                    if let Ok(eof) = self.mpv.get_flag("eof-reached") {
                        self.snapshot.eof_reached = eof;
                    }
                }
            }
            _ => {}
        }
    }

    fn sample_position_if_due(&mut self) {
        let min_interval = Duration::from_secs_f64(1.0 / POSITION_SAMPLE_HZ);
        if self.last_position_emit.elapsed() < min_interval {
            return;
        }
        if self.snapshot.current.is_none() {
            return;
        }
        if !matches!(
            self.snapshot.phase,
            PlayerPhase::Playing
                | PlayerPhase::Paused
                | PlayerPhase::Seeking
                | PlayerPhase::Buffering
        ) {
            return;
        }
        let pos = self
            .mpv
            .get_double("time-pos")
            .unwrap_or(self.snapshot.position_secs);
        let dur = self
            .mpv
            .get_double("duration")
            .unwrap_or(self.snapshot.duration_secs);
        self.snapshot.position_secs = pos;
        self.snapshot.duration_secs = dur;
        self.bump();
        let _ = self.event_tx.send(PlayerEvent::Position {
            load_generation: self.snapshot.load_generation,
            revision: self.snapshot.revision,
            position_secs: pos,
            duration_secs: dur,
        });
        self.last_position_emit = Instant::now();
    }

    fn refresh_tracks(&mut self) {
        let mut audio = Vec::new();
        let mut subs = Vec::new();
        let count = self.mpv.get_double("track-list/count").unwrap_or(0.0) as i64;
        // Cap property storm on pathological files.
        let count = count.clamp(0, 64);
        for i in 0..count {
            let prefix = format!("track-list/{i}");
            let typ = self
                .mpv
                .get_string(&format!("{prefix}/type"))
                .ok()
                .flatten()
                .unwrap_or_default();
            let id = self.mpv.get_double(&format!("{prefix}/id")).unwrap_or(0.0) as i64;
            let title = self
                .mpv
                .get_string(&format!("{prefix}/title"))
                .ok()
                .flatten();
            let language = self
                .mpv
                .get_string(&format!("{prefix}/lang"))
                .ok()
                .flatten();
            let codec = self
                .mpv
                .get_string(&format!("{prefix}/codec"))
                .ok()
                .flatten();
            let selected = self
                .mpv
                .get_flag(&format!("{prefix}/selected"))
                .unwrap_or(false);
            let external = self
                .mpv
                .get_flag(&format!("{prefix}/external"))
                .unwrap_or(false);
            let track = Track {
                id,
                kind: match typ.as_str() {
                    "audio" => TrackKind::Audio,
                    "sub" => TrackKind::Subtitle,
                    _ => TrackKind::Video,
                },
                title,
                language,
                codec,
                selected,
                external,
            };
            match track.kind {
                TrackKind::Audio => audio.push(track),
                TrackKind::Subtitle => subs.push(track),
                TrackKind::Video => {}
            }
        }
        self.snapshot.audio_tracks = audio;
        self.snapshot.subtitle_tracks = subs;
    }

    fn refresh_metadata(&mut self) {
        self.snapshot.metadata = Some(MediaMetadata {
            title: self.mpv.get_string("media-title").ok().flatten(),
            artist: self.mpv.get_string("metadata/by-key/artist").ok().flatten(),
            album: self.mpv.get_string("metadata/by-key/album").ok().flatten(),
            date: self.mpv.get_string("metadata/by-key/date").ok().flatten(),
            comment: self
                .mpv
                .get_string("metadata/by-key/comment")
                .ok()
                .flatten(),
            container: self.mpv.get_string("file-format").ok().flatten(),
            video_codec: self.mpv.get_string("video-codec").ok().flatten(),
            audio_codec: self.mpv.get_string("audio-codec").ok().flatten(),
            width: self.mpv.get_double("width").ok().map(|v| v as u32),
            height: self.mpv.get_double("height").ok().map(|v| v as u32),
            fps: self.mpv.get_double("container-fps").ok(),
            bitrate: self.mpv.get_double("video-bitrate").ok().map(|v| v as u64),
        });
    }

    fn persist_resume(&mut self) {
        if let Some(cur) = self.playlist.current().cloned() {
            self.settings
                .set_resume(&cur.path, self.snapshot.position_secs);
            self.mark_settings_dirty();
        }
    }

    fn persist_resume_clear(&mut self) {
        if let Some(cur) = self.playlist.current().cloned() {
            self.settings.set_resume(&cur.path, 0.0);
            self.mark_settings_dirty();
        }
    }
}

fn apply_sub_style(mpv: &Mpv, style: &SubtitleStyle) -> Result<(), AppError> {
    mpv.set_sub_delay(style.delay_secs)?;
    mpv.set_sub_scale(style.scale)?;
    mpv.set_sub_pos(style.position)?;
    Ok(())
}

trait SatSub {
    fn saturating_sub_f64(self, other: f64) -> f64;
}
impl SatSub for f64 {
    fn saturating_sub_f64(self, other: f64) -> f64 {
        (self - other).max(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn drain_emits_error_for_open_paths() {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let (ev_tx, ev_rx) = mpsc::channel();
        let worker = thread::spawn(move || drain_until_shutdown(cmd_rx, ev_tx));
        cmd_tx
            .send(PlayerCommand::OpenPaths {
                request_id: "1".into(),
                paths: vec!["a.mp4".into()],
                replace: true,
            })
            .unwrap();
        let ev = ev_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("drain must answer OpenPaths");
        match ev {
            PlayerEvent::Error { error, snapshot } => {
                assert_eq!(error.code, ErrorCode::EngineMissing);
                assert_eq!(snapshot.phase, PlayerPhase::Error);
            }
            other => panic!("expected Error, got {other:?}"),
        }
        drop(cmd_tx);
        let _ = worker.join();
    }
}
