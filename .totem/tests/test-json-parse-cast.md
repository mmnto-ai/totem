---
rule: 61bb8b8b88d2ecab
file: src/config.ts
---

## Should fail

```ts
const config = JSON.parse(raw) as Config;
```

## Should pass

```ts
const parsed: unknown = JSON.parse(raw);
const config = ConfigSchema.parse(parsed);
```
