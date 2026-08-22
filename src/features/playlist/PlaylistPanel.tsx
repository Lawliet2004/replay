import { pickMediaFiles } from "../../lib/mediaPicker";
import { dispatch, shallowEqual, usePlayerSnapshot } from "../player/store";

export function PlaylistPanel() {
  const { items, currentIndex } = usePlayerSnapshot(
    (s) => ({ items: s.playlist.items, currentIndex: s.playlist.currentIndex }),
    shallowEqual,
  );
  const count = items.length;

  async function addFiles() {
    const paths = await pickMediaFiles();
    if (!paths?.length) return;
    await dispatch({ type: "open_paths", paths, replace: false });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= count) return;
    void dispatch({ type: "reorder_playlist", from, to });
  }

  return (
    <div className="settings-panel-block">
      <ul className="playlist">
        {count === 0 && (
          <li className="empty">Nothing queued. Add files without interrupting playback.</li>
        )}
        {items.map((item, index) => {
          const active = currentIndex === index;
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
              <div className="playlist-actions">
                <button
                  type="button"
                  className="icon-btn tiny"
                  aria-label={`Move ${item.displayName} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn tiny"
                  aria-label={`Move ${item.displayName} down`}
                  disabled={index === count - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn tiny"
                  aria-label={`Remove ${item.displayName}`}
                  onClick={() => void dispatch({ type: "remove_playlist_item", index })}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <footer className="settings-panel-foot">
        <button type="button" className="text-btn" onClick={() => void addFiles()}>
          Add files…
        </button>
        <button
          type="button"
          className="text-btn"
          disabled={count === 0}
          onClick={() => void dispatch({ type: "clear_playlist" })}
        >
          Clear queue
        </button>
      </footer>
    </div>
  );
}
