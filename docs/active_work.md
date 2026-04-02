### Active Work Summary

The project is at release `@mmnto/cli@1.9.0` with ~2,477 tests across core, CLI, and MCP packages. Pilot mode (#949), enforcement tiers (#987), .env parser (#1114), and spec query expansion (#1016) have merged to main. Next patch release pending changeset.

### Current: 1.10.0 — The Invisible Exoskeleton

Theme: reduce adoption friction for new adopters and solo developers.

**Shipped (merged to main, pending release):**

- ~~**#949**~~ — Pilot mode (warn-only hooks, 14 days / 50 pushes)
- ~~**#987**~~ — Enforcement tiers (strict + agent auto-detection)
- ~~**#1114**~~ — .env parser hardened with dotenv
- ~~**#1016**~~ — Spec query expansion for test infrastructure

**In Progress:**

- **#1152** — Proactive language packs (thick TypeScript/Shell/Node.js baseline rules)
  - **#1153** — "Missed Caught" audit (Phase 0 — categorize historical bot findings)
  - Deep research: DR-57 (TypeScript/ESLint), DR-58 (ShellCheck/POSIX), DR-59 (Node.js Security)
  - Proposals: 210 (Language Packs), 211 (Review Gate Graduation)

**Remaining:**

- **#1033** — Docs scope (fix `totem wrap` doc sync reliability)
- **#1053** — Concurrent dispatch (parallel agent task execution)
- **#1039** — Solo dev experience audit
- Strategy **#62** — Model-specific prompt adapters

### Next: 1.11.0 — The Import Engine

Theme: rule portability across tools and teams.

- **#1138** — ESLint flat config import support
- **#1139** — Totem-to-totem import (cross-repo rule sharing)
- **#1140** — ESLint `no-restricted-syntax`/`properties` handlers
- **#1131** — Rule refinement from false-positive scan alerts
- **#1132** — Auto-detect string-content matches for AST upgrade
- **#1059** — Pack distribution
- Strategy **#50** — GHAS/SARIF extraction
- Strategy **#51** — Lint warning extraction

### Strategy Research (not release-gated)

- **#6** — Trap corpus (adversarial test fixtures)
- **#17** — Eval harness
- **#63** — Spec efficacy measurement

### Recently Completed

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
