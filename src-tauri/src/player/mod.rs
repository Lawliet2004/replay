#[cfg(not(target_os = "android"))]
pub mod actor;
pub mod android_actor;
pub mod android_engine;
pub mod host;
pub mod model;
#[cfg(not(target_os = "android"))]
pub mod mpv;

#[cfg(not(target_os = "android"))]
pub use actor::PlayerHandle;
#[cfg(target_os = "android")]
pub use android_actor::PlayerHandle;
pub use model::*;
