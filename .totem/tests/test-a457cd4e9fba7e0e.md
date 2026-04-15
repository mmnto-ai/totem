---
rule: a457cd4e9fba7e0e
file: packages/src/example.ts
---

<!-- Ban `spawn()` / `spawnSync()` with `shell: true` -->

## Should fail

```ts
import { spawn, spawnSync } from 'node:child_process';

spawn('ls', ['-la'], { shell: true });
spawnSync('pnpm', ['test'], { cwd: '/tmp', shell: true });
```

## Should pass

```ts
import { spawn, spawnSync } from 'node:child_process';

spawn('ls', ['-la']);
spawnSync('pnpm', ['test'], { cwd: '/tmp' });
```
