//! Structural check that the shipped Media3 plugin sources exist for Gradle.

#[test]
fn media3_plugin_sources_are_wired() {
    let player = include_str!(
        "../plugins/replay-media3/android/src/main/java/app/replay/media3/Media3Player.kt"
    );
    let plugin = include_str!(
        "../plugins/replay-media3/android/src/main/java/app/replay/media3/ReplayMedia3Plugin.kt"
    );
    assert!(player.contains("ExoPlayer"));
    assert!(player.contains("fun load("));
    assert!(plugin.contains("@TauriPlugin"));
    assert!(plugin.contains("class ReplayMedia3Plugin"));
    assert!(plugin.contains("@Command"));
    assert!(plugin.contains("fun load("));
    assert!(plugin.contains("fun play("));
    assert!(plugin.contains("fun pause("));
    assert!(plugin.contains("PlayerView"));
    assert!(plugin.contains("TRANSPARENT"));
}
