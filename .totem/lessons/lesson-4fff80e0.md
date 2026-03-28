## Lesson — CodeRabbit posts its "review complete" summary comment

**Tags:** coderabbit, github-api, timing, automation

CodeRabbit posts its "review complete" summary comment before all inline findings are written. There is a 30-60 second delay while inline comments trickle in, likely due to GitHub API rate limit batching. Any automated workflow that triggers on the review summary must wait for inline comments to stabilize before scraping.

**Source:** mcp (added at 2026-03-28T07:11:41.835Z)
