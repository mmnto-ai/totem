/**
 * Totem CLI self-description — the SINGLE source for the program `.description()`
 * (index.ts + index-lite.ts), the `@mmnto/cli` package.json `description` field,
 * and the root `--help` header. A deterministic parity test (description.test.ts)
 * pins the package.json field === this constant so the surfaces never drift.
 *
 * Descriptive core re-cut per the mmnto-ai/totem-strategy#531 A1 tagline
 * convergence (blind-gate release: mmnto-ai/totem-strategy#531 comment
 * 4979503772; operator veto-edit 2026-07-15 removed the em-dash and retired
 * "substrate" from public copy per the plain-words ruling). Supersedes the
 * Prop 294 D1 headline cut (mmnto-ai/totem#2336 comment 4953017531). If a
 * future ratification amends the wording, the re-cut is THIS one constant.
 * GitHub "About" is out of code reach; keep it in manual parity.
 */
export const TOTEM_DESCRIPTION =
  'Totem: local-first toolkit that keeps AI-agent work queryable, enforceable, and derivable as plain files in your codebase';
