# merge-ready fixtures (mmnto-ai/totem#2800, ruling R4)

Every file here answers the injected `GhRunner` seam in place of the network, so
`merge-ready.test.ts` never calls GitHub. FIVE files are REAL captures — four pull
requests plus the benign corpus that measures the severity read's false-positive budget —
and the rest are synthetic, saying so in their name and in their `"kind"` field.

All of them were re-made in the fold round: the query now asks for `comment.commit { oid }`
(fold F2 — the commit a finding CURRENTLY applies to, beside the `originalCommit` it was
written against), so every capture and every synthetic body carries the new shape.

They were re-made again for the predicate-4 discharge (mmnto-ai/totem#2861): the query now
selects the EVIDENCE fields — `pageInfo`, `createdAt` and `author { __typename }` on every
thread comment, and a fourth paginated connection, the PR-level `comments`, with `author`,
`body` and `createdAt` per node (the body carries the review-reply `local-lane:` line that
marks a disposition — the fold the first falsification leg forced, when post-dating alone
let any later human comment discharge a bare resolve). The four PR captures were
re-captured with the final query on 2026-09-16 (the corpus is not a page capture and the
severity read did not change, so it stands), and every synthetic body was reshaped to
carry the fields at `2026-09-16T00:40:43.010Z` — `synthesizedAt` keeps the instant each
invariant was authored; the reshape added fields and changed no verdict.

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
`b3529cea002006457eb6de269c47d5817a876cdb4bcbf7812db7f194279d3c0a` — re-derived from the
exported constant by the receipts test, so a query change that skips a re-capture fails
there. `gh version 2.99.0
(2026-09-01)` answered all four.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-16T01:17:29.000Z` | `1a3abc1f6c7e00223a702dc67f77d593cb1fd2fa929be1488f1c5a066b92f00e` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-16T01:17:32.105Z` | `fd08707e6c746d4f92e94e394c5de8e9f032567c0cd5aafbc6ab00fc7b5f3e17` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-16T01:17:35.512Z` | `a658a694038d71daf36332d90bb1733c4f4339d1965edde483358ad12a1f0734` |
| `totem-2871.json`          | [mmnto-ai/totem#2871](https://github.com/mmnto-ai/totem/pull/2871)                   | `2026-09-16T01:17:38.911Z` | `2d411f1353c3ee6e53bb9332baa86646c487300e3a42a0412c52c04065d032c5` |

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
  head (`a1e89aac…`), declined with reason in the round's consolidated disposition — the
  one non-bot PR-level comment created after the root, and it carries the review-reply
  `local-lane:` line — and resolved by `totem resolve-threads 2871 --apply`. Before the
  cure this read `deny · high-severity-inline · highInline 1` (the calibration row on the
  issue); it now reads `highInline 0`, `dischargedHigh 1` (`prLevelDisposition 1`), with
  the discharge named on stderr, and lands on the UNKNOWN-mergeability arm — reachable
  only when predicates 1–4 have passed.

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
mmnto-ai/totem#2844) and the ten mmnto-ai/totem#2861 rows — seven at
`2026-09-16T00:47:11.787Z` (six new and the negative control re-authored), and three at
`2026-09-16T01:17:05.889Z` for the fold that added the disposition line (the bare-resolve
window fixture and the negative control re-authored, and the discharged-window fixture
created) — at the end of the table. Each covers an invariant the captures cannot.

| File                                                      | Invariant                                                                                                                     | sha256                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`                        | `CLEAN` passes; no bot review passes 2–4 as a fact                                                                            | `8136afa01f76bd04ed3e0a3f8690349a2b70ce3f20f05b4077cba6833aded1ed` |
| `synthetic-merge-state-has-hooks.json`                    | `HAS_HOOKS` passes                                                                                                            | `8a1b69d9aa25d13982506b1a7ef04d4a1678644c1b4d1713ab8df281483e44ea` |
| `synthetic-merge-state-unstable.json`                     | `UNSTABLE` passes (a red non-required check is predicate 1's)                                                                 | `dafb78bc277634c8676c3f5c21bcb4c5b67951ace6d09872fe993e22fa06575c` |
| `synthetic-merge-state-behind.json`                       | `BEHIND` denies                                                                                                               | `658ce49ae31029acf909dae110eca1c25307e9de51b058f3d083269d1e1607a0` |
| `synthetic-merge-state-dirty.json`                        | `DIRTY` denies                                                                                                                | `f37b6fc90cdd565c85f62226d18df9e72d79becf7c417a549fd0bd525312822b` |
| `synthetic-merge-state-blocked.json`                      | `BLOCKED` denies                                                                                                              | `e08fd11ecd6bebc232915fd3b66a92a4f3bfdfc44c6352a4b26db098d46ff531` |
| `synthetic-merge-state-draft.json`                        | `DRAFT` denies                                                                                                                | `16e3d7e86aaf18a8e9b671bb766a15293a1b3569ddd0ce516d50f68d3da05772` |
| `synthetic-merge-state-unknown.json`                      | `UNKNOWN` is unevaluable (strict deny / pilot warn)                                                                           | `2319fedcf3a745ff0ef17d8744e06505d327069f09b267495f54b3d7d929d5b2` |
| `synthetic-merge-state-unrecognised.json`                 | a status this gate does not read is unevaluable, never allow                                                                  | `2fd4497489b2076145eb94e36ce0aeab1a4da57f75d4acd8b36ad5f7dccdb2cc` |
| `synthetic-zero-checks.json`                              | R5 — zero checks passes as a fact, with the count and one line                                                                | `66d15b0d2922983cc3440e4107fd1ee383d032c8f4db94406eea13b9abf346ba` |
| `synthetic-failing-check.json`                            | a failing check denies at predicate 1                                                                                         | `468ec8090ae9b2864c2d41fba3381ebb8d5d49ccbb4c3d9b8c6bab014cb47af1` |
| `synthetic-pending-check.json`                            | a still-running check denies at predicate 1                                                                                   | `16eee29f522addf9cd2cbd6533a5847c5009a827056115d9699fae03c89cd15b` |
| `synthetic-rollup-commit-mismatch.json`                   | F7 — a rollup off another commit is unevaluable, never green                                                                  | `c9332e995e6f7d032509f4cb8c51523d2cd6890f9a44797e4e1ffb1b0a81c57d` |
| `synthetic-no-commits.json`                               | F7 — no commits answered: the head rollup is unreadable                                                                       | `0e148fa1c4d8033b9120860980ecef74036bcdfb722c22d56039c97e1b37f11f` |
| `synthetic-rollup-no-contexts.json`                       | F7 — a rollup with no contexts connection is not the zero-checks fact                                                         | `be30068e3b11de5016e6e55d21de72c3185abf1c4479fea130c99090c0087e99` |
| `synthetic-rollup-state-without-checks.json`              | F7 — `PENDING` over zero listed checks is unreadable, not R5                                                                  | `5db28fa398dd59bbe441c5dafcc266e891446f483b2be72ce752cd5825ca98d3` |
| `synthetic-rollup-state-null.json`                        | R2 F3 — a null rollup state over zero checks is unevaluable, not R5                                                           | `2513e7f7740d4d04403225f29b138c77de7408c321b8df9b2e15b3e3f29bd85c` |
| `synthetic-rollup-state-non-string.json`                  | R2 F3 — a non-string rollup state over zero checks is unevaluable                                                             | `e855f687f3ff047c294c8e8dcc0f3a2b693745643111d5bb39f720a7d24c9788` |
| `synthetic-high-inline-null-commit.json`                  | R2 F8 — a bot HIGH inline with a null commit is unevaluable, named                                                            | `ea38052619e3f330dbb9e9aa9c17abf4da43e4701883f671ec6d8d8cd185bae4` |
| `synthetic-rollup-count-without-checks.json`              | R3 F9 — SUCCESS with `totalCount: 3` over an empty list is unevaluable                                                        | `fe5bd1af38fd7d3bf60711e08c0c8a08380debd18948a79ed7b09e186aa3fcc6` |
| `synthetic-benign-fenced-marker-quote.json`               | R3 F4 — a Minor whose FENCE quotes the gate's markers reads NOT high                                                          | `38f3e306d9dc9f25260aaae12c223a7bf57f92f9ffa0d98f32a1641acc0ffd32` |
| `synthetic-rollup-count-string.json`                      | R4 F3 — a string `totalCount` is not a count: unevaluable                                                                     | `476bdc0e602ce0465b3d5d592ec8920fb16c5d74b689b462e62377a8b6ade21f` |
| `synthetic-rollup-count-negative.json`                    | R4 F3 — a negative `totalCount` is not a count: unevaluable                                                                   | `8cd319059f3ff4212794992406f336a2632ac794818be24fa01d50b0ecc88dcd` |
| `synthetic-rollup-count-boolean.json`                     | R4 F3 — a boolean `totalCount` is not a count: unevaluable                                                                    | `5fd985c7ae90517681e8c28225dd11d8b0187530fe0aaee8bcbd7a85f05e481a` |
| `synthetic-rollup-count-mismatch.json`                    | R4 F3 — 3 claimed, 1 materialised: an incomplete read, unevaluable                                                            | `dbb3c5247437e1288d3ecb28173f0b1bb30041c8bf2c0f22ff360eabd3cdee27` |
| `synthetic-unresolved-bot-thread.json`                    | an unresolved, non-outdated bot thread denies                                                                                 | `7c649806438da9aed8e8dee3a66e2b3cfa6b9448456d46f0628dad1b2f879c40` |
| `synthetic-resolved-outdated-human-threads.json`          | resolved / outdated / HUMAN threads never deny                                                                                | `888e8463fcbdf3a3f842ef397da197208efd26ad315d301ce2d6a39863e52446` |
| `synthetic-stale-commit-high-inline.json`                 | F2 — a HIGH inline applying to an OLDER commit does not deny                                                                  | `36f5aa2491f589458b3154cd93b6bcf2ab9fb3ffa26d4bf6db77c1514b629fc6` |
| `synthetic-head-commit-high-inline.json`                  | 2861 — the NEGATIVE CONTROL, field shape: a bare-resolved HIGH on head still denies under later human chatter                 | `1de33ab218023205ec3798258e712a0cd1e17853199e98af810786b010b8e007` |
| `synthetic-coderabbit-potential-issue.json`               | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker                                                                    | `0bfb9e486f7b63ba19b34595e10e96a78a16aaf372214c8c7e508cef60811667` |
| `synthetic-changes-requested-standing.json`               | F6 — a later COMMENTED from the same reviewer does not supersede                                                              | `35fd5c9bf0135d4f6ccf4aecda8c491e229bb7549cd873d954ed3ebad1b30a39` |
| `synthetic-changes-requested-superseded.json`             | a later `APPROVED` supersedes                                                                                                 | `d601ccfaab99d314757f3b873472930a8508e0328463b6f0b8db7610a65dd720` |
| `synthetic-pagination-second-page-deny.json`              | a clean first page + a dirty SECOND page denies                                                                               | `9c3c5b6514eec535757793a56439e67186c46f04925f677b6a0a680bf411a3db` |
| `synthetic-pagination-second-page-fails.json`             | a pagination failure is unevaluable, not clean                                                                                | `d29b58119dca858c816c4cc0ef67fbdf5100157249bee9abea235216655e00e1` |
| `synthetic-head-moved.json`                               | a head sha that moved between pages is unevaluable                                                                            | `85d47a690695eccc2001cbdcda01d7dfe595399c7653cae49fcb77ad908697c9` |
| `synthetic-rate-limit-exit.json`                          | a non-zero gh exit is unevaluable, naming what gh said                                                                        | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`                       | a GraphQL error in a 200 body is a failed read                                                                                | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                                | gh missing / unauthenticated is unevaluable at both tiers                                                                     | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`                        | `pr: null` + branch resolves via the branch-keyed document                                                                    | `cb35d902e84b451db9a97aae771aed73e6e793f79d35ae0dc3f66a115215c683` |
| `synthetic-reviews-connection-missing.json`               | PR round 1 — NO `reviews` connection is unreadable, never an empty list                                                       | `726154fd448f8cee33f13d0c8ce924c01b90f90ebc1803b412569f029a21e7a4` |
| `synthetic-threads-connection-missing.json`               | PR round 1 — NO `reviewThreads` connection is unreadable, never empty                                                         | `19ce999272b4174ec85a815d6e448d58e29e97f3ee059b731ab5d996dfff8b01` |
| `synthetic-threads-pageinfo-missing.json`                 | PR round 1 — a threads connection with NO `pageInfo` is never complete                                                        | `3d198f5ecf86f8b6992f0958645e89e84c77baea5ff99670d0a126380d55158a` |
| `synthetic-failing-check-and-null-commit-high.json`       | PR round 1 — a failing check beside a null-commit HIGH DENIES, both tiers                                                     | `8b125551aa4bf3d6bb5412bebc53e3652d2d7b88ac615c23ea3947299b178d00` |
| `synthetic-merge-state-behind-and-null-commit-high.json`  | PR round 1 — BEHIND beside a null-commit HIGH is unevaluable (4 before 5)                                                     | `3cc1fb7e0bf9526eafa157fdf5a51ce717e69564779d21e8db569d618545706d` |
| `synthetic-high-inline-discharged-pr-level.json`          | 2861 — a resolved HIGH on head + a non-bot PR-level comment after the root: discharged                                        | `2950bed3c146849cd485e4536559621b23e2d7b2ed9f6d7601db96b84681eb78` |
| `synthetic-high-inline-discharged-in-thread.json`         | 2861 — a resolved HIGH on head + a non-bot in-thread reply, no PR comment: discharged                                         | `6e0265e357245b4f43293febcbfd789cd13ce1eacf06a8858a3b06cf30ed8e3c` |
| `synthetic-high-inline-deleted-author-reply.json`         | 2861 — a deleted-account (null author) reply is a human reply: discharged                                                     | `1996d25a3d9655d0255c2ac78234456768e5bd30c6026b61ff802386aab3eb05` |
| `synthetic-high-inline-unresolved-with-disposition.json`  | 2861 — UNRESOLVED + a disposition is not discharged: predicate 2, highInline 1                                                | `9da4e27a1ab2e873f549e9d1791099f8d375901af14c592e397b126c86a518a2` |
| `synthetic-high-inline-mixed-discharge.json`              | 2861 — per-thread: one discharged beside one bare denies naming the bare one                                                  | `a61c2bf24fea83a78c5ac533228084784c7d4e0d4771a8a3f31f515aa8b6b731` |
| `synthetic-comments-second-page-evidence.json`            | 2861 — the PR-level evidence on the SECOND comments page, cursor sent                                                         | `7289331fb6126341c82837e4874fac2b082240db36f6234e8fc2dff0b57eb917` |
| `synthetic-high-inline-resolved-window-incomplete.json`   | 2861 — a resolved HIGH with more comments than the window and no evidence read DENIES at both tiers, naming the window        | `f22c13ad9f8705ac5fb0f9a3dfb05f99754ba4cad2811e84749518fe80cf505b` |
| `synthetic-high-inline-discharged-window-incomplete.json` | 2861 — evidence FOUND discharges even when the window is incomplete (pins the invariant; kills the completeness-first mutant) | `826ac5b27db2d15079875babe57b6d14758bee26e984074a2fa72aba9ec8b041` |
| `synthetic-comments-connection-missing.json`              | 2861 — NO PR `comments` connection is unreadable, never "no evidence"                                                         | `2a2ffde7bf968bb3753a5e0504b5f08b4cf244fda6072e6c08c74e7d0c33f158` |

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
