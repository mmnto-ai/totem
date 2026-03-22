---
rule: c0f2a3fd2956184e
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
