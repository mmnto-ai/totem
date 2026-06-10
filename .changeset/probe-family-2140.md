---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(doctor): 296 deliverable-1 doctor-side — promoted manifest fields + capability-probe detector family + declared-floor verdict rendering (#2140)

- Parse the four promoted optional parity-manifest fields (`manifestation:`, `senses:`, `vendor-adapter:`, `repo-role-variance:`) into `ParityContract` — max-tolerance at the raw boundary (one mis-shaped or future value narrows per-row, never a manifest-wide outage), honest-absent mapping, `schema-version` unchanged.
- New `detectCapabilityProbeContract` core detector + CLI probe registry routing `manifestation: capability-probe` rows: `knowledge-search-access` (`.mcp.json` registration, present rung) and `claude-settings-minimum-capability` (settings suppression sensing; absent file = pass). Verdicts carry the probed level; when a row declares a stronger `senses:` than the probe proves, the verdict caps at `unknown` (the green-halo guard).
- The `semver.minVersion` fallback in version-pinned (and vendor-SDK attestation) verdicts now renders as a `declared`-level claim with the originating range — never reads as installed-level (296 §6(a)3 post-#605).
- Bump `@mmnto/strategy-doctrine` to 0.1.5 (the promoted 26-contract manifest, the floor this build senses).
