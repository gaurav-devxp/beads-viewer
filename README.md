# Beads Viewer

A local browser UI for people already using Beads, with multi-repository task
management, Agent view, Human view and persistent discussions.

**Prerequisites: your authenticated host, supported Node.js, and working Beads.**
The 0.3 Claude package contains prebuilt JavaScript and browser assets; it does not
bundle Node, Beads, Dolt or native launchers. There is one archive per host variant,
with no OS/CPU-specific runtime downloads or build steps during consumer startup.

## Availability and compatibility

| Integration | Status |
| --- | --- |
| Claude Code | Experimental portable package; build/install instructions below. |
| Codex | Scaffold; no installable Codex plugin yet. |
| Real host/browser/platform acceptance | Incomplete; see verification records. |

`compatibility.json` defines the currently supported dependencies: Node
`>=24.11.1 <25` with `node:sqlite.DatabaseSync`, and Beads **1.1.0** using existing
embedded Dolt workspaces. This is a tested adapter contract, not a claim that any
Node or Beads release works. No automatic dependency installation or Beads migration
is performed. Existing Beads dependencies remain part of the user's Beads setup.

Check the environment inherited by your host:

```sh
node --version
bd version
```

The same archive is intended for Windows, macOS and Linux with compatible installed
dependencies. Native execution on each OS/CPU still requires verification; Windows
11 x64 support is not inferred from a Linux build. The installed plugin, a real
browser and same-conversation inference were exercised on Linux arm64; see
[VERIFICATION.md](docs/claude-code/VERIFICATION.md). Historical 0.1 Linux-runtime
archives are superseded.

## Install for Claude Code

Obtain the prebuilt `beads-viewer-0.3.2-claude-code.zip` from the builder and extract
it with your OS archive utility. No public release URL is configured yet. Start
Claude with the extracted **plugin root**:

```sh
claude --plugin-dir "/absolute/path/to/beads-viewer-0.3.2-claude-code"
```

For a package generated locally, from the project root:

```sh
claude --plugin-dir "./artifacts/beads-viewer-0.3.2-claude-code"
```

The archive root is also the plugin root; compatible Claude versions document ZIP
loading through `--plugin-dir`. Verify the installed host's behavior. A raw source
adapter has no staged runtime until contributor build/packaging.

In your existing Beads repository, run:

```text
/beads-viewer:open
```

The skill selects Claude's current repository, opens the browser and ends its turn.
The MCP process keeps the viewer running; Claude remains available for other commands.
Optional JSON can explicitly select additional repositories or initial filters.
No provider API key is required by this plugin.

For browser-triggered Human view generation, install through the local marketplace
below and start Claude **in a terminal** with this plugin's channel enabled:

```sh
claude --dangerously-load-development-channels plugin:beads-viewer@beads-viewer-local
```

Accept Claude's interactive development-channel confirmation only for this plugin.
This is Claude's documented custom-channel preview flow, not a permission bypass.
Organization policies may block Channels; the plugin never changes those policies.
Then run `/beads-viewer:open` normally. The browser reports channel readiness only
after Claude acknowledges it. Generate briefing sends one event; there is no idle
polling. Actual generation uses a normal Claude turn, and events arriving while
Claude is busy wait for the next turn.

The VS Code extension runs Claude without an interactive terminal, and Claude
ignores the development-channel flag there (as documented for SDK/`-p` sessions).
VS Code conversations therefore always use the manual command below.

Without enabled Channels, Generate briefing displays a `/beads-viewer:brief` command.
Copy it into the **same conversation** that opened the viewer to generate exactly
one briefing and return control. This fallback also works if a channel event is
not delivered. A parked viewer no longer expires because Claude is idle; queued
requests wait up to 30 minutes and claimed generation has 15 minutes.
Explicit Disconnect or exiting Claude stops new AI requests.
See the [Claude guide](plugins/beads-viewer/claude-code/README.md) and
[official Channels reference](https://code.claude.com/docs/en/channels-reference).

Before opening a broker, the bootstrap checks Node/SQLite and installed Beads. To
run only those checks:

```sh
node "/absolute/path/to/beads-viewer-0.3.2-claude-code/launch.cjs" --check
```

If Node itself is missing, JavaScript cannot run: the launch skill/host startup
error explains how to select/install Node and restart the host. GUI applications
may inherit a different PATH from terminals. `BV_BD_BINARY` can select an existing
absolute Beads executable or verified JS entry point. Windows `.cmd`/`.bat` shims
are rejected if no safe native/JS command is resolved; task data is never passed
through cmd.exe. See the [runtime guide](docs/claude-code/PORTABLE_RUNTIME.md).

### Persistent local marketplace

Packaging also stages a local marketplace. Register that root and install:

```sh
claude plugin marketplace add "/absolute/path/to/artifacts/beads-viewer-local-marketplace"
claude plugin install beads-viewer@beads-viewer-local
```

Restart Claude and inspect `/mcp`. These use the documented
[Claude marketplace flow](https://code.claude.com/docs/en/plugin-marketplaces).
The generated marketplace is separate from the future repository-wide catalogs.
No global settings are changed by build/package commands.

To remove only this plugin, retaining the catalog for other plugins:

```sh
claude plugin uninstall beads-viewer@beads-viewer-local
```

A `--plugin-dir` trial ends by omitting that option next time. Viewer data and
Beads repositories are outside the installed package.

### Updating the installed plugin

Claude reads a directory marketplace **in place when a conversation starts**, and
that conversation keeps the skills and MCP server it started with. Each packaged
version is therefore staged in its own folder,
`artifacts/beads-viewer-local-marketplace/plugins/beads-viewer/claude-code-<version>`,
and `marketplace.json` points at the newest one. A rebuild never changes files under
a running conversation; packaging refuses to overwrite an already staged version.

1. Bump the version in `package.json` and the plugin's `plugin.json`, then run
   `npm run check` and `npm run package:plugin`.
2. Confirm `claude plugin list` shows the new **Version** and **Read from** folder.
   No `claude plugin update` or reinstall is needed for this marketplace.
3. Start a **new** Claude conversation. Terminal: exit Claude and run it again (with
   the channel flag above if wanted). VS Code: open a new Claude conversation, or
   run **Developer: Reload Window**. Already-open conversations keep the old version.
4. Run `/beads-viewer:open`. Claude reports the viewer version, and the browser
   footer shows **Beads Viewer <version>**.

If a conversation still calls `next_request` or the browser reports "Claude relay
disconnected", that conversation loaded a 0.2 build before the update: start a new
conversation. Older staged folders can be deleted once no conversation uses them.

The command is `/beads-viewer:open`; `/beads-viewer` requires the optional project
alias described in the [Claude guide](plugins/beads-viewer/claude-code/README.md).

## Install for Codex — not yet available

`plugins/beads-viewer/codex` remains a scaffold, with no plugin manifest, skill or
MCP runtime. Do not install the Claude adapter into Codex as a substitute.

Once a Codex release and catalog exist, a compatible CLI's intended flow is:

```sh
codex plugin marketplace add "/absolute/path/to/marketplace-repository"
codex plugin add "beads-viewer@MARKETPLACE_NAME"
```

Replace `MARKETPLACE_NAME` with the actual catalog name, restart Codex and use that
release's documented skill. `$beads-viewer` is planned, not currently available.
The installed CLI 0.166.0 exposes `plugin add/remove`; check your version's help.
[Official OpenAI documentation](https://developers.openai.com/plugins/build/plugins)
describes repository catalogs and supported installation surfaces. These are
future-use instructions, not a working Codex install in this checkout.

To remove a future installed release:

```sh
codex plugin remove "beads-viewer@MARKETPLACE_NAME"
```

## Repository layout

```text
plugins/beads-viewer/
├── claude-code/          # Claude-specific integration
└── codex/                # Codex scaffold
apps/
├── web/                 # shared React interface
└── server/              # shared HTTP server
packages/                # contracts, prerequisites, Beads adapter, annotations, bridge
scripts/                 # build/package/verification tools
compatibility.json       # installed dependency contract
```

Future products use `plugins/<product>/<host>` with separate host catalogs. See
[marketplace layout](docs/MARKETPLACE_LAYOUT.md). App data, annotation schema and
summary revisions remain unchanged by the packaging correction.

## Contributor setup

Build tools are Node and npm. Real integration tests require installed compatible
Beads; browser tests also need Playwright Chromium. Go and external ZIP tooling are
not build/packaging requirements.

```sh
npm ci
npm run check
npm run doctor
npm run package:plugin
npm run verify:package
npm run probe:plugin
npm run test:browser
```

Tests discover installed `bd` on PATH. `BV_TEST_BD` explicitly selects a different
existing native executable for disposable workspace fixtures. Consumers do not run
these commands or install packages. Generated `artifacts/` are Git-ignored, so a
clone does not contain the prebuilt archive. Packaging uses Node built-ins and
requires no Node/Beads binary input, CPU selection or platform compilation.

Standalone contributor CRUD server (no host AI relay), after build:

```sh
npm run dev -- /absolute/path/to/repository
```

`BV_PORT` overrides port 4173; `BV_DATA_DIR` selects writable viewer data. Do not
point at unrelated user Beads workspaces for destructive verification.

## Git tracking

`.gitignore` excludes installed modules, builds/archives, runtime staging, caches,
test output, local databases, secrets and editor/OS temporary files. Source,
marketplace catalogs, skills, lockfiles and intentional redacted evidence remain
trackable. Keep in-checkout `BV_DATA_DIR` under ignored `.beads-viewer/` or
`local-data/`; other custom locations require an ignore entry.

## Verification and remaining work

- [Portable runtime policy and checks](docs/claude-code/PORTABLE_RUNTIME.md)
- [Current limitations](docs/claude-code/STATUS.md)
- [Portable verification; prior results retained separately](docs/claude-code/VERIFICATION.md)

The current React version, real invoking-session proof, native platform acceptance,
browser checks and dependency/license audit remain independent release gates;
portable packaging does not manufacture those results.
