---
'@mmnto/totem': minor
'@mmnto/cli': patch
---

The two minors deferred from the `totem resolve-threads` round (mmnto-ai/totem#2841, leg F3 and F5), folded on the PR that installs the merge-ready gate at the pilot tier on this repository.

**`@mmnto/totem` gains `hasBotAppLoginSuffix(login)`** — the GitHub App login suffix test (`name[bot]`, the REST spelling of every App's login) beside the two list tests the identity module already carries. `resolve-threads` used to spell that suffix as a regex of its own, which kept it out of the bot-identity parity sensor (a consumer that spells `[bot]` in code fails the scan); the rule now lives in the one identity module, the verb injects it as a third predicate (`hasAppSuffix`) beside the exact list and the loose pattern, and `bot-identity-parity.test.ts` scans `resolve-threads.ts` as the third consumer — the sensor's hardcoded two-entry list and its "both consumers" prose were numerically stale since the verb shipped.

**The review-reply skill's step 4 gains one clause** (all distributed surfaces re-rendered): a clean `resolve-threads --apply` run clears the unresolved-bot-threads predicate and is NOT an allow verdict — the gate re-reads the PR on `gh pr merge`, and a bot HIGH inline whose commit cannot be read makes the evaluation UNEVALUABLE once every earlier predicate passes (pilot warns, strict denies). The step now ends by reading the floor itself, `totem gate check --event merge-ready`, and reporting that verdict beside the resolve rows before the merge word is asked for.
