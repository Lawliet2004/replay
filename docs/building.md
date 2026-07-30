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

Install `libmpv-dev` / `mpv` and X11 development packages. Enable `--features x11-host` for live X11 embedding. Use an X11 or XWayland session.

## macOS notes

`brew install mpv` (provides libmpv). Packaging copies should land under `native-deps/macos-universal/lib/`.
