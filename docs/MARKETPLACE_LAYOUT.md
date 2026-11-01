# Repository layout for both marketplaces

Group integrations by product, then by host:

```text
repository/
├── .claude-plugin/
│   └── marketplace.json          # planned: Claude Code catalog
├── .agents/plugins/
│   └── marketplace.json          # planned: Codex/OpenAI catalog
├── plugins/
│   ├── beads-viewer/
│   │   ├── README.md
│   │   ├── claude-code/          # Claude plugin root
│   │   │   ├── .claude-plugin/plugin.json
│   │   │   ├── .mcp.json
│   │   │   └── skills/open/SKILL.md
│   │   └── codex/                # Codex integration scaffold
│   └── another-plugin/          # future product
│       ├── claude-code/          # only if supported by this product
│       └── codex/                # only if supported by this product
├── apps/                         # existing shared application code
├── packages/                     # existing reusable implementation
└── docs/
```

The adapter directories have been moved. The two repository-level catalogs above
are a proposed publication layout, not active catalogs added by this change.

## Why this layout

`plugins/<product>/<host>` keeps each product's host adapters together as the
repository gains more products. Each marketplace entry points at its own complete
host plugin root, so installing Beads Viewer does not install every other product
or the other host's integration. Shared application source stays in `apps/` and
`packages/`; it is not copied into both adapter source trees.

`plugins/<host>/<product>` would also work, but spreads one product across separate
trees. Product-first is the recommendation here because the two host integrations
share the same Beads application, contracts and release work. This is a repository
organization choice, not a host requirement.

Keep the marketplace identity publisher/repository-oriented, with `beads-viewer`
as a plugin name. Avoid creating a separate marketplace for every future product.
Each product can have its own version and supported hosts.

## Separate native catalogs

Both catalogs can live in the same repository. Their local source paths resolve
from the repository/marketplace root; they do not resolve from the directory
containing the catalog JSON.

An illustrative Claude catalog entry in `.claude-plugin/marketplace.json`:

```json
{
  "name": "workspace-plugins",
  "owner": { "name": "Your publisher name" },
  "plugins": [
    {
      "name": "beads-viewer",
      "source": "./plugins/beads-viewer/claude-code",
      "description": "A local Beads task workspace."
    }
  ]
}
```

An illustrative Codex catalog entry in `.agents/plugins/marketplace.json`:

```json
{
  "name": "workspace-plugins",
  "interface": { "displayName": "Workspace Plugins" },
  "plugins": [
    {
      "name": "beads-viewer",
      "source": {
        "source": "local",
        "path": "./plugins/beads-viewer/codex"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

These are future catalog shapes, not claims of release readiness or an additional
provider authentication requirement. Verify metadata/policy behavior against the
target host during publication. The viewer uses the invoking host's normal
authentication and must not introduce a separate API key.

Do not list the Codex scaffold as installable until its manifest, skill and session
integration are implemented and validated. Keep explicit native catalogs rather
than relying on a compatibility fallback to interpret the other host's listing.

The repository's `.agents/` directory is read-only in the current environment;
the Codex catalog is therefore documented here rather than written into that
protected directory. No marketplace was registered and no global settings changed.

## Source roots versus installed plugin roots

Source execution directories are now:

- `plugins/beads-viewer/claude-code`
- `plugins/beads-viewer/codex`

The repository root is `../../..` from either directory. Build inputs, TypeScript
imports and active documentation must use the new paths. Historical verification
logs and existing ZIPs retain their original paths as records of those builds.

A catalog installs the selected plugin root, not the entire monorepo. Release CI
must stage a complete prebuilt plugin at the catalog's selected source path (or
use a documented release-archive source). The installed plugin must contain its
own server/MCP bundle and browser assets; it cannot import `../../../apps` or read
the publisher's checkout. Source imports outside the adapter are allowed only as
build inputs that are bundled before distribution.

With the prerequisite correction, produce one portable artifact per host variant,
for example `beads-viewer-<version>-claude-code.zip` and
`beads-viewer-<version>-codex.zip`, each using installed Node and Beads. Host-specific
packaging does not imply separate OS/CPU runtime bundles. The dependency correction is implemented for Claude; remaining acceptance is recorded
in the [current status](claude-code/STATUS.md).

No repository rename, marketplace publication or new Codex implementation is part
of this directory relocation.

## References checked

- [Claude Code marketplace sources and path validation](https://code.claude.com/docs/en/plugin-marketplaces)
- [Official OpenAI plugin packaging and repository marketplace metadata](https://developers.openai.com/plugins/build/plugins)
