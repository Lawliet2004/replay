# Architecture

```
React overlay → typed Tauri commands → Rust player actor → libmpv → platform video host + OS audio
Player actor → ordered events (Tauri emit) → React store (useSyncExternalStore)
Player actor → atomic JSON settings/history + structured logs/errors
```

## Windows

- **Opaque** Tauri webview (not transparent). Sibling HWNDs do not alpha-blend; a
  transparent webview reveals the desktop, not a child sitting underneath.
- Child Win32 `HWND` for libmpv `wid` is created/resized/destroyed on the **UI thread**
  and stacked with **`HWND_TOP`** above WebView2 so video frames are visible.
- Host + libmpv VO children are hit-test transparent so mouse move reaches the overlay.
- YouTube-like chrome: show on pointer activity; hide after 500ms while playing.
  The video host stays **full-bleed** (correct aspect / no chrome-induced
  pillarboxing); a `SetWindowRgn` cutout reveals the bottom HTML control strip
  while chrome is visible. Paused / drawers / overflow menu pin chrome.
- `wid` is set **before** `mpv_initialize` so the VO embeds from the first frame.
- `libmpv-2.dll` is loaded dynamically via `libloading`.

## Linux

- X11 window id embedding (works under XWayland).
- Native Wayland is explicitly out of scope for v0.1 (`x11-host` feature enables live X11 FFI).

## macOS

- Parent `NSView` pointer used as `wid`.
- NSOpenGLView + libmpv render API remains the upgrade path if `wid` embedding is insufficient on a given OS version.

## Actor model

- One dedicated thread owns each libmpv session (never owns the Win32 host HWND).
- Commands carry `request_id`; load generations discard stale events; snapshots use monotonic `revision`.
- Position samples are capped at 4 Hz; the timeline interpolates only in UI.
- Settings persistence is debounced and written on a background thread so open/seek never block on disk.
