# Status — portable dependency correction implemented, release verification incomplete

Version 0.2 uses installed Node and Beads. The native Go launcher, platform runtime
copies, `runtime-lock.json` and cross-build script have been removed. Packaging
produces one Claude JS/assets artifact with integrity metadata and no native runtime
or addon dependencies. See [PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md).

The compatibility contract is in repository-root `compatibility.json`: Node
`>=24.11.1 <25` with SQLite, Beads 1.1.0 with existing embedded Dolt. Startup checks
versions/capabilities and supports PATH discovery or an explicit existing executable
path. Native Windows command shims are rejected with actionable guidance if no safe
underlying executable/JS entry point can be selected. No automatic install/migration
or shell interpolation is introduced. The original annotation schema/data and
main-turn relay are preserved. The Codex integration remains a scaffold.

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
