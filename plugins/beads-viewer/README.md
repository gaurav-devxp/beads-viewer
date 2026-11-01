# Beads Viewer integrations

This product contains two host-specific integration roots:

- [Claude Code](claude-code/README.md): experimental implementation.
- [Codex](codex/README.md): integration scaffold.

Shared application source remains at repository-root `apps/` and `packages/`.
The repository root is `../../..` from either host directory, or `../..` from this
product directory.

See the [marketplace layout](../../docs/MARKETPLACE_LAYOUT.md) for separate native
catalogs in one repository and the rules for adding future plugins.
The [portable runtime policy](../../docs/claude-code/PORTABLE_RUNTIME.md)
records the implemented Claude dependency correction and remaining native/host verification.
