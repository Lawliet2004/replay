//! Win32 child HWND video host for libmpv `wid` embedding.

use super::{HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{UpdateWindow, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, MoveWindow, RegisterClassW,
    ShowWindow, CS_HREDRAW, CS_OWNDC, CS_VREDRAW, CW_USEDEFAULT, SW_HIDE, SW_SHOW, WINDOW_EX_STYLE,
    WM_DESTROY, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
};

const CLASS_NAME: &str = "ReplayMpvHost";

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_DESTROY {
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, w, l) }
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

pub struct WindowsVideoHost {
    hwnd: HWND,
}

// Safety: HWND is only touched from the player actor thread.
unsafe impl Send for WindowsVideoHost {}

impl WindowsVideoHost {
    pub fn create(parent: isize, width: u32, height: u32) -> Result<Self, AppError> {
        unsafe {
            let hinstance = GetModuleHandleW(None).map_err(|e| {
                AppError::new(
                    ErrorCode::RenderHost,
                    format!("GetModuleHandle failed: {e}"),
                    false,
                )
            })?;
            let class = to_wide(CLASS_NAME);
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW | CS_OWNDC,
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR(class.as_ptr()),
                hbrBackground: HBRUSH(std::ptr::null_mut()),
                ..Default::default()
            };
            let _ = RegisterClassW(&wc);

            let parent_hwnd = HWND(parent as *mut _);
            let mut rect = RECT::default();
            let _ = GetClientRect(parent_hwnd, &mut rect);
            let w = if width == 0 {
                (rect.right - rect.left).max(1) as u32
            } else {
                width
            };
            let h = if height == 0 {
                (rect.bottom - rect.top).max(1) as u32
            } else {
                height
            };

            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR(class.as_ptr()),
                PCWSTR(to_wide("Replay Video").as_ptr()),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                w as i32,
                h as i32,
                Some(parent_hwnd),
                None,
                Some(hinstance.into()),
                None,
            )
            .map_err(|e| {
                AppError::new(
                    ErrorCode::RenderHost,
                    format!("CreateWindowEx failed: {e}"),
                    false,
                )
            })?;

            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = UpdateWindow(hwnd);

            Ok(Self { hwnd })
        }
    }
}

impl VideoHost for WindowsVideoHost {
    fn handle(&self) -> HostHandle {
        HostHandle {
            wid: self.hwnd.0 as i64,
        }
    }

    fn set_bounds(&mut self, x: i32, y: i32, w: u32, h: u32) -> Result<(), AppError> {
        unsafe {
            MoveWindow(self.hwnd, x, y, w as i32, h as i32, true).map_err(|e| {
                AppError::new(
                    ErrorCode::RenderHost,
                    format!("MoveWindow failed: {e}"),
                    true,
                )
            })?;
        }
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        unsafe {
            let _ = ShowWindow(self.hwnd, if visible { SW_SHOW } else { SW_HIDE });
        }
        Ok(())
    }

    fn destroy(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
        self.hwnd = HWND(std::ptr::null_mut());
    }
}

impl Drop for WindowsVideoHost {
    fn drop(&mut self) {
        if !self.hwnd.0.is_null() {
            self.destroy();
        }
    }
}

// silence unused CW_USEDEFAULT import warning on some SDK combos
#[allow(dead_code)]
const _: i32 = CW_USEDEFAULT;
