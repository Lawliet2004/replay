import type { Ref } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { dispatch, usePlayerSnapshot } from "./store";
import { Timeline } from "./Timeline";
import { togglePlayerFullscreen } from "./fullscreen";
import type { RepeatMode } from "../../generated/player";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerControls({
  onOpenSettings,
  onOpenHelp,
  onOpenMeta,
  onOpenPlaylist,
  overflowOpen = false,
  onOverflowOpenChange,
  overflowPanelRef,
}: {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenMeta: () => void;
  onOpenPlaylist: () => void;
  overflowOpen?: boolean;
  onOverflowOpenChange?: (open: boolean) => void;
  /** Measured by the host so the video window can punch a hole for the panel. */
  overflowPanelRef?: Ref<HTMLDivElement>;
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

  function cycleRepeat() {
    const order: RepeatMode[] = ["off", "one", "all"];
    const idx = order.indexOf(snap.playlist.repeat);
    const mode = order[(idx + 1) % order.length];
    void dispatch({ type: "set_repeat", mode });
  }

  const repeatLabel =
    snap.playlist.repeat === "one"
      ? "Repeat one"
      : snap.playlist.repeat === "all"
        ? "Repeat all"
        : "Repeat off";

  return (
    <div className="controls" role="region" aria-label="Playback controls">
      <Timeline />
      <div className="controls-row">
        <div className="controls-group">
          <button
            type="button"
            className="icon-btn play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => void dispatch({ type: "toggle_pause" })}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous"
            onClick={() => void dispatch({ type: "previous" })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next"
            onClick={() => void dispatch({ type: "next" })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 6h2v12h-2zm-11 6 8.5-6v12z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="controls-group volume">
          <button
            type="button"
            className="icon-btn"
            aria-label={snap.muted ? "Unmute" : "Mute"}
            onClick={() => void dispatch({ type: "set_muted", muted: !snap.muted })}
          >
            {snap.muted || snap.volume === 0 ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M16.5 12a4.5 4.5 0 0 0-1.5-3.3l1.4-1.4A6.5 6.5 0 0 1 18.5 12a6.5 6.5 0 0 1-2.1 4.7l-1.4-1.4A4.5 4.5 0 0 0 16.5 12zM4 9v6h4l5 5V4L8 9H4zm11.7 8.7-1.4-1.4.7-.7L4.2 4.5 5.6 3.1l14 14-1.4 1.4-.5-.5z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 0 0-1.5-3.3v6.6A4.5 4.5 0 0 0 15.5 12z"
                  fill="currentColor"
                />
              </svg>
            )}
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
                  {s === 1 ? "1×" : `${s}×`}
                </option>
              ))}
            </select>
          </label>

          <details
            className="more-menu"
            open={overflowOpen}
            onToggle={(e) => {
              onOverflowOpenChange?.((e.currentTarget as HTMLDetailsElement).open);
            }}
          >
            <summary className="icon-btn" aria-label="More options">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="12" r="1.8" fill="currentColor" />
                <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                <circle cx="18" cy="12" r="1.8" fill="currentColor" />
              </svg>
            </summary>
            <div className="more-panel" role="menu" ref={overflowPanelRef}>
              <button type="button" role="menuitem" onClick={onOpenPlaylist}>
                Queue
              </button>
              <button type="button" role="menuitem" onClick={onOpenMeta}>
                Info
              </button>
              <button type="button" role="menuitem" onClick={() => void openFiles(true)}>
                Open…
              </button>
              <button type="button" role="menuitem" onClick={cycleRepeat}>
                {repeatLabel}
              </button>
              <button type="button" role="menuitem" onClick={onOpenSettings}>
                Settings
              </button>
              <button type="button" role="menuitem" onClick={onOpenHelp}>
                Shortcuts
              </button>
            </div>
          </details>

          <button
            type="button"
            className="icon-btn"
            aria-label={snap.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void togglePlayerFullscreen(snap.fullscreen)}
          >
            {snap.fullscreen ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 14H5v5h5v-2H7v-3zm12 0h-2v3h-3v2h5v-5zM7 5h3V3H5v5h2V5zm7-2v2h3v3h2V3h-5z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 14H5v5h5v-2H7v-3zm0-9h3V3H5v5h2V5zm12 9h-2v3h-3v2h5v-5zm-2-9v3h-3v2h5V3h-2z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
