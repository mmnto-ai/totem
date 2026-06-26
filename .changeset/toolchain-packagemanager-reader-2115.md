---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(doctor): sense the pnpm-engine-version parity row — packageManager-field toolchain reader (#2115)

Teaches the `version-pinned` detector a toolchain sub-class: a `toolchain-version` row that resolves no deps package (e.g. `pnpm-engine-version`) now reads the consumer's `packageManager` field (`pnpm@11.2.2+sha512…`) instead of a `dependencies` range. `detectVersionPinnedContract` self-routes those rows to a new `detectPackageManagerToolchain`; the CLI no longer stubs them as "drift detection not yet implemented".

The floor comes from the row's own `expected-value-or-derivation` (`pnpm@<floor>` — there is no `packages/*/package.json` to glob, `canonical-source` is null). Reads the DECLARATION only (`senses: declared`), never probes the installed binary. Parses `<name>@<version>(+<hash>)?` tolerantly, compares `version >= floor`, and surfaces a note when the pin is hashless (corepack integrity not pinned — strategy#566). Honest-absent on a missing field, a different engine (the floor doesn't apply), an unparseable pin, or a non-derivable floor; never networks, never throws. A `toolchain-version` row that DOES resolve a deps package (`mmnto-cli-version`) stays on the existing deps floor path.

Empirically: `totem doctor --parity` flips the `pnpm-engine-version` row from `SKIP` to `PASS — pnpm engine pin current — packageManager 11.2.2 ≥ cohort floor 11.2.2`.
