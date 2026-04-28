---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
'@totem/pack-agent-security': patch
---

`totem review` operator-dogfood bundle: override stamps the push-gate cache, plus an explicit `--diff <ref-range>` flag.

- **mmnto-ai/totem#1716** — `totem review --override <reason>` now writes `.totem/cache/.reviewed-content-hash` after recording the override, so the push-gate hook unblocks immediately. Closes the tribal-knowledge `git reset --soft HEAD~1 && totem review --staged` workaround used since the override flag was added. New `recordShieldOverride` helper bundles the trap-ledger write and content-hash stamp into a single call site exercised by both the V2 structured-verdict path and the V1 fallback.
- **mmnto-ai/totem#1717** — adds `totem review --diff <ref-range>` for explicit diff scope (e.g. `--diff HEAD^..HEAD`, `--diff main...feature`). Bypasses the implicit working-tree → staged → branch-vs-base fallback. The chosen diff source is logged to stderr (`Diff source: explicit-range`, `staged`, `uncommitted`, or `branch-vs-base`) so the operator's mental model matches the actual git invocation. Diffs exceeding 50,000 chars now surface a fail-loud truncation warning at the resolution layer — before the LLM call — so the operator can re-run with a narrower range instead of paying for a degraded review. The flag is documented in `--help`'s "Diff resolution" section. New `getGitDiffRange(cwd, range)` core helper rejects flag-injection ranges (leading `-`) and empty values; arg-array `safeExec` invocation prevents shell-metachar interpretation.
