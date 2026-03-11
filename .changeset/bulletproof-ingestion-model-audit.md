---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': patch
---

Adversarial ingestion scrubbing, eval harness, Bun support, and model audit

- **Adversarial ingestion scrubbing:** `sanitizeForIngestion()` strips BiDi overrides (Trojan Source defense) from all content types and invisible Unicode from prose chunks. Suspicious patterns flagged via `onWarn` but never stripped. Detection regexes consolidated into core for DRY reuse. XML tag regex hardened against whitespace bypass.
- **Adversarial evaluation harness:** Integration tests with planted architectural violations for model drift detection. Deterministic tests run without API keys; LLM tests gated behind `CI_INTEGRATION=true` for nightly runs against Gemini, Anthropic, and OpenAI.
- **Bun support:** `detectTotemPrefix()` checks for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2). Priority: pnpm > yarn > bun > npx.
- **Model audit:** Updated default orchestrator model IDs — Anthropic to `claude-sonnet-4-6`, OpenAI to `gpt-5.4`/`gpt-5-mini`.
- **Supported models doc:** New `docs/supported-models.md` with provider model listing APIs and discovery scripts.
