import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ejectCommand } from './eject.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eject-'));
}

describe('ejectCommand', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    // Create .git so it looks like a repo
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('removes post-merge hook when it only contains Totem content', async () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\n# [totem] post-merge hook — background re-index after pull/merge.\n\necho "[totem] Triggering background re-index..."\n(pnpm exec totem sync --incremental > .git/totem-sync.log 2>&1) &\n',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('preserves non-Totem content in post-merge hook', async () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\necho "my custom hook"\n# [totem] post-merge hook — background re-index after pull/merge.\n\necho "[totem] Triggering background re-index..."\n(pnpm exec totem sync --incremental > .git/totem-sync.log 2>&1) &\n',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('my custom hook');
    expect(content).not.toContain('[totem]');
  });

  it('removes scaffolded files with Totem marker', async () => {
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, 'SessionStart.js'),
      '// [totem] auto-generated — Gemini CLI SessionStart hook\nconsole.log("hi");',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.js'))).toBe(false);
  });

  it('does not remove files without Totem marker', async () => {
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'SessionStart.js'), 'console.log("user hook");');

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.js'))).toBe(true);
  });

  it('scrubs AI reflex block from CLAUDE.md', async () => {
    const claudePath = path.join(cwd, 'CLAUDE.md');
    fs.writeFileSync(
      claudePath,
      '# My Project\n\nSome instructions.\n\n## Totem AI Integration (Auto-Generated)\nYou have access to the Totem MCP.\n\n### Memory Reflexes\n1. Pull before planning.\n',
    );

    await ejectCommand({ force: true });

    const content = fs.readFileSync(claudePath, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some instructions.');
    expect(content).not.toContain('Totem AI Integration');
    expect(content).not.toContain('Memory Reflexes');
  });

  it('deletes .lancedb, .totem, and totem.config.ts', async () => {
    fs.mkdirSync(path.join(cwd, '.lancedb'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};');

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.lancedb'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.totem'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'totem.config.ts'))).toBe(false);
  });

  it('scrubs Claude settings.local.json PreToolUse entry', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settings = {
      permissions: { allow: ['Bash'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'node .totem/hooks/shield-gate.cjs' }],
          },
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo custom' }] },
        ],
      },
    };
    fs.writeFileSync(path.join(settingsDir, 'settings.local.json'), JSON.stringify(settings));

    await ejectCommand({ force: true });

    const updated = JSON.parse(
      fs.readFileSync(path.join(settingsDir, 'settings.local.json'), 'utf-8'),
    );
    expect(updated.hooks.PreToolUse).toHaveLength(1);
    expect(updated.hooks.PreToolUse[0].matcher).toBe('Write');
    expect(updated.permissions).toBeDefined();
  });

  it('handles clean project with nothing to remove', async () => {
    // No Totem artifacts exist
    await ejectCommand({ force: true });
    // Should not throw
  });
});
