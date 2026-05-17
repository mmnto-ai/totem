## Lesson — WWND Rule 1: Absolute-promise detection on public surfaces

**Tags:** claim-discipline, wwnd, tenet-19, governance
**Engine:** regex
**Scope:** README.md, AGENTS.md, design-tenets.md, docs/wiki/**
**Severity:** warning
**Pattern:** `\b(?:[Ww]ill\s+(?:stay|remain|always\s+be|never\s+(?:change|move))|[Ww]on['']t\s+(?:change|ever)|[Gg]uarantees|[Pp]romises\s+to)\b`

**Message:** Absolute future-tense promise detected — flag for [Tenet 19 § How to apply item 4](https://github.com/mmnto-ai/totem-strategy/blob/main/design-tenets.md#19-claim-discipline). Either (a) name the structural backing inline (LICENSE, ADR-084 covenant clause, foundation governance, etc.) so a naive reader can verify the promise is actually backed, or (b) soften to present-tense intent ("we aim to keep X stable", "the core stays free under the current LICENSE"). The unbacked future-tense form is the same shape that [`mmnto-ai/totem#1933`](https://github.com/mmnto-ai/totem/pull/1933) was flagged for by CodeRabbit R3.

### Bad Example

```markdown
The core will always be free. The MIT license guarantees this. We promise to never change the terms.
```

### Good Example

```markdown
The core stays free under the MIT LICENSE in this repository, governed by ADR-084 (Open Source Commitment). Material covenant changes require a doctrine ADR with a 30-day notice window.
```

## Why this is a deterministic regex rule

[Tenet 19 § How to apply item 4](https://github.com/mmnto-ai/totem-strategy/blob/main/design-tenets.md#19-claim-discipline) names the failure mode structurally: covenant claims that read as absolute future-tense promises without naming the structural backing that holds them. The empirical seed corpus was N=4 within a 24-hour window on 2026-05-15 — the [`mmnto-ai/totem#1925`](https://github.com/mmnto-ai/totem/pull/1925) / [`#1932`](https://github.com/mmnto-ai/totem/pull/1932) / [`#1933`](https://github.com/mmnto-ai/totem/pull/1933) cluster — all caught post-merge by external review (user audit, lc-Claude empirical audit, CodeRabbit absolutes catch). The pattern that fired all four was the same: an absolute promise with no inline backing.

The compiled regex catches the highest-density subset of those phrasings (`will stay`, `will always be`, `will never change`, `won't change`, `guarantees`, `promises to`). Severity is `warning` rather than `error` because some uses are legitimate when the backing is named adjacent — the gate reports the finding; the author either adds the backing or softens, but the push isn't blocked. The Tier 0 pre-push hook ([Proposal 279 § Implementation Notes Q3](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/active/279-wwnd-claim-discipline-gate.md#pre-push-hook-sequencing-q3)) surfaces the finding before merge.

Scope is intentionally narrow: only public claim surfaces (`README.md`, `AGENTS.md`, `design-tenets.md`, `docs/wiki/**`) where naive-reader decode matters. Internal docs, source code, test fixtures, and PR comments are out of scope — those audiences can be expected to interpret prose-discipline context that public consumers cannot.

## Why this lands as a direct rule (Pipeline 1)

This is one of the "proposal specifies the exact pattern" rules per [cross-stream coordination 2026-05-16T20:35Z](https://github.com/mmnto-ai/totem-substrate/blob/main/.handoff/totem-claude/processed/2026-05-16T2035Z-strategy-claude.md): when the regex is named upstream by the proposal author, the deterministic rule lands directly via Pipeline 1 (`**Pattern:**` field, no LLM call), and the lesson documents the pattern post-hoc. The discovery surface — *which* regex catches the failure class — was already settled by [Proposal 279](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/active/279-wwnd-claim-discipline-gate.md) § Scope. The compile pipeline LLM would have re-typed it; that LLM cost is avoidable.

**Source:** [Proposal 279 (WWND Claim-Discipline Gate)](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/active/279-wwnd-claim-discipline-gate.md) § Rule 1. Cross-stream rule-authoring approach per [strategy-Claude handoff T2035Z](https://github.com/mmnto-ai/totem-substrate/blob/main/.handoff/totem-claude/processed/2026-05-16T2035Z-strategy-claude.md) § Decision A — hybrid (A3) with discovery-vs-retyping criterion.
