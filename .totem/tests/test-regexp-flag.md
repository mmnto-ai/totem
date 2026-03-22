---
rule: a5697f86bb23901e
file: src/utils.ts
---

## Should fail

```ts
new RegExp(pattern, flags + 'g');
```

## Should pass

```ts
new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
```
