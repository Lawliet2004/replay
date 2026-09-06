import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ReplayLogo } from "./assets/ReplayLogo";
import { pickMediaFiles } from "./lib/mediaPicker";
import { FullscreenCloseButton, PlayerControls } from "./features/player/PlayerControls";
import {
  PlaybackClickFeedback,
  type PlaybackClickFlash,
  type PlaybackClickKind,
} from "./features/player/PlaybackClickFeedback";
import { usePlayerHotkeys } from "./features/player/useHotkeys";
import { TitleBar } from "./features/player/TitleBar";
import {
  dispatch,
  shallowEqual,
  startPlayerStore,
  usePlayerSnapshot,
} from "./features/player/store";
import { SettingsPopup, type SettingsView } from "./features/settings/SettingsPopup";
import {
  CHROME_RESERVE_PX,
  circularCutoutFromRect,
  cutoutFromRect,
  FULLSCREEN_CLOSE_CUTOUT_PAD_PX,
  FULLSCREEN_CLOSE_RESERVE_PX,
  hostPunchesOverlayHoles,
  NO_CUTOUT,
  OVERLAY_CUTOUT_PAD_PX,
  padRect,
  TITLEBAR_RESERVE_PX,
} from "./features/player/chromeAutoHide";
import { useChromeAutoHide } from "./features/player/useChromeAutoHide";
import { useFullscreenClose } from "./features/player/useFullscreenClose";
import { setPlayerFullscreen } from "./features/player/fullscreen";
import { getSettings } from "./lib/ipc";
import type { MediaItem } from "./generated/player";
import { MEDIA_EXTENSIONS } from "./lib/mediaPicker";
import { setSeekStepSecs } from "./features/player/seekPrefs";
import { isFullscreenCloseHit, isSurfaceClickIgnored } from "./features/player/surfaceClick";
import { detectAppPlatform } from "./lib/platform";
import { Icon } from "./components/icons";
import { useToasts } from "./components/useToasts";
import { subscribeOsd, type OsdMessage } from "./features/player/osdBus";
import { setDispatchErrorHandler } from "./features/player/store";
import "./styles/app.css";

const ERROR_COPY: Record<string, string> = {
  invalid_path: "Invalid file path",
  url_rejected: "Web links aren't supported — open a local file",
  file_not_found: "File not found — it may have been moved or deleted",
  unsupported_media: "Unsupported format — Replay can't play this file",
  codec_failure: "Couldn't decode this file",
  engine_missing: "Playback engine unavailable — try restarting the app",
  engine_init: "Playback engine failed to start — try restarting the app",
  render_host: "Video surface error — try restarting the app",
  playlist_bounds: "No track in that direction",
  settings_corrupt: "Settings file was unreadable and has been reset",
  command_rejected: "The player rejected that action",
  internal: "Something went wrong",
};

function errorHeadline(code: string | undefined): string {
  return (code && ERROR_COPY[code]) || "Something went wrong";
}

function osdText(msg: OsdMessage): string {
  switch (msg.kind) {
    case "volume":
      return `Volume ${Math.round(Number(msg.value ?? 0))}%`;
    case "mute":
      return "Muted";
    case "speed":
      return `${msg.value}×`;
    default:
      return String(msg.value ?? "");
  }
}

export default function App() {
  const snap = usePlayerSnapshot(
    (s) => ({
      current: s.current,
      phase: s.phase,
      fullscreen: s.fullscreen,
      error: s.error,
    }),
    shallowEqual,
  );
  const { show: showToast } = useToasts();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("root");
  const settingsViewRef = useRef<SettingsView>("root");
  const [clickFlash, setClickFlash] = useState<PlaybackClickFlash | null>(null);
  /** True while a file drag is hovering over the window. */
  const [isDragOver, setIsDragOver] = useState(false);
  /** File count of the in-flight drag, for the drop hint pill. */
  const dragCountRef = useRef(0);
  /** Most recent files, fetched once on mount. */
  const [recents, setRecents] = useState<MediaItem[]>([]);
  /** Tracks the most recently dismissed error so the banner stays hidden
   *  until the backend emits a new error (different correlationId). */
  const [dismissedErrorId, setDismissedErrorId] = useState<string | null>(null);
  const errorVisible = Boolean(snap.error) && snap.error?.correlationId !== dismissedErrorId;

  const hasMedia = Boolean(snap.current) && snap.phase !== "idle" && snap.phase !== "error";
  const overlayOpen = settingsOpen;

  const { chromeVisible, bumpActivity, setHoveringChrome, forceHideUntilPointerLeave } =
    useChromeAutoHide({
      hasMedia,
      blockingUi: overlayOpen && !snap.fullscreen,
      phase: snap.phase,
    });
  const { closeVisible, setPointerY, setHoveringClose } = useFullscreenClose(snap.fullscreen);

  const dismissOverlays = useCallback(() => {
    setSettingsOpen(false);
    setSettingsView("root");
  }, []);

  const bumpRef = useRef(bumpActivity);
  bumpRef.current = bumpActivity;
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const titlebarRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const fsCloseRef = useRef<HTMLDivElement | null>(null);
  const lastHostRef = useRef<string>("");
  /** Last known bounds of the windowed chrome (CSS px). Used to swallow clicks
   *  on the hidden gear/settings/buttons so they don't toggle playback. */
  const chromeRectRef = useRef<DOMRect | null>(null);
  const syncHostRef = useRef<() => void>(() => {});
  const chromeVisibleRef = useRef(chromeVisible);
  chromeVisibleRef.current = chromeVisible;
  const phaseRef = useRef(snap.phase);
  phaseRef.current = snap.phase;
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const dismissOverlaysRef = useRef(dismissOverlays);
  dismissOverlaysRef.current = dismissOverlays;
  const fullscreenRef = useRef(snap.fullscreen);
  fullscreenRef.current = snap.fullscreen;
  const setPointerYRef = useRef(setPointerY);
  setPointerYRef.current = setPointerY;
  const flashTokenRef = useRef(0);
  const flashPlayback = useCallback((kind: PlaybackClickKind) => {
    flashTokenRef.current += 1;
    setClickFlash({ kind, token: flashTokenRef.current });
  }, []);
  /** Paths of the most recent open (for the banner Retry button). */
  const lastOpenPathsRef = useRef<string[]>([]);
  const recentsFetchFailedRef = useRef(false);

  // Reduced-motion: the CSS fill-mode animation may be disabled, so clear the
  // flash explicitly instead of relying on animationend.
  useEffect(() => {
    if (!clickFlash) return;
    const t = window.setTimeout(() => setClickFlash(null), 650);
    return () => window.clearTimeout(t);
  }, [clickFlash]);

  // Route store dispatch rejections to toasts (call sites are `void dispatch`).
  useEffect(() => {
    setDispatchErrorHandler((err) => {
      showToast(`Player command failed: ${err instanceof Error ? err.message : String(err)}`, {
        intent: "error",
      });
    });
    return () => setDispatchErrorHandler(null);
  }, [showToast]);

  // Recents go stale after playback; re-fetch whenever we return to idle.
  const loadRecents = useCallback(() => {
    void getSettings()
      .then((s) => {
        setSeekStepSecs(s.seekStepSecs);
        setRecents(s.recent.slice(0, 6));
      })
      .catch(() => {
        if (!recentsFetchFailedRef.current) {
          recentsFetchFailedRef.current = true;
          showToast("Couldn't load recent files", { intent: "error" });
        }
      });
  }, [showToast]);
  useEffect(() => {
    if (snap.phase === "idle") loadRecents();
  }, [snap.phase, loadRecents]);

  // Loading: hide the HWND_TOP host so HTML banners are visible.
  // Settings uses a measured overlay hole so video keeps playing around it.
  const punchesOverlayHoles = hostPunchesOverlayHoles();
  const hostBlocked = snap.phase === "loading";
  // Title bar: always when idle; with chrome when media; never in fullscreen.
  const titlebarVisible = !snap.fullscreen && (!hasMedia || chromeVisible);
  const windowedChromeVisible = hasMedia && chromeVisible && !hostBlocked && !snap.fullscreen;
  const fullscreenCloseReady = hasMedia && snap.fullscreen && !hostBlocked;
  const chromeBottomLogical = windowedChromeVisible ? CHROME_RESERVE_PX : 0;
  const chromeTopLogical =
    titlebarVisible && hasMedia && !hostBlocked
      ? TITLEBAR_RESERVE_PX
      : fullscreenCloseReady && closeVisible && !punchesOverlayHoles
        ? FULLSCREEN_CLOSE_RESERVE_PX
        : 0;
  const menuCutoutActive =
    hasMedia &&
    !hostBlocked &&
    ((settingsOpen && !snap.fullscreen) ||
      (snap.fullscreen && closeVisible && punchesOverlayHoles));
  const chromeReserve = windowedChromeVisible ? CHROME_RESERVE_PX : 0;
  const titlebarReserve = titlebarVisible && hasMedia ? TITLEBAR_RESERVE_PX : 0;

  useEffect(() => {
    void startPlayerStore();
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    const syncFs = async () => {
      try {
        const fs = await win.isFullscreen();
        if (!cancelled && fs !== snap.fullscreen) {
          await dispatch({ type: "set_fullscreen", fullscreen: fs });
        }
      } catch {
        /* ignore */
      }
    };
    const unResize = win.onResized(() => {
      void syncFs();
      window.dispatchEvent(new Event("resize"));
    });
    void syncFs();
    return () => {
      cancelled = true;
      void unResize.then((f) => f());
    };
  }, [snap.fullscreen]);

  // Entering fullscreen: drop the windowed bars. The close chip waits for a
  // top-edge pointer move (YouTube/Chrome). Exiting restores windowed chrome.
  const prevFullscreenRef = useRef(snap.fullscreen);
  useEffect(() => {
    const was = prevFullscreenRef.current;
    prevFullscreenRef.current = snap.fullscreen;
    if (snap.fullscreen === was) return;
    if (snap.fullscreen) {
      forceHideUntilPointerLeave();
      dismissOverlays();
    } else {
      bumpRef.current();
    }
  }, [snap.fullscreen, forceHideUntilPointerLeave, dismissOverlays]);

  const openFiles = useCallback(async () => {
    const paths = await pickMediaFiles();
    if (!paths?.length) return;
    lastOpenPathsRef.current = paths;
    await dispatch({ type: "open_paths", paths, replace: true });
  }, []);

  /** Split dropped paths into playable vs skipped; toast the skips. */
  const filterDroppedPaths = useCallback(
    (raw: string[]): { playable: string[]; skipped: number; urls: boolean } => {
      const urls = raw.filter((p) => p.includes("://"));
      const rest = raw.filter((p) => !p.includes("://"));
      const playable = rest.filter((p) => {
        const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
        return MEDIA_EXTENSIONS.includes(ext);
      });
      const skipped = rest.length - playable.length;
      if (skipped > 0) {
        showToast(`Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}`, {
          intent: "info",
        });
      }
      if (rest.length > 0 && playable.length === 0 && urls.length === 0 && skipped > 0) {
        showToast("No playable files in that drop", { intent: "info" });
      }
      return { playable, skipped, urls: urls.length > 0 };
    },
    [showToast],
  );

  usePlayerHotkeys({
    onHelp: () => {
      if (snap.fullscreen) return;
      bumpRef.current();
      if (settingsOpen && settingsViewRef.current === "shortcuts") {
        settingsViewRef.current = "root";
        setSettingsOpen(false);
        setSettingsView("root");
        return;
      }
      settingsViewRef.current = "shortcuts";
      setSettingsView("shortcuts");
      setSettingsOpen(true);
    },
    onOpen: () => void openFiles(),
    onPeekChrome: () => {
      // `/` reveals the chrome for ~1s; the auto-hide timer will fade it
      // back out. Only useful when the windowed chrome would actually be
      // visible (i.e., not in fullscreen and there is media).
      if (snap.fullscreen || !hasMedia) return;
      bumpRef.current();
    },
    onFlashPlayback: (kind) => flashPlayback(kind),
    onEscape: () => {
      // Close the most-recently-opened overlay first (settings), then exit
      // fullscreen. The SettingsPopup handles its own sub-view Escape chain.
      if (settingsOpen) {
        setSettingsOpen(false);
        setSettingsView("root");
        return;
      }
      if (snap.fullscreen) {
        void setPlayerFullscreen(false);
      }
    },
  });

  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const raw = event.payload.paths;
        const urlCount = raw.filter((p) => p.includes("://")).length;
        const localCount = raw.length - urlCount;
        if (urlCount > 0 && localCount === 0) {
          showToast("Links aren't supported — drop local files instead", { intent: "info" });
        } else {
          const { playable } = filterDroppedPaths(raw);
          if (playable.length) {
            // Drop APPENDS to the queue so a single file never wipes a long
            // playlist. Modifier-keyed "replace" is a future enhancement.
            void dispatch({ type: "open_paths", paths: playable, replace: false });
          }
        }
        setIsDragOver(false);
        dragCountRef.current = 0;
      } else if (event.payload.type === "enter" || event.payload.type === "over") {
        if (event.payload.type === "enter") {
          dragCountRef.current = Math.max(dragCountRef.current, event.payload.paths.length);
        }
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
        dragCountRef.current = 0;
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [showToast, filterDroppedPaths]);

  useEffect(() => {
    let raf = 0;
    const syncHost = () => {
      const dpr = window.devicePixelRatio || 1;
      const clientW = Math.max(1, Math.round(window.innerWidth * dpr));
      const clientH = Math.max(1, Math.round(window.innerHeight * dpr));
      const measuredChrome = chromeRef.current?.getBoundingClientRect().height;
      const measuredTitle = titlebarRef.current?.getBoundingClientRect().height;
      const measuredClose = fsCloseRef.current?.getBoundingClientRect();
      // Track the chrome rect (even when hidden) so the surface-click guard
      // can swallow clicks that would otherwise toggle playback on the spot
      // where a hidden button lives.
      const chromeEl = chromeRef.current;
      if (chromeEl) {
        chromeRectRef.current = chromeEl.getBoundingClientRect();
      }
      const chromeBottom =
        chromeBottomLogical > 0
          ? Math.round(
              (measuredChrome && measuredChrome > 0 ? measuredChrome : CHROME_RESERVE_PX) * dpr,
            )
          : 0;
      let chromeTop = 0;
      if (chromeTopLogical > 0) {
        if (snap.fullscreen) {
          const logical =
            measuredClose && measuredClose.height > 0
              ? Math.max(FULLSCREEN_CLOSE_RESERVE_PX, measuredClose.bottom)
              : FULLSCREEN_CLOSE_RESERVE_PX;
          chromeTop = Math.round(logical * dpr);
        } else {
          chromeTop = Math.round(
            (measuredTitle && measuredTitle > 0 ? measuredTitle : TITLEBAR_RESERVE_PX) * dpr,
          );
        }
      }
      const chromeRight = 0;
      // Settings hangs above the gear; the fullscreen close chip is a
      // free-floating hole. Both must be measured rather than derived from edges.
      const overlayEl =
        settingsOpen && !snap.fullscreen
          ? settingsPanelRef.current
          : snap.fullscreen && closeVisible
            ? fsCloseRef.current
            : null;
      const overlayRect = overlayEl?.getBoundingClientRect();
      const menu = menuCutoutActive
        ? snap.fullscreen
          ? circularCutoutFromRect(
              overlayRect,
              clientW,
              clientH,
              dpr,
              FULLSCREEN_CLOSE_CUTOUT_PAD_PX,
            )
          : cutoutFromRect(padRect(overlayRect, OVERLAY_CUTOUT_PAD_PX), clientW, clientH, dpr)
        : NO_CUTOUT;
      const hideHost = !hasMedia || hostBlocked;
      const payload = {
        type: "set_host_bounds" as const,
        width: clientW,
        height: hideHost ? 0 : clientH,
        chrome_bottom: chromeBottom,
        chrome_top: chromeTop,
        chrome_right: chromeRight,
        menu_x: menu.x,
        menu_y: menu.y,
        menu_w: menu.w,
        menu_h: menu.h,
      };
      const key = JSON.stringify(payload);
      if (key === lastHostRef.current) return;
      lastHostRef.current = key;
      void dispatch(payload);
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncHost);
    };
    syncHostRef.current = syncHost;
    syncHost();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [
    hasMedia,
    hostBlocked,
    chromeVisible,
    closeVisible,
    chromeBottomLogical,
    chromeTopLogical,
    menuCutoutActive,
    titlebarVisible,
    settingsOpen,
    snap.current?.path,
    snap.fullscreen,
    snap.phase,
  ]);

  // Chrome / title bar / settings popup resize (DPI, nested views) must re-cut the host.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncHostRef.current());
    const nodes = [
      chromeRef.current,
      titlebarRef.current,
      settingsPanelRef.current,
      fsCloseRef.current,
    ];
    for (const el of nodes) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [
    menuCutoutActive,
    settingsOpen,
    chromeVisible,
    closeVisible,
    titlebarVisible,
    snap.fullscreen,
  ]);

  // Brief chrome reveal when a file first loads — not on pause/play.
  useEffect(() => {
    if (hasMedia) bumpRef.current();
  }, [hasMedia]);

  // Native mouse hook drives reveal: the HWND_TOP video host swallows pointer
  // input, so window pointermove over the video is unreliable by design.
  // Surface clicks also arrive only via this hook (webview never sees them).
  // The host already drops unfocused / other-window clicks so play/pause does
  // not toggle when switching apps; do not re-gate on document.hasFocus() here
  // (force-foreground runs before this event arrives).
  useEffect(() => {
    type PointerPayload = { x: number; y: number; window_w: number; window_h: number };
    const unActivity = listen<PointerPayload>("player://activity", (ev) => {
      if (fullscreenRef.current) {
        const { y, window_h } = ev.payload ?? {};
        if (typeof y === "number" && typeof window_h === "number" && window_h > 0) {
          setPointerYRef.current(y * (window.innerHeight / window_h));
        }
        return;
      }
      bumpRef.current();
    });

    type SurfaceClickPayload = { x: number; y: number; window_w: number; window_h: number };
    const unCloseFs = listen("player://close-fullscreen", () => {
      void setPlayerFullscreen(false);
    });

    const unSurface = listen<SurfaceClickPayload>("player://surface-click", (ev) => {
      const phase = phaseRef.current;
      const phaseOk = phase === "playing" || phase === "paused";
      const overlay = overlayOpenRef.current;
      const { x, y, window_w, window_h } = ev.payload;
      // Map physical window-relative px → CSS client coords.
      const scaleX = window_w > 0 ? window.innerWidth / window_w : 1;
      const scaleY = window_h > 0 ? window.innerHeight / window_h : 1;
      const clientX = x * scaleX;
      const clientY = y * scaleY;
      const hit = document.elementFromPoint(clientX, clientY);
      // Native close overlay covers the HTML chip, so the button's onClick never
      // fires. Exit fullscreen here instead of treating it as a play/pause click.
      if (isFullscreenCloseHit(hit)) {
        void setPlayerFullscreen(false);
        return;
      }
      const ignored = isSurfaceClickIgnored(
        hit,
        chromeVisibleRef.current,
        clientX,
        clientY,
        chromeRectRef.current,
      );
      if (ignored) return;
      if (overlay) {
        dismissOverlaysRef.current();
        return;
      }
      if (!phaseOk) return;

      flashPlayback(phase === "playing" ? "pause" : "play");
      void dispatch({ type: "toggle_pause" });
    });

    return () => {
      void unActivity.then((f) => f());
      void unSurface.then((f) => f());
      void unCloseFs.then((f) => f());
    };
  }, [flashPlayback]);

  // Windowed: any motion reveals chrome. Fullscreen: only the top edge shows close.
  useEffect(() => {
    if (!hasMedia) return;
    const onMove = (e: PointerEvent) => {
      if (fullscreenRef.current) {
        setPointerYRef.current(e.clientY);
        return;
      }
      bumpRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (fullscreenRef.current) {
        setPointerYRef.current(e.clientY);
        return;
      }
      bumpRef.current();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [hasMedia, chromeVisible, titlebarVisible, snap.fullscreen]);

  // Keyboard focus inside hidden chrome must reveal it (otherwise users tab
  // into invisible controls).
  const onChromeFocusCapture = useCallback(() => {
    if (hasMedia && !snap.fullscreen) bumpRef.current();
  }, [hasMedia, snap.fullscreen]);

  // Idle hero: put focus on the primary CTA once, when nothing else is focused.
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const idleFocusDoneRef = useRef(false);
  useEffect(() => {
    if (hasMedia || snap.phase === "loading" || errorVisible) {
      idleFocusDoneRef.current = false;
      return;
    }
    if (idleFocusDoneRef.current) return;
    idleFocusDoneRef.current = true;
    const t = window.setTimeout(() => {
      if (document.activeElement === document.body) {
        openBtnRef.current?.focus();
      }
    }, 50);
    return () => window.clearTimeout(t);
  }, [hasMedia, snap.phase, errorVisible]);

  // Escape closes the error banner first, before overlay/fullscreen handlers.
  const errorVisibleRef = useRef(false);
  errorVisibleRef.current = errorVisible;
  useEffect(() => {
    if (!errorVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && errorVisibleRef.current) {
        setDismissedErrorId(snap.error?.correlationId ?? null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [errorVisible, snap.error?.correlationId]);

  return (
    <div
      className={`app ${snap.fullscreen ? "is-fullscreen" : ""} ${
        windowedChromeVisible ? "show-chrome" : "hide-chrome"
      } ${hasMedia ? "has-media" : ""} ${isDragOver ? "is-drag-over" : ""}`}
      data-platform={detectAppPlatform()}
      style={
        {
          ["--chrome-reserve" as string]: `${chromeReserve}px`,
          ["--titlebar-reserve" as string]: `${titlebarReserve}px`,
        } as CSSProperties
      }
    >
      <div className="video-stage" aria-hidden="true" />
      <PlaybackClickFeedback flash={clickFlash} />
      <OsdHost />

      {isDragOver && dragCountRef.current > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            zIndex: 40,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          <div
            style={{
              background: "rgba(8, 10, 14, 0.85)",
              color: "var(--fg)",
              padding: "0.5rem 1rem",
              borderRadius: "999px",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            Drop to add {dragCountRef.current} file{dragCountRef.current === 1 ? "" : "s"}
          </div>
        </div>
      ) : null}

      {!snap.fullscreen ? (
        <TitleBar
          ref={titlebarRef}
          visible={titlebarVisible}
          mediaTitle={snap.current?.displayName}
        />
      ) : null}

      {!hasMedia && snap.phase !== "loading" && !errorVisible && (
        <div className={`empty-hero ${isDragOver ? "is-drag-over" : ""}`}>
          <div className="brand-lockup">
            <ReplayLogo size={56} className="brand-logo" title="Replay" />
            <span className="welcome-eyebrow">YOUR PERSONAL CINEMA</span>
            <h1 className="brand">Make time for a good watch.</h1>
          </div>
          <p>Your videos. Your music. Right where you left off.</p>
          <button
            type="button"
            className="primary"
            ref={openBtnRef}
            onClick={() => void openFiles()}
          >
            <Icon name="plus" />
            Open files
            <kbd>Ctrl O</kbd>
          </button>
          <p className="hint">
            Drop files here, or press{" "}
            <button
              type="button"
              className="hint-key"
              onClick={() => {
                if (snap.fullscreen) return;
                bumpRef.current();
                settingsViewRef.current = "shortcuts";
                setSettingsView("shortcuts");
                setSettingsOpen(true);
              }}
              aria-label="Show keyboard shortcuts"
            >
              ?
            </button>{" "}
            for shortcuts
          </p>
          {recents.length > 0 ? (
            <div className="recents" aria-label="Recent files">
              <div className="recents-heading">
                <h2 className="recents-title">Recently opened</h2>
                <span>{recents.length} files</span>
              </div>
              <ul className="recents-list">
                {recents.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="recents-row"
                      onClick={() => {
                        lastOpenPathsRef.current = [r.path];
                        void dispatch({ type: "open_paths", paths: [r.path], replace: true });
                      }}
                      title={r.path}
                    >
                      <span className="recent-file-icon">
                        <Icon name="play" />
                      </span>
                      <span className="recents-name">{r.displayName}</span>
                      <span className="recent-file-type">
                        {r.displayName.split(".").pop()?.toUpperCase()}
                      </span>
                      <Icon name="chevron-right" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {snap.phase === "loading" && (
        <LoadingPill
          onCancel={() => void dispatch({ type: "open_paths", paths: [], replace: true })}
        />
      )}

      {errorVisible && snap.error ? (
        <div className="error-banner" role="alert">
          <div>
            <strong>{errorHeadline(snap.error.code)}</strong>
            <p>{snap.error.message}</p>
          </div>
          <div className="error-banner-actions">
            {snap.error.recoverable ? (
              <>
                {lastOpenPathsRef.current.length > 0 ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() =>
                      void dispatch({
                        type: "open_paths",
                        paths: lastOpenPathsRef.current,
                        replace: true,
                      })
                    }
                  >
                    Retry
                  </button>
                ) : null}
                <button type="button" className="text-btn" onClick={() => void openFiles()}>
                  Open another file
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-btn error-banner-dismiss"
              aria-label="Dismiss error"
              onClick={() => setDismissedErrorId(snap.error?.correlationId ?? null)}
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        </div>
      ) : null}

      {!snap.fullscreen ? (
        <div
          ref={chromeRef}
          className={`chrome ${windowedChromeVisible ? "visible" : ""}`}
          inert={!windowedChromeVisible ? true : undefined}
          onFocusCapture={onChromeFocusCapture}
          onMouseEnter={() => {
            setHoveringChrome(true);
            bumpRef.current();
          }}
          onMouseLeave={() => setHoveringChrome(false)}
        >
          <PlayerControls
            settingsOpen={settingsOpen}
            onToggleSettings={() => {
              bumpRef.current();
              setSettingsOpen((open) => {
                if (open) return false;
                setSettingsView("root");
                return true;
              });
            }}
          />
        </div>
      ) : null}

      {fullscreenCloseReady ? (
        <FullscreenCloseButton
          ref={fsCloseRef}
          visible={closeVisible}
          onHoverChange={setHoveringClose}
        />
      ) : null}

      <SettingsPopup
        open={settingsOpen && !snap.fullscreen}
        initialView={settingsView}
        onViewChange={(view) => {
          settingsViewRef.current = view;
        }}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsView("root");
        }}
        panelRef={settingsPanelRef}
      />
    </div>
  );
}

/**
 * Loading indicator with a spinner and a "still loading" copy + cancel after
 * 10s. The cancel dispatches an empty open_paths which moves phase to idle
 * (the backend treats empty paths as a no-op but refreshes the snapshot).
 */
function LoadingPill({ onCancel }: { onCancel: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="status-pill" role="status" aria-live="polite">
      <span className="status-spinner" aria-hidden="true" />
      {slow ? (
        <>
          <span>Still loading…</span>
          <button type="button" className="text-btn" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <span>Loading…</span>
      )}
    </div>
  );
}

/** Transient on-screen readout (volume/seek/speed) when chrome is hidden. */
function OsdHost() {
  const [msg, setMsg] = useState<OsdMessage | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let hideTimer = 0;
    return subscribeOsd((m) => {
      setMsg(m);
      setVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setVisible(false), 900);
    });
  }, []);
  if (!msg) return null;
  return (
    <div
      aria-live="polite"
      style={{
        position: "absolute",
        bottom: "calc(var(--chrome-reserve, 84px) + 12px)",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(8, 10, 14, 0.85)",
        color: "var(--fg)",
        padding: "0.35rem 0.85rem",
        borderRadius: "999px",
        fontSize: "0.85rem",
        fontWeight: 500,
        zIndex: 35,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease-out",
      }}
    >
      {osdText(msg)}
    </div>
  );
}
