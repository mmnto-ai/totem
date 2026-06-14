# Spec — code-blind grounding guard (spec/review)

> mmnto-ai/totem#2106 (Phase-1 slice of the strategy#474 grounded spec/review redesign). Operator-greenlit pull-forward; strategy-claude design-approved 2026-06-13.

## Problem

`totem spec` and `totem review` synthesize confident architecture claims even when retrieval returns **zero code** for the touched paths. With no code grounding, the model has nothing to verify file/type/system specifics against, so it can confabulate — the lc#463 class, where the tool invented an architecture (`ResistanceTable` ECS component, a `src/simulation/` layout) that did not exist. The retrieval count is already surfaced (`[Spec] Found: N specs, N sessions, 0 code, N lessons`), so the signal exists; nothing consumed it.

## Interim posture (strategy#474 ruling)

**Not disable — degrade and warn.** On 0 code: surface a deterministic advisory banner and fold a suppression directive into the prompt so the model degrades to what the retrieved specs/sessions/lessons support. The full pluggable-backend redesign and the hard structural post-checks (#2103) come later; this is the safety floor under them.

> **Provenance note (live exhibit).** The first auto-generated `totem spec` draft of _this very spec_ confabulated an _abort_-via-`EmptyGroundingError` design and cited a `review.ts` that does not exist — exactly the failure this guard addresses. The authoritative design below was verified against the real code (`spec.ts` + `shield.ts`; `totem review` is `shield.ts`).

## Implementation Design

### Scope

When `context.code.length === 0` after `retrieveContext` in `totem spec` and `totem review` (`shield.ts`), emit a deterministic, advisory banner ("no code context — architecture claims unverified") and fold a suppression directive into the orchestrator prompt telling the model not to assert specific files/types/systems/layouts, degrading to the specs/sessions/lessons actually retrieved. Out of scope: disabling/aborting the command (strategy#474 interim posture); changing the grounding-bundle provenance/hash model (#2101); altering behavior when code IS retrieved; and repo indexing / target globs (the consumer's lane).

### Data model deltas

- No new persistent types, required fields, or state container. The trigger is a per-invocation boolean derived from the _existing_ `RetrievedContext.code` array.
- `isCodeBlind(context: { code: readonly unknown[] }): boolean` — pure predicate, `context.code.length === 0`. Home: `packages/cli/src/utils.ts`. Readers: `spec.ts`, `shield.ts`, tests.
- `applyCodeBlindGuard(context, systemPrompt): { codeBlind, systemPrompt, banner? }` — pure and total (does not throw); centralizes banner + directive so both commands share one seam. Returns the directive-augmented system prompt when blind, the input unchanged otherwise.
- `CODE_BLIND_BANNER` + `CODE_BLIND_PROMPT_DIRECTIVE` — named constants (no magic strings). Banner is advisory-neutral.
- Invariant: the guard fires iff `code.length === 0`, independent of specs/sessions/lessons counts.

### State lifecycle

Per-invocation. Created after `retrieveContext`; consumed synchronously (banner to the user surface, directive into the `assemblePrompt` input); discarded at end of call. No persistence, no cross-request/session state, no lifecycle-boundary crossing.

### Failure modes

| Failure                                                   | Category | Agent-facing surface                                                  | Recovery                                                     |
| --------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 code retrieved (target case)                            | runtime  | loud warning (deterministic banner) + degraded, caveated output       | `totem sync` / index code / add targets                      |
| LLM ignores the suppression directive, still asserts code | runtime  | best-effort (prompt-level mitigation, not enforcement)                | the banner is the Tenet-4 signal; hard post-checks are #2103 |
| `retrieveContext` itself throws                           | runtime  | existing hard error (unchanged — guard sits strictly after a success) | unchanged                                                    |

No row is silent degradation: the 0-code path is loud (code-emitted banner), holding to Tenet 4 even when the LLM disregards the soft directive.

### Invariants locked by tests

In `utils.test.ts`:

- `isCodeBlind` is true exactly when `code.length === 0` (keyed strictly on code).
- On 0 code: `applyCodeBlindGuard` fires, returns the banner, and returns `${systemPrompt}\n\n${directive}` (original first, directive appended).
- With code: does not fire, no banner, system prompt returned unchanged.
- Does not throw or disable on 0 code; returns a usable prompt (the anti-abort property that pins the strategy#474 posture).
- Banner is advisory-neutral — matches no `error`/`fail`/`abort` wording (a legitimate 0-code `spec` is not a failure).

### Open questions — resolved

strategy-claude concurred 2026-06-13:

- **Q1 — hook:** raw `context.code.length === 0` for the pull-forward; bundle-provenance unification deferred to the full #474 redesign.
- **Q2 — symmetry:** fire for `spec` and `review` identically (one helper, two sites); banner wording kept advisory-neutral.
- **Q3 — enforcement:** soft prompt-directive plus the deterministic banner as the signal; hard structural post-checks are #2103's slice.
