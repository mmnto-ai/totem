---
rule: bb1bcd038255556c
file: src/process.ts
---

## Should fail

```ts
process.kill(childPid, 0);
```

## Should pass

```ts
const alive = child.connected;
```
