### Active Work Summary

Totem is currently in a Developer Preview / Early Alpha state, with the immediate strategic focus centered on "Phase 1: The 'Magic' Onboarding & Polish." The primary goal is to ensure users can easily install, configure, and trust the system before the project shifts focus to advanced workflow expansions or enterprise features like federated memory and multi-language support.

### Prioritized Roadmap

**Do Next (Phase 1: Onboarding & Polish)**

- **#187** — ~~RFC: Minimum Viable Configuration (MVC)~~ — **Implemented.** Tiered config (Lite/Standard/Full) with env auto-detection. Embedding is optional; `totem init` auto-detects `OPENAI_API_KEY`.
- **#128** — Epic: Ship "Universal Lessons" baseline during `totem init` — _Provides immediate, tangible value the moment a user completes installation._
- **#129** — Epic: Interactive CLI Tutorial & Conversational Onboarding — _Guides users through the initial learning curve to build trust in the tool._
- **#12** — Cross-platform onboarding: support Windows (PowerShell) & macOS in all docs — _Ensures the onboarding process is seamless regardless of the user's operating system._
- **#108** — UX: Clean up orphaned temporary prompt files — _Essential DX polish to prevent workspace clutter during initial evaluations._

**Up Next (Core Workflows & Usability)**

- **#126** — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — _Automates the core value loop once the user is successfully onboarded._
- **#178** — Epic: Clipboard/Export UI for "Freemium Hoppers" — _Broadens accessibility for users who aren't ready to fully integrate MCP or local agents._
- **#110** — Enhancement: Make markdown chunker MAX*SPLIT_DEPTH configurable — \_A straightforward core configurability win.*
- **#179** — Epic: Markdown/Document-Only Mode — _Expands the addressable market to non-code use cases._

**Backlog (Phase 3 & 4: Advanced, Enterprise, & Scaling)**

- **#181** — Feature: Drift Detection (Self-Cleaning Memory) — _Advanced core feature for long-term state management._
- **#183** — RFC: Cross-File Knowledge Graph (Symbol Resolution) — _Complex architectural enhancement for deeper context._
- **#182** — RFC: Tree-sitter Multi-Language Support (Python/Rust) — _Slated for Phase 4 Enterprise Expansion._
- **#123** — Epic: Federated Memory (Mothership Pattern) — _Slated for Phase 4 Enterprise Expansion._
- **#175** — Epic: Multiplayer Cache Syncing — _Depends on the completion of earlier federated architecture._

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

- **#4** — Validate OpenAI Embedding Provider (Happy Path) — _Marked as Blocked (P1)._
- **#8** — Validate dogfood sync with OpenAI embeddings — _Marked as Blocked (P1)._
