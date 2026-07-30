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
