### Active Work Summary

The project is at release `@mmnto/cli@1.11.0` (published 2026-04-04) with 2,553 tests across core, CLI, and MCP packages and 439 compiled rules.

### Current: 1.12.0 — The Umpire & The Router

Theme: internal quality, research validation, and platform hardening.

- **#1184** — Evaluate gemma4 variants for the classify task
- **#1189** — Flaky Windows CI timeout
- **#1190** — Use ast-grep engine for no-restricted-properties
- **#916** — Lite-tier standalone binary (subset CLI, no native deps)
- Strategy **#64** — Epic: Model Routing Matrix
- Strategy **#17** — Governance eval harness
- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters

### Next: 1.13.0 — The Refinement Engine

Theme: Rule refinement and pack distribution.

- **#1131** — Rule refinement from false-positive scan alerts
- **#1132** — Auto-detect string-content matches for AST upgrade
- **#664** — AST-based empty catch detection
- **#1059** — Pack distribution
- Strategy **#50** — GHAS/SARIF extraction
- Strategy **#51** — Lint warning extraction
- Strategy **#35** — Distributing Totem rules

### Recently Completed

**1.11.0 — The Import Engine (2026-04-04)**

Theme: Rule portability across tools and teams.

- ~~**#1152**~~ — Proactive language packs (tier-1 headline feature, 50 rules)
- ~~**#1138**~~ — ESLint flat config import support
- ~~**#1139**~~ — Totem-to-totem import (cross-repo rule sharing)

**1.10.2 — Phase 2: Import Engine Foundations (2026-04-04)**

Retirement ledger, compiler safety, and expanded ESLint import coverage.

- ~~**#1165**~~ — Lesson retirement ledger: `.totem/retired-lessons.json` prevents re-extraction of removed rules
- ~~**#1177**~~ — Compiler guard: rejects self-suppressing patterns (totem-ignore/totem-context/shield-context)
- ~~**#1140**~~ — ESLint `no-restricted-properties` and `no-restricted-syntax` handlers
- ~~**#1185**~~ — Model defaults updated (`claude-sonnet-4-6`, `gpt-5.4-mini`)
- Issues filed: **#1184** (gemma4 eval), **#1189** (flaky Windows CI), **#1190** (ast-grep for properties)

**1.10.1 — Phase 1 Bug Fixes (2026-04-04)**

Bug fixes and rule hygiene shipped as a patch before the main Import Engine work.

- ~~**#1158**~~ — Exemption dedup: added `!includes(message)` check in `recordFalsePositive()`
- ~~**#1164**~~ — Narrowed process.exit() rule to exclude CLI entry points and command files
- ~~**#1166**~~ — Rule conflict audit: deleted 5 lessons, scoped 1 (418 → 413 compiled rules)
- ~~**#1168**~~ — POSIX compliance for monorepo shell hooks
- Issues filed from GCA reviews: **#1175** (agent detection in TS), **#1177** (self-suppressing rule bug)

**1.10.0 — The Invisible Exoskeleton (2026-04-02)**

Reduce adoption friction for new users and solo developers.

- ~~**#949**~~ — Pilot mode (warn-only hooks, 14 days / 50 pushes)
- ~~**#987**~~ — Enforcement tiers (strict + agent auto-detection)
- ~~**#1114**~~ — .env parser hardened with dotenv
- ~~**#1016**~~ — Spec query expansion for test infrastructure
- ~~**#1039**~~ — Solo dev experience audit (local extract, global init)
- ~~**#1153**~~ — "Missed Caught" audit (44% deterministic)
- ~~**#1155**~~ — Manifest rehash after observation capture
- ~~**#1156**~~ — Format check in pre-push hook
- ~~**#1159**~~ — Extract refactor (split into per-mode modules)
- ~~**#1161**~~ — `--yes` exit code fix

**1.9.0 — Pipeline Engine (2026-04-01)**

Five pipelines for rule creation, from zero-LLM to fully autonomous:

- **P1 — Manual scaffolding (#854):** `totem rule scaffold <id>` with auto-generated test fixtures.
- **P2 — LLM-generated:** Existing `totem compile` pipeline for prose-to-pattern conversion.
- **P3 — Example-based compilation (#749):** Bad/Good code snippets compiled to rules with self-verification.
- **P4 — ESLint/Semgrep import (#750):** `totem import` translates external tool configs to totem rules. Zero LLM.
- **P5 — Observation auto-capture (#751):** Shield findings automatically staged as warning-severity rules.

Also shipped: docs/wiki refresh (#1145), playground overhaul (totem-playground#14), compile-worker cleanup (#1146).

**1.7.x — Agent Context Engineering (2026-03-29–30)**

- **SessionStart Auto-Context V2 (#1110):** Vector/FTS search fallback injects strategy into agent context on boot.
- **Project Discovery (#1116):** `totem describe` CLI command and MCP tool for agent repo understanding.
- **Structured Checkpoints (#914):** `totem handoff` emits Zod-validated JSON alongside Markdown.
- **Rule Garbage Collection (#1040):** `totem doctor --pr` archives stale compiled rules with adaptive decay.
- **Compile Progress (#894):** Throughput-based ETA with jittered exponential backoff on rate limits.

**1.7.0 — Developer Experience (2026-03-29)**

- Noun-verb CLI restructuring, global `--json` output, redesigned help taxonomy.
- Stateless gate architecture: ripped out flag files, Git hooks are purely deterministic.
- Actor-aware enforcement: Content Hash Lock at the MCP boundary (ADR-083).
- Sensors vs. Actuators product positioning (ADR-081).
