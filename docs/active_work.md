### Active Work Summary

The project is at release `@mmnto/cli@1.11.0` (published 2026-04-04) with 2,560 tests across core, CLI, and MCP packages and 419 compiled rules. Release 1.12.0 is pending.

### Current: 1.12.0 — The Umpire & The Router

Theme: internal quality, research validation, and platform hardening.

- ~~**#916**~~ — Lite-tier standalone binary with WASM ast-grep engine (headline feature)
- ~~**#1184**~~ — Evaluate gemma4 variants for the classify task
- ~~**#1189**~~ — Flaky Windows CI timeout
- ~~**#1190**~~ — Use ast-grep engine for no-restricted-properties
- ~~**#1199**~~ — Auto-detect Ollama and default to gemma4
- ~~**#1201**~~ — Narrow GHA injection lint rule scope
- ~~**#1202**~~ — Lazy WASM init in lite binary
- Strategy **#64** — Epic: Model Routing Matrix (research, deferred to 1.13.0)
- Strategy **#17** — Governance eval harness (research, deferred to 1.13.0)
- Strategy **#6** — Adversarial trap corpus (research, deferred to 1.13.0)
- Strategy **#62** — Model-specific prompt adapters (research, deferred to 1.13.0)

### Next: 1.13.0 — The Refinement Engine

Theme: Rule refinement and pack distribution.

- **Rule Engine & Upgrades:**
  - Rule refinement from false-positive scan alerts
  - Auto-detect string-content matches for AST upgrades
  - AST-based empty catch detection
- **Extraction & Integration:**
  - Code scanning alert extraction
  - Linter warning extraction
- **Ecosystem & Distribution:**
  - Rule pack distribution
  - Distributing compiled rules

### Recently Completed

**1.11.0 — The Import Engine (2026-04-04)**

Theme: Rule portability across tools and teams.

- Proactive language packs containing 50 default rules
- ESLint flat configuration import support
- Cross-repository rule sharing via direct import

**1.10.2 — Phase 2: Import Engine Foundations (2026-04-04)**

Retirement ledger, compiler safety, and expanded import coverage.

- **Core Engine & Safety:**
  - Lesson retirement ledger prevents re-extraction of removed rules
  - Compiler guard rejects self-suppressing patterns
  - Linter rule handlers for restricted properties and syntax
- **Maintenance & Configuration:**
  - Model defaults updated for newer language model generations
  - Follow-up items identified for model evaluation, continuous integration stability, and AST engine integration

**1.10.1 — Phase 1 Bug Fixes (2026-04-04)**

Bug fixes and rule hygiene shipped as a patch before the main Import Engine work.

- **Rule Hygiene & Enforcement:**
  - Exemption deduplication via message inclusion checks
  - Narrowed process exit rule to exclude command line entry points and command files
  - Rule conflict audit resulting in a streamlined rule set
- **Infrastructure & Maintenance:**
  - POSIX compliance for monorepo shell hooks
  - Follow-up items identified regarding agent detection and self-suppressing rule bugs

**1.10.0 — The Invisible Exoskeleton (2026-04-02)**

Reduce adoption friction for new users and solo developers.

- **Developer Experience:**
  - Pilot mode with warn-only hooks for an initial trial period
  - Solo developer experience audit for local extraction and global initialization
  - Missed caught audit demonstrating a 44% deterministic capture rate
- **Orchestration & Enforcement:**
  - Enforcement tiers combining strict mode with agent auto-detection
  - Manifest rehash triggers after observation capture
  - Format checking integrated into the pre-push hook
- **Core & Infrastructure:**
  - Environment parser configured securely with dotenv
  - Specification query expansion for test infrastructure
  - Extraction module refactored and split into per-mode modules
  - Exit code behavior fixed for confirmation flag

**1.9.0 — Pipeline Engine (2026-04-01)**

Five rule creation workflows, from manual to fully autonomous:

- **Manual & Deterministic:**
  - Manual scaffolding with auto-generated test fixtures
  - `totem import` workflow translating external tool rules without AI
- **AI-Assisted Compilation:**
  - Prose-to-pattern conversion for natural language rule generation
  - Example-based compilation from code snippets with self-verification
- **Autonomous Orchestration:**
  - Observation auto-capture automatically staging findings as warning-severity rules

Also shipped: documentation and wiki refresh, playground overhaul, and compile-worker cleanup.

**1.7.x — Agent Context Engineering (2026-03-29–30)**

- **Context Management:**
  - Vector and full-text search fallback injects strategy into agent context on boot
  - Command and tool for agent repository understanding
  - Structured checkpoints emitting validated structured data alongside markdown
- **Performance & Maintenance:**
  - Rule garbage collection archiving stale compiled rules with adaptive decay
  - Throughput-based completion estimation with jittered exponential backoff on rate limits

**1.7.0 — Developer Experience (2026-03-29)**

- **Command Line Architecture:**
  - Noun-verb command restructuring with global structured output and redesigned help taxonomy
  - Sensors versus actuators product positioning
- **Enforcement & Security:**
  - Stateless gate architecture replacing flag files with deterministic hooks
  - Actor-aware enforcement with content hash lock at the integration boundary
