---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

`hooks.shield.enforce` — the strict pre-push shield gate's own exit knob (mmnto-ai/totem#2525).

**What it does.** It decides what a failing `totem review --gate` run exits — the run the managed pre-push hook makes on the strict tier and on agent seats. `'advisory'`: every failure raised after the config is loaded exits `0`, printing the same error text and then `[Totem] shield: hooks.shield.enforce = advisory`; that includes a lane's own config-class refusal such as `No model specified`, not only a round in which no lane completed. `'advisory-when-legged'`: the same softening, only when `totem legs gate` derives evidence for HEAD — a legs-owed push whose deposit the legs gate accepts — and the line names that deposit and its coverage; a push that is not legs-owed, an owed push with no fresh deposit, and a legs derivation that fails keep the block, and a repo that wants code pushes covered widens `hooks.legsOwed.globs`. `'block'`: the explicit spelling of the default, a failure exits non-zero, plus the line; it does not arm a standard-tier install, because the managed hook runs the shield only on the strict tier and agent seats. Unset keeps today's behaviour byte for byte, so nothing changes on upgrade.

**Where it is read.** By `totem review --gate` itself, at run time, once the config is loaded: setting it needs no `totem hook install --force`, and the rendered pre-push hook is byte-identical. The knob is applied at one point, around the command's outcome; it does not change a lane, a prompt, a verdict or the reviewed-content stamp, and it adds one line when it is set, on a passing run too. A softened failure prints the same bytes the CLI's error boundary prints for it — the boundary's print half is now one shared renderer.

**What stays hard.** A failure raised before the config is loaded — a contradictory flag such as `--gate` with `--fail-on`, a config that does not load, or a knob value outside the three — exits non-zero under every value. A bare `totem review` does not read the knob. The `doctor --strict` step of the same hook block is not affected.

**For programmatic callers.** `runLegsGate`'s outcome carries an optional `evidence` field (the winning deposit's sha, rank and coverage) in the evidence state only, and `buildLegsGateDeps` accepts an already-loaded config; `totem legs gate` prints and exits as before.

**Distributed surfaces.** `docs/wiki/config-reference.md` § The Shield Exit Knob, `enforcement-model.md` and `cli-reference.md` carry it, and the `--gate` option's help names it.
