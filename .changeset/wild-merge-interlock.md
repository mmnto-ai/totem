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
  `gh pr $(…)` invocations, tolerant of common (incl. PowerShell) quoting and
  never over-firing on `gh pr view`.
- **cli**: `totem pr merge [number]` asserts the merge-config posture via GraphQL
  (reusing `evaluateMergeConfigPosture`), refuses undeclared close-keyword refs
  in the PR title/body (authorized only by a `totem-close` marker), and merges
  squash-only with no body flags, ever. `--check-only` and `--close-declared`
  supported.
- **cli**: a rendered `CLAUDE_MERGE_INTERLOCK` PreToolUse hook + a Gemini
  BeforeTool `run_shell_command` arm reroute raw merges to the actuator; both
  inline the shared regex (drift-locked by a parity test).

Notes for changelog readers: examples use digitless placeholders such as a
`Closes #NNN` shape only; the guard blocks a close-keyword adjacent to a real
issue reference in a PR title / squash body.
