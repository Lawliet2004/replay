import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ReplayLogo } from "../../assets/ReplayLogo";

/** Custom transparent title bar — visible with chrome, never in fullscreen. */
export function TitleBar({ visible }: { visible: boolean }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    const sync = async () => {
      try {
        const m = await win.isMaximized();
        if (!cancelled) setMaximized(m);
      } catch {
        /* ignore */
      }
    };
    void sync();
    const un = win.onResized(() => void sync());
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);

  const onDrag = useCallback((e: MouseEvent) => {
    if (e.buttons !== 1) return;
    const win = getCurrentWindow();
    if (e.detail === 2) {
      void win.toggleMaximize();
      return;
    }
    void win.startDragging();
  }, []);

  return (
    <div
      className={`titlebar ${visible ? "visible" : ""}`}
      onMouseDown={onDrag}
      role="banner"
      aria-hidden={!visible}
    >
      <div className="titlebar-brand">
        <span className="titlebar-mark" aria-hidden="true">
          <ReplayLogo size={18} className="titlebar-logo" />
        </span>
        <span className="titlebar-name">Replay</span>
      </div>
      <div className="titlebar-spacer" />
      <div className="titlebar-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Minimize"
          onClick={() => void getCurrentWindow().minimize()}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1.75 6h8.5" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3.25 4.25h4.5v4.5h-4.5zM4.5 3h4.5v1.25M9 3v4.5h-1.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="2.35"
                y="2.35"
                width="7.3"
                height="7.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.15"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          aria-label="Close"
          onClick={() => void getCurrentWindow().close()}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.75 2.75l6.5 6.5M9.25 2.75l-6.5 6.5"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
