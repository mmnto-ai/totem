# The frozen seed-20 record set — the pin

Charter: mmnto-ai/totem-strategy#1154 (`operations/310-seed20-target-preregistration.md`).
Spec: `.totem/specs/seed20-apparatus.md` § "Hard constraints" 5.

**Pin:** `78e7f196b93caf0df68a3baba561cce66279563c` — the **cure record pin** (charter v1.5
§ 7 E26; branch `r14/seed-20-translation`, annotated tag `seed20-cure/0e01112d`, both durable).
It is the child of the run of record's pin `2a7135762b6aedc9cd3099ab3f42e029ee34092e` (the pin
of `f6efe85d`'s verdict, (B) 14/15, which stands) and differs from it in exactly one file:
`r14-0e01112d-bare-new-error.rule.yaml`, whose `target.pattern` `\bnew\s+(?!Totem)Error\(`
became `\bnew\s+Error\(` — the inert lookahead removed, every other byte identical (one hunk on
the pattern line; semantic preservation: strategy-codex's E26 (iii) deposit, 0 findings).

The 22 files below are **byte-identical copies** of `.totem/rules/r14-*.rule.yaml` at that
commit, obtained with `git show 78e7f196b93caf0df68a3baba561cce66279563c:<path>` and verified
by comparing `git hash-object` of each copy against `git rev-parse <pin>:<path>` (all 22 blob
oids equal). `.totem/rules/r14-translation-notes.md` is at the pin too and is deliberately NOT
copied — it is prose, not a record, and the apparatus loads records only.

22 files, 20 rules: `6b1890e2` and `71935fe9` each carry TWO records (a `language: typescript`
original and a `language: javascript` twin) that share one `lessonHash`, which is why the
package-naming rule suffixes BOTH records of a twinned rule with `_<language>`
(`.totem/specs/seed20-apparatus.md` § G1).

The `lessonHash` a record is compiled under is read from its own `curation.sourceLesson`
(`lesson-<16 hex>`); the file stem's 8-hex is the **seed entry** and is asserted to be that
hash's first 8 characters at load time (`src/lib/record-sets.mts`).

## Re-verification

`src/manifest.mts` re-records the sha256 of every file below at run time into
`artifacts/manifest.json`. `src/verify-records.mts` additionally compares each copy against the
pinned blob with `git cat-file blob <pin>:<path>` when the pin commit is present locally, and
SKIPS with the named reason `pin-commit-not-present-locally` when it is not (a CI shallow clone
has no `r14/seed-20-translation` history).

## The file list (sha256 of the file bytes · git blob oid · bytes)

| file                                                     | sha256                                                             | blob oid                                   | bytes |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | ----- |
| `r14-0167a783-dynamic-import-utility-layer.rule.yaml`    | `07516f5d50e45afd7d9de0151cfb8b81c562121e5f517e8d2e69cfe3b88a2301` | `24ff5cd9dc23f9288334f1efeaa447b30c8b8223` | 629   |
| `r14-0e01112d-bare-new-error.rule.yaml`                  | `26e997b34a3ba5a0d7dd61014d2996942b545748763f418a5bd9d8f8409362dc` | `927cf76c96a56390f7475b13b41c8da6223cbb3a` | 484   |
| `r14-1a7080eb-inline-secrets-agent-config.rule.yaml`     | `02f84fb59f1181a07ee2d54d450efbfc36e787a6213a7baf9b78fd785e05e33d` | `6186a141e8dda259fc9ddb1099b19368a0c5953c` | 685   |
| `r14-49dd9e4f-llm-character-counting.rule.yaml`          | `16464d624f16481377718b409413bd96c0c3bf4e692c6f1161ec1d905c6e5912` | `c1a402d3d1727686573423a70da995f47a664cf6` | 556   |
| `r14-54140f59-bare-issue-number-refs.rule.yaml`          | `b382417d9f84c7f2da7c30ac1e8ee6c05849f319b01e2794fa78f0a75a04618c` | `04d70b358d35587880124f3ba04143dbba487818` | 508   |
| `r14-5b85fe53-suppress-event-runtime-failure.rule.yaml`  | `e9900ef40ae018e94d76d0e7871820cd9f1017c96d2113cb9b85ee54d0b9a2c8` | `22e3c34dddf81513fe883e33f1eca7498a789ddd` | 627   |
| `r14-5da43ea6-git-double-dash-separator.rule.yaml`       | `c6ab098109f458116ea25806da392563dad5fce4cfad58890dee6c969b975586` | `a7c4cd4299ad4567196fe334e4172fe214e0d7ed` | 695   |
| `r14-6467c351-dynamic-import-cli-entry.rule.yaml`        | `b9adcd666dfff8fc19c4e4995a80ba9daca5b11286ba15ce0f8a92d2691e6c7e` | `86c7924058b389d08fa1eed2c689274299103dfd` | 599   |
| `r14-65ede9bf-dynamic-import-command-handlers.rule.yaml` | `23f41519099160f9eb6a2c2f5236c95064d83b0bc7b4ff9c828b17ef1a5bb82f` | `834ba39139ab237fd90a6f9b91f5e0da0aa7efc6` | 632   |
| `r14-6b1890e2-empty-string-in-whitelist-js.rule.yaml`    | `3edf179716d184a49098f35ce60b4d924ae33e2264bca11227cfd0eb1434ff58` | `7dc766a7e0e193f348861981ba5bdbd4f84e5889` | 531   |
| `r14-6b1890e2-empty-string-in-whitelist.rule.yaml`       | `afaa3cd5b576b44c9a9d7a881e79bd1a361b00cc0f345130b18d41828ac19f48` | `1f54ff2faafbe0aa454cfa55f850a877aea62555` | 531   |
| `r14-6b2b62eb-totem-error-log-tag.rule.yaml`             | `b820153dc52b553c3140d79baf148687193701358559580a8cbde7cf012d1c71` | `131cd71e6e927c57be2519743c15f0eaf585cc0e` | 449   |
| `r14-71935fe9-string-cast-on-input-js.rule.yaml`         | `ba6817913c4e08ada6eafb0c7eb711f27db3363f4602c1450394d299901dc012` | `433623a78b713da72b90fb7403c8ecd130719a43` | 582   |
| `r14-71935fe9-string-cast-on-input.rule.yaml`            | `e80c66f7827222aa7f6b99c6ef2272635a5ac95a02bcc7ec50c8181f936d21f7` | `997596a06ef23e0b955255397ef1608892a13dfd` | 582   |
| `r14-87aff037-fail-open-catch-ban.rule.yaml`             | `de1079ea3d8a8b13e877780c90ccbaf6e6c41d6011ca4e91063c2a7a432330ca` | `0bdc8a94a12ea3bfcbf0c062cb58c9783ba6bae2` | 1295  |
| `r14-89184bb5-bsd-sed-hex-escape.rule.yaml`              | `eeb6bc8530761ee58ad48524c5833b0391b12308f1edcc0fda8393fdeda293b1` | `1af73d22f50289657abec1cf2c933520d8ae237e` | 518   |
| `r14-aa7a588d-async-test-callbacks.rule.yaml`            | `9694c5dcc31f344835f2af2c00b0b2cd663c1b82b66edcb7b56245047eea89ac` | `0af4959cb047293e7b967ec4b140c3b7a53ba4c0` | 644   |
| `r14-b237bcf3-pwd-in-credential-regex.rule.yaml`         | `97c58bcc4cbc5b6c979c06b69e0ee32de4c15fbba8fac0a5593d2346320f2060` | `95ee2e97d1db96e219f4a8178d223175cbab36ad` | 577   |
| `r14-b9736096-orchestrator-test-timeout.rule.yaml`       | `3e6dc4a73d0320b86aa68f0b0f7b62a4c338e1f469b49ffbba49a7dacbbb1633` | `2367d858d3cf196e9838288a43694a104d35e610` | 647   |
| `r14-be74c55c-actions-input-expansion.rule.yaml`         | `38325d68a691330c00e1d2bf6db261646ac648ec420957e75beab8fbcbbe2719` | `d1da428764ac1ee59d33c36ae6c6e6909dae5e63` | 671   |
| `r14-d5faa14c-absolute-claims-in-docs.rule.yaml`         | `7a1c81aba9f0356c51dce2fe8d596107b9790bc7a1d92e7d6fcc261689bb4307` | `fa827f5bb3a83bd938eab2162bec771686b41232` | 769   |
| `r14-d940b2c9-stdio-in-exec-options.rule.yaml`           | `85d3276e47fd7eec605cc38025b5f80f7b2ab55987656d227291455ebebe10ea` | `24c7029a800adde950d138b8eb33fd8e840406b0` | 554   |

## Known apparatus outcomes on this set (apparatus rows, never verdicts)

These are properties of the LOWERER against these records, recorded so the run's reject rows are
readable. They score nothing.

- `1a7080eb` declares `language: json`, which the shipped `compileRuleRecord` does not register
  → a `shipped-compile` reject row. No bundle, no chain.
- `0e01112d` at this (cure) pin carries `\bnew\s+Error\(` — the negative lookahead `(?!Totem)` it
  carried at `2a713576` is gone (E26) → it classifies `word-boundary`, produces NO reject row, and
  lowers: a bundle and a chain (K7 21 → 22, T5 scored packages 20 → 21, both declared). At the run
  of record's pin it was a `target-lowering` reject row, class `lookaround` — no bundle, no chain —
  and that row stays the run of record's K1 third row, PASS at `f6efe85d`; here K1's third row is
  the cure's positive control (`src/controls.mts`).
- `5da43ea6` carries a literal backtick inside a character class. It lowers: the § Lowering 3
  self-assert tests raw-string SYNTAX, not the byte (`.totem/specs/seed20-apparatus.md` § G6).
- `87aff037` is the only seed record with a corpus fixture
  (`.totem/tests/test-87aff037d7de47a7.md`, declared file `packages/src/example.ts`).
