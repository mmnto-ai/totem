# ci-action-pins — SHA-pin every GitHub Action in mmnto-ai/totem

**Word:** operator, 2026-08-29, relayed cohort-wide (strategy-claude dispatch 2026-08-29T0132Z; status-claude's
totem pin table 2026-08-29T0144Z). Sibling landings: mmnto-ai/totem-strategy#1150 (strategy, also charters the
`ci-action-pins` + `ci-workflow-head-isolation` parity rows), mmnto-ai/totem-status#221 (totem-status, merged).
Anchor issue: mmnto-ai/totem-strategy#1138. Each seat lands its own repo; nobody writes in another lane's checkout.

## Scope

- Every `uses:` in `.github/workflows/*.yml` becomes `owner/repo@<40-hex> # vX.Y.Z`. Dependabot's
  `github-actions` ecosystem (already configured in `.github/dependabot.yml`, weekly, limit 5) maintains the pins.
- "Drop `upload-sarif` where code scanning is disabled" — NOT applicable here; see judgment 1.
- No code, no types, no state containers, no new failure modes. 13 workflow files, 49 `uses:` lines.
  **Triage: tactical by nature; exceeds the 3-file count, so this spec's pin table is the design record** rather
  than the six-subsection doc (nothing architectural to enumerate).

## Pin table (resolved 2026-08-29 from each action's tag via the GitHub API; floating major tags cross-checked)

| as used                                         | pin                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `actions/checkout@v7`                           | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`                     |
| `actions/setup-node@v7`                         | `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`                   |
| `pnpm/action-setup@v5`                          | `pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v5.0.0`                    |
| `actions/upload-artifact@v7`                    | `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`              |
| `actions/upload-artifact@v4` (spine-spike only) | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`              |
| `actions/download-artifact@v8`                  | `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1`            |
| `actions/setup-go@v6`                           | `actions/setup-go@924ae3a1cded613372ab5595356fb5720e22ba16 # v6.5.0`                     |
| `oven-sh/setup-bun@v2`                          | `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`                    |
| `contributor-assistant/github-action@v2.6.1`    | `contributor-assistant/github-action@ca4a40a7d1004f18d9960b404b97e5f30a505a08 # v2.6.1`  |
| `github/codeql-action/upload-sarif@v4`          | `github/codeql-action/upload-sarif@cdf488f595d80d6e07e03d4674febd5ab45fa938 # v4.37.9`   |
| `dtolnay/rust-toolchain@stable`                 | `dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable branch head …` |
| `changesets/action@a45c4d59… # v1` (release)    | same SHA, comment corrected to `# v1.9.0`                                                |

The first five rows are status-claude's table, re-verified against the API this session; the rest are totem's
own (the table covered 4 of the 13 workflow files).

## Judgment calls (each verified against a primary, not the relayed word)

1. **SARIF upload in `lint.yml` is KEPT, pinned.** The drop clause is conditioned on code scanning being
   disabled. On this repo `GET /repos/mmnto-ai/totem/code-scanning/analyses` lists ingested `totem-lint`
   analyses (latest 2026-08-28T08:07Z), i.e. the upload reports — it is not the false-empty class. (The
   `security_and_analysis.code_security` key status-claude suggested is absent on a public repo; the analyses
   endpoint is the real sensor.) A comment on the step records the check.
2. **`dtolnay/rust-toolchain` is pinned to its `stable` branch head.** The action publishes no version tags.
   At the pinned SHA `action.yml`'s `toolchain` input defaults to `stable` and the workflow overrides it with
   `'1.96.1'`, so the pin freezes the action's code without touching the compiler channel. Dependabot does not
   advance branch pins — re-pin by hand (comment on the step says so).
3. **`upload-artifact@v4` in `spine-spike-linux.yml` is pinned AS USED (v4.6.2), not harmonized to v7.** The word
   is pin, not bump; dependabot already bumped the rest 4→7 (mmnto-ai/totem#2507) and will propose this one.
4. **`pnpm/action-setup` stays on v5.** Dependabot's 5→6 (mmnto-ai/totem#1390) was closed, not merged.
5. **`release.yml` (already SHA-pinned) gets its comments corrected and one SHA aligned:** `checkout@9c091bb…`
   (= v7.0.0) moves to v7.0.1 so the repo carries one SHA per action; `setup-node@8207627… # v6` was mislabeled
   (that SHA is v7.0.0); `changesets/action@a45c4d59…` is v1.9.0 (v2 is dependabot-ignored per mmnto-ai/totem#2653).

## Verification

- Mechanical gate: `grep -h 'uses:' .github/workflows/*.yml | grep -vE '@[0-9a-f]{40} # '` → empty (49/49).
- Full diff read line-by-line: 49 one-for-one `uses:` replacements + two explanatory comment blocks; nothing else.
- `prettier --check` clean on all touched files; no changeset (CI-only, nothing published).
- The PR's own CI runs are the behavioural check — every pinned action executes on the PR head.

## Ritual note

`totem spec` (1.120.0) records `.totem/cache/spec-<hash>.json`; the agent-strict pre-commit hook
(`packages/cli/src/commands/install-hooks.ts`, `tools/pre-commit`) still tests for `.totem/cache/.spec-completed`,
which no CLI path writes — a fresh worktree cannot satisfy the gate through the CLI. The marker was written by hand
for this commit after the spec completed; the hook↔CLI drift is a separate ticket.
