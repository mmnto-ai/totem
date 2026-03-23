### Active Work Summary

The Data Layer Foundation is complete, and the project is currently at release `@mmnto/cli@1.4.1`. Recent focus has centered on:

- **Orchestration & Workflows:**
  - Implemented invisible sync hooks for smooth orchestration context updates.
  - Integrated CodeRabbit configuration for automated PR reviews.
  - Expanded the post-compaction hook with a capability manifest.
  - Refactored agent instruction files (`CLAUDE.md`) to a lean root router pattern.
  - Restructured workflow skills into a dedicated directory format.
  - Enforced pre-push validation via pre-tool-use hooks.
- **Security & Governance:**
  - Refined manifest attestation CI gates with dedicated separate workflows.
  - Hardened ingestion with trust boundaries and an MCP authentication model.
  - Implemented compile manifest signing to establish a provenance chain.
  - Added Data Loss Prevention (DLP) secret masking middleware for outbound LLM calls.
  - Executed codebase review fixes and targeted security hardening.
  - Introduced phase-gate enforcement with preflight commit warnings.
  - Backfilled body text for 125 foundational lessons and extracted operational knowledge from recent PRs.
  - Consolidated near-duplicate rules and reverse-compiled curated enforcement patterns.
  - Delivered a security hardening batch addressing capability limits and injection vulnerabilities.
  - Upgraded the specification process to utilize a strict checklist format.
  - Introduced a lesson file linter with a pre-compilation gate.
- **Search & Infrastructure:**
  - Implemented parallel lesson compilation to optimize processing efficiency.
  - Resolved functionality gaps across AST queries, process execution handling, and suppression metrics.
  - Expanded critical test coverage and executed general codebase quality hardening.
  - Configured AST query engines to fail-closed instead of swallowing exceptions.
  - Added a CI wind tunnel SHA lock to ensure fixture integrity.
  - Enhanced release workflow tag push resilience and updated dependency configurations.
  - Introduced index partitions with alias resolution.
  - Added a boundary parameter to the MCP search tool.
  - Established a cross-platform CI matrix supporting multiple environments.
  - Unified error domains and refactored the compiler architecture using a facade pattern.
  - Delivered unified execution tracking following successful readiness audits.
- **Documentation & DX:**
  - Extracted and integrated operational lessons from recent codebase quality sweeps.
  - Required explicit confirmation before writing LLM-generated documentation.
  - Configured documentation generation to actively strip marketing terminology.
  - Regenerated project documentation alongside 5-lesson extraction.
  - Fixed documentation generation to prevent persistence of stale issue references.
  - Executed developer experience polish targeting onboarding flows and output brevity.
  - Integrated launch metrics and a Docker test harness.

Post-merge sequence was aligned during a multi-agent planning session (Claude + Gemini, 2026-03-13) informed by Deep Research Brief 24 (Competitive Moat Analysis). See `.strategy/deep-research/24-competitive-moat-analysis/` for the full adversarial analysis.

### Prioritized Roadmap

**Next Up (Post-0.35.0 Sequence)**

The following sequence was determined by cross-referencing the competitive moat analysis (Brief 24) with current product pain points. Ordered by effort/impact ratio:

1. **#434 — Adversarial trap corpus** — Synthetic violations to measure precision/recall of deterministic engine.
2. **#433 — Lesson Packs prototype** — Mine 1 OSS project as proof of concept for distributable rule sets.
3. **#432 — Dynamic imports for CLI startup perf** — GCA Rule 51 follow-up. Convert static `@mmnto/totem` imports to dynamic `await import()` in command files.
4. **#92 — `totem stats` enhancement (Staff Architect visibility)** — Reframed from "telemetry dashboard" to local CLI metrics: violation history from git log, lesson coverage, rule fire counts from local JSONL. No cloud, no TUI — terminal output only for v1.0.
5. **AST Compilation Design (scope within #314)** — Driven by data from the testing harness. Design task, not immediate implementation. Transitions compilation from regex-only to AST-aware rules (Tree-sitter/ast-grep) for the cases where regex is provably insufficient.

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
  - Implemented index partitions with alias resolution to enhance vector search capabilities.
  - Added test coverage for cross-repository linked index queries and stabilized the AI-powered `totem shield` CI pipeline.
  - Implemented cross-repository query support via the linked indexes configuration.
  - Enhanced dimension mismatch detection utilizing index metadata.
  - Implemented Data Loss Prevention (DLP) secret masking middleware to securely strip secrets before embedding.
  - Delivered the Data Layer Foundation with hybrid search and Gemini embeddings.
  - Switched default embedder to `gemini-embedding-2-preview` and implemented graceful degradation to Ollama fallbacks.
  - Upgraded LanceDB to 0.26.x and resolved FTS pivot posting panics.
  - Implemented auto-healing DB migrations for version bumps and dimension mismatches.
  - Migrated lessons directory to dual-read/single-write and added startup health checks for LanceStore indexes.
  - Automated full sync triggering following embedder configuration changes.
- **Core & Shift-Left Foundation:**
  - Implemented parallel lesson compilation utilizing a concurrency flag to optimize processing output.
  - Expanded critical test coverage and executed codebase quality hardening cleanups.
  - Resolved execution functionality gaps involving AST queries, process termination handling, and suppression metrics.
  - Refined the manifest attestation CI gate with isolated workflows and adjusted triggers.
  - Hardened ingestion by establishing trust boundaries and an MCP authentication model.
  - Implemented compile manifest signing to ensure a secure provenance chain.
  - Configured AST query engines to fail-closed, preventing swallowed exceptions during execution.
  - Secured testing infrastructure with a CI wind tunnel SHA lock for fixture integrity.
  - Improved release workflow tag push resilience.
  - Executed security hardening based on codebase review findings and extracted corresponding operational lessons.
  - Implemented phase-gate enforcement to actively warn users on commits lacking preflight validation.
  - Extracted operational lessons from recent orchestration and enforcement efforts.
  - Expanded the enforcement baseline by backfilling body text for 125 foundational lessons and extracting recent operational lessons.
  - Consolidated near-duplicate rules to streamline the active baseline and improve enforcement precision.
  - Established a cross-platform CI matrix supporting Ubuntu, Windows, and macOS environments.
  - Upgraded the specification process to utilize a strict checklist format for improved validation.
  - Introduced a lesson file linter with a pre-compilation gate to validate lessons before processing.
  - Introduced foundational manual patterns in lessons and reverse-compiled curated rules to strengthen the enforcement baseline.
  - Extracted the compiler helper and refined logging interception for improved reliability.
  - Delivered a security hardening batch addressing capability limits, taskkill injection vulnerabilities, and heading truncations.
  - Implemented launch metrics and a Docker test harness to improve deployment reliability and evaluation.
  - Unified the error domain with typed subclasses and refactored the compiler architecture using a facade pattern.
  - Reverted to a curated 147-rule set with mandatory verify steps, and fixed branch-diff fallbacks to pre-filter ignored patterns.
  - Delivered sprint capabilities including verified execution tracking, specification invariants, and enhanced baseline fix guidance.
  - Introduced the explain command allowing users to look up the specific lesson behind a violation.
  - Shipped the Tier 2 AST engine and introduced the minimal initialization scaffolding option.
  - Implemented guardrail rules to enforce strict compliance on task completion states.
  - Executed a portability audit for readiness and addressed conditions from the joint code review.
  - Resolved launch testing findings and audited compiled rules to further reduce false positives.
  - Implemented filesystem concurrency locks to safely manage concurrent sync operations and state mutations.
  - Released cross-repository link functionality to smoothly share and sync knowledge lessons across local projects.
  - Shipped the Universal Baseline, providing 60 battle-tested lessons automatically during initialization scaffolding.
  - Introduced the error class hierarchy equipped with actionable recovery hints for improved error state handling.
  - Demoted three overly-aggressive AI-powered `totem shield` rules to warnings and explicitly prefixed error logs to reduce false positives.
  - Fixed compiler generation of unsupported glob patterns, addressing brace expansion and nested constraints.
  - Converted compilation top-level imports to dynamic imports to improve CLI startup performance.
  - Executed a review blitz to address dynamic imports, warning callbacks, and AI-powered `totem shield` false positives.
  - Configured initialization embedding detection to explicitly prioritize Gemini over OpenAI.
  - Conducted a Rule Invariant Audit focusing heavily on execution determinism.
  - Bumped CodeQL action to v4 to ensure up-to-date security scanning during CI.
  - Automated the ingestion of cursor rules and prompt configurations directly during the initialization scaffolding phase.
  - Optimized compilation performance by caching non-compilable lessons to skip redundant recompilation.
  - Refined file path processing to strictly enforce specified directory boundaries, fixing broad execution overreaches.
  - Delivered Organizational Trap Ledger (Phase 1) featuring tracking extensions and enhanced statistics.
  - Extracted shared execution logic to unify deterministic `totem lint` and AI-powered `totem shield`. Extended standard format support to deterministic linting.
  - Introduced severity levels (error vs warning) for AI-powered `totem shield` reviews.
  - Ingested existing agent configuration files into compiled rules. Completed an expanded audit of 137 rules categorized by invariant, style, and security.
  - Validated extracted lessons strictly prior to disk writes and integrated core metrics into local tracking.
  - Delivered compiled rule testing harness to provide empirical rule failure data.
  - Shipped standard format output tracking, enabling external security scanning integration.
  - Split deterministic `totem lint` from AI-powered `totem shield` and scoped rules to accurate file boundaries to minimize false positives.
  - Scoped the dynamic-import AI shield rule explicitly to command files to reduce false positives.
  - Delivered Semantic Rule Observability (Phase 1) to enhance rule telemetry and tracking.
  - Researched involuntary enforcement strategy paths.
  - Completed a bug blitz addressing AST gate file reading, glob matching, and orchestrator process leaks.
  - Reinstated agent hooks and audited suppressions.
  - Applied recency patterns to agent instruction files and enforced length limits.
  - Delivered Universal Lessons baseline and refined ignore patterns for frictionless initialization.
  - Tuned matching patterns and literal file path rules to reduce false positives on docs and config lessons.
- **Orchestration & Integrations:**
  - Added Data Loss Prevention (DLP) secret masking middleware for outbound LLM calls.
  - Implemented invisible sync hooks for smooth orchestration context updates.
  - Integrated CodeRabbit configuration for automated PR reviews.
  - Expanded the post-compaction hook with a capability manifest to enhance agent context during active work.
  - Refactored agent instruction files to utilize a lean root router pattern.
  - Added a boundary parameter to the search tool to enhance context scoping and extracted corresponding operational lessons.
  - Delivered workflow automation enhancements, restructuring skills into a dedicated directory format and removing stale commands.
  - Refined agent hooks by enforcing pre-push validation via pre-tool-use hooks and correcting post-compaction formatting.
  - Updated reference hooks to utilize deterministic `totem lint` instead of AI-powered `totem shield` for rapid, predictable pre-push validation.
  - Integrated Claude Code hooks for preflight specification and AI-powered `totem shield` pre-push validation.
  - Implemented tools that equip agents to self-correct during active work.
  - Integrated health checks with initial query gates and resolved race conditions in lesson debouncing.
  - Added search logging and resolved Gemini embedder dimension mismatches.
  - Resolved auto-handoff on lifecycle events, integrated JetBrains Junie, and fixed connection failures and zombie processes.
  - Fixed environment loading quote stripping and corrected default Gemini model configuration schemas.
  - Shipped graceful degradation for orchestrator providers with SDK-to-CLI fallback capabilities.
  - Configured issue sources to support triage and extraction across multiple repositories.
  - Added Copilot and Junie to initialization scaffolding and corrected health check CLI flags.
  - Resolved server connection failures for development and strategy environments.
  - Validated Gemini CLI compliance regarding search calls with lean configurations.
- **Documentation & DX:**
  - Extracted and integrated new enforcement lessons from recent codebase quality sweeps.
  - Required explicit confirmation before writing LLM-generated documentation.
  - Configured documentation generation to actively strip marketing terminology.
  - Regenerated post-1.3.17 README and performed 47-lesson extraction.
  - Fixed documentation generation to prevent persistence of stale issue references.
  - Executed Developer Experience (DX) polish to streamline onboarding flows, hide legacy commands, and condense standard output.
  - Regenerated project documentation to integrate launch metrics and reflect the latest context.
  - Updated the README to prominently feature the new 60-lesson Universal Baseline shipped alongside initialization.
  - Added a dedicated Scope & Limitations section to the architecture documentation.
  - Finalized product tagline positioning and updated the core document framework.
  - Finalized the full documentation rewrite, positioning the tool according to the established framework.
  - Hardened documentation generation against hallucinations by actively stripping known-not-shipped issue references from its context.
  - Migrated README to a dev wiki covering environments, testing, releases, and CLI guides.
  - Executed a multi-agent code review blitz and refreshed stale prompts for initialization and documentation glossaries.
  - Updated the README to explicitly highlight the air-gapped security doctrine.
  - Updated the styleguide to proactively suppress recurring review nits.
  - Established an Agent Memory Architecture guide and documented the consumer scaffolding pipeline.
  - Released consumer playground and a multi-project knowledge domains index repository.
  - Standardized CLI help output and expanded compiled rules with telemetry fields.
  - Completed post-release documentation sync, introduced new lessons, and closed stale tickets.
  - Audited all suppression directives and corrected stale lesson references across documentation.

<!-- No blocked items. Prior tickets were closed or superseded. Do not re-add. -->
