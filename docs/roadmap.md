# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is evolving from a deterministic lint engine into a full **governance layer** for AI-assisted development. The roadmap below tracks the progression from enforcement primitives to multi-repo federation.

---

## 1.6.0 — Pipeline Maturity (Current Release)

**Theme:** Close the self-healing loop — the engine learns from developer overrides to reduce false positives over time.

- [x] **The Exemption Engine:** Dual-storage false-positive tracking (local gitignored vs. team committed).
- [x] **Bot Review Integration:** Extract pushback signals from CodeRabbit/GCA and route them to the exemption engine.
- [x] **Trap Ledger:** Append-only audit log of all overrides and bypasses (`.totem/ledger/events.ndjson`).
- [x] **Rule Unit Testing:** Inline "Example Hit/Miss" verification at compile time.
- [x] **Standard Library Enforcement:** Design tenets (e.g., "never use native child_process") compile into blocking lint rules.

---

## 1.7.0 — Developer Experience & Tooling Awareness

**Theme:** Reduce friction — make agents and developers productive from the first command.

- [ ] **Smart Briefing (`totem briefing`):** Inject live Git state, lint health, and recent Trap Ledger events into the agent's context.
- [ ] **CLI Taxonomy Refactor:** Clean command grouping with visual help categories and `[LLM]` badges. Subsume overlapping commands (lint/shield → check).
- [ ] **Solo Dev Experience Audit:** Optimize the extract → compile flywheel for developers without PR review bots.
- [ ] **MCP Tool Hardening:** Embed protocol invariants directly into MCP tool descriptions.

---

## 1.8.0 — The Pipeline Engine

**Theme:** Make rule generation smarter — the compiler should infer scope and context from the codebase, not just the lesson text.

- [ ] **Scope Inference:** Use the PR diff during `totem extract` to suggest accurate `fileGlobs` (e.g., auto-excluding `*.test.ts`).
- [ ] **Spec Context Injection:** `totem spec` proactively searches the knowledge index and injects relevant helper signatures into the agent's plan.
- [ ] **Adversarial Harness:** Stress-test that agents cannot bypass AST rules via string obfuscation or encoding tricks.

---

## 1.9.0 — The Invisible Exoskeleton

**Theme:** Keep the engine fast and the ruleset healthy as lesson count grows.

- [ ] **Rule Garbage Collection:** `totem doctor` identifies and archives rules that no longer trigger.
- [ ] **Adaptive Decay:** Base rule lifecycle on commit-cycle frequency instead of hardcoded time limits.
- [ ] **Meta-Governance:** Compile product tenets into shield rules — the governance loop closes on itself.

---

## 2.0.0 — Federation (The Enterprise Tier)

**Theme:** The COSS Covenant tier — multi-repo coordination for teams running autonomous agents at scale.

- [ ] **Multi-Repo Federation:** Central strategy repo pushes compiled rules to downstream repositories via RBAC.
- [ ] **Signed Trap Ledger:** Cryptographically signed, immutable cloud endpoint for `events.ndjson` ingestion.
- [ ] **Compliance Dashboard:** Override rates by agent source (Claude vs. Gemini vs. Human), rule health trends, bypass audit trail.
- [ ] **Mesh Export:** Portable bundle format for lessons + rules (M&A due diligence, compliance audits).
- [ ] **`totem ui`:** Local web dashboard for rule decay, hit/miss rates, and ledger history.
