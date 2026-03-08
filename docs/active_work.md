### Active Work Summary

Totem is currently focused on "Phase 1: The 'Magic' Onboarding & Polish," following extensive Phase 2 stability improvements and the implementation of Minimum Viable Configuration (MVC tiers). Recent completions like "Universal Baselines" (Issue #128) have solved the cold-start problem, so momentum is directed entirely at making the initial installation and first-run experience frictionless before expanding to advanced workflows.

### Prioritized Roadmap

**Do Next (Phase 1: Onboarding & Polish)**

- #129 — Epic: Interactive CLI Tutorial & Conversational Onboarding — Crucial next step for guiding users through the initial learning curve to build trust.
- #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Automates the core value loop immediately after onboarding.
- #12 — Cross-platform onboarding: support Windows (PowerShell) & macOS in all docs — Ensures the onboarding process is seamless regardless of the user's OS.
- #108 — UX: Clean up orphaned temporary prompt files — Essential developer experience polish to prevent workspace clutter during initial evaluations.

**Up Next (Phase 3: Core Workflows & Usability)**

- #178 — Epic: Clipboard/Export UI for "Freemium Hoppers" — Broadens accessibility for users who aren't ready to fully integrate MCP.
- #179 — Epic: Markdown/Document-Only Mode — Expands the addressable market to non-code, documentation-only use cases.
- #110 — Enhancement: Make markdown chunker MAX_SPLIT_DEPTH configurable — A straightforward configurability win for core functionality.
- #130 — Epic: Database Observability & Management (`totem inspect`) — Visualizing index health to build trust in the embedded vector database.
- #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Introduces an AI task runner for user-defined markdown workflows.
- #92 — Feature: Telemetry Logging and Local Dashboard (`totem stats`) — Tracks API quota usage locally.
- #74 — Feature: Add `totem oracle` command for general knowledge querying — Frictionless Q&A against the vector database.
- #23 — Feature: Automated Memory Consolidation (`totem consolidate`) — Provides a command to clean up and merge old lessons.
- #190 — feat: automated doc sync — keep project docs updated without manual effort — Keeps project documentation in sync with codebase changes automatically.
- #181 — Feature: Drift Detection (Self-Cleaning Memory) — Detects and prunes stale lessons automatically to maintain memory quality.

**Backlog (Phase 4: Enterprise Expansion & Advanced Architecture)**

- #198 — RFC: Open Core & Defensive Licensing Strategy (MIT vs. Fair Source) — Strategic foundation for open-source and enterprise scaling.
- #195 — Epic: Model Compatibility & Auditing Strategy — Framework for supporting diverse AI models and tracking their performance.
- #196 — Build Adversarial Evaluation Harness for CI (Model Drift Mitigation) — Advanced CI workflow for testing model stability.
- #193 — Epic: Agent-to-Agent Handoff Patterns (The Synthesis Artifact) — Advanced agent workflow orchestration patterns.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Complex architectural enhancement for deeper AI context.
- #182 — RFC: Tree-sitter Multi-Language Support (Python/Rust) — Language expansion slated for enterprise deployment.
- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Advanced MCP capabilities for autonomous agents.
- #175 — Epic: Multiplayer Cache Syncing — Collaborative features dependent on federated architecture.
- #154 — epic: Sandbox Compatibility & Path Normalization (Stream Crossing) — Platform stability and stream management for diverse environments.
- #144 — epic: Refine AI PR Review Posture & Noise Reduction — Improved review loop tuning and signal-to-noise ratio.
- #124 — Epic: Automated Onboarding Protocols (`totem onboard`) — Tailored Day 1 briefings for new developers joining a team.
- #123 — Epic: Federated Memory (Mothership Pattern) — Allows inheriting meta-lessons or team-wide policies from upstream indexes.
- #84 — Epic: Issue Tracking System Adapters (Jira, Linear, etc.) — Enterprise integrations for linking lessons directly to tickets.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Ingesting internal wikis like Notion and Confluence.
- #42 — Epic: Solve Universal AI DevEx Friction (Hallucinations, Scope Creep, Testing) — Evolving init guardrails for universal best practices.
- #34 — Feature: Configurable Governance and Traction Points (AI Review Loops) — Enterprise governance configurations for controlling AI autonomy.

### Next Issue (User Story & Scope)

**#129 — Epic: Interactive CLI Tutorial & Conversational Onboarding**

**User Story:** As a new user installing Totem, I want an interactive, animated CLI tutorial so that I can immediately understand the core workflows and how to ask contextual questions without needing to read external documentation.

**Scope Boundaries:**

- **DO:** Build an interactive, step-by-step CLI tutorial (`totem tutorial`).
- **DO:** Allow users to pause the walkthrough, ask the LLM contextual questions about their codebase, and resume seamlessly.
- **DO NOT:** Introduce any new core CLI commands or concepts that aren't already part of the Phase 1 MVP.
- **DO NOT:** Build any web-based or graphical UI components; this must be entirely terminal-driven.
- **Why Next:** With "Universal Baselines" shipped, the interactive tutorial is the critical missing piece of the "Magic" onboarding experience. It bridges the gap between installation and confident daily use, ensuring users don't abandon the tool immediately after `totem init`.

### Blocked / Needs Input

- #4 — Validate OpenAI Embedding Provider (Happy Path) — Pending validation steps for OpenAI embedding integration.
- #8 — Validate dogfood sync with OpenAI embeddings — Pending validation steps, heavily dependent on the completion of #4.
