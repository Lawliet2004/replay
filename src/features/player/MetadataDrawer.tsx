import { usePlayerSnapshot } from "../player/store";

export function MetadataDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snap = usePlayerSnapshot();
  if (!open) return null;
  const m = snap.metadata;

  return (
    <aside className="drawer" role="dialog" aria-label="Media information">
      <header className="drawer-head">
        <h2>Info</h2>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <dl className="meta">
        <div>
          <dt>File</dt>
          <dd>{snap.current?.displayName ?? "—"}</dd>
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
    </aside>
  );
}
