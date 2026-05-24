---
'@mmnto/cli': patch
---

chore(tooling): auto-augment empty cohort-link CHANGELOG headers at `changeset version` time (closes #1969)

Ships the structural fix for the recurring empty-cohort-header drift class — same pattern that hit cycles 1-5 (`#1965` / `#2009` / `#2016` / `#2021` / `#2024`) and required manual in-place backfills on each auto-VP PR.

## What ships

- **`tools/augment-cohort-changelog-headers.mjs`** — post-`changeset version` script that detects empty `## X.Y.Z` headers in the three pack CHANGELOGs (`packages/core`, `packages/pack-agent-security`, `packages/pack-rust-architecture`) and injects the canonical generic cohort-link note. Idempotent: any header with a non-blank body line is left untouched.
- **Wiring:** root `package.json` `"version"` script chains `changeset version && node tools/augment-cohort-changelog-headers.mjs` so the auto-VP PRs ship with augmented headers from the first commit.
- **`tools/augment-cohort-changelog-headers.test.mjs`** — 9-test bare-node suite covering empty-header detection (mid-file + EOF), idempotency, no-op on bodied headers (cli `### Patch Changes` case + already-augmented case), multi-empty-in-one-file with output-shape assertion, malformed-version-header rejection, and the target-list invariant.
- **One-time historical sweep:** 84 historical empty headers across the three packs (going back to ~1.32) backfilled in the same commit. The detection pattern is universal; restricting the script to "recent versions only" would add complexity for no gain.

## Doctrine anchor

Per strategy-claude's 2026-05-23T2114Z altitude call on `#1969` (with strategy-agy + strategy-codex peer-review concurrence, N=3 cross-vendor):

- **Option (a) auto-augment**, not (b) native skip (changesets H2 header is hardcoded at apply-release-plan level, not configurable via the `changelog` hook) and not (c) suppress bot findings (right altitude, wrong direction).
- **Uniform generic note** across all 3 packs, not the asymmetric specific-note pattern that would manually mirror CLI's CHANGELOG content (Tenet 20 stale-mirror trap).
- **Post-`changeset version` script**, not upstream-changesets RFC (multi-month escalation; declined).

## Canonical note text

```
_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._
```

Matches the established repo pattern across `1.43.x` / `1.44` / `1.45` / `1.46` / `1.47` / `1.49` cycles. The recently-backfilled `1.49.1` (cycle 5 at `495faba2`) ships with this exact form, so the script's idempotency is verified against live state.

## Why this is a PATCH bump

Build-tooling change with no published-package API surface delta. Future auto-VPs will have augmented pack headers from the start — same artifact as the manual backfill that landed on cycles 1-5, but without the human in the loop.
