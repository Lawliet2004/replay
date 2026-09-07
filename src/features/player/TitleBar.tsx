import { forwardRef, useCallback, useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ReplayLogo } from "../../assets/ReplayLogo";
import { isAndroidPlatform } from "../../lib/platform";
import { Icon } from "../../components/icons";
import { useToasts } from "../../components/useToasts";

/** Custom transparent title bar — visible with chrome, never in fullscreen. */
export const TitleBar = forwardRef<
  HTMLDivElement,
  { visible: boolean; mediaTitle?: string | null }
>(function TitleBar({ visible, mediaTitle }, ref) {
  const [maximized, setMaximized] = useState(false);
  const { show } = useToasts();
  const runWindowAction = useCallback(
    async (action: "minimize" | "toggleMaximize" | "close" | "startDragging") => {
      try {
        const win = getCurrentWindow();
        await win[action]();
        if (action === "toggleMaximize") setMaximized(await win.isMaximized());
      } catch {
        show("Couldn't update the window. Please try again.", { intent: "error" });
      }
    },
    [show],
  );

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
      void un.then((f) => f()).catch(() => {});
    };
  }, []);

  const onDrag = useCallback(
    (e: MouseEvent) => {
      if (isAndroidPlatform() || e.buttons !== 1) return;
      if (e.detail === 2) {
        void runWindowAction("toggleMaximize");
        return;
      }
      void runWindowAction("startDragging");
    },
    [runWindowAction],
  );

  return (
    <div
      ref={ref}
      className={`titlebar ${visible ? "visible" : ""}`}
      role="banner"
      // Don't aria-hide the whole bar; the window controls inside stay
      // keyboard-reachable while the bar is visually hidden (windowed). In
      // fullscreen the TitleBar is unmounted entirely.
    >
      <div className="titlebar-drag" onMouseDown={onDrag} aria-hidden={!visible}>
        <div className="titlebar-brand">
          <span className="titlebar-mark" aria-hidden="true">
            <ReplayLogo size={18} className="titlebar-logo" />
          </span>
          <span className="titlebar-name">Replay</span>
          {mediaTitle ? (
            <span className="titlebar-media" title={mediaTitle}>
              {mediaTitle}
            </span>
          ) : null}
        </div>
        <div className="titlebar-spacer" />
      </div>
      <div className="titlebar-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void runWindowAction("minimize")}
        >
          <Icon name="minus" size="sm" />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore window" : "Maximize"}
          onClick={() => void runWindowAction("toggleMaximize")}
        >
          {maximized ? <Icon name="restore" size="sm" /> : <Icon name="maximize" size="sm" />}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          aria-label="Close"
          title="Close Replay"
          onClick={() => void runWindowAction("close")}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
    </div>
  );
});
