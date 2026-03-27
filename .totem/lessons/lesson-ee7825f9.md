## Lesson — DRY up shared logic immediately when two commands duplicate

**Tags:** dry, refactoring, bot-review-parser, code-quality

# DRY up shared logic immediately when two commands duplicate code

## What happened
PR #1026 initially duplicated 15 lines of review body parsing logic between `triage-pr.ts` and `review-learn.ts`. GCA flagged it as high priority. The fix was straightforward — extract `extractReviewBodyFindings()` into `bot-review-parser.ts` — but would have been even simpler if done from the start.

## Rule
When adding the same logic to two commands, extract it into a shared helper on the first pass. The parser layer (`packages/cli/src/parsers/`) already exists for this purpose. Don't wait for a bot to flag it — the second call site is the signal to extract.

**Source:** mcp (added at 2026-03-27T19:56:05.581Z)
