---
rule: 69318419666ecf84
file: packages/cli/src/git.ts
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
