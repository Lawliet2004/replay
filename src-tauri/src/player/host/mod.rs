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

pub trait VideoHost: Send {
    fn handle(&self) -> HostHandle;
    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError>;
    fn set_visible(&mut self, visible: bool) -> Result<(), AppError>;
    fn destroy(&mut self);
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::WindowsVideoHost;

#[cfg(all(unix, not(target_os = "macos")))]
mod x11;
#[cfg(all(unix, not(target_os = "macos")))]
pub use x11::X11VideoHost;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::MacosVideoHost;

/// Create the platform-appropriate host attached to a parent native window id.
pub fn create_host(
    parent_wid: i64,
    width: u32,
    height: u32,
) -> Result<Box<dyn VideoHost>, AppError> {
    #[cfg(windows)]
    {
        let host = WindowsVideoHost::create(parent_wid as isize, width, height)?;
        return Ok(Box::new(host));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let host = X11VideoHost::create(parent_wid as u64, width, height)?;
        return Ok(Box::new(host));
    }
    #[cfg(target_os = "macos")]
    {
        let host = MacosVideoHost::create(parent_wid, width, height)?;
        return Ok(Box::new(host));
    }
    #[allow(unreachable_code)]
    {
        let _ = (parent_wid, width, height);
        Err(AppError::new(
            ErrorCode::RenderHost,
            "Video host is not available on this platform.",
            false,
        ))
    }
}
