---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

feat: `totem lint` — new command for fast compiled rule checks (zero LLM)

Split from `totem shield`. `totem lint` runs compiled rules against your diff in ~2 seconds with no API keys needed. `totem shield` is now exclusively the AI-powered code review. `--deterministic` flag is deprecated with a warning.

feat: semantic rule observability (Phase 1)

Rules now track `createdAt`, `triggerCount`, `suppressCount`, and `lastTriggeredAt` metadata. `totem stats` displays rule metrics. Foundation for automated rule decay analysis.

fix: shield rule scoping — dynamic import and match/exec rules narrowed

Dynamic import rule scoped to command files only (not adapters/orchestrators). match/exec rule scoped to security-sensitive code only. `.cjs` rule excludes CI workflow YAML.
