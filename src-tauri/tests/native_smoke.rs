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

/// A real five-minute local video exercises native seeking without a visible window.
#[test]
#[ignore]
fn libmpv_aspect_and_five_minute_seeking() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("five-minutes.y4m");
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(b"YUV4MPEG2 W160 H90 F1:1 Ip A1:1 C420jpeg\n")
        .unwrap();
    let frame = vec![128u8; 160 * 90 * 3 / 2];
    for _ in 0..300 {
        file.write_all(b"FRAME\n").unwrap();
        file.write_all(&frame).unwrap();
    }
    drop(file);
    let mpv = replay_lib::player::mpv::Mpv::new().expect("libmpv create");
    assert!(mpv.get_flag("keepaspect").unwrap());
    assert!(mpv.get_flag("keepaspect-window").unwrap());
    mpv.set_string("vo", "null").unwrap();
    mpv.set_pause(true).unwrap();
    mpv.loadfile(&path.to_string_lossy()).unwrap();
    let wait_for = |property: &str, expected: f64| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if mpv
                .get_double(property)
                .is_ok_and(|value| (value - expected).abs() < 0.2)
            {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{property} did not reach {expected}"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    };
    wait_for("duration", 300.0);
    for target in [150.0, 80.0] {
        mpv.seek_absolute(target).unwrap();
        wait_for("time-pos", target);
    }
    mpv.set_speed(1.5).unwrap();
    wait_for("speed", 1.5);
    mpv.set_volume(65.0).unwrap();
    mpv.set_mute(true).unwrap();
    assert!(mpv.get_flag("mute").unwrap());
    mpv.set_mute(false).unwrap();
    assert!(!mpv.get_flag("mute").unwrap());
    wait_for("volume", 65.0);
}
