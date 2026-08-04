---
'@mmnto/totem': patch
---

fix(lock): heartbeat the sync lock and verify holder identity before every deletion (#2564)

The 1.110.0 ingest pacing defaults (gemini 4s/batch, 60s-floor 429 backoff) put multi-minute wall-clock inside the sync lock by construction, and the lock's timestamp was written once at acquisition — so the 120s stale threshold judged most paced full re-indexes dead mid-run and a second sync could steal the lock exactly when the #2562 checkpoint invariant needed mutual exclusion.

- The holder now refreshes the lock timestamp every 15s (atomic temp+rename beats; `unref`'d timer), so staleness means eight consecutive missed beats — a dead or wedged holder — instead of a long-running one. The threshold stays 120s: staleness remains the final authority over PID liveness, which lies across container namespaces.
- Every lock deletion (stale steal, dead-PID reclaim, release) now re-reads the file and removes only the exact lock it judged dead. Release previously unlinked unconditionally, so a finishing stolen-from holder deleted the thief's valid lock.
- Each beat self-verifies ownership; a foreign holder latches a one-way `isLost()` on the release handle. The sync pipeline probes it at flush boundaries and before the baseline/checkpoint-marker writes: a stolen lock aborts loudly with the full-sync checkpoint intact, and the next sync resumes the epoch.
- Locks written by pre-#2564 binaries (`{pid, timestamp}`) still parse and age into staleness unchanged.
