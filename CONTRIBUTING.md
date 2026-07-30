# Contributing

1. Prefer small, reviewable commits.
2. Keep contracts in Rust (`player::model`) authoritative; refresh `src/generated` via ts-rs export when shapes change.
3. Do not add network streaming, Wayland-native, or browser decode paths in v0.1.
4. Run `npm run ci:frontend` and `cargo test --workspace` before opening a PR (when a remote exists).
5. Never commit secrets. Large binary DLLs under `native-deps/**/bin` should be fetched via scripts; commit manifests/checksums only when intentional.
