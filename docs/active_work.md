### Active Work Summary

Totem is in a Developer Preview state with recent completions of Minimum Viable Configuration (#187) and extensive Phase 2 stability improvements, successfully validating the core CLI and MCP server. The immediate momentum is entirely focused on "Phase 1: The 'Magic' Onboarding & Polish," ensuring the installation process provides immediate, frictionless value to new users before shifting focus to advanced workflows or enterprise scale.

### Prioritized Roadmap

**Do Next (Phase 1: Onboarding & Polish)**

- #128 — Epic: Ship "Universal Lessons" baseline during `totem init` — Provides immediate, tangible value the moment a user completes installation.
- #129 — Epic: Interactive CLI Tutorial & Conversational Onboarding — Guides users through the initial learning curve to build trust in the tool.
- #12 — Cross-platform onboarding: support Windows (PowerShell) & macOS in all docs — Ensures the onboarding process is seamless regardless of the user's operating system.
- #108 — UX: Clean up orphaned temporary prompt files — Essential DX polish to prevent workspace clutter during initial evaluations.

**Up Next (Core Workflows & Usability)**

- #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Automates the core value loop once the user is successfully onboarded.
- #178 — Epic: Clipboard/Export UI for "Freemium Hoppers" — Broadens accessibility for users who aren't ready to fully integrate MCP or local agents.
- #110 — Enhancement: Make markdown chunker MAX_SPLIT_DEPTH configurable — A straightforward core configurability win.
- #179 — Epic: Markdown/Document-Only Mode — Expands the addressable market to non-code use cases.

**Backlog (Phase 3 & 4: Advanced, Enterprise, & Scaling)**

- #181 — Feature: Drift Detection (Self-Cleaning Memory) — Advanced core feature for long-term state management.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Complex architectural enhancement for deeper context.
- #182 — RFC: Tree-sitter Multi-Language Support (Python/Rust) — Slated for Phase 4 Enterprise Expansion.
- #123 — Epic: Federated Memory (Mothership Pattern) — Slated for Phase 4 Enterprise Expansion.
- #175 — Epic: Multiplayer Cache Syncing — Depends on the completion of earlier federated architecture.
- #193 — Epic: Agent-to-Agent Handoff Patterns (The Synthesis Artifact) — Advanced agent workflow orchestration.
- #190 — feat: automated doc sync — keep project docs updated without manual effort — Keeps docs in sync automatically.
- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Advanced MCP capabilities.
- #154 — epic: Sandbox Compatibility & Path Normalization (Stream Crossing) — Platform stability and stream management.
- #144 — epic: Refine AI PR Review Posture & Noise Reduction — Improved review loop tuning.
- #130 — Epic: Database Observability & Management (`totem inspect`) — Visualizing index health.
- #124 — Epic: Automated Onboarding Protocols (`totem onboard`) — Tailored Day 1 briefings.
- #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — AI task runner for custom workflows.
- #92 — Feature: Telemetry Logging and Local Dashboard (`totem stats`) — Tracking API usage.
- #84 — Epic: Issue Tracking System Adapters (Jira, Linear, etc.) — Enterprise integrations.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Ingesting Notion/Confluence.
- #74 — Feature: Add `totem oracle` command for general knowledge querying — Frictionless Q&A.
- #42 — Epic: Solve Universal AI DevEx Friction (Hallucinations, Scope Creep, Testing) — Evolving init guardrails.
- #34 — Feature: Configurable Governance and Traction Points (AI Review Loops) — Enterprise governance configurations.
- #23 — Feature: Automated Memory Consolidation (`totem consolidate`) — Cleaning up and merging old lessons.

### Next Issue (User Story & Scope)

**#128 — Epic: Ship "Universal Lessons" baseline during `totem init`**

**User Story:** As a new user completing `totem init`, I want to receive a curated set of foundational AI security and architectural lessons so that my agents have useful knowledge from Day 1 without needing to build up lessons organically.

**Scope Boundaries:**

- **DO:** Curate an initial set of universal lessons (prompt injection prevention, common framework traps, security baselines).
- **DO:** Add an opt-in prompt during `totem init` to install these baseline lessons.
- **DO:** Write the lessons to `.totem/lessons.md` so they are version-controlled and reviewable.
- **DO NOT:** Auto-install without user consent — these should be opt-in.
- **DO NOT:** Include project-specific or opinionated framework recommendations.

**Why Next:** Now that #187 (MVC tiers) defines the configuration baseline, we can ship universal lessons that provide immediate value on first install. This solves the cold-start problem where a fresh Totem install has no knowledge to retrieve.

### Blocked / Needs Input

- #4 — Validate OpenAI Embedding Provider (Happy Path) — Marked as blocked; pending validation steps.
- #8 — Validate dogfood sync with OpenAI embeddings — Marked as blocked; pending validation steps.
