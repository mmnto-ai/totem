---
'@mmnto/cli': patch
---

The gate wrapper now resolves a `totem` CLI from `PATH` when the repo-local `node_modules/@mmnto/cli/dist/index.js` is absent, curing the bootstrap self-block a `Bash|PowerShell`-matched gate had on a fresh clone — the gate applied to the very `pnpm install` / `pnpm build` that would create the repo-local CLI, and to the cure its message named (mmnto-ai/totem#2822). The repo-local pinned CLI stays first and an applicable gate that neither arm can evaluate still fails closed; the no-CLI message now names exits the gate does not block (a terminal outside the harness, or the editor on `.claude/settings.json`), a PATH-arm failure discloses which CLI evaluated, and `totem gate install` prints one line disclosing the property for any gate whose matcher includes `Bash`.
