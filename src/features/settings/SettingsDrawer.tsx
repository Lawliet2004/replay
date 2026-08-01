import { useEffect, useState } from "react";
import type { Settings } from "../../generated/player";
import { getSettings, updateSettings } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dispatch, usePlayerSnapshot } from "../player/store";
import { SEEK_STEP_OPTIONS, setSeekStepSecs } from "../player/seekPrefs";

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snap = usePlayerSnapshot();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxPreset, setFxPreset] = useState("Flat");

  useEffect(() => {
    if (open) {
      void getSettings().then((s) => {
        setSettings(s);
        setFxEnabled(s.fxEnabled);
        setFxPreset(s.fxPreset);
        setSeekStepSecs(s.seekStepSecs);
      });
    }
  }, [open]);

  if (!open || !settings) return null;

  async function save(next: Settings) {
    setSettings(next);
    setSeekStepSecs(next.seekStepSecs);
    await updateSettings(next);
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

  return (
    <aside className="drawer settings" role="dialog" aria-label="Settings">
      <header className="drawer-head">
        <h2>Settings</h2>
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
      </header>
      <div className="settings-body">
        <section className="settings-section">
          <h3>Replay FX enhancer</h3>
          <div className="settings-section-body">
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
            <label className="field field-select field-select-stack">
              <span>Preset</span>
              <select
                className="settings-select"
                aria-label="FX preset"
                value={fxPreset}
                onChange={(e) => {
                  const preset = e.target.value;
                  setFxPreset(preset);
                  void save({ ...settings, fxEnabled, fxPreset: preset });
                  void dispatch({ type: "set_audio_fx", enabled: fxEnabled, preset });
                }}
              >
                {[
                  "Flat",
                  "Music",
                  "Vocal",
                  "Podcast",
                  "Movies",
                  "Gaming",
                  "Bass Boost",
                  "Clear",
                  "Warm",
                ].map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="settings-section">
          <h3>Playback</h3>
          <div className="settings-section-body">
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
          </div>
        </section>

        <section className="settings-section">
          <h3>Subtitles</h3>
          <div className="settings-section-body">
            <label className="field field-slider">
              <span className="field-label">Delay</span>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.1}
                value={snap.subtitleStyle.delaySecs}
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
                onChange={(e) =>
                  void dispatch({
                    type: "set_subtitle_style",
                    style: { ...snap.subtitleStyle, position: Number(e.target.value) },
                  })
                }
              />
              <span className="field-value">{Math.round(snap.subtitleStyle.position)}</span>
            </label>
            <button type="button" className="settings-action" onClick={() => void addSubtitle()}>
              Load external subtitle…
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Tracks</h3>
          <div className="settings-section-body">
            <label className="field field-select field-select-stack">
              <span>Audio track</span>
              <select
                className="settings-select"
                aria-label="Audio track"
                value={snap.audioTracks.find((t) => t.selected)?.id ?? ""}
                onChange={(e) =>
                  void dispatch({
                    type: "select_track",
                    kind: "audio",
                    track_id: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                {snap.audioTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || t.language || `Audio ${t.id}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-select field-select-stack">
              <span>Subtitle track</span>
              <select
                className="settings-select"
                aria-label="Subtitle track"
                value={snap.subtitleTracks.find((t) => t.selected)?.id ?? ""}
                onChange={(e) =>
                  void dispatch({
                    type: "select_track",
                    kind: "subtitle",
                    track_id: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">Off</option>
                {snap.subtitleTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || t.language || `Sub ${t.id}`}
                    {t.external ? " (external)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Recents</h3>
          <div className="settings-section-body">
            <ul className="recents">
              {settings.recent.length === 0 && <li className="empty">No recent files</li>}
              {settings.recent.map((r) => (
                <li key={r.path}>
                  <button
                    type="button"
                    className="playlist-item"
                    onClick={() =>
                      void dispatch({ type: "open_paths", paths: [r.path], replace: true })
                    }
                  >
                    {r.displayName}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </aside>
  );
}
