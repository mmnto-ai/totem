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
a field and changed no verdict. Four new synthetic fixtures (`synthetic-check-*.json`) pin
the judgment: the superseded cancel, the later cancel, the lone cancel, and the duplicate
with no readable id.

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
`6faa716bc763a2255e1976342a755a7be5976e12048338bef45c85c77e7717fc` — re-derived from the
exported constant by the receipts test, so a query change that skips a re-capture fails
there. `gh version 2.99.0
(2026-09-01)` answered all four.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-18T17:06:52.875Z` | `dcb8bc25bc94a860c7f58f978897ebe79f1a2ed3862ab1b99177eb266ae12aad` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-18T17:06:53.681Z` | `e1ed6ea4b3e5ade24716439c6381fcd1e9cc05fb1a6870adbd8a000d85396bfb` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-18T17:06:54.772Z` | `c07d85728cfa30b9e73bfef49ee8429c962304b14fd657787598d5d52ed42031` |
| `totem-2871.json`          | [mmnto-ai/totem#2871](https://github.com/mmnto-ai/totem/pull/2871)                   | `2026-09-18T17:06:55.529Z` | `0928de0dadf5ec75d0ecaf285690d6180cc2d4722f1bc8e016e46d0fe7a0a324` |

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
- **mmnto-ai/totem#2871** (the discharge specimen, mmnto-ai/totem#2861) — 17 check runs
  under 16 names, all SUCCESS: `Auto-close required check (D1)` ran twice on the head
  (ids `103790771534` and `103803324012`, both SUCCESS), so the 2026-09-18 re-capture is
  also a live specimen of the latest-run judgment (mmnto-ai/totem#2879) — `checks.total`
  16, `superseded` 1, the later id judging; seven bot threads, six of them OUTDATED and unresolved (their anchors moved
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

All synthesized `2026-09-08T03:55:11.894Z`, except the three fold-round-2 rows
(`2026-09-08T05:42:31.591Z`) and the two fold-round-3 rows
(`2026-09-08T06:26:38.783Z` and `2026-09-08T06:25:27.919Z`) and the four fold-round-4 rows
(`2026-09-08T07:05:39.879Z`) and the five PR-round-1 rows (`2026-09-08T21:08:06.765Z`,
mmnto-ai/totem#2844) and the eleven mmnto-ai/totem#2861 rows — seven at
`2026-09-16T00:47:11.787Z` (all new), three at `2026-09-16T01:17:05.889Z` for the fold that
added the disposition line (the negative control and the bare-resolve window fixture
re-authored, the discharged-window fixture created), and one at `2026-09-16T02:50:30.916Z`
for the ruled fold (the missing-root-id fixture) — at the end of the table. Each covers an
invariant the captures cannot.

| File                                                      | Invariant                                                                                                                                                                                                                                    | sha256                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`                        | `CLEAN` passes; no bot review passes 2–4 as a fact                                                                                                                                                                                           | `4be58f37f0e33a794232c504f37bc90f3c4161fe90d8c1da9d87225203e1830e` |
| `synthetic-merge-state-has-hooks.json`                    | `HAS_HOOKS` passes                                                                                                                                                                                                                           | `b25916e58f3388c9e1e6b939a510a337730cb3a659213e105462cf3d8aa5984a` |
| `synthetic-merge-state-unstable.json`                     | `UNSTABLE` passes (a red non-required check is predicate 1's)                                                                                                                                                                                | `24abd1820e229aa4b356f72ddf276500f02ff80827f320f615eaf5ec6be98038` |
| `synthetic-merge-state-behind.json`                       | `BEHIND` denies                                                                                                                                                                                                                              | `611dc64d2a08c46268058f8df05e0a82f6d041cc84edfbefb729d1a6ad8a18e2` |
| `synthetic-merge-state-dirty.json`                        | `DIRTY` denies                                                                                                                                                                                                                               | `7291459e2e6a5207949c7405a8da66771678451d763ddeef1b6d0f4f23c62408` |
| `synthetic-merge-state-blocked.json`                      | `BLOCKED` denies                                                                                                                                                                                                                             | `3a67e5c19732454226030b1499608f5d21659a1731659efb07d8d5af04ff3826` |
| `synthetic-merge-state-draft.json`                        | `DRAFT` denies                                                                                                                                                                                                                               | `2e9d122721a7713005f1c469662f6112dc9efdf3ad65f3b2b68424fe9baf855c` |
| `synthetic-merge-state-unknown.json`                      | `UNKNOWN` is unevaluable (strict deny / pilot warn)                                                                                                                                                                                          | `61d1791c5abd46cb90dae3111d8051e1932c95168930686a68c71bbb7fbe4dd3` |
| `synthetic-merge-state-unrecognised.json`                 | a status this gate does not read is unevaluable, never allow                                                                                                                                                                                 | `302372bcb1ab5396dcb47dedff5f988708d6bd0031ae60d78921dc858f4a366c` |
| `synthetic-zero-checks.json`                              | R5 — zero checks passes as a fact, with the count and one line                                                                                                                                                                               | `66d15b0d2922983cc3440e4107fd1ee383d032c8f4db94406eea13b9abf346ba` |
| `synthetic-failing-check.json`                            | a failing check denies at predicate 1                                                                                                                                                                                                        | `5bea25be9f822f3ecb7d8e59f049d3e51d271f602ed41e8cb2f2be09e16dbf1c` |
| `synthetic-pending-check.json`                            | a still-running check denies at predicate 1                                                                                                                                                                                                  | `270efcdec7ce675b37d654c4b39c328b1d9cfaac2f902328c06fad90497c7d9b` |
| `synthetic-rollup-commit-mismatch.json`                   | F7 — a rollup off another commit is unevaluable, never green                                                                                                                                                                                 | `f6d48760ec161d1b4f2bda00a3276ee50cd862e9ebc67f406ad585ed23775219` |
| `synthetic-no-commits.json`                               | F7 — no commits answered: the head rollup is unreadable                                                                                                                                                                                      | `0e148fa1c4d8033b9120860980ecef74036bcdfb722c22d56039c97e1b37f11f` |
| `synthetic-rollup-no-contexts.json`                       | F7 — a rollup with no contexts connection is not the zero-checks fact                                                                                                                                                                        | `be30068e3b11de5016e6e55d21de72c3185abf1c4479fea130c99090c0087e99` |
| `synthetic-rollup-state-without-checks.json`              | F7 — `PENDING` over zero listed checks is unreadable, not R5                                                                                                                                                                                 | `5db28fa398dd59bbe441c5dafcc266e891446f483b2be72ce752cd5825ca98d3` |
| `synthetic-rollup-state-null.json`                        | R2 F3 — a null rollup state over zero checks is unevaluable, not R5                                                                                                                                                                          | `2513e7f7740d4d04403225f29b138c77de7408c321b8df9b2e15b3e3f29bd85c` |
| `synthetic-rollup-state-non-string.json`                  | R2 F3 — a non-string rollup state over zero checks is unevaluable                                                                                                                                                                            | `e855f687f3ff047c294c8e8dcc0f3a2b693745643111d5bb39f720a7d24c9788` |
| `synthetic-high-inline-null-commit.json`                  | R2 F8 — a bot HIGH inline with a null commit is unevaluable, named                                                                                                                                                                           | `5d3705bd9f9838b129d4fc41482c31618a894242134fa1eb4d0926c4a5b23341` |
| `synthetic-rollup-count-without-checks.json`              | R3 F9 — SUCCESS with `totalCount: 3` over an empty list is unevaluable                                                                                                                                                                       | `fe5bd1af38fd7d3bf60711e08c0c8a08380debd18948a79ed7b09e186aa3fcc6` |
| `synthetic-benign-fenced-marker-quote.json`               | R3 F4 — a Minor whose FENCE quotes the gate's markers reads NOT high                                                                                                                                                                         | `38f3e306d9dc9f25260aaae12c223a7bf57f92f9ffa0d98f32a1641acc0ffd32` |
| `synthetic-rollup-count-string.json`                      | R4 F3 — a string `totalCount` is not a count: unevaluable                                                                                                                                                                                    | `476bdc0e602ce0465b3d5d592ec8920fb16c5d74b689b462e62377a8b6ade21f` |
| `synthetic-rollup-count-negative.json`                    | R4 F3 — a negative `totalCount` is not a count: unevaluable                                                                                                                                                                                  | `8cd319059f3ff4212794992406f336a2632ac794818be24fa01d50b0ecc88dcd` |
| `synthetic-rollup-count-boolean.json`                     | R4 F3 — a boolean `totalCount` is not a count: unevaluable                                                                                                                                                                                   | `5fd985c7ae90517681e8c28225dd11d8b0187530fe0aaee8bcbd7a85f05e481a` |
| `synthetic-rollup-count-mismatch.json`                    | R4 F3 — 3 claimed, 1 materialised: an incomplete read, unevaluable                                                                                                                                                                           | `733a30001c16bc4e308bf7156e53ae5bf4f9b725f43d2c2d4e66058fbf2b3768` |
| `synthetic-unresolved-bot-thread.json`                    | an unresolved, non-outdated bot thread denies                                                                                                                                                                                                | `303ad0edd6e80359d6bd98fd9a58d7c6ceeedad0f7c83273421454bfb4c637fe` |
| `synthetic-resolved-outdated-human-threads.json`          | resolved / outdated / HUMAN threads never deny                                                                                                                                                                                               | `7dff6aeab576f5b216d0ed84bd56bab90624a6ce70e997543db954a556f64683` |
| `synthetic-stale-commit-high-inline.json`                 | F2 — a HIGH inline applying to an OLDER commit does not deny                                                                                                                                                                                 | `6b91b64408f5a7d95e155a5fd6d7b77dc11dfe260b42c171db9fff5498eb1063` |
| `synthetic-head-commit-high-inline.json`                  | 2861 — the NEGATIVE CONTROL, field shape: a bare-resolved HIGH on head still denies under later chatter and another thread's disposition                                                                                                     | `d0a82a1d714e396d9207a2b12c41b43749725fab4c9dfe6784262fd1cd0dddda` |
| `synthetic-coderabbit-potential-issue.json`               | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker                                                                                                                                                                                   | `cd9f292422d381bc914c6fdc8012e80d4497f8ccb8f8596c482cbde522b6ce8b` |
| `synthetic-changes-requested-standing.json`               | F6 — a later COMMENTED from the same reviewer does not supersede                                                                                                                                                                             | `10eb142d8194494f326b5540b1725098c8f9e761e9d7b56cc4f49cc488050c07` |
| `synthetic-changes-requested-superseded.json`             | a later `APPROVED` supersedes                                                                                                                                                                                                                | `6eb29d09288498f311942c25c9357a0ba047f74f650929de9e4f374ca5491d18` |
| `synthetic-pagination-second-page-deny.json`              | a clean first page + a dirty SECOND page denies                                                                                                                                                                                              | `9d97c83f181545a889eeb74a76e85c5e706312ee9a0e6cff5555f9fd34fc8fc0` |
| `synthetic-pagination-second-page-fails.json`             | a pagination failure is unevaluable, not clean                                                                                                                                                                                               | `b3574b71aaabe7e4bb0cd9641c4c5ce6283d41dbfad4ea84d0868ec0efa22848` |
| `synthetic-head-moved.json`                               | a head sha that moved between pages is unevaluable                                                                                                                                                                                           | `2d1dbd5cdb907b2972532fb4dc1f44ef5bf80a00e174954927e6ad9b960dc394` |
| `synthetic-rate-limit-exit.json`                          | a non-zero gh exit is unevaluable, naming what gh said                                                                                                                                                                                       | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`                       | a GraphQL error in a 200 body is a failed read                                                                                                                                                                                               | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                                | gh missing / unauthenticated is unevaluable at both tiers                                                                                                                                                                                    | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`                        | `pr: null` + branch resolves via the branch-keyed document                                                                                                                                                                                   | `6c0f6acddb9dd484f2c35243e9ae010abcff38703b64ebf31b2b694515410895` |
| `synthetic-reviews-connection-missing.json`               | PR round 1 — NO `reviews` connection is unreadable, never an empty list                                                                                                                                                                      | `dde88b37d7e6ffb83de08ccb8d231850239f2fe431267465aaece798e0168149` |
| `synthetic-threads-connection-missing.json`               | PR round 1 — NO `reviewThreads` connection is unreadable, never empty                                                                                                                                                                        | `e84ea619c0b4acca6a8c4173e76d7cb40029d589bb1973ee6e7da9a1886a262b` |
| `synthetic-threads-pageinfo-missing.json`                 | PR round 1 — a threads connection with NO `pageInfo` is never complete                                                                                                                                                                       | `41064d78732610d504f62e98164e55fab3713fa606f0bde5f5eff3a3b3991adc` |
| `synthetic-failing-check-and-null-commit-high.json`       | PR round 1 — a failing check beside a null-commit HIGH DENIES, both tiers                                                                                                                                                                    | `5c5429557d3cea30139bb753c18934c8d01d1257564590f654469242f439fa31` |
| `synthetic-merge-state-behind-and-null-commit-high.json`  | PR round 1 — BEHIND beside a null-commit HIGH is unevaluable (4 before 5)                                                                                                                                                                    | `6e97e982b3c8e8dfd01002f5865884a49cbb81822bb9745579a1f26eec6077f6` |
| `synthetic-high-inline-discharged-pr-level.json`          | 2861 — a resolved HIGH on head + a non-bot PR-level comment after the root: discharged                                                                                                                                                       | `8ebc97a7670a27cc9e99a9c2e96f666d3c4995b07e2470f2e55ffc238795a82c` |
| `synthetic-high-inline-discharged-in-thread.json`         | 2861 — a resolved HIGH on head + a non-bot in-thread reply, no PR comment: discharged                                                                                                                                                        | `fd0e59d972873eafa9753fb44e3b8d77d42cf06ed15bbd7ee1bab092a0dd4ceb` |
| `synthetic-high-inline-deleted-author-reply.json`         | 2861 — a deleted-account (null author) reply is a human reply: discharged                                                                                                                                                                    | `602946d4d2186f4f9f3bc9f5c420aadaaa5fa52807ea5c7a587feafe14569291` |
| `synthetic-high-inline-unresolved-with-disposition.json`  | 2861 — UNRESOLVED + a disposition is not discharged: predicate 2, highInline 1                                                                                                                                                               | `01928492ad5424af0d9d9652d93f13b62300983579a925baba7839784d20516e` |
| `synthetic-high-inline-mixed-discharge.json`              | 2861 — per-thread: one discharged beside one bare denies naming the bare one                                                                                                                                                                 | `5926bba41fc52b44f7cd5884fa637aaad2ebbdb34f82f6e6f4a12a9d7f623872` |
| `synthetic-comments-second-page-evidence.json`            | 2861 — the PR-level evidence on the SECOND comments page, cursor sent                                                                                                                                                                        | `6f1ae52313fbf5dac6270856c0df8b1a6835dcd4fd43d545df57022bf4b94731` |
| `synthetic-high-inline-resolved-window-incomplete.json`   | 2861 — a resolved HIGH with more comments than the window and no evidence read DENIES at both tiers, naming the window                                                                                                                       | `573851720cb6fa9bc0d847186595bba8d318fa41f02bd44d009fa3f4c9db1dab` |
| `synthetic-high-inline-root-id-missing.json`              | 2861 — a root with no readable databaseId is a thread no line can name: it stays applying, the page stays readable                                                                                                                           | `6462931885c2548ce214b713f06201e357715aaec606388143829b0b8ea181a3` |
| `synthetic-high-inline-discharged-window-incomplete.json` | 2861 — evidence FOUND discharges even when the window is incomplete (pins the invariant; kills the completeness-first mutant)                                                                                                                | `88ec27c2fb1d9f53ce5ed6a4d53ce7babb44beb841db34019dae694917a3bb43` |
| `synthetic-comments-connection-missing.json`              | 2861 — NO PR `comments` connection is unreadable, never "no evidence"                                                                                                                                                                        | `4b99ab3d318bc2532951e0db30445ff60a1a3f3ad523a4dfa515831a4c4e2cde` |
| `synthetic-check-cancelled-after-success.json`            | mmnto-ai/totem#2879 - a success and then a LATER cancelled run of the same name (greater databaseId listed second): the latest run is CANCELLED, predicate 1 denies naming the check; the earlier success does not stand in                  | `0b1eaae3dd8499a97bd941420f8453a3af8440fbff7d9a21037c7219479bb728` |
| `synthetic-check-duplicate-id-missing.json`               | mmnto-ai/totem#2879 - two runs of one name where one carries databaseId null: the latest cannot be derived, the check state is unreadable (unevaluable at both tiers), never the first or the last one listed                                | `c93337023c058574c6d2a96921f56892430cd3c9ed44f53481a0b6b52b8a9fe1` |
| `synthetic-check-single-cancelled.json`                   | mmnto-ai/totem#2879 - the negative that must keep denying: ONE cancelled run with no later run of its name is a check that did not pass                                                                                                      | `7a8ad06bdff3ca3383c742ee0ad54e1a3f8dee85be503b86be657471c0874d21` |
| `synthetic-check-superseded-cancelled.json`               | mmnto-ai/totem#2879 - a concurrency-cancelled run beside the LATER success of the same name, the later run LISTED FIRST as GitHub lists them: predicate 1 judges the latest run (greatest databaseId), passes, and counts the superseded run | `509aecae0daacd522a7ae6b533e34a994baee30b6bf4a1dd4cf76594974ed014` |

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
