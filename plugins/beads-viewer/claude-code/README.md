# Beads Viewer for Claude Code

Experimental portable plugin using **your installed Node.js and Beads**. No native
runtime/launcher bundles are shipped. Read [PORTABLE_RUNTIME.md](../../../docs/claude-code/PORTABLE_RUNTIME.md)
for dependency resolution, compatibility and remaining verification limits.

## Prerequisites

- Normally authenticated Claude Code. CLI 2.1.283/2.1.316 and the VS Code
  extension's 2.1.314 binary were exercised.
- Node `>=24.11.1 <25`, with built-in SQLite enabled, on the host process PATH.
- Working Beads **1.1.0** using existing embedded Dolt workspaces. The adapter validates
  version/help/schema; other releases/storage modes are not automatically supported.

Consumers do not need npm/npx, Go, a compiler, a ZIP utility or a viewer-owned database
service. The viewer never installs dependencies or initializes/migrates user Beads.

Check availability in the environment used to start Claude:

```sh
node --version
bd version
```

Missing/incompatible dependencies require selecting/installing them yourself and
restarting Claude or reconnecting MCP. Missing Node prevents the MCP process from
starting at all; the launch skill/host startup diagnostic handles that case. If bd
resolves to a Windows command shim, select its actual existing executable/JS entry
with `BV_BD_BINARY`. See the runtime guide above for safe path examples.

## Install or try the portable package

Obtain the prebuilt `beads-viewer-0.3.2-claude-code.zip` from the builder and extract
it with the OS archive utility. There is no configured public release URL yet.
Start a new Claude session with the extracted **plugin root**:

```sh
claude --plugin-dir "/absolute/path/to/beads-viewer-0.3.2-claude-code"
```

A compatible Claude CLI can also load the plugin ZIP directly; actual loader
results are recorded separately. Do not point at a raw source adapter before its
prebuilt runtime is staged.

Inside an existing Beads repository, invoke:

```text
/beads-viewer:open
```

The current repository and opening the browser are defaults. The command opens the
viewer and **ends its turn immediately**; no polling, waiting or background Claude
worker is started. MCP keeps the UI running while you use Claude normally. Additional
repositories and filters remain optional JSON:

```text
/beads-viewer:open {"repositories":["/path/to/first","/path/to/second"],"filters":{"status":"open,in_progress"}}
```

### Automatic Human view through Channels

After installing through the local marketplace below, start Claude in a terminal with:

```sh
claude --dangerously-load-development-channels plugin:beads-viewer@beads-viewer-local
```

Claude asks for interactive confirmation because custom Channels are a research
preview. Opt in to this plugin only; normal tool permissions and organization
policies still apply. No extra provider API key, SDK worker or host-setting edit
is required by the plugin. See the [official reference](https://code.claude.com/docs/en/channels-reference).
Then invoke `/beads-viewer:open` as usual. The browser shows channel readiness after
Claude acknowledges the probe. Each Generate briefing click sends a single event
into this session, which claims and completes that request, then returns control.
There is no idle model polling. When Claude is busy, events wait for the next turn;
actual generation occupies a normal turn. The VS Code extension runs Claude without
an interactive terminal, where Claude ignores the development-channel flag, so VS
Code conversations use the manual fallback below.

### Manual Human view fallback

If Channels are unavailable, blocked, or not delivering, click Generate briefing
and copy the displayed `/beads-viewer:brief {…}` command into the conversation that
opened the viewer. It generates exactly that briefing, then ends its turn. The
command contains request IDs, never authentication credentials. Cached summaries
and task management continue independently.

Idle Claude turns no longer disconnect the viewer. The default connection lasts
until explicit Disconnect or MCP shutdown; an optional lifetimeSeconds can impose
a limit. Queued requests expire after 30 minutes and claimed work after 15;
failed/cancelled work can be generated again. Each claim lists the exact source
IDs a briefing may cite. Existing annotations and summary history remain intact.

To check prerequisites without opening a browser/listener:

```sh
node "/absolute/path/to/beads-viewer-0.3.2-claude-code/launch.cjs" --check
```

## Persistent local marketplace

Contributors also generate a marketplace at `artifacts/beads-viewer-local-marketplace`.
Register that root, not the plugin subfolder:

```sh
claude plugin marketplace add "/absolute/path/to/artifacts/beads-viewer-local-marketplace"
claude plugin install beads-viewer@beads-viewer-local
```

Each package is staged in its own `plugins/beads-viewer/claude-code-<version>`
folder, and the marketplace points at the newest. Claude reads this directory
marketplace in place when a conversation starts, so after `npm run package:plugin`
start a **new** conversation (terminal: restart `claude`; VS Code: new conversation
or Developer: Reload Window). No `claude plugin update` is needed; `claude plugin
list` shows the version and folder that new conversations will load, and
`/beads-viewer:open` plus the browser footer report the running version. Already
open conversations keep their original version until restarted. If one still calls
`next_request` or reports "Claude relay disconnected", it is running a 0.2 build.

To uninstall only this plugin:

```sh
claude plugin uninstall beads-viewer@beads-viewer-local
```

A `--plugin-dir` trial ends when that option is omitted on the next launch. Viewer
annotations and Beads data remain outside installed plugin directories. The 0.2
version replaces the older 0.1 runtime-bundled experiment; existing data/schema 2
are preserved. Refresh/reinstall an old cached plugin and reconnect rather than
mixing files from the two artifacts. No global configuration is edited by builds.

The namespaced command is `/beads-viewer:open`. To explicitly install `/beads-viewer`,
copy `optional-alias/SKILL.md` into your selected project's
`.claude/skills/beads-viewer/SKILL.md` and keep this plugin installed for its MCP tools.
That alias is optional; actual invocation requires host verification.

## Contributor commands

From the repository root (`../../..` from this source directory), with supported
Node, npm and installed Beads:

```sh
npm ci
npm run check
npm run doctor
npm run package:plugin
npm run verify:package
npm run probe:plugin
npm run test:browser
```

Beads tests discover `bd` on PATH; `BV_TEST_BD` can explicitly select another existing
executable. The current real-workspace fixtures require a native Beads executable.
Use the new package directory/ZIP above for host loading. The source `verify:plugin`
command validates metadata only. No Go cross-build or external ZIP command remains.

For contributor-only standalone CRUD serving (no Claude AI relay):

```sh
npm run dev -- /absolute/path/to/repo
```

It serves built assets on port 4173 (`BV_PORT` overrides it). `BV_DATA_DIR` selects
an alternate writable data location. Browser and server are the same loopback origin.
Windows/macOS still need native execution checks; one portable package is not a test
result. See [STATUS.md](../../../docs/claude-code/STATUS.md) and
[VERIFICATION.md](../../../docs/claude-code/VERIFICATION.md).

## Data and network

The same Node SQLite data store and
OS app-data locations are used, with no viewer task database replacing Beads.
Task edits/native comments remain in Beads; inline threads and summary revisions
remain in the viewer store. Uninstall does not remove those external locations.

The broker binds to 127.0.0.1, checks Host/Origin/CSRF, exchanges one-use credentials
for connection-scoped cookies, and never forwards provider credentials. Local HTTP
is not a TLS claim. For SSH use openBrowser:false and forward the same loopback port;
other Host/Origin values are rejected. SSH/browser opening remains unverified.

Official host references: [plugin configuration](https://code.claude.com/docs/en/plugins-reference),
[skills/session substitution](https://code.claude.com/docs/en/skills),
[MCP setup and failed servers](https://code.claude.com/docs/en/mcp).
