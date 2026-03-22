---
rule: 3b48ad1c3c382306
file: src/cli.ts
---

## Should fail

```ts
const val = args[args.indexOf('--model') + 1];
```

## Should pass

```ts
const idx = args.indexOf('--model');
const val = idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
```
