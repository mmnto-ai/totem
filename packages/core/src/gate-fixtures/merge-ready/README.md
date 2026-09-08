# merge-ready fixtures (mmnto-ai/totem#2800, ruling R4)

Every file here answers the injected `GhRunner` seam in place of the network, so
`merge-ready.test.ts` never calls GitHub. Three files are REAL captures; the rest are
synthetic and say so in their name and in their `"kind"` field.

All of them were re-made in the fold round: the query now asks for `comment.commit { oid }`
(fold F2 — the commit a finding CURRENTLY applies to, beside the `originalCommit` it was
written against), so every capture and every synthetic body carries the new shape.

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

## The three captures

Each was taken by running the REAL `evaluateMergeReady` with a runner that spawned `gh`
and teed each response, so the query in the capture is `MERGE_READY_QUERY` from
`packages/core/src/merge-ready.ts` verbatim. sha256 of that query string at capture time:
`f4825687f2c5cf28778f895a82f7c4d575fecda9b0020326e346d48fabe7d7db`. `gh version 2.99.0
(2026-09-01)` answered all three.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-08T03:53:45.077Z` | `422c58f237ce5c0a2d15b3e0675d1bdb2519a75280d1f2016cb0bc676d43df71` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-08T03:53:45.685Z` | `af6e2bee1969a8f47cad9aa716a524d2ba8d2243806b8b9cb249f31ceb4499f6` |
| `totem-2827.json`          | [mmnto-ai/totem#2827](https://github.com/mmnto-ai/totem/pull/2827)                   | `2026-09-08T03:53:47.342Z` | `e5fa5afedcc802a55ace75d30c01aefb569dac1d13d280187112ead072097987` |

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

All three PRs are merged, so GitHub answers `mergeStateStatus: UNKNOWN` for them (it
computes mergeability only for open PRs). That is why mmnto-ai/totem-strategy#1251 lands
in the UNEVALUABLE class rather than allowing, and why every `mergeStateStatus` value is
exercised by a synthetic fixture below. No PR needed synthesizing: all three still answer.

### No real predicate-4-only specimen exists in the searched window

Predicate 4's own territory is a bot HIGH/Major finding on a **resolved** thread whose
comment still applies to the head commit. Every pull request in the range
mmnto-ai/totem#2820 through mmnto-ai/totem#2839 was queried for one (2026-09-08, the same
`gh api graphql` read); six bot HIGH threads exist, across mmnto-ai/totem#2821,
mmnto-ai/totem#2827, mmnto-ai/totem#2831 (three of them) and mmnto-ai/totem#2839, and
**none of them is resolved** — so no real capture can carry that case, and
`synthetic-head-commit-high-inline.json` stands in for it. Three of the six do show the
re-pointing the predicate depends on (`commit.oid` = head while `originalCommit.oid` is
older): mmnto-ai/totem#2827, mmnto-ai/totem#2831 and mmnto-ai/totem#2839.

## The synthetic fixtures

All synthesized `2026-09-08T03:55:11.894Z`, each one covering an invariant the captures
cannot.

| File                                             | Invariant                                                             | sha256                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`               | `CLEAN` passes; no bot review passes 2–4 as a fact                    | `b73eb718fd3940137b5af261507a142912a0d042e33396ae569da4ba3d22b043` |
| `synthetic-merge-state-has-hooks.json`           | `HAS_HOOKS` passes                                                    | `a339d2e3b7af192947a94fe946031cfe584960a5165f92fcf584c6e1175b65fe` |
| `synthetic-merge-state-unstable.json`            | `UNSTABLE` passes (a red non-required check is predicate 1's)         | `871b2b0dcd1245668eef9d5a9b99d9ded43e7fbbfd4a4550fffd9fef768bd7c6` |
| `synthetic-merge-state-behind.json`              | `BEHIND` denies                                                       | `96ca6fb51b7a7f51220df05945bdb04494591867df06ea1a5ce4b915d412f50b` |
| `synthetic-merge-state-dirty.json`               | `DIRTY` denies                                                        | `edbce1a63a84101ad163b63969a4d82c8c47bb3b9f4bcb2b93ead711c429181f` |
| `synthetic-merge-state-blocked.json`             | `BLOCKED` denies                                                      | `2df2052990f18d96fd28dc9c65a526eb76fc64052a2491d64e3850c4c5e05c35` |
| `synthetic-merge-state-draft.json`               | `DRAFT` denies                                                        | `1489c17ace2ef4e461c684f95faf210180699f16b85289e507620af1cae1734b` |
| `synthetic-merge-state-unknown.json`             | `UNKNOWN` is unevaluable (strict deny / pilot warn)                   | `2dda2b7b5422ddda0b2c05d6e54ecbffd4b0684e1f946e95c10e3ee87863de07` |
| `synthetic-merge-state-unrecognised.json`        | a status this gate does not read is unevaluable, never allow          | `88590b4ca5dcf4da81af195392c37ea8b0342010f0df4a9b7f4bb5c3b121c23d` |
| `synthetic-zero-checks.json`                     | R5 — zero checks passes as a fact, with the count and one line        | `af6c8abfcdea608e059bc52490fa05b6dd8009a7caba872f595d44e026c7d534` |
| `synthetic-failing-check.json`                   | a failing check denies at predicate 1                                 | `e74c5fa3c3cafe7a3d6d2ca92d11ab2e4821f6be9953ea56984dbad3433d280f` |
| `synthetic-pending-check.json`                   | a still-running check denies at predicate 1                           | `40ab1822392998dc16358f881e3b456f7453a7ddcb85cd85244ebcbcf227b855` |
| `synthetic-rollup-commit-mismatch.json`          | F7 — a rollup off another commit is unevaluable, never green          | `cd66dc934539762c0eb32daf24b0a2df1c97b2e4157074dd1846f7c2e360a61b` |
| `synthetic-no-commits.json`                      | F7 — no commits answered: the head rollup is unreadable               | `bb540fa6de80f49963102d93ee866e2de41e9a07b552f654f051ced8c8e0ed57` |
| `synthetic-rollup-no-contexts.json`              | F7 — a rollup with no contexts connection is not the zero-checks fact | `53c1ec016ee66b320abdfba2290854e946e0ec0184c7e49250d5f4715de48b69` |
| `synthetic-rollup-state-without-checks.json`     | F7 — `PENDING` over zero listed checks is unreadable, not R5          | `cc68c1e1dee959430dae88d57175bb3a2e46a9cc76fa2535c6d70b68dea6a5f9` |
| `synthetic-unresolved-bot-thread.json`           | an unresolved, non-outdated bot thread denies                         | `f72089d6aab5cee70af916b0d1370918e00ec3150a43e183869655508a58de9b` |
| `synthetic-resolved-outdated-human-threads.json` | resolved / outdated / HUMAN threads never deny                        | `64381afaa783e059c4d019e60e8fb0735d7048ac7570e975809807f6ba55d349` |
| `synthetic-stale-commit-high-inline.json`        | F2 — a HIGH inline applying to an OLDER commit does not deny          | `98ca60196f7315602b13822a69b748fe03ca89743db96bf63227e8ec2d8aebf7` |
| `synthetic-head-commit-high-inline.json`         | F2 — a RESOLVED HIGH inline still on head denies at predicate 4       | `c4774bf85feb6822b0281d59515a77363676a22783e580c4d07f815f4740fc1b` |
| `synthetic-coderabbit-potential-issue.json`      | F9 — CodeRabbit's "Potential issue" reads as a HIGH marker            | `6ae0c00d2e74e7d8e67dbfc226b08b9c2cf9d1296d58c5fcc3756df49ccc0593` |
| `synthetic-changes-requested-standing.json`      | F6 — a later COMMENTED from the same reviewer does not supersede      | `5656f2e2e4aa776ca6bed4618509344ee916f27ec16e5cbf8ceb51fbe8d28176` |
| `synthetic-changes-requested-superseded.json`    | a later `APPROVED` supersedes                                         | `3d420ebcf7d3c0deb5e79197449e93616efa646fad702038e0518e66b7af3ade` |
| `synthetic-pagination-second-page-deny.json`     | a clean first page + a dirty SECOND page denies                       | `90ec2dd0d53dcc6773791ee0eb9c2d34b3e9f06c2269f49b9b731f5dd8a13276` |
| `synthetic-pagination-second-page-fails.json`    | a pagination failure is unevaluable, not clean                        | `fa52e5467464ad5d200ca2ad4ba228185b081efb038da6c4021ff4493bf790e9` |
| `synthetic-head-moved.json`                      | a head sha that moved between pages is unevaluable                    | `5ad7c1b0246c3802e1611adbde33e744541fa75df38874ff1b79ede74b9235b6` |
| `synthetic-rate-limit-exit.json`                 | a non-zero gh exit is unevaluable, naming what gh said                | `c1e9b3be0a02f76c47f64b0145f45f7246a75d272601a52378fa5d6cf077aac4` |
| `synthetic-graphql-error-body.json`              | a GraphQL error in a 200 body is a failed read                        | `85635617d055f1f0365be1a6cda94e03f3511ed79d4ea43f4606dcac960203c1` |
| `synthetic-gh-absent.json`                       | gh missing / unauthenticated is unevaluable at both tiers             | `f1ba11df62549c187f741e4c89efc6f53dd59de1690a25854af1b13ec16a46b1` |
| `synthetic-branch-resolution.json`               | `pr: null` + branch resolves via the branch-keyed document            | `531901038599e5af2d797b0ef1f9032047137a9ec88a17832d3921572323f668` |

## Re-capturing

A capture is a point-in-time answer: re-running the read on the same PR can produce a
different body (threads get resolved, `mergeStateStatus` recomputes, `comment.commit.oid`
re-points). Re-capture only deliberately, and update the instant, the sha256 and any
assertion that names a count. Changing the QUERY forces a re-capture: the fixture must be
what the evaluator would actually receive.
