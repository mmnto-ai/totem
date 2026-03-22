---
rule: 5cbf4ee7e76975d4
file: src/ast.ts
---

## Should fail

```ts
root.findAll(typeof pattern === 'string' ? pattern : pattern.rule);
```

## Should pass

```ts
root.findAll(pattern);
```
