---
name: preflight
description: Pre-work ritual — spec, search, and (when needed) a 1-page implementation design doc before touching code
---

Before starting work on issue $ARGUMENTS, execute these phases in order.
Do NOT write code until all gates are cleared.

## Phase 1 — Mechanical context gathering

1. Run `pnpm exec totem spec $ARGUMENTS` to generate the implementation spec
   from the issue body. Output lands in `.totem/specs/<issue>.md`.
2. Call `mcp__totem-dev__search_knowledge` with a query describing the
   changes you're about to make. If the issue touches a specific system
   (hooks, orchestrator, compiler, extract pipeline, store layer, MCP
   server), ALSO query `mcp__totem-strategy__search_knowledge` for
   relevant ADRs and proposals.
3. Summarize in 3-5 bullets: what the spec says, which lessons are
   relevant, and any constraints or traps surfaced by the knowledge queries.

If `totem spec` fails, report the error and stop — do not proceed to Phase 2.

## Phase 2 — Scope triage (decide if Phase 3 is needed)

**Skip Phase 3 if this is a tactical change.** Tactical means ALL of:

- Pure bug fix, wording change, or existing-test tightening
- No new types or required fields on existing types
- No new state containers (maps, sets, module-level variables, singletons)
- No new failure modes or classes of error
- No new cross-cutting concerns (logging, telemetry, caching, auth)
- Touches ≤3 files in a single architectural layer

**Draft the design doc (Phase 3) if ANY of:**

- Adds a new type, interface, or required field
- Adds a new state container or changes state ownership/lifecycle
- Introduces a new failure mode or changes existing error surface
  (hard error → warning, sync → async, blocking → non-blocking)
- Crosses architectural boundaries (core → cli, cli → mcp, etc.)
- Touches >3 files OR introduces a new cross-cutting concern

When in doubt, draft the doc. The cost of 10 minutes of design writing
is always lower than the cost of a multi-round bot review cycle.

State your triage decision explicitly: "Tactical — skipping Phase 3"
or "Architectural — drafting design doc."

**Tactical path — no approval gate.** If tactical, proceed directly to
implementation after Phase 1 completes. The Phase 4 approval gate below
only applies when Phase 3 was drafted, because the gate exists to catch
architectural mistakes before code is written — there's nothing
architectural to review for a tactical change. The user's normal
PR-approval and merge-approval rules still apply to the finished code.

**Architectural path — continue to Phase 3.** Draft the design doc, then
stop at the Phase 4 approval gate before writing any code.

## Phase 3 — Implementation design doc (REQUIRED for architectural changes before code; skipped for tactical)

Append a new `## Implementation Design` section to the spec file at
`.totem/specs/<issue>.md`. The section MUST cover all six subsections
below. Keep it tight — the whole design section should fit in ~1 page.

### Scope (2 sentences)

What this implementation will do, and what it explicitly will NOT do.
Negative scope is load-bearing — it prevents scope creep during review.

### Data model deltas

List every new type, new field on an existing type, and every new
state container (map/set/module variable). For each:

- What it holds
- Who writes it
- Who reads it
- What invariants hold (required vs optional, bounded vs unbounded,
  who guarantees the invariant)

Explicitly call out any "reserved keys" or sentinel values — those
are collision hazards. Prefer separate fields over reserved keys.

### State lifecycle

For each new piece of state, identify:

- **Scope:** per-request / per-session / server-lifetime / persistent
- **Lifetime:** when created, when mutated, when cleared, when destroyed
- **Ownership:** which function/module owns mutation

Call out any state that crosses lifecycle boundaries (e.g., a
session-level flag consumed by a per-request operation). Those are
the most common source of "one-shot flag consumed before its work
succeeded" bugs.

### Failure modes

A table. For each failure point:

| Failure       | Category                               | Agent-facing surface                                | Recovery                     |
| ------------- | -------------------------------------- | --------------------------------------------------- | ---------------------------- |
| <description> | init / runtime / transient / permanent | hard error / isError / warning / silent degradation | how state returns to healthy |

Be exhaustive. Every place the code can throw, return null, return an
empty result, or silently succeed with degraded output is a row. If a
row has "silent degradation" in the surface column, justify it against
Tenet 4 (Fail Loud, Never Drift) or change the design.

### Invariants to lock in via tests

NOT test names. The guarantees you're testing. Example:

- "linked store named 'primary' must not collide with primary failure slot"
- "init-time warnings survive any reconnect cycle untouched"
- "one-shot first-query flags are consumed only after successful work"

These become the test assertions. If you can't articulate the invariant
in English, you probably don't understand what you're testing yet.

### Open questions

Anything that needs user judgment before coding starts. Format:

- **Question:** <one sentence>
- **Options:** <bulleted list of viable answers with tradeoffs>
- **Recommendation:** <your best guess>

## Phase 4 — Approval gate (architectural path only)

This phase applies ONLY when Phase 3 was drafted. For tactical changes
that skipped Phase 3, there is no gate — see Phase 2.

After drafting Phase 3, STOP and output:

> Design doc drafted at `.totem/specs/<issue>.md`. Please review the
> Implementation Design section and approve before I start coding.
> Open questions: <count>.

Do NOT write code until the user explicitly approves the design. If
the user wants changes, update the doc and re-stop for approval.

Controller-not-implementer (ADR-063): protect your own decision-making
by surfacing architectural questions BEFORE they become bot review
findings. A 10-minute design review with the user is strictly cheaper
than a 7-round bot review cycle on the PR.
