## Lesson — Totem Ecosystem Orientation

**Tags:** orientation, architecture, yellow-rule, multi-agent, ecosystem

**Audience:** Any agent operating in a Totem-governed repository (Claude, Gemini, future LLMs)
**Purpose:** Structural orientation — agentic roles, repo composition, tenets, and source-of-truth pointers — so agents derive correct context at session-start without re-discovering ecosystem shape from scratch.
**Compile classification:** Yellow (per Tenet 9) — subjective interpretation, NOT compiled to regex/AST.
**Source of truth:** This lesson summarizes the canonical artifacts at the references below; if discrepancy, the canonical artifact wins. Re-derive from sources, do not cache assumptions from this lesson.

## §1 What Totem is (and is NOT)

**Totem is the deterministic substrate for multi-agent software development on a repository.** Per ADR-090, Totem owns:

- **Memory:** lessons, vector index, `totem extract`, `totem search`
- **Enforcement:** compiled rules (`.totem/compiled-rules.json`), `totem lint`, ast-grep engine, pre-push gates
- **Audit:** Trap Ledger (`events.ndjson`), override records, signoff artifacts
- **Interfaces:** MCP servers exposing the above to any compliant agent

**Totem does NOT own orchestration:** routing, capability negotiation, session lifecycle, live-edit conflict resolution. Those belong to the agent framework (MCP, Agent SDK), version control (git), or the agent runtime. The orchestration layer is fast-moving and competitive; Totem competes at the empty Convention and State Layer instead.

If you (the agent) are tempted to add a feature that "decides which agent runs next" or "resolves conflicts between agents," stop — that's orchestration, not substrate. Apply the Scope Decision Test (ADR-090 §Scope Decision Test).

## §2 The Four-Layer Framework

Totem development organizes around four layers (mmnto-ai/totem-strategy:governance-os-thesis/the-totem-framework.md):

| Layer | Role | Tools | Failure mode if missing |
|---|---|---|---|
| **Executive** | Orchestration & strategy — defines *Why* and *What* | Long-term persistent chat, `mmnto-ai/totem-strategy` repo, ADRs, design tenets | Implementation drift; no architectural compass |
| **Execution** | Implementation — translates specs to working code | IDEs, terminals, compilers, local test suites | Strategy without execution; ideas don't ship |
| **Governance** | Deterministic enforcement — substrate that catches drift | Totem CLI (`lint`, `shield`), pre-push hooks, compiled rules | Lessons forgotten across sessions; same mistakes repeat |
| **Verification** | Probabilistic review — async spot-check on PRs | PR review bots (CodeRabbit, Greptile, Gemini Code Assist) | Deterministic blind spots not caught; semantic violations slip |

**Agents operate across layers as needed**, gated by lane (see §4). The vendor (Claude vs Gemini) does NOT determine layer — Tenet 16 (model-stack-agnosticism). A Claude agent can be in Executive lane (strategy-Claude); a Gemini agent can be in Execution lane (dev-Gemini implementing cohort bumps).

## §3 The Repos

The Totem ecosystem is N-repo and growing (`feedback_ecosystem_is_n_repo_growing`). Current canonical repos:

| Repo | Role | Primary writers | Primary consumers |
|---|---|---|---|
| `mmnto-ai/totem` | The product — Totem CLI, MCP servers, lesson packs, core engine | totem-Claude, totem-Gemini | Every consumer repo |
| `mmnto-ai/totem-strategy` | Governance-OS — ADRs, proposals, design tenets, governance-os-thesis. **Independent Totem instance dogfooding the product to govern its own strategy.** | strategy-Claude, strategy-Gemini, dev-Gemini (tooling) | Anyone needing architectural context |
| `mmnto-ai/totem-substrate` | Inter-agent handoff + journal substrate (`.handoff/` + `.journal/`). Per ADR-100 v0.1: `.handoff/` + `.journal/` only. Direct-commit-to-main for routine writes; PR for tooling changes. | All agents (handoffs are 1:1 per ADR-098 v0.3) | All agents at session-start (hooks read inbox) |
| `mmnto-ai/totem-status` | Dashboard — TUI/JSON/daemon surface. `LatestUnread` slice shipped v0.1; `LatestProcessed`, agent queue (v0.2), and Visor (LanceDB introspection) in flight. | status-Claude, status-Gemini | Humans (TUI) + agents (MCP/session-start) |
| `mmnto-ai/liquid-city` | Dogfood game (Godot top-down, GTA2/Hotline Miami/L4D mashup). Slice ladder: 1 (single-template MST), 2 (procgen MST), 3 (multi-template), 4 (Godot template-export tooling) in flight. | lc-Claude, lc-Gemini, user (parallel dev) | Future players; current dogfood validation |
| `satur8d/skynet-sports`, `arghap11`, others | Adjacent dogfood + private dev | Various | Various |

**Pack ecosystem** (per ADR-085 + ADR-097, v0.1 alpha-pilot fully closed 2026-05-03): `@mmnto/pack-*` NPM packages distribute language/architecture rules, capability rules, and bot interpretive knowledge. Pack ecosystem extends the @mmnto/totem core with specialized lesson sets.

## §4 The Agents — Lanes and Ownership

Agents are organized by `<lane>-<vendor>` composite identifier (per ADR-098 Q7). Vendor is Claude or Gemini; lane indicates ownership domain.

| Agent | Lane | Primary repos | What they own |
|---|---|---|---|
| **strategy-Claude** | Executive — orchestration synthesis, governance, tactical disposition | `mmnto-ai/totem-strategy` (write); cross-repo (read) | Orchestration role; ADR/proposal authoring; cross-stream synthesis; routing decisions; mechanical-disposition work (triage, hygiene, ticketing) |
| **strategy-Gemini** | Executive — strategic synthesis | `mmnto-ai/totem-strategy` (write) | Strategic synthesis (proposals, ADRs at strategic layer, research); see `reference_strategy_role_split` (Claude→mechanical; Gemini→strategic) |
| **totem-Claude** | Execution + Governance — totem core implementation | `mmnto-ai/totem` (write) | Totem CLI, MCP, core engine implementation; lesson pack authoring; `totem` cohort releases |
| **totem-Gemini** | Execution + Governance — totem-core synthesis | `mmnto-ai/totem` (write) | Strategic synthesis on totem-core architecture; spec authoring; cross-repo concerns |
| **dev-Gemini** | Execution — cross-repo tooling | All repos (cohort bumps); substrate-tooling work | Cohort version bumps across consumer repos; engineering-lens cross-stream review; substrate hook implementations |
| **lc-Claude** | Execution — liquid-city impl | `mmnto-ai/liquid-city` (write) | Slice impl PRs; Godot GDScript / template export tooling; postmerge artifacts |
| **lc-Gemini** | Executive — liquid-city design | `mmnto-ai/liquid-city` (write) | Design-doc / spec review; greenlight on slice direction |
| **status-Claude** | Execution — totem-status impl | `mmnto-ai/totem-status` (write) | TUI/Go implementation; dashboard slices |
| **status-Gemini** | Executive + Execution — totem-status design + impl | `mmnto-ai/totem-status` (write) | Architectural framing for dashboard; slice authoring |

**The user is the Flight Controller** (per Tenet 13). They route sensors to actuators, make hard tradeoffs the substrate cannot, and gate cross-stream / liquid-city / load-bearing decisions.

**Agents do NOT enter another agent's primary repo without coordination.** Examples:
- Liquid-city is off-limits for non-LC agents while user + lc-Claude work in parallel (`feedback_liquid_city_user_parallel_dispatch_coord`)
- Cross-stream commits and greenlights need explicit user approval + cross-stream-agent verification (`feedback_cross_stream_commit_gate`)
- Substrate writes require surgical `git add <path>` to avoid concurrent-write conflicts with other agents' WIP

## §5 The Handoff Pipeline

Inter-agent coordination flows through mmnto-ai/totem-substrate:.handoff/<target-agent>/inbox/<UTC-TZ>-<from-agent>.md (per ADR-098). Current frontmatter schema (`adr-098-v0.3`):

```yaml
---
schema: adr-098-v0.3
from: <vendor-and-lane composite>
to: <vendor-and-lane composite>
timestamp: <UTC ISO-like, e.g., 2026-05-06T1845Z>
expected-action: <what recipient should do>
---
```

**Lifecycle:** recipient processes message, moves from `inbox/` to `processed/`. Both subdirs are pre-created and git-tracked per ADR-098 v0.3 amendment. Direct-commit-to-main on substrate for routine handoffs; surgical `git add <path>` to avoid sweeping concurrent agents' WIP.

**Session-start hooks** (.claude/hooks/SessionStart.cjs, .gemini/hooks/SessionStart.js) read agent's inbox automatically and prepend pending dispatches to orientation pass. **Signoff skill** writes journal + handoffs at end-of-session.

**Broadcast vs point-to-point** (`feedback_handoff_broadcast_vs_point_to_point`): same paragraph to 3+ agents → `.handoff/_broadcast/`; "Agent X, do Y" or thread reply → per-agent inbox.

## §6 The Tenets — Load-Bearing Pair

All 16 tenets matter (mmnto-ai/totem-strategy:design-tenets.md), but two are load-bearing for orchestration discipline:

**Tenet 15 (The Axiom Mandate):** Totem's core value is the *deterministic substrate* — regex, filesystem checks, schema validations, git hooks, content hashes. Prose rules drift; substrate-encoded rules survive across model versions, vendor changes, and prompt instability. **When designing a feature, ask first: "Can this be encoded as regex, schema, hook, or filesystem invariant?" If yes, encode it there — even if an LLM version would be more elegant.**

**Tenet 16 (Model-Stack Agnosticism):** The deterministic safety harness must work regardless of vendor (Claude, Gemini, OpenAI, local). No tenet, rule, or core feature may assume a specific provider. Vendor-locked features (provider-specific schemas, prompts, memory caches) are reference implementations only — never core constraints. Vendor-specific work ships as Packs (e.g. @mmnto/pack-claude-attestation), never baked into core.

**Together:** the substrate is permanent and vendor-neutral; LLM-prose is volatile and vendor-locked. The substrate is the product.

## §7 Re-derivation Discipline

This lesson is a **summary**, not a snapshot. If discrepancy with canonical artifacts, the artifact wins.

**Whenever you (agent) are about to act on orientation derived from this lesson, verify against current state:**
- For repo state: read the actual repo file
- For ticket state: `gh issue/pr view`
- For substrate state: `ls .handoff/` + `git log` on substrate
- For tenet text: re-read mmnto-ai/totem-strategy:design-tenets.md
- For ADR state: check `Status:` line in the ADR file (Accepted, Proposed, Superseded)

**`feedback_empirical_vs_cached_drift` fires N=6+ times across the ecosystem.** This lesson is itself a candidate for the same failure mode if treated as authoritative without re-derivation. The vector DB pipeline + `totem-status` Visor exist precisely to catch staleness; use them.

## §8 Source-of-truth pointers

For every fact above, the canonical source:

| Topic | Source |
|---|---|
| Totem scope (substrate vs orchestrator) + multi-agent state | mmnto-ai/totem-strategy:adr/adr-090-multi-agent-substrate.md |
| Four-layer framework | mmnto-ai/totem-strategy:governance-os-thesis/the-totem-framework.md |
| Pack ecosystem | mmnto-ai/totem-strategy:adr/adr-085-totem-pack-ecosystem.md, mmnto-ai/totem-strategy:adr/adr-097-pack-language-archetype.md |
| Universal lessons | mmnto-ai/totem-strategy:adr/adr-011-universal-lessons.md |
| Handoff pipeline | mmnto-ai/totem-strategy:adr/adr-098-inter-agent-handoff-substrate.md |
| Substrate repo extraction | mmnto-ai/totem-strategy:adr/adr-100-substrate-repo-extraction.md |
| Totem-sync separation | mmnto-ai/totem-strategy:adr/adr-101-totem-sync-architectural-separation.md |
| Design tenets (all 16) | mmnto-ai/totem-strategy:design-tenets.md |
| Strategy-vs-Gemini role split | mmnto-ai/totem-strategy:audits/internal/2026-04-25-issue-routing-triage.md (per `reference_strategy_role_split`) |
| Substrate-friction synthesis | mmnto-ai/totem-strategy:audits/internal/2026-05-06-substrate-friction-cross-stream-synthesis.md (mmnto-ai/totem-strategy#236) |
| Derived standing state proposal | mmnto-ai/totem-strategy:proposals/active/264-derived-standing-state.md |
| Liquid-city dogfood positioning | `feedback_liquid_city_is_godot_game` (memory) + mmnto-ai/liquid-city:.totem/specs/ |

## §9 What's locked vs fluid

**Locked (don't change without ADR amendment):**
- Tenets 1–16 (mmnto-ai/totem-strategy:design-tenets.md)
- Substrate scope per ADR-090
- Handoff pipeline schema per ADR-098 v0.3
- Pack ecosystem governance per ADR-085 + ADR-097
- Substrate repo scope: `.handoff/` + `.journal/` only per ADR-100 v0.1

**Fluid (evolving, expect change):**
- Slice-by-slice product roadmap (totem-status v0.2, liquid-city slice 4+)
- Tier 0/1/2/3 work prioritization (per substrate-friction synthesis at mmnto-ai/totem-strategy#236)
- Cross-stream sequencing thresholds (Proposal 264-derived; cutover criterion ADR pending)
- Vendor-specific implementation details (hook syntax, MCP slot config) — agnostic intent, divergent implementation per vendor
- Pack roadmap beyond v0.1 alpha-pilot

When uncertain whether something is locked or fluid: check the ADR `Status:` line and recent journals.

## §10 What this lesson does NOT cover

Out of scope for this lesson:
- **Vendor-specific implementation details** — Claude hook file naming (`.cjs`), Gemini hook file naming (`.js`), MCP config locations. Agents derive these from their own vendor's harness.
- **Specific in-flight PR/issue state** — that's Proposal 264 territory (derived standing state from git/PR/inbox)
- **Specific lesson packs and their content** — agents query via `totem search` for framework-specific lessons
- **User-specific state** — what user is currently working on, current priorities, dogfood validation status. Belongs in dynamic state surface, not structural orientation.
