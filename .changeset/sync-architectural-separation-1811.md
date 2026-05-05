---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-rust-architecture': minor
---

`totem sync` Phase A / Phase B architectural separation (mmnto-ai/totem#1811, ADR-101).

`totem sync` decomposes into two independently-runnable phases:

- **Phase A** — deterministic pack-resolution + `installed-packs.json` write (no API key required, runs in CI).
- **Phase B** — vector-store embedding sync (still requires the embedding key; unchanged).

New mutually-exclusive flags on `totem sync`:

- `--packs-only` (Lite tier): write the pack manifest only; skip embedding sync, prune, the global registry update, and the `review-extensions.txt` write. Designed for CI environments without API keys after a `@mmnto/totem` cohort bump where pack-resolution alone needs to run before `totem lint` recognizes newly registered Tree-sitter languages.
- `--index-only` (Standard tier): run only the embedding sync; skip pack-resolution. Use when `installed-packs.json` is already current and only the vector store needs to re-embed.

Both flags hard-error when combined with each other or with `--full` / `--prune`.

The CLI orchestrator now writes `installed-packs.json` BEFORE invoking `runSync` so `--packs-only` can short-circuit cleanly. The default flag-less behavior is observably equivalent to prior releases.

UX nudge for stale manifests: when a rule expects a Tree-sitter language that isn't registered, the rule-engine now consults `installed-packs.json`'s cohort field and surfaces a structured `STALE_MANIFEST` `TotemError` pointing at `totem sync --packs-only` whenever the manifest is missing, pre-1.27.0, or written by an engine whose `major.minor` differs from the running version. Patch-level cohort drift passes (caret-range pack semver tolerance). Cohort-match falls through to the original "install the pack" `TotemParseError`.

Schema: `InstalledPacksManifestSchema` gains an optional `cohort: string` field (semver). Pre-1.27.0 manifests without the field continue to parse cleanly. Stamped at write time by `writeInstalledPacksManifest()` from `resolveEngineVersion()`; tests can pre-populate the field to override the stamp.

New public surfaces (additive):

- `resolveEngineVersion(): string`
- `detectStaleManifest(opts): StaleManifestDetection | null`
- `staleManifestError(detection, context): TotemError`
- `TotemErrorCode` adds `'STALE_MANIFEST'` and `'FLAG_CONFLICT'`.
