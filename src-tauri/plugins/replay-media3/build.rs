const COMMANDS: &[&str] = &[
    "load",
    "play",
    "pause",
    "togglePause",
    "seek",
    "setVolume",
    "setMuted",
    "setSpeed",
    "selectTrack",
    "addSubtitle",
    "setSurface",
    "setVisible",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
