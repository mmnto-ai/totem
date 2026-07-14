---
'@mmnto/cli': patch
---

fix(mail): the ECL outbox scan no longer follows symlinked agent/outbox directories (mmnto-ai/totem#2355, sibling class to the #2354 ingest guard).

`enumerateOutboxes` dirent-filtered the workspace and repo levels but the inner agent-level scan used a bare `readdirSync` + `existsSync` (both follow symlinks), so a symlinked `<agent>/` or `outbox/` directory was traversed during the mail poll. The agent level is now dirent-filtered like the outer levels (and like `orchestration-resolver.ts`, which is no-follow by design), and the outbox probe is an lstat-based no-follow directory check.

Consumer-impact: `totem mail` scan enumeration only — symlinked agent/outbox directories under `.totem/orchestration/` are skipped instead of followed; regular directories scan identically. Severity was bounded to enumeration/display (not index persistence). No migration required.
