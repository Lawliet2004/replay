import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { PlayerControls } from "./features/player/PlayerControls";
import { HelpOverlay } from "./features/player/HelpOverlay";
import { usePlayerHotkeys } from "./features/player/useHotkeys";
import { MetadataDrawer } from "./features/player/MetadataDrawer";
import { dispatch, startPlayerStore, usePlayerSnapshot } from "./features/player/store";
import { PlaylistDrawer } from "./features/playlist/PlaylistDrawer";
import { SettingsDrawer } from "./features/settings/SettingsDrawer";
import "./styles/app.css";

export default function App() {
  const snap = usePlayerSnapshot();
  const [showControls, setShowControls] = useState(true);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void startPlayerStore();
  }, []);

  useEffect(() => {
    if (!snap.fullscreen || !showControls) return;
    const t = window.setTimeout(() => setShowControls(false), 2500);
    return () => window.clearTimeout(t);
  }, [showControls, snap.fullscreen, snap.positionSecs]);

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
    onHelp: () => setHelpOpen((v) => !v),
    onOpen: () => void openFiles(),
    onEscape: () => {
      if (helpOpen) setHelpOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (playlistOpen) setPlaylistOpen(false);
      else if (metaOpen) setMetaOpen(false);
      else if (snap.fullscreen) {
        void getCurrentWindow().setFullscreen(false);
        void dispatch({ type: "set_fullscreen", fullscreen: false });
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

  return (
    <div
      className={`app ${snap.fullscreen ? "is-fullscreen" : ""} ${showControls ? "show-chrome" : "hide-chrome"}`}
      onMouseMove={() => setShowControls(true)}
      onFocus={() => setShowControls(true)}
    >
      <div className="video-stage" aria-hidden="true">
        {/* Native libmpv renders into the platform host behind this transparent overlay. */}
      </div>

      {snap.phase === "idle" && !snap.current && (
        <div className="empty-hero">
          <div className="brand">Replay</div>
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

      <div className={`chrome ${showControls ? "visible" : ""}`}>
        <PlayerControls
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenMeta={() => setMetaOpen(true)}
          onOpenPlaylist={() => setPlaylistOpen(true)}
        />
      </div>

      <PlaylistDrawer open={playlistOpen} onClose={() => setPlaylistOpen(false)} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MetadataDrawer open={metaOpen} onClose={() => setMetaOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
