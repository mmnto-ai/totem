---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(autoclose): A+B slice of the GitHub auto-close enforcement seam (mmnto-ai/totem#1762)

Adds the harness-boundary raw-merge interlock (A) and the sanctioned
`totem pr merge` actuator (B), both consuming the ONE shared evaluator.

- **core**: new `MERGE_COMMAND_REGEX_SOURCE` + `findMergeInvocations` in
  `autoclose/command-matcher.ts` — a presence-invariant, deny-on-undecidable
  detector for raw `gh pr merge` / `gh api …/pulls/{n}/merge` /
  `gh pr $(…)` invocations, tolerant of common (incl. PowerShell) quoting,
  interspersed flags (`gh --repo o/r pr merge`), shell/cmd line continuations,
  variable/substitution merge-API paths, and the GraphQL `mergePullRequest`
  mutation — while never over-firing on `gh pr view` or across a shell separator.
- **cli**: `totem pr merge [number]` asserts the merge-config posture via GraphQL
  (reusing `evaluateMergeConfigPosture`), refuses undeclared close-keyword refs
  in the PR title/body (authorized only by a `totem-close` marker), accepts ONLY a
  positive-decimal PR number, binds `--repo` to both lookup and merge, pins the
  evaluated snapshot with `--match-head-commit`, treats a merge-queue landing as
  unsettled (defers declared closes until MERGED), and merges squash-only with no
  body flags, ever. `--check-only` and `--close-declared` supported (a failed
  declared close exits non-zero with a summary).
- **cli**: a rendered `CLAUDE_MERGE_INTERLOCK` PreToolUse hook + a Gemini BeforeTool
  command hook (registered in `.gemini/settings.json`, reads the tool-call JSON on
  stdin per the official Gemini contract) reroute raw merges to the actuator; both
  inline the shared regex (drift-locked by a parity test) and branch their block
  message on the recognizable-vs-undecidable arm.

Round-2 hardening of the raw-merge detector (mmnto-ai/totem#1762 re-review): the
FLAGRUN construction was rebuilt to be provably LINEAR — the earlier flag-name
shape let each repeated flag group parse two ways, so a non-matching `gh` command
with ~26 flag groups backtracked catastrophically (multi-second) inside every
shell interlock; the disjoint-class rebuild plus a bounded merge-path span scan an
adversarial 40-group / 152 KB input in well under 50 ms (asserted by perf
fixtures). Detection coverage also widened to close bypasses: quoted `=value`
flags (`--repo='o/r'`, `--repo="$REPO"`), glued short-flag values
(`-Rowner/name`), cmd.exe `%PR%` / `!PR!` variable merge-API paths, a wholly
variable `gh api` endpoint, and line-continuations spliced into a merge-API /
GraphQL path — while a flag value no longer crosses a `;`/`|`/`&` command
separator.

The Gemini BeforeTool interlock now ships as `.gemini/hooks/BeforeTool.cjs` (was
`.js`) so a consumer repo whose `package.json` is `"type": "module"` execs it as
CommonJS instead of ESM-resolving it and crash-opening the merge (a `.js` threw
`ReferenceError: require is not defined` before reading stdin, which Gemini treats
as a warning and lets the merge through). The ordinary consumer upgrade path
(`prepare` → `totem hook install`) now runs the same non-interactive Gemini
registration + legacy `.js`→`.cjs` migration that `totem init` runs, so an existing
Gemini consumer is armed on upgrade rather than only after a manual re-init.

Round-3 hardening: the committed, armed Claude hook
(`.totem/hooks/merge-interlock.cjs`) is regenerated from the current template — it
had retained the round-1 pattern (allowed glued/quoted merge forms and backtracked
multi-second at ~26 flag groups) because every test checked the in-memory template,
not the on-disk file; a new parity test now byte-locks both committed hosts to their
templates so the drift fails CI. Gemini registration is also atomic: settings are
registered only when a managed, totem-owned `BeforeTool.cjs` is actually present —
an absent, user-owned allow-all, zero-byte, or unreadable `.cjs` is never blessed
and reported armed — and a legacy + canonical coexistence collapses to exactly one
registration.

Notes for changelog readers: examples use digitless placeholders such as a
`Closes #NNN` shape only; the guard blocks a close-keyword adjacent to a real
issue reference in a PR title / squash body.
