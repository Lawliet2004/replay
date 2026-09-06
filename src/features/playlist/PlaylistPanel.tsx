import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { pickMediaFiles } from "../../lib/mediaPicker";
import { dispatch, shallowEqual, usePlayerSnapshot } from "../player/store";
import { formatTime } from "../player/time";
import { useToasts } from "../../components/useToasts";
import { Icon } from "../../components/icons";

function EmptyQueueArt() {
  return (
    <svg className="playlist-empty-art" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
      <rect
        x="10"
        y="14"
        width="76"
        height="48"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <line
        x1="10"
        y1="26"
        x2="86"
        y2="26"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <circle cx="22" cy="20" r="1.5" fill="currentColor" opacity="0.7" />
      <circle cx="30" cy="20" r="1.5" fill="currentColor" opacity="0.7" />
      <circle cx="38" cy="20" r="1.5" fill="currentColor" opacity="0.7" />
      <line
        x1="20"
        y1="40"
        x2="62"
        y2="40"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="20"
        y1="50"
        x2="50"
        y2="50"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}

function fileExt(path: string): string | null {
  const i = path.lastIndexOf(".");
  return i > 0 ? path.slice(i + 1).toUpperCase() : null;
}

export function PlaylistPanel() {
  const { items, currentIndex } = usePlayerSnapshot(
    (s) => ({ items: s.playlist.items, currentIndex: s.playlist.currentIndex }),
    shallowEqual,
  );
  const count = items.length;
  const totalSecs = items.reduce(
    (sum, i) => (typeof i.durationSecs === "number" ? sum + i.durationSecs : sum),
    0,
  );
  const toasts = useToasts();
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  // Scroll the active track into view when it changes.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  useEffect(() => {
    if (menuIndex == null) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuIndex(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuIndex(null);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuIndex]);

  async function addFiles() {
    const paths = await pickMediaFiles();
    if (!paths?.length) return;
    await dispatch({ type: "open_paths", paths, replace: false });
  }

  function clearQueue() {
    if (count === 0) return;
    const snapshot = items.map((i) => i.path);
    void dispatch({ type: "clear_playlist" });
    toasts.show(`Cleared ${snapshot.length} item${snapshot.length === 1 ? "" : "s"}`, {
      intent: "action",
      action: {
        label: "Undo",
        onClick: () => {
          if (snapshot.length === 0) return;
          void dispatch({ type: "open_paths", paths: snapshot, replace: true });
        },
      },
    });
  }

  function removeItem(index: number) {
    const item = items[index];
    if (!item) return;
    const restoreIndex = index;
    void dispatch({ type: "remove_playlist_item", index });
    setMenuIndex(null);
    toasts.show(`Removed ${item.displayName}`, {
      intent: "action",
      action: {
        label: "Undo",
        onClick: () => {
          // Reinsert at the old position: rebuild the queue around the removal.
          const without = items.filter((_, i) => i !== index).map((i) => i.path);
          const paths = [
            ...without.slice(0, restoreIndex),
            item.path,
            ...without.slice(restoreIndex),
          ];
          void dispatch({ type: "open_paths", paths, replace: true });
        },
      },
    });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= count || to === from) return;
    void dispatch({ type: "reorder_playlist", from, to });
    setMenuIndex(null);
  }

  function onDragStart(index: number) {
    return (e: DragEvent<HTMLButtonElement>) => {
      dragOriginRef.current = index;
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      // Some browsers require non-empty data to start a drag.
      e.dataTransfer.setData("text/plain", String(index));
    };
  }

  function onDragOver(index: number) {
    return (e: DragEvent<HTMLLIElement>) => {
      if (dragIndex == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropIndex !== index) setDropIndex(index);
    };
  }

  function onDragLeave(index: number) {
    return () => {
      if (dropIndex === index) setDropIndex(null);
    };
  }

  function onDrop(index: number) {
    return (e: DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      const from = dragOriginRef.current;
      dragOriginRef.current = null;
      setDragIndex(null);
      setDropIndex(null);
      if (from == null) return;
      move(from, index);
    };
  }

  function onDragEnd() {
    dragOriginRef.current = null;
    setDragIndex(null);
    setDropIndex(null);
  }

  function focusedIndex(target: HTMLElement, list: HTMLUListElement | null): number {
    if (!list) return 0;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>(".playlist-item"));
    const idx = rows.findIndex((r) => r === target);
    return idx >= 0 ? idx : 0;
  }

  function focusRow(index: number) {
    const clamped = Math.max(0, Math.min(count - 1, index));
    listRef.current?.querySelectorAll<HTMLButtonElement>(".playlist-item")[clamped]?.focus();
  }

  // Roving focus: Arrow/Home/End move between rows' play buttons.
  function onListKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.altKey) return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains("playlist-item")) return;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = focusedIndex(target, listRef.current) + 1;
    else if (e.key === "ArrowUp") next = focusedIndex(target, listRef.current) - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next == null) return;
    e.preventDefault();
    focusRow(next);
  }

  return (
    <div className="settings-panel-block playlist-panel">
      {count === 0 ? (
        <div className="playlist-empty" role="status">
          <EmptyQueueArt />
          <p className="playlist-empty-title">Queue is empty</p>
          <p className="playlist-empty-hint">
            Add files without interrupting playback. They will start after the current track.
          </p>
          <button
            type="button"
            className="primary playlist-empty-cta"
            onClick={() => void addFiles()}
          >
            <Icon name="plus" />
            <span>Add files</span>
          </button>
        </div>
      ) : (
        <>
          <ul className="playlist" ref={listRef} onKeyDown={onListKeyDown}>
            {items.map((item, index) => {
              const active = currentIndex === index;
              const menuOpen = menuIndex === index;
              const dropping = dropIndex === index && dragIndex !== null && dragIndex !== index;
              const dragging = dragIndex === index;
              const ext = fileExt(item.path);
              const durationLabel =
                item.durationSecs != null && item.durationSecs > 0
                  ? formatTime(item.durationSecs)
                  : null;
              return (
                <li
                  key={item.id}
                  ref={active ? activeRowRef : undefined}
                  className={[
                    active ? "active" : "",
                    dropping ? "drop-target" : "",
                    dragging ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={active ? "true" : undefined}
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onDragOver={onDragOver(index)}
                  onDragLeave={onDragLeave(index)}
                  onDrop={onDrop(index)}
                >
                  <button
                    type="button"
                    className="playlist-drag-handle"
                    aria-label={`Reorder ${item.displayName}`}
                    draggable
                    onDragStart={onDragStart(index)}
                    onDragEnd={onDragEnd}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Icon name="drag-handle" size="sm" />
                  </button>
                  <button
                    type="button"
                    className="playlist-item"
                    aria-label={`Play ${item.displayName}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => void dispatch({ type: "play_index", index })}
                    onKeyDown={(e) => {
                      // Alt+ArrowUp / Alt+ArrowDown reorder without touching focus.
                      if (e.altKey) {
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          move(index, index - 1);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          move(index, index + 1);
                        }
                        return;
                      }
                      if (e.key === "Delete") {
                        e.preventDefault();
                        removeItem(index);
                      }
                    }}
                    title={item.displayName}
                  >
                    <span className="idx">{index + 1}</span>
                    <span className="name">{item.displayName}</span>
                    {ext ? (
                      <span
                        className="playlist-ext"
                        style={{
                          color: "var(--muted)",
                          fontSize: "0.6rem",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          flexShrink: 0,
                        }}
                      >
                        {ext}
                      </span>
                    ) : null}
                    {active ? <span className="now-playing-tag">Now playing</span> : null}
                    <span className="duration mono">{durationLabel ?? "–"}</span>
                  </button>
                  {hoverIndex === index ? (
                    <button
                      type="button"
                      className="icon-btn tiny playlist-remove"
                      aria-label={`Remove ${item.displayName}`}
                      tabIndex={-1}
                      onMouseEnter={() => setHoverIndex(index)}
                      onMouseLeave={() => setHoverIndex(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(index);
                      }}
                      style={{
                        position: "absolute",
                        top: "0.1rem",
                        right: "0.15rem",
                        width: "1.35rem",
                        height: "1.35rem",
                        color: "var(--muted)",
                        zIndex: 2,
                      }}
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  ) : null}
                  <div className="playlist-actions" ref={menuOpen ? menuRef : undefined}>
                    <button
                      type="button"
                      className="icon-btn playlist-menu-btn"
                      aria-label={`Actions for ${item.displayName}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuIndex(menuOpen ? null : index);
                      }}
                    >
                      <Icon name="menu" />
                    </button>
                    {menuOpen ? (
                      <div className="playlist-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === 0}
                          onClick={() => move(index, 0)}
                        >
                          Move to top
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === 0}
                          onClick={() => move(index, index - 1)}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === count - 1}
                          onClick={() => move(index, index + 1)}
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={index === count - 1}
                          onClick={() => move(index, count - 1)}
                        >
                          Move to bottom
                        </button>
                        <button type="button" role="menuitem" onClick={() => removeItem(index)}>
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <footer className="settings-panel-foot playlist-foot">
            <span
              className="playlist-summary"
              style={{ color: "var(--muted)", fontSize: "0.78rem", alignSelf: "center" }}
            >
              {count} item{count === 1 ? "" : "s"} · {formatTime(totalSecs)}
            </span>
            <button type="button" className="text-btn" onClick={() => void addFiles()}>
              <Icon name="plus" />
              <span>Add files</span>
            </button>
            <button type="button" className="text-btn" onClick={clearQueue}>
              <Icon name="trash" />
              <span>Clear queue</span>
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
