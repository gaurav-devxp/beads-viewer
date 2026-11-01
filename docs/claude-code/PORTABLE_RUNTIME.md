# Portable runtime and dependency contract

Beads Viewer 0.2 uses installed Node.js and Beads. The same prebuilt JavaScript and
browser assets are packaged for every OS/CPU; no Node, bd, Dolt, Go launcher or
native-addon binary is distributed. The Codex integration remains a scaffold.

## Supported prerequisites

`compatibility.json` is the source of truth used by preflight, the adapter, packaging
and verification. The initial validated implementation is intentionally narrow:

- Node `>=24.11.1 <25`, with `node:sqlite.DatabaseSync` enabled. Version 24.11.1 was
  exercised here; a version-range check is not proof that every patch/OS was tested.
- Beads **1.1.0**, record schema 1 and observed storage schema 1.1.0, with existing
  embedded Dolt storage. Required flags are declared in the same manifest. Other
  Beads releases or storage modes are rejected, not silently migrated.
- Your corresponding normally authenticated host, with ordinary browser/OS facilities.

Consumers do not need npm, Go, a compiler, a ZIP command or a viewer-owned database
service. Beads' own existing setup remains the user's prerequisite. The plugin
never runs an installer, `bd init`, migration, sync or package download.

## Startup

Claude's stdio configuration executes `node` with the resolved installed plugin's
`launch.cjs` as a separate argument. The bootstrap checks the Node range and then
loads the prebuilt prerequisite checker before importing server/SQLite modules.
It checks SQLite availability, resolves Beads and probes version/help without opening
or changing a task workspace. `--check` returns read-only diagnostics instead of
starting MCP. Normal startup writes protocol messages to stdout and errors to stderr.

Node missing entirely cannot be diagnosed by JavaScript. The user-invoked launch
skill tells the main conversation to check the fixed commands `node --version` and
`bd version` through normal host tools, explain installation/PATH problems and stop
before attempting unavailable MCP calls. Claude's own failed-server status is the
fallback when the skill or host execution tool cannot run. CLI component discovery with an
unavailable Node command passed here; actual skill/inference behavior requires separate host checks;
no automatic model wake-up or permission bypass is introduced.

A source checkout is not a staged plugin. Run contributor build and packaging first;
missing prebuilt metadata/runtime produces an actionable error.

## Selecting installed Beads

1. An explicit server option or `BV_BD_BINARY` selects an existing absolute executable
   path or verified JavaScript CLI entry point.
2. Otherwise use absolute directories from the MCP process's inherited PATH. Empty
   entries/current-directory lookup are excluded. Spaces/Unicode are preserved.
3. Resolve symlinks and check the selected file. Windows prefers `bd.exe`; standard
   Node JavaScript entry points run via `process.execPath` with an argument prefix.
4. `.cmd`/`.bat` and extensionless Windows script shims are not executed through a shell. If no native/JS command can
   be selected safely, explain how to point `BV_BD_BINARY` at the actual executable
   already present in that Beads installation.

All probes and task calls use argument arrays, shell disabled, bounded output and
bounded timeouts. Version/help probes report prerequisite failures separately from
per-repository health failures. A bad dependency fails before annotation DB creation
or loopback binding. The adapter revalidates each workspace's storage/schema before
writes. Its existing check-then-write race window is unchanged.

GUI-launched hosts may inherit a different PATH from terminals. Restart the host
or reconnect MCP after environment changes; the plugin never rewrites user/global
configuration. On Unix, for example, start the host with an explicit path:

```sh
BV_BD_BINARY=/absolute/path/to/bd claude --plugin-dir /absolute/path/to/plugin
```

On Windows PowerShell (the OS-provided shell is sufficient):

```powershell
$env:BV_BD_BINARY = 'C:\path with spaces\to\bd.exe'
claude --plugin-dir 'C:\path\to\plugin'
```

The selected program is trusted local tooling, not an executable path accepted from
browser/task content. Diagnostics report selected paths/versions, not credentials
or entire environments.

## Packaging and state

`npm run package:plugin` builds one experimental Claude artifact from prebuilt files:
`artifacts/beads-viewer-0.2.1-claude-code.zip`. Its archive root is the plugin root,
usable after extraction or through a compatible host's documented ZIP loader.
A generated local marketplace is also staged at
`artifacts/beads-viewer-local-marketplace`, with the host adapter at
`plugins/beads-viewer/claude-code`. This is separate from the future source repository
catalogs and does not register anything globally.

Packaging uses Node built-ins to write ZIP, checksums, size metadata and a CycloneDX
inventory of bundled JavaScript libraries. It does not require installed Beads,
copy runtimes or invoke Go/a system ZIP utility. Only build tools/production assets
are used during contributor builds, never installed by the consumer launcher.
`--release` remains blocked by outstanding acceptance gates; `--target`, `--node`
and other former binary-bundling options are removed.

The annotation schema, OS app-data locations, workspace identities, summary
revisions, idempotency receipts and native Beads data are unchanged. Old Linux
0.1 archives/evidence are retained as historical, superseded artifacts. The old
`runtime-lock.json`, Go launcher and launcher cross-build script were removed from
active source.

## Validation boundaries

The artifact layout is portable; actual native OS behavior must still be tested.
There are no claims that a Linux run proves Windows 11 x64, Windows arm64, macOS
or Linux x64 behavior. Tests that simulate Windows candidate names only verify
resolver logic. Real host inference, browser execution and native install/upgrade/
uninstall results remain separate acceptance requirements. This environment currently
rejects loopback listening and Chromium startup; those limitations are not solved
by changing the dependency policy.

See `evidence/portable/` for current checks; earlier evidence outside that subdirectory
belongs to the superseded 0.1 distribution. Current React compatibility and a full
license/SBOM review remain independent release gates.
