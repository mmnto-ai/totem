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
```
