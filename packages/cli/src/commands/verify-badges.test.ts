import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const README_DIFF = `diff --git a/README.md b/README.md
index aaaaaa..bbbbbb 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,5 @@
 # Totem
+[![Tool-agnostic](https://img.shields.io/badge/Tool--agnostic-AGENTS.md-blue)](./AGENTS.md)
`;

const NO_README_DIFF = `diff --git a/docs/other.md b/docs/other.md
index aaaaaa..bbbbbb 100644
--- a/docs/other.md
+++ b/docs/other.md
@@ -1,5 +1,5 @@
 text
+more text
`;

describe('verifyBadgesCommand', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exits 0 when no README.md changes are present in the branch diff', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getGitBranchDiff: () => NO_README_DIFF,
      };
    });
    const { verifyBadgesCommand } = await import('./verify-badges.js');
    const result = await verifyBadgesCommand({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('exits 0 when README.md is touched but no shields.io badge is added', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getGitBranchDiff: () => `diff --git a/README.md b/README.md
index aaaaaa..bbbbbb 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,5 @@
 # Totem
+text-only change
`,
      };
    });
    const { verifyBadgesCommand } = await import('./verify-badges.js');
    const result = await verifyBadgesCommand({});
    expect(result.valid).toBe(true);
  });

  it('exits 1 (errors > 0) when a self-referential AGENTS.md badge is added', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getGitBranchDiff: () => README_DIFF,
      };
    });
    const { verifyBadgesCommand } = await import('./verify-badges.js');
    const result = await verifyBadgesCommand({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Tool-agnostic|AGENTS\.md|internal/i);
  });

  it('exits 1 when a tool-claim badge has no integration file in repo', async () => {
    const cursorBadgeDiff = `diff --git a/README.md b/README.md
index aaaaaa..bbbbbb 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,5 @@
 text
+[![Cursor](https://img.shields.io/badge/Cursor-supported-blue)](https://cursor.com)
`;
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => '/repo',
        getGitBranchDiff: () => cursorBadgeDiff,
      };
    });
    const { verifyBadgesCommand } = await import('./verify-badges.js');
    // Override path-existence predicate so no integration files appear to exist.
    const result = await verifyBadgesCommand({ existsForTest: () => false });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cursor/i);
  });

  it('returns valid=true when no git repo is resolvable', async () => {
    vi.doMock('@mmnto/totem', async () => {
      const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
      return {
        ...actual,
        resolveGitRoot: () => null,
        getGitBranchDiff: () => '',
      };
    });
    const { verifyBadgesCommand } = await import('./verify-badges.js');
    const result = await verifyBadgesCommand({});
    expect(result.valid).toBe(true);
  });
});
