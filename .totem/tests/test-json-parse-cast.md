---
rule: 8db5440cd22cb81a
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
