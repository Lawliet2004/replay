import { shallowEqual, usePlayerSnapshot } from "./store";

export function MetadataPanel() {
  const { displayName, metadata: m } = usePlayerSnapshot(
    (s) => ({ displayName: s.current?.displayName ?? "—", metadata: s.metadata }),
    shallowEqual,
  );

  return (
    <dl className="meta">
      <div>
        <dt>File</dt>
        <dd>{displayName}</dd>
      </div>
      <div>
        <dt>Title</dt>
        <dd>{m?.title ?? "—"}</dd>
      </div>
      <div>
        <dt>Container</dt>
        <dd>{m?.container ?? "—"}</dd>
      </div>
      <div>
        <dt>Video</dt>
        <dd>
          {m?.videoCodec ?? "—"}
          {m?.width && m?.height ? ` · ${m.width}×${m.height}` : ""}
          {m?.fps ? ` · ${m.fps.toFixed(2)} fps` : ""}
        </dd>
      </div>
      <div>
        <dt>Audio</dt>
        <dd>{m?.audioCodec ?? "—"}</dd>
      </div>
      <div>
        <dt>Artist</dt>
        <dd>{m?.artist ?? "—"}</dd>
      </div>
      <div>
        <dt>Album</dt>
        <dd>{m?.album ?? "—"}</dd>
      </div>
    </dl>
  );
}
