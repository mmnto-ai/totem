---
'@mmnto/cli': patch
---

feat(cli): add `verify-lockfile-sync` pre-push gate (mmnto-ai/totem#1961)

Closes [mmnto-ai/totem#1961](https://github.com/mmnto-ai/totem/issues/1961).

New deterministic pre-push check that blocks pushes containing `package.json` dependency-pin additions when `pnpm-lock.yaml` is tracked but missing from the same diff range. Catches the cohort-sync failure pattern where a caret bump in `package.json` lands without a regenerated lockfile and CI's `pnpm install --frozen-lockfile` rejects it ~3 minutes later — recorded N=4 across the cohort, including `mmnto-ai/liquid-city#225/#248/#289/#357`.

The gate is invoked from the generated pre-push hook script (`buildPrePushHook` in `install-hooks.ts`), slotted before the WWND claim-discipline gate so the mechanical fast-fail runs before the slower prose-discipline walk. The check is conditioned on `pnpm-lock.yaml` existing in the working tree, so consumers using a different package manager are unaffected.

Implementation notes:

- `packages/cli/src/commands/verify-lockfile-sync.ts` — pure function `verifyLockfileSyncCommand()` returning a `{ valid, reason? }` result, plus `verifyLockfileSyncCliCommand()` throwing `TotemError` for the CLI surface. Mirrors the `verify-badges.ts` shape.
- Best-effort fall-through on git failures (lockfile not tracked, no remote, detached HEAD, missing refs) — matches the carve-out at `verify-manifest.ts:127-131` so a degraded git state does not block legitimate pushes.
- Regex `/^\+\s*"(?!version")[^"]+"\s*:\s*"[\^~]?\d+\.\d+/m` excludes the package's own `"version"` field (false-positive class on Version Packages release commits where the lockfile happens to be absent from a partial diff), `workspace:^` references, and bare integer values like `"node": "20"` in `engines` blocks.
- No bypass flag. The fix is mechanical (`pnpm install`); a bypass invites the exact drift the gate exists to prevent. The standard `git push --no-verify` escape hatch remains available but is explicitly banned in AGENTS.md.

Encodes the rule body of `feedback_strategy_claude_canonical_cohort_sync` from prose-memory (which has reliably failed to self-activate across N=4 cycles) into mechanism, per Tenet 15 (Axiom Mandate — encode as mechanism, not prose).
