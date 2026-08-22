# Building

## Prerequisites

- Node.js 20+ and npm
- Rust stable (1.77+)
- Tauri 2 system deps ([prerequisites](https://v2.tauri.app/start/prerequisites/))
- Windows: MSVC Build Tools (Desktop development with C++), WebView2, 7-Zip (for `native:fetch`)

## Steps

```bash
npm install
npm run native:fetch   # Windows
npm run tauri:dev
npm run tauri:build
```

Set `REPLAY_LIBMPV_PATH` to override the libmpv DLL/shared library path.

## Linux notes

Install `libmpv-dev` / `mpv` and X11 development packages (`libx11-dev`). Linux builds always link libX11. Use an X11 or XWayland session — native Wayland is not supported in v0.1. Deb packages depend on `libmpv2 | libmpv1` and `libx11-6`.

## macOS notes

`brew install mpv` (provides libmpv). Packaging copies should land under `native-deps/macos-universal/lib/`.
