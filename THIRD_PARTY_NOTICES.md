# Third-party notices

Replay application source is MIT-licensed. Desktop playback depends on **libmpv** and its bundled **FFmpeg** build. Android playback uses **AndroidX Media3 / ExoPlayer**, not libmpv.

## libmpv / mpv

- Project: https://mpv.io/
- Typical license: GPL/LGPL depending on build options
- Replay targets **LGPL-compatible** builds (`-Dgpl=false`, no GPL/nonfree FFmpeg options)
- Windows runtime is fetched via `npm run native:fetch` (prefer `mpv-dev-lgpl` artifacts) with checksums recorded under `native-deps/`

## FFmpeg

- https://ffmpeg.org/ and https://ffmpeg.org/legal.html
- Redistributors must include corresponding LGPL notices and offer source for LGPL components as required

## AndroidX Media3 / ExoPlayer

- Project: https://github.com/androidx/media
- License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- Used **only on Android** (Tauri Media3 / ExoPlayer path). Replay does not use libmpv on Android.
- Redistributors of the APK must retain Apache-2.0 attribution as required by that license.

## Other Rust / JS dependencies

See `src-tauri/Cargo.lock` and `package-lock.json` for exact versions. Notable crates: Tauri 2, serde, ts-rs, libloading, windows-rs.

This file is release-blocking: refresh notices when bumping native runtimes.
