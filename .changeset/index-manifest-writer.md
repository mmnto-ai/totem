---
'@mmnto/totem': minor
---

`totem sync` now writes `.totem/index-manifest.json` for downstream consumers (e.g., the
`totem-status` Visor TUI), avoiding the need for those consumers to pull massive
LanceDB CGO/Rust bindings just to enumerate indexed-document metadata.

The manifest schema is `totem-index-manifest-v0.2`. Each `documents[]` entry exposes
`sourceFile`, `origin` (derived structurally from `node_modules/<pkg>` paths, otherwise
`local`), `rowCount`, and `lastSynced`. When the project is a git checkout, an optional
`gitCommit: 'git:<sha>'` field records provenance; the field is omitted when no git
SHA is available (no synthesized fake-presence values).

New public API: `buildIndexManifest`, `INDEX_MANIFEST_SCHEMA`, `IndexManifest`,
`ManifestDocument`, and `LanceStore.manifestDocuments()`. The manifest file is
gitignored.
