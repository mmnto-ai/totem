### Active Work Summary

Totem is currently in a Developer Preview / Early Alpha state, with the immediate strategic focus centered on "Phase 1: The 'Magic' Onboarding & Polish." The primary goal is to ensure users can easily install, configure, and trust the system before the project shifts focus to advanced workflow expansions or enterprise features like federated memory and multi-language support.

### Prioritized Roadmap

**Do Next (Phase 1: Onboarding & Polish)**

- **#187** — RFC: Minimum Viable Configuration (MVC) — tiered setup for different user profiles — _Critical first step to reduce installation friction and establish a baseline user experience._
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

**#187 — RFC: Minimum Viable Configuration (MVC) — tiered setup for different user profiles**

**User Story:** As a new user evaluating Totem, I want to initialize the system with a minimal, sensible default configuration so that I can immediately experience its core value without getting bogged down in complex setup decisions.

**Scope Boundaries:**

- **DO:** Define the exact configuration tiers (e.g., Zero-Config, Advanced, Enterprise).
- **DO:** Specify the default values for the baseline MVC setup.
- **DO:** Outline the user prompts/decisions required during `totem init`.
- **DO NOT:** Write the implementation code for the setup wizard.
- **DO NOT:** Modify existing configuration schemas until the RFC is approved.

**Why Next:** The roadmap explicitly dictates that Phase 1 must solve installation friction and build user trust. We cannot successfully build interactive tutorials (#129) or ship baseline lessons (#128) until we have defined the minimum viable configuration state the user is starting from.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) — _Marked as Blocked (P1)._
- **#8** — Validate dogfood sync with OpenAI embeddings — _Marked as Blocked (P1)._
