import { useEffect, useRef } from "react";
import { getSettings } from "../../lib/ipc";
import { dispatch, usePlayerSnapshot } from "./store";
import { togglePlayerFullscreen } from "./fullscreen";
import {
  getSeekStepSecs,
  seekHoldMultiplier,
  setSeekStepSecs,
  subscribeSeekStep,
} from "./seekPrefs";

export function usePlayerHotkeys(opts: {
  onHelp: () => void;
  onOpen: () => void;
  onEscape: () => void;
}) {
  const snap = usePlayerSnapshot(
    (s) => ({ volume: s.volume, muted: s.muted, fullscreen: s.fullscreen }),
    (a, b) => a.volume === b.volume && a.muted === b.muted && a.fullscreen === b.fullscreen,
  );
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const arrowHoldStarted = useRef<Partial<Record<"arrowleft" | "arrowright", number>>>({});

  useEffect(() => {
    void getSettings()
      .then((s) => setSeekStepSecs(s.seekStepSecs))
      .catch(() => {});
    return subscribeSeekStep(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();
      const o = optsRef.current;
      const s = snapRef.current;

      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        o.onHelp();
        return;
      }
      if (key === "escape") {
        o.onEscape();
        return;
      }
      if (key === " " || key === "k") {
        e.preventDefault();
        void dispatch({ type: "toggle_pause" });
        return;
      }

      const step = getSeekStepSecs();

      if (key === "j") {
        void dispatch({ type: "seek", position_secs: -step, absolute: false });
        return;
      }
      if (key === "l") {
        void dispatch({ type: "seek", position_secs: step, absolute: false });
        return;
      }
      if (key === "arrowleft" || key === "arrowright") {
        e.preventDefault();
        const dir = key === "arrowleft" ? -1 : 1;
        const now = performance.now();
        if (!e.repeat || arrowHoldStarted.current[key] == null) {
          arrowHoldStarted.current[key] = now;
        }
        const heldMs = now - (arrowHoldStarted.current[key] ?? now);
        const mult = seekHoldMultiplier(heldMs);
        const delta = dir * step * mult;
        void dispatch({ type: "seek", position_secs: delta, absolute: false });
        return;
      }
      if (key === "arrowup") {
        e.preventDefault();
        void dispatch({ type: "set_volume", volume: Math.min(100, s.volume + 5) });
      } else if (key === "arrowdown") {
        e.preventDefault();
        void dispatch({ type: "set_volume", volume: Math.max(0, s.volume - 5) });
      } else if (key === "m") {
        void dispatch({ type: "set_muted", muted: !s.muted });
      } else if (key === "f") {
        e.preventDefault();
        void togglePlayerFullscreen(s.fullscreen);
      } else if (key === "n") {
        void dispatch({ type: "next" });
      } else if (key === "p") {
        void dispatch({ type: "previous" });
      } else if (key === "o") {
        o.onOpen();
      } else if (key === ",") {
        void dispatch({ type: "seek", position_secs: -0.04, absolute: false });
      } else if (key === ".") {
        void dispatch({ type: "seek", position_secs: 0.04, absolute: false });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowleft" || key === "arrowright") {
        delete arrowHoldStarted.current[key];
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
