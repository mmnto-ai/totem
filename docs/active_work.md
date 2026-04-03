### Active Work Summary

The project is at release `@mmnto/cli@1.10.0` (pending changeset/publish) with ~2,502 tests across core, CLI, and MCP packages and 407 compiled rules. The Invisible Exoskeleton milestone shipped in full. The Import Engine is now current work.

### Current: 1.11.0 — The Import Engine

Theme: rule portability across tools and teams.

- **#1138** — ESLint flat config import support
- **#1139** — Totem-to-totem import (cross-repo rule sharing)
- **#1140** — ESLint `no-restricted-syntax`/`properties` handlers
- **#1131** — Rule refinement from false-positive scan alerts
- **#1132** — Auto-detect string-content matches for AST upgrade
- **#1059** — Pack distribution
- **#1152** — Proactive language packs (moved from 1.10.0)
- **#1158** — Exemption dedup bug fix
- Strategy **#50** — GHAS/SARIF extraction
- Strategy **#51** — Lint warning extraction

### Next: 1.12.0 — Foundation & Validation

Theme: internal quality, test infrastructure, and deferred refactors.

- **#999** — Orchestrator refactor (middleware pipeline)
- **#997** — Centralize path resolution (WorkspaceContext)
- **#1000** — Non-null assertion sweep
- **#1008** — git.ts re-export compat review
- **#1020** — Shield override validation tests
- **#1053** — Concurrent agent dispatch (moved from 1.10.0)
- **#1033** — Docs scope / `totem wrap` reliability (moved from 1.10.0)
- Strategy **#6** — Adversarial trap corpus
- Strategy **#17** — Governance eval harness
- Strategy **#62** — Model-specific prompt adapters (moved from 1.10.0)
- Strategy **#63** — Spec efficacy validation

### Recently Completed

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
