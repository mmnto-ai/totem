---
'@mmnto/cli': patch
---

Fix `totem docs` aborting on large responses by adding maxBuffer (10MB) to execSync, matching the existing GitHub CLI adapter pattern. Adds descriptive error messages for buffer overflow and timeout failures.
