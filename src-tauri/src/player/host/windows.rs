//! Win32 child HWND video host for libmpv `wid` embedding.
//!
//! Architecture notes (Windows + WebView2):
//! - Sibling HWNDs do **not** alpha-blend. A transparent WebView2 region shows
//!   whatever is behind the *parent* window (desktop), not a sibling underneath.
//! - Therefore the video host must sit **above** the WebView2 (`HWND_TOP`).
//! - Shrinking the host height to uncover HTML chrome changes the window aspect
//!   and causes ugly pillarboxing on 16:9 content. Instead the host stays
//!   **full-bleed** and a `SetWindowRgn` cutout reveals the bottom chrome strip.
//! - The host (and libmpv's child VO HWND) must be hit-test transparent so mouse
//!   move can reveal chrome; otherwise a full-bleed VO permanently steals input.
//! - The host is created/resized/destroyed only on the UI thread that owns the
//!   parent Tauri window so VO Win32 messages are pumped normally.

use super::close_overlay::CloseOverlay;
use super::{ChromeCutout, HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};
use parking_lot::Mutex;
use serde::Serialize;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateEllipticRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, GetStockObject,
    SetWindowRgn, BLACK_BRUSH, HBRUSH, HRGN, RGN_DIFF,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CallNextHookEx, CreateWindowExW, DefWindowProcW, DestroyWindow,
    EnumChildWindows, GetAncestor, GetClientRect, GetForegroundWindow, GetWindowLongPtrW,
    GetWindowRect, GetWindowThreadProcessId, IsChild, IsIconic, IsWindow, IsWindowVisible,
    KillTimer, MoveWindow, RegisterClassW, SetForegroundWindow, SetTimer, SetWindowLongPtrW,
    SetWindowPos, SetWindowsHookExW, ShowWindow, UnhookWindowsHookEx, WindowFromPoint, CS_HREDRAW,
    CS_OWNDC, CS_VREDRAW, CW_USEDEFAULT, GA_ROOT, GWL_EXSTYLE, HC_ACTION, HHOOK, HTTRANSPARENT,
    HWND_BOTTOM, HWND_TOP, MSLLHOOKSTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_RESTORE, SW_SHOW, WH_MOUSE_LL,
    WINDOW_EX_STYLE, WM_DESTROY, WM_ERASEBKGND, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEMOVE,
    WM_NCHITTEST, WM_PAINT, WM_RBUTTONDOWN, WM_SIZE, WM_TIMER, WNDCLASSW, WS_CHILD,
    WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
};

const CLASS_NAME: &str = "ReplayMpvHost";
const CLICK_THROUGH_TIMER: usize = 1;
/// Re-apply click-through until libmpv's VO child appears, then stop.
const CLICK_THROUGH_TICKS: u32 = 20;

/// Minimum interval between `player://activity` emissions from the mouse hook.
const ACTIVITY_EMIT_MS: u64 = 200;

static CLICK_THROUGH_LEFT: AtomicU32 = AtomicU32::new(0);
static ACTIVITY_HOOK: AtomicIsize = AtomicIsize::new(0);
static ACTIVITY_PARENT: AtomicIsize = AtomicIsize::new(0);
static ACTIVITY_APP: OnceLock<AppHandle> = OnceLock::new();
static ACTIVITY_LAST_EMIT: AtomicU64 = AtomicU64::new(0);
/// Cached parent window rect (screen px) so the mouse hook avoids GetWindowRect
/// on every system-wide mouse move. Zero width marks it invalid.
static CACHED_RECT: Mutex<RECT> = Mutex::new(RECT {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
});

/// Screen-space click over the Tauri window. Physical px relative to the
/// window's top-left (from `GetWindowRect`), plus window size for DPI mapping.
#[derive(Clone, Serialize)]
struct SurfaceClickPayload {
    x: i32,
    y: i32,
    window_w: i32,
    window_h: i32,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pure decision helper for click-to-foreground (unit-tested).
///
/// The HWND_TOP video host is hit-test transparent / `WS_EX_NOACTIVATE`, so a
/// click on the visible player may never activate the Tauri top-level window.
/// Only raise when `WindowFromPoint` actually hit our HWND tree — never when
/// the click landed on another app, the taskbar, or desktop around us.
fn should_force_activate(
    our_contains_pt: bool,
    we_are_foreground: bool,
    hit_belongs_to_us: bool,
) -> bool {
    our_contains_pt && !we_are_foreground && hit_belongs_to_us
}

/// Play/pause toggle is a focused video-surface click only.
///
/// The activating click on an unfocused window must not toggle (standard
/// desktop-player behavior). Clicks whose hit-test is not our HWND tree
/// (other app, taskbar, Alt-Tab target) must not toggle either — otherwise a
/// paused fullscreen player resumes in the background.
fn should_emit_surface_click(
    our_contains_pt: bool,
    we_are_foreground: bool,
    hit_belongs_to_us: bool,
) -> bool {
    our_contains_pt && we_are_foreground && hit_belongs_to_us
}

fn pt_in_rect(pt: POINT, rect: RECT) -> bool {
    pt.x >= rect.left && pt.x < rect.right && pt.y >= rect.top && pt.y < rect.bottom
}

/// Bring the Tauri top-level window to the foreground (AttachThreadInput dance).
unsafe fn force_foreground(hwnd: HWND) {
    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let fg = GetForegroundWindow();
        if fg == hwnd {
            return;
        }
        let target_tid = GetWindowThreadProcessId(hwnd, None);
        let fg_tid = if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, None)
        } else {
            0
        };
        let cur_tid = GetCurrentThreadId();
        let attached_fg =
            fg_tid != 0 && fg_tid != cur_tid && AttachThreadInput(cur_tid, fg_tid, true).as_bool();
        let attached_target = target_tid != 0
            && target_tid != cur_tid
            && AttachThreadInput(cur_tid, target_tid, true).as_bool();
        let _ = BringWindowToTop(hwnd);
        let _ = SetWindowPos(hwnd, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        let _ = SetForegroundWindow(hwnd);
        if attached_target {
            let _ = AttachThreadInput(cur_tid, target_tid, false);
        }
        if attached_fg {
            let _ = AttachThreadInput(cur_tid, fg_tid, false);
        }
    }
}

unsafe fn we_are_foreground(parent: HWND) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        !fg.0.is_null() && (fg == parent || IsChild(parent, fg).as_bool())
    }
}

unsafe fn hit_belongs_to_us(parent: HWND, pt: POINT) -> bool {
    unsafe {
        let under = WindowFromPoint(pt);
        if under.0.is_null() {
            return false;
        }
        under == parent || GetAncestor(under, GA_ROOT) == parent || IsChild(parent, under).as_bool()
    }
}

/// If the user clicked the visible player while another app has focus, raise Replay.
unsafe fn maybe_activate_on_click(
    parent: HWND,
    our_contains: bool,
    we_are_fg: bool,
    hit_ours: bool,
) {
    if should_force_activate(our_contains, we_are_fg, hit_ours) {
        unsafe { force_foreground(parent) };
    }
}

/// Cached parent window rect for the mouse hook. O(1) containment checks on
/// every system-wide mouse move; `GetWindowRect` is only re-queried when the
/// cache is invalidated (window resized/moved/visibility changed).
fn cached_parent_rect(parent: HWND, live: bool) -> RECT {
    let mut cached = CACHED_RECT.lock();
    if !live {
        *cached = RECT::default();
        return *cached;
    }
    if cached.right <= cached.left || cached.bottom <= cached.top {
        let mut fresh = RECT::default();
        unsafe {
            let _ = GetWindowRect(parent, &mut fresh);
        }
        *cached = fresh;
    }
    *cached
}

/// Invalidate the cached rect — call after the window moves or resizes.
pub fn invalidate_activity_rect() {
    *CACHED_RECT.lock() = RECT::default();
}

/// Low-level mouse hook: the HWND_TOP video host swallows pointer input, so the
/// webview never sees mouse movement over the video and chrome can never be
/// revealed. The hook sees all mouse input regardless of which HWND owns it and
/// pokes the frontend to reveal chrome while the cursor is over our window.
/// Clicks raise Replay only when the hit-test is our HWND tree (click-through /
/// NOACTIVATE otherwise leaves Replay behind floating apps like WhatsApp).
/// Play/pause is a separate, focused-only surface click — never the click that
/// switches away to another application.
unsafe extern "system" fn activity_mouse_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HC_ACTION as i32 {
        let msg = wparam.0 as u32;
        if msg == WM_MOUSEMOVE
            || msg == WM_LBUTTONDOWN
            || msg == WM_RBUTTONDOWN
            || msg == WM_MBUTTONDOWN
        {
            let parent = HWND(ACTIVITY_PARENT.load(Ordering::Relaxed) as *mut _);
            let pt = unsafe { (*(lparam.0 as *const MSLLHOOKSTRUCT)).pt };
            let live = unsafe {
                !parent.0.is_null()
                    && IsWindow(Some(parent)).as_bool()
                    && IsWindowVisible(parent).as_bool()
                    && !IsIconic(parent).as_bool()
            };
            let rect = cached_parent_rect(parent, live);
            let inside = live && pt_in_rect(pt, rect);
            if inside {
                let hit_ours = unsafe { hit_belongs_to_us(parent, pt) };
                let close_hit = super::close_overlay::owns_screen_point(pt);
                // Activation must not be throttled — every click on *us* should raise us.
                if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN {
                    // Read focus *before* raising, so the activating click cannot
                    // also toggle play/pause.
                    let we_are_fg = unsafe { we_are_foreground(parent) };
                    unsafe {
                        maybe_activate_on_click(parent, true, we_are_fg, hit_ours || close_hit)
                    };
                    if msg == WM_LBUTTONDOWN && close_hit {
                        // Layered close popup sits above the video host, so the
                        // webview never receives the click. Do not toggle pause.
                        if let Some(app) = ACTIVITY_APP.get() {
                            let _ = app.emit("player://close-fullscreen", ());
                        }
                    } else if msg == WM_LBUTTONDOWN
                        && should_emit_surface_click(true, we_are_fg, hit_ours)
                    {
                        // Video host is HWND_TOP and swallows webview clicks; emit so
                        // the frontend can toggle play/pause on the video surface.
                        if let Some(app) = ACTIVITY_APP.get() {
                            let payload = SurfaceClickPayload {
                                x: pt.x - rect.left,
                                y: pt.y - rect.top,
                                window_w: rect.right - rect.left,
                                window_h: rect.bottom - rect.top,
                            };
                            let _ = app.emit("player://surface-click", &payload);
                        }
                    }
                }
                if hit_ours || close_hit {
                    let now = now_ms();
                    let last = ACTIVITY_LAST_EMIT.load(Ordering::Relaxed);
                    if now.saturating_sub(last) >= ACTIVITY_EMIT_MS {
                        ACTIVITY_LAST_EMIT.store(now, Ordering::Relaxed);
                        if let Some(app) = ACTIVITY_APP.get() {
                            let payload = SurfaceClickPayload {
                                x: pt.x - rect.left,
                                y: pt.y - rect.top,
                                window_w: rect.right - rect.left,
                                window_h: rect.bottom - rect.top,
                            };
                            let _ = app.emit("player://activity", &payload);
                        }
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Install the global low-level mouse hook on the UI thread (has a message loop).
pub fn install_activity_hook(parent_wid: i64, app: AppHandle) {
    ACTIVITY_PARENT.store(parent_wid as isize, Ordering::Relaxed);
    let _ = ACTIVITY_APP.set(app);
    if ACTIVITY_HOOK.load(Ordering::Relaxed) != 0 {
        return;
    }
    unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(activity_mouse_proc), None, 0) {
            Ok(hook) => {
                ACTIVITY_HOOK.store(hook.0 as isize, Ordering::Relaxed);
                tracing::info!("installed low-level mouse activity hook");
            }
            Err(err) => {
                tracing::warn!(error = %err, "SetWindowsHookExW(WH_MOUSE_LL) failed");
            }
        }
    }
}

pub fn uninstall_activity_hook() {
    let raw = ACTIVITY_HOOK.swap(0, Ordering::Relaxed);
    if raw != 0 {
        unsafe {
            let _ = UnhookWindowsHookEx(HHOOK(raw as *mut _));
        }
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => LRESULT(0),
        WM_SIZE => {
            let width = (l.0 as u32) & 0xFFFF;
            let height = ((l.0 as u32) >> 16) & 0xFFFF;
            if width > 0 && height > 0 {
                resize_children(hwnd, width, height);
            }
            LRESULT(0)
        }
        WM_TIMER => {
            if w.0 == CLICK_THROUGH_TIMER {
                apply_click_through(hwnd);
                let left = CLICK_THROUGH_LEFT.load(Ordering::Relaxed);
                if left <= 1 {
                    CLICK_THROUGH_LEFT.store(0, Ordering::Relaxed);
                    let _ = KillTimer(Some(hwnd), CLICK_THROUGH_TIMER);
                } else {
                    CLICK_THROUGH_LEFT.store(left - 1, Ordering::Relaxed);
                }
            }
            LRESULT(0)
        }
        // Click-through so the HTML overlay receives mouse move / controls while the
        // video host stays visually on top (HWND_TOP).
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_ERASEBKGND => LRESULT(1),
        WM_PAINT => {
            let mut ps = windows::Win32::Graphics::Gdi::PAINTSTRUCT::default();
            let _ = windows::Win32::Graphics::Gdi::BeginPaint(hwnd, &mut ps);
            let _ = windows::Win32::Graphics::Gdi::EndPaint(hwnd, &ps);
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, w, l) },
    }
}

unsafe extern "system" fn enum_resize_child(child: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let w = (lparam.0 as u32) & 0xFFFF;
        let h = ((lparam.0 as u32) >> 16) & 0xFFFF;
        let _ = MoveWindow(child, 0, 0, w as i32, h as i32, true);
    }
    BOOL(1)
}

fn resize_children(hwnd: HWND, w: u32, h: u32) {
    unsafe {
        let lparam = LPARAM(((h & 0xFFFF) << 16 | (w & 0xFFFF)) as isize);
        let _ = EnumChildWindows(Some(hwnd), Some(enum_resize_child), lparam);
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// Make `hwnd` (and descendants) ignore hit-testing so WebView2 receives the mouse.
fn apply_click_through(root: HWND) {
    unsafe {
        apply_click_through_one(root);
        let _ = EnumChildWindows(Some(root), Some(enum_click_through), LPARAM(0));
    }
}

unsafe extern "system" fn enum_click_through(hwnd: HWND, _lparam: LPARAM) -> BOOL {
    unsafe {
        apply_click_through_one(hwnd);
    }
    BOOL(1)
}

/// Returns true when the style was modified (i.e. transparency had been lost).
unsafe fn apply_click_through_one(hwnd: HWND) -> bool {
    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        let prev = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next = prev | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0;
        if next != prev {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
            return true;
        }
        false
    }
}

pub struct WindowsVideoHost {
    hwnd: HWND,
    parent: HWND,
    cutout: ChromeCutout,
    close_overlay: CloseOverlay,
}

// Safety: HWND methods are only invoked from the UI thread that created it.
unsafe impl Send for WindowsVideoHost {}

impl WindowsVideoHost {
    /// Create a child video host under `parent`. Must run on the UI thread.
    /// Starts hidden — UI shows it once media is active and bounds are synced.
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
            let black = HBRUSH(GetStockObject(BLACK_BRUSH).0);
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW | CS_OWNDC,
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR(class.as_ptr()),
                hbrBackground: black,
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

            let title = to_wide("Replay Video");
            let hwnd = CreateWindowExW(
                WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
                PCWSTR(class.as_ptr()),
                PCWSTR(title.as_ptr()),
                // Start parked below WebView2. Creating this full-client or raising
                // it before mpv attaches can leave a promoted black D3D plane above
                // the webview even after the HWND is hidden.
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                -32000,
                -32000,
                1,
                1,
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

            // A hidden host must also be below WebView2 in Z-order. Geometry alone
            // is insufficient for D3D hardware-overlay planes.
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                -32000,
                -32000,
                1,
                1,
                SWP_NOACTIVATE,
            );
            apply_click_through(hwnd);
            let _ = ShowWindow(hwnd, SW_HIDE);

            tracing::info!(
                wid = hwnd.0 as isize,
                parent = parent,
                requested_w = w,
                requested_h = h,
                "created Win32 video host parked off-screen at HWND_BOTTOM"
            );
            Ok(Self {
                hwnd,
                parent: parent_hwnd,
                cutout: ChromeCutout::default(),
                close_overlay: CloseOverlay::create(parent_hwnd),
            })
        }
    }

    fn sync_close_overlay(&mut self, full_w: u32, full_h: u32) -> bool {
        let overlay_shown = match menu_hole(full_w, full_h, self.cutout) {
            Some((x0, y0, x1, y1))
                if is_circular_chip((x1 - x0).max(0) as u32, (y1 - y0).max(0) as u32) =>
            {
                self.close_overlay.show_chip((x0, y0, x1, y1))
            }
            _ => {
                self.close_overlay.hide();
                false
            }
        };
        if overlay_shown {
            self.close_overlay.raise();
        }
        overlay_shown
    }

    pub fn diagnose_hwnd(&self) -> String {
        unsafe {
            if self.hwnd.0.is_null() || !IsWindow(Some(self.hwnd)).as_bool() {
                return "video_host: invalid".into();
            }
            let mut rect = RECT::default();
            let _ = GetClientRect(self.hwnd, &mut rect);
            let visible = IsWindowVisible(self.hwnd).as_bool();
            format!(
                "video_host: hwnd={:?} visible={} client={}x{} parent={:?}",
                self.hwnd.0,
                visible,
                (rect.right - rect.left).max(0),
                (rect.bottom - rect.top).max(0),
                self.parent.0
            )
        }
    }
}

fn bring_above_webview(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

fn parent_client_size(parent: HWND) -> (u32, u32) {
    unsafe {
        let mut rect = RECT::default();
        let _ = GetClientRect(parent, &mut rect);
        (
            (rect.right - rect.left).max(1) as u32,
            (rect.bottom - rect.top).max(1) as u32,
        )
    }
}

/// The ⋯ menu hole clamped to the client, as `(x0, y0, x1, y1)`.
///
/// The panel floats inside the centred control bar, so the frontend measures it
/// and sends absolute client coordinates — never assume a window corner.
fn menu_hole(full_w: u32, full_h: u32, cutout: ChromeCutout) -> Option<(i32, i32, i32, i32)> {
    if cutout.menu_w == 0 || cutout.menu_h == 0 {
        return None;
    }
    let x0 = cutout.menu_x.min(full_w);
    let y0 = cutout.menu_y.min(full_h);
    let x1 = cutout.menu_x.saturating_add(cutout.menu_w).min(full_w);
    let y1 = cutout.menu_y.saturating_add(cutout.menu_h).min(full_h);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some((x0 as i32, y0 as i32, x1 as i32, y1 as i32))
}

/// True for the fullscreen close chip: small and within 15% of square.
fn is_circular_chip(menu_w: u32, menu_h: u32) -> bool {
    let shorter = menu_w.min(menu_h).max(1);
    let longer = menu_w.max(menu_h).max(1);
    shorter <= 128 && longer.saturating_mul(100) <= shorter.saturating_mul(115)
}

fn square_hole(mx0: i32, my0: i32, mx1: i32, my1: i32) -> (i32, i32, i32, i32) {
    let w = mx1 - mx0;
    let h = my1 - my0;
    let side = w.max(h);
    let cx = mx0 + w / 2;
    let cy = my0 + h / 2;
    let x0 = cx - side / 2;
    let y0 = cy - side / 2;
    (x0, y0, x0 + side, y0 + side)
}

/// Corner diameter for `CreateRoundRectRgn` on rectangular overlay panels.
///
/// Circular close chips are painted by the layered SVG overlay (per-pixel AA).
/// Rectangular panels still use `CreateRoundRectRgn`.
fn menu_corner_diameter(menu_w: u32, menu_h: u32) -> i32 {
    let shorter = menu_w.min(menu_h).max(1);
    let radius = (shorter as f64 * (8.0 / 168.0)).round() as i32;
    (radius * 2).clamp(16, 24)
}

/// Keep the host full-bleed for correct mpv aspect, but punch out chrome /
/// overlay regions so HTML stays visible above the webview.
///
/// - `top` / `bottom`: full-width strips
/// - `right`: full-height strip below the top cutout (drawers)
/// - `menu_*`: measured ⋯ panel rect, anywhere in the client
fn apply_chrome_cutout(
    hwnd: HWND,
    full_w: u32,
    full_h: u32,
    cutout: ChromeCutout,
    svg_overlay_owns_chip: bool,
) {
    unsafe {
        let top = cutout.top.min(full_h.saturating_sub(1));
        let bottom = cutout.bottom.min(full_h.saturating_sub(1 + top));
        let right = cutout.right.min(full_w.saturating_sub(1));
        let menu = menu_hole(full_w, full_h, cutout);
        let menu_for_region = match menu {
            Some((mx0, my0, mx1, my1)) => {
                let hole_w = (mx1 - mx0).max(0) as u32;
                let hole_h = (my1 - my0).max(0) as u32;
                if svg_overlay_owns_chip && is_circular_chip(hole_w, hole_h) {
                    None
                } else {
                    Some((mx0, my0, mx1, my1))
                }
            }
            None => None,
        };
        if top == 0 && bottom == 0 && right == 0 && menu_for_region.is_none() {
            // NULL region = window uses its full rectangle again.
            let _ = SetWindowRgn(hwnd, None::<HRGN>, true);
            return;
        }

        let y0 = top as i32;
        let y1 = full_h.saturating_sub(bottom).max(top + 1) as i32;
        let x1 = full_w.saturating_sub(right).max(1) as i32;
        let rgn = CreateRectRgn(0, y0, x1, y1);

        if let Some((mx0, my0, mx1, my1)) = menu_for_region {
            let hole_w = (mx1 - mx0).max(0) as u32;
            let hole_h = (my1 - my0).max(0) as u32;
            let hole = if is_circular_chip(hole_w, hole_h) {
                // Fallback only: 1-bit ellipse when the SVG overlay could not
                // be created. Prefer the layered close_icon.svg overlay.
                let (x0, y0, x1, y1) = square_hole(mx0, my0, mx1, my1);
                CreateEllipticRgn(x0, y0, x1, y1)
            } else {
                let diameter = menu_corner_diameter(cutout.menu_w, cutout.menu_h);
                CreateRoundRectRgn(mx0, my0, mx1, my1, diameter, diameter)
            };
            let _ = CombineRgn(Some(rgn), Some(rgn), Some(hole), RGN_DIFF);
            let _ = DeleteObject(hole.into());
        }

        // SetWindowRgn takes ownership of the HRGN.
        let _ = SetWindowRgn(hwnd, Some(rgn), true);
    }
}

impl VideoHost for WindowsVideoHost {
    fn handle(&self) -> HostHandle {
        HostHandle {
            wid: self.hwnd.0 as i64,
        }
    }

    fn set_bounds(&mut self, _x: i32, _y: i32, w: u32, h: u32) -> Result<(), AppError> {
        unsafe {
            if w == 0 || h == 0 {
                self.close_overlay.hide();
                let _ = KillTimer(Some(self.hwnd), CLICK_THROUGH_TIMER);
                // Park off-screen and hide
                let _ = SetWindowRgn(self.hwnd, None::<HRGN>, true);
                let _ = SetWindowPos(
                    self.hwnd,
                    Some(HWND_BOTTOM),
                    -32000,
                    -32000,
                    1,
                    1,
                    SWP_NOACTIVATE,
                );
                let _ = ShowWindow(self.hwnd, SW_HIDE);
                return Ok(());
            }
            let (full_w, full_h) = parent_client_size(self.parent);
            if full_w == 0 || full_h == 0 {
                return Ok(());
            }
            // Always size to the parent client so mpv keeps the real window aspect.
            // chrome cutouts drive the SetWindowRgn region.
            let mv = MoveWindow(self.hwnd, 0, 0, full_w as i32, full_h as i32, true);
            mv.map_err(|e| {
                AppError::new(
                    ErrorCode::RenderHost,
                    format!("MoveWindow failed: {e}"),
                    true,
                )
            })?;
            resize_children(self.hwnd, full_w, full_h);
            let overlay_shown = self.sync_close_overlay(full_w, full_h);
            apply_chrome_cutout(self.hwnd, full_w, full_h, self.cutout, overlay_shown);
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_TOP),
                0,
                0,
                full_w as i32,
                full_h as i32,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(self.hwnd, SW_SHOW);
            if overlay_shown {
                self.close_overlay.raise();
            }
            apply_click_through(self.hwnd);
            // Re-apply until libmpv creates its VO child HWND, then stop.
            CLICK_THROUGH_LEFT.store(CLICK_THROUGH_TICKS, Ordering::Relaxed);
            let _ = SetTimer(Some(self.hwnd), CLICK_THROUGH_TIMER, 300, None);
            tracing::debug!(
                full_w,
                full_h,
                cutout = ?self.cutout,
                diag = %self.diagnose_hwnd(),
                "video host full-bleed with chrome cutout"
            );
        }
        Ok(())
    }

    fn set_chrome_cutout(&mut self, cutout: ChromeCutout) -> Result<(), AppError> {
        self.cutout = cutout;
        // Re-apply region if the host is already sized.
        let (full_w, full_h) = parent_client_size(self.parent);
        if full_w > 0 && full_h > 0 {
            let overlay_shown = self.sync_close_overlay(full_w, full_h);
            apply_chrome_cutout(self.hwnd, full_w, full_h, self.cutout, overlay_shown);
        }
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        unsafe {
            if visible {
                let _ = ShowWindow(self.hwnd, SW_SHOW);
                bring_above_webview(self.hwnd);
                self.close_overlay.raise();
                apply_click_through(self.hwnd);
                CLICK_THROUGH_LEFT.store(CLICK_THROUGH_TICKS, Ordering::Relaxed);
                let _ = SetTimer(Some(self.hwnd), CLICK_THROUGH_TIMER, 300, None);
            } else {
                self.close_overlay.hide();
                CLICK_THROUGH_LEFT.store(0, Ordering::Relaxed);
                let _ = KillTimer(Some(self.hwnd), CLICK_THROUGH_TIMER);
                // Park off-screen and hide so it never covers the webview.
                let _ = SetWindowRgn(self.hwnd, None::<HRGN>, true);
                let _ = SetWindowPos(
                    self.hwnd,
                    Some(HWND_BOTTOM),
                    -32000,
                    -32000,
                    1,
                    1,
                    SWP_NOACTIVATE,
                );
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
        }
        Ok(())
    }

    fn diagnose(&self) -> String {
        self.diagnose_hwnd()
    }

    fn destroy(&mut self) {
        self.close_overlay.destroy();
        unsafe {
            if !self.hwnd.0.is_null() {
                let _ = KillTimer(Some(self.hwnd), CLICK_THROUGH_TIMER);
                let _ = DestroyWindow(self.hwnd);
            }
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

#[allow(dead_code)]
const _: i32 = CW_USEDEFAULT;
// Keep WINDOW_EX_STYLE referenced for clarity in CreateWindowEx call site.
#[allow(dead_code)]
fn _ex_style_default() -> WINDOW_EX_STYLE {
    WINDOW_EX_STYLE::default()
}

#[cfg(test)]
mod tests {
    use super::ChromeCutout;

    #[test]
    fn class_name_is_stable() {
        assert_eq!(super::CLASS_NAME, "ReplayMpvHost");
    }

    #[test]
    fn menu_corner_diameter_tracks_css_radius_8px() {
        // 8px CSS radius on a ~168 CSS px panel.
        // 168 CSS at 1.25 DPR → physical w ≈ 210 → radius 10 → diameter 20
        assert_eq!(super::menu_corner_diameter(210, 250), 20);
        assert_eq!(super::menu_corner_diameter(168, 200), 16);
        assert_eq!(super::menu_corner_diameter(2000, 2000), 24);
    }

    #[test]
    fn small_near_square_overlay_is_a_circular_chip() {
        assert!(super::is_circular_chip(40, 40));
        assert!(super::is_circular_chip(72, 72));
        assert!(super::is_circular_chip(50, 48));
        assert!(!super::is_circular_chip(210, 250));
        assert!(!super::is_circular_chip(2000, 2000));
    }

    #[test]
    fn square_hole_expands_a_1px_off_rect_to_a_circle_bounds() {
        // 40×41 → 41×41 square centered on the original rect.
        assert_eq!(super::square_hole(10, 20, 50, 61), (10, 20, 51, 61));
        assert_eq!(super::square_hole(0, 0, 40, 40), (0, 0, 40, 40));
    }

    #[test]
    fn menu_hole_uses_measured_position_not_window_corner() {
        let cutout = ChromeCutout {
            bottom: 98,
            menu_x: 1386,
            menu_y: 700,
            menu_w: 220,
            menu_h: 200,
            ..Default::default()
        };
        assert_eq!(
            super::menu_hole(1920, 1080, cutout),
            Some((1386, 700, 1606, 900))
        );
    }

    #[test]
    fn menu_hole_clamps_to_client() {
        let cutout = ChromeCutout {
            menu_x: 1800,
            menu_y: 1000,
            menu_w: 400,
            menu_h: 400,
            ..Default::default()
        };
        assert_eq!(
            super::menu_hole(1920, 1080, cutout),
            Some((1800, 1000, 1920, 1080))
        );
    }

    #[test]
    fn menu_hole_absent_when_empty_or_offscreen() {
        assert_eq!(super::menu_hole(1920, 1080, ChromeCutout::default()), None);
        let offscreen = ChromeCutout {
            menu_x: 2000,
            menu_y: 100,
            menu_w: 220,
            menu_h: 200,
            ..Default::default()
        };
        assert_eq!(super::menu_hole(1920, 1080, offscreen), None);
    }

    #[test]
    fn activates_when_click_hits_our_window() {
        assert!(super::should_force_activate(true, false, true));
    }

    #[test]
    fn does_not_steal_when_hit_is_not_ours() {
        // Other app, taskbar, or desktop around a fullscreen player.
        assert!(!super::should_force_activate(true, false, false));
    }

    #[test]
    fn skips_when_already_foreground_or_outside() {
        assert!(!super::should_force_activate(true, true, true));
        assert!(!super::should_force_activate(false, false, true));
    }

    #[test]
    fn surface_click_only_when_focused_and_hit_is_ours() {
        assert!(super::should_emit_surface_click(true, true, true));
        // Click that leaves Replay (other window still geometrically inside our rect).
        assert!(!super::should_emit_surface_click(true, true, false));
        // First click on an unfocused player: raise, don't toggle.
        assert!(!super::should_emit_surface_click(true, false, true));
        assert!(!super::should_emit_surface_click(true, false, false));
        assert!(!super::should_emit_surface_click(false, true, true));
    }
}
