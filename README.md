# Replay

Focused local desktop media player powered by **libmpv**, with a transparent React control overlay on Tauri 2.

## Status (v0.1)

- **Windows 10/11 x64**: primary development target (verify locally after `npm run native:fetch`).
- **Linux x64**: X11/XWayland host prepared; packaging/CI workflows included. Native Wayland deferred.
- **macOS x64/arm64**: host adapter prepared; packaging/CI workflows included. Not runtime-verified in this local-only setup.

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

See [docs/architecture.md](docs/architecture.md). Playback is always native libmpv — never a browser `<video>` decode path.

## License

MIT for application source. Third-party notices (libmpv/FFmpeg and others) are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Redistribute only with matching LGPL runtime artifacts and notices.
