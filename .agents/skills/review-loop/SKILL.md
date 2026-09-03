---
name: review-loop
description: Drive the local pre-push review loop to settle — absorb findings locally before any external bot pass
---

<!-- totem:skill-start -->

Drive the LOCAL pre-push review loop to convergence: run the review, absorb its findings, re-run, and repeat until the CLI reports the round **settled** — before any external bot pass. The loop state (round chaining, the settle computation, lane coverage) is entirely CLI-owned; this skill is a thin driver. Do not reimplement settle logic or count rounds yourself — read what the CLI reports.

This is NOT the external-bot triage skill. `/review-reply` handles bot comments on a PR; do NOT invoke external review bots (CodeRabbit, Gemini Code Assist, Greptile) from here. This loop settles local findings first.

## The loop

1. **Run the review.** `totem review` runs the repo's configured lanes. Do NOT pass `--model` unless the user explicitly asked for a one-lane run — an explicit `--model` selects a single-lane invocation and never joins the configured fan. If `review.lanes` is not configured, `totem review` runs the legacy single-lane path and emits NO verdict artifact or `local-lane:` line — this loop's contract requires the verdict artifact, so configure `review.lanes` first (a single entry suffices).

2. **Read the reported outcome.** The CLI reports the findings, the lane coverage (completed / attempted), the settled state, and the round number. Take them as reported — do not derive `settled` yourself.

3. **If not settled: apply fixes, then re-run.** Fix the actionable findings — **WARN and CRITICAL are actionable; INFO is cosmetic** and can be skipped. Then re-run `totem review`; the CLI chains the next round automatically from the prior verdict. An explicit `--continues <verdict-hash>` override exists for the rare case where the CLI reports a lineage fork you know is wrong (e.g. a rebase it mis-linked) — otherwise let it chain on its own.

4. **Repeat until settled — or stop honestly.** Loop until the CLI reports the round **settled**. Stop and report if the CLI's max-rounds advisory fires, or a finding is disputed. Never loop forever, and never silently override a disputed finding — a dispute goes to the human.

## Honesty rules

- **Never use `--override` without an explicit human go.** It is trap-ledgered.
- **A degraded round is never settled.** If completed < attempted (a lane failed), the round did not settle — say so; a dropped lane is not a pass.
- **Report the outcome faithfully** — the findings, the counts, and the settled state exactly as the CLI reports them.

## At settle: hold the covariate line locally (never post a PR comment)

`review-loop` NEVER creates or posts a PR comment. The local loop runs BEFORE any external bot pass, and the round-disposition comment is ONE consolidated comment owned by the operator-invoked `/review-reply` workflow. At settle the CLI already prints the covariate line — hold and report it locally, in exactly this format:

<!-- covariate line format v1.2 — do not alter without a spec amendment (v1.1 added the additive admission form; v1.2 appends the leg field to both shapes and adds the `local-lane: none` head for a deposit-only lineage: mmnto-ai/totem#2698 design § Implementation Design, the .totem/specs/2473.md v1.2 clause) -->

```text
local-lane: <verdictHash8> round=<n> settled=<true|false> lanes=<completed>/<attempted> leg: <sha8> blocking=<n> material=<n> folded=<n>
local-lane: not-applicable (<reason>) recorded=<recordHash8> at=<createdAt> leg: <sha8> blocking=<n> material=<n> folded=<n>
local-lane: none leg: <sha8> blocking=<n> material=<n> folded=<n>
```

`<verdictHash8>` is the first 8 hex characters of the verdict artifact hash the CLI reports. The second shape is the ADMISSION form (format v1.1, mmnto-ai/totem#2473): rendered when the current diff resolves to a deterministic not-applicable admission — `<recordHash8>` addresses the admission record in `.totem/artifacts/admissions/`, and it is discriminated on the literal second token `not-applicable`. `leg: none` replaces the field when no falsification-leg deposit resolves for HEAD; consumers discriminate on the second token (`<hash8>` · `not-applicable` · `none`); `<sha8>` is the first 8 hex of the deposit's `diffSha`; a folded finding counts in both its severity bucket and `folded`. This line is a versioned contract consumed by a measurement pilot — do not change any shape without a spec amendment. The CLI renders every shape from its canonical artifacts via single core-owned renderers, so the line is re-derivable and never hand-authored — on demand, the read-only `totem review --covariate` (zero-LLM) resolves the current state and prints the verdict's line (admitted diff) or the admission record's line (deterministic skip). Inclusion of any pending `local-lane:` line in the single consolidated round-disposition comment belongs to `/review-reply` (which obtains it by running `totem review --covariate`), not to this loop — never post it to GitHub yourself.

<!-- totem:skill-end -->
