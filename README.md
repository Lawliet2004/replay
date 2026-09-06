# Replay

Focused local desktop media player powered by **libmpv**, with a transparent React control overlay on Tauri 2. Android uses **Media3 / ExoPlayer** instead of libmpv.

## Status (v0.1)

- **Windows 10/11 x64**: primary development target (verify locally after `npm run native:fetch`).
- **Linux x64**: X11/XWayland host prepared; packaging/CI workflows included. Native Wayland deferred.
- **macOS x64/arm64**: host adapter prepared; packaging/CI workflows included. Not runtime-verified in this local-only setup.
- **Android arm64**: sideload APK from GitHub Releases; not on the Play Store this pass.

## Downloads

Installers and the Android APK are on [GitHub Releases](https://github.com/Lawliet2004/replay/releases):

- **Windows**: MSI and NSIS
- **Linux**: `.deb` and AppImage
- **macOS**: DMG (Intel and Apple Silicon)
- **Android**: APK (arm64, sideload)

Unsigned/ad-hoc GitHub DMGs on macOS may look "damaged" until you right-click the app and choose **Open**.

Linux AppImages do not bundle libmpv (`bundleMediaFramework: false`). Install `mpv` / libmpv on the host.

Android is sideload-only this pass — install the arm64 APK from Releases. Replay is not on the Play Store.

## Engine / platform

- **Windows, macOS, Linux**: native **libmpv** (X11/XWayland on Linux; native Wayland is not in v0.1).
- **Android**: **Media3 / ExoPlayer** (not libmpv). Local files via SAF `content://`. Codec, ASS, and audio-enhancer parity with desktop is not guaranteed.

## Features

Open/drop/CLI local files, play/pause/stop/seek, volume/mute, speed, fullscreen, playlist queue + repeat, recents/resume, audio/subtitle tracks, external subtitles, metadata, fixed shortcuts, settings, recoverable errors.

## Quick start (Windows)

```bash
npm install
npm run native:fetch   # downloads LGPL libmpv; needs tools/7zr.exe (auto-fetched) or 7-Zip
npm run tauri:dev
```

Build (produces MSI + NSIS under the Cargo target `release/bundle`):

```bash
npm run tauri:build
```

Ensure `native-deps/windows-x64/bin/libmpv-2.dll` exists before packaging so it is bundled beside the app.

## Quality gates

```bash
npm run ci:frontend
cd src-tauri && cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace
```

## Architecture

See [docs/architecture.md](docs/architecture.md). Desktop playback is always native libmpv — never a browser `<video>` decode path. Android uses Media3 / ExoPlayer, not libmpv.

## License

MIT for application source. Third-party notices (libmpv/FFmpeg, AndroidX Media3 / ExoPlayer, and others) are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Redistribute desktop builds only with matching LGPL runtime artifacts and notices.
