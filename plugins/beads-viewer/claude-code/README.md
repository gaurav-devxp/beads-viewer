# Beads Viewer for Claude Code

Experimental portable plugin using **your installed Node.js and Beads**. No native
runtime/launcher bundles are shipped. Read [PORTABLE_RUNTIME.md](../../../docs/claude-code/PORTABLE_RUNTIME.md)
for dependency resolution, compatibility and remaining verification limits.

## Prerequisites

- Normally authenticated Claude Code. Version 2.1.283 was inspected.
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

Obtain the prebuilt `beads-viewer-0.2.1-claude-code.zip` from the builder and extract
it with the OS archive utility. There is no configured public release URL yet.
Start a new Claude session with the extracted **plugin root**:

```sh
claude --plugin-dir "/absolute/path/to/beads-viewer-0.2.1-claude-code"
```

A compatible Claude CLI can also load the plugin ZIP directly; actual loader
results are recorded separately. Do not point at a raw source adapter before its
prebuilt runtime is staged.

In that same Claude conversation, invoke:

```text
/beads-viewer:open {"repositories":["/absolute/path/to/first-repo","/absolute/path/to/second-repo"],"openBrowser":true}
```

Each repository must already have a compatible Beads workspace. Set `openBrowser`
to false to receive a one-time browser link. Options also support initial filters,
task/tab and bounded idle/lifetime settings:

```text
/beads-viewer:open {"repositories":["/path/to/repo"],"filters":{"status":"open,in_progress","project":"Core","q":"checkout"},"openBrowser":false,"idleSeconds":120,"lifetimeSeconds":900}
```

The main-conversation relay occupies this Claude turn and uses its normal model,
authentication, permissions and usage limits. It waits at most ten seconds per tool
call and stops on interruption/disconnect/expiry. MCP alone does not start inference.
Real invoking-session/browser acceptance is still unverified in this restricted
environment; do not equate component discovery with successful inference.

To check prerequisites without opening a browser/listener:

```sh
node "/absolute/path/to/beads-viewer-0.2.1-claude-code/launch.cjs" --check
```

## Persistent local marketplace

Contributors also generate a marketplace at `artifacts/beads-viewer-local-marketplace`.
Register that root, not the plugin subfolder:

```sh
claude plugin marketplace add "/absolute/path/to/artifacts/beads-viewer-local-marketplace"
claude plugin install beads-viewer@beads-viewer-local
```

Restart Claude and inspect `/mcp`. To uninstall only this plugin:

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
