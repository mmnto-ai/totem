# Config Reference

Totem uses a flexible configuration resolution chain to support different project setups.

## Resolution Chain

Totem searches for configuration files in the following order:

1. `.totem.config.ts`
2. `.totem.config.yaml`
3. `.totem.config.yml`
4. `.totem.config.toml`

## Global Registry

Totem maintains a global registry of workspaces at `~/.totem/registry.json`. This registry powers the cross-repo knowledge mesh, allowing the `totem list` command to discover all initialized Totem projects on your machine.

## CLI Configuration Overrides

Specific command configurations can be overridden.

- **DocTarget:** The `--target userFacing` flag can be passed to `totem docs` to ensure documentation is written using a plain-text, objective voice suitable for end-users.
