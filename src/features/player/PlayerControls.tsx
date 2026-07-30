import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dispatch, usePlayerSnapshot } from "./store";
import { Timeline } from "./Timeline";
import type { RepeatMode } from "../../generated/player";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerControls({
  onOpenSettings,
  onOpenHelp,
  onOpenMeta,
  onOpenPlaylist,
}: {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenMeta: () => void;
  onOpenPlaylist: () => void;
}) {
  const snap = usePlayerSnapshot();
  const playing = snap.phase === "playing";

  async function openFiles(replace: boolean) {
    const selected = await open({
      multiple: true,
      title: "Open media",
      filters: [
        {
          name: "Media",
          extensions: [
            "mp4",
            "mkv",
            "webm",
            "avi",
            "mov",
            "m4v",
            "mp3",
            "flac",
            "opus",
            "wav",
            "aac",
            "m4a",
            "ogg",
          ],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await dispatch({ type: "open_paths", paths, replace });
  }

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    const next = !snap.fullscreen;
    await win.setFullscreen(next);
    await dispatch({ type: "set_fullscreen", fullscreen: next });
  }

  function cycleRepeat() {
    const order: RepeatMode[] = ["off", "one", "all"];
    const idx = order.indexOf(snap.playlist.repeat);
    const mode = order[(idx + 1) % order.length];
    void dispatch({ type: "set_repeat", mode });
  }

  return (
    <div className="controls" role="region" aria-label="Playback controls">
      <Timeline />
      <div className="controls-row">
        <div className="controls-group">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous"
            onClick={() => void dispatch({ type: "previous" })}
          >
            ⏮
          </button>
          <button
            type="button"
            className="icon-btn play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => void dispatch({ type: "toggle_pause" })}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next"
            onClick={() => void dispatch({ type: "next" })}
          >
            ⏭
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Stop"
            onClick={() => void dispatch({ type: "stop" })}
          >
            ⏹
          </button>
        </div>

        <div className="controls-group volume">
          <button
            type="button"
            className="icon-btn"
            aria-label={snap.muted ? "Unmute" : "Mute"}
            onClick={() => void dispatch({ type: "set_muted", muted: !snap.muted })}
          >
            {snap.muted || snap.volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={snap.muted ? 0 : snap.volume}
            aria-label="Volume"
            onChange={(e) => void dispatch({ type: "set_volume", volume: Number(e.target.value) })}
          />
        </div>

        <div className="title-chip" title={snap.current?.path ?? ""}>
          {snap.phase === "loading" ? "Loading…" : (snap.current?.displayName ?? "Replay")}
        </div>

        <div className="controls-group end">
          <label className="speed">
            <span className="sr-only">Speed</span>
            <select
              value={snap.speed}
              aria-label="Playback speed"
              onChange={(e) => void dispatch({ type: "set_speed", speed: Number(e.target.value) })}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="icon-btn" aria-label="Repeat mode" onClick={cycleRepeat}>
            {snap.playlist.repeat === "one" ? "🔂" : snap.playlist.repeat === "all" ? "🔁" : "➡️"}
          </button>
          <button type="button" className="text-btn" onClick={onOpenPlaylist}>
            Queue
          </button>
          <button type="button" className="text-btn" onClick={onOpenMeta}>
            Info
          </button>
          <button type="button" className="text-btn" onClick={() => void openFiles(true)}>
            Open
          </button>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
            ⚙
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Keyboard shortcuts"
            onClick={onOpenHelp}
          >
            ?
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fullscreen"
            onClick={() => void toggleFullscreen()}
          >
            ⛶
          </button>
        </div>
      </div>
    </div>
  );
}
