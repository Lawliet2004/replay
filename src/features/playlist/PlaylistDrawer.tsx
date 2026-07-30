import { dispatch, usePlayerSnapshot } from "../player/store";

export function PlaylistDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snap = usePlayerSnapshot();
  if (!open) return null;

  return (
    <aside className="drawer" role="dialog" aria-label="Playlist">
      <header className="drawer-head">
        <h2>Queue</h2>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <ul className="playlist">
        {snap.playlist.items.length === 0 && <li className="empty">No items in queue</li>}
        {snap.playlist.items.map((item, index) => {
          const active = snap.playlist.currentIndex === index;
          return (
            <li key={item.id} className={active ? "active" : undefined}>
              <button
                type="button"
                className="playlist-item"
                onClick={() => void dispatch({ type: "play_index", index })}
              >
                <span className="idx">{index + 1}</span>
                <span className="name">{item.displayName}</span>
              </button>
              <button
                type="button"
                className="icon-btn tiny"
                aria-label={`Remove ${item.displayName}`}
                onClick={() => void dispatch({ type: "remove_playlist_item", index })}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="drawer-foot">
        <button
          type="button"
          className="text-btn"
          onClick={() => void dispatch({ type: "clear_playlist" })}
        >
          Clear queue
        </button>
      </footer>
    </aside>
  );
}
