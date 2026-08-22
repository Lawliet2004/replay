import { forwardRef, useRef, type CSSProperties } from "react";
import { dispatch, shallowEqual, usePlayerSnapshot } from "./store";
import { Timeline } from "./Timeline";
import { setPlayerFullscreen, togglePlayerFullscreen } from "./fullscreen";
import { formatTime } from "./time";
import { FULLSCREEN_CLOSE_SLOT_TOP_PX } from "./chromeAutoHide";

function TimePair() {
  const text = usePlayerSnapshot(
    (s) => `${formatTime(s.positionSecs)} / ${formatTime(s.durationSecs)}`,
  );
  return (
    <span className="time-pair mono" aria-label="Playback time">
      {text}
    </span>
  );
}

/** YouTube player fullscreen glyph (36×36). `exit` points the corners inward. */
function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 36 36" className="fullscreen-glyph" aria-hidden="true">
      {exit ? (
        <>
          <path d="m 14,14 -4,0 0,2 6,0 0,-6 -2,0 0,4 0,0 z" fill="currentColor" />
          <path d="m 22,14 0,-4 -2,0 0,6 6,0 0,-2 -4,0 0,0 z" fill="currentColor" />
          <path d="m 20,26 2,0 0,-4 4,0 0,-2 -6,0 0,6 0,0 z" fill="currentColor" />
          <path d="m 10,22 4,0 0,4 2,0 0,-6 -6,0 0,2 0,0 z" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="m 10,16 2,0 0,-4 4,0 0,-2 L 10,10 l 0,6 0,0 z" fill="currentColor" />
          <path d="m 20,10 0,2 4,0 0,4 2,0 L 26,10 l -6,0 0,0 z" fill="currentColor" />
          <path d="m 24,24 -4,0 0,2 L 26,26 l 0,-6 -2,0 0,4 0,0 z" fill="currentColor" />
          <path d="M 12,20 10,20 10,26 l 6,0 0,-2 -4,0 0,-4 0,0 z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/**
 * Chrome FullscreenControlView close chip (the top-center X on YouTube
 * fullscreen): flat 48px gray disc, 24px rounded X, no border/shadow.
 *
 * Fill is Chrome's `rgba(40,44,50,0.80)` composited over white — the color in
 * the YouTube screenshot. The disc is opaque (sibling HWNDs cannot blend with
 * video). r>64 overfills the viewBox so the 1-bit GDI hole clips solid gray
 * instead of the anti-aliased fringe (that fringe is the jagged rim).
 */
function FullscreenCloseGlyph() {
  return (
    <svg
      viewBox="0 0 128 128"
      className="fullscreen-close-glyph"
      aria-hidden="true"
      focusable="false"
      overflow="visible"
    >
      <circle cx="64" cy="64" r="66" fill="#53565B" className="fullscreen-close-disc" />
      <path
        d="M51 51L77 77M77 51L51 77"
        fill="none"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinecap="round"
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
    }),
    shallowEqual,
  );
  const playing = snap.phase === "playing";
  const selectedSub = snap.subtitleTracks.find((t) => t.selected);
  const lastSubId = useRef<number | null>(null);
  if (selectedSub) lastSubId.current = selectedSub.id;
  const hasSubs = snap.subtitleTracks.length > 0;
  const captionsOn = Boolean(selectedSub);

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
            style={
              {
                ["--range-progress" as string]: `${snap.muted ? 0 : snap.volume}%`,
              } as CSSProperties
            }
            onChange={(e) => void dispatch({ type: "set_volume", volume: Number(e.target.value) })}
          />
        </div>

        <TimePair />

        <div className="controls-group end">
          {hasSubs ? (
            <button
              type="button"
              className={`icon-btn${captionsOn ? " is-on" : ""}`}
              aria-label={captionsOn ? "Turn captions off" : "Turn captions on"}
              aria-pressed={captionsOn}
              onClick={toggleCaptions}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3.2 5.2c-.9 0-1.5.4-1.9 1.1-.3.6-.3 1.4 0 2 .4.7 1 1.1 1.9 1.1.6 0 1.1-.2 1.5-.5l.7.9c-.6.5-1.4.8-2.3.8-1.5 0-2.6-.6-3.2-1.7-.6-1-.6-2.3 0-3.3.6-1.1 1.7-1.7 3.2-1.7.9 0 1.7.3 2.3.8l-.7.9c-.4-.3-.9-.5-1.5-.5zm7.6 0c-.9 0-1.5.4-1.9 1.1-.3.6-.3 1.4 0 2 .4.7 1 1.1 1.9 1.1.6 0 1.1-.2 1.5-.5l.7.9c-.6.5-1.4.8-2.3.8-1.5 0-2.6-.6-3.2-1.7-.6-1-.6-2.3 0-3.3.6-1.1 1.7-1.7 3.2-1.7.9 0 1.7.3 2.3.8l-.7.9c-.4-.3-.9-.5-1.5-.5z"
                  fill="currentColor"
                />
              </svg>
            </button>
          ) : null}

          <button
            type="button"
            className={`icon-btn${settingsOpen ? " is-on" : ""}`}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onClick={onToggleSettings}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.65l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96c-.5-.4-1.04-.7-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.24-1.13.54-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.65l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.65l1.92 3.32c.14.24.43.34.61.22l2.39-.96c.5.4 1.04.7 1.62.94l.36 2.54c.05.24.26.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.24 1.13-.54 1.62-.94l2.39.96c.18.12.47.02.61-.22l1.92-3.32a.5.5 0 0 0-.12-.65l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
                fill="currentColor"
              />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn"
            aria-label={snap.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void togglePlayerFullscreen(snap.fullscreen)}
          >
            <FullscreenIcon exit={snap.fullscreen} />
          </button>
        </div>
      </div>
    </div>
  );
}
