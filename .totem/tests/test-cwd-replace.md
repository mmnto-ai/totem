---
rule: b9e4125e6a31f2cf
file: src/utils.ts
---

## Should fail

```ts
const rel = fullPath.replace(process.cwd(), '');
```

## Should pass

```ts
const rel = path.relative(process.cwd(), fullPath);
```
