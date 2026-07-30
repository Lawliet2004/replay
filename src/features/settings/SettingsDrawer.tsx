import { useEffect, useState } from "react";
import type { Settings } from "../../generated/player";
import { getSettings, updateSettings } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dispatch, usePlayerSnapshot } from "../player/store";

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snap = usePlayerSnapshot();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    if (open) {
      void getSettings().then(setSettings);
    }
  }, [open]);

  if (!open || !settings) return null;

  async function save(next: Settings) {
    setSettings(next);
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
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="settings-body">
        <label className="field">
          <span>Resume playback</span>
          <input
            type="checkbox"
            checked={settings.resumeEnabled}
            onChange={(e) => void save({ ...settings, resumeEnabled: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Autoplay next</span>
          <input
            type="checkbox"
            checked={settings.autoplayNext}
            onChange={(e) => void save({ ...settings, autoplayNext: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Hardware decode</span>
          <input
            type="checkbox"
            checked={settings.hardwareDecode}
            onChange={(e) => void save({ ...settings, hardwareDecode: e.target.checked })}
          />
        </label>

        <h3>Subtitles</h3>
        <label className="field">
          <span>Delay ({snap.subtitleStyle.delaySecs.toFixed(1)}s)</span>
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
        </label>
        <label className="field">
          <span>Size ({snap.subtitleStyle.scale.toFixed(2)}×)</span>
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
        </label>
        <label className="field">
          <span>Position ({Math.round(snap.subtitleStyle.position)})</span>
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
        </label>
        <button type="button" className="text-btn" onClick={() => void addSubtitle()}>
          Load external subtitle…
        </button>

        <h3>Audio track</h3>
        <select
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

        <h3>Subtitle track</h3>
        <select
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

        <h3>Recents</h3>
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
    </aside>
  );
}
