import { forwardRef, useEffect, useRef, useState, type CSSProperties } from "react";
import { dispatch, shallowEqual, usePlayerSnapshot } from "./store";
import { Timeline } from "./Timeline";
import { setPlayerFullscreen, togglePlayerFullscreen } from "./fullscreen";
import { formatTime } from "./time";
import { FULLSCREEN_CLOSE_SLOT_TOP_PX } from "./chromeAutoHide";
import { invoke } from "@tauri-apps/api/core";
import { isAndroidPlatform } from "../../lib/platform";
import { useToasts } from "../../components/useToasts";
import { Icon } from "../../components/icons";
import type { RepeatMode } from "../../generated/player";

function TimePair() {
  const data = usePlayerSnapshot(
    (s) => ({
      position: s.positionSecs,
      duration: s.durationSecs,
    }),
    shallowEqual,
  );
  const text = `${formatTime(data.position)} / ${formatTime(data.duration)}`;
  const valueText = `Position ${formatTime(data.position)} of ${formatTime(data.duration)}`;
  return (
    <span className="time-pair mono" aria-label={valueText} title={valueText}>
      {text}
    </span>
  );
}

/**
 * Fullscreen close chip from `src/assets/close_icon.svg` (1024² canvas, disc
 * r=252 at the center). CSS scales the canvas so the disc fills the 52px chip;
 * on Windows the same file is composited with per-pixel alpha above the video
 * host so the circumference is anti-aliased instead of a 1-bit GDI ellipse.
 */
function FullscreenCloseGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      className="fullscreen-close-glyph"
      aria-hidden="true"
      focusable="false"
      overflow="visible"
    >
      <circle
        cx="512"
        cy="512"
        r="252"
        fill="#2F2B43"
        fillOpacity="0.88"
        className="fullscreen-close-disc"
      />
      <path
        d="M432 432L592 592M592 432L432 592"
        fill="none"
        stroke="#F7F6FA"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="fullscreen-close-x"
      />
    </svg>
  );
}

/**
 * Fullscreen-only close chip. Shown at the top-center when the pointer is along
 * the top edge — matching YouTube/Chrome, not the windowed control strip.
 */
export const FullscreenCloseButton = forwardRef<
  HTMLDivElement,
  {
    visible: boolean;
    onHoverChange: (hovering: boolean) => void;
  }
>(function FullscreenCloseButton({ visible, onHoverChange }, ref) {
  return (
    <div ref={ref} className="fullscreen-close-slot" style={{ top: FULLSCREEN_CLOSE_SLOT_TOP_PX }}>
      <div
        className={`fullscreen-close ${visible ? "visible" : ""}`}
        aria-hidden={!visible}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onPointerMove={() => onHoverChange(true)}
      >
        <button
          type="button"
          className="icon-btn fullscreen-close-btn"
          aria-label="Exit fullscreen"
          tabIndex={visible ? 0 : -1}
          onClick={() => void setPlayerFullscreen(false)}
        >
          <FullscreenCloseGlyph />
        </button>
      </div>
    </div>
  );
});

export function PlayerControls({
  onToggleSettings,
  settingsOpen = false,
}: {
  onToggleSettings: () => void;
  settingsOpen?: boolean;
}) {
  const snap = usePlayerSnapshot(
    (s) => ({
      phase: s.phase,
      muted: s.muted,
      volume: s.volume,
      fullscreen: s.fullscreen,
      subtitleTracks: s.subtitleTracks,
      playlistLength: s.playlist.items.length,
      repeat: s.playlist.repeat,
    }),
    shallowEqual,
  );
  const playing = snap.phase === "playing";
  const android = isAndroidPlatform();
  const toasts = useToasts();
  const [rotating, setRotating] = useState(false);
  async function rotateScreen() {
    setRotating(true);
    try {
      await invoke("rotate_mobile_screen");
    } catch {
      toasts.show("Could not rotate the screen. Try your device's rotation control.", {
        intent: "error",
      });
    } finally {
      setRotating(false);
    }
  }
  const selectedSub = snap.subtitleTracks.find((t) => t.selected);
  const lastSubId = useRef<number | null>(null);
  // Track the last-seen selected subtitle id in an effect, not during render
  // (writing refs in render is fragile under concurrent rendering).
  useEffect(() => {
    if (selectedSub) lastSubId.current = selectedSub.id;
  }, [selectedSub]);
  const hasSubs = snap.subtitleTracks.length > 0;
  const captionsOn = Boolean(selectedSub);
  const prevNextDisabled = snap.playlistLength < 2;

  // Optimistic volume: mirror the slider locally while dragging so the thumb
  // doesn't wait for the backend round-trip.
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const displayVolume = Math.min(
    volumeDragging && localVolume != null ? localVolume : snap.muted ? 0 : snap.volume,
    100,
  );

  const order: RepeatMode[] = ["off", "one", "all"];
  const cycleRepeat = () => {
    const next = order[(order.indexOf(snap.repeat) + 1) % order.length];
    void dispatch({ type: "set_repeat", mode: next });
  };
  const repeatLabel =
    snap.repeat === "one" ? "Repeat one" : snap.repeat === "all" ? "Repeat all" : "Repeat off";

  function toggleCaptions() {
    if (!hasSubs) return;
    if (selectedSub) {
      void dispatch({ type: "select_track", kind: "subtitle", track_id: null });
      return;
    }
    const fallback = lastSubId.current ?? snap.subtitleTracks[0]?.id ?? null;
    if (fallback != null) {
      void dispatch({ type: "select_track", kind: "subtitle", track_id: fallback });
    }
  }

  return (
    <div className="controls-stack" role="region" aria-label="Playback controls">
      <Timeline />
      <div className="controls-row">
        <div className="controls-group">
          <button
            type="button"
            className="icon-btn play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (K)" : "Play (K)"}
            onClick={() => void dispatch({ type: "toggle_pause" })}
          >
            <Icon name={playing ? "pause" : "play"} size="lg" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous"
            title="Previous (P)"
            disabled={prevNextDisabled}
            onClick={() => void dispatch({ type: "previous" })}
          >
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next"
            title="Next (N)"
            disabled={prevNextDisabled}
            onClick={() => void dispatch({ type: "next" })}
          >
            <Icon name="next" />
          </button>
        </div>

        <div className="controls-group volume">
          <button
            type="button"
            className="icon-btn"
            aria-label={snap.muted || snap.volume === 0 ? "Unmute" : "Mute"}
            title={snap.muted || snap.volume === 0 ? "Unmute (M)" : "Mute (M)"}
            onClick={() => void dispatch({ type: "set_muted", muted: !snap.muted })}
          >
            <Icon name={snap.muted || snap.volume === 0 ? "volume-mute" : "volume"} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={displayVolume}
            aria-label="Volume"
            aria-valuetext={`${Math.round(displayVolume)} percent`}
            style={
              {
                ["--range-progress" as string]: `${displayVolume}%`,
              } as CSSProperties
            }
            onPointerDown={() => setVolumeDragging(true)}
            onPointerUp={() => {
              setVolumeDragging(false);
              setLocalVolume(null);
            }}
            onPointerCancel={() => {
              setVolumeDragging(false);
              setLocalVolume(null);
            }}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLocalVolume(v);
              void dispatch({ type: "set_volume", volume: v });
              // Dragging the slider away from 0 while muted unmutes (the
              // universal player convention).
              if (snap.muted && v > 0) {
                void dispatch({ type: "set_muted", muted: false });
              }
            }}
          />
        </div>

        <TimePair />

        <div className="controls-group end">
          <button
            type="button"
            className={`icon-btn${snap.repeat !== "off" ? " is-on" : ""}`}
            aria-label={repeatLabel}
            title={repeatLabel}
            aria-pressed={snap.repeat !== "off"}
            onClick={cycleRepeat}
          >
            <Icon name={snap.repeat === "one" ? "repeat-one" : "repeat"} />
          </button>

          <button
            type="button"
            className={`icon-btn${captionsOn ? " is-on" : ""}`}
            aria-label={
              hasSubs
                ? captionsOn
                  ? "Turn captions off"
                  : "Turn captions on"
                : "No captions — load a subtitle file in Settings"
            }
            title={
              hasSubs
                ? captionsOn
                  ? "Turn captions off"
                  : "Turn captions on"
                : "No captions — load a subtitle file in Settings"
            }
            aria-pressed={hasSubs ? captionsOn : undefined}
            disabled={!hasSubs}
            onClick={toggleCaptions}
          >
            <Icon name="captions" />
          </button>

          <button
            type="button"
            className={`icon-btn settings-trigger${settingsOpen ? " is-on" : ""}`}
            aria-label="Settings"
            title="Settings"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-controls={settingsOpen ? "player-settings" : undefined}
            onClick={onToggleSettings}
          >
            <Icon name="settings" />
          </button>

          {android ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Rotate screen"
              title="Rotate screen"
              disabled={rotating}
              onClick={() => void rotateScreen()}
            >
              <Icon name="rotate" />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={snap.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={snap.fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}
            onClick={() =>
              void togglePlayerFullscreen(snap.fullscreen).catch(() => {
                toasts.show("Could not change fullscreen mode.", { intent: "error" });
              })
            }
          >
            <Icon name={snap.fullscreen ? "fullscreen-exit" : "fullscreen"} />
          </button>
        </div>
      </div>
    </div>
  );
}
