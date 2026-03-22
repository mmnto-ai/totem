---
rule: 8057fcca873b861a
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
