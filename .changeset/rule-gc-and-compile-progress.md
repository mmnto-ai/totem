---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

feat: rule garbage collection and compile progress indicator (#1040, #894)

- `totem doctor --pr` now archives stale compiled rules (zero triggers after configurable minAgeDays). Opt-in via `garbageCollection` config block. Security-category rules are exempt.
- `totem compile` now shows elapsed time and ETA with throughput-based estimation. Rate-limited LLM calls (429) are automatically retried with jittered exponential backoff.
