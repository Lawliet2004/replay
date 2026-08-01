export type PlaybackClickKind = "play" | "pause";

export type PlaybackClickFlash = {
  kind: PlaybackClickKind;
  token: number;
};

/** Brief YouTube-style center play/pause flash after a surface click. */
export function PlaybackClickFeedback({ flash }: { flash: PlaybackClickFlash | null }) {
  if (!flash) return null;

  return (
    <div className="playback-click-feedback" aria-hidden="true" key={flash.token}>
      <div className="playback-click-feedback-disc">
        {flash.kind === "pause" ? (
          <svg viewBox="0 0 24 24" className="playback-click-feedback-icon">
            <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="playback-click-feedback-icon play">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        )}
      </div>
    </div>
  );
}
