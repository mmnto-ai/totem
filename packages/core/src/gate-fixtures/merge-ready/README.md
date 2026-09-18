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

They were re-made a fourth time in the same PR's bot round (Greptile's P1): the `CheckRun`
fragment now also selects the run's PRODUCER — `checkSuite { app { slug } workflowRun {
workflow { name } } }` — because two apps, or two workflows under one app, may name a job
alike and those are independent checks, never reruns; only runs that share a name AND a
producer collapse. The four PR captures were re-captured with the new query on 2026-09-18
(on mmnto-ai/totem#2871 both D1 runs read `github-actions/Auto-close guard`, so the
collapse stands), every synthetic `CheckRun` node was stamped with a producer
(`github-actions` / `CI`) at `2026-09-18T19:18:14Z`, and three more synthetic fixtures pin
the round: two same-named checks from different workflows (both judged, the failure
denies), a same-named pair whose producer did not read (unreadable), and a rerun pair whose
id lies beyond the safe-integer range (unreadable, Greptile's P2). Twelve
`synthetic-check-*.json` fixtures in all.

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
`443e08c6832d2d39e05075d1b9d565016192c64e965afe0c4588f892fa5a65fc` — re-derived from the
exported constant by the receipts test, so a query change that skips a re-capture fails
there. `gh version 2.99.0
(2026-09-01)` answered all four.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-18T19:19:48.097Z` | `b5e1620dc1d01d19950e6817ab8564f2c7d502b6addaf8003ab87b4f52f90e71` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-18T19:19:48.846Z` | `c0267dcf63f4911ea7d1a8de9be58ab144d01aceffaa36b0fb3dac9fd48634ba` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-18T19:19:49.697Z` | `ac20663e17411443315787a500f4763af14109d6a0afec9a96afa28ae249b399` |
| `totem-2871.json`          | [mmnto-ai/totem#2871](https://github.com/mmnto-ai/totem/pull/2871)                   | `2026-09-18T19:19:50.534Z` | `7e35fb634de18eda2645e7f04720401ef23a48f490f794167034e60975e508db` |

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
id) — at the end of the table. Each covers an invariant the captures cannot.

| File                                                      | Invariant                                                                                                                                                                                                                                                                                                                     | sha256                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`                        | `CLEAN` passes; no bot review passes 2–4 as a fact                                                                                                                                                                                                                                                                            | `f5076e63a78bc478a4b0b1285c5011e032919ce80c7d23fcbffaa53f18143477` |
| `synthetic-merge-state-has-hooks.json`                    | `HAS_HOOKS` passes                                                                                                                                                                                                                                                                                                            | `622364759c85a033f946e85855678ab0b8188967436bfa97f43c184dfbe89fcc` |
| `synthetic-merge-state-unstable.json`                     | `UNSTABLE` passes (a red non-required check is predicate 1's)                                                                                                                                                                                                                                                                 | `55f93aa1ded957e51e9d0b14bf76fa00655f386cdcbdd933e1109f3e70c774c4` |
| `synthetic-merge-state-behind.json`                       | `BEHIND` denies                                                                                                                                                                                                                                                                                                               | `f2b8fb0b9c7076ce8615c32ab974c815797d146707497dfbeb69fab4da28e388` |
| `synthetic-merge-state-dirty.json`                        | `DIRTY` denies                                                                                                                                                                                                                                                                                                                | `758d331d1283a6f853c3df8db2bd71617e21dac346074345789f3e8621b015b8` |
| `synthetic-merge-state-blocked.json`                      | `BLOCKED` denies                                                                                                                                                                                                                                                                                                              | `ad12c565a10c1c2a8bd50e2a72dee02d92a62ac71dbe8e09cbd93809e890afb8` |
| `synthetic-merge-state-draft.json`                        | `DRAFT` denies                                                                                                                                                                                                                                                                                                                | `e4776a2889295d0ebae0c4f5f60b78c25085c8f6ca339b0bfaceb357247bfc8f` |
| `synthetic-merge-state-unknown.json`                      | `UNKNOWN` is unevaluable (strict deny / pilot warn)                                                                                                                                                                                                                                                                           | `f071810a8eb895cf608df36766fd32602189fb6d8971715463690a3a5b701de9` |
| `synthetic-merge-state-unrecognised.json`                 | a status this gate does not read is unevaluable, never allow                                                                                                                                                                                                                                                                  | `ef5604dbc5c8e2dbddfe61c913fdc6107d4d76f56fdae29e9cdb668761e42cf4` |
| `synthetic-zero-checks.json`                              | R5 — zero checks passes as a fact, with the count and one line                                                                                                                                                                                                                                                                | `66d15b0d2922983cc3440e4107fd1ee383d032c8f4db94406eea13b9abf346ba` |
| `synthetic-failing-check.json`                            | a failing check denies at predicate 1                                                                                                                                                                                                                                                                                         | `81f82cb1cc47cedd222c2d7f658d88f5f44c2584ce62afb7454f59d66112f662` |
| `synthetic-pending-check.json`                            | a still-running check denies at predicate 1                                                                                                                                                                                                                                                                                   | `093d8981ccd09dbc0d3f534ac3342bc363ad5fa7bd8ef237d2347e11c09e34ec` |
| `synthetic-rollup-commit-mismatch.json`                   | F7 — a rollup off another commit is unevaluable, never green                                                                                                                                                                                                                                                                  | `80eaf2be47d3d3e00546554f1c54efab7742e7fb2d1f24c0f3c9ea92c177731e` |
| `synthetic-no-commits.json`                               | F7 — no commits answered: the head rollup is unreadable                                                                                                                                                                                                                                                                       | `0e148fa1c4d8033b9120860980ecef74036bcdfb722c22d56039c97e1b37f11f` |
| `synthetic-rollup-no-contexts.json`                       | F7 — a rollup with no contexts connection is not the zero-checks fact                                                                                                                                                                                                                                                         | `be30068e3b11de5016e6e55d21de72c3185abf1c4479fea130c99090c0087e99` |
| `synthetic-rollup-state-without-checks.json`              | F7 — `PENDING` over zero listed checks is unreadable, not R5                                                                                                                                                                                                                                                                  | `5db28fa398dd59bbe441c5dafcc266e891446f483b2be72ce752cd5825ca98d3` |
| `synthetic-rollup-state-null.json`                        | R2 F3 — a null rollup state over zero checks is unevaluable, not R5                                                                                                                                                                                                                                                           | `2513e7f7740d4d04403225f29b138c77de7408c321b8df9b2e15b3e3f29bd85c` |
| `synthetic-rollup-state-non-string.json`                  | R2 F3 — a non-string rollup state over zero checks is unevaluable                                                                                                                                                                                                                                                             | `e855f687f3ff047c294c8e8dcc0f3a2b693745643111d5bb39f720a7d24c9788` |
| `synthetic-high-inline-null-commit.json`                  | R2 F8 — a bot HIGH inline with a null commit is unevaluable, named                                                                                                                                                                                                                                                            | `2b30e38538caae3c1e78a62b202b61e6560932f00f9a3a9321aec3b50f639259` |
| `synthetic-rollup-count-without-checks.json`              | R3 F9 — SUCCESS with `totalCount: 3` over an empty list is unevaluable                                                                                                                                                                                                                                                        | `fe5bd1af38fd7d3bf60711e08c0c8a08380debd18948a79ed7b09e186aa3fcc6` |
| `synthetic-benign-fenced-marker-quote.json`               | R3 F4 — a Minor whose FENCE quotes the gate's markers reads NOT high                                                                                                                                                                                                                                                          | `38f3e306d9dc9f25260aaae12c223a7bf57f92f9ffa0d98f32a1641acc0ffd32` |
| `synthetic-rollup-count-string.json`                      | R4 F3 — a string `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                     | `476bdc0e602ce0465b3d5d592ec8920fb16c5d74b689b462e62377a8b6ade21f` |
| `synthetic-rollup-count-negative.json`                    | R4 F3 — a negative `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                   | `8cd319059f3ff4212794992406f336a2632ac794818be24fa01d50b0ecc88dcd` |
| `synthetic-rollup-count-boolean.json`                     | R4 F3 — a boolean `totalCount` is not a count: unevaluable                                                                                                                                                                                                                                                                    | `5fd985c7ae90517681e8c28225dd11d8b0187530fe0aaee8bcbd7a85f05e481a` |
| `synthetic-rollup-count-mismatch.json`                    | R4 F3 — 3 claimed, 1 materialised: an incomplete read, unevaluable                                                                                                                                                                                                                                                            | `7b8539498dc58456b97a775771ad5133af8b1ed9bee0ffcd4707664860e76684` |
| `synthetic-unresolved-bot-thread.json`                    | an unresolved, non-outdated bot thread denies                                                                                                                                                                                                                                                                                 | `9c205158f3aebdaf6b3828471215ec0c280ccb4c7cac434ab1b0a8a2d4adf49c` |
| `synthetic-resolved-outdated-human-threads.json`          | resolved / outdated / HUMAN threads never deny                                                                                                                                                                                                                                                                                | `01117d26b3c744071931491ec8146bbc223c76de0f5f4797f8cdf9cf3a04e2d4` |
| `synthetic-stale-commit-high-inline.json`                 | F2 — a HIGH inline applying to an OLDER commit does not deny                                                                                                                                                                                                                                                                  | `4dfcac5689f258d7834b9ded969efb8c5319d0312ce3b25b8053bd03b95aac4a` |
| `synthetic-head-commit-high-inline.json`                  | 2861 — the NEGATIVE CONTROL, field shape: a bare-resolved HIGH on head still denies under later chatter and another thread's disposition                                                                                                                                                                                      | `8c9eaa2384c6a88f1794111a6385541aaffc029a74e664bb80060521854151ae` |
| `synthetic-coderabbit-potential-issue.json`               | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker                                                                                                                                                                                                                                                                    | `4795b0d74032924ac0b171b289dc195ed11899d4668cfab81f1e93a7221723f2` |
| `synthetic-changes-requested-standing.json`               | F6 — a later COMMENTED from the same reviewer does not supersede                                                                                                                                                                                                                                                              | `56055c4aae5a6b42c4e23a65d71c11a5f3aa50cc6072c961896eb177fa1c950d` |
| `synthetic-changes-requested-superseded.json`             | a later `APPROVED` supersedes                                                                                                                                                                                                                                                                                                 | `6dadb195a1231f0b4d32c04b736f4f42e01df7e9818f4b70d13755331a609af6` |
| `synthetic-pagination-second-page-deny.json`              | a clean first page + a dirty SECOND page denies                                                                                                                                                                                                                                                                               | `756227393330cc668801749b078d1a588f5402795fb1e99ef31ab913c5e21d50` |
| `synthetic-pagination-second-page-fails.json`             | a pagination failure is unevaluable, not clean                                                                                                                                                                                                                                                                                | `d772c93395ef24d1a53cc7fbd15ed6bc34d836970cd1ddd5159eb74eaae3fa88` |
| `synthetic-head-moved.json`                               | a head sha that moved between pages is unevaluable                                                                                                                                                                                                                                                                            | `296310cfc078b7c58f4c47aab2e9619fc15220bbe7eb879c61d52da95fb62cd2` |
| `synthetic-rate-limit-exit.json`                          | a non-zero gh exit is unevaluable, naming what gh said                                                                                                                                                                                                                                                                        | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`                       | a GraphQL error in a 200 body is a failed read                                                                                                                                                                                                                                                                                | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                                | gh missing / unauthenticated is unevaluable at both tiers                                                                                                                                                                                                                                                                     | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`                        | `pr: null` + branch resolves via the branch-keyed document                                                                                                                                                                                                                                                                    | `cbfbcfe677885d76b035cf40b0dfa6625b46e2d597f8a789003dfe4ad551c81b` |
| `synthetic-reviews-connection-missing.json`               | PR round 1 — NO `reviews` connection is unreadable, never an empty list                                                                                                                                                                                                                                                       | `a9e910ef873b776ba3a5a7947bf4b78f1fbc8cbc819fcdc7ed472e08b9ce7677` |
| `synthetic-threads-connection-missing.json`               | PR round 1 — NO `reviewThreads` connection is unreadable, never empty                                                                                                                                                                                                                                                         | `3fa044615a4ec0f827ae43f693030d47d34a6bcf1dc66dc2036dd40825a2571d` |
| `synthetic-threads-pageinfo-missing.json`                 | PR round 1 — a threads connection with NO `pageInfo` is never complete                                                                                                                                                                                                                                                        | `023f2e372ae5eee4c09af68f8a6ff56cb5ac3cd9ce820b41bb157e21c749dba4` |
| `synthetic-failing-check-and-null-commit-high.json`       | PR round 1 — a failing check beside a null-commit HIGH DENIES, both tiers                                                                                                                                                                                                                                                     | `8bc0862519234b6578ab7505494e8a0a36e8ae50e274214edfc2605cbfc59c88` |
| `synthetic-merge-state-behind-and-null-commit-high.json`  | PR round 1 — BEHIND beside a null-commit HIGH is unevaluable (4 before 5)                                                                                                                                                                                                                                                     | `bd6735bc29752d6145b9f94b282e5ccb329a7e5dc93ac3b8dc8634cb8549607b` |
| `synthetic-high-inline-discharged-pr-level.json`          | 2861 — a resolved HIGH on head + a non-bot PR-level comment after the root: discharged                                                                                                                                                                                                                                        | `88f28e68ed7be7e9f99f5a6579c30c30d359f6e3b2203120317054597e218e49` |
| `synthetic-high-inline-discharged-in-thread.json`         | 2861 — a resolved HIGH on head + a non-bot in-thread reply, no PR comment: discharged                                                                                                                                                                                                                                         | `40ebaa3bbe28709e87f81f808d7b4bef730f48bdb29c56260ff00fc2530a5d21` |
| `synthetic-high-inline-deleted-author-reply.json`         | 2861 — a deleted-account (null author) reply is a human reply: discharged                                                                                                                                                                                                                                                     | `1232cbd2caea0b9a56cad35e75241d3e813c381642a5068952f46ce8997473a0` |
| `synthetic-high-inline-unresolved-with-disposition.json`  | 2861 — UNRESOLVED + a disposition is not discharged: predicate 2, highInline 1                                                                                                                                                                                                                                                | `19a4c00a1d1550e5313610c5aac9097300ad0281646d414828294d6d3fb58a57` |
| `synthetic-high-inline-mixed-discharge.json`              | 2861 — per-thread: one discharged beside one bare denies naming the bare one                                                                                                                                                                                                                                                  | `bc736cce99eddb5c5f0806031a67418d6cd1557d404a7f2322f9beb7a6dbee06` |
| `synthetic-comments-second-page-evidence.json`            | 2861 — the PR-level evidence on the SECOND comments page, cursor sent                                                                                                                                                                                                                                                         | `4132bc1017800ed22b6636bf3d6276f63634f33cadb89ccfbb368b50548f9152` |
| `synthetic-high-inline-resolved-window-incomplete.json`   | 2861 — a resolved HIGH with more comments than the window and no evidence read DENIES at both tiers, naming the window                                                                                                                                                                                                        | `14bf975b7465f7434b6c3cba388d876c824fe2e85b464eeb7b7eec4e08c9beab` |
| `synthetic-high-inline-root-id-missing.json`              | 2861 — a root with no readable databaseId is a thread no line can name: it stays applying, the page stays readable                                                                                                                                                                                                            | `3de58fa4150d961750087458ab1bb0a7eaf074eabee731804fb9cd0c086d7b85` |
| `synthetic-high-inline-discharged-window-incomplete.json` | 2861 — evidence FOUND discharges even when the window is incomplete (pins the invariant; kills the completeness-first mutant)                                                                                                                                                                                                 | `70ae0ddd009e3d6be5a5195305f2dd154d9851a21e2b21c39d890771b86d8d40` |
| `synthetic-comments-connection-missing.json`              | 2861 — NO PR `comments` connection is unreadable, never "no evidence"                                                                                                                                                                                                                                                         | `1942cc9969673980121e9f5d675b22027dcdade0a04ce1e3b3236a7d0fa5b7f4` |
| `synthetic-check-cancelled-after-success.json`            | mmnto-ai/totem#2879 - a success and then a LATER cancelled run of the same name (greater databaseId listed second): the latest run is CANCELLED, predicate 1 denies naming the check; the earlier success does not stand in                                                                                                   | `cec76977bb1bb1eb76668b9fa7e8d60bbaafd00bbe6dd0e1f8dc367a5e457470` |
| `synthetic-check-duplicate-id-missing.json`               | mmnto-ai/totem#2879 - two runs of one name where one carries databaseId null: the latest cannot be derived, the check state is unreadable (unevaluable at both tiers), never the first or the last one listed                                                                                                                 | `3f7e473e07b1fb4aa3a3d14b2b0c01868bf35dbddaef1b21f98f8cd43bd121f8` |
| `synthetic-check-single-cancelled.json`                   | mmnto-ai/totem#2879 - the negative that must keep denying: ONE cancelled run with no later run of its name is a check that did not pass                                                                                                                                                                                       | `1721ac5dccb5d4331620eda6120498038340063a30e9ed1db28e2610eb1d587f` |
| `synthetic-check-superseded-cancelled.json`               | mmnto-ai/totem#2879 - a concurrency-cancelled run beside the LATER success of the same name, the later run LISTED FIRST as GitHub lists them: predicate 1 judges the latest run (greatest databaseId), passes, and counts the superseded run                                                                                  | `171214133e8498142cfdfb28c180a4644a0f28ab2e9bab5613ae7d52bfb9aa70` |
| `synthetic-check-duplicate-across-pages.json`             | mmnto-ai/totem#2879 - the cancelled run of a name on page one of the checks connection and its later success on page two: the collapse runs once every page is in, so the pair is judged together (the second call carries the checks cursor)                                                                                 | `ed0732fca2a907549f4ad965d470bc41c7360270fddf5ff2d2d1a86973eee9ee` |
| `synthetic-check-single-null-id.json`                     | mmnto-ai/totem#2879 - a check that ran ONCE with databaseId null is judged on its own conclusion: the id is needed only to order same-named runs, so a single run without one is not unreadable                                                                                                                               | `6ca6ee1dac05b6668cdce04703cf5231aef3661415897a9c19f50885acd51c73` |
| `synthetic-check-three-runs-two-names.json`               | mmnto-ai/totem#2879 - two names ran more than once on one head, one of them THREE times with a FAILURE first: superseded counts RUNS (3), not names (2); one disclosure line per name; an earlier failed run is superseded like a cancelled one                                                                               | `80c891c9a6c83e32b85b4cf4a9d92b72ddec87b620e6a17df74d078961a811c5` |
| `synthetic-check-long-name-superseded.json`               | mmnto-ai/totem#2879 - a superseded cancel under a check name LONGER than the 160-character evidence bound: the disclosure line carries the whole name and no ellipsis (never sliced)                                                                                                                                          | `fe834dc0cbcc349a3f62316d8de060b685bf5a5549997382a40ef4495aa7fd33` |
| `synthetic-check-unnamed-runs.json`                       | mmnto-ai/totem#2879 - two CheckRun nodes whose name is null (unreachable from GitHub, where name is NON_NULL; a malformed payload): each is its own check, never one check that ran twice - total counts both, nothing is superseded                                                                                          | `cce58444446ff8fee53d4686fe2eb4ba09baead1041fea506072c0a12aa894e9` |
| `synthetic-check-duplicate-id-unsafe.json`                | mmnto-ai/totem#2879 bot round 1 (Greptile P2) - two reruns of one check where one id lies beyond the safe-integer range (9007199254740993, which JSON.parse rounds): the id does not read, so the latest cannot be derived and the check state is unreadable (unevaluable at both tiers), never ordered on a rounded number   | `2c951aa6c46487a3d73659b64f83c952b292f23163a4c76f3336da1d197095ce` |
| `synthetic-check-duplicate-producer-missing.json`         | mmnto-ai/totem#2879 bot round 1 (Greptile P1) - two runs of one name where one carries no readable producer (checkSuite.app null): the runs cannot be told apart as reruns or as independent checks, so the check state is unreadable (unevaluable at both tiers), never collapsed by name alone                              | `ca91d92f924a11d9802c41d70660df1c65adb7559a21422a15ac8b17a387c358` |
| `synthetic-check-same-name-two-producers.json`            | mmnto-ai/totem#2879 bot round 1 (Greptile P1) - two INDEPENDENT checks named "test", one from workflow A (FAILURE, lower id) and one from workflow B (SUCCESS, greater id): different producers never collapse, the failure stays a failing check and predicate 1 denies naming it; a name-only collapse would have hidden it | `d68771bfdc917a055d4beaef968613edbfda33f7259307ed74477ccbfa724119` |

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
