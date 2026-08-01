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

use super::{ChromeCutout, HostHandle, VideoHost};
use crate::error::{AppError, ErrorCode};
use serde::Serialize;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, GetStockObject, SetWindowRgn,
    UpdateWindow, BLACK_BRUSH, HBRUSH, HRGN, RGN_DIFF,
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
    HWND_TOP, MSLLHOOKSTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_RESTORE, SW_SHOW, WH_MOUSE_LL, WINDOW_EX_STYLE,
    WM_DESTROY, WM_ERASEBKGND, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEMOVE, WM_NCHITTEST,
    WM_PAINT, WM_RBUTTONDOWN, WM_TIMER, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
    WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
};

const CLASS_NAME: &str = "ReplayMpvHost";
const CLICK_THROUGH_TIMER: usize = 1;

/// Minimum interval between `player://activity` emissions from the mouse hook.
const ACTIVITY_EMIT_MS: u64 = 200;

static ACTIVITY_HOOK: AtomicIsize = AtomicIsize::new(0);
static ACTIVITY_PARENT: AtomicIsize = AtomicIsize::new(0);
static ACTIVITY_APP: OnceLock<AppHandle> = OnceLock::new();
static ACTIVITY_LAST_EMIT: AtomicU64 = AtomicU64::new(0);

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
fn should_force_activate(
    our_contains_pt: bool,
    we_are_foreground: bool,
    hit_belongs_to_us: bool,
    fg_covers_pt: bool,
) -> bool {
    if !our_contains_pt || we_are_foreground {
        return false;
    }
    // Normal hit on our hierarchy, or click-through fell through to a window
    // behind us while no other foreground window covers this pixel.
    hit_belongs_to_us || !fg_covers_pt
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

/// If the user clicked the visible player while another app has focus, raise Replay.
unsafe fn maybe_activate_on_click(parent: HWND, pt: POINT) {
    unsafe {
        if parent.0.is_null() || !IsWindow(Some(parent)).as_bool() {
            return;
        }
        let mut our_rect = RECT::default();
        let _ = GetWindowRect(parent, &mut our_rect);
        let our_contains = pt_in_rect(pt, our_rect);

        let fg = GetForegroundWindow();
        let we_are_fg = !fg.0.is_null() && (fg == parent || IsChild(parent, fg).as_bool());

        let under = WindowFromPoint(pt);
        let under_root = GetAncestor(under, GA_ROOT);
        let hit_belongs_to_us = !under.0.is_null()
            && (under == parent || under_root == parent || IsChild(parent, under).as_bool());

        let mut fg_covers = false;
        if !fg.0.is_null() && fg != parent {
            let mut fg_rect = RECT::default();
            if GetWindowRect(fg, &mut fg_rect).is_ok() {
                fg_covers = pt_in_rect(pt, fg_rect);
            }
        }

        if should_force_activate(our_contains, we_are_fg, hit_belongs_to_us, fg_covers) {
            force_foreground(parent);
        }
    }
}

/// Low-level mouse hook: the HWND_TOP video host swallows pointer input, so the
/// webview never sees mouse movement over the video and chrome can never be
/// revealed. The hook sees all mouse input regardless of which HWND owns it and
/// pokes the frontend to reveal chrome while the cursor is over our window.
/// Clicks also force-activate the top-level window (click-through / NOACTIVATE
/// otherwise leaves Replay behind floating apps like WhatsApp).
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
            let mut rect = RECT::default();
            let pt = unsafe { (*(lparam.0 as *const MSLLHOOKSTRUCT)).pt };
            let inside = unsafe {
                let _ = GetWindowRect(parent, &mut rect);
                pt_in_rect(pt, rect)
            };
            if inside {
                // Activation must not be throttled — every click should raise us.
                if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN {
                    // Hit-test probe for surface-click gating (WH_MOUSE_LL sees global input).
                    let (hit_belongs_to_us, fg_covers) = unsafe {
                        let fg = GetForegroundWindow();
                        let under = WindowFromPoint(pt);
                        let under_root = GetAncestor(under, GA_ROOT);
                        let hit_belongs_to_us = !under.0.is_null()
                            && (under == parent
                                || under_root == parent
                                || IsChild(parent, under).as_bool());
                        let mut fg_covers = false;
                        if !fg.0.is_null() && fg != parent {
                            let mut fg_rect = RECT::default();
                            if GetWindowRect(fg, &mut fg_rect).is_ok() {
                                fg_covers = pt_in_rect(pt, fg_rect);
                            }
                        }
                        (hit_belongs_to_us, fg_covers)
                    };
                    unsafe { maybe_activate_on_click(parent, pt) };
                    // Video host is HWND_TOP and swallows webview clicks; emit so
                    // the frontend can toggle play/pause on the video surface.
                    // Gate: never treat clicks that land on another foreground
                    // window as surface clicks (pt-in-rect alone is not enough —
                    // WH_MOUSE_LL sees global input).
                    if msg == WM_LBUTTONDOWN {
                        let allow_surface = hit_belongs_to_us || !fg_covers;
                        if allow_surface {
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
                }
                let now = now_ms();
                let last = ACTIVITY_LAST_EMIT.load(Ordering::Relaxed);
                if now.saturating_sub(last) >= ACTIVITY_EMIT_MS {
                    ACTIVITY_LAST_EMIT.store(now, Ordering::Relaxed);
                    if let Some(app) = ACTIVITY_APP.get() {
                        let _ = app.emit("player://activity", ());
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
        WM_TIMER => {
            if w.0 == CLICK_THROUGH_TIMER {
                apply_click_through(hwnd);
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
                // Created without WS_VISIBLE — shown explicitly when media plays.
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
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

            bring_above_webview(hwnd);
            apply_click_through(hwnd);
            let _ = ShowWindow(hwnd, SW_HIDE);
            let _ = UpdateWindow(hwnd);

            tracing::info!(
                wid = hwnd.0 as isize,
                parent = parent,
                w,
                h,
                "created Win32 video host on UI thread (HWND_TOP + click-through)"
            );
            Ok(Self {
                hwnd,
                parent: parent_hwnd,
                cutout: ChromeCutout::default(),
            })
        }
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

/// Corner diameter for `CreateRoundRectRgn`, matching CSS `--radius-md` (16px)
/// scaled into the physical menu rect (~10.5rem / 168 CSS px wide).
fn menu_corner_diameter(menu_w: u32, menu_h: u32) -> i32 {
    let shorter = menu_w.min(menu_h).max(1) as f64;
    let radius = (shorter * (16.0 / 168.0)).round() as i32;
    (radius * 2).clamp(24, 48)
}

/// Keep the host full-bleed for correct mpv aspect, but punch out chrome /
/// overlay regions so HTML stays visible above the webview.
///
/// - `top` / `bottom`: full-width strips
/// - `right`: full-height strip below the top cutout (drawers)
/// - `menu_*`: measured ⋯ panel rect, anywhere in the client
fn apply_chrome_cutout(hwnd: HWND, full_w: u32, full_h: u32, cutout: ChromeCutout) {
    unsafe {
        let top = cutout.top.min(full_h.saturating_sub(1));
        let bottom = cutout.bottom.min(full_h.saturating_sub(1 + top));
        let right = cutout.right.min(full_w.saturating_sub(1));
        let menu = menu_hole(full_w, full_h, cutout);
        if top == 0 && bottom == 0 && right == 0 && menu.is_none() {
            // NULL region = window uses its full rectangle again.
            let _ = SetWindowRgn(hwnd, None::<HRGN>, true);
            return;
        }

        let y0 = top as i32;
        let y1 = full_h.saturating_sub(bottom).max(top + 1) as i32;
        let x1 = full_w.saturating_sub(right).max(1) as i32;
        let rgn = CreateRectRgn(0, y0, x1, y1);

        if let Some((mx0, my0, mx1, my1)) = menu {
            // Round the hole to match `.more-panel` border-radius; a sharp rect
            // makes the menu silhouette square against HWND_TOP video.
            let diameter = menu_corner_diameter(cutout.menu_w, cutout.menu_h);
            let hole = CreateRoundRectRgn(mx0, my0, mx1, my1, diameter, diameter);
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
                let _ = KillTimer(Some(self.hwnd), CLICK_THROUGH_TIMER);
                // Park off-screen rather than SW_HIDE — see set_visible.
                let _ = SetWindowRgn(self.hwnd, None::<HRGN>, true);
                let _ = SetWindowPos(
                    self.hwnd,
                    None,
                    -32000,
                    -32000,
                    1,
                    1,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                );
                return Ok(());
            }
            let (full_w, full_h) = parent_client_size(self.parent);
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
            apply_chrome_cutout(self.hwnd, full_w, full_h, self.cutout);
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
            apply_click_through(self.hwnd);
            // Re-apply after libmpv creates its VO child HWND.
            let _ = SetTimer(Some(self.hwnd), CLICK_THROUGH_TIMER, 300, None);
            tracing::info!(
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
            apply_chrome_cutout(self.hwnd, full_w, full_h, self.cutout);
        }
        Ok(())
    }

    fn set_visible(&mut self, visible: bool) -> Result<(), AppError> {
        unsafe {
            if visible {
                let _ = ShowWindow(self.hwnd, SW_SHOW);
                bring_above_webview(self.hwnd);
                apply_click_through(self.hwnd);
                let _ = SetTimer(Some(self.hwnd), CLICK_THROUGH_TIMER, 300, None);
            } else {
                let _ = KillTimer(Some(self.hwnd), CLICK_THROUGH_TIMER);
                // Park off-screen instead of SW_HIDE: mpv keeps presenting to its
                // swapchain while hidden, and its promoted hardware overlay plane
                // lingers on screen painting black over the webview. Parking the
                // window off-screen forces the plane to follow it off-screen.
                let _ = SetWindowRgn(self.hwnd, None::<HRGN>, true);
                let _ = SetWindowPos(
                    self.hwnd,
                    None,
                    -32000,
                    -32000,
                    1,
                    1,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                );
            }
        }
        Ok(())
    }

    fn diagnose(&self) -> String {
        self.diagnose_hwnd()
    }

    fn destroy(&mut self) {
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
    fn menu_corner_diameter_tracks_css_radius_md() {
        // ~168 CSS px panel at 1.25 DPR → physical w ≈ 210 → radius ≈ 20 → diameter 40
        assert_eq!(super::menu_corner_diameter(210, 250), 40);
        assert_eq!(super::menu_corner_diameter(168, 200), 32);
        // Clamp extremes
        assert_eq!(super::menu_corner_diameter(40, 40), 24);
        assert_eq!(super::menu_corner_diameter(2000, 2000), 48);
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
        assert!(super::should_force_activate(true, false, true, true));
        assert!(super::should_force_activate(true, false, true, false));
    }

    #[test]
    fn activates_on_click_through_fallthrough_if_fg_does_not_cover() {
        assert!(super::should_force_activate(true, false, false, false));
    }

    #[test]
    fn does_not_steal_when_floating_fg_covers_click() {
        assert!(!super::should_force_activate(true, false, false, true));
    }

    #[test]
    fn skips_when_already_foreground_or_outside() {
        assert!(!super::should_force_activate(true, true, true, false));
        assert!(!super::should_force_activate(false, false, true, false));
    }
}
