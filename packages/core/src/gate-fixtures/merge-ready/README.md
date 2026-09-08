# merge-ready fixtures (mmnto-ai/totem#2800, ruling R4)

Every file here answers the injected `GhRunner` seam in place of the network, so
`merge-ready.test.ts` never calls GitHub. Two files are REAL captures; the rest are
synthetic and say so in their name and in their `"kind"` field.

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

## The two captures (R4)

Both were taken by running the REAL `evaluateMergeReady` with a runner that spawned `gh`
and teed each response, so the query in the capture is `MERGE_READY_QUERY` from
`packages/core/src/merge-ready.ts` verbatim (sha256 of that query string at capture time:
`198dfc4ae1533a5b72c24c48d06cf9931adfdcca1a3b142f08a20b8f7c55b398`). `gh version 2.99.0
(2026-09-01)` answered both.

| File                       | PR                                                                                   | Captured (UTC)             | sha256                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `liquid-city-363.json`     | [mmnto-ai/liquid-city#363](https://github.com/mmnto-ai/liquid-city/pull/363)         | `2026-09-08T02:30:21.104Z` | `13c16cd4d94038da37848c8f4186134f1bfa96e7bb924fc6ace65a3f9b0d5e25` |
| `totem-strategy-1251.json` | [mmnto-ai/totem-strategy#1251](https://github.com/mmnto-ai/totem-strategy/pull/1251) | `2026-09-08T02:30:22.164Z` | `86204d92c7d1d8597c23ca23ad2fb7dac899b6a639cdfb8c86730d18b2b0a4f3` |

What each one actually carries, as GitHub answered on the capture instant:

- **mmnto-ai/liquid-city#363** (R4's positive control) — 6 checks, all SUCCESS; one review
  thread, unresolved and not outdated, whose ROOT comment is `gemini-code-assist` carrying
  the `![high](…high-priority.svg)` marker on the head commit
  (`d09ce906b1a12125e089b77e668bea25f1bdef2d`). It denies at predicate 2, with
  `highInline: 1` in provenance. It is also the specimen for the GraphQL login spelling:
  `author.login` is `gemini-code-assist`, with NO `[bot]` suffix.
- **mmnto-ai/totem-strategy#1251** (R4's negative control) — 3 checks, all SUCCESS; no
  reviews and no threads. Predicates 1–4 pass.

BOTH PRs are merged, so GitHub answers `mergeStateStatus: UNKNOWN` for them (it computes
mergeability only for open PRs). That is why mmnto-ai/totem-strategy#1251 lands in the
UNEVALUABLE class rather than allowing, and why every `mergeStateStatus` value is
exercised by a synthetic fixture below — no capture of a merged PR can carry `CLEAN`,
`BEHIND`, `DIRTY` or `BLOCKED`. Neither PR needed synthesizing: both still answer.

## The synthetic fixtures

All synthesized `2026-09-08T02:31:38.467Z`, each one covering an invariant the two
captures cannot.

| File                                             | Invariant                                                      | sha256                                                             |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-merge-state-clean.json`               | `CLEAN` passes; no bot review passes 2–4 as a fact             | `0111b846e25abcaa9636a007dc4df03b4f47347bc05e918a2957e42d719efce8` |
| `synthetic-merge-state-has-hooks.json`           | `HAS_HOOKS` passes                                             | `486e742a508c474509bbab13b15bd015b6396fbfa4125c6da79ec3b058101dad` |
| `synthetic-merge-state-unstable.json`            | `UNSTABLE` passes (a red non-required check is predicate 1's)  | `c8a3b728003fd75ac62310826a118d9577ffde2b981cd4a0a1cb72f6d768322e` |
| `synthetic-merge-state-behind.json`              | `BEHIND` denies                                                | `f6ef23c3dd574450f651b78af06ce7c77a99d2b40bb06866ca6a87ae185a3e1f` |
| `synthetic-merge-state-dirty.json`               | `DIRTY` denies                                                 | `d1c436fec4c8285f9b91c065e8a2814b34a6bcd64b3c4032012c924ed3dcbfd2` |
| `synthetic-merge-state-blocked.json`             | `BLOCKED` denies                                               | `abd750e947446ae287684ba0c5c3e51d57c1fcadec3ff12037b6e3481fd3bccf` |
| `synthetic-merge-state-draft.json`               | `DRAFT` denies                                                 | `ba238b162c27f0430f97a056895a102e2de3fa4c0b977fb1875225e1903e7c8a` |
| `synthetic-merge-state-unknown.json`             | `UNKNOWN` is unevaluable (strict deny / pilot warn)            | `6128bae3a66718a11d09ea8baea5c76316c8029d9098345de50def111865f63a` |
| `synthetic-merge-state-unrecognised.json`        | a status this gate does not read is unevaluable, never allow   | `58fab6364123513d8f40f297a930ce686d39ed0a50abbd90f5eb8b42ec7f2a4a` |
| `synthetic-zero-checks.json`                     | R5 — zero checks passes as a fact, with the count and one line | `4572c8118a22922842754aaaa6b4c2269a8fb7ad3e20f1a7691eca8230671af1` |
| `synthetic-failing-check.json`                   | a failing check denies at predicate 1                          | `0c0f6acce3be63f220697192d63bf6e9633bc7d6849194e0e18486d23430d304` |
| `synthetic-pending-check.json`                   | a still-running check denies at predicate 1                    | `c78bade6c87583ca3e2b9a30d59871352de5d10d2c056e653c0cbf558c064193` |
| `synthetic-unresolved-bot-thread.json`           | an unresolved, non-outdated bot thread denies                  | `dcd3e8a9292baec70f0383894e283d73bda5ea4deb20a5681eac08870ca9a975` |
| `synthetic-resolved-outdated-human-threads.json` | resolved / outdated / HUMAN threads never deny                 | `f55724e7263d0c37fece5b8daa9aae713b85d80466cd67b9ca1447455f19c989` |
| `synthetic-stale-commit-high-inline.json`        | a HIGH inline on an OLDER commit does not deny                 | `f0553c4b8a39fba1eef88ab5b2a2c0fadc94b5db0a49af1c878ce3323aaa2ac0` |
| `synthetic-head-commit-high-inline.json`         | the same inline on the HEAD commit denies at predicate 4       | `a4e7b03f243e78fef27560a72e8096ff058a69030dc634c34cccc1c60cbd8fc1` |
| `synthetic-changes-requested-standing.json`      | an un-superseded `CHANGES_REQUESTED` denies                    | `9537590b8b3a114d0fd91f7774bd694e0125750409fcc8d84ac12caf3c392b6c` |
| `synthetic-changes-requested-superseded.json`    | a later `APPROVED` supersedes; a `COMMENTED` does not          | `8504b2983eb7d97995be1ff71f1efe35b26e1d9fa8108659eb5dc1d955961128` |
| `synthetic-pagination-second-page-deny.json`     | a clean first page + a dirty SECOND page denies                | `b5328e107b542548f6a88c2644d6944302d7fc59da2b7fce5cf374985fdf5f01` |
| `synthetic-pagination-second-page-fails.json`    | a pagination failure is unevaluable, not clean                 | `b631d4dc5260fbb3170580ac4420aa8b5b4d10d788dd322342a0b89aef270c8a` |
| `synthetic-head-moved.json`                      | a head sha that moved between pages is unevaluable             | `2d5ccfbcfc12e652f46d618c8edd8ec62e8a3548445f88b30d337fb7d9fe1762` |
| `synthetic-rate-limit-exit.json`                 | a non-zero gh exit is unevaluable, naming what gh said         | `7878964d8ac374c8ca218b288cac3587cc1149054a6f2e82d46d37d5c6d731c3` |
| `synthetic-graphql-error-body.json`              | a GraphQL error in a 200 body is a failed read                 | `4f11146e90f756bc34e21e76ccd0992fc61b941d76e172dd0427dcbbc2e71af6` |
| `synthetic-gh-absent.json`                       | gh missing / unauthenticated is unevaluable at both tiers      | `eb66b18471f6ca61cbb96e979dc49f7ee4ae32d41da91b62f8205c5640200507` |
| `synthetic-branch-resolution.json`               | `pr: null` + branch resolves via the branch-keyed document     | `aa1aaf7da6c6c84cd093563b5754bb5b5a3dc395f79917731b77204ea001baaa` |

## Re-capturing

A capture is a point-in-time answer: re-running the read on the same PR can produce a
different body (threads get resolved, `mergeStateStatus` recomputes). Re-capture only
deliberately, and update the instant, the sha256 and any assertion that names a count.
