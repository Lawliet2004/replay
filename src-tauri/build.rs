use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let win_bin = manifest.join("../native-deps/windows-x64/bin");
    if win_bin.exists() {
        println!("cargo:rustc-env=REPLAY_NATIVE_BIN={}", win_bin.display());
        println!("cargo:rerun-if-changed={}", win_bin.display());

        // Copy libmpv next to the built binary for `tauri dev` / local runs.
        if let Ok(profile) = env::var("PROFILE") {
            let target_dir = env::var("CARGO_TARGET_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| manifest.join("target"));
            let out_dir = target_dir.join(&profile);
            let _ = fs::create_dir_all(&out_dir);
            for name in ["libmpv-2.dll", "mpv-2.dll"] {
                let src = win_bin.join(name);
                if src.exists() {
                    let _ = fs::copy(&src, out_dir.join(name));
                }
            }
        }
    }
    tauri_build::build()
}
