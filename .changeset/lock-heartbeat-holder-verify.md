---
'@mmnto/totem': minor
---

fix(lock): heartbeat the sync lock and verify holder identity before every deletion (#2564)

The 1.110.0 ingest pacing defaults (gemini 4s/batch, 60s-floor 429 backoff) put multi-minute wall-clock inside the sync lock by construction, and the lock's timestamp was written once at acquisition — so the 120s stale threshold judged most paced full re-indexes dead mid-run and a second sync could steal the lock exactly when the #2562 checkpoint invariant needed mutual exclusion.

- The holder now refreshes the lock timestamp every 15s (atomic temp+rename beats; `unref`'d timer), so staleness means eight consecutive missed beats — a dead or wedged holder — instead of a long-running one. The threshold stays 120s: staleness remains the final authority over PID liveness, which lies across container namespaces.
- Every lock deletion (stale steal, dead-PID reclaim, release) now re-reads the file and removes only the exact lock it judged dead; a present-but-unreadable file is never deleted. Release previously unlinked unconditionally, so a finishing stolen-from holder deleted the thief's valid lock.
- Each beat self-verifies ownership; a foreign holder latches a one-way `isLost()` on the release handle. The sync pipeline probes it at flush boundaries, at `beginFullSync` (before the marker overwrite + store reset), and before the baseline/marker writes: a stolen lock aborts loudly with the full-sync checkpoint intact, and the next sync resumes the epoch.
- **MCP `add_lesson` under a live full re-index now writes the lesson file without contending on the lock** — the lock is held unstealably for corpus-sized wall-clock during exactly those runs, and contending was a deterministic multi-minute block ending in a lost lesson. The convenience sync remains deferred to the epoch (#2569 behavior).
- New public API (minor): `LockRelease` and `AcquireLockOptions` exported from `@mmnto/totem`; `acquireLock` returns `LockRelease` (callable exactly as the previous `() => void`); `withLock`'s callback now receives the release handle (zero-arg callbacks unaffected); `SyncOptions.lockOptions` timing seam.
- Locks written by pre-#2564 binaries (`{pid, timestamp}`) still parse and age into staleness unchanged.
