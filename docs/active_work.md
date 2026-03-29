### Active Work Summary

The project is at release `@mmnto/cli@1.6.0` with 1,032 lessons, 379 compiled rules, and 2,084 tests. The active milestone themes focus on pipeline maturity, compiler developer experience, and shield reliability.

Recent completed work (1.5.6–1.5.8):

- **Agent Governance:**
  - Rule unit testing enables inline hit and miss verification at compile time.
  - Forbidden native module rules enforce secure module usage.
  - A new standard library includes safe execution and git adapter functions.
- **Codebase Audit Remediation:**
  - Error cause chains span the error hierarchy.
  - Injectable loggers replace console warnings in core.
  - Phase-gate hooks now block operations instead of warning.
  - Line endings are normalized via git attributes and formatting rules.
- **Self-Healing Loop:**
  - Append-only telemetry captures system events.
  - Autonomous rule downgrading mitigates noisy rules.
  - Triage inbox is categorized with severity mapping.
  - Review-learn extracts lessons from resolved bot findings.
- **Shield Hardening:**
  - **Context & Resiliency:** Prompts include full file content for small changed files. Hook paths resolve from the git root.
  - **Execution Constraints:** Commands use forced pipe mode with type-safe return guards. Hook regex strictly matches git subcommands.
  - **Parsing & Overrides:** Audited bypass flags handle false positives. Parsing uses reliable tools with graceful fallbacks.
  - **Environment Isolation:** Disabled AI prompts on direct invocations. Excluded worktrees from formatting rules.
- **Ecosystem:**
  - Findings model unifies rule violations and deduplicates results.
  - User-defined secrets implement data loss prevention at AI boundaries.
  - Baseline lessons establish language packs for Python, Rust, and Go.
  - Strategy submodules run isolated operational instances.

### Prioritized Roadmap

**Pipeline Integrity**

- Lesson logic linter enables semantic validation for scope, severity, and exclusions.
- Incremental shield validation performs diff-only re-checks after minor fixes.
- Triage and review-learn commands skip findings outside the diff range.

**Triage Phases 2–4**

- Phase 2: Agent dispatch integration for atomic triage fixes.
- Phase 3: Interactive command-line interface prompts for pull request triage.
- Phase 4: Lesson extraction pipeline from bot to lesson loop (blocked).

**Enforcement & DX**

- Exemption engine unifies false positive tracking.
- Unified enforcement commands support check and status workflows.
- System auto-tickets deferred bot review items.

### Completed (1.6.0–1.6.2 milestones)

- **Compiler & DX (1.6.2):**
  - Shipped compiler developer experience improvements.
  - Stress-tested lessons, compiled rules, wiki content, and strategy updates.
- **Pipeline Stability (1.6.1):**
  - Deployed pipeline fixes.
  - Corrected shield flag auto-refresh behavior on pre-push hooks.
- **Agent Governance (1.6.0):**
  - Integrated rule unit testing.
  - Shipped forbidden native module lessons.
  - Implemented test audit global state.
- **Core Enhancements (1.6.0):**
  - Added error cause chains and migrated standard library functions to core.
  - Introduced dependency-injected loggers and test coverage.
- **Self-Healing & Quality (1.6.0):**
  - Finalized phase-gate hardening and telemetry logs.
  - Completed the first triage phase and safe-regex validation.
- **Refactoring & Clean-up (1.6.0):**
  - Deprecated obsolete shield contexts.
  - Stripped citation references during ingest.
  - Addressed dynamic import scoping.

<!-- No blocked items except Phase 4, which depends on Phases 2-3. -->
