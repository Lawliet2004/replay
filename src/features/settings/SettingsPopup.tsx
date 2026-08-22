import { useEffect, useState, type CSSProperties, type Ref } from "react";
import type { RepeatMode, Settings, Track } from "../../generated/player";
import { getSettings, updateSettings } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pickMediaFiles } from "../../lib/mediaPicker";
import { dispatch, shallowEqual, usePlayerSnapshot } from "../player/store";
import { SEEK_STEP_OPTIONS, setSeekStepSecs } from "../player/seekPrefs";
import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  SPEED_STEP,
  formatSpeedCompact,
  formatSpeedReadout,
  isActivePreset,
  snapSpeed,
  stepSpeed,
} from "../player/speed";
import { PlaylistPanel } from "../playlist/PlaylistPanel";
import { MetadataPanel } from "../player/MetadataPanel";
import { ShortcutsPanel } from "../player/ShortcutsPanel";

export type SettingsView =
  | "root"
  | "speed"
  | "queue"
  | "captions"
  | "audio"
  | "enhancer"
  | "substyle"
  | "playback"
  | "info"
  | "shortcuts";

const VIEW_TITLE: Record<SettingsView, string> = {
  root: "Settings",
  speed: "Playback speed",
  queue: "Queue",
  captions: "Captions",
  audio: "Audio track",
  enhancer: "Audio enhancer",
  substyle: "Subtitle style",
  playback: "Playback",
  info: "Media info",
  shortcuts: "Keyboard shortcuts",
};

const FX_PRESETS = [
  "Flat",
  "Music",
  "Vocal",
  "Podcast",
  "Movies",
  "Gaming",
  "Bass Boost",
  "Clear",
  "Warm",
];

function trackLabel(t: Track): string {
  const name = t.title || t.language || `Track ${t.id}`;
  return t.external ? `${name} (external)` : name;
}

function selectedTrack(tracks: Track[]): Track | undefined {
  return tracks.find((t) => t.selected);
}

function repeatLabel(mode: RepeatMode): string {
  if (mode === "one") return "One";
  if (mode === "all") return "All";
  return "Off";
}

function Chevron() {
  return (
    <svg className="settings-nav-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 6.5 15.5 12 9 17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavRow({
  label,
  value,
  onClick,
  chevron = true,
}: {
  label: string;
  value?: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button type="button" className="settings-nav-row" onClick={onClick}>
      <span>{label}</span>
      {value ? <span className="settings-nav-value">{value}</span> : null}
      {chevron ? <Chevron /> : null}
    </button>
  );
}

function ChoiceRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-nav-row${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{label}</span>
      {selected ? (
        <svg className="settings-check" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 12.5 9.5 17 19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
}

export function SettingsPopup({
  open,
  onClose,
  panelRef,
  initialView = "root",
  onViewChange,
}: {
  open: boolean;
  onClose: () => void;
  panelRef?: Ref<HTMLDivElement>;
  initialView?: SettingsView;
  onViewChange?: (view: SettingsView) => void;
}) {
  const snap = usePlayerSnapshot(
    (s) => ({
      speed: s.speed,
      playlistCount: s.playlist.items.length,
      repeat: s.playlist.repeat,
      audioTracks: s.audioTracks,
      subtitleTracks: s.subtitleTracks,
      subtitleStyle: s.subtitleStyle,
    }),
    shallowEqual,
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxPreset, setFxPreset] = useState("Flat");
  const [view, setView] = useState<SettingsView>("root");

  useEffect(() => {
    if (open) {
      setView(initialView);
      setLoadError(null);
      void getSettings()
        .then((s) => {
          setSettings(s);
          setFxEnabled(s.fxEnabled);
          setFxPreset(s.fxPreset);
          setSeekStepSecs(s.seekStepSecs);
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof Error ? err.message : "Could not load settings.");
        });
    } else {
      setView("root");
    }
  }, [open, initialView]);

  useEffect(() => {
    if (open) onViewChange?.(view);
  }, [open, view, onViewChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (view !== "root") setView("root");
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, view, onClose]);

  if (!open) return null;

  async function save(next: Settings) {
    setSettings(next);
    setSeekStepSecs(next.seekStepSecs);
    try {
      await updateSettings(next);
    } catch (err) {
      console.error("Failed to apply settings", err);
    }
  }

  async function addSubtitle() {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: "Subtitles", extensions: ["srt", "ass", "ssa", "vtt"] }],
    });
    if (typeof file === "string") {
      await dispatch({ type: "add_subtitle", path: file });
    }
  }

  async function openFiles() {
    const paths = await pickMediaFiles();
    if (!paths?.length) return;
    await dispatch({ type: "open_paths", paths, replace: true });
    onClose();
  }

  function setSpeed(next: number) {
    void dispatch({ type: "set_speed", speed: snapSpeed(next) });
  }

  function cycleRepeat() {
    const order: RepeatMode[] = ["off", "one", "all"];
    const idx = order.indexOf(snap.repeat);
    const mode = order[(idx + 1) % order.length];
    void dispatch({ type: "set_repeat", mode });
  }

  const captionTrack = selectedTrack(snap.subtitleTracks);
  const audioTrack = selectedTrack(snap.audioTracks);
  const enhancerValue = settings ? (fxEnabled ? fxPreset : "Off") : "…";

  return (
    <div
      ref={panelRef}
      className="settings-popup"
      role="dialog"
      aria-label={VIEW_TITLE[view]}
      data-view={view}
    >
      <header className="settings-popup-head">
        {view !== "root" ? (
          <button
            type="button"
            className="icon-btn settings-back"
            aria-label="Back"
            onClick={() => setView("root")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15.5 5.5 9 12l6.5 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <h2>{VIEW_TITLE[view]}</h2>
        {view === "root" ? (
          <button
            type="button"
            className="icon-btn drawer-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <span className="settings-head-spacer" />
        )}
      </header>

      {view === "speed" ? (
        <div className="settings-popup-body speed-panel">
          <div className="speed-readout" aria-live="polite">
            {formatSpeedReadout(snap.speed)}
          </div>
          <div className="speed-slider-row">
            <button
              type="button"
              className="speed-step"
              aria-label="Decrease speed"
              onClick={() => setSpeed(stepSpeed(snap.speed, -1))}
            >
              −
            </button>
            <input
              className="speed-slider"
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={snapSpeed(snap.speed)}
              aria-label="Playback speed"
              style={
                {
                  ["--range-progress"]: `${((snapSpeed(snap.speed) - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <button
              type="button"
              className="speed-step"
              aria-label="Increase speed"
              onClick={() => setSpeed(stepSpeed(snap.speed, 1))}
            >
              +
            </button>
          </div>
          <div className="speed-chips" role="list">
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="listitem"
                className={`speed-chip${isActivePreset(snap.speed, preset.value) ? " is-active" : ""}`}
                aria-pressed={isActivePreset(snap.speed, preset.value)}
                onClick={() => setSpeed(preset.value)}
              >
                <span>{preset.chip}</span>
                {preset.caption ? (
                  <span className="speed-chip-caption">{preset.caption}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : view === "queue" ? (
        <div className="settings-popup-body">
          <PlaylistPanel />
        </div>
      ) : view === "captions" ? (
        <div className="settings-popup-body">
          <ChoiceRow
            label="Off"
            selected={!captionTrack}
            onClick={() =>
              void dispatch({ type: "select_track", kind: "subtitle", track_id: null })
            }
          />
          {snap.subtitleTracks.map((t) => (
            <ChoiceRow
              key={t.id}
              label={trackLabel(t)}
              selected={t.selected}
              onClick={() =>
                void dispatch({ type: "select_track", kind: "subtitle", track_id: t.id })
              }
            />
          ))}
          <button type="button" className="settings-action" onClick={() => void addSubtitle()}>
            Load external subtitle…
          </button>
        </div>
      ) : view === "audio" ? (
        <div className="settings-popup-body">
          {snap.audioTracks.length === 0 ? (
            <p className="settings-note">No audio tracks.</p>
          ) : (
            snap.audioTracks.map((t) => (
              <ChoiceRow
                key={t.id}
                label={trackLabel(t)}
                selected={t.selected}
                onClick={() =>
                  void dispatch({ type: "select_track", kind: "audio", track_id: t.id })
                }
              />
            ))
          )}
        </div>
      ) : view === "enhancer" ? (
        <div className="settings-popup-body">
          {!settings ? (
            <p className="settings-note">{loadError ?? "Loading settings…"}</p>
          ) : (
            <>
              <p className="settings-note">
                Enhancement applies only to audio played through Replay.
              </p>
              <label className="field">
                <span>Enable enhancement</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={fxEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setFxEnabled(enabled);
                    void save({ ...settings, fxEnabled: enabled, fxPreset });
                    void dispatch({ type: "set_audio_fx", enabled, preset: fxPreset });
                  }}
                />
              </label>
              {FX_PRESETS.map((preset) => (
                <ChoiceRow
                  key={preset}
                  label={preset}
                  selected={fxPreset === preset}
                  onClick={() => {
                    setFxPreset(preset);
                    void save({ ...settings, fxEnabled, fxPreset: preset });
                    void dispatch({ type: "set_audio_fx", enabled: fxEnabled, preset });
                  }}
                />
              ))}
            </>
          )}
        </div>
      ) : view === "substyle" ? (
        <div className="settings-popup-body">
          <label className="field field-slider">
            <span className="field-label">Delay</span>
            <input
              type="range"
              min={-5}
              max={5}
              step={0.1}
              value={snap.subtitleStyle.delaySecs}
              style={
                {
                  ["--range-progress"]: `${((snap.subtitleStyle.delaySecs + 5) / 10) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) =>
                void dispatch({
                  type: "set_subtitle_style",
                  style: { ...snap.subtitleStyle, delaySecs: Number(e.target.value) },
                })
              }
            />
            <span className="field-value">{snap.subtitleStyle.delaySecs.toFixed(1)}s</span>
          </label>
          <label className="field field-slider">
            <span className="field-label">Size</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.05}
              value={snap.subtitleStyle.scale}
              style={
                {
                  ["--range-progress"]: `${((snap.subtitleStyle.scale - 0.5) / 2) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) =>
                void dispatch({
                  type: "set_subtitle_style",
                  style: { ...snap.subtitleStyle, scale: Number(e.target.value) },
                })
              }
            />
            <span className="field-value">{snap.subtitleStyle.scale.toFixed(2)}×</span>
          </label>
          <label className="field field-slider">
            <span className="field-label">Position</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={snap.subtitleStyle.position}
              style={
                {
                  ["--range-progress"]: `${snap.subtitleStyle.position}%`,
                } as CSSProperties
              }
              onChange={(e) =>
                void dispatch({
                  type: "set_subtitle_style",
                  style: { ...snap.subtitleStyle, position: Number(e.target.value) },
                })
              }
            />
            <span className="field-value">{Math.round(snap.subtitleStyle.position)}</span>
          </label>
        </div>
      ) : view === "playback" ? (
        <div className="settings-popup-body">
          {!settings ? (
            <p className="settings-note">{loadError ?? "Loading settings…"}</p>
          ) : (
            <>
              <label className="field">
                <span>Resume playback</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={settings.resumeEnabled}
                  onChange={(e) => void save({ ...settings, resumeEnabled: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>Autoplay next</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={settings.autoplayNext}
                  onChange={(e) => void save({ ...settings, autoplayNext: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>Hardware decode</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={settings.hardwareDecode}
                  onChange={(e) => void save({ ...settings, hardwareDecode: e.target.checked })}
                />
              </label>
              <label className="field field-select">
                <span>Seek step (← / →)</span>
                <select
                  className="settings-select"
                  aria-label="Seek step"
                  value={settings.seekStepSecs}
                  onChange={(e) => void save({ ...settings, seekStepSecs: Number(e.target.value) })}
                >
                  {SEEK_STEP_OPTIONS.map((secs) => (
                    <option key={secs} value={secs}>
                      {secs >= 60 ? "1 minute" : `${secs} seconds`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      ) : view === "info" ? (
        <div className="settings-popup-body">
          <MetadataPanel />
        </div>
      ) : view === "shortcuts" ? (
        <div className="settings-popup-body">
          <ShortcutsPanel />
        </div>
      ) : (
        <div className="settings-popup-body">
          <NavRow
            label="Playback speed"
            value={formatSpeedCompact(snap.speed)}
            onClick={() => setView("speed")}
          />
          <NavRow
            label="Queue"
            value={String(snap.playlistCount)}
            onClick={() => setView("queue")}
          />
          <NavRow
            label="Repeat"
            value={repeatLabel(snap.repeat)}
            chevron={false}
            onClick={cycleRepeat}
          />
          <NavRow
            label="Captions"
            value={captionTrack ? trackLabel(captionTrack) : "Off"}
            onClick={() => setView("captions")}
          />
          <NavRow
            label="Audio track"
            value={audioTrack ? trackLabel(audioTrack) : "—"}
            onClick={() => setView("audio")}
          />
          <NavRow
            label="Audio enhancer"
            value={enhancerValue}
            onClick={() => setView("enhancer")}
          />
          <NavRow label="Subtitle style" onClick={() => setView("substyle")} />
          <NavRow label="Playback" onClick={() => setView("playback")} />
          <NavRow label="Open files…" chevron={false} onClick={() => void openFiles()} />
          <NavRow label="Media info" onClick={() => setView("info")} />
          <NavRow label="Keyboard shortcuts" onClick={() => setView("shortcuts")} />
        </div>
      )}
    </div>
  );
}
