---
'@mmnto/cli': minor
---

feat: git hook enforcement — block main commits + deterministic shield gate

`totem init` now installs two enforcement hooks alongside the existing post-merge hook:

- **pre-commit**: blocks direct commits to `main`/`master` (override with `git commit --no-verify`)
- **pre-push**: runs `totem shield --deterministic` before push, bails instantly if no compiled rules exist (zero Node startup penalty for Lite tiers)

Both hooks are idempotent, chain-friendly (append to existing hooks without clobbering), and cross-platform.

Also restructures `.gemini/gemini.md` with safety rules positioned first for stronger LLM compliance.
