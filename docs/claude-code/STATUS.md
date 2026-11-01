# Status — 0.3.2 verified on the installed plugin (Linux arm64); release verification incomplete

Version 0.3 uses installed Node and Beads. The native Go launcher, platform runtime
copies, `runtime-lock.json` and cross-build script have been removed. Packaging
produces one Claude JS/assets artifact with integrity metadata and no native runtime
or addon dependencies. See [PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md).

The compatibility contract is in repository-root `compatibility.json`: Node
`>=24.11.1 <25` with SQLite, Beads 1.1.0 with existing embedded Dolt. Startup checks
versions/capabilities and supports PATH discovery or an explicit existing executable
path. Native Windows command shims are rejected with actionable guidance if no safe
underlying executable/JS entry point can be selected. No automatic install/migration
or shell interpolation is introduced. The original annotation schema/data and
same-session provenance are preserved. The Codex integration remains a scaffold.

Portable packaging does not certify native platforms. Windows 11 x64/arm64, macOS
x64/arm64 and Linux x64 still lack native execution evidence here. Linux arm64 can
exercise installed dependencies and the real adapter; loopback startup and Chromium
are denied by this environment. Real invoking-session/browser proof, clean native
install/upgrade/uninstall, keyboard/mobile behavior, and native OS baseline checks
remain unverified. Current records belong in `evidence/portable/`; 0.1 evidence and
runtime-bundled archives are historical and superseded.

React/React DOM remain 19.2.5 from the available build dependencies; resolving and
testing the current stable release is independent outstanding work. License notices
and a CycloneDX inventory are supplied for shipped JS libraries; full license/SBOM
review is a release gate. No Node/Beads binaries are redistributed by 0.2, so their
binary signing/provenance are no longer plugin distribution requirements.

Other unchanged limitations: Beads writes are check-then-write with an external CLI
race window; new repository paths require explicit host selection; cross-process
broker adoption is not implemented; database identity replacement under an already
registered root and portable identity remapping after moving a repository remain
unsupported. Unsaved task drafts survive tab/modal changes within a page, not browser
restart. No public release or global host configuration change was made.

Version 0.3 replaces the blocking relay with one-event Channels delivery and an
explicit one-request briefing fallback. Opening the viewer returns control without
polling or disconnecting. Default idle/lifetime expiry is removed; individual jobs
remain bounded (30 minutes queued, 15 minutes claimed). Channel readiness requires
an acknowledgement. Custom Channels need the terminal CLI started with
`--dangerously-load-development-channels plugin:beads-viewer@beads-viewer-local`;
the VS Code extension cannot deliver channel events, so it uses the
`/beads-viewer:brief` command. No host configuration was changed.

The installed plugin was exercised with real Claude conversations, a real browser
and real inference: open, unrelated command, more than five idle minutes,
channel-delivered briefing, cancellation, stale-source rejection and comments on
0.3.1; manual briefing, the comment fix and the update procedure on 0.3.2 (the two
differ only by that fix). 0.3.1 fixed the briefing validator
that rejected real task fields and the too-short claim deadline; 0.3.2 fixed inline
comments after an ordinary comment. Packaging stages each version in its own
marketplace folder. See [VERIFICATION.md](VERIFICATION.md) for root cause and
results. Windows, macOS and clicking through the VS Code panel remain unverified.
