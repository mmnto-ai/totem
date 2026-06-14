# Spec — fail-loud (code-blind) grounding guard for `spec` / `review`

> mmnto-ai/totem#2106 (Phase-1 slice of the strategy#474 grounded spec/review redesign). Operator-greenlit pull-forward; strategy-claude design-approved 2026-06-13.

## Problem

`totem spec` and `totem review` synthesize confident architecture claims even when retrieval returns **zero code** for the touched paths. With no code grounding, the model has nothing to verify file/type/system specifics against, so it can confabulate — the lc#463 class, where the tool invented a whole architecture (`ResistanceTable` ECS component, a `src/simulation/` layout, etc.) that did not exist. The retrieval count is already surfaced (`[Spec] Found: N specs, N sessions, 0 code, N lessons`), so the signal exists; nothing consumed it.

## Interim posture (strategy#474 ruling)

**Not disable — degrade + warn.** On 0 code: surface a deterministic advisory banner and fold a suppression directive into the prompt so the model degrades to what the retrieved specs/sessions/lessons support. The full pluggable-backend redesign and hard structural post-checks (#2103) come later; this is the safety floor under them.

> **Provenance note (live exhibit).** The first auto-generated `totem spec` draft of _this very spec_ confabulated an _abort_-via-`EmptyGroundingError` design and cited a `review.ts` that does not exist — exactly the failure this guard addresses. The authoritative design below was verified against the real code (`spec.ts` + `shield.ts`; `totem review` is `shield.ts`).

## Implementation Design

### Scope

When `context.code.length === 0` after `retrieveContext` in `totem spec` and `totem review` (`shield.ts`), emit a deterministic, advisory banner ("no code context — architecture claims unverified") and fold a suppression directive into the orchestrator prompt telling the model not to assert specific files/types/systems/layouts, degrading to the specs/sessions/lessons actually retrieved. It will **NOT** disable/abort the command (strategy#474 interim posture), will **NOT** change the grounding-bundle provenance/hash model (#2101), will **NOT** alter behavior when code IS retrieved, and will **NOT** touch repo indexing / target globs (the consumer's lane).

### Data model deltas

- **No new persistent types, no required fields, no state container.** The trigger is a per-invocation boolean derived from the _existing_ `RetrievedContext.code` array.
- `isCodeBlind(context: { code: readonly unknown[] }): boolean` — pure predicate, `context.code.length === 0`. Home: `packages/cli/src/utils.ts`. Readers: `spec.ts`, `shield.ts`, tests.
- `applyCodeBlindGuard(context, systemPrompt): { codeBlind, systemPrompt, banner? }` — pure, total (never throws); centralizes banner + directive so both commands share one seam. Returns the directive-augmented system prompt when blind, the input unchanged otherwise.
- `CODE_BLIND_BANNER` + `CODE_BLIND_PROMPT_DIRECTIVE` — named constants (no magic strings). Banner is advisory-neutral.
- Invariant: the guard fires **iff `code.length === 0`**, independent of specs/sessions/lessons counts.

### State lifecycle

Per-invocation. Created after `retrieveContext`; consumed synchronously (banner → user surface, directive → `assemblePrompt` input); discarded at end of call. No persistence, no cross-request/session state, no lifecycle-boundary crossing.

### Failure modes

| Failure                                                   | Category | Agent-facing surface                                                  | Recovery                                                    |
| --------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0 code retrieved (target case)                            | runtime  | **loud warning** (deterministic banner) + degraded, caveated output   | `totem sync` / index code / add targets                     |
| LLM ignores the suppression directive, still asserts code | runtime  | best-effort (prompt-level mitigation, not a guarantee)                | banner is the Tenet-4 guarantee; hard post-checks are #2103 |
| `retrieveContext` itself throws                           | runtime  | existing hard error (unchanged — guard sits strictly after a success) | unchanged                                                   |

No row is silent degradation: the 0-code path is loud (code-emitted banner), satisfying Tenet 4 even if the LLM disregards the soft directive.

### Invariants locked by tests (`utils.test.ts`)

- `isCodeBlind` is true iff `code.length === 0` (keyed strictly on code).
- On 0 code: `applyCodeBlindGuard` fires, returns the banner, and the returned system prompt starts with the original and contains the directive.
- With code: does not fire, no banner, system prompt returned unchanged (directive absent).
- Never throws / never disables — always returns a usable system prompt (the anti-abort guarantee that pins the strategy#474 posture).
- Banner is advisory-neutral — contains no `error`/`fail`/`abort` wording (a legitimate 0-code `spec` must not read as a failure).

### Open questions — RESOLVED (strategy-claude concurred 2026-06-13)

- **Q1 — hook:** raw `context.code.length === 0` for the pull-forward; bundle-provenance unification deferred to the full #474 redesign. ✅
- **Q2 — symmetry:** fire for `spec` and `review` identically (one helper, two sites); banner wording kept advisory-neutral. ✅
- **Q3 — enforcement:** soft prompt-directive + deterministic banner as the guarantee; hard structural post-checks are #2103's slice. ✅
