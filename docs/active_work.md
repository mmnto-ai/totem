### Active Work Summary

The project is at release `@mmnto/cli@1.12.0` (published 2026-04-05) with ~2,580 tests across core, CLI, and MCP packages and **397 compiled rules (207 ast-grep, 190 regex)**. **1.13.0 is feature-complete and in release prep.**

### Current: 1.13.0 — The Refinement Engine (release prep)

Theme: Telemetry-driven rule refinement, compilation routing, and AST upgrades.

- **Compilation routing (shipped):**
  - ~~Strategy **#73**~~ — Compilation quality benchmark (Gemini Pro vs gemma4:26b vs Claude Sonnet)
  - ~~**#1220**~~ — Route compile to `anthropic:claude-sonnet-4-6` (90% correctness, 2.4s avg)
  - ~~**#1224**~~ — Bulk Sonnet recompile (438 → 397 rules, 207 ast-grep)
  - ~~**#1225**~~ — Backtick parser hardening (both pipelines)
  - ~~**#1210**~~ — Skip TODO scaffold fixtures in wind tunnel
  - ~~**#1211**~~ — Heading-level dedup in extract pipeline
  - ~~**#1212**~~ — Closed: local gemma4 compilation not viable (benchmark evidence)

- **Telemetry-driven refinement (shipped):**
  - ~~**#664**~~ — AST-based empty catch detection (8 rules upgraded regex→ast-grep)
  - ~~**#1132**~~ — Context telemetry wired into rule metrics (code/string/comment/regex tracking)
  - ~~**#1131**~~ — Rule refinement diagnostic + `compile --upgrade <hash>` flow (PR #1234)

- **Governance + cleanup (shipped this branch):**
  - ~~**chore**~~ — Extract 31 lessons from the 1.13.0 PR arc (#1214–#1234)
  - ~~**chore**~~ — Compile 6 new rules from those lessons (Sonnet)
  - ~~**chore**~~ — Salvage `Closes`-keyword Pipeline 1 rule from a failed inline-example
  - ~~**chore**~~ — Silence 9 non-compilable lessons (3 advisory + 6 deferred to #1236)
  - ~~**feat(governance)**~~ — Pipeline 1 lint rule (severity: error) physically blocks the destructive shell-removal command targeting the load-bearing lessons file, after a 41-rule near-miss

- **Pre-release checklist:**
  - [x] Update `docs/active_work.md`
  - [x] Update `docs/roadmap.md`
  - [ ] Update README + wiki (handed off to Gemini, see notes below)
  - [ ] Add changeset (minor for the milestone)
  - [ ] File totem-playground tickets for playground refresh
  - [ ] Rebuild standalone binary for linux-x64, darwin-arm64, win32-x64
  - [ ] Push branch + open release prep PR
  - [ ] Merge release PR + Version Packages PR to publish 1.13.0

- **Routed to 1.14.0 — The Distribution Pipeline:**
  - **#1059** — Rule pack distribution (headline)
  - Strategy **#35** — Distributing compiled rules (headline)
  - **#1221** — Update cloud compile worker to route through Claude Sonnet (critical for cloud distribution)
  - **#1232** — Thread explicit `cwd` through `compileCommand` (#1234 follow-up)
  - **#1233** — Stray `packages/core/{}` file created during `pnpm build`
  - **#1235** — Batch `--upgrade` hashes in `runSelfHealing`
  - **#1218** — Broad `throw $ERR` ast-grep pattern needs refinement
  - **#1219** — Lazy-load compiler prompt templates

- **Routed to 1.15.0 — The Ingestion Pipeline:**
  - Strategy **#50** — GHAS / SARIF alert extraction (headline; the original #1131 scope before the refinement pivot)
  - Strategy **#51** — Lint warning extraction (headline)
  - **#1226** — SARIF upload hex escape fix (load-bearing for SARIF ingestion)
  - Strategy **#17** — Governance eval harness (validate ingested inputs)

- **Backlog (Horizon 3+):**
  - Strategy **#6** — Adversarial trap corpus
  - Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
  - Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
  - **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

### Next: 1.14.0 — The Distribution Pipeline

Theme: The Totem Pack Ecosystem. 1.13.0 proved the engine generates high-fidelity rules; 1.14.0 lets teams bundle and share them across repositories via the npm registry. Headline work: #1059 + Strategy #35. Cleanup tickets bundled as operational chores along the way (see "Routed to 1.14.0" above).

### After Next: 1.15.0 — The Ingestion Pipeline

Theme: Source Diversity and the Self-Healing Loop. Convert external signals (GHAS alerts, lint warnings) into Totem lessons. Headline work: Strategy #50 + #51.

### Recently Completed

**1.12.0 — The Umpire & The Router (2026-04-05)**

Theme: Standalone binary, research validation, and platform hardening.

- Lite-tier standalone binary with WASM ast-grep engine
- gemma4 eval + Ollama auto-detection
- GHA injection rule scope narrowed + lazy WASM init
- Context tuning (Proposal 213 Phases 2+3)
- 23 lessons extracted, 430 compiled rules at ship

**1.11.0 — The Import Engine (2026-04-04)**

Theme: Rule portability across tools and teams.

- Proactive language packs containing 50 default rules
- ESLint flat configuration import support
- Cross-repository rule sharing via direct import
