## Lesson — A config knob cannot soften a failure before config loads

**Tags:** cli, configuration, hooks, shield
**Scope:** packages/cli/src/commands/shield-enforce.ts, packages/cli/src/commands/shield.ts

`hooks.shield.enforce` is read once the config is loaded, so it softens only failures raised after that point. A contradictory flag pair (`--gate` with `--fail-on`), a config that does not load, and a knob value outside the three allowed ones all exit non-zero under every value: nothing has read the knob yet, and a corrupt setup must not be able to switch its own gate off. The docs say this as "what stays hard" rather than leaving the reader to infer it (mmnto-ai/totem#2995; a value outside the three was measured as refused at config load).
