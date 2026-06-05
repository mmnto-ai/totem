---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

`totem doctor --parity` now senses drift across all three tractability classes (the completing slice of the doctor --parity sensor, totem-strategy#448).

- **mechanical content-equality** — managed-block skills (`.claude/skills/*/SKILL.md`), the four per-repo-regenerated git hooks (`.git/hooks/*`, catching stale-version drift), and the static whole-file SessionStart hooks (`.claude/hooks/SessionStart.cjs` + `.gemini/hooks/SessionStart.js`).
- **version-pinned** — `@mmnto/*` cohort-floor pin-currency for the dependency contracts.
- **manual-attestation** — the no-mechanical-sensor class (doctrine-currency rows + vendor-SDK couplings) surfaced as `info`/`skip` only, never failing.

All detection is strictly local-read-only — no network, no cross-repo fetch. Verdicts split `pass`/`warn`/`info`/`unknown`/`skip`, and only a `blocking` drift gates under `--strict`.
