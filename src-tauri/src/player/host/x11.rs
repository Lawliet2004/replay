//! X11 / XWayland video host. Native Wayland is deferred for v0.1.

use super::{HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};
use std::ptr;

mod ffi {
    use std::os::raw::{c_char, c_int, c_uint, c_ulong, c_void};
    pub type Display = c_void;
    pub type Window = c_ulong;
    #[link(name = "X11")]
    unsafe extern "C" {
        pub fn XOpenDisplay(name: *const c_char) -> *mut Display;
        pub fn XCreateSimpleWindow(
            display: *mut Display,
            parent: Window,
            x: c_int,
            y: c_int,
            width: c_uint,
            height: c_uint,
            border_width: c_uint,
            border: c_ulong,
            background: c_ulong,
        ) -> Window;
        pub fn XMapWindow(display: *mut Display, w: Window) -> c_int;
        pub fn XUnmapWindow(display: *mut Display, w: Window) -> c_int;
        pub fn XMoveResizeWindow(
            display: *mut Display,
            w: Window,
            x: c_int,
            y: c_int,
            width: c_uint,
            height: c_uint,
        ) -> c_int;
        pub fn XDestroyWindow(display: *mut Display, w: Window) -> c_int;
        pub fn XFlush(display: *mut Display) -> c_int;
        pub fn XCloseDisplay(display: *mut Display) -> c_int;
        pub fn XRaiseWindow(display: *mut Display, w: Window) -> c_int;
    }
}

#[derive(Debug)]
pub struct X11VideoHost {
    display: *mut ffi::Display,
    window: ffi::Window,
    /// True only if we opened this Display (must not close Tauri's connection).
    owns_display: bool,
}

// Safety: host methods run on the UI thread that owns the parent window.
unsafe impl Send for X11VideoHost {}

impl X11VideoHost {
    pub fn create(
        parent: u64,
        display_ptr: i64,
        width: u32,
        height: u32,
    ) -> Result<Self, AppError> {
        if parent == 0 {
            return Err(AppError::new(
                ErrorCode::RenderHost,
                "Native Wayland is not supported in v0.1. Start Replay under X11 or XWayland.",
                false,
            ));
        }
        unsafe {
            let (display, owns_display) = if display_ptr != 0 {
                (display_ptr as *mut ffi::Display, false)
            } else {
                let opened = ffi::XOpenDisplay(ptr::null());
                if opened.is_null() {
                    return Err(AppError::new(
                        ErrorCode::RenderHost,
                        "XOpenDisplay failed. Start Replay under X11 or XWayland.",
                        false,
                    ));
                }
                (opened, true)
            };
            let window = ffi::XCreateSimpleWindow(
                display,
                parent,
                0,
                0,
                width.max(1),
                height.max(1),
                0,
                0,
                0,
            );
            if window == 0 {
                if owns_display {
                    ffi::XCloseDisplay(display);
                }
                return Err(AppError::new(
                    ErrorCode::RenderHost,
                    "XCreateSimpleWindow failed.",
                    false,
                ));
            }
            // Above the opaque webview (same constraint as Win32 HWND_TOP).
            // Chrome stays visible because commit_host_layout insets this window.
            ffi::XFlush(display);
            Ok(Self {
                display,
                window,
                owns_display,
            })
        }
    }
}

impl VideoHost for X11VideoHost {
    fn handle(&self) -> HostHandle {
        HostHandle {
            wid: self.window as i64,
        }
    }

    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        unsafe {
            ffi::XMoveResizeWindow(self.display, self.window, x, y, w.max(1), h.max(1));
            ffi::XRaiseWindow(self.display, self.window);
            ffi::XFlush(self.display);
        }
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        unsafe {
            if visible {
                ffi::XMapWindow(self.display, self.window);
                ffi::XRaiseWindow(self.display, self.window);
            } else {
                ffi::XUnmapWindow(self.display, self.window);
            }
            ffi::XFlush(self.display);
        }
        Ok(())
    }

    fn destroy(&mut self) {
        unsafe {
            if !self.display.is_null() {
                ffi::XDestroyWindow(self.display, self.window);
                if self.owns_display {
                    ffi::XCloseDisplay(self.display);
                } else {
                    ffi::XFlush(self.display);
                }
                self.display = ptr::null_mut();
            }
        }
    }
}

impl Drop for X11VideoHost {
    fn drop(&mut self) {
        self.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn zero_parent_is_render_host_error() {
        let err = X11VideoHost::create(0, 0, 100, 100).unwrap_err();
        assert_eq!(err.code, ErrorCode::RenderHost);
    }
}
