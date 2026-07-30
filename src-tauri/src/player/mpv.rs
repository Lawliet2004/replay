//! Dynamic libmpv client bindings (LGPL DLL on Windows; system/dylib elsewhere).
//!
//! Uses the same C ABI as `libmpv2-sys` via `libloading` so Windows MSVC builds
//! can load MinGW-produced `libmpv-2.dll` without an import library mismatch.

use crate::error::{AppError, ErrorCode};
use libloading::Library;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::PathBuf;
use std::ptr;
use std::sync::Arc;

pub type MpvHandle = *mut c_void;

const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_EVENT_SEEK: c_int = 20;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

type FnCreate = unsafe extern "C" fn() -> MpvHandle;
type FnInitialize = unsafe extern "C" fn(MpvHandle) -> c_int;
type FnDestroy = unsafe extern "C" fn(MpvHandle);
type FnCommand = unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int;
type FnSetProperty = unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type FnGetProperty = unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type FnObserveProperty = unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int;
type FnWaitEvent = unsafe extern "C" fn(MpvHandle, f64) -> *mut MpvEvent;
type FnTerminateDestroy = unsafe extern "C" fn(MpvHandle);
type FnFree = unsafe extern "C" fn(*mut c_void);
type FnErrorString = unsafe extern "C" fn(c_int) -> *const c_char;

struct Api {
    _lib: Library,
    create: FnCreate,
    initialize: FnInitialize,
    destroy: FnDestroy,
    terminate_destroy: FnTerminateDestroy,
    command: FnCommand,
    set_property: FnSetProperty,
    get_property: FnGetProperty,
    observe_property: FnObserveProperty,
    wait_event: FnWaitEvent,
    free: FnFree,
    error_string: FnErrorString,
}

impl Api {
    unsafe fn load(path: &PathBuf) -> Result<Self, AppError> {
        let lib = Library::new(path).map_err(|e| {
            AppError::new(
                ErrorCode::EngineMissing,
                format!("Failed to load libmpv: {e}"),
                false,
            )
        })?;

        unsafe fn sym<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, AppError> {
            let s = lib.get::<T>(name).map_err(|e| {
                AppError::new(
                    ErrorCode::EngineMissing,
                    format!("Missing libmpv symbol: {e}"),
                    false,
                )
            })?;
            Ok(*s)
        }

        Ok(Self {
            create: sym(&lib, b"mpv_create\0")?,
            initialize: sym(&lib, b"mpv_initialize\0")?,
            destroy: sym(&lib, b"mpv_destroy\0")?,
            terminate_destroy: sym(&lib, b"mpv_terminate_destroy\0")?,
            command: sym(&lib, b"mpv_command\0")?,
            set_property: sym(&lib, b"mpv_set_property\0")?,
            get_property: sym(&lib, b"mpv_get_property\0")?,
            observe_property: sym(&lib, b"mpv_observe_property\0")?,
            wait_event: sym(&lib, b"mpv_wait_event\0")?,
            free: sym(&lib, b"mpv_free\0")?,
            error_string: sym(&lib, b"mpv_error_string\0")?,
            _lib: lib,
        })
    }
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(p) = std::env::var("REPLAY_LIBMPV_PATH") {
        paths.push(PathBuf::from(p));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("libmpv-2.dll"));
            paths.push(dir.join("mpv-2.dll"));
            paths.push(dir.join("libmpv.so.2"));
            paths.push(dir.join("libmpv.dylib"));
        }
    }
    // Dev layout
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    paths.push(manifest.join("../native-deps/windows-x64/bin/libmpv-2.dll"));
    paths.push(manifest.join("../native-deps/linux-x64/lib/libmpv.so.2"));
    paths.push(manifest.join("../native-deps/macos-universal/lib/libmpv.dylib"));
    #[cfg(windows)]
    {
        paths.push(PathBuf::from("libmpv-2.dll"));
        paths.push(PathBuf::from("mpv-2.dll"));
    }
    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("libmpv.so.2"));
        paths.push(PathBuf::from("/usr/lib/libmpv.so.2"));
        paths.push(PathBuf::from("/usr/lib/x86_64-linux-gnu/libmpv.so.2"));
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("libmpv.dylib"));
        paths.push(PathBuf::from("/opt/homebrew/lib/libmpv.dylib"));
        paths.push(PathBuf::from("/usr/local/lib/libmpv.dylib"));
    }
    paths
}

fn load_api() -> Result<Arc<Api>, AppError> {
    let mut last = AppError::new(
        ErrorCode::EngineMissing,
        "libmpv was not found. Run `npm run native:fetch` on Windows or install libmpv.",
        false,
    );
    for path in candidate_paths() {
        if !path.exists() {
            continue;
        }
        match unsafe { Api::load(&path) } {
            Ok(api) => {
                tracing::info!(path = %path.display(), "loaded libmpv");
                return Ok(Arc::new(api));
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

pub struct Mpv {
    api: Arc<Api>,
    handle: MpvHandle,
}

#[derive(Debug, Clone)]
pub enum MpvClientEvent {
    None,
    Shutdown,
    FileLoaded,
    EndFile { reason: i32, error: i32 },
    PlaybackRestart,
    Seek,
    PropertyChange { name: String },
    Other(i32),
}

impl Mpv {
    pub fn new() -> Result<Self, AppError> {
        let api = load_api()?;
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(AppError::new(
                ErrorCode::EngineInit,
                "mpv_create returned null.",
                false,
            ));
        }
        let mpv = Self { api, handle };
        mpv.apply_safe_defaults()?;
        mpv.check(unsafe { (mpv.api.initialize)(mpv.handle) }, "initialize")?;
        Ok(mpv)
    }

    fn apply_safe_defaults(&self) -> Result<(), AppError> {
        // Disable external config/scripts/default bindings/OSC/ytdl
        self.set_flag("config", false)?;
        self.set_flag("load-scripts", false)?;
        self.set_string("input-default-bindings", "no")?;
        self.set_string("input-vo-keyboard", "no")?;
        self.set_string("osc", "no")?;
        self.set_string("ytdl", "no")?;
        self.set_string("hwdec", "auto-safe")?;
        self.set_string("keep-open", "yes")?;
        self.set_string("idle", "yes")?;
        self.set_string("force-window", "no")?;
        self.set_string("terminal", "no")?;
        self.set_string("msg-level", "all=error")?;
        self.set_string("sub-auto", "fuzzy")?;
        self.set_string("audio-display", "no")?;
        Ok(())
    }

    pub fn set_wid(&self, wid: i64) -> Result<(), AppError> {
        self.set_int64("wid", wid)
    }

    pub fn command(&self, args: &[&str]) -> Result<(), AppError> {
        let c_args: Vec<CString> = args
            .iter()
            .map(|s| {
                CString::new(*s)
                    .map_err(|_| AppError::new(ErrorCode::CommandRejected, "NUL in command", true))
            })
            .collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(ptr::null());
        self.check(
            unsafe { (self.api.command)(self.handle, ptrs.as_ptr()) },
            "command",
        )
    }

    pub fn loadfile(&self, path: &str) -> Result<(), AppError> {
        self.command(&["loadfile", path, "replace"])
    }

    pub fn stop(&self) -> Result<(), AppError> {
        self.command(&["stop"])
    }

    pub fn set_pause(&self, paused: bool) -> Result<(), AppError> {
        self.set_flag("pause", paused)
    }

    pub fn seek_absolute(&self, secs: f64) -> Result<(), AppError> {
        self.command(&["seek", &format!("{secs}"), "absolute"])
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), AppError> {
        self.set_double("volume", volume.clamp(0.0, 150.0))
    }

    pub fn set_mute(&self, muted: bool) -> Result<(), AppError> {
        self.set_flag("mute", muted)
    }

    pub fn set_speed(&self, speed: f64) -> Result<(), AppError> {
        self.set_double("speed", speed.clamp(0.25, 3.0))
    }

    pub fn set_sub_delay(&self, secs: f64) -> Result<(), AppError> {
        self.set_double("sub-delay", secs)
    }

    pub fn set_sub_scale(&self, scale: f64) -> Result<(), AppError> {
        self.set_double("sub-scale", scale.clamp(0.5, 3.0))
    }

    pub fn set_sub_pos(&self, pos: f64) -> Result<(), AppError> {
        self.set_double("sub-pos", pos.clamp(0.0, 100.0))
    }

    pub fn set_sid(&self, id: Option<i64>) -> Result<(), AppError> {
        match id {
            Some(id) => self.set_int64("sid", id),
            None => self.set_string("sid", "no"),
        }
    }

    pub fn set_aid(&self, id: Option<i64>) -> Result<(), AppError> {
        match id {
            Some(id) => self.set_int64("aid", id),
            None => self.set_string("aid", "no"),
        }
    }

    pub fn add_sub(&self, path: &str) -> Result<(), AppError> {
        self.command(&["sub-add", path])
    }

    pub fn observe_core_props(&self) -> Result<(), AppError> {
        for (name, fmt) in [
            ("time-pos", MPV_FORMAT_DOUBLE),
            ("duration", MPV_FORMAT_DOUBLE),
            ("pause", MPV_FORMAT_FLAG),
            ("eof-reached", MPV_FORMAT_FLAG),
            ("core-idle", MPV_FORMAT_FLAG),
            ("seeking", MPV_FORMAT_FLAG),
            ("volume", MPV_FORMAT_DOUBLE),
            ("mute", MPV_FORMAT_FLAG),
            ("speed", MPV_FORMAT_DOUBLE),
            ("track-list", MPV_FORMAT_STRING),
            ("media-title", MPV_FORMAT_STRING),
        ] {
            let cname = CString::new(name).unwrap();
            self.check(
                unsafe { (self.api.observe_property)(self.handle, 0, cname.as_ptr(), fmt) },
                "observe_property",
            )?;
        }
        Ok(())
    }

    pub fn get_double(&self, name: &str) -> Result<f64, AppError> {
        let cname = CString::new(name).unwrap();
        let mut out = 0.0f64;
        self.check(
            unsafe {
                (self.api.get_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_DOUBLE,
                    &mut out as *mut f64 as *mut c_void,
                )
            },
            name,
        )?;
        Ok(out)
    }

    pub fn get_flag(&self, name: &str) -> Result<bool, AppError> {
        let cname = CString::new(name).unwrap();
        let mut out: c_int = 0;
        self.check(
            unsafe {
                (self.api.get_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_FLAG,
                    &mut out as *mut c_int as *mut c_void,
                )
            },
            name,
        )?;
        Ok(out != 0)
    }

    pub fn get_string(&self, name: &str) -> Result<Option<String>, AppError> {
        let cname = CString::new(name).unwrap();
        let mut out: *mut c_char = ptr::null_mut();
        let status = unsafe {
            (self.api.get_property)(
                self.handle,
                cname.as_ptr(),
                MPV_FORMAT_STRING,
                &mut out as *mut *mut c_char as *mut c_void,
            )
        };
        if status < 0 {
            return Ok(None);
        }
        if out.is_null() {
            return Ok(None);
        }
        let s = unsafe { CStr::from_ptr(out) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.api.free)(out as *mut c_void) };
        Ok(Some(s))
    }

    pub fn wait_event(&self, timeout: f64) -> MpvClientEvent {
        let ev = unsafe { (self.api.wait_event)(self.handle, timeout) };
        if ev.is_null() {
            return MpvClientEvent::None;
        }
        let ev = unsafe { &*ev };
        match ev.event_id {
            MPV_EVENT_NONE => MpvClientEvent::None,
            MPV_EVENT_SHUTDOWN => MpvClientEvent::Shutdown,
            MPV_EVENT_FILE_LOADED => MpvClientEvent::FileLoaded,
            MPV_EVENT_END_FILE => {
                let data = if ev.data.is_null() {
                    MpvEventEndFile {
                        reason: 0,
                        error: 0,
                    }
                } else {
                    unsafe { *(ev.data as *const MpvEventEndFile) }
                };
                MpvClientEvent::EndFile {
                    reason: data.reason,
                    error: data.error,
                }
            }
            MPV_EVENT_PLAYBACK_RESTART => MpvClientEvent::PlaybackRestart,
            MPV_EVENT_SEEK => MpvClientEvent::Seek,
            MPV_EVENT_PROPERTY_CHANGE => {
                let name = if ev.data.is_null() {
                    String::new()
                } else {
                    let prop = unsafe { &*(ev.data as *const MpvEventProperty) };
                    if prop.name.is_null() {
                        String::new()
                    } else {
                        unsafe { CStr::from_ptr(prop.name) }
                            .to_string_lossy()
                            .into_owned()
                    }
                };
                MpvClientEvent::PropertyChange { name }
            }
            other => MpvClientEvent::Other(other),
        }
    }

    pub fn retry_software_decode(&self) -> Result<(), AppError> {
        self.set_string("hwdec", "no")
    }

    fn set_string(&self, name: &str, value: &str) -> Result<(), AppError> {
        let cname = CString::new(name).unwrap();
        let cval = CString::new(value).unwrap();
        let mut ptr = cval.as_ptr();
        self.check(
            unsafe {
                (self.api.set_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_STRING,
                    &mut ptr as *mut *const c_char as *mut c_void,
                )
            },
            name,
        )
    }

    fn set_flag(&self, name: &str, value: bool) -> Result<(), AppError> {
        let cname = CString::new(name).unwrap();
        let mut v: c_int = if value { 1 } else { 0 };
        self.check(
            unsafe {
                (self.api.set_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_FLAG,
                    &mut v as *mut c_int as *mut c_void,
                )
            },
            name,
        )
    }

    fn set_double(&self, name: &str, value: f64) -> Result<(), AppError> {
        let cname = CString::new(name).unwrap();
        let mut v = value;
        self.check(
            unsafe {
                (self.api.set_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_DOUBLE,
                    &mut v as *mut f64 as *mut c_void,
                )
            },
            name,
        )
    }

    fn set_int64(&self, name: &str, value: i64) -> Result<(), AppError> {
        let cname = CString::new(name).unwrap();
        let mut v = value;
        self.check(
            unsafe {
                (self.api.set_property)(
                    self.handle,
                    cname.as_ptr(),
                    MPV_FORMAT_INT64,
                    &mut v as *mut i64 as *mut c_void,
                )
            },
            name,
        )
    }

    fn check(&self, status: c_int, ctx: &str) -> Result<(), AppError> {
        if status >= 0 {
            return Ok(());
        }
        let msg = unsafe {
            let p = (self.api.error_string)(status);
            if p.is_null() {
                format!("mpv error {status}")
            } else {
                CStr::from_ptr(p).to_string_lossy().into_owned()
            }
        };
        Err(AppError::new(
            ErrorCode::EngineInit,
            format!("libmpv {ctx}: {msg}"),
            true,
        ))
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { (self.api.terminate_destroy)(self.handle) };
            self.handle = ptr::null_mut();
        }
    }
}

// silence unused destroy
#[allow(dead_code)]
fn _keep_destroy(api: &Api, h: MpvHandle) {
    unsafe { (api.destroy)(h) };
}
