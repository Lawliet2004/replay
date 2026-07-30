import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dispatch, usePlayerSnapshot } from "./store";

export function usePlayerHotkeys(opts: {
  onHelp: () => void;
  onOpen: () => void;
  onEscape: () => void;
}) {
  const snap = usePlayerSnapshot();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();
      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        opts.onHelp();
        return;
      }
      if (key === "escape") {
        opts.onEscape();
        return;
      }
      if (key === " " || key === "k") {
        e.preventDefault();
        void dispatch({ type: "toggle_pause" });
      } else if (key === "j") {
        void dispatch({ type: "seek", position_secs: -10, absolute: false });
      } else if (key === "l") {
        void dispatch({ type: "seek", position_secs: 10, absolute: false });
      } else if (key === "arrowleft") {
        void dispatch({ type: "seek", position_secs: -5, absolute: false });
      } else if (key === "arrowright") {
        void dispatch({ type: "seek", position_secs: 5, absolute: false });
      } else if (key === "arrowup") {
        e.preventDefault();
        void dispatch({ type: "set_volume", volume: Math.min(100, snap.volume + 5) });
      } else if (key === "arrowdown") {
        e.preventDefault();
        void dispatch({ type: "set_volume", volume: Math.max(0, snap.volume - 5) });
      } else if (key === "m") {
        void dispatch({ type: "set_muted", muted: !snap.muted });
      } else if (key === "f") {
        void (async () => {
          const win = getCurrentWindow();
          const next = !snap.fullscreen;
          await win.setFullscreen(next);
          await dispatch({ type: "set_fullscreen", fullscreen: next });
        })();
      } else if (key === "n") {
        void dispatch({ type: "next" });
      } else if (key === "p") {
        void dispatch({ type: "previous" });
      } else if (key === "o") {
        opts.onOpen();
      } else if (key === "s") {
        void dispatch({ type: "stop" });
      } else if (key === ",") {
        void dispatch({ type: "seek", position_secs: -0.04, absolute: false });
      } else if (key === ".") {
        void dispatch({ type: "seek", position_secs: 0.04, absolute: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, snap.fullscreen, snap.muted, snap.volume]);
}
