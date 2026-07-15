# Maturity

What's shipped, what's partial, and what's still a goal — derived from this repository, not asserted.

Every row in the table below lives in [`docs/data/maturity.json`](../data/maturity.json) and must carry at least one anchor — a file, a registered CLI command, or a committed data file — that is mechanically re-verified whenever this page regenerates. A row whose anchor stops resolving fails the docs build instead of quietly going stale, and CI regenerates the page on every pull request and fails on drift. The prose is handcrafted; the facts are injected.

<!-- docs MATURITY_TABLE -->

| Mechanism                                                                   | Status      | Notes                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic rule enforcement (`totem lint`)                               | **Shipped** | Compiled rules run offline against your diff — zero LLM calls in the gate. Wall time is receipted below, not asserted.                                                                                                          |
| Git-hook enforcement                                                        | **Shipped** | pre-commit / pre-push / post-merge / post-checkout. Installed explicitly — never silently.                                                                                                                                      |
| Lesson banking from real incidents                                          | **Shipped** | Plain markdown files are the canonical source; the search index is a derived, rebuildable cache.                                                                                                                                |
| Semantic knowledge index + MCP retrieval                                    | **Shipped** | Requires one IDE-level MCP registration step (see the MCP setup guide). The vector store is derived — deleting it loses nothing canonical.                                                                                      |
| Lesson → rule compilation (legacy path)                                     | **Partial** | Parked under a standing freeze since 2026-05-17 (receipt below) pending a replacement derivation pipeline. The compiled corpus remains fully enforced.                                                                          |
| AI review lanes with lesson grounding (`totem review`)                      | **Shipped** | LLM-assisted and advisory — verdicts record which lessons were consulted. The deterministic gates above are the floor; this never replaces them.                                                                                |
| Rule-tuning loop (`totem doctor --pr`)                                      | **Shipped** | Proposes rule fixes as a pull request; a human merges every change. Nothing lands autonomously.                                                                                                                                 |
| Claim-discipline gates on our own docs                                      | **Shipped** | README badges and this page are derived from committed data and drift-gated in CI. A claim whose anchor stops resolving fails the build.                                                                                        |
| Multi-seat coordination substrate                                           | **Shipped** | local-only · multi-seat opt-in. File-anchored mailboxes for repos where several agents share one working tree; the single-seat path never touches it. Bring your own orchestration — this is coordination state, not a runtime. |
| Rule derivation from merged-PR history, validated against held-out controls | **Goal:**   | Goal: replace the parked legacy compiler with derivation that passes held-out validation before any public claim rides on it. A prototype exists; its runs to date are under-powered, so this stays a goal row.                 |

<!-- /docs -->

Statuses mean what they say: **Shipped** is running in this repository today, **Partial** ships with a named limitation, and **Goal:** does not exist yet as a mechanism — we write it down so you don't have to reverse-engineer our ambitions from marketing copy.

## Receipts

Three claims we would rather prove than assert.

### Every rule traces to a banked lesson

<!-- docs RULE_PROVENANCE -->

**485 compiled rules** stand between a banked mistake and its recurrence, and every one carries the content hash of the lesson it came from (`lessonHash`) — the chain from incident to enforcement is mechanical, not editorial. They compile from **485 distinct lessons** (engines: 268 ast-grep / 217 regex; compiled between 2026-04-06 and 2026-06-07). 1120 lessons currently rest as non-compilable rather than being force-fitted into rules.

<!-- /docs -->

### We hold our own line

<!-- docs DAYS_UNDER_FREEZE -->

The legacy lesson→rule compiler has been parked under a standing freeze since **2026-05-17** — **59 days** as of this page's last data refresh (2026-07-15). Rather than keep running a compiler we no longer trust, the rule corpus is enforced read-only until its replacement passes held-out validation. We hold our own line the way we ask your repo to hold its own.

<!-- /docs -->

### The gate is offline

<!-- docs LINT_RECEIPT -->

A real merged diff of this repository (`c14e90ab..ba8c591d`, 41 files) linted in **3570 ms** with **zero LLM calls** — the run executed with every provider API key stripped from the environment, so there was nothing to silently call. 387 rules evaluated; 0 errors, 20 warnings. Environment: win32-x64, node 24.16.0, CLI 1.96.0, generated 2026-07-15. CI recomputes this receipt on every pull request — the counts must match; timing is environment-labeled, never gated.

<!-- /docs -->

## Regenerating this page

```bash
pnpm docs:inject                     # re-derive every injected block (fails loud on a dead anchor)
node tools/gen-lint-receipt.mjs      # regenerate the lint receipt from the pinned merged range
```

Both run in CI on every pull request; a claim that stops reproducing blocks the merge.
