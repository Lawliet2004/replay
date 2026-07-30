# Architecture

```
React overlay → typed Tauri commands → Rust player actor → libmpv → platform video host + OS audio
Player actor → ordered events (Tauri emit) → React store (useSyncExternalStore)
Player actor → atomic JSON settings/history + structured logs/errors
```

## Windows

- Transparent Tauri webview overlay for controls.
- Child Win32 `HWND` hosted under the main window; libmpv `wid` points at that child.
- `libmpv-2.dll` is loaded dynamically via `libloading` (same C ABI as `libmpv2-sys`) so MSVC apps can use MinGW LGPL builds without import-lib friction.

## Linux

- X11 window id embedding (works under XWayland).
- Native Wayland is explicitly out of scope for v0.1 (`x11-host` feature enables live X11 FFI).

## macOS

- Parent `NSView` pointer used as `wid`.
- NSOpenGLView + libmpv render API remains the upgrade path if `wid` embedding is insufficient on a given OS version.

## Actor model

- One dedicated thread owns each libmpv session.
- Commands carry `request_id`; load generations discard stale events; snapshots use monotonic `revision`.
- Position samples are capped at 4 Hz; the timeline interpolates only in UI.
