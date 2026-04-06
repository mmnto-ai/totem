---
rule: 2d962603591aa928
file: src/example.ts
---

## Should fail

```ts
try {
  doSomething();
} catch (err) {}
```

## Should pass

```ts
try {
  doSomething();
} catch (err) {
  console.error(err);
}
```
