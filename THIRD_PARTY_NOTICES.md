# Third-party notices

Replay application source is MIT-licensed. Playback depends on **libmpv** and its bundled **FFmpeg** build.

## libmpv / mpv

- Project: https://mpv.io/
- Typical license: GPL/LGPL depending on build options
- Replay targets **LGPL-compatible** builds (`-Dgpl=false`, no GPL/nonfree FFmpeg options)
- Windows runtime is fetched via `npm run native:fetch` (prefer `mpv-dev-lgpl` artifacts) with checksums recorded under `native-deps/`

## FFmpeg

- https://ffmpeg.org/ and https://ffmpeg.org/legal.html
- Redistributors must include corresponding LGPL notices and offer source for LGPL components as required

## Other Rust / JS dependencies

See `src-tauri/Cargo.lock` and `package-lock.json` for exact versions. Notable crates: Tauri 2, serde, ts-rs, libloading, windows-rs.

This file is release-blocking: refresh notices when bumping native runtimes.
