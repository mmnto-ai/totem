## Lesson — Deposit walk paths quote keys that are not identifiers

**Tags:** json, legs-deposit, paths, error-reporting
**Scope:** packages/core/src/artifacts/legs.ts, packages/cli/src/commands/legs.ts

`findBareRefsInLegDeposit` names each hit by a path from the root: a plain identifier key appends a dot and the key, any other key appends the key in brackets with JSON quoting, an array index appends the index in brackets, and a hit inside a key itself carries a "(key)" suffix (mmnto-ai/totem#3025). The third falsification leg measured why dot-only paths fail: a key written as a.b and a nested a holding b both rendered as $.a.b, and the verb's locate cache, keyed by path, then named both hits on the first one's line. With the quoted form the paths are injective, so the cache cannot collide and a hit's path tells the seat which key to qualify.
