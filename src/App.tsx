import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { ReplayLogo } from "./assets/ReplayLogo";
import { PlayerControls } from "./features/player/PlayerControls";
import {
  PlaybackClickFeedback,
  type PlaybackClickFlash,
} from "./features/player/PlaybackClickFeedback";
import { HelpOverlay } from "./features/player/HelpOverlay";
import { usePlayerHotkeys } from "./features/player/useHotkeys";
import { MetadataDrawer } from "./features/player/MetadataDrawer";
import { TitleBar } from "./features/player/TitleBar";
import { dispatch, startPlayerStore, usePlayerSnapshot } from "./features/player/store";
import { PlaylistDrawer } from "./features/playlist/PlaylistDrawer";
import { SettingsDrawer } from "./features/settings/SettingsDrawer";
import {
  CHROME_RESERVE_PX,
  cutoutFromRect,
  DRAWER_RIGHT_RESERVE_PX,
  NO_CUTOUT,
  TITLEBAR_RESERVE_PX,
} from "./features/player/chromeAutoHide";
import { useChromeAutoHide } from "./features/player/useChromeAutoHide";
import { setPlayerFullscreen } from "./features/player/fullscreen";
import { getSettings } from "./lib/ipc";
import { setSeekStepSecs } from "./features/player/seekPrefs";
import "./styles/app.css";

function isSurfaceClickIgnored(target: EventTarget | null, chromeVisible: boolean): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  if (
    el.closest(
      ".titlebar, .drawer, .help-overlay, .more-menu, .empty-hero, .error-banner, .status-pill",
    )
  ) {
    return true;
  }
  if (chromeVisible && el.closest(".chrome")) return true;
  if (
    el.closest("button, input, select, textarea, [role='slider'], [role='menu'], [role='menuitem']")
  ) {
    return true;
  }
  return false;
}

export default function App() {
  const snap = usePlayerSnapshot();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [clickFlash, setClickFlash] = useState<PlaybackClickFlash | null>(null);

  const hasMedia = Boolean(snap.current) && snap.phase !== "idle" && snap.phase !== "error";
  const blockingUi = playlistOpen || settingsOpen || metaOpen || helpOpen;
  const overlayOpen = blockingUi || overflowOpen;

  const { chromeVisible, bumpActivity, setHoveringChrome, forceHideUntilPointerLeave } =
    useChromeAutoHide({
      hasMedia,
      blockingUi: overlayOpen,
      phase: snap.phase,
    });

  const dismissOverlays = useCallback(() => {
    setHelpOpen(false);
    setSettingsOpen(false);
    setPlaylistOpen(false);
    setMetaOpen(false);
    setOverflowOpen(false);
  }, []);

  const bumpRef = useRef(bumpActivity);
  bumpRef.current = bumpActivity;
  const forceHideRef = useRef(forceHideUntilPointerLeave);
  forceHideRef.current = forceHideUntilPointerLeave;
  const wasFullscreen = useRef(false);
  const overflowPanelRef = useRef<HTMLDivElement | null>(null);
  const syncHostRef = useRef<() => void>(() => {});
  const chromeVisibleRef = useRef(chromeVisible);
  chromeVisibleRef.current = chromeVisible;
  const phaseRef = useRef(snap.phase);
  phaseRef.current = snap.phase;
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const dismissOverlaysRef = useRef(dismissOverlays);
  dismissOverlaysRef.current = dismissOverlays;
  const flashTokenRef = useRef(0);

  // Help is a centered modal — hide the host so the dimmed card is fully visible.
  // Drawers/overflow use localized cutouts so video keeps playing beside them.
  const hostBlocked = helpOpen;
  const drawerOpen = playlistOpen || settingsOpen || metaOpen;
  // Title bar: always when idle; with chrome when media; never in fullscreen.
  const titlebarVisible = !snap.fullscreen && (!hasMedia || chromeVisible);
  const chromeBottomLogical = hasMedia && chromeVisible && !hostBlocked ? CHROME_RESERVE_PX : 0;
  const chromeRightLogical = hasMedia && drawerOpen && !hostBlocked ? DRAWER_RIGHT_RESERVE_PX : 0;
  const menuCutoutActive = hasMedia && overflowOpen && chromeVisible && !hostBlocked;
  const chromeReserve = chromeBottomLogical;
  const titlebarReserve = titlebarVisible && hasMedia ? TITLEBAR_RESERVE_PX : 0;

  useEffect(() => {
    void startPlayerStore();
    void getSettings()
      .then((s) => setSeekStepSecs(s.seekStepSecs))
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

  // Entering fullscreen: hide chrome immediately so the video goes full-bleed.
  useEffect(() => {
    if (snap.fullscreen && !wasFullscreen.current) {
      forceHideRef.current();
    }
    wasFullscreen.current = snap.fullscreen;
  }, [snap.fullscreen]);

  const openFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media",
          extensions: ["mp4", "mkv", "webm", "avi", "mov", "mp3", "flac", "opus", "wav", "m4a"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await dispatch({ type: "open_paths", paths, replace: true });
  }, []);

  usePlayerHotkeys({
    onHelp: () => {
      bumpRef.current();
      setHelpOpen((v) => !v);
    },
    onOpen: () => void openFiles(),
    onEscape: () => {
      if (helpOpen) setHelpOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (playlistOpen) setPlaylistOpen(false);
      else if (metaOpen) setMetaOpen(false);
      else if (overflowOpen) setOverflowOpen(false);
      else if (snap.fullscreen) {
        void setPlayerFullscreen(false);
      }
    },
  });

  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths.filter((p) => !p.includes("://"));
        if (paths.length) void dispatch({ type: "open_paths", paths, replace: true });
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
      const chromeBottom = Math.round(chromeBottomLogical * dpr);
      const chromeTop =
        hasMedia && titlebarVisible && !hostBlocked ? Math.round(TITLEBAR_RESERVE_PX * dpr) : 0;
      const chromeRight = Math.round(chromeRightLogical * dpr);
      // The ⋯ panel is anchored to its button inside the centred control bar,
      // so the hole must be measured rather than derived from window edges.
      const menu = menuCutoutActive
        ? cutoutFromRect(overflowPanelRef.current?.getBoundingClientRect(), clientW, clientH, dpr)
        : NO_CUTOUT;
      const hideHost = !hasMedia || hostBlocked;
      void dispatch({
        type: "set_host_bounds",
        width: clientW,
        height: hideHost ? 0 : clientH,
        chrome_bottom: chromeBottom,
        chrome_top: chromeTop,
        chrome_right: chromeRight,
        menu_x: menu.x,
        menu_y: menu.y,
        menu_w: menu.w,
        menu_h: menu.h,
      });
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
    chromeBottomLogical,
    chromeRightLogical,
    menuCutoutActive,
    titlebarVisible,
    overflowOpen,
    drawerOpen,
    snap.current?.path,
    snap.fullscreen,
    snap.phase,
  ]);

  // The panel resizes while open (the repeat item relabels), so track it.
  useEffect(() => {
    const el = overflowPanelRef.current;
    if (!menuCutoutActive || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncHostRef.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, [menuCutoutActive]);

  // Brief chrome reveal when a file first loads — not on pause/play.
  useEffect(() => {
    if (hasMedia) bumpRef.current();
  }, [hasMedia]);

  // Native mouse hook drives reveal: the HWND_TOP video host swallows pointer
  // input, so window pointermove over the video is unreliable by design.
  // Surface clicks also arrive only via this hook (webview never sees them).
  useEffect(() => {
    const unActivity = listen("player://activity", () => {
      bumpRef.current();
    });

    type SurfaceClickPayload = { x: number; y: number; window_w: number; window_h: number };
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
      const ignored = isSurfaceClickIgnored(hit, chromeVisibleRef.current);
      if (ignored) return;
      if (overlay) {
        dismissOverlaysRef.current();
        return;
      }
      if (!phaseOk) return;

      flashTokenRef.current += 1;
      setClickFlash({
        kind: phase === "playing" ? "pause" : "play",
        token: flashTokenRef.current,
      });
      void dispatch({ type: "toggle_pause" });
    });

    return () => {
      void unActivity.then((f) => f());
      void unSurface.then((f) => f());
    };
  }, []);

  // Stage-wide pointer motion reveals chrome (YouTube-like). Relies on video-host click-through.
  useEffect(() => {
    if (!hasMedia) return;
    const onMove = () => {
      bumpRef.current();
    };
    const onDown = () => {
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
      className={`app ${snap.fullscreen ? "is-fullscreen" : ""} ${chromeVisible ? "show-chrome" : "hide-chrome"} ${
        hasMedia ? "has-media" : ""
      }`}
      style={
        {
          ["--chrome-reserve" as string]: `${chromeReserve}px`,
          ["--titlebar-reserve" as string]: `${titlebarReserve}px`,
        } as CSSProperties
      }
    >
      <div className="video-stage" aria-hidden="true" />
      <PlaybackClickFeedback flash={clickFlash} />

      <TitleBar visible={titlebarVisible} />

      {snap.phase === "idle" && !snap.current && (
        <div className="empty-hero">
          <div className="brand-lockup">
            <ReplayLogo size={72} className="brand-logo" title="Replay" />
            <div className="brand">Replay</div>
          </div>
          <p>Open a local video or audio file to begin.</p>
          <button type="button" className="primary" onClick={() => void openFiles()}>
            Open files
          </button>
          <p className="hint">Drop files here · Press ? for shortcuts</p>
        </div>
      )}

      {snap.phase === "loading" && <div className="status-pill">Loading…</div>}

      {snap.error && (
        <div className="error-banner" role="alert">
          <div>
            <strong>Something went wrong</strong>
            <p>{snap.error.message}</p>
          </div>
          {snap.error.recoverable && (
            <button type="button" className="text-btn" onClick={() => void openFiles()}>
              Open another file
            </button>
          )}
        </div>
      )}

      <div
        className={`chrome ${chromeVisible ? "visible" : ""}`}
        onMouseEnter={() => {
          setHoveringChrome(true);
          bumpRef.current();
        }}
        onMouseLeave={() => setHoveringChrome(false)}
      >
        <PlayerControls
          onOpenSettings={() => {
            bumpRef.current();
            setOverflowOpen(false);
            setSettingsOpen(true);
          }}
          onOpenHelp={() => {
            bumpRef.current();
            setOverflowOpen(false);
            setHelpOpen(true);
          }}
          onOpenMeta={() => {
            bumpRef.current();
            setOverflowOpen(false);
            setMetaOpen(true);
          }}
          onOpenPlaylist={() => {
            bumpRef.current();
            setOverflowOpen(false);
            setPlaylistOpen(true);
          }}
          overflowOpen={overflowOpen}
          onOverflowOpenChange={setOverflowOpen}
          overflowPanelRef={overflowPanelRef}
        />
      </div>

      <PlaylistDrawer open={playlistOpen} onClose={() => setPlaylistOpen(false)} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MetadataDrawer open={metaOpen} onClose={() => setMetaOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
