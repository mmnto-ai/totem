# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is evolving from a deterministic lint engine into a full **governance layer** for AI-assisted development. The roadmap below tracks the progression from enforcement primitives to multi-repo federation.

---

## 1.7.0 — Platform of Primitives (Shipped)

**Theme:** Evolving the CLI into a standard library for codebase governance, eliminating opinionated agent friction, and standardizing the UX.

- [x] **CLI Taxonomy Redesign:** Complete noun-verb hierarchical restructuring (`totem rule list`, `totem config get`). Help menus logically grouped by Core, Entities, and Workflow.
- [x] **Actor-Aware Enforcement:** Nixed stateful flag files. Redesigned Git hooks to be purely deterministic (`lint`, `verify-manifest`). LLM push-gates are now optional Reference Implementations driven by Content Hashes at the MCP boundary.
- [x] **Global Output:** Every command now supports `--json` for pipeline integration.
- [x] **Developer Experience:** Added `hooks --force` for easy upgrades. `triage-pr` correctly parses multiple CodeRabbit nits.

---

## 1.6.0 — Pipeline Maturity (Shipped)

**Theme:** Close the self-healing loop — the engine learns from developer overrides to reduce false positives over time.

- [x] **Self-Healing Loop:** Integrated the Trap Ledger and exemption engine to track dual-storage false positives and capture bot review signals.
- [x] **Core Enforcement:** Added inline rule unit testing at compile time and enforced core design tenets via the standard library.
- [x] **Developer Experience:** Improved compiler workflows, added shield flag auto-refresh on pre-push, and introduced stress testing for rules.

---

## Prioritized Roadmap

**Theme:** Enhance pipeline integrity, streamline triage workflows, and consolidate developer tooling.

- [ ] **Pipeline Integrity:**
  - Implement a lesson logic linter to semantically validate rule scope, severity, and exclusions.
  - Add incremental shield validation to re-check only the active diff after minor fixes.
  - Update triage and review-learn workflows to skip findings that fall outside the current diff range.
- [ ] **Triage Workflow:**
  - **Phase 2:** Integrate agent dispatch capabilities to perform atomic triage fixes.
  - **Phase 3:** Build interactive CLI prompts to guide pull request triage (Shipped).
  - **Phase 4:** Build a lesson extraction pipeline to automate the bot-to-lesson feedback loop (Partially shipped: SARIF support and severity levels added).
- [ ] **Enforcement & DX:**
  - Unify enforcement into explicit `totem check` and `totem status` commands (Shipped).
  - Automate ticket creation for deferred review items.

---

## 2.0.0 — Federation (The Enterprise Tier)

**Theme:** The COSS Covenant tier — multi-repo coordination for teams running autonomous agents at scale.

- [ ] **Multi-Repo Federation:** Central strategy repo pushes compiled rules to downstream repositories via RBAC.
- [ ] **Signed Trap Ledger:** Cryptographically signed, immutable cloud endpoint for ingestion.
- [ ] **Compliance Dashboard:** Track override rates by agent source, rule health trends, and bypass audit trails.
- [ ] **Mesh Export:** Portable bundle format for lessons and rules.
- [ ] **`totem ui`:** Local web dashboard for rule decay, hit/miss rates, and ledger history.
