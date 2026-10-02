## Lesson — The shield knob's block value does not arm a gate

**Tags:** hooks, shield, configuration, docs
**Scope:** docs/wiki/config-reference.md, docs/wiki/enforcement-model.md, packages/cli/src/commands/shield-enforce.ts

`hooks.shield.enforce: 'block'` is the explicit spelling of the default exit, plus the knob's line. It does not make the shield run where it did not run before: the managed pre-push hook runs the shield only on the strict tier and on agent seats, so on a standard-tier install the value changes nothing. Docs, help text and changesets never describe `block` as arming or enabling the gate. This reading, and the two for `advisory` and `advisory-when-legged`, were confirmed in writing before the build (mmnto-ai/totem#2995).
