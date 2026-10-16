---
rule: 87aff037d7de47a7
file: packages/src/example.ts
---

<!-- Ban fail-open catch blocks that skip re-throwing -->

## Should fail

```ts
function swallowErr() {
  try {
    doWork();
  } catch (err) {
    // no throw anywhere in this block — fail-open
    return null;
  }
}
```

## Should pass

```ts
function rethrowWithCause() {
  try {
    doWork();
  } catch (err) {
    throw new Error('doWork failed', { cause: err });
  }
}

// Tenet-4 shape 1 (rethrow-unexpected): the type-discriminated rethrow is the
// rule WORKING — a genuine bug still fails loud, the expected class softens.
// The subtree walk (stopBy: end) sees `throw err` nested in the `if`, so the
// rule does not fire. Locked here so the shape-1 carve-out never regresses
// to firing (mmnto-ai/totem#2214, lockstep with strategy Tenet-4 #702/#708).
function rethrowUnexpected() {
  try {
    doWork();
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return null;
  }
}
```
