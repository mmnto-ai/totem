---
rule: 90eccad00d7df088
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
