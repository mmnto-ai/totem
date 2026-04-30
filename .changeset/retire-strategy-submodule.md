---
'@mmnto/cli': patch
---

chore: retire `.strategy/` git submodule (mmnto-ai/totem#1710 follow-up)

Removes `.gitmodules` and the `.strategy` gitlink. The four-layer
`resolveStrategyRoot` precedence shipped in mmnto-ai/totem#1710
(`TOTEM_STRATEGY_ROOT` env → `TotemConfig.strategyRoot` → sibling clone
at `../totem-strategy/` → legacy `.strategy/` submodule) makes the
submodule path the LAST-resort fallback, and the auto-clone ceremony
of `.gitmodules` was the only thing forcing every fresh totem checkout
to fetch a strategy SHA from the gitlink.

The resolver's Layer 4 (manual `.strategy/` directory) still works for
existing checkouts that have one — the retirement is just removing the
auto-clone wiring + the gitlink commit-pointer drift cycle.

Recommended setup remains: clone `mmnto-ai/totem-strategy` as a sibling
to your totem checkout. `CONTRIBUTING.md` already describes this; no
doc change required.

**Side updates:**

- `.prettierignore`: drop the `.strategy/` entry (no directory to ignore).
- `.gemini/styleguide.md`: rephrase a stale `.strategy/proposals/` doc
  reference to use `<strategyRoot>/proposals/` instead, with a parenthetical
  pointing at the resolver and the recommended sibling-clone path.

**Note for existing local clones:** after pulling this PR, run
`rm -rf .strategy .git/modules/.strategy` to clean the orphaned working
tree. Git won't auto-prune a formerly-tracked submodule directory.
