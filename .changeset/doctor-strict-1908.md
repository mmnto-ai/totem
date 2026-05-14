---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-rust-architecture': minor
---

feat(doctor): add `--strict` mode + pre-push hook integration + CI workflow template (#1908)

Implements Proposal 273 § 7 routing matrix rows 5+6 (Repo + Auto + Both) for the first repo-state diagnostic (`checkAgentsMdCanonical`, shipped in #1907).

- `totem doctor --strict` now exits non-zero when any check reports `fail` (`warn` results remain informational). Default behavior unchanged.
- Pre-push hook injects `totem doctor --strict` inside the existing strict-tier guard (`is_agent=1` or `TOTEM_HOOK_TIER=strict`), mirroring the `totem review` shield gate. Standard-tier humans bypass; agents and explicit strict-tier operators get the gate.
- New `.github/workflows/totem-doctor.yml` template runs `doctor --strict` on PR + push to main. Cohort repos can copy or reference.

Exit-code decision lives at the CLI edge — `doctorCommand` returns `DiagnosticResult[]` and does not touch `process.exit` / `process.exitCode`.

**Calibration fix bundled.** `checkEmbeddingConfig` previously reported `fail` when the configured embedder's env key (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY`) was missing. That misclassified an operator-setup state as a repo defect — empirically surfaced when `totem doctor --strict` ran in CI on this PR (CI intentionally lacks the keys). Both branches now return `warn`, mirroring `checkOllama`'s warn-on-unreachable pattern. The repo's config is correct; the local environment is incomplete.
