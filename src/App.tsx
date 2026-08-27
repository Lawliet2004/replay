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
import { setSeekStepSecs } from "./features/player/seekPrefs";
import { isFullscreenCloseHit, isSurfaceClickIgnored } from "./features/player/surfaceClick";
import { detectAppPlatform } from "./lib/platform";
import { Icon } from "./components/icons";
import "./styles/app.css";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("root");
  const settingsViewRef = useRef<SettingsView>("root");
  const [clickFlash, setClickFlash] = useState<PlaybackClickFlash | null>(null);
  /** True while a file drag is hovering over the window. */
  const [isDragOver, setIsDragOver] = useState(false);
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
    void getSettings()
      .then((s) => {
        setSeekStepSecs(s.seekStepSecs);
        setRecents(s.recent.slice(0, 6));
      })
      .catch(() => {});
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
    await dispatch({ type: "open_paths", paths, replace: true });
  }, []);

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
        const paths = event.payload.paths.filter((p) => !p.includes("://"));
        if (paths.length) {
          // Drop APPENDS to the queue so a single file never wipes a long
          // playlist. Modifier-keyed "replace" is a future enhancement.
          void dispatch({ type: "open_paths", paths, replace: false });
        }
        setIsDragOver(false);
      } else if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

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
  }, []);

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

      {!snap.fullscreen ? (
        <TitleBar
          ref={titlebarRef}
          visible={titlebarVisible}
          mediaTitle={snap.current?.displayName}
        />
      ) : null}

      {snap.phase === "idle" && !snap.current && (
        <div className={`empty-hero ${isDragOver ? "is-drag-over" : ""}`}>
          <div className="brand-lockup">
            <ReplayLogo size={72} className="brand-logo" title="Replay" />
            <div className="brand">Replay</div>
          </div>
          <p>Open a local video or audio file to begin.</p>
          <button type="button" className="primary" onClick={() => void openFiles()}>
            Open files
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
              <h3 className="recents-title">Recent</h3>
              <ul className="recents-list">
                {recents.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="recents-row"
                      onClick={() =>
                        void dispatch({ type: "open_paths", paths: [r.path], replace: true })
                      }
                      title={r.path}
                    >
                      <PlayGlyph />
                      <span className="recents-name">{r.displayName}</span>
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
            <strong>Something went wrong</strong>
            <p>{snap.error.message}</p>
          </div>
          <div className="error-banner-actions">
            {snap.error.recoverable ? (
              <button type="button" className="text-btn" onClick={() => void openFiles()}>
                Open another file
              </button>
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
          className={`chrome ${chromeVisible ? "visible" : ""}`}
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

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}
