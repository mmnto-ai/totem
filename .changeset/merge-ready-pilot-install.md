---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

The two minors deferred from the `totem resolve-threads` round (mmnto-ai/totem#2841, leg F3 and F5), folded on the PR that installs the merge-ready gate at the pilot tier on this repository. (The packages share one fixed changeset group, so every `@mmnto/*` package takes the same minor bump.)

**`@mmnto/totem` gains `hasBotAppLoginSuffix(login)`** — the GitHub App login suffix test (`name[bot]`, the REST spelling of every App's login) beside the two list tests the identity module already carries, with its own tests in the package that exports it. `resolve-threads` used to spell that suffix as a regex of its own; the rule now lives in the one identity module, the verb injects it as a third predicate (`hasAppSuffix`) beside the exact list and the loose pattern, and `bot-identity-parity.test.ts` now scans FOUR consumers (triage's parser, review-catch, merge-ready and resolve-threads) with a new arm for the escaped suffix spelling a regex or RegExp source carries (`\[bot\]`) — the spelling the sensor's literal scan never saw, which is how the verb's copy lived unscanned; two mutant rows pin the arm. The module's, the barrel's and the sensor's "both consumers" prose now counts four.

**The review-reply skill's step 4 gains one clause** (all distributed surfaces re-rendered): a clean `resolve-threads --apply` run over every evidenced thread clears the unresolved-bot-threads predicate (a run narrowed with `--ids` clears only the rows it named) and is NOT an allow verdict — the gate re-reads the PR on `gh pr merge`, and a bot HIGH inline whose commit cannot be read makes the evaluation UNEVALUABLE once every earlier predicate passes (pilot warns, strict denies). The step now ends by reading the floor itself, `totem gate check --event merge-ready`, and reporting that verdict beside the resolve rows before the merge word is asked for.
