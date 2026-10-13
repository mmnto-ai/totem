# Maturity

What's shipped, what's partial, and what's still a goal — derived from this repository, not asserted.

Every row in the table below lives in [`docs/data/maturity.json`](../data/maturity.json) and must carry at least one anchor — a file, a registered CLI command, or a committed data file — that is mechanically re-verified whenever this page regenerates. A row whose anchor stops resolving fails the docs build instead of quietly going stale, and CI regenerates the page on every pull request and fails on drift. The prose is handcrafted; the facts are injected.

<!-- docs MATURITY_TABLE -->

| Mechanism                                                                   | Status      | Notes                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic rule enforcement (`totem lint`)                               | **Shipped** | Compiled rules run offline against your diff — zero LLM calls in the gate. Wall time is receipted below, not asserted.                                                                                                                                                                                |
| Git-hook enforcement                                                        | **Shipped** | pre-commit / pre-push / post-merge / post-checkout. Installed explicitly — never silently.                                                                                                                                                                                                            |
| Lesson banking from real incidents                                          | **Shipped** | Plain markdown files are the canonical source; the search index is a derived, rebuildable cache.                                                                                                                                                                                                      |
| Semantic knowledge index + MCP retrieval                                    | **Shipped** | Requires one IDE-level MCP registration step (see the MCP setup guide). The vector store is derived — deleting it loses nothing canonical.                                                                                                                                                            |
| Lesson → rule compilation (legacy path)                                     | **Partial** | The legacy compile path stays parked under a standing freeze since 2026-05-17 (receipt below). Since the gate (5) lift the serving file is regenerated from rule records by `totem rule serve`; the active rules run on every diff, and the blocking set (`totem rule list --blocking`) fails a push. |
| AI review lanes with lesson grounding (`totem review`)                      | **Shipped** | LLM-assisted and advisory — verdicts record which lessons were consulted. The deterministic gates above are the floor; this never replaces them.                                                                                                                                                      |
| Rule-tuning loop (`totem doctor --pr`)                                      | **Shipped** | Proposes rule fixes as a pull request; a human merges every change. Nothing lands autonomously.                                                                                                                                                                                                       |
| Claim-discipline gates on our own docs                                      | **Shipped** | README badges and this page are derived from committed data and drift-gated in CI. A claim whose anchor stops resolving fails the build.                                                                                                                                                              |
| Reproducible proof kit (`examples/proof-kit`)                               | **Shipped** | A committed exhibit of the loop: one real mistake, the rule compiled from its lesson, and CI re-proving on every pull request that the mistake stays blocked — zero LLM calls. Timing lives in the committed receipt beside the parameters that produced it.                                          |
| Multi-seat coordination substrate                                           | **Shipped** | local-only · multi-seat opt-in. File-anchored mailboxes for repos where several agents share one working tree; the single-seat path never touches it. Bring your own orchestration — this is coordination state, not a runtime.                                                                       |
| Rule derivation from merged-PR history, validated against held-out controls | **Goal:**   | Goal: replace the parked legacy compiler with derivation that passes held-out validation before any public claim rides on it. A prototype exists; its runs to date are under-powered, so this stays a goal row.                                                                                       |

<!-- /docs -->

Statuses mean what they say: **Shipped** is running in this repository today, **Partial** ships with a named limitation, and **Goal:** does not exist yet as a mechanism — we write it down so you don't have to reverse-engineer our ambitions from marketing copy.

## Receipts

Three claims we would rather prove than assert.

### Every rule traces to a banked lesson

<!-- docs RULE_PROVENANCE -->

**513 compiled rules** (engines: 293 ast-grep / 220 regex; compiled between 2026-04-06 and 2026-10-10) stand between a banked mistake and its recurrence, and every one names its source: 485 carry the content hash of the lesson they were compiled from (`lessonHash`), and 28 are lowered from rule records and carry the id minted from the record — the chain from incident to enforcement is mechanical, not editorial. The 485 legacy rules compile from **485 distinct lessons**. **264 are active** in `totem lint` today, 4 of them block a push (hard tier at error severity) and the rest are non-blocking: they print and never fail it; the other 249 are inactive (242 archived, 7 untested against the codebase), and the receipt below counts the active set at its pinned head, not this one. 1120 lessons currently rest as non-compilable rather than being force-fitted into rules.

<!-- /docs -->

### We hold our own line

<!-- docs DAYS_UNDER_FREEZE -->

The legacy lesson→rule compiler has been parked under a standing freeze since **2026-05-17** — **149 days** as of this page's last data refresh (2026-10-13). Rather than keep running a compiler we no longer trust, we parked it and held the rule corpus read-only. Since the gate (5) lift the serving file is regenerated from rule records by `totem rule serve`: the migrated rules on the gate's floor serve by their records, every other legacy rule is carried unchanged or archived on its curation row, and the parked compiler refuses a record-managed file. We hold our own line the way we ask your repo to hold its own.

<!-- /docs -->

### The gate is offline

<!-- docs LINT_RECEIPT -->

A real merged diff of this repository (`c14e90ab..ba8c591d`, 41 files) linted in **3532 ms** with **zero LLM calls** — the run executed with every provider API key stripped from the environment, so there was nothing to silently call. 387 rules evaluated (the active set at the pinned head, not today's corpus); 0 errors, 20 warnings. CI replays the pinned range on every pull request, and the pinned fields — range, file count, rule, error and warning counts, LLM calls, parse mode — must reproduce or the Docs Governance check fails. The environment line is a label, not a gate: win32-x64, node 24.16.0, CLI 2.11.1, generated 2026-09-25 — the last time a maintainer regenerated the receipt with `node tools/gen-lint-receipt.mjs` and committed it; timing is environment-labeled, not gated. The replay runs with `--ast-parse-mode lenient` — the pinned corpus predates the current target-mismatch load guard — and the receipt records that posture (`astParseMode`, a pinned field) plus whether the guard fired at the last regeneration (`targetMismatchGuardWarning: true`, a label).

<!-- /docs -->

## Regenerating this page

```bash
pnpm docs:inject                     # re-derive every injected block (fails loud on a dead anchor)
node tools/gen-lint-receipt.mjs      # regenerate the lint receipt from the pinned merged range
```

Both run in CI on every pull request — the inject as a drift gate (`git diff --exit-code -- README.md docs/` after it) and the receipt generator in `--verify` mode, which recomputes the pinned fields against the committed receipt. A claim that stops reproducing fails the Docs Governance check. The receipt's environment labels (platform, node, CLI, timestamp) change only when a maintainer runs the generator without `--verify` and commits the result, as with any other data refresh on this page.
