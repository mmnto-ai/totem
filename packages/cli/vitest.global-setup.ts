// Regression guard for mmnto-ai/totem#1942 — snapshots `.git/hooks/pre-push`
// at the start of the run and asserts the file is byte-identical at the end.
//
// A test that spawns the built CLI (e.g., `node dist/index.js shield`) with a
// cwd inside the real repo triggers `shieldCommand`'s silent
// `upgradePrePushHookIfNeeded`, which resolves the real git root and
// overwrites `.git/hooks/pre-push` mid-run. Pre-#1942 fix this corrupted
// every developer's hook and could race bash mid-parse during `git push`.
//
// The guard is intentionally coarse — one snapshot per test run, not per
// test — so it stays cheap and durable. If it fires, the offending test is
// usually obvious from a `git diff .git/hooks/pre-push` against the staged
// state; if not, temporarily re-enable per-test snapshotting in a
// `setupFiles` entry to localize.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HOOK_PATH = path.resolve(__dirname, '../../.git/hooks/pre-push');

function hashHook(): { exists: boolean; hash: string; size: number } {
  if (!fs.existsSync(HOOK_PATH)) {
    return { exists: false, hash: '', size: 0 };
  }
  const content = fs.readFileSync(HOOK_PATH);
  return {
    exists: true,
    hash: crypto.createHash('md5').update(content).digest('hex'),
    size: content.length,
  };
}

export function setup(): () => void {
  const before = hashHook();
  return () => {
    const after = hashHook();
    if (before.hash !== after.hash || before.exists !== after.exists) {
      throw new Error(
        `[mmnto-ai/totem#1942] .git/hooks/pre-push was MUTATED during the test run.\n` +
          `  before: exists=${before.exists} size=${before.size} md5=${before.hash}\n` +
          `  after:  exists=${after.exists} size=${after.size} md5=${after.hash}\n` +
          `A test invoked a CLI command (e.g., shield/review) with a cwd inside the real repo, ` +
          `which triggers the silent pre-push hook upgrader. Isolate the spawn cwd to ` +
          `os.tmpdir() so resolveGitRoot returns null.`,
      );
    }
  };
}
