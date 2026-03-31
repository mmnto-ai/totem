---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat: auto-scaffold test fixtures for Pipeline 1 rules (#854) and shield auto-learn (#779)

- Pipeline 1 error rules now auto-generate test fixture skeletons during compile, preserving error severity instead of downgrading to warning (ADR-065)
- New `totem rule scaffold <id>` command for manual fixture generation with `--out` option
- Fixtures seeded from Example Hit/Miss when available, otherwise TODO placeholders
- New `shieldAutoLearn` config option: when true, shield FAIL verdicts auto-extract lessons without `--learn` flag
