//! Android video host. Media3 renders into a SurfaceView under the WebView.

use super::{HostHandle, ParentSurface, VideoHost};
use crate::error::AppError;
use std::sync::OnceLock;
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn install_app_handle(app: AppHandle) {
    let _ = APP.set(app);
}

fn invoke_surface(x: i32, y: i32, w: u32, h: u32) {
    if let Some(app) = APP.get() {
        let _ = tauri_plugin_replay_media3::invoke_engine_call(
            app,
            "setSurface",
            serde_json::json!({ "x": x, "y": y, "w": w, "h": h }),
        );
    }
}

fn invoke_visible(visible: bool) {
    if let Some(app) = APP.get() {
        let _ = tauri_plugin_replay_media3::invoke_engine_call(
            app,
            "setVisible",
            serde_json::json!({ "visible": visible }),
        );
    }
}

pub struct AndroidVideoHost {
    wid: i64,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    visible: bool,
}

impl AndroidVideoHost {
    pub fn create(parent: ParentSurface, width: u32, height: u32) -> Result<Self, AppError> {
        let host = Self {
            wid: parent.wid,
            x: 0,
            y: 0,
            w: width.max(1),
            h: height.max(1),
            visible: false,
        };
        invoke_surface(host.x, host.y, host.w, host.h);
        invoke_visible(false);
        Ok(host)
    }
}

impl VideoHost for AndroidVideoHost {
    fn handle(&self) -> HostHandle {
        HostHandle { wid: self.wid }
    }

    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        self.x = x;
        self.y = y;
        self.w = w.max(1);
        self.h = h.max(1);
        self.visible = true;
        invoke_surface(self.x, self.y, self.w, self.h);
        invoke_visible(true);
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        self.visible = visible;
        invoke_visible(visible);
        Ok(())
    }

    fn destroy(&mut self) {
        invoke_visible(false);
    }

    fn diagnose(&self) -> String {
        format!(
            "wid={} surface={}x{}+{}+{} visible={}",
            self.wid, self.w, self.h, self.x, self.y, self.visible
        )
    }
}
