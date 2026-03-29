---
"@mmnto/cli": patch
---

Gate architecture reset (Proposal 207): replaced SHA-based flag files with stateless git hooks (lint + verify-manifest) and content-hash-based PreToolUse review gate. Added SessionStart hook for automatic knowledge context injection. Removed all flag files (.lint-passed, .shield-passed, .spec-completed) and Claude hook enforcement scripts.
