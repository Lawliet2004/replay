//! macOS video host using an NSView for libmpv `wid` embedding.
//! Full NSOpenGLView + render API path is prepared for platforms that require it.

use super::{HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};

pub struct MacosVideoHost {
    wid: i64,
}

impl MacosVideoHost {
    pub fn create(parent_wid: i64, _width: u32, _height: u32) -> Result<Self, AppError> {
        if parent_wid == 0 {
            return Err(AppError::new(
                ErrorCode::RenderHost,
                "macOS video host requires a parent NSView pointer.",
                false,
            ));
        }
        // For v0.1 we embed into the parent view id directly. A dedicated
        // NSOpenGLView child can be swapped in without changing the actor contract.
        Ok(Self { wid: parent_wid })
    }
}

impl VideoHost for MacosVideoHost {
    fn handle(&self) -> HostHandle {
        HostHandle { wid: self.wid }
    }

    fn set_bounds(&mut self, _x: i32, _y: i32, _w: u32, _h: u32) -> Result<(), AppError> {
        Ok(())
    }

    fn set_visible(&mut self, _visible: bool) -> Result<(), AppError> {
        Ok(())
    }

    fn destroy(&mut self) {}
}
