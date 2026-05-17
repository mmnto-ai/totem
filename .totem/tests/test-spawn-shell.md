---
rule: e91d1a223ce3e3a5
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
