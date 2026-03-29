## Lesson — Automated hook upgrades should target specific delimited

**Tags:** git-hooks, dx, architecture

Automated hook upgrades should target specific delimited spans between markers rather than overwriting the entire file. This prevents the accidental deletion of user-appended logic or configurations from other hook managers.
