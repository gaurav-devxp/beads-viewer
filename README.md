# Beads Viewer

A local browser UI for people already using Beads, with multi-repository task
management, Agent view, Human view and persistent discussions.

**Prerequisites: your authenticated host, supported Node.js, and working Beads.**
The 0.2 Claude package contains prebuilt JavaScript and browser assets; it does not
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
11 x64 support is not inferred from a Linux build. This environment prohibits
loopback listening and Chromium startup, so actual browser and invoking-session
inference remain unverified. Historical 0.1 Linux-runtime archives are superseded.

## Install for Claude Code

Obtain the prebuilt `beads-viewer-0.2.1-claude-code.zip` from the builder and extract
it with your OS archive utility. No public release URL is configured yet. Start
Claude with the extracted **plugin root**:

```sh
claude --plugin-dir "/absolute/path/to/beads-viewer-0.2.1-claude-code"
```

For a package generated locally, from the project root:

```sh
claude --plugin-dir "./artifacts/beads-viewer-0.2.1-claude-code"
```

The archive root is also the plugin root; compatible Claude versions document ZIP
loading through `--plugin-dir`. Verify the installed host's behavior. A raw source
adapter has no staged runtime until contributor build/packaging.

In that same conversation:

```text
/beads-viewer:open {"repositories":["/absolute/path/to/first-repo","/absolute/path/to/second-repo"],"openBrowser":true}
```

Use existing compatible Beads repositories. `openBrowser:false` reports a one-time
local URL. The same-turn relay occupies the invoking Claude turn and uses normal
session authentication, permissions and limits; Disconnect/interruption/expiry
stops it. MCP alone does not start inference. No API key is required by this plugin.

Before opening a broker, the bootstrap checks Node/SQLite and installed Beads. To
run only those checks:

```sh
node "/absolute/path/to/beads-viewer-0.2.1-claude-code/launch.cjs" --check
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
Beads repositories are outside the installed package. When replacing the old 0.1
build, refresh/reinstall the plugin and reconnect; do not mix artifact contents.

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
