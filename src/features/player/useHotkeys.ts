import { useEffect, useRef } from "react";
import { getSettings } from "../../lib/ipc";
import { dispatch, usePlayerSnapshot } from "./store";
import { togglePlayerFullscreen } from "./fullscreen";
import { showOsd } from "./osdBus";
import { stepSpeed } from "./speed";
import {
  getSeekStepSecs,
  seekHoldMultiplier,
  setSeekStepSecs,
  subscribeSeekStep,
} from "./seekPrefs";

export type ShortcutInfo = {
  key: string;
  label: string;
  group: string;
};

/** The keyboard shortcuts handled by `usePlayerHotkeys` (single source for the help panel). */
export const SHORTCUTS: ShortcutInfo[] = [
  { key: "Space / K", label: "Play / Pause", group: "Playback" },
  { key: "J / L", label: "Seek by step (Settings)", group: "Playback" },
  { key: "← / →", label: "Seek by step · hold to accelerate", group: "Playback" },
  { key: ", / .", label: "Step one frame back / forward", group: "Playback" },
  { key: "[ / ]", label: "Speed down / up", group: "Playback" },
  { key: "R", label: "Cycle repeat mode", group: "Playback" },
  { key: "N / P", label: "Next / Previous", group: "Playback" },
  { key: "↑ / ↓", label: "Volume ±5", group: "Audio" },
  { key: "M", label: "Mute", group: "Audio" },
  { key: "F", label: "Fullscreen", group: "View" },
  { key: "O", label: "Open files", group: "View" },
  { key: "/", label: "Peek chrome", group: "View" },
  { key: "?", label: "Toggle shortcuts help", group: "View" },
  { key: "Esc", label: "Exit fullscreen / close panels", group: "View" },
];

export function usePlayerHotkeys(opts: {
  onHelp: () => void;
  onOpen: () => void;
  onEscape: () => void;
  /** Briefly show the chrome (for keyboard users peeking at the time/scrubber). */
  onPeekChrome?: () => void;
  /** Trigger the center play/pause flash (used to mirror the surface click). */
  onFlashPlayback?: (kind: "play" | "pause") => void;
}) {
  const snap = usePlayerSnapshot(
    (s) => ({
      volume: s.volume,
      muted: s.muted,
      fullscreen: s.fullscreen,
      repeat: s.playlist.repeat,
      phase: s.phase,
      speed: s.speed,
      fps: s.metadata?.fps ?? null,
    }),
    (a, b) =>
      a.volume === b.volume &&
      a.muted === b.muted &&
      a.fullscreen === b.fullscreen &&
      a.repeat === b.repeat &&
      a.phase === b.phase &&
      a.speed === b.speed &&
      a.fps === b.fps,
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Let arrow keys fall through to native range-input behavior so the
      // user can fine-scrub by ±0.01s; everything else stays blocked.
      if (
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (tag === "INPUT" && target instanceof HTMLInputElement && target.type !== "range") ||
        target?.isContentEditable
      ) {
        return;
      }
      // Space on a focused button must keep its native activation.
      if (e.key === " " && target instanceof Element && target.closest("button")) return;
      // Block platform-reserved combos (Cmd+Q/W, Ctrl+W, Alt+F4, etc.) and
      // ensure an open IME swallows our shortcuts instead of seeking.
      // Shift alone is allowed for the "?" help shortcut.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || e.keyCode === 229) return;

      const key = e.key.toLowerCase();
      const o = optsRef.current;
      const s = snapRef.current;

      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        o.onHelp();
        return;
      }
      if (key === "/" && o.onPeekChrome) {
        e.preventDefault();
        o.onPeekChrome();
        return;
      }
      if (key === "escape") {
        o.onEscape();
        return;
      }
      if (key === " " || key === "k") {
        if (e.repeat) return;
        e.preventDefault();
        const wasPlaying = s.phase === "playing";
        void dispatch({ type: "toggle_pause" });
        o.onFlashPlayback?.(wasPlaying ? "pause" : "play");
        return;
      }

      const step = getSeekStepSecs();

      if (key === "j") {
        void dispatch({ type: "seek", position_secs: -step, absolute: false });
        showOsd("seek", `-${step}s`);
        return;
      }
      if (key === "l") {
        void dispatch({ type: "seek", position_secs: step, absolute: false });
        showOsd("seek", `+${step}s`);
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
        showOsd("seek", `${dir > 0 ? "+" : "-"}${step * mult}s`);
        return;
      }
      if (key === "arrowup") {
        e.preventDefault();
        const volume = Math.min(100, s.volume + 5);
        void dispatch({ type: "set_volume", volume });
        showOsd("volume", volume);
      } else if (key === "arrowdown") {
        e.preventDefault();
        const volume = Math.max(0, s.volume - 5);
        void dispatch({ type: "set_volume", volume });
        showOsd("volume", volume);
      } else if (key === "m") {
        e.preventDefault();
        void dispatch({ type: "set_muted", muted: !s.muted });
        showOsd("mute");
      } else if (key === "[") {
        e.preventDefault();
        const speed = stepSpeed(s.speed, -1);
        void dispatch({ type: "set_speed", speed });
        showOsd("speed", speed.toFixed(2));
      } else if (key === "]") {
        e.preventDefault();
        const speed = stepSpeed(s.speed, 1);
        void dispatch({ type: "set_speed", speed });
        showOsd("speed", speed.toFixed(2));
      } else if (key === "r") {
        e.preventDefault();
        // Cycle repeat mode: off → one → all → off.
        const order = ["off", "one", "all"] as const;
        const next = order[(order.indexOf(s.repeat) + 1) % order.length];
        void dispatch({ type: "set_repeat", mode: next });
      } else if (key === "f") {
        e.preventDefault();
        void togglePlayerFullscreen(s.fullscreen);
      } else if (key === "n") {
        e.preventDefault();
        void dispatch({ type: "next" });
      } else if (key === "p") {
        e.preventDefault();
        void dispatch({ type: "previous" });
      } else if (key === "o") {
        o.onOpen();
      } else if (key === ",") {
        const frame = 1 / (s.fps ?? 25);
        void dispatch({ type: "seek", position_secs: -frame, absolute: false });
      } else if (key === ".") {
        const frame = 1 / (s.fps ?? 25);
        void dispatch({ type: "seek", position_secs: frame, absolute: false });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowleft" || key === "arrowright") {
        delete arrowHoldStarted.current[key];
      }
    };

    const onBlur = () => {
      arrowHoldStarted.current = {};
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
