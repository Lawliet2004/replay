//! Tauri plugin: Android Media3/ExoPlayer. Desktop init is a no-op registrar.

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Plugin(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(target_os = "android")]
struct PluginApi<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

/// Initializes the plugin (registers the Android Kotlin plugin when targeting Android).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("replay-media3")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    api.register_android_plugin("app.replay.media3", "ReplayMedia3Plugin")?;
                app.manage(PluginApi { handle });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

/// Invoke a Media3 command. On desktop this is a documented no-op so unit tests
/// and `tauri::Builder` still link; on Android it reaches Kotlin/ExoPlayer.
pub fn invoke_engine_call<R: Runtime>(
    app: &AppHandle<R>,
    command: &str,
    payload: Value,
) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let api = app
            .try_state::<PluginApi<R>>()
            .ok_or_else(|| Error::Plugin("replay-media3 plugin is not registered".into()))?;
        api.handle
            .run_mobile_plugin::<()>(command, payload)
            .map_err(|e| Error::Plugin(e.to_string()))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command, payload);
        Ok(())
    }
}

/// Read a native playback sample on the actor thread, never on Android's UI thread.
#[cfg(target_os = "android")]
pub fn playback_state<R: Runtime>(app: &AppHandle<R>) -> Result<Value> {
    use tauri::Manager;
    let api = app
        .try_state::<PluginApi<R>>()
        .ok_or_else(|| Error::Plugin("replay-media3 plugin is not registered".into()))?;
    api.handle
        .run_mobile_plugin("getPlaybackState", serde_json::json!({}))
        .map_err(|e| Error::Plugin(e.to_string()))
}
