/**
 * Totem CLI self-description — the SINGLE source for the program `.description()`
 * (index.ts + index-lite.ts), the `@mmnto/cli` package.json `description` field,
 * and the root `--help` header. A deterministic parity test (description.test.ts)
 * pins the package.json field === this constant so the surfaces never drift.
 *
 * Descriptive core sourced from Prop 294 D1 headline (ruled 2026-07-12; strategy
 * verdict on mmnto-ai/totem#2336 comment 4953017531). This is a drift-repair off
 * the retired "persistent memory and context layer" category, NOT freeform copy
 * authoring — if D1 ratification amends the wording, the re-cut is THIS one
 * constant. GitHub "About" is out of code reach; keep it in manual parity.
 */
export const TOTEM_DESCRIPTION =
  'Totem — a local-first, file-anchored substrate that makes AI-agent work queryable, enforceable, and derivable in your codebase';
