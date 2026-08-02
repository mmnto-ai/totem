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

// The workspace at HEAD for the pin-add branch: importers `.`, `apps/web`, and
// `packages/cli`. Key forms match real pnpm emission — only scoped names are
// quoted; unscoped `packages:`/`snapshots:` keys are bare.
const HEAD_LOCKFILE_WORKSPACE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      '@mmnto/cli':
        specifier: ^1.43.2
        version: 1.43.2

  apps/web:
    dependencies:
      foo:
        specifier: ^1.2.3
        version: 1.2.3

  packages/cli:
    dependencies:
      commander:
        specifier: ^11.0.0
        version: 11.0.0

packages:

  '@mmnto/cli@1.43.2':
    resolution: {integrity: sha512-aaaa}
  commander@11.0.0:
    resolution: {integrity: sha512-bbbb}
  foo@1.2.3:
    resolution: {integrity: sha512-cccc}

snapshots:

  '@mmnto/cli@1.43.2': {}
  commander@11.0.0: {}
  foo@1.2.3: {}
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

// Same drop, but the workspace also has a `packages/app` importer.
const HEAD_LOCKFILE_WITH_APP_IMPORTER = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@mmnto/cli':
        specifier: workspace:*
        version: link:packages/cli

  packages/app:
    dependencies:
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
// added in the same diff. The HEAD lockfile still resolves the name.
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

const HEAD_LOCKFILE_WITH_DOCTRINE_29 = `lockfileVersion: '9.0'

importers:

  .:
    optionalDependencies:
      '@mmnto/strategy-doctrine':
        specifier: 0.1.29
        version: 0.1.29

packages:

  '@mmnto/strategy-doctrine@0.1.29':
    resolution: {integrity: sha512-bbbb}

snapshots:

  '@mmnto/strategy-doctrine@0.1.29': {}
`;

// A dedupe: one version's keys go away while the package still resolves at HEAD
// under another version. Unscoped keys are BARE — real pnpm quotes only names
// that need it.
const DEDUPE_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index aaaaaa..bbbbbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1200,4 +1200,1 @@ packages:
-  ajv@6.15.0:
-    resolution: {integrity: sha512-aaaa}
-
@@ -4100,4 +4097,1 @@ snapshots:
-  ajv@6.15.0: {}
-
`;

const HEAD_LOCKFILE_WITH_AJV_8 = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      ajv:
        specifier: ^8.18.0
        version: 8.18.0

packages:

  ajv@8.18.0:
    resolution: {integrity: sha512-bbbb}

snapshots:

  ajv@8.18.0: {}
`;

// ── Metadata-laundering fixtures (falsification round 2) ──
// `zod` is dropped outright, but survives at HEAD ONLY as a peer-metadata child
// of another package. Those children are valueless key lines at a DEEPER indent
// than a `packages:` entry — the shape that made a shape-only harvest report
// "still resolves" and pass the #630 class through.

const ZOD_PIN_REMOVAL_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -44,9 +44,6 @@ importers:
     dependencies:
-      zod:
-        specifier: ^3.25.76
-        version: 3.25.76
@@ -862,4 +859,1 @@ packages:
-  zod@3.25.76:
-    resolution: {integrity: sha512-aaaa}
-
@@ -3694,4 +3688,1 @@ snapshots:
-  zod@3.25.76: {}
-
`;

// Same drop, plus an ADDED peer-metadata child naming the dropped package — the
// second laundering vector (an added-name subtraction excluded the candidate).
const ZOD_PIN_REMOVAL_WITH_ADDED_PEER_META_DIFF = `${ZOD_PIN_REMOVAL_DIFF}@@ -900,3 +900,5 @@ packages:
   ajv@8.18.0:
     resolution: {integrity: sha512-bbbb}
+    peerDependenciesMeta:
+      zod:
+        optional: true
`;

const HEAD_LOCKFILE_ZOD_ONLY_IN_PEER_META = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      ajv:
        specifier: ^8.18.0
        version: 8.18.0

packages:

  ajv@8.18.0:
    resolution: {integrity: sha512-bbbb}
    peerDependencies:
      zod: ^3.25 || ^4.0
    peerDependenciesMeta:
      zod:
        optional: true

snapshots:

  ajv@8.18.0: {}
`;

// ── Transitive-drop fixture (falsification round 2) ──
// A transitive dep leaves the lockfile as a consequence of bumping its parent.
// A NON-importer manifest (a separately-deployed service) still declares it.

const HONO_DROP_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -862,4 +859,1 @@ packages:
-  hono@4.12.3:
-    resolution: {integrity: sha512-aaaa}
-
@@ -3694,4 +3688,1 @@ snapshots:
-  hono@4.12.3: {}
-
`;

const HEAD_LOCKFILE_WITHOUT_HONO = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@modelcontextprotocol/sdk':
        specifier: ^1.28.0
        version: 1.28.0

packages:

  '@modelcontextprotocol/sdk@1.28.0':
    resolution: {integrity: sha512-bbbb}

snapshots:

  '@modelcontextprotocol/sdk@1.28.0': {}
`;

/** package.json contents at HEAD, keyed by tracked path. */
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

/** The workspace definition most fixtures assume at HEAD. */
const DEFAULT_WORKSPACE_YAML = `packages:
  - 'packages/*'
`;

/**
 * Emulates `git show HEAD:<path>`: the lockfile blob, the workspace definition,
 * or a tracked manifest. A path absent from `manifests` throws, as git does.
 */
function showAtHead(
  args: string[],
  headLockfile: string,
  manifests: Record<string, string> = {},
  workspaceYaml: string | null = DEFAULT_WORKSPACE_YAML,
): string {
  const ref = args[1] ?? '';
  if (ref === 'HEAD:pnpm-lock.yaml') return headLockfile;
  if (ref === 'HEAD:pnpm-workspace.yaml') {
    // `null` models a repo with no workspace file (git exits non-zero).
    if (workspaceYaml === null) throw new Error(`fatal: ${ref} does not exist in HEAD`);
    return workspaceYaml;
  }
  const content = manifests[ref.slice('HEAD:'.length)];
  if (content === undefined) throw new Error(`fatal: ${ref} does not exist in HEAD`);
  return content;
}

describe('verifyLockfileSyncCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.failureClass).toBe('missing-lockfile');
    expect(result.reason).toMatch(/Tracked lockfile detected/);
    expect(result.reason).toMatch(/pnpm-lock\.yaml/);
  });

  it('passes when the pin is added to a NON-importer manifest (test fixture, not a workspace package)', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'tests/fixtures/sample/package.json';
          }
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
          // Reaching the unified-diff pull would mean the non-importer manifest
          // was still in scope.
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('still fails when a WORKSPACE importer manifest adds a pin without the lockfile', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            // One importer manifest, one fixture manifest: only the importer
            // may reach the pin scan.
            return 'tests/fixtures/sample/package.json\napps/web/package.json';
          }
          if (args[0] === 'diff') {
            expect(args).toContain('apps/web/package.json');
            expect(args).not.toContain('tests/fixtures/sample/package.json');
            return NESTED_PKG_BUMP_DIFF;
          }
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Tracked lockfile detected/);
  });

  it('fails when a NEW workspace-glob manifest adds a pin without the lockfile', async () => {
    // `packages/new` is not yet an importer at HEAD (that is exactly the shape
    // of a branch adding a package) but its directory matches the workspace
    // `packages:` glob, so the lockfile companion is still required.
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'packages/new/package.json';
          }
          if (args[0] === 'diff') {
            expect(args).toContain('packages/new/package.json');
            return NESTED_PKG_BUMP_DIFF;
          }
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.failureClass).toBe('missing-lockfile');
  });

  it('honors `!` negations in the workspace globs (an excluded directory is not admitted)', async () => {
    const workspaceWithNegation = `packages:
  - 'packages/*'
  - '!packages/legacy'
`;
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'packages/legacy/package.json';
          }
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WORKSPACE, {}, workspaceWithNegation);
          }
          // Reaching the unified-diff pull would mean the excluded directory
          // was admitted.
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('admits the ROOT manifest even when the lockfile lists no root importer', async () => {
    const noRootImporter = `lockfileVersion: '9.0'

importers:

  packages/cli:
    dependencies:
      commander:
        specifier: ^11.0.0
        version: 11.0.0

packages:

  commander@11.0.0:
    resolution: {integrity: sha512-bbbb}
`;
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
          if (args[0] === 'show') return showAtHead(args, noRootImporter);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
  });

  it('declares a skip of the glob admission when pnpm-workspace.yaml is unreadable at HEAD', async () => {
    const stderr: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getDefaultBranch: () => 'main',
        safeExec: (_cmd: string, args: string[]) => {
          if (args[0] === 'ls-files') return 'pnpm-lock.yaml';
          if (args[0] === 'diff' && args.includes('--name-only')) {
            return 'packages/new/package.json';
          }
          // No workspace file at HEAD → importer-set-only admission.
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE, {}, null);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
    expect(stderr.join('\n')).toMatch(/pnpm-workspace\.yaml/);
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
    const showRefs: string[] = [];
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
            showRefs.push(args[1] ?? '');
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, HEAD_PACKAGE_JSONS);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.failureClass).toBe('removed-pin');
    expect(result.reason).toMatch(/@mmnto\/strategy-doctrine/);
    // The declaration probe reads the ROOT importer's manifest at HEAD — the
    // lockfile's own answer to "which manifests do I resolve?".
    expect(showRefs).toContain('HEAD:pnpm-lock.yaml');
    expect(showRefs).toContain('HEAD:package.json');
  });

  it('counts an optionalDependencies declaration in a NESTED importer manifest as declared', async () => {
    const nestedOnly = {
      'package.json': `{ "name": "totem" }`,
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
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITH_APP_IMPORTER, nestedOnly);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/@mmnto\/strategy-doctrine/);
  });

  it('passes when a NON-importer manifest declares a dropped transitive dep (services/ repro)', async () => {
    const showRefs: string[] = [];
    const manifests = {
      'package.json': `{
  "name": "totem",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0"
  }
}`,
      // Not a workspace importer: this lockfile never resolved its pins.
      'services/compile-worker/package.json': `{
  "name": "compile-worker",
  "dependencies": {
    "hono": "^4.12.3"
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
          if (args[0] === 'diff') return HONO_DROP_DIFF;
          if (args[0] === 'show') {
            showRefs.push(args[1] ?? '');
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_HONO, manifests);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
    // The non-importer manifest is never even consulted.
    expect(showRefs).not.toContain('HEAD:services/compile-worker/package.json');
  });

  it('fires when the dropped package survives at HEAD only as a peer-metadata child', async () => {
    const manifests = {
      'package.json': `{
  "name": "totem",
  "dependencies": {
    "zod": "^3.25.76",
    "ajv": "^8.18.0"
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
          if (args[0] === 'diff') return ZOD_PIN_REMOVAL_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_ZOD_ONLY_IN_PEER_META, manifests);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/zod/);
  });

  it('fires even when the diff ADDS a peer-metadata line naming the dropped package', async () => {
    const manifests = {
      'package.json': `{
  "name": "totem",
  "dependencies": {
    "zod": "^3.25.76",
    "ajv": "^8.18.0"
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
          if (args[0] === 'diff') return ZOD_PIN_REMOVAL_WITH_ADDED_PEER_META_DIFF;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_ZOD_ONLY_IN_PEER_META, manifests);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/zod/);
  });

  it('fires on a MASS removal that hides one genuinely dropped, still-declared pin', async () => {
    // The old candidate cap waived the gate on any large diff, so a real drop
    // could ride in behind an ordinary big update. Per-candidate cost is now an
    // O(1) lookup against one lockfile index, so volume buys nothing but false
    // negatives.
    const massRemoval = [
      'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
      '--- a/pnpm-lock.yaml',
      '+++ b/pnpm-lock.yaml',
      '@@ -1,2000 +1,1 @@ packages:',
      ...Array.from({ length: 900 }, (_v, i) => `-  pkg-${i}@1.0.0:`),
      "-  '@acme/dropped@2.0.0':",
      '-    resolution: {integrity: sha512-aaaa}',
    ].join('\n');
    const manifests = {
      'package.json': `{
  "name": "totem",
  "dependencies": {
    "@acme/dropped": "^2.0.0"
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
          if (args[0] === 'diff') return massRemoval;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, manifests);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    expect(result.failureClass).toBe('removed-pin');
    expect(result.reason).toMatch(/@acme\/dropped/);
    // The 900 undeclared removals are not named — only the declared one is.
    expect(result.reason).not.toMatch(/pkg-500/);
  });

  it('canonicalizes leading-slash keys emitted by old-vintage (v5/v6) lockfiles', async () => {
    const v6FormRemoval = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1200,6 +1200,1 @@ packages:
-  /ajv@8.18.0:
-    resolution: {integrity: sha512-aaaa}
-  '/@scope/name@1.0.0':
-    resolution: {integrity: sha512-bbbb}
`;
    const manifests = {
      'package.json': `{
  "name": "totem",
  "dependencies": {
    "ajv": "^8.18.0",
    "@scope/name": "^1.0.0"
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
          if (args[0] === 'diff') return v6FormRemoval;
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, manifests);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(false);
    // Both key forms canonicalize to the manifest's own spelling.
    expect(result.reason).toMatch(/(^|[^/])ajv/);
    expect(result.reason).toMatch(/@scope\/name/);
    expect(result.reason).not.toMatch(/\/ajv/);
    expect(result.reason).not.toMatch(/\/@scope/);
  });

  it('passes on a pure version bump (the name still resolves at HEAD)', async () => {
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
          if (args[0] === 'show') {
            return showAtHead(args, HEAD_LOCKFILE_WITH_DOCTRINE_29, HEAD_PACKAGE_JSONS);
          }
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes on a legitimate removal (the declaration is gone from the importer manifest at HEAD)', async () => {
    const withoutDeclaration = { 'package.json': `{ "name": "totem", "dependencies": {} }` };
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
            return showAtHead(args, HEAD_LOCKFILE_WITHOUT_DOCTRINE, withoutDeclaration);
          }
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
          // Still declared — only the HEAD-lockfile resolution saves this case.
          if (args[0] === 'show')
            return showAtHead(args, HEAD_LOCKFILE_WITH_AJV_8, HEAD_PACKAGE_JSONS);
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('passes when the removed name only collides with a MANIFEST key (`type` vs "type": "module")', async () => {
    // `type` is a real npm package AND a package.json manifest key: membership
    // must be decided inside the dependency blocks, never by a text match.
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
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('does not count an `overrides`-only pin as a dependency declaration', async () => {
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
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('declares a skip for an importer manifest that cannot be parsed at HEAD', async () => {
    const stderr: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
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
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
    // The skip is DECLARED — never silent.
    expect(stderr.join('\n')).toMatch(/package\.json/);
  });

  it('passes when the diff removes a lockfile GRAMMAR key (last devDependency dropped)', async () => {
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
          throw new Error('unexpected');
        },
      };
    });
    const { verifyLockfileSyncCommand } = await import('./verify-lockfile-sync.js');
    const result = await verifyLockfileSyncCommand();
    expect(result.valid).toBe(true);
  });

  it('falls through to pass when the lockfile diff read fails (declared skip)', async () => {
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

  it('falls through to pass when the HEAD-lockfile probe fails (declared skip)', async () => {
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
          if (args[0] === 'show') return showAtHead(args, HEAD_LOCKFILE_WORKSPACE);
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
