---
'@mmnto/cli': patch
---

Hotfix: 1.59.0's prefer-local re-exec crashed the parent's exit path after every SUCCESSFUL delegation — cross-spawn fills `error: null` (not `undefined`) on success, and the spawn-failure check read `.message` off the null. The child's work completed but the invoking process exited 1 with a raw TypeError. Caught on the first live delegation; the success shape is now regression-locked in tests.
