# Player fixes and verification

Verified on 7 September 2026 for v0.2.1. Player fixes are in this release; the APK is signed by the release workflow.

## Android emulator validation (added for v0.2.1)

Validated on an Android 35 (API 36 target, x86_64 emulator with arm64 APK via native bridge is NOT used; the arm64 release APK was built locally and installed on an x86_64 image after re-signing with a local debug key for installation purposes only — the shipped release APK keeps the project release keystore). Kotlin compiled through the real Gradle pipeline (`assembleArm64Release` + R8). Results:

- **App launch and playback:** no crashes across launch, file open via the system picker (SAF), and native Media3 playback of a real 5-minute 540×960 H.264/AAC video.
- **Aspect ratio:** portrait 9:16 video played in a portrait activity without stretching (PlayerView `RESIZE_MODE_FIT`); rotation to landscape retained correct ratio.
- **Timeline/progress:** position advanced natively (250 ms sampling) and duration showed 5:00; scrubbing reached 1:20 and ~2:30/2:33 in the five-minute video; seeking near the end then re-starting both worked.
- **Fullscreen:** the button toggled `LAYOUT_HIDE_NAVIGATION LAYOUT_FULLSCREEN` window flags (system bars hidden) and back; controls including seek, settings, rotate, and exit remained reachable in fullscreen.
- **Rotation:** the in-app rotate button flipped the activity between `SENSOR_LANDSCAPE` and `SENSOR_PORTRAIT`; WebView resized (412×915 ↔ 915×412) and playback continued.
- **Mute/unmute:** label toggled Mute→Unmute→Mute; audio output stopped/started per `dumpsys audio` player events.
- **Pause/resume:** pause held the position and stopped audio; play resumed; reaching EOF paused at 5:00/5:00.
- **Autoplay/repeat:** with repeat-one enabled, EOF looped the same file back to 0:00 and kept playing; clearing the queue paused playback and emptied the UI.
- **Embedded audio/subtitle selection:** a second test file (2 audio tracks eng/fre + 1 mov_text subtitle) listed all tracks; switching audio to `fr` and captions to `en` updated the selection state; Media info showed real sampled data (`video/avc · 320×568 · 24 fps`, `audio/mp4a-latm`).
- **Resume:** after force-stopping mid-video (~0:50 of 1:00) and reopening the same file, playback resumed around the saved position instead of 0:00.

These checks ran on an emulator (software swiftshader GPU, no physical device), driven through the real app UI and confirmed via window manager/audio/CDP state. Physical-device validation (cutouts, hardware rotation sensors, OEM builds) remains outstanding.

## Confirmed findings before implementation

- **Android stretching:** a raw SurfaceView was sized to the entire host rectangle without aspect-ratio layout. Replaced it with Media3 PlayerView in FIT mode, with its built-in controls disabled. The original picture fits inside the available area with black bars as needed; no transcoding or quality reduction was introduced.
- **Android timeline at 0:00:** the native engine never reported duration or ongoing position to Rust. The range therefore had a maximum of 0.1 seconds. A 250 ms native state sample now updates duration, position, phase, tracks, and basic media information. Seeking no longer leaves the snapshot permanently in the seeking phase.
- **Desktop:** the same Android defects were not found. Desktop fullscreen retains its existing minimal close-chip/keyboard UI; the touch-accessible fullscreen control strip is Android-only. Native libmpv preserves aspect ratio; that policy is now explicit. A real five-minute local video passed duration and seeking checks at 2:30 and 1:20.
- **Mobile fullscreen:** playback controls were removed entirely. Android now retains auto-hiding controls, including seeking, settings, fullscreen exit, and native portrait/landscape rotation. Fullscreen uses Android system-bar APIs.
- **Narrow screens:** the controls could exceed the viewport and the time display disappeared. Controls now wrap at narrow widths, retain the elapsed/duration display, and use 44px touch targets. Settings position follows the measured controls height. Insets protect controls around screen edges.
- **Android unmute:** native unmute did nothing. Muting now preserves volume and restores it on unmute.
- **Android settings:** track selection and external subtitles were no-op commands; resume only changed the displayed position; EOF never triggered autoplay/repeat. Embedded track selection is connected, resume sends a native seek, and EOF drives playlist advancement. Clearing the queue now pauses native playback.
- Refreshed shared playback/settings/fullscreen icons and top/bottom bar styling. Android title-bar touches no longer invoke desktop window dragging.

## Settings audit

| Feature                                 | Desktop                                                                              | Android                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Play/pause, seeking, volume/mute, speed | Existing native wiring; real engine checks passed for seeking, volume/mute and speed | Commands wired; duration/phase sampling and unmute repaired; on-device verification pending        |
| Embedded audio/caption selection        | Existing native wiring; UI tests                                                     | Track enumeration, selection overrides and caption rendering added; on-device verification pending |
| External subtitles                      | Existing native wiring                                                               | Still unsupported; clearly explained instead of silently succeeding                                |
| Audio enhancement                       | Native filter enable/disable smoke test passed                                       | Unsupported; hidden from root menu                                                                 |
| Subtitle delay, size and position       | Existing native wiring; UI tests                                                     | Unsupported; explicitly labeled                                                                    |
| Resume playback                         | Existing native wiring                                                               | Native resume seek repaired; Rust regression passed                                                |
| Autoplay and repeat                     | Existing native wiring                                                               | EOF processing added; autoplay on/off regression passed                                            |
| Hardware decode                         | Existing native setting                                                              | Managed automatically by Media3; toggle disabled with explanation                                  |
| Queue/open files                        | Existing command wiring and UI tests                                                 | Existing picker/queue wiring; clear queue now pauses playback                                      |
| Seek step, search, reset, shortcuts     | UI/command wiring checked                                                            | Shared UI; keyboard shortcuts require a keyboard                                                   |
| Media info                              | Existing native metadata                                                             | Basic dimensions, codecs, title and frame rate now sampled when available                          |

## Evidence and limits

- Frontend: 124 tests passed; TypeScript/build and ESLint passed. Full-project formatting reports only the pre-existing, unrelated `docs/android-signing.md`; modified player files pass formatting.
- Rust: 70 ordinary tests passed (63 unit, 7 integration).
- Native Windows libmpv: all 3 opt-in smoke tests passed. The new test generates a five-minute 160x90 Y4M file and verifies aspect flags, duration, seeking, speed, volume and mute. Video output is disabled in this test, so it does not visually verify the Windows fullscreen surface. The older optional loadfile smoke branch had no external sample and was skipped; the new generated-video test did load real media.
- Headless Edge: 320x740, 390x844, 844x390, 768x1024, 1024x768 and 1440x900. At each size, timeline tapping/clicking reached 150 seconds, controls stayed within the viewport, settings stayed within the viewport, and selecting 1.5x dispatched correctly. Android-emulated fullscreen retained seeking and rotation. No page errors. These UI checks simulate the Tauri/native connection and cannot validate Android decoding or physical orientation changes.
- Screenshots and browser results are in `node_modules/.tmp/player-qa/` locally. They show simulated player state, not native video output.
- **Android build/device validation:** the Android project now compiles and the behaviors above were exercised on an Android 35 emulator as described at the top. Physical-device testing (cutouts, rotation sensors, OEM specific behavior) is still outstanding.
- Both platforms play the same original local file. Codec, HDR and display capabilities can differ; identical perceived quality across devices was not established.

Implementation references: [Android Media3 surfaces](https://developer.android.com/media/media3/ui/surface), [Tauri mobile plugin responses](https://v2.tauri.app/develop/plugins/develop-mobile/).
