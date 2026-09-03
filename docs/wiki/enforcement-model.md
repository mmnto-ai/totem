# Enforcement Model

Your AI doesn't have to be obedient. It just has to push code.

## A Platform of Primitives

Totem provides the **primitives**: the knowledge index, the compiler, the compiled AST rules, the lint results, and the review verdicts. These are the building blocks that measure and report the state of your codebase.

Totem does **not** force a specific workflow. It doesn't dictate when to block, inject, or enforce. You decide how to wire these primitives into your own Git hooks, CI config, or IDE plugins. Totem ships reference wiring, not a mandatory policy.

| Layer             | What Totem Provides                     | Where You Wire It            |
| ----------------- | --------------------------------------- | ---------------------------- |
| **Deterministic** | `totem lint` (compiled rules, zero LLM) | Git pre-push hook            |
| **Knowledge**     | `search_knowledge` (vector index)       | SessionStart hook, MCP tools |
| **Review**        | `totem review` (LLM-powered analysis)   | PreToolUse hook (optional)   |

### The Git Hook (Product, All Users)

The pre-push hook runs two stateless checks:

1. `totem verify-manifest` ensures compiled rules match lesson source.
2. `totem lint` runs deterministic rule enforcement with zero LLM.

No flag files. No LLM calls. No workflow opinions. Works air-gapped.

### The Strict Pre-Commit Spec-Evidence Rule (Opt-In Tier)

Under the strict tier (`hooks.tier: 'strict'`, `TOTEM_HOOK_TIER=strict`, or a detected agent), the managed pre-commit hook requires spec EVIDENCE before a commit. Evidence is the grounded run artifact `totem spec` writes under `<totemDir>/artifacts/runs/` — read JSON-aware, never by substring — whose top-level `admission.runMetadata.caller` is `"spec"`.

Since mmnto-ai/totem#2700 the rule has a second half: the newest such artifact must be **anchored**, and its **subject** must carry a shape.

**Anchored** means `grounding.anchor.kind` is `issue` or `record`. A `free-text` or `mixed` anchor is BLOCKED by name — its free-text half is the surface the rule exists for. An artifact with no `grounding.anchor` at all predates the rule and is BLOCKED as such.

**The subject** depends on the anchor, and is checked against one of two shapes:

| Anchor                            | Subject                               | Shape                                                                                             |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `issue`, built-in prompt          | the draft (`output.content`)          | **TEMPLATE** — every heading the command promises, each followed by a non-blank, non-heading line |
| `issue`, overridden system prompt | the draft (`output.content`)          | **DOCUMENT** — at least one markdown heading followed by a non-blank, non-heading line            |
| `record`                          | the RECORD's bytes, re-read from disk | **DOCUMENT**                                                                                      |

On a `record` anchor the reader opens the file at `grounding.anchor.ref` relative to the worktree top (where git runs hooks) and judges THOSE bytes — the draft is discarded on that path, so checking it would check nothing. A missing or unreadable record BLOCKS, naming the path. Two things BLOCK before the reader ever reads those bytes. A ref that leaves the worktree is refused: absolute in either path flavor, or landing outside the top once the path is normalized, or — the case normalization cannot see — pointing at a file outside the tree only after its links are resolved, which the reader reports with both spellings. And a binding without bytes is not a binding: an anchor whose `sha256` is absent BLOCKS as carrying none, and one whose `sha256` is present but is not a 64-hex digest BLOCKS as malformed, each with its own reason, because the repair differs. The record's sha256 is compared against the bound digest and REPORTED in the evidence line (`record sha256 matches` / `record revised since binding (bound <8>, now <8>)`) as a **sensor**, never a gate: blocking on revision would price every fold of a design record at one LLM call.

A pass prints the evidence line with the artifact's own age, its anchor and its shape:

```text
[Totem] spec evidence: .totem/artifacts/runs/9f2c….json (2026-09-02T04:00:00.000Z, 0 days old) · anchor record .totem/specs/2700.md · shape DOCUMENT · record sha256 matches
```

The reader's exit vocabulary is `0` evidence, `2` no spec artifact in this checkout, `3` the newest spec artifact is not evidence (its reason is printed), and anything else a reader failure — each reported distinctly, all fail-closed. The check claims only that a grounded run preceded the commit and that its subject is a document with a body. It never claims the document is any good: a draft that mimics the skeleton with filler bodies is outside any content check's reach.

The BLOCKED line names both cures — `totem spec <issue>` and `totem spec --from <record>` — and adds `--fresh`: a response served from the response cache writes no run artifact, so a re-run that hits the cache leaves the gate exactly where it was.

Two disclosures:

- **Migration.** Every spec artifact written before this rule reads as not-evidence, because none carries `grounding.anchor`. On a strict-tier install this affects human commits too, not only agent commits. One run of `totem spec <issue>` or `totem spec --from <record>` restores evidence.
- **Reach.** Until agent detection for Claude Code is restored (mmnto-ai/totem#2706), the strict arm fires only where `TOTEM_HOOK_TIER=strict` is set and on Cursor seats. Totem's own repo ships `tools/pre-commit` at tier `standard`.

### The Strict Pre-Push Review-Leg Floor (Opt-In Tier)

Under the same strict tier, the managed pre-push hook requires a **falsification-leg deposit** for a push whose diff is judgment-dense. The doctrine the floor mechanizes is `doctrine/model-tiering.md` § Review legs: a self-authored judgment-dense diff owes one falsification leg before it is presented, and a fold that rewires semantics re-arms it.

A **deposit** is what a leg leaves behind after it READ a diff — the head it read, when it read it, its typed findings, which of them the seat folded, and a one-line verdict — stored at `<totemDir>/artifacts/legs/<diffSha>.json` and written by `totem legs deposit`. It is evidence of a READ, not a grade: the gate never looks at a finding's severity or disposition. Whether the findings were addressed is the round's question, and the counts ride the covariate line for the round to rule on.

**The ancestor-or-equal rule.** A deposit read at commit X answers for X and for every descendant of X. The exact read outranks the nearest ancestor, the nearest ancestor outranks a farther one, and equal reach resolves to the latest read. The pass line carries `+N commits since the leg read`, so a deposit that is valid but old is VISIBLE rather than silently sufficient — a sensor, not a gate. Re-arming after a semantics-moving fold is doctrine's rule, owed by the seat, not enforced here.

**Not owed.** The push is judged against the branch-vs-base diff — the same scope the push gate lints. A changed path matching `hooks.legsOwed.globs` makes the push legs-owed; nothing matching makes it not owed, and the line says how many globs it was judged against. A not-owed push never consults the deposit store at all. Judgment-density is derived from file CLASS (doctrine surfaces, public-copy surfaces, a contract class) because a path glob is an honest mechanism for that where a line-count floor is only a proxy. The default floor is `doctrine/**`, `design-tenets.md`, `adr/**`, `proposals/**`, `README.md`, `docs/wiki/**` and `.changeset/**` — a changeset IS the release's compatibility contract, so a releasable slice is owed a leg by derivation rather than by anyone remembering to declare it.

**The verb probe fails closed.** The hook probes `totem legs --help` for the `gate` verb before invoking it. Where the resolved CLI does not carry it, the strict tier BLOCKS with the one-command cure (`npm i -g @mmnto/cli@latest`) and the advisory tiers print a compat line and pass. This is deliberately the opposite of the `--gate` and `--scope-to-diff` probes beside it: those flags degrade to a bare form that still runs, and an absent verb has no degraded form at all.

The gate's exit vocabulary is `0` not owed or a deposit answers, `3` owed with no fresh deposit, and `2` could not derive. The strict arm blocks on `3` and on `2` with DISTINCT lines — "run the leg" and "fix the checkout" are different repairs — and every other tier passes both, printing the same text. The tier changes only the exit code.

Two disclosures:

- **Reach.** Exactly as with the pre-commit spec rule: until agent detection for Claude Code is restored (mmnto-ai/totem#2706), the strict arm fires only where `TOTEM_HOOK_TIER=strict` is set and on Cursor seats. Totem's own repo ships `tools/pre-push` at tier `standard`, so this repo's own pushes print the advisory line and pass.
- **Scope.** The gate judges `HEAD`'s branch diff, not the ref list git hands the hook on stdin. Pushing a branch other than the checked-out one judges the wrong head — the pass line discloses which head it judged, so the mismatch is legible rather than silent.

### The PreToolUse Hook (Reference Implementation, Opt-In)

For teams using AI agents, Totem provides a reference `PreToolUse` hook that uses **content hashing** to verify the agent reviewed the code before pushing. This is actor-aware. It only fires for the AI agent, never for the human developer.

This is a reference implementation. You can use it as-is, or use Totem's primitives to build your own.

## Handling False Positives

Sometimes, breaking an architectural rule is the correct technical decision. Use the Semantic Overlay:

```typescript
// totem-context: We are interacting with a legacy 3rd-party API that requires this mutable state.
globalThis.__legacyAPIState = {};
```

Every override is recorded in the local **Trap Ledger**. If a rule is overridden frequently, `totem doctor --pr` derives an error → warning downgrade from that telemetry and opens a PR proposing it. Your justifications become the evidence for tuning the rule — and a human reviews every change.

## Unified Findings Model

Both `totem lint` and `totem review` produce findings in a common `TotemFinding` schema (ADR-071):

- `totem lint --format json` includes a `findings[]` array with normalized fields
- `totem-context:` is the single override directive for both lint and review
- PR comments and SARIF output consume the unified model

## Works Without AI

Totem's core enforcement is **100% deterministic**. It runs offline with no LLM calls and no API keys.

| Feature                          | Requires AI? |
| -------------------------------- | :----------: |
| `totem lint` (compiled rules)    |      No      |
| `totem init` (baseline rules)    |      No      |
| Pre-push git hook                |      No      |
| AST classification (Tree-sitter) |      No      |
| `totem sync` (vector index)      |   Embedder   |
| `totem lesson compile`           |     LLM      |
| `totem review` (AI review)       |     LLM      |
| `totem spec` (planning)          |     LLM      |

The AI helps you **write** rules. The rules enforce themselves.
