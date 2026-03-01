/**
 * Cross-platform git hook installer.
 * Copies hook scripts from tools/ to .git/hooks/.
 * Idempotent — safe to re-run.
 */

import { existsSync, copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const hooksDir = join(rootDir, '.git', 'hooks');

const hooks = ['pre-push', 'post-merge'];

if (!existsSync(join(rootDir, '.git'))) {
  console.log('[totem] Not a git repository — skipping hook installation.');
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

for (const hook of hooks) {
  const src = join(__dirname, hook);
  const dest = join(hooksDir, hook);

  if (!existsSync(src)) {
    console.log(`[totem] Hook source not found: ${hook} — skipping.`);
    continue;
  }

  copyFileSync(src, dest);

  // Make executable on Unix (no-op on Windows, git bash handles it)
  try {
    chmodSync(dest, 0o755);
  } catch (_err) {
    // chmod may fail on Windows — hooks still work via git bash
  }

  console.log(`[totem] Installed ${hook} hook.`);
}
