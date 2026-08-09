import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeExec } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import type { EjectSummary } from './eject.js';
import {
  deriveDirtyTreeSense,
  ejectCommand,
  resolveEjectHooksContext,
  scrubPostCheckoutHook,
  scrubPostMergeHook,
  scrubReflexFiles,
} from './eject.js';
import {
  AI_PROMPT_BLOCK,
  REFLEX_END,
  REFLEX_START,
  SKILL_MARKER_END,
  SKILL_MARKER_START,
} from './init-templates.js';
import { resolveGitRootForHookPath, resolveHooksDir } from './install-hooks.js';

// Mock the git seam (mmnto-ai/totem#2426): eject now resolves the git root +
// hooks dir via the SAME #2422 helpers `hook install` uses. Tests must NOT spawn
// real `git` with cwd inside a temp dir (leaves undeletable directories on
// Windows AND, if TMPDIR happened to sit inside a repo, could scrub the OUTER
// repo's hooks). So the two resolvers are mocked; the fixtures below are plain
// filesystem `.git/hooks` trees. The `...actual` spread keeps every other export
// real — and eject is the only module importing these two, so intra-module
// install-hooks calls (init/hooks tests) are untouched.
vi.mock('./install-hooks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install-hooks.js')>();
  return {
    ...actual,
    resolveGitRootForHookPath: vi.fn(),
    resolveHooksDir: vi.fn(),
  };
});

// Same git-seam rule for the rule-2 dirty-tree sense (mmnto-ai/totem#2620):
// `deriveDirtyTreeSense` shells `git status --porcelain` via the core barrel's
// safeExec — mocked so no test ever spawns real git from a temp cwd. Default
// (armed in the file-scope beforeEach): empty porcelain = clean tree.
vi.mock('@mmnto/totem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mmnto/totem')>();
  return { ...actual, safeExec: vi.fn(() => '') };
});

// Failure-injection seam for the shared atomic writer (mmnto-ai/totem#2620):
// passthrough to the REAL helper unless a test arms a failure, so the
// byte-exact scrub fixtures keep exercising real fs writes.
const atomicControl: {
  failAll?: Error;
  failPathIncludes?: { needle: string; err: Error };
} = {};
vi.mock('@mmnto/totem/fs-atomic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mmnto/totem/fs-atomic')>();
  const writeFileAtomicSync = ((...args: Parameters<typeof actual.writeFileAtomicSync>) => {
    if (atomicControl.failAll) throw atomicControl.failAll;
    if (atomicControl.failPathIncludes && args[0].includes(atomicControl.failPathIncludes.needle)) {
      throw atomicControl.failPathIncludes.err;
    }
    return actual.writeFileAtomicSync(...args);
  }) as typeof actual.writeFileAtomicSync;
  return { ...actual, writeFileAtomicSync };
});

// Default seam behavior for the plain-checkout fixtures every describe below
// builds: git root = cwd, hooks dir = <root>/.git/hooks. Re-established before
// EVERY test (file-scope hook runs before each describe-scope hook); the
// worktree/anchoring/unresolvable cases override it in the test body.
beforeEach(() => {
  vi.mocked(resolveGitRootForHookPath).mockImplementation((c: string) => ({
    gitRoot: c,
    unparseablePointer: false,
  }));
  vi.mocked(resolveHooksDir).mockImplementation((root: string) => path.join(root, '.git', 'hooks'));
  vi.mocked(safeExec).mockReturnValue('');
  atomicControl.failAll = undefined;
  atomicControl.failPathIncludes = undefined;
});

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
    cleanTmpDir(cwd);
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

  it('ejectsSessionStartCjsCorrectly — removes both the .cjs successor and the legacy .js (mmnto-ai/totem#2488)', async () => {
    // An upgraded-then-ejected consumer can carry BOTH: the `.cjs` this version
    // distributes and a pre-#2488 `.js` a partial migration left behind. Eject must
    // leave no fail-open artifact of either shape.
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    const owned = '// [totem] auto-generated — Gemini CLI SessionStart hook\nconsole.log("hi");';
    fs.writeFileSync(path.join(hookDir, 'SessionStart.cjs'), owned);
    fs.writeFileSync(path.join(hookDir, 'SessionStart.js'), owned);

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(false);
    expect(fs.existsSync(path.join(hookDir, 'SessionStart.js'))).toBe(false);
  });

  it('leaves a user-owned SessionStart.cjs (no Totem marker) in place', async () => {
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'SessionStart.cjs'), 'console.log("user hook");');

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(true);
  });

  it('leaves a user-owned hook whose FIRST line quotes the marker mid-sentence', async () => {
    // Prefix-anchored ownership: the first line must BE a generated header, not
    // merely mention the marker (CR round 2 on mmnto-ai/totem#2488's PR).
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, 'SessionStart.cjs'),
      '// my hook, replaces the "[totem] auto-generated" managed version\nconsole.log("mine");\n',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(true);
  });

  it('leaves a user-owned hook that merely QUOTES the totem marker in its body', async () => {
    // Ownership = marker in the FIRST LINE. A hand-written hook citing the managed
    // version it replaced would die under a whole-body substring gate (CR review on
    // mmnto-ai/totem#2488's PR).
    const hookDir = path.join(cwd, '.gemini', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, 'SessionStart.cjs'),
      '// my own session hook\n// replaces the "[totem] auto-generated" managed version\nconsole.log("mine");\n',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(true);
  });

  it('still removes a scaffolded skill whose marker opens in HTML-comment shape', async () => {
    // The markdown skills open `<!-- [totem] auto-generated … -->`, not `// …` —
    // the first-line gate must match both shapes.
    const skillDir = path.join(cwd, '.gemini', 'skills');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'totem.md'),
      '<!-- [totem] auto-generated — Totem Architect skill -->\n# Totem\nbody\n',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(skillDir, 'totem.md'))).toBe(false);
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

  // ─── Marker-bounded reflex scrub (mmnto-ai/totem#2602) ─────────────
  // The span AFTER the end marker is contractually user content (the same span
  // regen preserves byte-exactly since the regen-idempotence fix). The
  // heading-to-EOF scrub deleted it and left an orphan start+version pair.

  it('preserves user content below the end marker and removes exactly the block (marker era)', async () => {
    const claudePath = path.join(cwd, 'CLAUDE.md');
    fs.writeFileSync(
      claudePath,
      '# CLAUDE.md\n' + AI_PROMPT_BLOCK + '\n## My Custom Section\n\nDo not delete this!\n',
    );

    await ejectCommand({ force: true });

    expect(fs.readFileSync(claudePath, 'utf-8')).toBe(
      '# CLAUDE.md\n\n## My Custom Section\n\nDo not delete this!\n',
    );
  });

  it('scrubs a file that is nothing but the block down to empty (marker at byte 0)', async () => {
    const claudePath = path.join(cwd, 'CLAUDE.md');
    fs.writeFileSync(claudePath, AI_PROMPT_BLOCK);

    await ejectCommand({ force: true });

    expect(fs.readFileSync(claudePath, 'utf-8')).toBe('');
  });

  it('leaves a file with an ORPHAN start marker byte-untouched (never heading-to-EOF)', async () => {
    // This is exactly the corrupt-but-green state the pre-fix eject left behind:
    // start + version markers with no end marker, heading inside, user content
    // below. A heading-to-EOF scrub here would re-enact the data loss.
    const claudePath = path.join(cwd, 'CLAUDE.md');
    const corrupt =
      '# CLAUDE.md\n\n' +
      REFLEX_START +
      '\n<!-- totem:reflexes:version:10 -->\n\n## Totem AI Integration (Auto-Generated)\nblock body\n\n## My Custom Section\n\nDo not delete this!\n';
    fs.writeFileSync(claudePath, corrupt);

    await ejectCommand({ force: true });

    expect(fs.readFileSync(claudePath, 'utf-8')).toBe(corrupt);
  });

  it('scrubs every tool-table reflex file, not just CLAUDE.md/.cursorrules', async () => {
    // The roster is derived from AI_TOOLS — the pre-fix hardcoded pair silently
    // skipped GEMINI.md, .junie/guidelines.md, and .github/copilot-instructions.md.
    const rels = ['GEMINI.md', '.junie/guidelines.md', '.github/copilot-instructions.md'];
    for (const rel of rels) {
      const p = path.join(cwd, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '# Head\n' + AI_PROMPT_BLOCK);
    }

    await ejectCommand({ force: true });

    for (const rel of rels) {
      expect(fs.readFileSync(path.join(cwd, ...rel.split('/')), 'utf-8'), rel).toBe('# Head\n');
    }
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

  // Phase C slice 1 (mmnto-ai/totem#1845) added committed `.claude/settings.json`
  // SessionStart eject parity. Same PR closes mmnto-ai/totem#1852 by also
  // scrubbing the Phase B PreWriteShield entry from the same file. Both
  // entries must be removed without disturbing user-defined hooks.
  it('scrubs SessionStart entry from committed Claude settings.json', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: 'node .claude/hooks/SessionStart.cjs' }] },
              { hooks: [{ type: 'command', command: 'echo "user-defined"' }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    await ejectCommand({ force: true });

    const updated = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    expect(updated.hooks.SessionStart).toHaveLength(1);
    expect(updated.hooks.SessionStart[0].hooks[0].command).toBe('echo "user-defined"');
  });

  it('scrubs PreWriteShield entry from committed Claude settings.json (closes #1852)', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [{ type: 'command', command: 'node .claude/hooks/PreWriteShield.cjs' }],
              },
              {
                matcher: 'Write',
                hooks: [{ type: 'command', command: 'echo "user-defined"' }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    await ejectCommand({ force: true });

    const updated = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    expect(updated.hooks.PreToolUse).toHaveLength(1);
    expect(updated.hooks.PreToolUse[0].matcher).toBe('Write');
  });

  it('scrubs both PreWriteShield and SessionStart entries in one pass, leaving file empty', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [{ type: 'command', command: 'node .claude/hooks/PreWriteShield.cjs' }],
              },
            ],
            SessionStart: [
              { hooks: [{ type: 'command', command: 'node .claude/hooks/SessionStart.cjs' }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    await ejectCommand({ force: true });

    // Both entries gone → both arrays empty → both keys deleted → hooks
    // empty → hooks key deleted → file empty {} → file unlinked.
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(false);
  });

  it('removes scaffolded .claude/hooks/SessionStart.cjs and PreWriteShield.cjs files', async () => {
    const hookDir = path.join(cwd, '.claude', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, 'SessionStart.cjs'),
      '// [totem] auto-generated — Claude Code SessionStart hook\nconsole.log("hi");',
    );
    fs.writeFileSync(
      path.join(hookDir, 'PreWriteShield.cjs'),
      '// [totem] auto-generated — Claude Code PreWriteShield hook\nconsole.log("hi");',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(false);
    expect(fs.existsSync(path.join(hookDir, 'PreWriteShield.cjs'))).toBe(false);
  });

  it('does not remove .claude/hooks/SessionStart.cjs if user-authored (no Totem marker)', async () => {
    const hookDir = path.join(cwd, '.claude', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, 'SessionStart.cjs'),
      'console.log("user-authored, no marker");',
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(hookDir, 'SessionStart.cjs'))).toBe(true);
  });

  it('skips committed Claude settings.json when JSON root is not an object (e.g., array, string, null)', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    // A `.claude/settings.json` consisting of just `[]` parses successfully
    // but isn't a config object — eject must skip it cleanly without
    // crashing on the implicit Object property access.
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), '[]');

    await ejectCommand({ force: true });

    // File should still exist (eject skipped, didn't mutate)
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(true);
    expect(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8')).toBe('[]');
  });

  it('skips committed Claude settings.json when hooks key is malformed (string instead of object)', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ hooks: 'unexpected-string' }),
    );

    await ejectCommand({ force: true });

    // File should still exist (eject skipped, didn't crash)
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(true);
  });

  it('skips entries when hooks.PreToolUse is a non-array (e.g., null) without crashing', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: null,
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node .claude/hooks/SessionStart.cjs' }] },
          ],
        },
      }),
    );

    await ejectCommand({ force: true });

    // SessionStart still scrubbed even though PreToolUse was malformed.
    const updated = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    // After mutation: SessionStart removed, PreToolUse:null preserved as
    // unexpected-shape input. The file may or may not exist depending on
    // pruning; if it does, it must not contain the SessionStart entry.
    expect(updated.hooks?.SessionStart).toBeUndefined();
  });

  it('preserves user-defined permissions and unrelated keys in committed Claude settings.json', async () => {
    const settingsDir = path.join(cwd, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: { allow: ['Bash'] },
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: 'node .claude/hooks/SessionStart.cjs' }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    await ejectCommand({ force: true });

    const updated = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf-8'));
    expect(updated.permissions).toBeDefined();
    expect(updated.permissions.allow).toEqual(['Bash']);
    expect(updated.hooks).toBeUndefined();
  });

  it('removes post-merge hook with new conditional format (if/fi block)', async () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
# [totem] post-merge hook — background re-index after pull/merge.

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-merge
`,
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('preserves non-Totem content when scrubbing new conditional format', async () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
echo "my custom hook"
# [totem] post-merge hook — background re-index after pull/merge.

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-merge
`,
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('my custom hook');
    expect(content).not.toContain('[totem]');
    expect(content).not.toContain('ORIG_HEAD');
    expect(content).not.toContain('fi');
  });
});

// ─── scrubPostMergeHook (direct unit tests) ─────────

describe('scrubPostMergeHook', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  it('scrubs new conditional hook format (if/fi block)', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
# [totem] post-merge hook — background re-index after pull/merge.

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-merge
`,
    );

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(summary.removed).toContain(
      '.git/hooks/post-merge (pre-removal bytes: .git/hooks/post-merge.totem-bak)',
    );
  });

  it('scrubs old unconditional hook format', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\n# [totem] post-merge hook — background re-index after pull/merge.\n\necho "[totem] Triggering background re-index..."\n(pnpm exec totem sync --incremental > .git/totem-sync.log 2>&1) &\n',
    );

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(summary.removed).toContain(
      '.git/hooks/post-merge (pre-removal bytes: .git/hooks/post-merge.totem-bak)',
    );
  });

  it('preserves non-totem content when scrubbing', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
echo "deploy notification"
# [totem] post-merge hook — background re-index after pull/merge.

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-merge
`,
    );

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('deploy notification');
    expect(content).not.toContain('[totem]');
    expect(summary.scrubbed).toContain(
      '.git/hooks/post-merge (pre-scrub bytes: .git/hooks/post-merge.totem-bak)',
    );
  });
});

// ─── scrubPostCheckoutHook (direct unit tests) ──────

describe('scrubPostCheckoutHook', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  it('removes post-checkout hook with end marker', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
# [totem] post-checkout hook — background re-index on branch switch.

# $1 = previous HEAD, $2 = new HEAD, $3 = checkout type (1=branch, 0=file)
# Skip file checkouts — only sync on branch switches
if [ "$3" = "0" ]; then
  exit 0
fi

# Only sync when .totem/ files differ between branches
if git diff --name-only "$1" "$2" 2>/dev/null | grep -q '\\.totem/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-checkout
`,
    );

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostCheckoutHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(summary.removed).toContain(
      '.git/hooks/post-checkout (pre-removal bytes: .git/hooks/post-checkout.totem-bak)',
    );
  });

  it('preserves non-Totem content in post-checkout hook', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh
echo "deploy notification"
# [totem] post-checkout hook — background re-index on branch switch.

# $1 = previous HEAD, $2 = new HEAD, $3 = checkout type (1=branch, 0=file)
if [ "$3" = "0" ]; then
  exit 0
fi

if git diff --name-only "$1" "$2" 2>/dev/null | grep -q '\\.totem/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-checkout
`,
    );

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostCheckoutHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('deploy notification');
    expect(content).not.toContain('[totem]');
    expect(summary.scrubbed).toContain(
      '.git/hooks/post-checkout (pre-scrub bytes: .git/hooks/post-checkout.totem-bak)',
    );
  });
});

describe('eject — distributed Claude skills (mmnto-ai/totem#1890 Phase C slice 3)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(cwd);
  });

  function writeSkill(name: string, body: string): string {
    const filePath = path.join(cwd, '.claude', 'skills', name, 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body, 'utf-8');
    return filePath;
  }

  it('removes signoff, signon, and review-reply SKILL.md files when markers are present', async () => {
    const signoffPath = writeSkill(
      'signoff',
      `---\nname: signoff\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );
    const signonPath = writeSkill(
      'signon',
      `---\nname: signon\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );
    const reviewReplyPath = writeSkill(
      'review-reply',
      `---\nname: review-reply\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(signoffPath)).toBe(false);
    expect(fs.existsSync(signonPath)).toBe(false);
    expect(fs.existsSync(reviewReplyPath)).toBe(false);
  });

  it('prunes empty per-skill directories and the skills root after removal', async () => {
    writeSkill(
      'signoff',
      `---\nname: signoff\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );
    writeSkill(
      'signon',
      `---\nname: signon\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );
    writeSkill(
      'review-reply',
      `---\nname: review-reply\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'signoff'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'signon'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'review-reply'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude', 'skills'))).toBe(false);
  });

  it('preserves user-authored skill files without markers', async () => {
    const customPath = writeSkill('signoff', '# my custom signoff\n\ndo it differently\n');

    await ejectCommand({ force: true });

    expect(fs.existsSync(customPath)).toBe(true);
    expect(fs.readFileSync(customPath, 'utf-8')).toContain('do it differently');
  });

  it('preserves the skills root if a non-distributed skill remains', async () => {
    writeSkill(
      'signoff',
      `---\nname: signoff\n---\n\n${SKILL_MARKER_START}\nbody\n${SKILL_MARKER_END}\n`,
    );
    // User has their own skill not managed by totem
    const customSkill = writeSkill('panel-audit', '# Custom panel audit skill\n');

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'signoff'))).toBe(false);
    expect(fs.existsSync(customSkill)).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.claude', 'skills'))).toBe(true);
  });
});

// ─── resolveEjectHooksContext (mmnto-ai/totem#2426) ─────────
//
// The seam eject uses to decide WHERE the git hooks are and whether they are
// SHARED. Driven with the mocked resolvers (no real git); the `.git`-shape check
// is a real filesystem probe on the fixtures.

describe('resolveEjectHooksContext', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2426-ctx-'));
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it('plain checkout (.git DIRECTORY): resolves the hooks dir, not a worktree', async () => {
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    const ctx = await resolveEjectHooksContext(dir);
    expect(ctx.isLinkedWorktree).toBe(false);
    expect(ctx.hooksDir).toBe(path.join(dir, '.git', 'hooks'));
  });

  it('linked worktree (.git POINTER FILE): flagged as shared across worktrees', async () => {
    // A `.git` FILE is the gitdir pointer git writes for a linked worktree.
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    // The shared hooks dir git would resolve for it (mocked — no real git walk).
    vi.mocked(resolveHooksDir).mockReturnValue('/elsewhere/.git/hooks');
    const ctx = await resolveEjectHooksContext(dir);
    expect(ctx.isLinkedWorktree).toBe(true);
    expect(ctx.hooksDir).toBe('/elsewhere/.git/hooks');
  });

  it('not a git repo / unparseable pointer (null root): null hooks dir, not a worktree', async () => {
    vi.mocked(resolveGitRootForHookPath).mockReturnValue({
      gitRoot: null,
      unparseablePointer: true,
    });
    const ctx = await resolveEjectHooksContext(dir);
    expect(ctx.hooksDir).toBeNull();
    expect(ctx.isLinkedWorktree).toBe(false);
  });

  it('best-effort: a resolver throw degrades to unresolvable, never propagates', async () => {
    vi.mocked(resolveGitRootForHookPath).mockImplementation(() => {
      throw new Error('git broke');
    });
    const ctx = await resolveEjectHooksContext(dir);
    expect(ctx.hooksDir).toBeNull();
    expect(ctx.isLinkedWorktree).toBe(false);
  });
});

// ─── ejectCommand git-hook resolution (mmnto-ai/totem#2426) ─────────
//
// The three behaviors the fix adds on top of the plain-checkout scrub the
// existing suite already covers: the worktree SHARED-hooks decline (the
// conservative semantics ruling), git-root anchoring from a subdirectory, and
// the unresolvable-dir skip.

describe('ejectCommand git-hook resolution (mmnto-ai/totem#2426)', () => {
  let originalCwd: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const errorOutput = (): string =>
    errorSpy.mock.calls
      .map((c: unknown[]) => c.map((a: unknown) => String(a)).join(' '))
      .join('\n');

  beforeEach(() => {
    originalCwd = process.cwd();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    errorSpy.mockRestore();
  });

  it('DECLINES to scrub the SHARED hooks from a linked worktree, leaving them intact', async () => {
    // Main checkout: a real `.git` DIRECTORY holding an installed totem post-merge hook.
    const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2426-main-'));
    const mainHooks = path.join(mainDir, '.git', 'hooks');
    fs.mkdirSync(mainHooks, { recursive: true });
    const sharedHook = path.join(mainHooks, 'post-merge');
    fs.writeFileSync(
      sharedHook,
      '#!/bin/sh\n# [totem] post-merge hook — background re-index after pull/merge.\n\n# [totem] end post-merge\n',
    );

    // Worktree: `.git` is a POINTER FILE; its hooks RESOLVE to the shared dir.
    const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2426-wt-'));
    fs.writeFileSync(
      path.join(wtDir, '.git'),
      `gitdir: ${path.join(mainDir, '.git', 'worktrees', 'wt')}\n`,
    );
    vi.mocked(resolveHooksDir).mockReturnValue(mainHooks);

    process.chdir(wtDir);
    try {
      await expect(ejectCommand({ force: true })).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }

    // The shared hook is UNTOUCHED — eject declined rather than mutate shared state.
    expect(fs.existsSync(sharedHook)).toBe(true);
    const out = errorOutput();
    expect(out).toContain('shared git directory');
    expect(out).toContain('run `totem eject` from the main working tree');

    cleanTmpDir(wtDir);
    cleanTmpDir(mainDir);
  });

  it('anchors at the git root when run from a subdirectory (not the blind cwd/.git join)', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2426-anchor-'));
    const hooksDir = path.join(repoRoot, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'post-merge'),
      '#!/bin/sh\n# [totem] post-merge hook — background re-index after pull/merge.\n\n# [totem] end post-merge\n',
    );
    const subdir = path.join(repoRoot, 'packages', 'x');
    fs.mkdirSync(subdir, { recursive: true });

    // What real git does from a subdirectory: resolve UP to the repo root.
    vi.mocked(resolveGitRootForHookPath).mockReturnValue({
      gitRoot: repoRoot,
      unparseablePointer: false,
    });
    vi.mocked(resolveHooksDir).mockReturnValue(hooksDir);

    process.chdir(subdir);
    try {
      await ejectCommand({ force: true });
    } finally {
      process.chdir(originalCwd);
    }

    // The hook at the RESOLVED root is removed — not missed because cwd was a subdir.
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(false);

    cleanTmpDir(repoRoot);
  });

  it('reports the hooks dir as unresolvable (not-a-repo / bad pointer) without crashing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2426-unres-'));
    vi.mocked(resolveGitRootForHookPath).mockReturnValue({
      gitRoot: null,
      unparseablePointer: true,
    });
    vi.mocked(resolveHooksDir).mockReturnValue(null);

    process.chdir(dir);
    try {
      await expect(ejectCommand({ force: true })).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }

    expect(errorOutput()).toContain('git hooks directory could not be resolved');

    cleanTmpDir(dir);
  });
});

// ─── scrubReflexFiles — pairing, residue, legacy boundary ─────────────
// Direct-drive summary-contract tests from the mmnto-ai/totem#2602
// falsification round: END-anchored pairing, the removal loop, residue
// reporting, and the legacy next-H2 boundary.

describe('scrubReflexFiles — marker pairing, residue, and legacy boundary', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  function freshSummary(): EjectSummary {
    return { removed: [], scrubbed: [], skipped: [] };
  }

  function write(rel: string, content: string): string {
    const p = path.join(cwd, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('an orphan START above a complete pair never widens the span — content between them survives', async () => {
    // The orphan head is exactly the corrupt state the pre-fix eject produced;
    // a later re-init appended a fresh complete block below it (upgradeReflexes
    // Case 3). First-occurrence pairing deleted everything between the orphan
    // and the real block's END.
    const orphanHead =
      '# Head\n\n' +
      REFLEX_START +
      '\n<!-- totem:reflexes:version:9 -->\n\n## My Custom Section\n\nDo not delete this!\n';
    const p = write('CLAUDE.md', orphanHead + AI_PROMPT_BLOCK);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe(orphanHead);
    expect(summary.scrubbed).toEqual(['CLAUDE.md (marker residue remains — remove manually)']);
  });

  it('double-injection damage clears — both complete blocks removed, none left behind a green line', async () => {
    const p = write('CLAUDE.md', '# Head\n' + AI_PROMPT_BLOCK + AI_PROMPT_BLOCK);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe('# Head\n');
    expect(summary.scrubbed).toEqual(['CLAUDE.md']);
  });

  it('inverted markers (END above START) are residue: file byte-untouched and reported', async () => {
    const corrupt = '# Head\n\n' + REFLEX_END + '\nmiddle\n' + REFLEX_START + '\n';
    const p = write('CLAUDE.md', corrupt);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe(corrupt);
    expect(summary.skipped).toEqual([
      'CLAUDE.md (reflex marker residue — not scrubbed; remove manually, else init keeps reading the file as current)',
    ]);
  });

  it('legacy block is bounded at the next non-Totem H2, not EOF — user content below survives', async () => {
    const p = write(
      'CLAUDE.md',
      '# My Project\n\nSome instructions.\n\n## Totem AI Integration (Auto-Generated)\nblock body\n\n## My Custom Section\n\nDo not delete this!\n',
    );
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe(
      '# My Project\n\nSome instructions.\n\n## My Custom Section\n\nDo not delete this!\n',
    );
    expect(summary.scrubbed).toEqual(['CLAUDE.md']);
  });

  it('a bare legacy heading in a post-marker-era roster file is user-authored — byte-untouched', async () => {
    // GEMINI.md joined the tool table after markers shipped, so a totem-written
    // marker-less block there is impossible; heading-to-EOF on it could only
    // ever eat a user's hand-authored section.
    const userAuthored =
      '# Gemini notes\n\n## Totem AI Integration (Auto-Generated)\nI hand-copied this section.\n';
    const p = write('GEMINI.md', userAuthored);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe(userAuthored);
    expect(summary.skipped).toEqual(['GEMINI.md (no Totem block)']);
  });

  it("a user's own '## Totem Memory Reflexes…' H2 below a legacy block terminates the span (init Case 2 boundary, verbatim)", async () => {
    // Both injector generations guarded on the absence of "Totem Memory
    // Reflexes" before writing, so a second Totem-titled H2 below the block is
    // always user-authored — it must bound the scrub, not be eaten by it.
    const p = write(
      'CLAUDE.md',
      '# P\n\n## Totem AI Integration (Auto-Generated)\nblock body\n\n## Totem Memory Reflexes tips\n\nmy notes\n',
    );
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe('# P\n\n## Totem Memory Reflexes tips\n\nmy notes\n');
  });

  it('the removal loop preserves user content BETWEEN two complete blocks', async () => {
    const p = write('CLAUDE.md', '# Head\n' + AI_PROMPT_BLOCK + 'USER-MID\n' + AI_PROMPT_BLOCK);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe('# Head\nUSER-MID\n');
    expect(summary.scrubbed).toEqual(['CLAUDE.md']);
  });

  it('a legacy block at byte 0 does not mint a leading blank line above the surviving user section', async () => {
    const p = write(
      'CLAUDE.md',
      '## Totem AI Integration (Auto-Generated)\nbody\n\n## User Section\n\nkeep me\n',
    );
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe('## User Section\n\nkeep me\n');
  });

  it('a leading orphan END does not halt the scan — the complete pair below it is still removed', async () => {
    // "Loops until no complete pair remains" must hold even when an unpaired
    // END sits above the real block (GCA round on this PR): the orphan stays
    // residue, the well-formed block goes.
    const residueHead = '# Head\n\n' + REFLEX_END + '\nuser between\n';
    const p = write('CLAUDE.md', residueHead + AI_PROMPT_BLOCK);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe(residueHead);
    expect(summary.scrubbed).toEqual(['CLAUDE.md (marker residue remains — remove manually)']);
  });

  it('an unreadable roster entry degrades to a could-not-scrub skip and later files still scrub', async () => {
    // A DIRECTORY at CLAUDE.md makes readFileSync throw (EISDIR class) — the
    // per-file best-effort contract: report the skip, keep going (CR round on
    // this PR; live-verified for EISDIR and EPERM on the falsification round).
    fs.mkdirSync(path.join(cwd, 'CLAUDE.md'));
    const geminiPath = write('GEMINI.md', '# Head\n' + AI_PROMPT_BLOCK);
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0]).toMatch(/^CLAUDE\.md \(could not scrub: /);
    expect(fs.readFileSync(geminiPath, 'utf-8')).toBe('# Head\n');
    expect(summary.scrubbed).toEqual(['GEMINI.md']);
  });

  it('the retired pre-marker target .gemini/gemini.md still gets its legacy block scrubbed', async () => {
    const p = write(
      '.gemini/gemini.md',
      '# Old gemini\n\n## Totem AI Integration (Auto-Generated)\nold body\n',
    );
    const summary = freshSummary();

    await scrubReflexFiles(cwd, summary);

    expect(fs.readFileSync(p, 'utf-8')).toBe('# Old gemini\n');
    expect(summary.scrubbed).toEqual(['.gemini/gemini.md']);
  });
});

// ─── Rule-3 recovery artifact + rule-2 sense + Tenet-4 backstop (mmnto-ai/totem#2620) ───

describe('scrubHook recovery artifact (User-File Mutation Contract rule 3)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  const MIXED_HOOK = `#!/bin/sh
echo "deploy notification"
# [totem] post-merge hook — background re-index after pull/merge.

if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  (pnpm exec totem sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# [totem] end post-merge
`;

  const TOTEM_ONLY_HOOK = `#!/bin/sh
# [totem] post-merge hook — background re-index after pull/merge.

echo "[totem] Triggering background re-index..."
(pnpm exec totem sync --incremental > .git/totem-sync.log 2>&1) &
`;

  it('partial scrub writes the bak with exact pre-mutation bytes BEFORE mutating', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hookPath, MIXED_HOOK);

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.readFileSync(`${hookPath}.totem-bak`, 'utf-8')).toBe(MIXED_HOOK);
    expect(fs.readFileSync(hookPath, 'utf-8')).not.toContain('[totem]');
    expect(summary.scrubbed).toContain(
      '.git/hooks/post-merge (pre-scrub bytes: .git/hooks/post-merge.totem-bak)',
    );
  });

  it('full-removal path baks too — surface class, not content claim (intent-read Q1)', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hookPath, TOTEM_ONLY_HOOK);

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(fs.readFileSync(`${hookPath}.totem-bak`, 'utf-8')).toBe(TOTEM_ONLY_HOOK);
  });

  it('bak failure skips the mutation entirely — recovery-before-mutation is load-bearing', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hookPath, MIXED_HOOK);
    atomicControl.failPathIncludes = {
      needle: '.totem-bak',
      err: Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' }),
    };

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(MIXED_HOOK);
    expect(fs.existsSync(`${hookPath}.totem-bak`)).toBe(false);
    expect(summary.scrubbed).toEqual([]);
    expect(summary.removed).toEqual([]);
    expect(
      summary.skipped.some((s) => s.includes('recovery backup failed — hook left untouched')),
    ).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('bak carries the source hook mode (0755)', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'post-merge');
    fs.writeFileSync(hookPath, MIXED_HOOK);
    fs.chmodSync(hookPath, 0o755);

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    scrubPostMergeHook(path.join(cwd, '.git', 'hooks'), summary);

    expect(fs.statSync(`${hookPath}.totem-bak`).mode & 0o7777).toBe(0o755);
    expect(fs.statSync(hookPath).mode & 0o7777).toBe(0o755);
  });
});

describe('deriveDirtyTreeSense (User-File Mutation Contract rule 2)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  it('clean tree: no lines, no dirty paths', async () => {
    vi.mocked(safeExec).mockReturnValue('');
    const sense = await deriveDirtyTreeSense(cwd);
    expect(sense.dirty).toEqual([]);
    expect(sense.lines).toEqual([]);
  });

  it('dirty roster paths: says which files have no revert point, never blocks', async () => {
    vi.mocked(safeExec).mockReturnValue(' M CLAUDE.md\n?? .totem/');
    const sense = await deriveDirtyTreeSense(cwd);
    expect(sense.dirty).toHaveLength(2);
    expect(sense.lines[0]).toContain('Uncommitted changes in 2 path(s)');
    expect(sense.lines.join('\n')).toContain('CLAUDE.md');
    expect(sense.lines.join('\n')).toContain('.totem/');
  });

  it('roster derives from the shared constants — deletions count (intent-read Q3)', async () => {
    vi.mocked(safeExec).mockReturnValue('');
    await deriveDirtyTreeSense(cwd);

    const [cmd, args] = vi.mocked(safeExec).mock.calls[0] as [string, string[]];
    expect(cmd).toBe('git');
    expect(args).toContain('--porcelain');
    // Scrub targets AND delete targets ride one derived roster.
    expect(args).toContain('CLAUDE.md');
    expect(args).toContain('.claude/settings.json');
    expect(args).toContain('.gemini/hooks/SessionStart.cjs');
    expect(args).toContain('.totem');
    expect(args).toContain('totem.config.ts');
  });

  it('not a git repository: honest no-revert-point line, still proceeds', async () => {
    vi.mocked(safeExec).mockImplementation(() => {
      throw new Error(
        'Command failed: git status --porcelain\nfatal: not a git repository (or any of the parent directories): .git',
      );
    });
    const sense = await deriveDirtyTreeSense(cwd);
    expect(sense.dirty).toEqual([]);
    expect(sense.lines).toEqual([
      'Not a git repository — files eject modifies here have no VCS revert point.',
    ]);
  });

  it('underivable VCS state: honest could-not-derive line, still proceeds', async () => {
    vi.mocked(safeExec).mockImplementation(() => {
      throw new Error('Command failed: git status --porcelain\nfatal: unable to read tree');
    });
    const sense = await deriveDirtyTreeSense(cwd);
    expect(sense.dirty).toEqual([]);
    expect(sense.lines).toHaveLength(1);
    expect(sense.lines[0]).toContain('Could not derive VCS state');
  });
});

describe('scrubReflexFiles loud backstop (Tenet 4 licensed shape, #2620 leg finding 4)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(cwd);
  });

  const markerBlock = (body: string): string =>
    `# My project\n\n${REFLEX_START}\n${body}\n${REFLEX_END}\n`;

  it('every attempted scrub failing throws EJECT_FAILED instead of exiting clean', async () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), markerBlock('claude body'));
    atomicControl.failAll = Object.assign(new Error('EPERM: injected'), { code: 'EPERM' });

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    await expect(scrubReflexFiles(cwd, summary)).rejects.toThrow(
      /all 1 reflex-file scrub attempt\(s\) failed/,
    );
    // Per-item accounting still fired before the backstop threw.
    expect(summary.skipped.some((s) => s.includes('could not scrub'))).toBe(true);
  });

  it('partial success does NOT trip the backstop — per-item accounting covers it', async () => {
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), markerBlock('claude body'));
    fs.writeFileSync(path.join(cwd, 'GEMINI.md'), markerBlock('gemini body'));
    atomicControl.failPathIncludes = {
      needle: 'GEMINI.md',
      err: Object.assign(new Error('EPERM: injected'), { code: 'EPERM' }),
    };

    const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };
    await scrubReflexFiles(cwd, summary);

    expect(summary.scrubbed).toContain('CLAUDE.md');
    expect(summary.skipped.some((s) => s.startsWith('GEMINI.md (could not scrub'))).toBe(true);
  });
});
