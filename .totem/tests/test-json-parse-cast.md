---
rule: b84fb92bc2313a47
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
