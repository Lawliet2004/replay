/** Auto-generated player contracts (ts-rs). Keep in sync with Rust via `cargo test export_types`. */

export type ErrorCode =
  | "invalid_path"
  | "url_rejected"
  | "file_not_found"
  | "unsupported_media"
  | "codec_failure"
  | "engine_missing"
  | "engine_init"
  | "hardware_decode"
  | "audio_device"
  | "render_host"
  | "playlist_bounds"
  | "settings_corrupt"
  | "command_rejected"
  | "internal"
  | "panic_recovered";

export interface AppError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  correlationId: string;
}

export type PlayerPhase =
  "idle" | "loading" | "ready" | "playing" | "paused" | "seeking" | "buffering" | "ended" | "error";

export type RepeatMode = "off" | "one" | "all";
export type TrackKind = "audio" | "subtitle" | "video";

export interface MediaItem {
  id: string;
  path: string;
  displayName: string;
  durationSecs: number | null;
  lastPositionSecs: number | null;
}

export interface Track {
  id: number;
  kind: TrackKind;
  title: string | null;
  language: string | null;
  codec: string | null;
  selected: boolean;
  external: boolean;
}

export interface MediaMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  date: string | null;
  comment: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
}

export interface PlaylistSnapshot {
  items: MediaItem[];
  currentIndex: number | null;
  repeat: RepeatMode;
}

export interface SubtitleStyle {
  delaySecs: number;
  scale: number;
  position: number;
}

export interface PlayerSnapshot {
  revision: number;
  loadGeneration: number;
  phase: PlayerPhase;
  positionSecs: number;
  durationSecs: number;
  volume: number;
  muted: boolean;
  speed: number;
  fullscreen: boolean;
  current: MediaItem | null;
  playlist: PlaylistSnapshot;
  audioTracks: Track[];
  subtitleTracks: Track[];
  metadata: MediaMetadata | null;
  subtitleStyle: SubtitleStyle;
  error: AppError | null;
  eofReached: boolean;
}

export type PlayerCommand =
  | { type: "open_paths"; request_id: string; paths: string[]; replace: boolean }
  | { type: "play"; request_id: string }
  | { type: "pause"; request_id: string }
  | { type: "toggle_pause"; request_id: string }
  | { type: "seek"; request_id: string; position_secs: number; absolute: boolean }
  | { type: "set_volume"; request_id: string; volume: number }
  | { type: "set_muted"; request_id: string; muted: boolean }
  | { type: "set_speed"; request_id: string; speed: number }
  | { type: "set_audio_fx"; request_id: string; enabled: boolean; preset: string }
  | { type: "set_fullscreen"; request_id: string; fullscreen: boolean }
  | {
      type: "set_host_bounds";
      request_id: string;
      width: number;
      height: number;
      chrome_bottom?: number;
      chrome_top?: number;
      chrome_right?: number;
      menu_x?: number;
      menu_y?: number;
      menu_w?: number;
      menu_h?: number;
    }
  | { type: "next"; request_id: string }
  | { type: "previous"; request_id: string }
  | { type: "set_repeat"; request_id: string; mode: RepeatMode }
  | { type: "select_track"; request_id: string; kind: TrackKind; track_id: number | null }
  | { type: "add_subtitle"; request_id: string; path: string }
  | { type: "remove_subtitle"; request_id: string; track_id: number }
  | { type: "set_subtitle_style"; request_id: string; style: SubtitleStyle }
  | { type: "clear_playlist"; request_id: string }
  | { type: "remove_playlist_item"; request_id: string; index: number }
  | { type: "play_index"; request_id: string; index: number }
  | { type: "reorder_playlist"; request_id: string; from: number; to: number }
  | { type: "apply_settings"; request_id: string; settings: Settings }
  | { type: "get_snapshot"; request_id: string }
  | { type: "flush_now"; request_id: string };

export type PlayerEvent =
  | { type: "snapshot"; snapshot: PlayerSnapshot }
  | {
      type: "position";
      load_generation: number;
      revision: number;
      position_secs: number;
      duration_secs: number;
    }
  | {
      type: "phase_changed";
      load_generation: number;
      revision: number;
      phase: PlayerPhase;
    }
  | { type: "error"; error: AppError; snapshot: PlayerSnapshot }
  | { type: "ready"; load_generation: number }
  | { type: "settings"; settings: Settings };

export interface ResumeEntry {
  path: string;
  positionSecs: number;
  updatedAt: string;
}

export interface Settings {
  version: number;
  volume: number;
  muted: boolean;
  speed: number;
  fxEnabled: boolean;
  fxPreset: string;
  repeat: RepeatMode;
  resumeEnabled: boolean;
  autoplayNext: boolean;
  hardwareDecode: boolean;
  subtitleStyle: SubtitleStyle;
  rememberWindow: boolean;
  windowWidth: number;
  windowHeight: number;
  seekStepSecs: number;
  recent: MediaItem[];
  resumePositions: ResumeEntry[];
}

export const defaultSnapshot = (): PlayerSnapshot => ({
  revision: 0,
  loadGeneration: 0,
  phase: "idle",
  positionSecs: 0,
  durationSecs: 0,
  volume: 100,
  muted: false,
  speed: 1,
  fullscreen: false,
  current: null,
  playlist: { items: [], currentIndex: null, repeat: "off" },
  audioTracks: [],
  subtitleTracks: [],
  metadata: null,
  subtitleStyle: { delaySecs: 0, scale: 1, position: 100 },
  error: null,
  eofReached: false,
});
