# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is shifting from a "smart linter" to an **Enterprise Governance OS** for AI agents. Our roadmap reflects the transition from building the core deterministic engine to building the multi-repo federation and auditability features required by DevSecOps teams.

---

## 1.6.0 — Pipeline Maturity (Current Release)

**Goal:** Establish the "Self-Healing Loop." The engine must learn from developer frustration to prevent alert fatigue.

- [x] **The Exemption Engine:** Dual-storage false-positive tracking (local gitignored vs. team committed).
- [x] **Bot Review Integration:** Auto-extract pushback/arguments with CodeRabbit and route them to the exemption engine.
- [x] **Trap Ledger Logging:** Cryptographically log all overrides and bypasses for future analysis.
- [x] **Rule Unit Testing:** Require "Example Hits/Misses" in markdown lessons to prove patterns at compile time.
- [x] **Standard Library Enforcement:** Compile design tenets (like "Never use native child_process") into physical blocking gates.

---

## 1.7.0 — Developer Experience & Tooling Awareness

**Goal:** Cure "Agent Amnesia." Ensure AI agents (and human developers) start every session with a perfectly hydrated context window.

- [ ] **Smart Briefing (`totem briefing`):** Inject live Git state, lint health, and recent Trap Ledger events into the agent's Turn-1 context.
- [ ] **CLI Taxonomy Refactor:** Subsume overlapping commands (lint/shield $\rightarrow$ check) and move CI plumbing into a `dev` namespace to achieve a "NASA-by-Google" interface.
- [ ] **Solo Dev Experience Audit:** Optimize the `extract $\rightarrow$ compile` flywheel for developers who don't have PR review bots.
- [ ] **MCP Tool Hardening:** Embed protocol invariants directly into MCP tool descriptions (e.g., "CRITICAL: Call search_knowledge first").

---

## 1.8.0 — The Pipeline Engine

**Goal:** Make the lesson extraction and compilation process hyper-intelligent and context-aware.

- [ ] **Intelligent Scope Inference:** Use the PR diff during `totem extract` to automatically suggest accurate `fileGlobs` (e.g., automatically excluding `*.test.ts` to prevent noise).
- [ ] **Prior Art Concierge:** Upgrade `totem spec` to proactively search the Knowledge Mesh and inject shared-helper signatures into the agent's plan before they write code.
- [ ] **The "Hammer" Stress Test:** Build an adversarial test harness to prove agents cannot jailbreak the AST parser via string obfuscation.

---

## 1.9.0 — The Invisible Exoskeleton

**Goal:** Protect the 3.0-second execution SLA by implementing advanced memory management and rule lifecycle policies.

- [ ] **Rule Garbage Collection:** Implement a mechanism in `totem doctor` to identify and archive dead rules.
- [ ] **Adaptive Decay Thresholds:** Move away from hardcoded time limits (e.g., 180 days) and base rule decay on "Commit Cycles" or "Scope Touch Frequency."
- [ ] **Meta-Governance:** Compile our own product messaging tenets (e.g., "Totem is not an AI Doc Writer") into `shield` rules to prevent marketing drift.

---

## 2.0.0 — Federation (The Enterprise Tier)

**Goal:** Fulfill the COSS Covenant. Provide the coordination layer required for enterprises to safely deploy autonomous agents across hundreds of repositories.

- [ ] **Multi-Repo Federation:** Allow a central Strategy Repo to push compiled architectural rules down to microservice repositories via RBAC.
- [ ] **Centralized Trap Ledger:** Ship `events.ndjson` to an immutable, signed cloud endpoint.
- [ ] **Agent Compliance Dashboard:** A queryable DevSecOps dashboard visualizing override rates grouped by agent source (Claude vs. Gemini vs. Human).
- [ ] **Mesh Export:** A portable format for bundling lessons and rules for M&A due diligence and compliance audits.
- [ ] **`totem ui`:** A local web dashboard for inspecting rule decay, hit/miss rates, and Trap Ledger history.
