### Active Work Summary

ADR-024 Data Layer Foundation is complete, and the project is currently at release `@mmnto/cli@1.3.11`. Recent efforts integrated CodeRabbit configuration, addressed codebase review fixes (#802), and executed security hardening (#801), subsequently extracting operational lessons from these PRs. Previous sprint work introduced phase-gate enforcement with preflight commit warnings (#793) and expanded the PostCompact hook with a capability manifest (#792). Concurrent work refactored `CLAUDE.md` to a lean root router pattern (#791) and extracted recent operational lessons (c6976ad). Previous efforts fixed documentation generation to prevent persistence of stale issue references (#786, c3a6a0a). Recent sprint efforts introduced index partitions with alias resolution (#782) and expanded core governance by backfilling body text for 125 Pipeline 1 lessons (#781). Previous patch efforts introduced a boundary parameter to the MCP `search_knowledge` tool (#777), consolidated near-duplicate rules (#764), and established a cross-platform CI matrix (#774). Earlier sprint work upgraded `totem spec` to a straitjacket checklist format (#773) and introduced a lesson file linter with a pre-compilation gate (#769). Previous efforts advanced workflow automation by restructuring skills into a directory format (#757) and enforcing `/prepush` validation via `PreToolUse` hooks (#758). Core governance was simultaneously strengthened by introducing Pipeline 1 manual patterns in lessons and reverse-compiling curated rules (#752, #759). Previous release efforts delivered a security hardening batch to address MCP capability caps and injection vulnerabilities (#714), alongside new launch metrics, a Docker test harness (#715), and DX polish targeting onboarding flows and output brevity (#717). Focus advanced through the sprint by introducing `verify_execution`, a refactored compiler facade (#710), and unified error domains (#711)—following successful v1.0 readiness audits and a reversion to a curated 147-rule set (#708).

Post-merge sequence was aligned during a multi-agent planning session (Claude + Gemini, 2026-03-13) informed by Deep Research Brief #24 (Competitive Moat Analysis). See `.strategy/deep-research/24-competitive-moat-analysis/` for the full adversarial analysis.

### Prioritized Roadmap

**Next Up (Post-0.35.0 Sequence)**

The following sequence was determined by cross-referencing the competitive moat analysis (Brief #24) with current product pain points. Ordered by effort/impact ratio:

1. **#434 — Adversarial trap corpus** — Synthetic violations to measure precision/recall of deterministic engine.
2. **#433 — Lesson Packs prototype** — Mine 1 OSS project as proof of concept for distributable rule sets.
3. **#432 — Dynamic imports for CLI startup perf** — GCA Rule 51 follow-up. Convert static `@mmnto/totem` imports to dynamic `await import()` in command files.
4. **#92 — `totem stats` enhancement (Staff Architect visibility)** — Reframed from "telemetry dashboard" to local CLI metrics: violation history from git log, lesson coverage, rule fire counts from local JSONL. No cloud, no TUI — terminal output only for v1.0.
5. **AST Compilation Design (scope within #314)** — Driven by data from the testing harness. Design task, not immediate implementation. Transitions `totem compile` from regex-only to AST-aware rules (Tree-sitter/ast-grep) for the cases where regex is provably insufficient.

**Tier-1 Core & Shift-Left Foundation**

- #314 — Epic: The Codebase Immune System — Adaptive Agent Governance. Now explicitly scoped to include AST compilation design (item 5 above).
- #124 — Epic: Frictionless 10-Minute Init (totem init).
- #430 — Document authority modes for `totem docs` (generated vs. assisted). Fixes the workflow vulnerability where `totem docs` overwrites human-curated strategic decisions.
- #435 — Auto-extract lessons from PR review comments (`totem extract --from-pr`).

**Tier-1 UX & Documentation**

- #283 — Epic: v1.0 Documentation Site & README Minimization.
- #385 — Export compiled rules to Semgrep YAML and ESLint configs — Deferred until core governance (#314) is finalized.

**Backlog (Tier-2 / Tier-3)**

- #392 — feat: `totem review` — full codebase review powered by repomix + vectordb lessons.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Phase 4.

### Completed

- **Search & Data Layer:**
  - Implemented index partitions with alias resolution to enhance vector search capabilities (#782).
  - Added comprehensive test coverage for cross-totem linked index queries and stabilized the AI-powered `totem shield` CI pipeline (#744).
  - Implemented cross-totem query support via the `linkedIndexes` configuration (#665).
  - Enhanced dimension mismatch detection utilizing `index-meta.json` metadata (#660).
  - Implemented Data Loss Prevention (DLP) secret masking middleware to securely strip secrets before embedding (#609, #534).
  - Delivered ADR-024 with hybrid search and Gemini embeddings (#429, #380).
  - Switched default embedder to `gemini-embedding-2-preview` and implemented graceful degradation to Ollama fallbacks (#523, #517).
  - Upgraded LanceDB to 0.26.x and resolved FTS pivot posting panics (#491, #494).
  - Implemented auto-healing DB migrations for version bumps and dimension mismatches (#574, #500).
  - Migrated lessons directory to dual-read/single-write and added startup health checks for LanceStore indexes (#428, #439).
  - Automated `totem sync --full` triggering following embedder configuration changes (#548).
- **Core & Shift-Left Foundation:**
  - Executed security hardening based on codebase review findings and extracted corresponding operational lessons (#801, #802).
  - Implemented phase-gate enforcement to actively warn users on commits lacking preflight validation (#793).
  - Extracted operational lessons from recent orchestration and enforcement PRs (c6976ad).
  - Expanded the enforcement baseline by backfilling body text for 125 Pipeline 1 lessons and extracting recent PR operational lessons (#781).
  - Consolidated near-duplicate rules to streamline the active baseline and improve enforcement precision (#764).
  - Established a cross-platform CI matrix supporting Ubuntu, Windows, and macOS environments (#774).
  - Upgraded `totem spec` to utilize a strict straitjacket checklist format for improved validation (#773).
  - Introduced a lesson file linter with a pre-compilation gate to validate lessons before processing (#769).
  - Introduced Pipeline 1 manual patterns in lessons and reverse-compiled curated rules to strengthen the enforcement baseline (#752, #759).
  - Extracted the `engineFields` compiler helper and refined logging interception for improved reliability (#754, #746).
  - Delivered a security hardening batch addressing MCP caps, taskkill injection vulnerabilities, and heading truncations (#714).
  - Implemented launch metrics and a Docker test harness to improve deployment reliability and evaluation (#715).
  - Unified the error domain with typed `TotemError` subclasses and refactored the compiler architecture using a facade pattern (#711, #710).
  - Reverted to a curated 147-rule set with mandatory verify steps, and fixed branch-diff fallbacks to pre-filter ignored patterns (#708, #709).
  - Delivered 1.3 sprint capabilities including `verify_execution`, spec invariants, and enhanced baseline fix guidance (#688).
  - Introduced `totem explain` allowing users to look up the specific lesson behind a violation (#668).
  - Shipped the Tier 2 AST engine and introduced the `totem init --bare` minimal scaffolding option (#659).
  - Implemented "Complete or Broken" guardrail rules to enforce strict compliance (#663).
  - Executed a portability audit for v1.0 readiness and addressed conditions from the joint code review (#638, #639).
  - Resolved launch testing findings (F-001, F-006) and audited compiled rules to further reduce false positives (#648, #649).
  - Implemented filesystem concurrency locks to safely manage concurrent `totem sync` operations and MCP mutations (#635).
  - Released `totem link` functionality to seamlessly share and sync knowledge lessons across local repositories (#614, #612).
  - Shipped the Universal Baseline, providing 60 battle-tested lessons automatically during `totem init` scaffolding (#622).
  - Introduced the `TotemError` class hierarchy equipped with actionable recovery hints for improved error state handling (#620, #618).
  - Demoted three overly-aggressive AI-powered `totem shield` rules to warnings and explicitly prefixed error logs to reduce false positives (#616, #615).
  - Fixed compiler generation of unsupported glob patterns, addressing brace expansion and nested constraints (#603, #602).
  - Converted `compile.ts` top-level imports to dynamic `await import()` to improve CLI startup performance (#594).
  - Executed a review blitz to address dynamic imports, `onWarn` callbacks, and AI-powered `totem shield` false positives (#605, #595, #575).
  - Configured initialization embedding detection to explicitly prioritize Gemini over OpenAI (#608, #551).
  - Conducted a Rule Invariant Audit focusing heavily on execution determinism (#556).
  - Bumped CodeQL action to v4 to ensure up-to-date security scanning during CI (#579).
  - Automated the ingestion of `.cursorrules` and prompt configurations directly during the `totem init` scaffolding phase (#596, #578).
  - Optimized compilation performance by caching non-compilable lessons to skip redundant recompilation (#590, #569).
  - Refined `fileGlobs` processing to strictly enforce specified directory boundaries, fixing broad `match/exec` overreaches (#589, #584).
  - Delivered Organizational Trap Ledger (Phase 1) featuring SARIF extensions and enhanced statistics (#544, #568).
  - Extracted shared execution logic to unify deterministic `totem lint` and AI-powered `totem shield`. Extended `--format sarif/json` support to deterministic linting (#566, #561).
  - Introduced severity levels (error vs warning) for AI-powered `totem shield` reviews per ADR-028 (#498, #576).
  - Ingested `.cursorrules` and `.mdc` files into compiled rules. Completed an expanded audit of 137 rules categorized by invariant, style, and security (#577, #558, #559, #555).
  - Validated extracted lessons with Zod prior to disk writes and integrated basic CIS metrics into `totem stats` (#565, #425).
  - Delivered `totem test` compiled rule testing harness for ADR-022 to provide empirical rule failure data (#422).
  - Shipped SARIF 2.1.0 output, enabling GitHub Advanced Security integration (#387, #418).
  - Split deterministic `totem lint` from AI-powered `totem shield` and scoped rules to accurate file boundaries to minimize false positives (#549, #546, #521).
  - Scoped the dynamic-import AI shield rule explicitly to command files to reduce false positives (#533).
  - Delivered Semantic Rule Observability (Phase 1) to enhance rule telemetry and tracking (#545, #542).
  - Involuntary enforcement strategy under research (#520).
  - Completed a bug blitz addressing AST gate file reading, glob matching, and orchestrator process leaks (#395, #397).
  - Reinstated agent hooks and audited suppressions (#464).
  - Applied "recency sandwich" pattern to agent instruction files and enforced length limits (#511, #466).
  - Delivered "Universal Lessons" baseline and refined ignore patterns for frictionless initialization (#128, #419).
  - Tuned match/exec patterns and literal file path rules to reduce false positives on docs and config lessons (#538, #457).
- **Orchestration & Integrations:**
  - Integrated CodeRabbit configuration for automated PR reviews (#802).
  - Expanded the PostCompact hook with a capability manifest to enhance agent context during active work (#792).
  - Refactored agent instruction files (`CLAUDE.md`) to utilize a lean root router pattern (#791).
  - Added a boundary parameter to the MCP `search_knowledge` tool to enhance context scoping and extracted corresponding operational lessons (#777).
  - Delivered workflow automation enhancements, restructuring skills into a dedicated directory format (`SKILL.md` per directory) and removing stale commands (#755, #757).
  - Refined agent hooks by enforcing `/prepush` validation via the `PreToolUse` hook and correcting the `PostCompact` hook formatting (#758, #756).
  - Updated reference hooks to utilize deterministic `totem lint` instead of AI-powered `totem shield` for rapid, predictable pre-push validation (#610).
  - Integrated Claude Code hooks for `totem spec` preflight and AI-powered `totem shield` pre-push validation.
  - Automatic enforcement strategy under research (#520).
  - Implemented MCP enforcement tools that equip agents to self-correct during active work (#176, #417).
  - Integrated health checks with MCP first-query gates and resolved race conditions in `add_lesson` debouncing (#442, #564).
  - Added MCP search logging and resolved Gemini embedder dimension mismatches (#440, #444).
  - Resolved auto-handoff on MCP lifecycle events, integrated JetBrains Junie, and fixed MCP connection failures and zombie processes (#383, #503).
  - Fixed MCP `loadEnv` quote stripping and corrected default Gemini model configuration schemas (#560, #563).
  - Shipped graceful degradation for orchestrator providers with SDK-to-CLI fallback capabilities (#522, #516).
  - Configured issue sources to support triage and extraction across multiple repositories (#532, #514).
  - Added Copilot and Junie to `totem init` scaffolding and corrected health check CLI flags (#448, #562).
  - Resolved MCP server connection failures for `totem-dev` and `totem-strategy` (#512).
  - Validated Gemini CLI compliance regarding `search_knowledge` calls with lean configurations (#446).
- **Documentation & DX:**
  - Fixed documentation generation to prevent persistence of stale issue references (#786, c3a6a0a).
  - Executed Developer Experience (DX) polish to streamline onboarding flows, hide legacy commands, and condense standard output (#717).
  - Regenerated project documentation to integrate launch metrics and reflect the v1.3.2 context (#716).
  - Updated the README to prominently feature the new 60-lesson Universal Baseline shipped alongside initialization (6d800bc).
  - Added a dedicated Scope & Limitations section to the architecture documentation (#607).
  - Finalized the v1.0 tagline: "Git for AI. Rule your context." (#606).
  - Finalized the full "Verified Velocity" README rewrite, positioning the tool according to the Holy Grail framework defined in ADR-049 (#586, #557).
  - Hardened `totem docs` generation against hallucinations by actively stripping known-not-shipped issue references from its context (#598, #581).
  - Migrated README to a comprehensive dev wiki (#449). This includes Dev Environment, Testing Conventions, Release Process, and CLI separation guides (#453, #454, #477).
  - Executed a multi-agent code review blitz and refreshed stale prompts for initialization and documentation glossaries (#567, #553).
  - Updated the README to explicitly highlight the Air-Gapped Doctrine (Zero Telemetry) (#474).
  - Updated the GCA styleguide to proactively suppress recurring review nits (#573).
  - Established an Agent Memory Architecture guide and documented the Consumer Scaffolding Pipeline (#447, #451).
  - Released `totem-studio` consumer playground and a multi-totem knowledge domains index repo (#463, #481).
  - Standardized CLI help output and expanded compiled rules with telemetry fields (#358, #415).
  - Completed post-release documentation sync, introduced 34 new lessons, and closed stale tickets (#504, #465).
  - Audited all suppression directives and corrected stale lesson references across documentation (#458, #441).

<!-- No blocked items. #175 was closed, #123 was superseded by ADR-051. Do not re-add. -->
