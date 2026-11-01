# Portable 0.2 verification

Verified on 2026-11-01 in the supplied Linux arm64 workspace, with installed Node
24.11.1, Beads 1.1.0 and Claude Code CLI 2.1.283. No global host configuration or
user Beads workspace was changed. Tests use disposable repositories. The Codex
adapter remains a scaffold.

## Automated checks

`npm run check` passes typechecking, ESLint, **12/12 tests** and the production
build. [check.log](evidence/portable/check.log) is the complete output. Coverage
includes real multi-repository Beads CRUD, native ordinary comments, dependencies,
filters, colliding task IDs, source conflicts and shell-safe arguments. Persistent
inline discussions in both views, replies, resolution, immutable summaries,
restart/export/import and schema migration retain their existing assertions.
Relay isolation and HTTP authentication/Host/Origin/CSRF checks use synthetic
transport results and direct Request/Response calls; they do not prove inference
or successful loopback serving.

New prerequisite tests check Node/SQLite/version failures, PATH and explicit
selection, symlinks, spaces/Unicode, Windows candidate/shim policy and real installed
Beads version/help probes. Windows policy tests run on Linux and do not certify
native Windows execution. ZIP tests check UTF-8 names, CRC32 and directory records.

## Portable package and installed dependencies

The new artifact is `beads-viewer-0.2.0-claude-code.zip`, with no OS/CPU suffix.
It contains prebuilt JS/browser assets, metadata, skills, notices, SBOM and checksums.
Node, Beads, Dolt, native launchers/addons, source tests and node_modules are absent.
Packaging runs with PATH unavailable using an explicitly selected installed Node;
it does not invoke Go, Beads or an external ZIP utility. Exact sizes are recorded
in the adjacent artifact `-sizes.json`; they depend on included diagnostic evidence.

[package-verification.json](evidence/portable/package-verification.json) records
layout, per-file/archive checksums and native-binary absence.
[zip-validation.txt](evidence/portable/zip-validation.txt) independently checks ZIP
integrity with the OS utility. Neither result proves native platform execution.
The SBOM is parsed and notices are included; schema/license review is still required.

Installed-dependency diagnostics pass outside the checkout in a read-only plugin
copy with spaces/Unicode. Negative checks demonstrate missing Beads and disabled
SQLite failures before application startup. With Node unavailable, the OS reports
the missing command; JavaScript cannot diagnose its own absence. The installed
Claude CLI still discovers plugin metadata/skill/MCP declarations without Node.
See [doctor.json](evidence/portable/doctor.json),
[sqlite-disabled.txt](evidence/portable/sqlite-disabled.txt),
[missing-beads.txt](evidence/portable/missing-beads.txt),
[missing-node.txt](evidence/portable/missing-node.txt), and
[discovery-without-node.txt](evidence/portable/discovery-without-node.txt).
Unsupported Node/Beads and Windows shims have unit coverage; alternate real Node
versions and native Windows installations have not been exercised.

## Host and browser boundaries

Strict source-plugin and generated-marketplace metadata validation and component
discovery are separate from running the main-conversation skill. Reports:
[source-validation.txt](evidence/portable/source-validation.txt),
[marketplace-validation.txt](evidence/portable/marketplace-validation.txt),
[plugin-discovery.txt](evidence/portable/plugin-discovery.txt).
The CLI also discovers components directly from the ZIP; see
[zip-discovery.txt](evidence/portable/zip-discovery.txt). This is metadata discovery,
not host inference. No persistent marketplace registration/install/uninstall was performed here.

The MCP SDK child-stdio probe fails with `Connection closed` in this restricted
environment; [runtime-probe.txt](evidence/portable/runtime-probe.txt) preserves that
failure. A held-open ordinary pipe can exercise initialization and tool discovery;
`connect_open` fails at loopback binding with `listen EPERM`. Its session marker is
`probe-no-inference`, not a real Claude session identifier. The actual 0.2 protocol
responses are in [mcp-stdio-pipe.jsonl](evidence/portable/mcp-stdio-pipe.jsonl). No successful browser
request or same-session model output is claimed.

`npm run test:browser` attempts desktop/mobile Chromium but fails before pages open:
`shutdown: Operation not permitted`. See
[browser-attempt.log](evidence/portable/browser-attempt.log). Keyboard/mobile/focus,
visual screenshots, offline browser startup and real Human view rendering remain
unverified. The relay's real A/browser/Human view/B isolation, interruption and
model/disconnect proof requires an environment permitting loopback, Chromium and
actual Claude inference. Do not substitute a separate model/SDK session.

## Native execution matrix and release gates

| Target | Result |
| --- | --- |
| Windows 11 x64 | Unverified; native runner unavailable. |
| Windows 11 arm64 | Unverified; native runner unavailable. |
| macOS x64 | Unverified; native runner unavailable. |
| macOS arm64 | Unverified; native runner unavailable. |
| Linux x64 | Unverified; native runner unavailable. |
| Linux arm64 | Installed prerequisites/real adapter/portable layout pass; loopback/browser blocked. |

Clean native install/upgrade/rollback/uninstall, OS baselines, browser opening and
owned-process shutdown remain native acceptance checks. Existing annotation schema
and persistence assertions pass, but no full host upgrade/rollback was performed.
Real session proof, browser/native acceptance, current React compatibility and
full license/SBOM review remain release gates; `--release` refuses publication.
See [STATUS.md](STATUS.md) and [PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md).

The prior runtime-bundled distribution's report is retained in source as
`HISTORICAL_0_1_VERIFICATION.md`, with its old evidence unchanged. It is not shipped
as the current package report and makes no claims about the 0.2 artifact.
