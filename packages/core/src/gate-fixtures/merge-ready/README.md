# merge-ready fixtures (mmnto-ai/totem#2800, ruling R4)

Every file here answers the injected `GhRunner` seam in place of the network, so
`merge-ready.test.ts` never calls GitHub. FIVE files are REAL captures — four pull
requests plus the benign corpus that measures the severity read's false-positive budget —
and the rest are synthetic, saying so in their name and in their `"kind"` field.

All of them were re-made in the fold round: the query now asks for `comment.commit { oid }`
(fold F2 — the commit a finding CURRENTLY applies to, beside the `originalCommit` it was
written against), so every capture and every synthetic body carries the new shape.

They were re-made again for the predicate-4 discharge (mmnto-ai/totem#2861): the query now
selects the EVIDENCE fields — `databaseId`, `pageInfo`, `createdAt` and
`author { __typename }` on every thread comment, and a fourth paginated connection, the
PR-level `comments`, with `author`, `body` and `createdAt` per node. The body is read for
`disposition: <root comment id> <verb>` lines — the per-thread line the review-reply skill's
step 2 emits, keyed on the root's `databaseId` — after two round-level reads (post-dating
alone, then the round's `local-lane:` line) were falsified by the legs and the operator
ruled for the thread-level line on 2026-09-16. The four PR captures were re-captured with
the final query on 2026-09-16 (the corpus is not a page capture and the severity read did
not change, so it stands), and every synthetic body was reshaped to carry the fields — at
`2026-09-16T00:40:43.010Z` for the evidence fields and again for the `databaseId`s (roots
1001, 1002, … in thread order; replies 2001, …) — `synthesizedAt` keeps the instant each
invariant was authored; the reshapes added fields and changed no verdict.

They were re-made a third time for the latest-run judgment (mmnto-ai/totem#2879): the
`CheckRun` fragment now selects `databaseId` — GitHub's check-run id, one increasing
sequence — so predicate 1 can judge a check NAME that ran more than once on the head by its
latest run (a `cancel-in-progress` concurrency group cancels the run a later push or body
edit superseded, and the rollup lists both; its order is not chronological, so the id is
the only ordinal). The four PR captures were re-captured with the new query on 2026-09-18,
and every synthetic body's `CheckRun` nodes were stamped with ids (5001, 5002, … in node
order per fixture) at `2026-09-18T17:03:58Z` — `synthesizedAt` unchanged; the reshape added
a field and changed no verdict. Nine new synthetic fixtures (`synthetic-check-*.json`) pin
the judgment: the superseded cancel, the later cancel, the lone cancel, the duplicate with
no readable id, and — from the two falsification legs' folds — a three-run group beside a
two-run group (superseded counts RUNS; one disclosure line per name; an earlier FAILURE is
superseded like a cancel), lone runs with no id (judged on their own conclusion, one SUCCESS
and one FAILURE), a pair split across two pages of the checks connection (judged together
after the last page), a check name longer than the evidence bound (disclosed whole, never
sliced), and two runs whose name did not read (two checks, never one that ran twice).
A rollup that carries a cancelled or failed run reports `state: FAILURE` on every live
specimen, and every `synthetic-check-*` body says so.

They were re-made a fourth time in the same PR's bot round (Greptile's P1) and a fifth time
on the re-armed leg's fold of it: the `CheckRun` fragment now also selects the run's
PRODUCER and its check suite — `checkSuite { databaseId app { slug } workflowRun {
workflow { databaseId name } } }` — because two apps, or two workflows under one app, may
name a job alike and those are independent checks, never reruns; only runs that share a
name AND a producer (the app, and the workflow's ID for Actions) collapse, and two
same-named runs of one producer that sit in ONE suite are two jobs of one run, unreadable
rather than collapsed. The four PR captures were re-captured with each query on 2026-09-18
(on mmnto-ai/totem#2871 both D1 runs belong to workflow `317182441`, `Auto-close guard`, in
two suites, so the collapse stands). Every pre-existing synthetic `CheckRun` node was
stamped with the producer `github-actions` / `CI` (a workflow id per name, its own suite id
per node); the six new fixtures carry the producers their roles name, one of them a
deliberate `app: null`. `synthesizedAt` moved only on the new fixtures: three at
`2026-09-18T19:18:14Z` (two same-named checks from different workflows, both judged, the
failure denies; a same-named pair whose producer did not read, unreadable; a rerun pair
whose id was written beyond the safe-integer range, unreadable — Greptile's P2) and three
at `2026-09-18T19:40:52Z` (two workflow files sharing a display name, both judged; two
same-named jobs in one suite, unreadable; two producers where one run has no id, both
judged). The stamps added fields and changed no verdict. Fifteen `synthetic-check-*.json`
fixtures in all.

## Shape

```jsonc
{
  "kind": "capture" | "synthetic",
  "repo": "owner/name", // captures only
  "pr": 363, // captures only
  "role": "what this fixture is for",
  "capturedAt" | "synthesizedAt": "<ISO instant, read from the clock in the same command that wrote the file>",
  "ghVersion": "gh version 2.99.0 (2026-09-01)", // what `gh --version` answered
  "ghVersionExitCode": 1, // optional; present only for the gh-absent fixture
  "pages": [{ "exitCode": 0, "body": { "data": { "repository": { … } } } }]
}
```

`pages` are answered in order, one per `gh api graphql` call the evaluator makes. A page
with a non-zero `exitCode` carries `stdout` (the text gh wrote) instead of `body`.

## The four PR captures

Each was taken by running the REAL `evaluateMergeReady` with a runner that spawned `gh`
and teed each response, so the query in the capture is `MERGE_READY_QUERY` from
`packages/core/src/merge-ready.ts` verbatim. sha256 of that query string at capture time:
`5ef8e8bd10eb5ba94481bcd2663e0fce1448dea92d3f632ec9fced2813a9e592` — re-derived from the
exported constant by the receipts test, so a query change that skips a re-capture fails
there. `gh version 2.99.0
(2026-09-01)` answered all four.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-18T19:41:02.386Z` | `3fa0353b7c01de6a1990868e4c4085c7884903ee1b6745f45639fc1e800e704d` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-18T19:41:03.172Z` | `e3d60210261338b7defb634f4bbcf4dd51607a8ad487a1d7b529343d1f260990` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-18T19:41:04.286Z` | `bb65bfcd3514850cc43265b52431ed64a944f0fbe9459d2be55920ce12304e6c` |
| `totem-2871.json`          | [mmnto-ai/totem#2871](https://github.com/mmnto-ai/totem/pull/2871)                   | `2026-09-18T19:41:05.203Z` | `dacd5afc4e9ecf2e3305948201ce35cbabaca9b4a3b283cc2bc969e91c69c492` |

A fifth capture is the SEVERITY READ's benign corpus, taken the same way (the exported
query as it stood on 2026-09-08, one call per PR, instant clock-read in the writing
command); it is a per-thread table rather than a page answer, so the 2861 query change did
not move it:

| File                             | What                                                                                                        | Captured (UTC)             | sha256                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `benign-corpus-bot-inlines.json` | all 16 bot inline threads on mmnto-ai/totem#2820-2839, each with its bot's own label AND both commit fields | `2026-09-08T06:25:27.918Z` | `c6629238334ab107c833d44af1309ab9538c97fcbda13e3c68e6b0c5164850ed` |

It exists because ADR-109 requires a non-exact-match read to ship a stated false-positive
budget AND the fixture that measures it. The budget is **ZERO** high reads that disagree
with a bot's own declaration, and `merge-ready.test.ts` asserts it thread by thread. Each
row carries `declaredLabel` (the badge or emphasis label as observed), `expectedHigh`
(derived from that label, not from the code under test) and the full body — the body is
kept whole on purpose: the prose that fooled the old read is the evidence.

What each one carries, as GitHub answered on its capture instant:

- **mmnto-ai/liquid-city#363** (R4's positive control) — 6 checks, all SUCCESS; one review
  thread, unresolved and not outdated, whose ROOT comment is `gemini-code-assist` carrying
  the `![high](…high-priority.svg)` marker on the head commit
  (`d09ce906b1a12125e089b77e668bea25f1bdef2d`). It denies at predicate 2, with
  `highInline: 1` in provenance. It is also the specimen for the GraphQL login spelling:
  `author.login` is `gemini-code-assist`, with NO `[bot]` suffix.
- **mmnto-ai/totem-strategy#1251** (R4's negative control) — 3 checks, all SUCCESS; no
  reviews and no threads. Predicates 1–4 pass.
- **mmnto-ai/totem#2827** (the fold F2 witness) — 16 checks, all SUCCESS; one unresolved
  `greptile-apps` thread carrying a `P1` marker whose `comment.commit.oid` IS the head
  (`1e83246b…`) while its `originalCommit.oid` is an older commit (`03f36ef2…`). That
  divergence is the whole reason predicate 4 reads `commit`: keyed on `originalCommit`, a
  real HIGH finding that still applies to what would merge reads as "not on head" and the
  predicate goes inert.
- **mmnto-ai/totem#2871** (the discharge specimen, mmnto-ai/totem#2861) — 17 rollup
  contexts, all SUCCESS: 16 check runs under 15 names plus one legacy status context;
  `Auto-close required check (D1)` ran twice on the head (ids `103790771534` and
  `103803324012`, both SUCCESS), so the 2026-09-18 re-capture is also a live specimen of
  the latest-run judgment (mmnto-ai/totem#2879) — `checks.total` 16, `superseded` 1, the
  later id judging; seven bot threads, six of them OUTDATED and unresolved (their anchors moved
  under the folds) and ONE resolved: the thread whose root is a `coderabbitai` Major
  (`_🟠 Major_`, dynamic imports in a test file) with `comment.commit.oid` equal to the
  head (`a1e89aac…`), root comment id `4000747291`, declined with reason in the round's
  consolidated disposition (prose) and resolved by `totem resolve-threads 2871 --apply`;
  under the 2026-09-16 ruling the seat posted the per-thread line on the PR
  (`disposition: 4000747291 declined`, comment 5691027142), the one non-bot PR-level
  comment after the root that NAMES the thread. Before the cure this read
  `deny · high-severity-inline · highInline 1` (the calibration row on the issue); it now
  reads `highInline 0`, `dischargedHigh 1` (`prLevelDisposition 1`), with the discharge
  named on stderr, and lands on the UNKNOWN-mergeability arm — reachable only when
  predicates 1–4 have passed.

All four PRs are merged, and GitHub answers `mergeStateStatus: UNKNOWN` for each of them
on every capture instant (an observation about these four, not a rule: a merged
mmnto-ai/liquid-city#1279 answers `DIRTY` on the same day). That is why
mmnto-ai/totem-strategy#1251 and mmnto-ai/totem#2871 land in the UNEVALUABLE class rather
than allowing, and why every `mergeStateStatus` value is exercised by a synthetic fixture
below. No PR needed synthesizing: all four still answer.

### The census, and where predicate 4's own case has its real specimen

Every pull request in the range mmnto-ai/totem#2820 through mmnto-ai/totem#2839 was read
with the exported query on 2026-09-08 (ten of the twenty numbers are pull requests; the
rest are issues). They carry **16 bot inline threads**, all of which are in
`benign-corpus-bot-inlines.json` with the severity each bot declared for itself.

The count of HIGH threads depends on which read you use, so both numbers are recorded:

| read                                          | HIGH threads | per PR                                      |
| --------------------------------------------- | ------------ | ------------------------------------------- |
| the WORD-based read (before fold round 2, F4) | 9            | #2821=1, #2827=1, #2830=1, #2831=4, #2839=2 |
| the EXACT-BY-MARKER read (current)            | 8            | #2821=1, #2827=1, #2830=1, #2831=3, #2839=2 |

The single difference is `mmnto-ai/totem#2831/thread-2`, a greptile finding its own badge
labels `alt="P2"`: the word-based read flagged it through the word "critical" in its
explanation, the marker read does not. That thread is the corpus's falsifier row.

Predicate 4's own territory is a bot HIGH finding on a **resolved** thread whose comment
still applies to the head commit. **None** of the 16 corpus threads is resolved, so the
corpus cannot carry that case; `totem-2871.json` carries its DISCHARGED half (resolved
through the disposition path — mmnto-ai/totem#2861), and the bare-resolve half — a thread
resolved with no disposition on record, which still applies — has no real specimen in any
capture, so `synthetic-head-commit-high-inline.json` stands in for it as the negative
control.

The RE-POINTING the predicate depends on — `comment.commit.oid` moving while
`originalCommit.oid` stays put — is now a field on every corpus row, and the counts are
read from those fields rather than asserted in prose: **8 of the 16** threads are
re-pointed (#2827=1, #2830=1, #2831=2, #2834=1, #2839=3), and **3 of the 8 marker-HIGH**
threads are (#2827=1, #2839=2). mmnto-ai/totem#2831 re-points **none** of its HIGH threads
— all three carry `commit == originalCommit == 835b3d7f` — which an earlier version of
this sentence got wrong (round 3, F2). `merge-ready.test.ts` asserts these counts — the total, the per-PR HIGH breakdown, and
that mmnto-ai/totem#2831 contributes none — so the table above cannot drift from the
fixture.

## The synthetic fixtures

Pagination synthetics under-fill their pages on purpose: the query asks for a hundred
contexts (or threads, or comments) per page, and a fixture that split a real hundred would
be unreadable, so a second-page fixture closes page one after a node or two with
`hasNextPage: true` and a cursor. The shape of the walk is what they pin, not the page size.

All synthesized `2026-09-08T03:55:11.894Z`, except the three fold-round-2 rows
(`2026-09-08T05:42:31.591Z`) and the two fold-round-3 rows
(`2026-09-08T06:26:38.783Z` and `2026-09-08T06:25:27.919Z`) and the four fold-round-4 rows
(`2026-09-08T07:05:39.879Z`) and the five PR-round-1 rows (`2026-09-08T21:08:06.765Z`,
mmnto-ai/totem#2844) and the eleven mmnto-ai/totem#2861 rows — seven at
`2026-09-16T00:47:11.787Z` (all new), three at `2026-09-16T01:17:05.889Z` for the fold that
added the disposition line (the negative control and the bare-resolve window fixture
re-authored, the discharged-window fixture created), and one at `2026-09-16T02:50:30.916Z`
for the ruled fold (the missing-root-id fixture) — and the twelve mmnto-ai/totem#2879 rows: four at
`2026-09-18T17:03:58Z` (the judgment), three at `2026-09-18T17:31:48Z` (the first leg's fold;
two of them re-authored again in the second leg's fold, `synthesizedAt` moved with them),
two at `2026-09-18T17:53:26Z` (the long name, the unnamed runs) and three at
`2026-09-18T19:18:14Z` (the bot round: two producers, a producer that did not read, an unsafe
id) and three at `2026-09-18T19:40:52Z` (the third leg's fold: two workflow files, two jobs in
one suite, two producers with one null id) — fifteen rows — at the end of the table. Each
covers an invariant the captures cannot.

| File                                                      | Invariant                                                                                                                                                                                                                                                                                                                                                              | sha256                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`                        | `CLEAN` passes; no bot review passes 2–4 as a fact                                                                                                                                                                                                                                                                                                                     | `1b3ad9fa26bee7c0aecf4aa88a2cc7b89cfc4df151be3ec42fb78b1ec0887e74` |
| `synthetic-merge-state-has-hooks.json`                    | `HAS_HOOKS` passes                                                                                                                                                                                                                                                                                                                                                     | `311b9c556989a69fabb82acc938ba84e836231e544471d9b4e0155fa8d826916` |
| `synthetic-merge-state-unstable.json`                     | `UNSTABLE` passes (a red non-required check is predicate 1's)                                                                                                                                                                                                                                                                                                          | `0162f8a621d79c1efc72b24881365487b94df5da9727358d94b807e2bcf1b84e` |
| `synthetic-merge-state-behind.json`                       | `BEHIND` denies                                                                                                                                                                                                                                                                                                                                                        | `4b1f8e6fe001b8c16634186768bda016745e81badca76bf989abb9b95443336c` |
| `synthetic-merge-state-dirty.json`                        | `DIRTY` denies                                                                                                                                                                                                                                                                                                                                                         | `1306840762ce769d2acf380d0990efb4c8f85051334bf5324ab51a074da40729` |
| `synthetic-merge-state-blocked.json`                      | `BLOCKED` denies                                                                                                                                                                                                                                                                                                                                                       | `326e320815734195bc11a7d27a60f36390ac2baed00d11e71967d54c08a71428` |
| `synthetic-merge-state-draft.json`                        | `DRAFT` denies                                                                                                                                                                                                                                                                                                                                                         | `6046dd2c9c1e0813e0831ae95dce638bdd75013ea41cf9adaef342651d962292` |
| `synthetic-merge-state-unknown.json`                      | `UNKNOWN` is unevaluable (strict deny / pilot warn)                                                                                                                                                                                                                                                                                                                    | `2dcb206679555b41fcb9b9929c7e559cb7ddec0a882a3e87495eb99532eaf3ff` |
| `synthetic-merge-state-unrecognised.json`                 | a status this gate does not read is unevaluable, never allow                                                                                                                                                                                                                                                                                                           | `63aa51f7770a86d1fc6ac50dde7107bddbd59634e8ae1e0c7deac7da1c818fb5` |
| `synthetic-zero-checks.json`                              | R5 — zero checks passes as a fact, with the count and one line                                                                                                                                                                                                                                                                                                         | `66d15b0d2922983cc3440e4107fd1ee383d032c8f4db94406eea13b9abf346ba` |
| `synthetic-failing-check.json`                            | a failing check denies at predicate 1                                                                                                                                                                                                                                                                                                                                  | `19a52c7bd3784d607d5db928c8310f8eeb372a642e22b434a2c8e8915a800089` |
| `synthetic-pending-check.json`                            | a still-running check denies at predicate 1                                                                                                                                                                                                                                                                                                                            | `14cf8ecb3330011288c4e5e442aa22a9f309f410eadb66edf3200e667d6bdc96` |
| `synthetic-rollup-commit-mismatch.json`                   | F7 — a rollup off another commit is unevaluable, never green                                                                                                                                                                                                                                                                                                           | `cc5e3e55208b13676c386be14e0b869b8fcf266f7ef1852ae340e960220c1ec7` |
| `synthetic-no-commits.json`                               | F7 — no commits answered: the head rollup is unreadable                                                                                                                                                                                                                                                                                                                | `0e148fa1c4d8033b9120860980ecef74036bcdfb722c22d56039c97e1b37f11f` |
| `synthetic-rollup-no-contexts.json`                       | F7 — a rollup with no contexts connection is not the zero-checks fact                                                                                                                                                                                                                                                                                                  | `be30068e3b11de5016e6e55d21de72c3185abf1c4479fea130c99090c0087e99` |
| `synthetic-rollup-state-without-checks.json`              | F7 — `PENDING` over zero listed checks is unreadable, not R5                                                                                                                                                                                                                                                                                                           | `5db28fa398dd59bbe441c5dafcc266e891446f483b2be72ce752cd5825ca98d3` |
| `synthetic-rollup-state-null.json`                        | R2 F3 — a null rollup state over zero checks is unevaluable, not R5                                                                                                                                                                                                                                                                                                    | `2513e7f7740d4d04403225f29b138c77de7408c321b8df9b2e15b3e3f29bd85c` |
| `synthetic-rollup-state-non-string.json`                  | R2 F3 — a non-string rollup state over zero checks is unevaluable                                                                                                                                                                                                                                                                                                      | `e855f687f3ff047c294c8e8dcc0f3a2b693745643111d5bb39f720a7d24c9788` |
| `synthetic-high-inline-null-commit.json`                  | R2 F8 — a bot HIGH inline with a null commit is unevaluable, named                                                                                                                                                                                                                                                                                                     | `4bf28fa2b76112a01bfe6176c46748f4598128a31e55a6638bac1f063c598928` |
| `synthetic-rollup-count-without-checks.json`              | R3 F9 — SUCCESS with `totalCount: 3` over an empty list is unevaluable                                                                                                                                                                                                                                                                                                 | `fe5bd1af38fd7d3bf60711e08c0c8a08380debd18948a79ed7b09e186aa3fcc6` |
| `synthetic-benign-fenced-marker-quote.json`               | R3 F4 — a Minor whose FENCE quotes the gate's markers reads NOT high                                                                                                                                                                                                                                                                                                   | `38f3e306d9dc9f25260aaae12c223a7bf57f92f9ffa0d98f32a1641acc0ffd32` |
| `synthetic-rollup-count-string.json`                      | R4 F3 — a string `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                                                              | `476bdc0e602ce0465b3d5d592ec8920fb16c5d74b689b462e62377a8b6ade21f` |
| `synthetic-rollup-count-negative.json`                    | R4 F3 — a negative `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                                                            | `8cd319059f3ff4212794992406f336a2632ac794818be24fa01d50b0ecc88dcd` |
| `synthetic-rollup-count-boolean.json`                     | R4 F3 — a boolean `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                                                             | `5fd985c7ae90517681e8c28225dd11d8b0187530fe0aaee8bcbd7a85f05e481a` |
| `synthetic-rollup-count-mismatch.json`                    | R4 F3 — 3 claimed, 1 materialised: an incomplete read, unevaluable                                                                                                                                                                                                                                                                                                     | `9f16a648d0331a5983bc498c17a64c3751a878ff24eee98e0c52384502e9428d` |
| `synthetic-unresolved-bot-thread.json`                    | an unresolved, non-outdated bot thread denies                                                                                                                                                                                                                                                                                                                          | `023c0142e13b81b0955fec510361865e34eb8d4ac56f3840220bccb559dac058` |
| `synthetic-resolved-outdated-human-threads.json`          | resolved / outdated / HUMAN threads never deny                                                                                                                                                                                                                                                                                                                         | `1aaf155e06a0ed72c5fdcdb5dd98f0c382560e6287d47261fa89e7cc5b995c10` |
| `synthetic-stale-commit-high-inline.json`                 | F2 — a HIGH inline applying to an OLDER commit does not deny                                                                                                                                                                                                                                                                                                           | `3847a1b02578ea83963a3c1a22c3ff139d6036b3acb9962161fe26d01d1e4602` |
| `synthetic-head-commit-high-inline.json`                  | 2861 — the NEGATIVE CONTROL, field shape: a bare-resolved HIGH on head still denies under later chatter and another thread's disposition                                                                                                                                                                                                                               | `b20117df95dfaede93cb4c8daf4213c7c923001053a42e0ad2365a1d7e2f8949` |
| `synthetic-coderabbit-potential-issue.json`               | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker                                                                                                                                                                                                                                                                                                             | `5ed7741d1b11488c553550cdc91a56b3a90da886f5797e147c1abda8650808c1` |
| `synthetic-changes-requested-standing.json`               | F6 — a later COMMENTED from the same reviewer does not supersede                                                                                                                                                                                                                                                                                                       | `a9ee3d04cad063ae71f5ef555af48bf277c4ad2030f35735823dac38f66e2860` |
| `synthetic-changes-requested-superseded.json`             | a later `APPROVED` supersedes                                                                                                                                                                                                                                                                                                                                          | `cb72f86d2677ac312c423c87ed915e2ffc09933e4ed92e7372a590651a09762b` |
| `synthetic-pagination-second-page-deny.json`              | a clean first page + a dirty SECOND page denies                                                                                                                                                                                                                                                                                                                        | `3b71b430f0fa462a141929937e5df78aaa98ea27b9429faaa28e4ead696a3cd6` |
| `synthetic-pagination-second-page-fails.json`             | a pagination failure is unevaluable, not clean                                                                                                                                                                                                                                                                                                                         | `69ff8118f2f10cb66d14013adc2270b3f9ff07c31e6acdb1d58234666431101c` |
| `synthetic-head-moved.json`                               | a head sha that moved between pages is unevaluable                                                                                                                                                                                                                                                                                                                     | `0a215d8122ce4ecda7c610171b418ca53a91c3cfc4f30038a71b17fd42f19567` |
| `synthetic-rate-limit-exit.json`                          | a non-zero gh exit is unevaluable, naming what gh said                                                                                                                                                                                                                                                                                                                 | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`                       | a GraphQL error in a 200 body is a failed read                                                                                                                                                                                                                                                                                                                         | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                                | gh missing / unauthenticated is unevaluable at both tiers                                                                                                                                                                                                                                                                                                              | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`                        | `pr: null` + branch resolves via the branch-keyed document                                                                                                                                                                                                                                                                                                             | `e2fff5ad3dd0a8d6404d920133e8dd36566f9c30507d7171fb8ea4d6ca3992c3` |
| `synthetic-reviews-connection-missing.json`               | PR round 1 — NO `reviews` connection is unreadable, never an empty list                                                                                                                                                                                                                                                                                                | `49a5cd912a706b881a3b3fa64609f619a6ee13f879806d4ccd7e8dec3e31998b` |
| `synthetic-threads-connection-missing.json`               | PR round 1 — NO `reviewThreads` connection is unreadable, never empty                                                                                                                                                                                                                                                                                                  | `1b5b23b5c8438e7c38398abb18e154910a00af36c2a8a28af1090b83cf43b627` |
| `synthetic-threads-pageinfo-missing.json`                 | PR round 1 — a threads connection with NO `pageInfo` is never complete                                                                                                                                                                                                                                                                                                 | `6d98b79d21349ea59d0f63da4a126adb18cd1583aba7d786d078e60283b85253` |
| `synthetic-failing-check-and-null-commit-high.json`       | PR round 1 — a failing check beside a null-commit HIGH DENIES, both tiers                                                                                                                                                                                                                                                                                              | `008583fac6e64fd538957cfa643246c9d01c5de7d55d5d4ad6425f6f8184777f` |
| `synthetic-merge-state-behind-and-null-commit-high.json`  | PR round 1 — BEHIND beside a null-commit HIGH is unevaluable (4 before 5)                                                                                                                                                                                                                                                                                              | `9b40037ecac898a5143522b3f27b14b267003db1de0b7c98d57a65e20d01532d` |
| `synthetic-high-inline-discharged-pr-level.json`          | 2861 — a resolved HIGH on head + a non-bot PR-level comment after the root: discharged                                                                                                                                                                                                                                                                                 | `7194f6d3e343a52b31361ec4f692d4af4c846d8a38ca16b48251babf9b374e10` |
| `synthetic-high-inline-discharged-in-thread.json`         | 2861 — a resolved HIGH on head + a non-bot in-thread reply, no PR comment: discharged                                                                                                                                                                                                                                                                                  | `18d22c6f5e3b128bb2701d3b368113f821343fa1b5e8015bbdcce1077edaac7e` |
| `synthetic-high-inline-deleted-author-reply.json`         | 2861 — a deleted-account (null author) reply is a human reply: discharged                                                                                                                                                                                                                                                                                              | `f69f8117d67c896460d20106aa8354753826358a0b16b30898cde4f9cc2e35cc` |
| `synthetic-high-inline-unresolved-with-disposition.json`  | 2861 — UNRESOLVED + a disposition is not discharged: predicate 2, highInline 1                                                                                                                                                                                                                                                                                         | `4a5d1eb18890c6f613eb538afd2f8dc5546c9264f81923c4ca5a0ce02ff3b1a6` |
| `synthetic-high-inline-mixed-discharge.json`              | 2861 — per-thread: one discharged beside one bare denies naming the bare one                                                                                                                                                                                                                                                                                           | `b26cb8848dfafb003c73ce9dabd2878c1a2396c472ca785eefe08231e3fc1ec1` |
| `synthetic-comments-second-page-evidence.json`            | 2861 — the PR-level evidence on the SECOND comments page, cursor sent                                                                                                                                                                                                                                                                                                  | `5cbb2da0d72ccd0088c86b5027350eefd6cfa5459b2264aa7eb9b10ce7ed854a` |
| `synthetic-high-inline-resolved-window-incomplete.json`   | 2861 — a resolved HIGH with more comments than the window and no evidence read DENIES at both tiers, naming the window                                                                                                                                                                                                                                                 | `fd75d4f3a5b81442192804d0f4dc862bc741ef5e19a9955e74c1344e2aebfd95` |
| `synthetic-high-inline-root-id-missing.json`              | 2861 — a root with no readable databaseId is a thread no line can name: it stays applying, the page stays readable                                                                                                                                                                                                                                                     | `a6f168fddf58ae44e881609c9d67305b2b35b99cdb805dd05c25d370a9aa02a0` |
| `synthetic-high-inline-discharged-window-incomplete.json` | 2861 — evidence FOUND discharges even when the window is incomplete (pins the invariant; kills the completeness-first mutant)                                                                                                                                                                                                                                          | `cbaa95a690e6e814098ab8f7eef5b3586fc87d2b01dd9a427601ed909d50cfcb` |
| `synthetic-comments-connection-missing.json`              | 2861 — NO PR `comments` connection is unreadable, never "no evidence"                                                                                                                                                                                                                                                                                                  | `09edf8f0b161d25c3645a5af135dc398abc028ca8ac49f84240448b9daedaabf` |
| `synthetic-check-cancelled-after-success.json`            | mmnto-ai/totem#2879 - a success and then a LATER cancelled run of the same name (greater databaseId listed second): the latest run is CANCELLED, predicate 1 denies naming the check; the earlier success does not stand in                                                                                                                                            | `932407b33fb7005d33c0d6ca0d94e6931d3df307e966f7db5a57a30eea68f2f7` |
| `synthetic-check-duplicate-id-missing.json`               | mmnto-ai/totem#2879 - two runs of one name where one carries databaseId null: the latest cannot be derived, the check state is unreadable (unevaluable at both tiers), never the first or the last one listed                                                                                                                                                          | `5d7a36827f49e511793be928390e438f24684ae7801ba138a1ef79445bc37173` |
| `synthetic-check-single-cancelled.json`                   | mmnto-ai/totem#2879 - the negative that must keep denying: ONE cancelled run with no later run of its name is a check that did not pass                                                                                                                                                                                                                                | `07362b7751968ed5fb8e53098a78c5a64c9dce7793f7a4b9f02f1d58006e84b6` |
| `synthetic-check-superseded-cancelled.json`               | mmnto-ai/totem#2879 - a concurrency-cancelled run beside the LATER success of the same name, the later run LISTED FIRST as GitHub lists them: predicate 1 judges the latest run (greatest databaseId), passes, and counts the superseded run                                                                                                                           | `88b987a5835b9b5c27d00940d4c6429ca4a720a3ccc70f27db0c4d2d6048244a` |
| `synthetic-check-duplicate-across-pages.json`             | mmnto-ai/totem#2879 - the cancelled run of a name on page one of the checks connection and its later success on page two: the collapse runs once every page is in, so the pair is judged together (the second call carries the checks cursor)                                                                                                                          | `5428b45fd97ce2b17bbff251b8ac1b3f9c91f26f7759cb26525d3d34aa60b12a` |
| `synthetic-check-single-null-id.json`                     | mmnto-ai/totem#2879 - a check that ran ONCE with databaseId null is judged on its own conclusion: the id is needed only to order same-named runs, so a single run without one is not unreadable                                                                                                                                                                        | `195e6a1afef15b1de2b440bfb87830e4111a75721f16318fe39354d44e47e2fa` |
| `synthetic-check-three-runs-two-names.json`               | mmnto-ai/totem#2879 - two names ran more than once on one head, one of them THREE times with a FAILURE first: superseded counts RUNS (3), not names (2); one disclosure line per name; an earlier failed run is superseded like a cancelled one                                                                                                                        | `31e77831b25b3819c659c1f1d7d403fbd96cbf08fe779862eb24592c98c979cd` |
| `synthetic-check-long-name-superseded.json`               | mmnto-ai/totem#2879 - a superseded cancel under a check name LONGER than the 160-character evidence bound: the disclosure line carries the whole name and no ellipsis (never sliced)                                                                                                                                                                                   | `a1fc2980fff74ebdbf9d309de36d057875bfad4e2e933e8da0d5d89b9f4bc38b` |
| `synthetic-check-unnamed-runs.json`                       | mmnto-ai/totem#2879 - two CheckRun nodes whose name is null (unreachable from GitHub, where name is NON_NULL; a malformed payload): each is its own check, never one check that ran twice - total counts both, nothing is superseded                                                                                                                                   | `ddb2a49c9bdbb02a98797efc34dcd308236d7eddc7a8475bbfd27cbe257c7f37` |
| `synthetic-check-duplicate-id-unsafe.json`                | mmnto-ai/totem#2879 bot round 1 (Greptile P2) - two reruns of one check where one id lies beyond the safe-integer range (written as 9007199254740993, which JSON.parse rounds to the 9007199254740992 on disk): the id does not read, so the latest cannot be derived and the check state is unreadable (unevaluable at both tiers), never ordered on a rounded number | `cbd24b996e6d1bf304107617dc8ad6b55467ef94358ef04d4b8f424af11a3a67` |
| `synthetic-check-duplicate-producer-missing.json`         | mmnto-ai/totem#2879 bot round 1 (Greptile P1) - two runs of one name where one carries no readable producer (checkSuite.app null): the runs cannot be told apart as reruns or as independent checks, so the check state is unreadable (unevaluable at both tiers), never collapsed by name alone                                                                       | `0d0a1bec7cf2b8bf49dbdd144bca03e790977624676369c2381877b163d4271d` |
| `synthetic-check-same-name-two-producers.json`            | mmnto-ai/totem#2879 bot round 1 (Greptile P1) - two INDEPENDENT checks named "test", one from workflow A (FAILURE, lower id) and one from workflow B (SUCCESS, greater id): different producers never collapse, the failure stays a failing check and predicate 1 denies naming it; a name-only collapse would have hidden it                                          | `08779462572e754498f312a379a69c008f985e5033cd502e1fadfff22cde3355` |
| `synthetic-check-same-name-two-workflow-files.json`       | mmnto-ai/totem#2879 re-armed leg F1 - two workflow FILES that share the display name CI, each with a job named build: different workflow ids are different producers, both are judged and the earlier failure denies naming it; a key on the workflow display NAME would have collapsed them                                                                           | `54dfa20f2628a3687e91228531a3ba047cceb00b5016b2c96d61b679470e4707` |
| `synthetic-check-two-jobs-one-suite.json`                 | mmnto-ai/totem#2879 re-armed leg F1 - two distinct jobs of ONE workflow run that share a display name: same producer, same check suite - independent checks the key cannot tell apart, so the check state is unreadable (unevaluable at both tiers), never a collapse that hides the failure                                                                           | `2b05f6950f65bf0430b1f839e2875d1a50e5c1cbc77a85bcabe36e162082e43f` |
| `synthetic-check-two-producers-one-null-id.json`          | mmnto-ai/totem#2879 re-armed leg F6 - two same-named checks from different workflows where one carries databaseId null: different producers are both judged on their own conclusions, the missing id is not needed and nothing is unreadable                                                                                                                           | `1d9c4d9a0f4a613b32ad8caa10753e485c81dcb2699d0f751cf4b5ccee83d171` |

## The receipts in this file are machine-written

Every sha256 above is recomputed from the file on disk by the same command that writes the
table, and `merge-ready.test.ts` re-checks each row against the file it names. They are
never typed by hand: the first version of the corpus row carried the hash the CAPTURE
script printed BEFORE `prettier --write` reformatted the JSON, so the receipt described
bytes that never reached a commit (round 3, F1). Recompute after formatting, always.

## Re-capturing

A capture is a point-in-time answer: re-running the read on the same PR can produce a
different body (threads get resolved, `mergeStateStatus` recomputes, `comment.commit.oid`
re-points). Re-capture only deliberately, and update the instant, the sha256 and any
assertion that names a count. Changing the QUERY forces a re-capture: the fixture must be
what the evaluator would actually receive.
