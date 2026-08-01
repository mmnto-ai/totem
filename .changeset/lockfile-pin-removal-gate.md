---
'@mmnto/cli': minor
---

`verify-lockfile-sync` now fails loud when a lockfile diff silently removes a package whose pin is still declared: a failed optional-dependency fetch (e.g. an expired registry token) makes `pnpm install` drop every `pnpm-lock.yaml` entry for a working dep while exiting 0, and the resulting lockfile is internally consistent enough to pass `--frozen-lockfile` CI. The gate now parses the lockfile diff for fully-removed packages, confirms the package resolves nowhere at HEAD, verifies the pin is still declared in a dependency block of a tracked `package.json`, and blocks the push with an auth-check + `pnpm update <pkg>` recovery hint (`pnpm install --lockfile-only` false-reports "Already up to date" on this class).

Also in this release: `totem lint` / `totem review` no longer report a bare "No changes detected" when the working tree's only changes are untracked files — the verdict now names the untracked files, states that nothing was examined, and says how to bring them into scope (exit code unchanged). And `totem review` now describes itself honestly at run start and across `--help`, docs, and init-template text: supplementary AI review lanes — advisory sensors, not a merge gate.
