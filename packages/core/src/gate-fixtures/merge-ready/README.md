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
`4c72b6fed0035503fa6ef1bac93984df887bf89d3854ae852c7b2669dcabc85e` — re-derived from the
exported constant by the receipts test, so a query change that skips a re-capture fails
there. `gh version 2.99.0
(2026-09-01)` answered all four.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-16T02:22:48.944Z` | `c5a1400cc3a7c3f00fce01f8a80131d2d1f8c2f868d431e0a5061269f5acf7cf` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-16T02:22:50.097Z` | `45d992dd8dfc2a674753d681d4052b8171d915ce291815bdbfbd7a49f8e9e4ef` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-16T02:22:51.362Z` | `56893a9e3d143ec0e6a0ca28e3b31bf61153a3a44f8005c0294317c216838110` |
| `totem-2871.json`          | [mmnto-ai/totem#2871](https://github.com/mmnto-ai/totem/pull/2871)                   | `2026-09-16T02:22:52.539Z` | `fa51af335da96e531c5e8614e9e883a1a50b0d9dff532455befc00315eeeab5e` |

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
- **mmnto-ai/totem#2871** (the discharge specimen, mmnto-ai/totem#2861) — 17 checks, all
  SUCCESS; seven bot threads, six of them OUTDATED and unresolved (their anchors moved
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

| File                                                      | Invariant                                                                                                                                | sha256                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`                        | `CLEAN` passes; no bot review passes 2–4 as a fact                                                                                       | `8136afa01f76bd04ed3e0a3f8690349a2b70ce3f20f05b4077cba6833aded1ed` |
| `synthetic-merge-state-has-hooks.json`                    | `HAS_HOOKS` passes                                                                                                                       | `8a1b69d9aa25d13982506b1a7ef04d4a1678644c1b4d1713ab8df281483e44ea` |
| `synthetic-merge-state-unstable.json`                     | `UNSTABLE` passes (a red non-required check is predicate 1's)                                                                            | `dafb78bc277634c8676c3f5c21bcb4c5b67951ace6d09872fe993e22fa06575c` |
| `synthetic-merge-state-behind.json`                       | `BEHIND` denies                                                                                                                          | `658ce49ae31029acf909dae110eca1c25307e9de51b058f3d083269d1e1607a0` |
| `synthetic-merge-state-dirty.json`                        | `DIRTY` denies                                                                                                                           | `f37b6fc90cdd565c85f62226d18df9e72d79becf7c417a549fd0bd525312822b` |
| `synthetic-merge-state-blocked.json`                      | `BLOCKED` denies                                                                                                                         | `e08fd11ecd6bebc232915fd3b66a92a4f3bfdfc44c6352a4b26db098d46ff531` |
| `synthetic-merge-state-draft.json`                        | `DRAFT` denies                                                                                                                           | `16e3d7e86aaf18a8e9b671bb766a15293a1b3569ddd0ce516d50f68d3da05772` |
| `synthetic-merge-state-unknown.json`                      | `UNKNOWN` is unevaluable (strict deny / pilot warn)                                                                                      | `2319fedcf3a745ff0ef17d8744e06505d327069f09b267495f54b3d7d929d5b2` |
| `synthetic-merge-state-unrecognised.json`                 | a status this gate does not read is unevaluable, never allow                                                                             | `2fd4497489b2076145eb94e36ce0aeab1a4da57f75d4acd8b36ad5f7dccdb2cc` |
| `synthetic-zero-checks.json`                              | R5 — zero checks passes as a fact, with the count and one line                                                                           | `66d15b0d2922983cc3440e4107fd1ee383d032c8f4db94406eea13b9abf346ba` |
| `synthetic-failing-check.json`                            | a failing check denies at predicate 1                                                                                                    | `468ec8090ae9b2864c2d41fba3381ebb8d5d49ccbb4c3d9b8c6bab014cb47af1` |
| `synthetic-pending-check.json`                            | a still-running check denies at predicate 1                                                                                              | `16eee29f522addf9cd2cbd6533a5847c5009a827056115d9699fae03c89cd15b` |
| `synthetic-rollup-commit-mismatch.json`                   | F7 — a rollup off another commit is unevaluable, never green                                                                             | `c9332e995e6f7d032509f4cb8c51523d2cd6890f9a44797e4e1ffb1b0a81c57d` |
| `synthetic-no-commits.json`                               | F7 — no commits answered: the head rollup is unreadable                                                                                  | `0e148fa1c4d8033b9120860980ecef74036bcdfb722c22d56039c97e1b37f11f` |
| `synthetic-rollup-no-contexts.json`                       | F7 — a rollup with no contexts connection is not the zero-checks fact                                                                    | `be30068e3b11de5016e6e55d21de72c3185abf1c4479fea130c99090c0087e99` |
| `synthetic-rollup-state-without-checks.json`              | F7 — `PENDING` over zero listed checks is unreadable, not R5                                                                             | `5db28fa398dd59bbe441c5dafcc266e891446f483b2be72ce752cd5825ca98d3` |
| `synthetic-rollup-state-null.json`                        | R2 F3 — a null rollup state over zero checks is unevaluable, not R5                                                                      | `2513e7f7740d4d04403225f29b138c77de7408c321b8df9b2e15b3e3f29bd85c` |
| `synthetic-rollup-state-non-string.json`                  | R2 F3 — a non-string rollup state over zero checks is unevaluable                                                                        | `e855f687f3ff047c294c8e8dcc0f3a2b693745643111d5bb39f720a7d24c9788` |
| `synthetic-high-inline-null-commit.json`                  | R2 F8 — a bot HIGH inline with a null commit is unevaluable, named                                                                       | `da2e857ed96f0be8aab2552b59267f93acebe2a703c4114c3bff5d853ae2cc3b` |
| `synthetic-rollup-count-without-checks.json`              | R3 F9 — SUCCESS with `totalCount: 3` over an empty list is unevaluable                                                                   | `fe5bd1af38fd7d3bf60711e08c0c8a08380debd18948a79ed7b09e186aa3fcc6` |
| `synthetic-benign-fenced-marker-quote.json`               | R3 F4 — a Minor whose FENCE quotes the gate's markers reads NOT high                                                                     | `38f3e306d9dc9f25260aaae12c223a7bf57f92f9ffa0d98f32a1641acc0ffd32` |
| `synthetic-rollup-count-string.json`                      | R4 F3 — a string `totalCount` is not a count: unevaluable                                                                                | `476bdc0e602ce0465b3d5d592ec8920fb16c5d74b689b462e62377a8b6ade21f` |
| `synthetic-rollup-count-negative.json`                    | R4 F3 — a negative `totalCount` is not a count: unevaluable                                                                              | `8cd319059f3ff4212794992406f336a2632ac794818be24fa01d50b0ecc88dcd` |
| `synthetic-rollup-count-boolean.json`                     | R4 F3 — a boolean `totalCount` is not a count: unevaluable                                                                               | `5fd985c7ae90517681e8c28225dd11d8b0187530fe0aaee8bcbd7a85f05e481a` |
| `synthetic-rollup-count-mismatch.json`                    | R4 F3 — 3 claimed, 1 materialised: an incomplete read, unevaluable                                                                       | `dbb3c5247437e1288d3ecb28173f0b1bb30041c8bf2c0f22ff360eabd3cdee27` |
| `synthetic-unresolved-bot-thread.json`                    | an unresolved, non-outdated bot thread denies                                                                                            | `90c2d6c062e931f8bf008e86151d365b5fd4e6eb8a50b11807f1b00f4c604516` |
| `synthetic-resolved-outdated-human-threads.json`          | resolved / outdated / HUMAN threads never deny                                                                                           | `02a14bf7c33351b96c2330bf211203f339f4c2bb4912d98cdbb423da211cd758` |
| `synthetic-stale-commit-high-inline.json`                 | F2 — a HIGH inline applying to an OLDER commit does not deny                                                                             | `14824179309f7fd69c66889d2134718a22d3b285b37ae2e39b08e9238da111a6` |
| `synthetic-head-commit-high-inline.json`                  | 2861 — the NEGATIVE CONTROL, field shape: a bare-resolved HIGH on head still denies under later chatter and another thread's disposition | `c59a101503f90a1892e4c43b2636e3695a537559dfb2f2874a2ee521ce64e60e` |
| `synthetic-coderabbit-potential-issue.json`               | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker                                                                               | `2cc684ff0259e9ba0dfb2777aeebaad619518b6d348227f8c7deff4c00ba9c20` |
| `synthetic-changes-requested-standing.json`               | F6 — a later COMMENTED from the same reviewer does not supersede                                                                         | `35fd5c9bf0135d4f6ccf4aecda8c491e229bb7549cd873d954ed3ebad1b30a39` |
| `synthetic-changes-requested-superseded.json`             | a later `APPROVED` supersedes                                                                                                            | `d601ccfaab99d314757f3b873472930a8508e0328463b6f0b8db7610a65dd720` |
| `synthetic-pagination-second-page-deny.json`              | a clean first page + a dirty SECOND page denies                                                                                          | `67a6995d5b1c6e84be395f783dd4c77b06b6b475a7b545d2ca695a5093201c66` |
| `synthetic-pagination-second-page-fails.json`             | a pagination failure is unevaluable, not clean                                                                                           | `f4b14d12ceef93845f4f7ce3a4d638c4b75aec0bd94bcc6ad533239d3974cc5e` |
| `synthetic-head-moved.json`                               | a head sha that moved between pages is unevaluable                                                                                       | `b8eb4645ce3c79e8db23b969ceeca363787c51ebe77476f70032a79f3b4f0b14` |
| `synthetic-rate-limit-exit.json`                          | a non-zero gh exit is unevaluable, naming what gh said                                                                                   | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`                       | a GraphQL error in a 200 body is a failed read                                                                                           | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                                | gh missing / unauthenticated is unevaluable at both tiers                                                                                | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`                        | `pr: null` + branch resolves via the branch-keyed document                                                                               | `cb35d902e84b451db9a97aae771aed73e6e793f79d35ae0dc3f66a115215c683` |
| `synthetic-reviews-connection-missing.json`               | PR round 1 — NO `reviews` connection is unreadable, never an empty list                                                                  | `726154fd448f8cee33f13d0c8ce924c01b90f90ebc1803b412569f029a21e7a4` |
| `synthetic-threads-connection-missing.json`               | PR round 1 — NO `reviewThreads` connection is unreadable, never empty                                                                    | `19ce999272b4174ec85a815d6e448d58e29e97f3ee059b731ab5d996dfff8b01` |
| `synthetic-threads-pageinfo-missing.json`                 | PR round 1 — a threads connection with NO `pageInfo` is never complete                                                                   | `e345f7f2d7a63ae188da7b6c74988b05bf67032c827fe457934492b5f67150c2` |
| `synthetic-failing-check-and-null-commit-high.json`       | PR round 1 — a failing check beside a null-commit HIGH DENIES, both tiers                                                                | `9d7758980817d2e6f6963c321fed657ca1af5160822b9bc88029c4005d8c2db8` |
| `synthetic-merge-state-behind-and-null-commit-high.json`  | PR round 1 — BEHIND beside a null-commit HIGH is unevaluable (4 before 5)                                                                | `f7c664ce6017859e919bb0e0b59a81bf71cb626a0a2fd23d2d4b32015a606f83` |
| `synthetic-high-inline-discharged-pr-level.json`          | 2861 — a resolved HIGH on head + a non-bot PR-level comment after the root: discharged                                                   | `bcaa7c480155e0b2999f1dddcec54dddbdac176c9ab55fbd7670e61ac1ab86d4` |
| `synthetic-high-inline-discharged-in-thread.json`         | 2861 — a resolved HIGH on head + a non-bot in-thread reply, no PR comment: discharged                                                    | `b7a73a078ed8fa64868cf6ee28303babe758bf7d63d1c93926eaca249c38f2dd` |
| `synthetic-high-inline-deleted-author-reply.json`         | 2861 — a deleted-account (null author) reply is a human reply: discharged                                                                | `5be24e8b323f4a244ca8e90d245d407dfb3024bba7e85e5b9ef4184ec1953b3a` |
| `synthetic-high-inline-unresolved-with-disposition.json`  | 2861 — UNRESOLVED + a disposition is not discharged: predicate 2, highInline 1                                                           | `2e103228f9968159bb2df5155e3d77ffdc57ea5e9fbcda61e2606f07aed9aebd` |
| `synthetic-high-inline-mixed-discharge.json`              | 2861 — per-thread: one discharged beside one bare denies naming the bare one                                                             | `2a94d48942ad0667aaa0bb24cddb9050e85007e0263fb3e25426d06d805d1d0c` |
| `synthetic-comments-second-page-evidence.json`            | 2861 — the PR-level evidence on the SECOND comments page, cursor sent                                                                    | `6207e1fe862fc2d02e8cccee859a72ab343c205eafad678868070fe563b9c39b` |
| `synthetic-high-inline-resolved-window-incomplete.json`   | 2861 — a resolved HIGH with more comments than the window and no evidence read DENIES at both tiers, naming the window                   | `c5d93a3d0a0bd7684ae07a73665043bd4c286a60876672032621a78ab4b393a1` |
| `synthetic-high-inline-root-id-missing.json`              | 2861 — a root with no readable databaseId is a thread no line can name: it stays applying, the page stays readable                       | `628e4cce07477a8ed4258d2d2dd8f45a13ad1ad7e0a1e8dec6176d8095480b77` |
| `synthetic-high-inline-discharged-window-incomplete.json` | 2861 — evidence FOUND discharges even when the window is incomplete (pins the invariant; kills the completeness-first mutant)            | `e1b4fb2ef801bdac0a6d4d14c8fd884d22dd2353aa87160178b8b4c8c06ef3f0` |
| `synthetic-comments-connection-missing.json`              | 2861 — NO PR `comments` connection is unreadable, never "no evidence"                                                                    | `2a2ffde7bf968bb3753a5e0504b5f08b4cf244fda6072e6c08c74e7d0c33f158` |

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
