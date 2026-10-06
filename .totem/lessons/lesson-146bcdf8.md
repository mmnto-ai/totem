## Lesson — An exit knob prints its line where the error stays last

**Tags:** cli, hooks, shield, output-order
**Scope:** packages/cli/src/commands/shield-enforce.ts, packages/cli/src/commands/shield.ts

`hooks.shield.enforce` adds one line to a `totem review --gate` run, and where that line prints depends on the outcome. On a run that still fails (`block`, or `advisory-when-legged` without legs evidence) the knob line prints BEFORE the CLI's error, so the error is the last thing on the terminal. On a softened run (exit 0) the error's rendered text prints first and the knob line last, so the reason the push went through is the last thing read. Both orders were measured against a real process in a scratch repository before the PR opened (mmnto-ai/totem#2995).
