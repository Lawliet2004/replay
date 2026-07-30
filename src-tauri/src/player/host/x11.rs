//! X11 / XWayland video host. Native Wayland is deferred for v0.1.

use super::{HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};
use std::ptr;

#[cfg(feature = "x11-host")]
mod ffi {
    use std::os::raw::{c_char, c_int, c_uint, c_ulong, c_void};
    pub type Display = c_void;
    pub type Window = c_ulong;
    #[link(name = "X11")]
    unsafe extern "C" {
        pub fn XOpenDisplay(name: *const c_char) -> *mut Display;
        pub fn XDefaultRootWindow(display: *mut Display) -> Window;
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
    }
}

pub struct X11VideoHost {
    #[cfg(feature = "x11-host")]
    display: *mut ffi::Display,
    #[cfg(feature = "x11-host")]
    window: ffi::Window,
    #[cfg(not(feature = "x11-host"))]
    wid: i64,
}

// Safety: X11 ops are confined to the player actor thread.
unsafe impl Send for X11VideoHost {}

impl X11VideoHost {
    pub fn create(parent: u64, width: u32, height: u32) -> Result<Self, AppError> {
        #[cfg(feature = "x11-host")]
        {
            unsafe {
                let display = ffi::XOpenDisplay(ptr::null());
                if display.is_null() {
                    return Err(AppError::new(
                        ErrorCode::RenderHost,
                        "XOpenDisplay failed. Native Wayland is not supported in v0.1; use X11/XWayland.",
                        false,
                    ));
                }
                let parent_win = if parent == 0 {
                    ffi::XDefaultRootWindow(display)
                } else {
                    parent
                };
                let window = ffi::XCreateSimpleWindow(
                    display,
                    parent_win,
                    0,
                    0,
                    width.max(1),
                    height.max(1),
                    0,
                    0,
                    0,
                );
                ffi::XMapWindow(display, window);
                ffi::XFlush(display);
                Ok(Self { display, window })
            }
        }
        #[cfg(not(feature = "x11-host"))]
        {
            let _ = (parent, width, height);
            // Compile-gated stub keeps Linux builds green without X11 headers in CI.
            Ok(Self { wid: parent as i64 })
        }
    }
}

impl VideoHost for X11VideoHost {
    fn handle(&self) -> HostHandle {
        #[cfg(feature = "x11-host")]
        {
            HostHandle {
                wid: self.window as i64,
            }
        }
        #[cfg(not(feature = "x11-host"))]
        {
            HostHandle { wid: self.wid }
        }
    }

    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        #[cfg(feature = "x11-host")]
        {
            unsafe {
                ffi::XMoveResizeWindow(self.display, self.window, x, y, w.max(1), h.max(1));
                ffi::XFlush(self.display);
            }
            Ok(())
        }
        #[cfg(not(feature = "x11-host"))]
        {
            let _ = (x, y, w, h);
            Ok(())
        }
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        #[cfg(feature = "x11-host")]
        {
            unsafe {
                if visible {
                    ffi::XMapWindow(self.display, self.window);
                } else {
                    ffi::XUnmapWindow(self.display, self.window);
                }
                ffi::XFlush(self.display);
            }
            Ok(())
        }
        #[cfg(not(feature = "x11-host"))]
        {
            let _ = visible;
            Ok(())
        }
    }

    fn destroy(&mut self) {
        #[cfg(feature = "x11-host")]
        {
            unsafe {
                if !self.display.is_null() {
                    ffi::XDestroyWindow(self.display, self.window);
                    ffi::XCloseDisplay(self.display);
                    self.display = ptr::null_mut();
                }
            }
        }
    }
}

impl Drop for X11VideoHost {
    fn drop(&mut self) {
        self.destroy();
    }
}
