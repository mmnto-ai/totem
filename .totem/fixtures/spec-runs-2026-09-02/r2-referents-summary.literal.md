# r2 referent extraction — `totem spec` drafts

Mechanical evidence only, no verdicts. Artifacts: 55 (caller=`spec`). Resident: `D:/Dev/totem` (read-only). HEAD referent: `8d5e2691`.

`commitAtRun` = `git rev-list -1 --before=<createdAt> main` — **approximate**: the artifact records no commit, and a run may have been made on a branch.
`proposedContext` is true when **any** occurrence of the referent sits in a sentence matching `/\b(create|add|new|introduce|will|should|propose|extract|implement|rename|move|split|define|write)\b/i` (sentence = span free of `.`/newline containing the occurrence start).
Path "missing" = neither exact nor suffix match in the run tree. Ident/flag "missing" = `git grep -l -F` at the run commit returned nothing.

**Path regex: the dispatch's verbatim alternation** (`--literal-path-regex`). Its ordering is shortest-first, so `foo.json` is captured as `foo.js` and `foo.tsx` as `foo.ts`; those truncated referents cannot exist in any tree and inflate every "missing" path count.

Resolution scope (as dispatched): identifiers are grepped under `packages docs AGENTS.md .totem/lessons .totem/lessons.md tools`, flags under `packages docs`. A referent that belongs to an external tool (a `git`/`node`/`pnpm` flag, a platform token) therefore reads as missing.

## Per-artifact counts

| id | anchor | bytes | paths named | p miss | p miss-notprop | idents named | i miss | i miss-notprop | flags named | f miss | f miss-notprop | issue refs | ratio |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4fb89ea7 | topic | 7168 | 3 | 2 | 2 | 3 | 1 | 0 | 1 | 1 | 1 | 0 | 0.429 |
| dc3c9096 | topic | 6808 | 3 | 1 | 1 | 5 | 3 | 2 | 0 | 0 | 0 | 0 | 0.375 |
| b23b1ad4 | topic | 7130 | 11 | 8 | 6 | 8 | 3 | 1 | 0 | 0 | 0 | 0 | 0.368 |
| d3afa2a8 | issue | 7891 | 6 | 4 | 4 | 11 | 4 | 2 | 0 | 0 | 0 | 0 | 0.353 |
| 18dbd77a | issue | 9691 | 13 | 11 | 5 | 10 | 3 | 3 | 0 | 0 | 0 | 4 | 0.348 |
| 5628da37 | issue | 6953 | 6 | 3 | 3 | 9 | 6 | 2 | 0 | 0 | 0 | 2 | 0.333 |
| d34c7bb7 | issue | 7644 | 7 | 4 | 4 | 9 | 3 | 1 | 0 | 0 | 0 | 1 | 0.313 |
| 8be1a66a | topic | 6759 | 2 | 0 | 0 | 11 | 5 | 4 | 0 | 0 | 0 | 0 | 0.308 |
| a8ad7218 | issue | 8666 | 8 | 5 | 1 | 12 | 5 | 4 | 3 | 3 | 2 | 3 | 0.304 |
| ef349a9e | issue | 10117 | 3 | 2 | 2 | 18 | 9 | 5 | 3 | 0 | 0 | 0 | 0.292 |
| c6098928 | issue | 9749 | 6 | 3 | 2 | 12 | 7 | 3 | 0 | 0 | 0 | 1 | 0.278 |
| 2a1603dd | topic | 8630 | 9 | 8 | 5 | 12 | 5 | 1 | 1 | 0 | 0 | 0 | 0.273 |
| 03fb1a57 | issue | 6013 | 5 | 2 | 1 | 6 | 3 | 1 | 1 | 1 | 1 | 0 | 0.250 |
| a4d12d22 | issue | 8510 | 3 | 2 | 2 | 8 | 2 | 1 | 1 | 0 | 0 | 2 | 0.250 |
| 1a7353e7 | issue | 10975 | 14 | 9 | 7 | 17 | 9 | 1 | 1 | 1 | 0 | 1 | 0.250 |
| 940ec4c9 | issue | 8920 | 8 | 3 | 2 | 9 | 5 | 2 | 0 | 0 | 0 | 5 | 0.235 |
| 819b41c2 | issue | 8063 | 3 | 0 | 0 | 10 | 5 | 3 | 1 | 0 | 0 | 1 | 0.214 |
| 1331db73 | issue | 8085 | 1 | 0 | 0 | 14 | 7 | 3 | 0 | 0 | 0 | 1 | 0.200 |
| aeb91deb | topic | 6618 | 4 | 2 | 1 | 6 | 4 | 1 | 0 | 0 | 0 | 0 | 0.200 |
| 56fd363b | issue | 8169 | 8 | 5 | 2 | 8 | 4 | 1 | 0 | 0 | 0 | 2 | 0.188 |
| 87ef36b6 | topic | 7365 | 4 | 1 | 0 | 13 | 5 | 3 | 0 | 0 | 0 | 0 | 0.176 |
| be5140ac | issue | 7906 | 5 | 2 | 2 | 12 | 5 | 1 | 0 | 0 | 0 | 0 | 0.176 |
| 0426a34a | issue | 6899 | 6 | 3 | 2 | 7 | 2 | 0 | 0 | 0 | 0 | 0 | 0.154 |
| 353b28b8 | topic | 6850 | 3 | 0 | 0 | 9 | 2 | 2 | 1 | 0 | 0 | 0 | 0.154 |
| 7a9c818c | issue | 10445 | 4 | 1 | 0 | 15 | 8 | 3 | 1 | 0 | 0 | 0 | 0.150 |
| 43b0939a | issue | 6736 | 7 | 3 | 2 | 7 | 0 | 0 | 0 | 0 | 0 | 2 | 0.143 |
| b1cf42a0 | topic | 8501 | 7 | 3 | 0 | 15 | 4 | 3 | 0 | 0 | 0 | 0 | 0.136 |
| afbe3e23 | issue | 4841 | 2 | 1 | 1 | 4 | 0 | 0 | 2 | 0 | 0 | 0 | 0.125 |
| 9de64043 | topic | 8537 | 4 | 3 | 1 | 10 | 6 | 1 | 3 | 0 | 0 | 0 | 0.118 |
| f121fc1d | topic | 6938 | 3 | 0 | 0 | 15 | 2 | 2 | 0 | 0 | 0 | 0 | 0.111 |
| 518e6de3 | topic | 5512 | 4 | 1 | 1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0.111 |
| e5a15c9c | issue | 9783 | 7 | 2 | 2 | 10 | 5 | 0 | 1 | 0 | 0 | 0 | 0.111 |
| da927720 | issue | 6207 | 2 | 1 | 1 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0.100 |
| 480fe8e8 | topic | 6212 | 4 | 1 | 1 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0.100 |
| 83d431a2 | issue | 6182 | 2 | 0 | 0 | 8 | 3 | 1 | 0 | 0 | 0 | 0 | 0.100 |
| 56fcaf32 | issue | 8534 | 3 | 1 | 0 | 17 | 7 | 2 | 0 | 0 | 0 | 1 | 0.100 |
| d2c00686 | issue | 7484 | 3 | 1 | 0 | 5 | 3 | 1 | 3 | 0 | 0 | 0 | 0.091 |
| 511fa410 | topic | 5922 | 5 | 1 | 1 | 6 | 2 | 0 | 1 | 0 | 0 | 0 | 0.083 |
| 9e87194b | topic | 6564 | 2 | 0 | 0 | 12 | 1 | 1 | 0 | 0 | 0 | 0 | 0.071 |
| bd0782d1 | topic | 8197 | 5 | 2 | 1 | 10 | 5 | 0 | 0 | 0 | 0 | 0 | 0.067 |
| 4d666857 | issue | 8147 | 3 | 1 | 1 | 12 | 0 | 0 | 1 | 0 | 0 | 7 | 0.063 |
| 6d167986 | issue | 9351 | 3 | 2 | 1 | 11 | 5 | 0 | 2 | 0 | 0 | 0 | 0.063 |
| 2017563e | issue | 7996 | 6 | 2 | 1 | 11 | 8 | 0 | 0 | 0 | 0 | 4 | 0.059 |
| 0eb7c23c | issue | 9824 | 9 | 5 | 0 | 7 | 0 | 0 | 1 | 1 | 1 | 0 | 0.059 |
| e1a1c6d3 | issue | 7637 | 3 | 1 | 1 | 16 | 7 | 0 | 0 | 0 | 0 | 2 | 0.053 |
| 2a5ce271 | topic | 9023 | 8 | 4 | 1 | 14 | 5 | 0 | 0 | 0 | 0 | 0 | 0.045 |
| 60f7b069 | issue | 7571 | 3 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 7 | 0.000 |
| 5b37047f | topic | 8447 | 3 | 0 | 0 | 14 | 2 | 0 | 0 | 0 | 0 | 1 | 0.000 |
| 1bd416c1 | topic | 7286 | 3 | 0 | 0 | 13 | 1 | 0 | 0 | 0 | 0 | 0 | 0.000 |
| 9f75c498 | topic | 6216 | 6 | 2 | 0 | 14 | 3 | 0 | 0 | 0 | 0 | 0 | 0.000 |
| 871bdbd7 | topic | 7459 | 3 | 0 | 0 | 5 | 2 | 0 | 1 | 1 | 0 | 0 | 0.000 |
| cf2ebc4a | topic | 7561 | 3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 1 | 0.000 |
| 0b830493 | issue | 8321 | 2 | 0 | 0 | 9 | 3 | 0 | 2 | 1 | 0 | 0 | 0.000 |
| a498ded3 | topic | 5825 | 4 | 1 | 0 | 8 | 4 | 0 | 0 | 0 | 0 | 0 | 0.000 |
| 29bacc3e | topic | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |

Totals: paths named 264, missing 119, missing-not-proposed 70; idents named 536, missing 195, missing-not-proposed 61; flags named 31, missing 9, missing-not-proposed 5; issue refs 48.

Backticked bare filenames (resolved by basename, excluded from the ratio): named 52, missing at run 11, missing-not-proposed 9. Backticked identifier candidates dropped by the stoplist/heuristic: 71.

## 25 most frequent missing-not-proposed referents

| kind | referent | artifacts naming it |
| --- | --- | ---: |
| path | `.totem/compile-manifest.js` | 2 |
| path | `.totem/compiled-rules.js` | 2 |
| path | `packages/cli/src/commands/review.ts` | 2 |
| flag | `--depth` | 1 |
| flag | `--exec-path` | 1 |
| flag | `--ignore-freeze` | 1 |
| flag | `--is-shallow-repository` | 1 |
| flag | `--totem` | 1 |
| path | `../totem-strategy/proposals/active/307-foo.md` | 1 |
| path | `./config.js` | 1 |
| path | `.claude/skills/git-skills.md` | 1 |
| path | `.totem/config.js` | 1 |
| path | `.totem/freeze.js` | 1 |
| path | `.totem/orchestration/strategy-claude/outbox/2026-08-30T0059Z-totem-claude-re-totem-spec-confabulates-ruled-concur.md` | 1 |
| path | `.totem/orchestration/totem-kimi/drafts/scan-2428-empirical.mjs` | 1 |
| path | `.totem/spine/gate-1/windtunnel.lock.js` | 1 |
| path | `.totem/verification-outcomes.js` | 1 |
| path | `@mmnto/strategy-doctrine/package.js` | 1 |
| ident | `admits_control_plane_prose_files` | 1 |
| ident | `AUTHORED_CERT_MUTATION_DENIED` | 1 |
| ident | `BoardTruncationMeta` | 1 |
| ident | `buildPostMergeHook` | 1 |
| ident | `buildVerdictArtifact` | 1 |
| ident | `bySeat` | 1 |
| ident | `capturedRules` | 1 |

## Stoplist

Matched case-insensitively against the backticked identifier token.

Dispatch-given: `function`, `export`, `import`, `string`, `number`, `boolean`, `undefined`, `Promise`, `Record`, `Error`, `describe`, `expect`, `process`, `return`, `interface`, `extends`, `default`, `object`, `module`, `require`, `console`, `length`, `readonly`, `private`, `public`, `static`, `async`, `await`, `typeof`, `instanceof`, `constructor`, `options`, `config`, `result`, `results`, `params`, `message`, `timeout`, `version`, `README`, `AGENTS`, `CLAUDE`, `totem`, `Totem`, `GitHub`, `Windows`, `Node`

Added (expansion of the dispatch's "…"): `unknown`, `namespace`, `implements`, `abstract`, `declare`, `protected`, `package`, `continue`, `finally`, `globalThis`, `__dirname`, `__filename`, `Object`, `String`, `Number`, `Boolean`, `Symbol`, `Function`, `Partial`, `Required`, `RegExp`, `Buffer`, `Uint8Array`

Plus a heuristic drop: all-lowercase tokens with no digit/underscore and length ≤ 8 (dictionary words).

## Anomalies

- 29bacc3e: output.content length 1

## Re-run

```
node "D:/Dev/worktrees/totem-totem-claude-r1193/.totem/fixtures/spec-runs-2026-09-02/scripts/r2-referents.mjs" --resident "D:/Dev/totem" --out "D:/Dev/worktrees/totem-totem-claude-r1193/.totem/fixtures/spec-runs-2026-09-02"
```

Wall time: 16.2s. Node v24.16.0.
