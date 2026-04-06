---
rule: 2d962603591aa928
file: scripts/audit.ts
---

## Should fail

```ts
try {
  new RegExp(pattern);
} catch (err) {}
```

## Should pass

```ts
try {
  new RegExp(pattern);
} catch (err) {
  console.error(err);
}
```
