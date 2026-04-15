---
rule: a5cf7ddc6237311c
file: packages/src/example.ts
---

<!-- Ban `export let` module-level mutable state -->

## Should fail

```ts
export let counter = 0;
```

## Should pass

```ts
let counter = 0;
export const stableCounter = 0;
export function incrementCounter(): number {
  counter += 1;
  return counter;
}
```
