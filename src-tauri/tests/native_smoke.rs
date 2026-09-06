//! Native libmpv smoke — run with: cargo test -p replay --test native_smoke -- --ignored --nocapture
//! Loadfile coverage requires a media path via REPLAY_SMOKE_MEDIA; otherwise it is skipped.

use std::path::PathBuf;

fn sample_media() -> Option<PathBuf> {
    std::env::var("REPLAY_SMOKE_MEDIA")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
}

#[test]
#[ignore]
fn libmpv_create_destroy() {
    let mpv = replay_lib::player::mpv::Mpv::new().expect("libmpv should load");
    drop(mpv);
}

#[test]
#[ignore]
fn libmpv_af_and_loadfile() {
    let mpv = replay_lib::player::mpv::Mpv::new().expect("libmpv create");

    // This used to kill actor init via `af clr` → INVALID_PARAMETER.
    mpv.set_audio_fx(false, "Flat")
        .expect("set_audio_fx clear should work via af property");

    mpv.set_audio_fx(true, "vocal")
        .expect("set_audio_fx preset should work via af property");

    mpv.set_audio_fx(false, "Flat")
        .expect("set_audio_fx clear again");

    if let Some(path) = sample_media() {
        let path = path.to_string_lossy();
        println!("loadfile {}", path);
        mpv.loadfile(&path)
            .expect("loadfile should accept windows path");
        // Give mpv a moment to start demux
        std::thread::sleep(std::time::Duration::from_millis(500));
        match mpv.get_double("duration") {
            Ok(d) => println!("duration={d}"),
            Err(e) => println!("duration err: {}", e.message),
        }
    } else {
        println!("no sample media; skipped loadfile path test");
    }
}
