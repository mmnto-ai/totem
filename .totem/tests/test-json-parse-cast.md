---
rule: fe1af7a58d7469b8
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
