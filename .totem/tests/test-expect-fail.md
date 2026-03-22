---
rule: d487264e210913a4
file: src/example.test.ts
---

## Should fail

```ts
try {
  await fn();
  expect.fail('should throw');
} catch (e) {
  expect(e.message).toBe('x');
}
```

## Should pass

```ts
await expect(fn()).rejects.toThrow('x');
```
