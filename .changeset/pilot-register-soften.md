---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

`totem init --pilot` says what it does. The `--pilot` help text, the init message and the config schema's comment promised warn-only git hooks; the git hook installer never read the pilot config or state, and the only tier the flag reaches is the action gates installed with `--gates`, which run advisory. The three texts and the roadmap line now describe that, and the "14 days / 50 pushes" line is gone, since nothing consumes the window yet. The init message also says what the run did rather than what the flag is meant to do: whether `pilot: true` was written (only into a config the run generates) and whether the state file was initialised or already present; and `init --global --pilot` now says the flag is ignored there instead of ignoring it silently (mmnto-ai/totem#2815, the register fix; the wiring, if wanted, is a feature on its own word). No gate or hook behaviour changes.
