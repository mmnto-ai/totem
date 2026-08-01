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

// ─── Removed-pin fixtures (mmnto-ai/totem-strategy#630) ───
//
// Provenance: live-fire 2026-08-01, mmnto-ai/totem-strategy#630 comment
// 5152301962 — a failed optional-dependency fetch (dead registry token) removed
// every `@mmnto/strategy-doctrine` entry from pnpm-lock.yaml while package.json
// kept the pin, and `pnpm install` exited 0. The key shapes below are modeled on
// the real pnpm-lock.yaml entries: importer key (:48), packages key (:865),
// snapshots key (:3697).

const DOCTRINE_PIN_REMOVAL_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index aaaaaa..bbbbbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -44,9 +44,6 @@ importers:
     optionalDependencies:
       '@mmnto/cli':
         specifier: workspace:*
         version: link:packages/cli
-      '@mmnto/strategy-doctrine':
-        specifier: 0.1.28
-        version: 0.1.28
@@ -862,4 +859,1 @@ packages:

-  '@mmnto/strategy-doctrine@0.1.28':
-    resolution: {integrity: sha512-sxiE7gO3XK/kPx59f9ZJockuCdxcu9PN0Mqy2oCcTnFm1wnGu2uXC47u/tDOEHkWrLmG07i//ggfhcqqVS7baw==}
-
@@ -3694,4 +3688,1 @@ snapshots:

-  '@mmnto/strategy-doctrine@0.1.28':
-    optional: true
-
`;

// HEAD lockfile after the drop: the package resolves NOWHERE, which is what
// makes the removal decisive rather than a dedupe.
const HEAD_LOCKFILE_WITHOUT_DOCTRINE = `lockfileVersion: '9.0'

importers:

  .:
    optionalDependencies:
      '@mmnto/cli':
        specifier: workspace:*
        version: link:packages/cli

packages:

  '@mmnto/cli@1.60.0':
    resolution: {integrity: sha512-aaaa}

snapshots:

  '@mmnto/cli@1.60.0': {}
`;

// A pure version bump: the old key is removed and a new key for the SAME name is
// added in the same diff.
const DOCTRINE_VERSION_BUMP_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index aaaaaa..bbbbbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -44,7 +44,7 @@ importers:
       '@mmnto/strategy-doctrine':
-        specifier: 0.1.28
-        version: 0.1.28
+        specifier: 0.1.29
+        version: 0.1.29
@@ -862,4 +862,4 @@ packages:
-  '@mmnto/strategy-doctrine@0.1.28':
-    resolution: {integrity: sha512-aaaa}
+  '@mmnto/strategy-doctrine@0.1.29':
+    resolution: {integrity: sha512-bbbb}
@@ -3694,4 +3694,4 @@ snapshots:
-  '@mmnto/strategy-doctrine@0.1.28':
-    optional: true
+  '@mmnto/strategy-doctrine@0.1.29':
+    optional: true
`;

// A dedupe: one version's keys go away while the package still resolves at HEAD
// under another version.
const DEDUPE_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index aaaaaa..bbbbbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1200,4 +1200,1 @@ packages:
-  'ajv@6.15.0':
-    resolution: {integrity: sha512-aaaa}
-
@@ -4100,4 +4097,1 @@ snapshots:
-  'ajv@6.15.0': {}
-
`;

const HEAD_LOCKFILE_WITH_AJV_8 = `lockfileVersion: '9.0'

packages:

  'ajv@8.18.0':
    resolution: {integrity: sha512-bbbb}

snapshots:

  'ajv@8.18.0': {}
`;

// package.json contents at HEAD, keyed by tracked path — the `git grep` mock
// below searches these exactly as `git grep -F '"<name>":' HEAD` would.
const HEAD_PACKAGE_JSONS: Record<string, string> = {
  'package.json': `{
  "name": "totem",
  "optionalDependencies": {
    "@mmnto/strategy-doctrine": "0.1.28"
  },
  "dependencies": {
    "ajv": "^8.18.0"
  }
}`,
};

/**
 * Emulates `git show HEAD:<path>`: the lockfile blob, or a tracked manifest.
 * A path absent from `manifests` throws, exactly as git does.
 */
function showAtHead(
  args: string[],
  headLockfile: string,
  manifests: Record<string, string>,
): string {
  const ref = args[1] ?? '';
  if (ref === 'HEAD:pnpm-lock.yaml') return headLockfile;
  const content = manifests[ref.slice('HEAD:'.length)];
  if (content === undefined) throw new Error(`fatal: ${ref} does not exist in HEAD`);
  return content;
}

/**
 * Emulates `git grep -l -F` for the quoted key form over the tracked
 * package.json set at HEAD: prints the matching `HEAD:<path>` lines, and throws
 * on no match (git grep exits 1, which `safeExec` surfaces as a throw).
 */
function grepHeadPackageJsons(args: string[], sources: Record<string, string>): string {
  const pattern = args.find((arg) => arg.startsWith('"'));
  if (pattern === undefined) throw new Error('git grep called without a quoted-key pattern');
  const hits = Object.entries(sources)
    .filter(([, content]) => content.includes(pattern))
    .map(([file]) => `HEAD:${file}`);
  if (hits.length === 0) throw new Error('exit 1: no match');
  return hits.join('\n');
}

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
    expect(result.reason).toMatch(/Tracked lockfile detected/);
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
    expect(result.reason).toMatch(/Tracked lockfile detected/);
    expect(result.reason).toMatch(/package\.json adds a dependency pin/);
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

  // ─── Removed-pin gate (mmnto-ai/totem-strategy#630) ───

  it('fails when the lockfile diff drops every entry for a package still pinned at HEAD (live-fire positive control)', async () => {
    const grepCalls: string[][] = [];
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, HEAD_PACKAGE_JSONS);
          }
          if (args[0] === 'grep') {
            grepCalls.push(args);
            return grepHeadPackageJsons(args, HEAD_PACKAGE_JSONS);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/@mmnto\/strategy-doctrine/);
    // The declaration probe searches the QUOTED KEY form at HEAD, across the
    // root and every nested package.json.
    expect(grepCalls.length).toBeGreaterThan(0);
    expect(grepCalls[0]).toContain('"@mmnto/strategy-doctrine":');
    expect(grepCalls[0]).toContain('HEAD');
    expect(grepCalls[0]).toContain('package.json');
    expect(grepCalls[0]).toContain('**/package.json');
  });

  it('counts an optionalDependencies declaration in a NESTED package.json as declared', async () => {
    const nestedOnly = {
      'packages/app/package.json': `{
  "name": "@acme/app",
  "optionalDependencies": {
    "@mmnto/strategy-doctrine": "0.1.28"
  }
}`,
    };
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show')
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, nestedOnly);
          if (args[0] === 'grep') return grepHeadPackageJsons(args, nestedOnly);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/@mmnto\/strategy-doctrine/);
  });

  it('passes on a pure version bump (old key removed, new key for the same name added)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_VERSION_BUMP_DIFF;
          // Reaching either probe would mean the added-key filter failed.
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes on a legitimate removal (the declaration is gone from package.json at HEAD)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, {});
          // No package.json at HEAD declares the package any more.
          if (args[0] === 'grep') return grepHeadPackageJsons(args, {});
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes on a dedupe (the removed key is gone but the name still resolves at HEAD)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DEDUPE_DIFF;
          if (args[0] === 'show')
            return showAtHead(args, HEAD_LOCKFILE_WITH_AJV_8, HEAD_PACKAGE_JSONS);
          // Still declared — only the HEAD-lockfile resolution saves this case.
          if (args[0] === 'grep') return grepHeadPackageJsons(args, HEAD_PACKAGE_JSONS);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when the removed name only collides with a MANIFEST key (`type` vs "type": "module")', async () => {
    // `type` is a real npm package AND a package.json manifest key. A quoted-key
    // grep alone reports it "declared" from `"type": "module"` in every
    // manifest — a false block on a legitimate removal (mmnto-ai/totem#2473
    // class). Membership must be decided inside the dependency blocks.
    const typeRemovalDiff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1200,4 +1200,1 @@ packages:
-  type@2.7.3:
-    resolution: {integrity: sha512-aaaa}
-
@@ -4100,4 +4097,1 @@ snapshots:
-  type@2.7.3: {}
-
`;
    const manifestsWithTypeField = {
      'package.json': `{
  "name": "totem",
  "type": "module",
  "dependencies": {
    "ajv": "^8.18.0"
  }
}`,
      'packages/cli/package.json': `{
  "name": "@mmnto/cli",
  "type": "module",
  "devDependencies": {
    "vitest": "^4.0.0"
  }
}`,
    };
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return typeRemovalDiff;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, manifestsWithTypeField);
          }
          if (args[0] === 'grep') return grepHeadPackageJsons(args, manifestsWithTypeField);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('does not count an `overrides`-only pin as a dependency declaration', async () => {
    // An overrides entry constrains how some OTHER package's dependency
    // resolves; it is not itself an install-resolvable declaration, so its
    // disappearance from the lockfile is not the #630 class.
    const overridesOnly = {
      'package.json': `{
  "name": "totem",
  "pnpm": {
    "overrides": {
      "@mmnto/strategy-doctrine": "0.1.28"
    }
  }
}`,
    };
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, overridesOnly);
          }
          if (args[0] === 'grep') return grepHeadPackageJsons(args, overridesOnly);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('skips a prefilter hit whose manifest cannot be parsed at HEAD (per-file best-effort)', async () => {
    const brokenManifest = {
      'package.json': `{ "optionalDependencies": { "@mmnto/strategy-doctrine": "0.1.28" `,
    };
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, brokenManifest);
          }
          if (args[0] === 'grep') return grepHeadPackageJsons(args, brokenManifest);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when the diff removes a lockfile GRAMMAR key (last devDependency dropped)', async () => {
    // `devDependencies:` is valueless like a package key and would otherwise
    // become a candidate: absent from the HEAD lockfile, yet "declared" because
    // package.json still carries an (empty) devDependencies block.
    const lastDevDepDiff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -10,6 +10,1 @@ importers:
   .:
-    devDependencies:
-      vitest:
-        specifier: ^4.0.0
-        version: 4.0.0
`;
    const headPkgKeepsEmptyBlock = {
      'package.json': `{
  "name": "totem",
  "devDependencies": {}
}`,
    };
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return lastDevDepDiff;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, headPkgKeepsEmptyBlock);
          }
          if (args[0] === 'grep') return grepHeadPackageJsons(args, headPkgKeepsEmptyBlock);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('falls through to pass when the lockfile diff read fails (best-effort probe)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') throw new Error('fatal: bad object');
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('falls through to pass when the HEAD-lockfile probe fails (best-effort probe)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') throw new Error('fatal: path does not exist in HEAD');
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
    // The thrown TotemError's message describes the failure; the recovery
    // action (`pnpm install`) lives on recoveryHint, which the top-level
    // handleError prints under "Fix:" — separate-concerns per the codebase
    // pattern at verify-badges.ts:99-109.
    await expect(verifyLockfileSyncCliCommand()).rejects.toThrow(/Tracked lockfile detected/);
    try {
      await verifyLockfileSyncCliCommand();
    } catch (err) {
      expect((err as Error & { recoveryHint?: string }).recoveryHint).toMatch(/pnpm install/);
    }
  });

  it('carries the removed-pin recovery hint (distinct from the pin-add hint) on the #630 failure class', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) return 'pnpm-lock.yaml';
          if (args[0] === 'diff') return DOCTRINE_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, HEAD_PACKAGE_JSONS);
          }
          if (args[0] === 'grep') return grepHeadPackageJsons(args, HEAD_PACKAGE_JSONS);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCliCommand } = await import('./verify-lockfile-sync.js');
    const thrown = await verifyLockfileSyncCliCommand().then(
      () => null,
      (err: unknown) => err,
    );
    expect(thrown).toBeInstanceOf(Error);
    const hint = (thrown as Error & { recoveryHint?: string }).recoveryHint ?? '';
    expect(hint).toMatch(/npm whoami/);
    expect(hint).toMatch(/pnpm update/);
    expect(hint).toMatch(/--lockfile-only/);
    // The two failure classes must not share a remedy: this one must NOT send
    // the user to the plain `pnpm install` the pin-add class prescribes.
    expect(hint).not.toMatch(/Run `pnpm install` from the repo root/);
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
