---
rule: 7ecfa378b76b31a0
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
