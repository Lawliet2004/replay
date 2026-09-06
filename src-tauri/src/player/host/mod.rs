//! Platform video host adapters.
//!
//! Windows: child HWND for libmpv `wid`.
//! Linux: X11 window id (XWayland compatible); native Wayland deferred.
//! macOS: NSView host for wid embedding (render API reserved for future hardening).

use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Copy)]
pub struct HostHandle {
    pub wid: i64,
}

/// Native parent surface for libmpv `wid` embedding.
#[derive(Debug, Clone, Copy)]
pub struct ParentSurface {
    pub wid: i64,
    /// X11 `Display*` as integer; unused on Windows/macOS.
    pub display: i64,
}

/// Regions to punch out of an opaque video host so HTML chrome stays visible.
/// All values are physical pixels in host client coordinates; `0` = no cutout.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ChromeCutout {
    /// Full-width strip at the top (custom title bar).
    pub top: u32,
    /// Full-width strip at the bottom (control chrome).
    pub bottom: u32,
    /// Full-height strip on the right (drawers).
    pub right: u32,
    /// Free-floating rect for the ⋯ menu panel. Zero size disables it.
    pub menu_x: u32,
    pub menu_y: u32,
    pub menu_w: u32,
    pub menu_h: u32,
}

pub trait VideoHost: Send {
    fn handle(&self) -> HostHandle;
    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError>;
    /// Punch HTML chrome / overlay holes out of an opaque host (Windows HWND_TOP). Default no-op.
    fn set_chrome_cutout(&mut self, _cutout: ChromeCutout) -> Result<(), AppError> {
        Ok(())
    }
    fn set_visible(&mut self, visible: bool) -> Result<(), AppError>;
    fn destroy(&mut self);
    /// Optional diagnostic string for logs / verification.
    fn diagnose(&self) -> String {
        format!("wid={}", self.handle().wid)
    }
}

#[cfg(windows)]
mod close_overlay;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{
    install_activity_hook, invalidate_activity_rect, uninstall_activity_hook, WindowsVideoHost,
};

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
mod x11;
#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
pub use x11::X11VideoHost;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::MacosVideoHost;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::install_app_handle as install_android_app;
#[cfg(target_os = "android")]
pub use android::AndroidVideoHost;

/// Create the platform-appropriate host attached to a parent native window id.
pub fn create_host(
    parent: ParentSurface,
    width: u32,
    height: u32,
) -> Result<Box<dyn VideoHost>, AppError> {
    #[cfg(windows)]
    {
        let host = WindowsVideoHost::create(parent.wid as isize, width, height)?;
        return Ok(Box::new(host));
    }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    {
        let host = X11VideoHost::create(parent.wid as u64, parent.display, width, height)?;
        return Ok(Box::new(host));
    }
    #[cfg(target_os = "macos")]
    {
        let host = MacosVideoHost::create(parent.wid, width, height)?;
        return Ok(Box::new(host));
    }
    #[cfg(target_os = "android")]
    {
        let host = AndroidVideoHost::create(parent, width, height)?;
        return Ok(Box::new(host));
    }
    #[allow(unreachable_code)]
    {
        let _ = (parent, width, height);
        Err(AppError::new(
            ErrorCode::RenderHost,
            "Video host is not available on this platform.",
            false,
        ))
    }
}
