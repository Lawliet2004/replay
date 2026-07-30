# Testing

## Frontend

```bash
npm run test
npm run typecheck
npm run lint
```

## Rust

```bash
cd src-tauri
cargo test --workspace
cargo test --test native_smoke -- --ignored   # requires libmpv DLL present
```

## Manual media matrix

Cover when possible: MP4/MKV/WebM, MP3/FLAC/Opus, multi-audio/subtitle, SRT/ASS/WebVTT, VFR, truncated input, Unicode paths, missing files.

## Performance / stability gates

Documented targets: shell visible &lt;1s cold, loading feedback &lt;100ms, first frame for reference 1080p &lt;1.5s, no sustained &gt;20% memory growth after 50 open/play/stop cycles, one-hour playback without crash/deadlock.
