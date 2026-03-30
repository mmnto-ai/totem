# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is evolving from a deterministic lint engine into a governance layer for AI-assisted development. The roadmap below tracks the progression of enforcement primitives and pipeline integrity.

---

## 1.7.0 — Platform of Primitives (Shipped)

**Theme:** Evolving the CLI into a standard library for codebase governance and standardizing the user experience.

This phase established deterministic enforcement and core primitives for agent governance.

- **CLI Taxonomy:** Restructured commands into a noun-verb hierarchy and added global JSON output support.
- **Deterministic Enforcement:** Replaced stateful flag files with deterministic Git pre-push hooks utilizing `totem lint`.
- **Agent Governance:** Added inline rule unit testing, enforced secure module usage, and expanded the standard library.

---

## 1.6.0 — Pipeline Maturity (Shipped)

**Theme:** Closing the self-healing loop to track developer overrides and reduce false positives.

This phase introduced system telemetry, rule downgrading, and improved compiler workflows.

- **Self-Healing Loop:** Implemented telemetry tracking, autonomous rule downgrading for noisy rules, and lesson extraction from resolved findings.
- **Shield Hardening:** Improved prompt context for small file changes and enforced execution constraints.
- **Developer Experience:** Enhanced compiler commands and added stress testing for rules and strategy updates.

---

## Prioritized Roadmap

**Theme:** Enhance pipeline integrity, streamline triage workflows, and inject context for AI agents.

- [ ] **Pipeline Integrity:**
  - Implement a lesson logic linter to semantically validate rule scope, severity, and exclusions.
  - Add incremental shield validation to re-check only the active diff after minor fixes.
  - Update triage and review-learn workflows to skip findings that fall outside the current diff range.
- [ ] **Triage Workflow:**
  - **Phase 2:** Integrate agent dispatch capabilities to perform atomic triage fixes.
  - **Phase 3:** Build interactive CLI prompts to guide pull request triage.
  - **Phase 4:** Build a lesson extraction pipeline to automate the bot-to-lesson feedback loop.
- [ ] **Enforcement & DX:**
  - Integrate the exemption engine to unify false positive tracking.
  - Unify enforcement into explicit `totem check` and `totem status` commands.
  - Automate ticket creation for deferred review items.
- [x] **Auto-Context Injection:**
  - Implemented `totem describe` for agent project discovery.
  - Added SessionStart auto-context V2 utilizing local vector search.
  - Created structured session checkpoints for agent handoffs.
