---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

### 1.5.6 — Foundation & Hardening

**Features:**

- Unified Findings Model (`TotemFinding`) — common output schema for lint and shield (ADR-071)
- `totem-context:` is now the primary override directive; `shield-context:` remains as silent alias
- `totem lint --format json` now includes a `findings[]` array alongside `violations[]`
- safe-regex validation for user-supplied DLP patterns — ReDoS-vulnerable patterns rejected at input time

**Fixes:**

- `matchesGlob()` now correctly handles `*.test.*` and `dir/*.test.*` patterns (was doing literal string match)
- `readRegistry()` differentiates ENOENT from permission/parse errors via `onWarn` callback
- `TotemParseError` used for schema validation failures (was generic `Error`)
- Git hooks path resolved via `git rev-parse --git-path` (supports worktrees and custom `core.hooksPath`)
- `shield-hints.ts` uses `log.dim()` instead of raw ANSI escape codes
- `store.count()` failure no longer breaks sync
- `maxBuffer` (10MB) added to git diff commands — prevents ENOBUFS on large branch diffs
- Windows `ENOTEMPTY` flake fixed with `maxRetries` in test cleanup

**Chores:**

- Dynamic imports in `doctor.ts` for startup latency
- 8 new lessons extracted from bot reviews (305 compiled rules)
- Audited and removed 6 `totem-ignore` suppressions
- Updated compiled baseline hash and scope for JSON.parse rule
