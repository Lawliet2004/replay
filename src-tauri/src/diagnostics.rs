use crate::player::model::redact_path;
use tracing_subscriber::{fmt, EnvFilter};

pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = fmt().with_env_filter(filter).with_target(false).try_init();
}

pub fn log_error(context: &str, err: &crate::error::AppError) {
    #[cfg(debug_assertions)]
    {
        tracing::error!(
            correlation = %err.correlation_id,
            code = ?err.code,
            "{context}: {}",
            err.message
        );
    }
    #[cfg(not(debug_assertions))]
    {
        let safe = redact_message(&err.message);
        tracing::error!(
            correlation = %err.correlation_id,
            code = ?err.code,
            "{context}: {safe}"
        );
    }
}

#[allow(dead_code)]
fn redact_message(msg: &str) -> String {
    // Best-effort path redaction for release logs.
    let mut out = msg.to_string();
    for candidate in msg.split_whitespace() {
        if candidate.contains('\\') || candidate.contains('/') {
            out = out.replace(candidate, &redact_path(candidate));
        }
    }
    out
}

pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("panic recovered for session continuity: {info}");
        default(info);
    }));
}
