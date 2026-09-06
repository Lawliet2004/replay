# tauri-plugin-replay-media3

Registered in Replay via `tauri_plugin_replay_media3::init()`. On Android, `ReplayMedia3Plugin` inserts a `SurfaceView` under the transparent WebView and drives ExoPlayer. `npx tauri android init` links this crate's `android/` Gradle library automatically because the plugin is a Cargo dependency.

Desktop `init()` is a no-op registrar so `cargo test` still links.
