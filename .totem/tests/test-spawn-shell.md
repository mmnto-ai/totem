---
rule: dd4542e69ec3d5a1
file: src/process.ts
---

## Should fail

```ts
spawn('git', ['status'], { cwd: dir, shell: true, env: process.env });
```

## Should pass

```ts
spawn('git', ['status']);
```
