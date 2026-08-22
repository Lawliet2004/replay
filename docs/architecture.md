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
- YouTube-like chrome: show on pointer activity; hide after 1200ms while playing.
  The video host stays **full-bleed** (correct aspect / no chrome-induced
  pillarboxing); a `SetWindowRgn` cutout reveals the bottom HTML control strip
  while chrome is visible. Paused / the settings popup pin chrome. The settings
  menu is a measured overlay hole (`menu_*`); there is no right-edge drawer strip.
- `wid` is set **before** `mpv_initialize` so the VO embeds from the first frame.
- `libmpv-2.dll` is loaded dynamically via `libloading`.

## Linux

- Child X11 window on the **same Display** as the Tauri window (XWayland OK).
- Video is raised above the opaque webview; layout insets leave HTML chrome uncovered.
- Native Wayland is out of scope for v0.1 — start under X11/XWayland or Replay reports `RenderHost`.

## macOS

- Parent `NSView` pointer used as `wid`.
- NSOpenGLView + libmpv render API remains the upgrade path if `wid` embedding is insufficient on a given OS version.

## Actor model

- One dedicated thread owns each libmpv session (never owns the Win32 host HWND).
- Video host create/resize/destroy always runs on the UI thread (`run_on_main_thread`).
- Commands carry `request_id`; load generations discard stale events; snapshots use monotonic `revision`.
- Position samples are capped at 4 Hz; the timeline interpolates only in UI.
- Settings live in the player actor; overlay `update_settings` is `ApplySettings`. One writer thread persists JSON.
- Actor loop waits on `mpv_wait_event` (no 8ms spin). VO init falls back (Windows d3d11 → gpu-next → direct3d; Linux gpu → x11).
