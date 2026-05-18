import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fixtures: unified-diff snippets covering the gate's matrix.

const CARET_BUMP_DIFF = `diff --git a/package.json b/package.json
index aaaaaa..bbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,7 @@
   "dependencies": {
-    "@mmnto/cli": "^1.43.2",
+    "@mmnto/cli": "^1.43.3",
     "zod": "^3.22.0"
   }
`;

const NESTED_PKG_BUMP_DIFF = `diff --git a/apps/web/package.json b/apps/web/package.json
index aaaaaa..bbbbbb 100644
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -5,5 +5,5 @@
   "dependencies": {
-    "foo": "^1.2.3",
+    "foo": "^1.2.4",
   }
`;

const DELETIONS_ONLY_DIFF = `diff --git a/package.json b/package.json
index aaaaaa..bbbbbb 100644
--- a/package.json
+++ b/package.json
@@ -10,8 +10,7 @@
   "dependencies": {
-    "removed-dep": "^1.2.3",
     "kept": "^2.0.0"
   }
`;

const VERSION_FIELD_ONLY_DIFF = `diff --git a/packages/cli/package.json b/packages/cli/package.json
index aaaaaa..bbbbbb 100644
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -1,6 +1,6 @@
 {
   "name": "@mmnto/cli",
-  "version": "1.43.2",
+  "version": "1.43.3",
   "type": "module",
`;

const WORKSPACE_REF_DIFF = `diff --git a/packages/cli/package.json b/packages/cli/package.json
index aaaaaa..bbbbbb 100644
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -10,6 +10,7 @@
   "dependencies": {
+    "@mmnto/totem": "workspace:^",
     "commander": "^11.0.0"
   }
`;

describe('verifyLockfileSyncCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when not inside a git repo', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return { ...actual, resolveGitRoot: () => null };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when pnpm-lock.yaml is not tracked (gitignored or absent)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return ''; // not tracked
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when pnpm-lock.yaml is present in the diff range alongside the package.json bump', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'package.json\npnpm-lock.yaml';
          }
          if (args[0] === 'diff') return CARET_BUMP_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('fails when a nested apps/web/package.json bumps a dep and pnpm-lock.yaml is missing from the diff', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'apps/web/package.json';
          }
          if (args[0] === 'diff') return NESTED_PKG_BUMP_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/pnpm install/);
    expect(result.reason).toMatch(/pnpm-lock\.yaml/);
  });

  it('passes when package.json diff contains only deletions', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'package.json';
          if (args[0] === 'diff') return DELETIONS_ONLY_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when only the package "version" field changed (Version Packages release shape)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'packages/cli/package.json';
          }
          if (args[0] === 'diff') return VERSION_FIELD_ONLY_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when an added dependency uses a workspace:^ reference (no semver-pin shape)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'packages/cli/package.json';
          }
          if (args[0] === 'diff') return WORKSPACE_REF_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when no package.json files appear in the diff range', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'src/index.ts\nREADME.md';
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('fails on the cohort-sync caret bump shape when pnpm-lock.yaml is missing', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'package.json';
          if (args[0] === 'diff') return CARET_BUMP_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Run `pnpm install`/);
  });

  it('falls through to pass when getDefaultBranch throws (degraded git state)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => {
          throw new Error('detached HEAD / no remote');
        },
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('falls through to pass when both origin/<base> and local <base> diff lookups fail', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff') throw new Error('fatal: bad revision');
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });
});

describe('verifyLockfileSyncCliCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws TotemError when the underlying check fails', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'package.json';
          if (args[0] === 'diff') return CARET_BUMP_DIFF;
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCliCommand } = await import('./verify-lockfile-sync.js');
    await expect(verifyLockfileSyncCliCommand()).rejects.toThrow(/pnpm install/);
  });

  it('resolves cleanly when the underlying check passes', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return { ...actual, resolveGitRoot: () => null };
    });
    const { verifyLockfileSyncCliCommand } = await import('./verify-lockfile-sync.js');
    await expect(verifyLockfileSyncCliCommand()).resolves.toBeUndefined();
  });
});
