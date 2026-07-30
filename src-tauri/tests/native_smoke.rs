//! Native libmpv smoke — ignored unless DLL is present.

#[test]
#[ignore]
fn libmpv_create_destroy() {
    let mpv = replay_lib::player::mpv::Mpv::new().expect("libmpv should load");
    drop(mpv);
}
