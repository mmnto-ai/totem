import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  getFallbackCommand,
} from './install-hooks.js';

// Bind the repo-local `tools/{pre-commit,pre-push,post-merge}` hook scripts — which
// `package.json`'s `prepare` (`node tools/install-hooks.js`) copies into `.git/hooks`
// on every install — to the CLI template builders that `totem hook install --force`
// uses. If a template changes without regenerating tools/, the copied scripts silently
// re-drift from the CLI-canonical hooks and stomp them on the next `pnpm install`
// (mmnto-ai/totem#2404). A failure here means tools/ must be regenerated in lockstep
// (byte-for-byte) with the builders before merging the template change.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');

// This repo pins no `hooks.tier` in totem.config.ts, so the installer's effective tier
// is the default 'standard'. The fallback command derives from the repo's lockfile
// exactly as the installer and doctor do (getFallbackCommand).
const TIER = 'standard' as const;
const FALLBACK_CMD = getFallbackCommand(REPO_ROOT);

function readTool(hook: string): string {
  return fs.readFileSync(path.join(TOOLS_DIR, hook), 'utf-8');
}

describe('tools/ hook scripts match the CLI template builders (mmnto-ai/totem#2404)', () => {
  it('resolves the pnpm-based fallback command for this repo', () => {
    expect(FALLBACK_CMD).toBe('pnpm dlx @mmnto/cli');
  });

  it('tools/pre-commit is byte-identical to buildPreCommitHook output', () => {
    expect(readTool('pre-commit')).toBe(buildPreCommitHook(TIER));
  });

  it('tools/pre-push is byte-identical to buildPrePushHook output', () => {
    expect(readTool('pre-push')).toBe(buildPrePushHook(FALLBACK_CMD, TIER));
  });

  it('tools/post-merge is byte-identical to buildHookContent output', () => {
    expect(readTool('post-merge')).toBe(buildHookContent(FALLBACK_CMD));
  });
});
