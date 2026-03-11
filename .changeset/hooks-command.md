---
'@mmnto/cli': minor
---

Add `totem hooks` command for non-interactive hook installation with `--check` validation. Dogfood enforcement hooks in this repo: pre-commit blocks main/master, pre-push runs deterministic shield. Hooks auto-install on `pnpm install` via prepare script.
