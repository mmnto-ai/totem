---
'@mmnto/cli': minor
---

feat(init): generated configs name models per-role — no ambient `defaultModel` — and stamp current-generation IDs (Tenet-16 corollary follow-on, mmnto-ai/totem-strategy#800 item 1).

`totem init`'s orchestrator detection was the generator of the ambient-default violation class cohort-wide: every generated config committed a concrete `orchestrator.defaultModel`, and the stamped IDs (`gemini-3-flash-preview` / `claude-sonnet-4-6` / `gpt-5.4-mini`) were stale after the 2026-07-14 model refresh. Detection itself is legitimate local-environment resolution at genesis, so it stays; the emitted shape changes to per-role `overrides` covering every LLM-backed role tag (compile/docs/spec/shield/triage/extract/reviewlearn) with current IDs: `gemini-3.5-flash` (Gemini CLI + API branches), `claude-sonnet-5` (Anthropic API), `gpt-5.6-terra` (OpenAI API), the `sonnet` tier alias (claude CLI), `gemma4` (Ollama). The TS-template block is now rendered from the same object serialized into YAML/TOML configs, so the two emission surfaces cannot drift.

Consumer-impact: `totem init` generated-config surface only — newly generated configs get the per-role shape and current model IDs; existing configs are never rewritten. One behavioral edge: a freshly generated config no longer feeds `totem lesson compile --cloud`'s `defaultModel` fallback, so `--cloud` without `--model` fails loud (CONFIG_INVALID) instead of silently riding the previously-generated vendor default — consistent with the mmnto-ai/totem#2357 ruling. No migration required.
