# Beads Viewer for Claude Code — verification

## 0.3.1 and 0.3.2 on the actual installed plugin (2026-11-01, Linux arm64)

0.3.2 differs from 0.3.1 only by the inline-comment anchor fix (item 5 below); the
channel rows were run on 0.3.1 and the manual-fallback rows on 0.3.2.

Environment: Node 24.11.1, Beads 1.1.0 (embedded Dolt), Claude Code CLI 2.1.283
then 2.1.316 (auto-updated mid-run), VS Code extension binary 2.1.314, Claude Pro
account without an organization, the user's normal model (Opus 5.5, xhigh effort)
and auto permission mode. The plugin was used exactly as installed:
`beads-viewer@beads-viewer-local`, user scope, directory marketplace at
`artifacts/beads-viewer-local-marketplace`. Tests used a scratch Beads repository
and a separate `BV_DATA_DIR`; the user's Beads data and viewer store were not
written. A stub `xdg-open` on the test session's PATH handed the launch URL to a
real Playwright Chromium page instead of the desktop browser. Screenshots are in
[evidence/installed-0.3.2](evidence/installed-0.3.2/). Claude session transcripts
are local to this machine under `~/.claude/projects/` (IDs below); they are not
copied into the repository.

### Root cause of the reported problems

1. **The conversation was running old code.** Claude Code loads a directory
   marketplace plugin *in place* (`CLAUDE_PLUGIN_ROOT` was the repository's
   `artifacts/beads-viewer-local-marketplace/plugins/beads-viewer/claude-code`, not
   `~/.claude/plugins/cache/...`), and a conversation keeps the skills and MCP
   process it started with. The looping VS Code conversation (`4187fe9b…`, started
   22:12 IST) loaded 0.2.x. Its 0.2.x skill literally instructed "call
   `next_request` … at most 10000ms per wait", so Claude made 30+ consecutive
   10-second `next_request` calls. The 0.3.0 files were copied over the same folder
   at 22:38; at 22:40 the same conversation ran `/beads-viewer:open` again and
   still received the 0.2.x skill text and MCP tools.
2. **"Claude relay disconnected"** is the 0.2.x relay: without a `next_request`
   heartbeat it expired after 120 s ("Relay idle limit or host heartbeat
   expired"), after which enqueueing a Human view returned that message.
3. **In-place packaging mixed versions.** `package:plugin` deleted and recopied the
   live folder, so a running 0.2.x MCP process served the new 0.3.0 browser assets
   from disk: a new-looking UI on an old backend.
4. **0.3.0 itself could not complete a real briefing.** Run in a fresh CLI session
   with Channels (`d7f0dad3…`), the open/ready flow worked, but `complete_request`
   was rejected four times: `field:project`, then `field:ready`, then
   `field:assignee` (top-level task fields the validator did not accept, one per
   rejection), then "Request is no longer running" when the 3-minute claim deadline
   passed. Nothing reached the browser.
5. Found while running the real browser: an Agent-view inline comment made right
   after an ordinary Beads comment was rejected with "Task source changed; select
   text again", because the comment changes the task revision.

No duplicate MCP configuration, old optional alias, project skill or second
installation was present. `~/.claude/plugins/cache/beads-viewer-local/...` copies
exist but are not what Claude loads for this marketplace.

### Results

| Check | Session / evidence | Result |
| --- | --- | --- |
| Loaded version and files | `claude plugin list` (CLI 2.1.316 and VS Code 2.1.314 binaries); MCP process `CLAUDE_PLUGIN_ROOT` | Fresh conversations load `claude-code-0.3.1` / `claude-code-0.3.2`; running ones keep their own folder |
| `/beads-viewer:open`, no arguments, Channels on | CLI 2.1.316 `97b5dbdd…`; `01-open-channel-ready.png` | Scratch repo auto-selected, browser opened, ready event acknowledged in the same turn, prompt returned after 22 s (one `connect_open`, one `channel_ready`) |
| Unrelated command afterwards | same | Answered in 3 s; viewer unaffected |
| Idle over five minutes | same, 23:22:53 → 23:29:03 IST | Still `connected`, `delivery: channel`, no browser errors, Claude idle at its prompt |
| Human view through the same conversation | same; `02-briefing-channel.png` | Click → channel event → one `claim_request` + one accepted `complete_request` in a 43 s turn; 7 grounded blocks in the browser with provenance session `97b5dbdd…` |
| Cancellation | same | Cancelled while Claude was writing; `complete_request` refused ("no longer running"); Claude did not republish; no new summary |
| Stale-result rejection | same; `03-stale-rejected.png` | Task edited with `bd update` mid-generation; result rejected ("Source changed while Claude was working"); browser shows the error and older-revision notice |
| Comments | same; `04-…`, `05-…` | Ordinary Beads comment (also visible via `bd comments`), Agent and Human inline comments all present after a full reload |
| Manual fallback, no Channels | CLI 2.1.316 `82c141fd…`, plugin 0.3.2; `06`–`08` | Claude states no channel was acknowledged; browser shows "Claude on request"; Copy button copied `/beads-viewer:brief {…}`; pasted into the same conversation: one claim + one completion in a 38 s turn, 8-block briefing in the browser with provenance `82c141fd…` |
| Inline comment right after an ordinary comment | 0.3.1 viewer vs 0.3.2 viewer | 409 on 0.3.1; saved (HTTP 200) on 0.3.2 |
| VS Code mode and Channels | VS Code binary 2.1.314 in stream-JSON mode with `--dangerously-load-development-channels` | No channel event was delivered (single turn, `delivery: manual`); Claude reported the manual command. VS Code needs the fallback |
| Update procedure | package 0.3.1 → 0.3.2 while a 0.3.1 conversation ran | New conversations loaded 0.3.2 without `claude plugin update`; the running 0.3.1 viewer kept serving its own 0.3.1 files; re-packaging 0.3.2 was refused |
| Existing viewer data | read-only snapshot of `~/.local/share/beads-viewer/annotations.sqlite` opened by the 0.3.2 store | Schema 2, 1 repository, 2 request records; unchanged counts; original database and WAL byte-identical |

Automated: `npm run check` passes typecheck, ESLint, **18/18** tests and the build;
`npm run test:browser` passes desktop and mobile Chromium (it could not start in
the earlier environment; a test race and the inline-comment bug were fixed to get
there). `npm run verify:package` passes and `claude plugin validate --strict`
passes for the staged plugin and the marketplace.

### Not verified

- Clicking through the VS Code panel itself (its binary and stream mode were used).
- Opening the user's real desktop browser (a stub recorded and forwarded the URL).
- Two conversations opening viewers at the same time, and a brief command pasted
  into a different conversation (covered by unit tests only).
- Windows and macOS.

## Earlier portable 0.3 records

Verified on 2026-11-01 in the supplied Linux arm64 workspace, with installed Node
24.11.1, Beads 1.1.0 and Claude Code CLI 2.1.283. No global host configuration or
user Beads workspace was changed. Tests use disposable repositories. The Codex
adapter remains a scaffold.

### Automated checks

`npm run check` passes typechecking, ESLint, **15/15 tests** and the production
build. [check.log](evidence/portable/check.log) is the complete output. Coverage
includes real multi-repository Beads CRUD, native ordinary comments, dependencies,
filters, colliding task IDs, source conflicts and shell-safe arguments. Persistent
inline discussions in both views, replies, resolution, immutable summaries,
restart/export/import and schema migration retain their existing assertions.
Session isolation and HTTP authentication/Host/Origin/CSRF checks use synthetic
transport results and direct Request/Response calls; they do not prove inference
or successful loopback serving.

New prerequisite tests check Node/SQLite/version failures, PATH and explicit
selection, symlinks, spaces/Unicode, Windows candidate/shim policy and real installed
Beads version/help probes. Windows policy tests run on Linux and do not certify
native Windows execution. ZIP tests check UTF-8 names, CRC32 and directory records.

The authentication regression uses the actual QueryClient and application
authentication handlers with a simulated browser transport. It reproduces the
original `auth` query returning undefined, then verifies successful one-use launch
exchange, cookie-based reload, and rejection after a lost session. It does not
claim browser rendering or real Claude inference.

### Nonblocking Human view delivery

The MCP SDK in-memory integration test exercises the actual plugin server factory:
initialization advertises `claude/channel`, tool discovery has no polling tool,
open returns with no default expiry, a private probe must be acknowledged before
channel readiness is reported, and one event is emitted per new briefing request.
Event payloads contain generated routing IDs, not task text or private relay keys.
Wrong-session and wrong-launch claims, wrong probe nonce and duplicate claims fail.
One explicit claim/completion persists a synthetic summary. A simulated notification
transport failure leaves the request queued and the manual claim/completion path
usable. These are transport/schema fixtures, not model inference.

Bridge tests advance the clock 31 minutes with no polling and verify that the
viewer remains connected and can accept work. Explicit lifetime limits, per-job
timeouts, cancellation and source-conflict rejection still work. Returning from
the open skill does not call disconnect. The UI presents a manual command while
queued, even when automatic delivery was attempted. The real-browser assertions
include that command but remain blocked by Chromium startup here.

The installed Claude CLI contains the documented channel flags, but no real
interactive channel opt-in or model turn was exercised. User/admin startup consent
is required for preview Channels; the plugin does not enable itself. The official
[Channels reference](https://code.claude.com/docs/en/channels-reference) was checked
for capability, notification format, delivery acknowledgement and preview opt-in.
SDK protocol negotiation remains 2025-11-25; current channel restrictions on a
2026-07-28 negotiation do not apply to this bundled SDK. Native host execution is
still required to verify actual delivery and compatibility.

### Portable package and installed dependencies

The new artifact is `beads-viewer-0.3.0-claude-code.zip`, with no OS/CPU suffix.
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

### Host and browser boundaries

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
`probe-no-inference`, not a real Claude session identifier. The current packaged protocol
responses are in [mcp-stdio-pipe.jsonl](evidence/portable/mcp-stdio-pipe.jsonl). No successful browser
request or same-session model output is claimed.

`npm run test:browser` attempts desktop/mobile Chromium but fails before pages open:
`shutdown: Operation not permitted`. See
[browser-attempt.log](evidence/portable/browser-attempt.log). Keyboard/mobile/focus,
visual screenshots, offline browser startup and real Human view rendering remain
unverified. The real channel A/browser/Human view/B isolation, interruption and
model/disconnect proof requires an environment permitting loopback, Chromium and
actual Claude inference. Do not substitute a separate model/SDK session.

### Native execution matrix and release gates

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
as the current package report and makes no claims about the 0.3 artifact.
