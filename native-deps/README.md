# Native dependency provenance
#
# Windows: `npm run native:fetch` downloads an LGPL-oriented `mpv-dev-lgpl` build
# from zhongfly/mpv-winbuild into `native-deps/windows-x64/` and records checksums
# in `windows-x64.manifest.json`.
#
# Linux: install distro `libmpv` / `libmpv-dev` (X11/XWayland). Place shared
# objects under `linux-x64/lib/` for bundling when packaging.
#
# macOS: install mpv/libmpv via Homebrew; copy `libmpv.dylib` into
# `macos-universal/lib/` for packaging.
#
# Native Wayland is deferred for v0.1.
