## Lesson — GitHub Closes keyword only applies to the first issue

**Tags:** github, pr-workflow, closes-keyword, auto-close, trap

# GitHub `Closes` keyword only applies to the first issue in a comma-separated list

## What happened
PR #1022 used `Closes #1006, #1005, #1007, #989, #991` in the body. Only #1006 was auto-closed on merge. The remaining 4 issues stayed open and had to be manually closed a session later.

## Root cause
GitHub requires the closing keyword to be repeated for each issue reference. `Closes #1006, #1005, #1007` only closes #1006. The correct syntax is `Closes #1006, closes #1005, closes #1007`.

## Rule
When writing PR bodies that close multiple issues, repeat the keyword for every issue number:
```
Closes #1006, closes #1005, closes #1007, closes #989, closes #991
```

**Example Hit:** `Closes #100, #200, #300` — only #100 gets closed
**Example Miss:** `Closes #100, closes #200, closes #300` — all three get closed

**Source:** mcp (added at 2026-03-27T17:43:36.175Z)
