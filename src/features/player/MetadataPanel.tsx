import { useState } from "react";
import { shallowEqual, usePlayerSnapshot } from "./store";

function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable in this context */
    }
  };
  return (
    <dd
      tabIndex={0}
      title={copied ? "Copied" : "Click to copy"}
      style={{ cursor: "pointer" }}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") void copy();
      }}
    >
      {copied ? "Copied" : value}
      <span className="visually-hidden">{` (${label})`}</span>
    </dd>
  );
}

export function MetadataPanel() {
  const { displayName, metadata: m } = usePlayerSnapshot(
    (s) => ({ displayName: s.current?.displayName ?? "—", metadata: s.metadata }),
    shallowEqual,
  );

  if (!m) {
    return (
      <dl className="meta">
        <div>
          <dt>File</dt>
          <CopyableValue value={displayName} label="file name" />
        </div>
        <div>
          <dt>Media info</dt>
          <dd>No media loaded</dd>
        </div>
      </dl>
    );
  }

  const videoParts = [
    m.videoCodec,
    m.width && m.height ? `${m.width}×${m.height}` : null,
    m.fps ? `${Number(m.fps.toFixed(2))} fps` : null,
  ].filter(Boolean);
  const bitrateMbps =
    m.bitrate && m.bitrate > 0 ? `${(Number(m.bitrate) / 1e6).toFixed(1)} Mbps` : null;

  return (
    <dl className="meta">
      <div>
        <dt>File</dt>
        <CopyableValue value={displayName} label="file name" />
      </div>
      <div>
        <dt>Title</dt>
        <dd>{m.title ?? "—"}</dd>
      </div>
      <div>
        <dt>Container</dt>
        <dd>{m.container ?? "—"}</dd>
      </div>
      <div>
        <dt>Video</dt>
        <dd>{videoParts.length ? videoParts.join(" · ") : "—"}</dd>
      </div>
      <div>
        <dt>Audio</dt>
        <dd>{m.audioCodec ?? "—"}</dd>
      </div>
      <div>
        <dt>Bitrate</dt>
        <dd>{bitrateMbps ?? "—"}</dd>
      </div>
      <div>
        <dt>Artist</dt>
        <dd>{m.artist ?? "—"}</dd>
      </div>
      <div>
        <dt>Album</dt>
        <dd>{m.album ?? "—"}</dd>
      </div>
      {m.date ? (
        <div>
          <dt>Date</dt>
          <dd>{m.date}</dd>
        </div>
      ) : null}
    </dl>
  );
}
