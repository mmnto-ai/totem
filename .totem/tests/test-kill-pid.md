---
rule: b7d397b36e0fc7d7
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
