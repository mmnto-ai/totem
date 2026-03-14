---
rule: bb937a42753289f1
file: src/utils/process.ts
---

## Should fail

```ts
const output = execSync('git status', { encoding: 'utf-8' });
execSync(`npm install ${pkg}`);
```

## Should pass

```ts
const child = spawn('git', ['status']);
const result = await execFile('node', ['script.js']);
// execSync is mentioned in a comment but not called
```
