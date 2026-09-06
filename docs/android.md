# Android (v0.1)

Replay on Android is a Tauri 2 app. Playback uses **AndroidX Media3 / ExoPlayer**, not libmpv. The overlay still speaks the same `PlayerCommand` / `PlayerEvent` protocol.

## Prerequisites

- JDK 17
- Android SDK + NDK
- `rustup target add aarch64-linux-android`

## Project

```bash
npm ci
npx tauri android init
npx tauri android build --apk --target aarch64
```

If `src-tauri/gen/android` is already present, skip `init`.

## Files

- Command map (desktop-tested): `src-tauri/src/player/android_engine.rs`
- Actor (always compiled; Media3 via `AndroidPlaybackEngine`): `src-tauri/src/player/android_actor.rs`
- Host: `src-tauri/src/player/host/android.rs` (SurfaceView bounds/visibility)
- Plugin crate: `src-tauri/plugins/replay-media3/` registered in `lib.rs` as `tauri_plugin_replay_media3::init()`

## Permissions

`READ_MEDIA_VIDEO` and `READ_MEDIA_AUDIO` (API 33+), plus the older storage permission for earlier APIs. Local files arrive as SAF `content://` URIs from the system picker.

## Limits

Audio enhancer and ASS subtitle styling are no-ops. Codec coverage follows Media3, not desktop libmpv.
