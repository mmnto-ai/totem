---
'@mmnto/cli': minor
---

- **Shield GitHub Action (#180):** Added `action.yml` composite action for CI/CD enforcement — runs `totem sync` + `totem shield` as a pass/fail quality gate on PRs
- **Rename CLI commands (#185):** `learn` → `extract`, removed `anchor` alias (use `add-lesson`), updated all docs and tests
- **Interactive multi-select (#168):** `totem extract` now presents a `@clack/prompts` multi-select menu for cherry-picking lessons instead of all-or-nothing Y/n
- **CI test step:** Added `pnpm test` to the CI workflow (was missing)
