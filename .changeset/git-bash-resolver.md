---
'@mmnto/totem': minor
---

Git-Bash resolver (mmnto-ai/totem#2159) — the cohort-standard fix for the bare-`bash`-is-WSL trap. New core exports: `resolveBash()` (POSIX returns `'bash'`; win32 derives Git's install root via `git --exec-path` with conventional-path fallback and returns an absolute Git-Bash path — a total probe miss throws `BASH_RESOLUTION_FAILED` naming every probed path, never falling back to bare `'bash'`, which silently resolves to WSL's Linux bash and cannot read Windows paths) and `bashSpawnEnv(base?)` (child env with Git's `usr\bin` + `bin` prepended to PATH so the spawned script's coreutils resolve — the trap's second layer; git-hook contexts get this from git itself, plain spawns now get it here). Contract: bare `bash` is never spawned by repo tooling on win32 — the repo's bash-invoking test suites now consume the pair and pass in plain PowerShell contexts where they previously failed 10-of-14.
