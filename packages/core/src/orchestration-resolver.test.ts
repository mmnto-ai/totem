/**
 * Tests for `resolveOrchestrationPaths` (mmnto-ai/totem-strategy#341, ADR-106 — Proposal 282).
 *
 * Filesystem-driven; tests construct real temp directories for each
 * presence permutation (none / partial / full) and verify the resolver
 * returns the discriminated `source` field plus the expected
 * path fields. Per-test cleanup wipes the tmp tree so a re-run starts
 * from a clean state. Mirrors the `substrate-resolver.test.ts` shape so
 * the two resolvers' tests stay symmetric.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type OrchestrationPaths, resolveOrchestrationPaths } from './orchestration-resolver.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;
let repoRoot: string;

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Build a partial or full orchestration tree for `agentId` at `repoRoot`.
 * Pass an explicit subset of `'outbox' | 'processed' | 'journal'` to
 * create only those subdirs; pass `'all'` for the full tree.
 */
function mkOrchestrationTree(
  repoRoot: string,
  agentId: string,
  subdirs: Array<'outbox' | 'processed' | 'journal'> | 'all',
): void {
  const base = path.join(repoRoot, '.totem', 'orchestration', agentId);
  const wanted: Array<'outbox' | 'processed' | 'journal'> =
    subdirs === 'all' ? ['outbox', 'processed', 'journal'] : subdirs;
  for (const sub of wanted) {
    mkDir(path.join(base, sub));
  }
}

beforeEach(() => {
  // totem-context: test fixture only; agents do not consume this temp dir.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orchestration-resolver-'));
  repoRoot = mkDir(path.join(tmpRoot, 'repo'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// ─── source: 'none' ────────────────────────────────────────────────────────

describe('resolveOrchestrationPaths — absent', () => {
  it("returns source: 'none' with all null paths when no orchestration tree exists", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when the orchestration dir exists but the agent subdir does not", () => {
    mkDir(path.join(repoRoot, '.totem', 'orchestration'));
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });

  it("returns source: 'none' when a different agent's tree exists at the same repo", () => {
    mkOrchestrationTree(repoRoot, 'strategy-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });
});

// ─── source: 'orchestration' — full tree ───────────────────────────────────

describe('resolveOrchestrationPaths — full tree', () => {
  it("returns source: 'orchestration' with all three absolute paths when every subdir exists", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    );
    expect(result.processed).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'processed')),
    );
    expect(result.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
  });

  it('resolves distinct paths for distinct agents at the same repo', () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    mkOrchestrationTree(repoRoot, 'totem-gemini', 'all');
    const claude = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    const gemini = resolveOrchestrationPaths(repoRoot, 'totem-gemini');
    expect(claude.source).toBe('orchestration');
    expect(gemini.source).toBe('orchestration');
    expect(claude.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(gemini.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-gemini', 'journal')),
    );
    expect(claude.journal).not.toBe(gemini.journal);
  });

  it('resolves the same agent across distinct repo roots independently', () => {
    const otherRepo = mkDir(path.join(tmpRoot, 'other-repo'));
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    mkOrchestrationTree(otherRepo, 'totem-claude', 'all');
    const a = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    const b = resolveOrchestrationPaths(otherRepo, 'totem-claude');
    expect(a.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(b.journal).toBe(
      path.normalize(path.join(otherRepo, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(a.journal).not.toBe(b.journal);
  });
});

// ─── source: 'orchestration' — partial tree ────────────────────────────────

describe('resolveOrchestrationPaths — partial tree', () => {
  it("returns source: 'orchestration' with only journal populated when other subdirs are absent", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['journal']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.journal).not.toBeNull();
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
  });

  it("returns source: 'orchestration' with only outbox populated", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['outbox']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).not.toBeNull();
    expect(result.journal).toBeNull();
    expect(result.processed).toBeNull();
  });

  it("returns source: 'orchestration' with outbox + processed but no journal", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['outbox', 'processed']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).not.toBeNull();
    expect(result.processed).not.toBeNull();
    expect(result.journal).toBeNull();
  });
});

// ─── path normalization / robustness ───────────────────────────────────────

describe('resolveOrchestrationPaths — robustness', () => {
  it('treats a file in place of a subdir as absent', () => {
    const base = path.join(repoRoot, '.totem', 'orchestration', 'totem-claude');
    mkDir(base);
    // totem-context: writing a placeholder file to test the file-vs-directory predicate in the resolver; not a hooks-manager bypass — `journal` here is an orchestration subdir name, not a git hook path.
    fs.writeFileSync(path.join(base, 'journal'), '');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    // journal exists as a file, not a directory → treated as absent
    expect(result.journal).toBeNull();
  });

  it('normalizes paths when given a repoRoot with redundant separators', () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    // Intentionally pass a non-normalized repo root (trailing separators + redundant `.`).
    const noisy = path.join(repoRoot, '.', '.');
    const result = resolveOrchestrationPaths(noisy, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    );
  });

  it('OrchestrationPaths exported type is discriminable on source', () => {
    const result: OrchestrationPaths = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    if (result.source === 'none') {
      expect(result.outbox).toBeNull();
      expect(result.processed).toBeNull();
      expect(result.journal).toBeNull();
    }
  });
});

// ─── agentId validation (defense-in-depth against path traversal) ──────────

describe('resolveOrchestrationPaths — agentId validation', () => {
  it("returns source: 'none' for an empty agentId", () => {
    const result = resolveOrchestrationPaths(repoRoot, '');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains '..' (parent-dir traversal)", () => {
    // A traversal-bearing agentId without the validation would normalize to
    // an absolute path outside `.totem/orchestration/`; the validation
    // short-circuits before path composition.
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, '../etc');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });

  it("returns source: 'none' when agentId contains '/' (POSIX path separator)", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem/claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains '\\' (Windows path separator)", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem\\claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains a null byte", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude\0/etc');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' for non-string agentId (defensive type check)", () => {
    // Defense against untyped JS callers passing through the override hook.
    // totem-context: cast through `unknown` to reach the runtime path that
    // TypeScript would otherwise forbid; the validation must hold even
    // when a config.json supplies non-string `host_agents` entries.
    const result = resolveOrchestrationPaths(repoRoot, null as unknown as string);
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });
});
