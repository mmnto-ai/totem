## Lesson — a config line CI never executes is unverified, no matter

**Tags:** pnpm, supply-chain, minimumReleaseAge, trap, engine-parity, ci, config-validation

**Applies-to:** infrastructure

pnpm's `minimumReleaseAge` (pnpm-workspace.yaml) takes MINUTES as a bare number — NOT a duration string. pnpm 11.2.2 multiplies the value raw (`'1d' * 60 * 1000` → NaN), producing an Invalid-Date cutoff that crashes EVERY resolving install with "pnpm: Invalid time value" at detectMinReleaseAgeViolation — and the failing importer moves between runs because any freshly-resolved package falls into the violation branch (`ts <= NaN` is false). The `1d` shape reads plausibly because Renovate's same-named setting DOES take duration strings. The misconfig hides in two shadows: CI installs with --frozen-lockfile (no resolution → cutoff never constructed) and an older global pnpm (9.x ignores the unknown key), so the line first executes — and first crashes — on the first corepack-resolving install, weeks after merge. Fix: express as minutes (`1440`), comment the unit. Generalizes the engine-parity rule: a config line CI never executes is unverified, no matter how green the checks.

**Source:** mcp (added at 2026-06-07T02:00:57.165Z)
