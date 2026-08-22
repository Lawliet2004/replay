//! Contract / export smoke tests.

use replay_lib::error::{AppError, ErrorCode};
use replay_lib::player::model::*;

#[test]
fn snapshot_default_phase_idle() {
    let s = PlayerSnapshot::default();
    assert_eq!(s.phase, PlayerPhase::Idle);
    assert_eq!(s.revision, 0);
}

#[test]
fn command_request_id() {
    let cmd = PlayerCommand::Play {
        request_id: "abc".into(),
    };
    assert_eq!(cmd.request_id(), "abc");
}

#[test]
fn error_shape() {
    let e = AppError::new(ErrorCode::UrlRejected, "no urls", true);
    assert!(e.recoverable);
    assert!(!e.correlation_id.is_empty());
}

#[test]
fn serde_roundtrip_snapshot() {
    let s = PlayerSnapshot::default();
    let json = serde_json::to_string(&s).unwrap();
    let back: PlayerSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(s, back);
}

#[test]
fn apply_settings_roundtrip() {
    let cmd = PlayerCommand::ApplySettings {
        request_id: "x".into(),
        settings: Settings::default(),
    };
    let json = serde_json::to_string(&cmd).unwrap();
    assert!(json.contains("apply_settings"));
    let back: PlayerCommand = serde_json::from_str(&json).unwrap();
    assert_eq!(cmd, back);
}

#[test]
fn settings_event_roundtrip() {
    let ev = PlayerEvent::Settings {
        settings: Settings::default(),
    };
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("settings"));
    let back: PlayerEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(ev, back);
}
