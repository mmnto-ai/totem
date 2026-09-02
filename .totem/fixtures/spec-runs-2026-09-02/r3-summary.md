# R3 probe — structured output vs the skeleton check (mmnto-ai/totem-strategy#1193)

Observation only; no refute-condition (the charter classes R3 as a probe).

## Method

- Subject: artifact `e5a15c9c…` — the newest issue-anchored run in the store (2026-09-02T01:04Z, anchored on mmnto-ai/totem#2700, backend `gemini-3.5-flash`, the prompt as recorded in `inputBundle.maskedPrompt`).
- Regeneration: the recorded prompt bytes sent verbatim as `contents` through the CLI's own SDK (`@google/genai` 2.6.0), `maxOutputTokens` 16384, no temperature — the production orchestrator's call shape (`packages/cli/src/orchestrators/gemini-orchestrator.ts` at 8d5e2691).
- Arms (2 runs each): `unconstrained` (production shape) · `responseSchema` (OBJECT of 9 STRING properties, all required, `propertyOrdering`) · `responseJsonSchema-minLength1` (JSON Schema, every property `minLength: 1`, `additionalProperties: false`). Constrained outputs were rendered to markdown as `### <promised heading>` + the value, in the promised order.
- Check: the strict pre-commit reader's TEMPLATE predicate transcribed from `install-hooks.ts` (heading line `trimEnd()` equals the required string; a body = at least one non-blank line before the next heading of ANY level), run twice — against the shipped `SPEC_REQUIRED_SECTIONS` (2 headings: Problem Statement, Implementation Tasks) and against all 9 promised headings from the system prompt.
- Script: `scripts/r3-structured-probe.mjs`; record: `r3-structured-probe.json`; renderings: `r3-<arm>-run<n>.md`.

## Results (n = 7 drafts: the original + 6 regenerations)

| draft | shipped 2-heading gate | all-9 exact-match | output tokens | ms |
|---|---|---|---|---|
| original artifact (2026-09-02) | PASS | FAIL: empty `Technical Approach & Contracts`; missing `Execution Flow (structural constraint)`; missing `Verification (MANDATORY — do not skip)` | (recorded) | — |
| unconstrained run 1 | PASS | FAIL: empty `Technical Approach & Contracts`; missing `Verification (…)` | 2403 | 36448 |
| unconstrained run 2 | PASS | FAIL: empty `Technical Approach & Contracts`; missing `Execution Flow (…)`; missing `Verification (…)` | 2083 | 18135 |
| responseSchema run 1 | PASS | PASS (9/9 present, min body 306 chars) | 1773 | 24644 |
| responseSchema run 2 | PASS | PASS (min body 306) | 1697 | 13871 |
| responseJsonSchema-minLength1 run 1 | PASS | PASS (min body 317) | 2009 | 26302 |
| responseJsonSchema-minLength1 run 2 | PASS | PASS (min body 312) | 1742 | 34142 |

Input tokens were 5298 on every call (same prompt bytes).

## What the failures are

- "empty `Technical Approach & Contracts`" in all three unconstrained drafts is the READER's semantics, not a blank section: the model opens that section with a `####` sub-heading on the very next line, and the reader ends a body at any heading level, so the section counts as empty. The section itself is the longest in the draft.
- "missing `Verification (MANDATORY — do not skip)`" / "missing `Execution Flow (structural constraint)`" are heading-TEXT variance: the drafts carry `### Verification` and `### Execution Flow` — the parenthetical is dropped — so an exact-match reader over the 9 promised strings would block a draft that has the section.
- The shipped gate requires only 2 of the 9 headings, so none of this drift reaches it: 7/7 drafts pass it.

## Observation on redundancy

- Under a schema the "missing heading" clause cannot fire for the constrained arm: the headings are emitted by the RENDERER from the canonical constant, never by the model. 4/4 constrained runs carried all 9 sections with non-empty bodies (306–2791 chars), so the "empty heading" clause did not fire either.
- `minLength: 1` was accepted by the Gemini API via `responseJsonSchema` (no 400); with it, an empty string cannot pass the decoder if the constraint is enforced — the vendor page says to validate values regardless, and 4/4 constrained runs had no empty values with or without it, so this probe cannot separate "enforced" from "did not happen". Anthropic's structured-output docs (fetched 2026-09-02) list `minLength` as UNSUPPORTED (400), so pushing emptiness into the decoder is not portable across the CLI's backends.
- The skeleton check stays necessary for every draft that is NOT rendered from a schema: the override-prompt and record arms, and every backend/model pair not run through a schema. What a schema removes is heading-text variance and heading absence, not semantic emptiness (a value of "None found in provided context." satisfies both the schema and the reader).

## Limits

One prompt, one model, one backend, n = 2 per arm; the reader predicate is a transcription, not the hook binary; no human read of the drafts' content; output-token and latency differences are within-run noise at this n (unconstrained 2083–2403 vs constrained 1697–2009 output tokens).
