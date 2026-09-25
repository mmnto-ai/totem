## Lesson — Allowlist a new child-process call in a swept file

**Tags:** manual

Allowlist a new child-process call in a swept file in the same PR. The security pack repo sweep (packages/pack-agent-security/test/repo-sweep.test.ts) pins the expected count of raw spawnSync call sites per file by rule hash, with a reason per file; a new git ls-files spawn added to doctor.ts for the Stray Markers row turned the whole workspace test red (expected 7, got 8) until the count and its reason were updated. A change that adds a spawn to packages/cli/src/commands/doctor.ts or any other swept file carries the allowlist update with it (mmnto-ai/totem#2974).
