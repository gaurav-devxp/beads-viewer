# Historical 0.1 verification — superseded distribution

Retained for provenance; this is not evidence for the portable 0.2 package.


Implementation performed on 2026-11-01 in the supplied Linux arm64 workspace.
No user Beads tasks or global Claude configuration were changed. There was no
application implementation or applicable AGENTS.md at the start; the Codex plugin
and both implementation contracts were preserved.

## Automated checks

The authoritative output for the most recent typecheck, ESLint, integration tests
and production build is [evidence/check.log](evidence/check.log). Integration tests
use disposable real Beads/Dolt workspaces, including paths with spaces and Unicode.
`BV_TEST_BD` explicitly selects the tested binary; no fake task database substitutes
for Beads. Synthetic AI outputs are used only in transport/schema tests and are
identified as such in test code.

**Latest completed check: typecheck PASS, ESLint PASS, 8/8 integration tests PASS, production build PASS.**

The final UI-only connection-loss indicator and resolved-thread focus adjustments
also passed typecheck, ESLint and build; see
[evidence/final-ui-check.log](evidence/final-ui-check.log). Browser behavior remains
unverified as described below.

Covered checks:

- Two real repositories with colliding task IDs; combined project/label/unassigned
  filters; closed tasks; native ready and blocked queries.
- Create, update, ordinary comment, close/reopen, dependency add/remove and deletion.
  Independent bd reads verify persistence. Empty label removal is explicitly tested.
- Source conflict detection, shell-injection syntax, quotes, multiline/Unicode text,
  and successful native operations with PATH set to a nonexistent directory.
- Inline anchors/replies/resolution in both views, restart persistence, export/import,
  immutable old summary revisions, schema 1→2 migration and shared repository/worktree
  identity handling. Unicode normalization, code, repeated/deleted text and ambiguous
  anchors have explicit assertions.
- A/B relay isolation, foreign credentials, bad source links, stale/cancelled results,
  aborted bounded waits and expiry; no mock counts as real host inference.
- HTTP handler contract against real Beads: Host/Origin/CSRF, missing authentication,
  one-use launch secret, per-connection same-origin cookies, unselected roots,
  malformed payloads, mutation deduplication and annotations after reopening the app
  store. This uses Request/Response directly because listening is prohibited.
- Safe Markdown AST mapping, blocked javascript/data URLs, literal raw HTML and
  no remote image loading.

## Actual Claude CLI checks

Installed version: **2.1.283**. `claude plugin validate --strict --json` passed for
the source manifest, and `claude --plugin-dir <path> plugin details beads-viewer`
discovered one `open` skill and one `beads-viewer` MCP server. This validates manifest
layout and component discovery, not the model's behavior or skill substitutions.
Captured reports are in `evidence/` after packaging validation.

Frontmatter and `${CLAUDE_SESSION_ID}` / `${CLAUDE_PLUGIN_ROOT}` syntax were checked
against current [official skills docs](https://code.claude.com/docs/en/skills) and
[plugin docs](https://code.claude.com/docs/en/plugins-reference). The skill is explicitly
user-invoked; it has no `context: fork`, model override or pre-approved tool bypass.
No unsupported live-session API was identified/used. The chosen interface is this
application's main-turn relay.

The official CLI documents local directory/ZIP loading and local marketplaces.
Persistent installation, aliases, upgrade and uninstall were not run. No global
settings were modified. The standalone `/beads-viewer` project alias is optional
and unverified; only `/beads-viewer:open` is discovered as a plugin skill.

## Failed session proof (requirement remains unmet)

The first socket capability probe returned `EPERM` when binding 127.0.0.1. A real
Claude CLI inference capability check was started without resuming any conversation,
without permission bypass or a model override. Network access could not proceed;
it was terminated. It is not evidence of a successful invoking-session response.

The packaged native launcher was then copied outside the checkout to a read-only
directory with spaces/Unicode, with PATH=/nonexistent and writable app data elsewhere.
From /tmp, it was tested through a held-open FIFO pipeline.
It ran its bundled Node/MCP server and returned JSON-RPC initialize and tools/list.
The actual `connect_open` tool returned:

```text
listen EPERM: operation not permitted 127.0.0.1
```

[evidence/mcp-stdio-pipe.jsonl](evidence/mcp-stdio-pipe.jsonl) records those protocol
results. The session string is explicitly `probe-no-inference`, not a fabricated
Claude session ID. No browser request or model response is claimed.

A separate MCP SDK stdio-client probe checked private Node/Beads version startup
with PATH unavailable, read-only plugin files and a path containing spaces/Unicode.
Those executable checks passed, but its socket-based child stdio connection closed
before handshake. [evidence/packaged-runtime-probe.txt](evidence/packaged-runtime-probe.txt)
records this additional failure; successful FIFO transport does not override it.
Actual host MCP startup and cancellation remain unverified.

To complete the proof on an unrestricted host: launch the package in session A,
invoke `/beads-viewer:open`, request Human view in its browser, capture A's
`next_request` and `complete_request` calls with only task/connection/session IDs and
hashes (redact relayKey and launch credentials), then prove B cannot consume A's
queued work, interrupt a pending wait, and disconnect during generation. The
smallest next requirement is an environment allowing loopback/browser execution and
real Claude inference; a fresh SDK summary is not an acceptable replacement.

## Browser checks

`npm run test:browser` attempted both desktop and mobile Chromium projects. Both
failed before a page opened:

```text
FATAL:content/browser/sandbox_host_linux.cc:41
Check failed: . shutdown: Operation not permitted (1)
```

See [evidence/playwright-attempt.log](evidence/playwright-attempt.log). The Playwright
suite exercises the real adapter through the HTTP handler, comments in both tabs,
reload, filters and draft tab preservation. It has not passed. Keyboard/mobile/focus,
visual screenshots, modal browser behavior, clean offline frontend launch and large
browser dataset performance are **unverified**. No screenshots were manufactured.

## Packaging/platform matrix

| Target | Native launcher build | Runtime inputs | Runtime/browser/host acceptance |
|---|---|---|---|
| macOS x64 | cross-compiled | unavailable | unmet, no native runner |
| macOS arm64 | cross-compiled | unavailable | unmet, no native runner |
| Windows x64 | cross-compiled | unavailable | unmet, no native runner |
| Windows arm64 | cross-compiled | unavailable | unmet, no native runner |
| Linux x64 | cross-compiled | unavailable | unmet, no native runner |
| Linux arm64 | compiled and launched | local Node/Beads bundled | partial probes only; clean install/browser/session unmet |

[evidence/launcher-cross-builds.json](evidence/launcher-cross-builds.json) records
cross-builds. `runtime-lock.json` lists proposed/observed baselines. The current host
uses glibc 2.43. `readelf` finds Beads requirements through GLIBC_2.34 and Node through
GLIBC_2.28 plus GLIBCXX_3.4.21/CXXABI_1.3.11. Lower-version machines have not run this
artifact. Musl support is not claimed. Windows extension/paths/browser opener and
macOS signing/notarization remain native-run requirements.

The Linux arm64 experimental archive contains private binaries, prebuilt assets,
MCP/backend, native launcher, manifests, notices, a CycloneDX inventory and SHA-256
checksums. Sizes are recorded in the adjacent `*-sizes.json` file in `artifacts/`.
No compiler, package manager, executable tests, source tree or node_modules is shipped.
Verification reports and redacted diagnostic evidence are included. Node
and Beads dominate size. Consumer startup performs no downloads. Beads' embedded
storage performs CRUD/comments without Git/Dolt executables on PATH in tests.

The bundled MCP esbuild metadata reports only Node built-in external imports; see
[evidence/bundle-audit.json](evidence/bundle-audit.json). A full subprocess syscall
audit was attempted but ptrace is prohibited; see
[evidence/ptrace-unavailable.txt](evidence/ptrace-unavailable.txt). PATH isolation
verifies the exercised default operations, not every optional Beads configuration.

Beads build info reports v1.1.0+dirty, though its commit matches the upstream tag.
Archive provenance/signatures, complete transitive Go license notices, current
security patch review, SBOM schema validation and signing policy are still release
gates. Checksums of local files are integrity records, not proof of trusted origin.

A matching platform artifact currently must be selected explicitly. Automatic host
platform installation/dispatch is not verified. The packaging script intentionally
refuses a release build while these gates are unmet. See [STATUS.md](STATUS.md) for
other incomplete acceptance requirements, non-atomic Beads writes and data portability limitations.
