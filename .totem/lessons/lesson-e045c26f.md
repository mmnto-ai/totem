## Lesson — Lesson — Auto-detected shield hints reduce false positives

**Tags:** shield, dx, architecture, prompt-engineering

## Lesson — Auto-detected shield hints reduce false positives more than static prompt rules

**Tags:** shield, dx, architecture

Static `.totem/prompts/shield.md` rules are a blunt instrument — they apply to every review regardless of context. Dynamic hint injection (scanning the diff for `[REDACTED]`, checking for test files, reading `// shield-context:` annotations) is more precise and self-documenting. The `extractShieldHints` pattern in `shield-hints.ts` auto-detects DLP artifacts, test presence, and new files, then injects only relevant hints. This reduced shield iterations from 3-5 per ticket to 1-2.

**Source:** mcp (added at 2026-03-24T18:46:56.398Z)
