---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

`totem init --pilot` says what it does. The `--pilot` help text, the init message and the config schema's comment promised warn-only git hooks; the git hook installer never read the pilot config or state, and the only tier the flag reaches is the action gates installed with `--gates`, which run advisory. The three texts and the roadmap line now describe that, and the "14 days / 50 pushes" line is gone, since nothing consumes the window yet (mmnto-ai/totem#2815, the register fix; the wiring, if wanted, is a feature on its own word). No behaviour changes.
