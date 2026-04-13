---
'@mmnto/totem': patch
---

Nervous System Capstone: mesh completion and tactical cleanup

**Mesh completion (#1307, #1308):**

- `totem search` now federates queries across `linkedIndexes`. Results merge by score with `[linkName]` prefix for linked hits. Dimension mismatch guard and global maxResults cap included. Connection and search failures degrade gracefully with warnings.
- `totem doctor` gains a "Linked Indexes" health check. Validates each configured linked index: path exists, `.lancedb` present, config present, embedding provider present, no name collisions.

**Tactical cleanup (#1391, #1350, #1354, #1357):**

- Codified PR review bot reply protocol (CR vs GCA) in contributing docs, gemini styleguide, and CLAUDE.md.
- Added `NO_LESSONS_DIR` guard before both `generateInputHash` calls in compile command.
- Extracted duplicated `ok()`/`fail()` spawn mock helpers to shared `test-utils.ts`.
- Added `describeSafeExecError` helper and migrated `safeExec` callers to walk cause chains (rule 102 compliance). Removed message concatenation from `wrapSpawnError`.

**Postmerge:** 7 new lessons, 2 new compiled rules (1 archived for over-breadth).
