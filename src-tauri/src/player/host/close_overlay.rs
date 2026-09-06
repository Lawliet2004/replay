//! Per-pixel-alpha close chip painted above the HWND_TOP video host.
//!
//! `CreateEllipticRgn` is 1-bit, so a hole through the video looks jagged.
//! This layered child composites `close_icon.svg` with real anti-aliasing
//! (and the SVG's 0.88 disc opacity) over the video frames.

use crate::error::{AppError, ErrorCode};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicIsize, Ordering};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION,
    DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, RGBQUAD,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, IsWindow, IsWindowVisible, RegisterClassW,
    SetWindowPos, ShowWindow, UpdateLayeredWindow, WindowFromPoint, CS_HREDRAW, CS_VREDRAW,
    HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOW, ULW_ALPHA,
    WINDOW_EX_STYLE, WM_DESTROY, WM_ERASEBKGND, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_POPUP,
};

const CLASS_NAME: &str = "ReplayCloseOverlay";
static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
const CLOSE_ICON_SVG: &str = include_str!("../../../assets/close_icon.svg");
/// Source SVG canvas (viewBox 0 0 1024 1024).
const SVG_CANVAS: f32 = 1024.0;
/// Disc diameter in SVG units (`r=252` × 2).
const SVG_DISC: f32 = 504.0;

pub struct CloseOverlay {
    hwnd: HWND,
    parent: HWND,
    hdc_mem: HDC,
    dib: HBITMAP,
    old: HGDIOBJ,
    last_size: i32,
}

impl CloseOverlay {
    pub fn create(parent: HWND) -> Self {
        match create_inner(parent) {
            Ok(overlay) => overlay,
            Err(err) => {
                tracing::warn!(error = %err.message, "close overlay unavailable; falling back to GDI hole");
                Self::disabled()
            }
        }
    }

    fn disabled() -> Self {
        Self {
            hwnd: HWND(std::ptr::null_mut()),
            parent: HWND(std::ptr::null_mut()),
            hdc_mem: HDC(std::ptr::null_mut()),
            dib: HBITMAP(std::ptr::null_mut()),
            old: HGDIOBJ(std::ptr::null_mut()),
            last_size: 0,
        }
    }

    pub fn is_live(&self) -> bool {
        unsafe { !self.hwnd.0.is_null() && IsWindow(Some(self.hwnd)).as_bool() }
    }

    /// Position and paint the SVG so its disc matches `chip` (client px).
    /// Returns whether the overlay is showing (caller should skip the GDI hole).
    pub fn show_chip(&mut self, chip: (i32, i32, i32, i32)) -> bool {
        if !self.is_live() {
            return false;
        }
        let (x, y, size) = overlay_rect_from_chip(chip.0, chip.1, chip.2, chip.3);
        if size <= 0 {
            self.hide();
            return false;
        }
        if self.last_size != size && !self.rasterize(size) {
            self.hide();
            return false;
        }
        self.remember();
        let (sx, sy) = client_to_screen(self.parent, x, y);
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_TOP),
                sx,
                sy,
                size,
                size,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(self.hwnd, SW_SHOW);
        }
        true
    }

    pub fn hide(&mut self) {
        if !self.is_live() {
            return;
        }
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
    }

    pub fn raise(&self) {
        if !self.is_live() {
            return;
        }
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    fn remember(&self) {
        OVERLAY_HWND.store(self.hwnd.0 as isize, Ordering::Relaxed);
    }

    pub fn destroy(&mut self) {
        unsafe {
            if !self.hdc_mem.0.is_null() {
                if !self.old.0.is_null() {
                    let _ = SelectObject(self.hdc_mem, self.old);
                }
                let _ = DeleteDC(self.hdc_mem);
            }
            if !self.dib.0.is_null() {
                let _ = DeleteObject(self.dib.into());
            }
            if !self.hwnd.0.is_null() && IsWindow(Some(self.hwnd)).as_bool() {
                let _ = DestroyWindow(self.hwnd);
            }
        }
        OVERLAY_HWND.store(0, Ordering::Relaxed);
        *self = Self::disabled();
    }

    fn rasterize(&mut self, size: i32) -> bool {
        let Some(bgra) = rasterize_close_icon(size as u32) else {
            return false;
        };
        unsafe {
            if !self.hdc_mem.0.is_null() && !self.old.0.is_null() {
                let _ = SelectObject(self.hdc_mem, self.old);
                self.old = HGDIOBJ(std::ptr::null_mut());
            }
            if !self.dib.0.is_null() {
                let _ = DeleteObject(self.dib.into());
                self.dib = HBITMAP(std::ptr::null_mut());
            }

            let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: size,
                    biHeight: -size,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                bmiColors: [RGBQUAD::default()],
            };
            let dib = match CreateDIBSection(
                Some(self.hdc_mem),
                &info as *const BITMAPINFO,
                DIB_RGB_COLORS,
                &mut bits,
                None,
                0,
            ) {
                Ok(h) if !h.0.is_null() && !bits.is_null() => h,
                _ => return false,
            };
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
            self.old = SelectObject(self.hdc_mem, dib.into());
            self.dib = dib;

            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            let src = POINT { x: 0, y: 0 };
            let dim = SIZE { cx: size, cy: size };
            if UpdateLayeredWindow(
                self.hwnd,
                None,
                None,
                Some(&dim as *const _),
                Some(self.hdc_mem),
                Some(&src as *const _),
                COLORREF(0),
                Some(&blend as *const _),
                ULW_ALPHA,
            )
            .is_err()
            {
                return false;
            }
        }
        self.last_size = size;
        true
    }
}

impl Drop for CloseOverlay {
    fn drop(&mut self) {
        self.destroy();
    }
}

fn create_inner(parent: HWND) -> Result<CloseOverlay, AppError> {
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
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(overlay_wnd_proc),
            hInstance: hinstance.into(),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        let _ = RegisterClassW(&wc);

        let title = to_wide("Replay Close Overlay");
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0),
            PCWSTR(class.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP,
            0,
            0,
            1,
            1,
            Some(parent),
            None,
            Some(hinstance.into()),
            None,
        )
        .map_err(|e| {
            AppError::new(
                ErrorCode::RenderHost,
                format!("close overlay CreateWindowEx failed: {e}"),
                false,
            )
        })?;

        let screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(screen));
        if !screen.0.is_null() {
            let _ = ReleaseDC(None, screen);
        }
        if hdc_mem.0.is_null() {
            let _ = DestroyWindow(hwnd);
            return Err(AppError::new(
                ErrorCode::RenderHost,
                "close overlay CreateCompatibleDC failed",
                false,
            ));
        }

        let overlay = CloseOverlay {
            hwnd,
            parent,
            hdc_mem,
            dib: HBITMAP(std::ptr::null_mut()),
            old: HGDIOBJ(std::ptr::null_mut()),
            last_size: 0,
        };
        overlay.remember();
        Ok(overlay)
    }
}

unsafe extern "system" fn overlay_wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => LRESULT(0),
        WM_ERASEBKGND => LRESULT(1),
        _ => unsafe { DefWindowProcW(hwnd, msg, w, l) },
    }
}

/// True when the cursor is over the visible close-icon popup (opaque disc).
/// The layered window uses per-pixel alpha hit-testing, so transparent padding
/// around the disc still reports as not-ours.
pub fn owns_screen_point(pt: POINT) -> bool {
    let hwnd = HWND(OVERLAY_HWND.load(Ordering::Relaxed) as *mut _);
    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        WindowFromPoint(pt) == hwnd
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn client_to_screen(parent: HWND, x: i32, y: i32) -> (i32, i32) {
    let mut pt = POINT { x, y };
    unsafe {
        let _ = ClientToScreen(parent, &mut pt);
    }
    (pt.x, pt.y)
}

/// Center a canvas on the chip so the SVG disc (504/1024 of the canvas) matches
/// the chip's bounding square. Transparent padding then sits over the video.
pub fn overlay_rect_from_chip(x0: i32, y0: i32, x1: i32, y1: i32) -> (i32, i32, i32) {
    let chip = (x1 - x0).max(y1 - y0).max(1);
    let size = ((chip as f32) * SVG_CANVAS / SVG_DISC).round().max(1.0) as i32;
    let cx = x0 + (x1 - x0) / 2;
    let cy = y0 + (y1 - y0) / 2;
    (cx - size / 2, cy - size / 2, size)
}

fn rasterize_close_icon(px: u32) -> Option<Vec<u8>> {
    if px == 0 || px > 1024 {
        return None;
    }
    let tree =
        resvg::usvg::Tree::from_str(CLOSE_ICON_SVG, &resvg::usvg::Options::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(px, px)?;
    let scale = px as f32 / SVG_CANVAS;
    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Some(rgba_premul_to_bgra(pixmap.data()))
}

fn rgba_premul_to_bgra(src: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len());
    for chunk in src.chunks_exact(4) {
        out.push(chunk[2]);
        out.push(chunk[1]);
        out.push(chunk[0]);
        out.push(chunk[3]);
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn svg_file_is_the_provided_close_icon() {
        assert!(super::CLOSE_ICON_SVG.contains("viewBox=\"0 0 1024 1024\""));
        assert!(super::CLOSE_ICON_SVG.contains("r=\"252\""));
        assert!(super::CLOSE_ICON_SVG.contains("fill=\"#2F2B43\""));
        assert!(super::CLOSE_ICON_SVG.contains("fill-opacity=\"0.88\""));
        assert!(super::CLOSE_ICON_SVG.contains("M432 432L592 592M592 432L432 592"));
        assert!(super::CLOSE_ICON_SVG.contains("stroke=\"#F7F6FA\""));
        assert!(super::CLOSE_ICON_SVG.contains("stroke-width=\"30\""));
    }

    #[test]
    fn overlay_canvas_maps_disc_to_chip() {
        // 48px chip → canvas 48 * 1024/504 ≈ 98px; disc = 48px.
        let (x, y, size) = super::overlay_rect_from_chip(100, 45, 148, 93);
        assert_eq!(size, 98);
        assert_eq!(x + size / 2, 124);
        assert_eq!(y + size / 2, 69);
    }

    #[test]
    fn rasterizes_premultiplied_bgra() {
        let px = super::rasterize_close_icon(64).expect("svg raster");
        assert_eq!(px.len(), 64 * 64 * 4);
        // Center pixel is inside the disc — alpha must be non-zero.
        let i = (32 * 64 + 32) * 4;
        assert!(px[i + 3] > 0, "disc center alpha");
        // Corner is transparent padding over video.
        assert_eq!(px[3], 0);
    }
}
