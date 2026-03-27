import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must precede imports) ────────────────────

const { mockSafeExec, mockIsAncestor, mockGetShortstat, mockGetNameStatus, mockGetDiffBetween } =
  vi.hoisted(() => ({
    mockSafeExec: vi.fn(),
    mockIsAncestor: vi.fn(),
    mockGetShortstat: vi.fn(),
    mockGetNameStatus: vi.fn(),
    mockGetDiffBetween: vi.fn(),
  }));

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: mockSafeExec,
  };
});

vi.mock('../git.js', async () => {
  const actual = await vi.importActual<typeof import('../git.js')>('../git.js');
  return {
    ...actual,
    isAncestor: mockIsAncestor,
    getShortstat: mockGetShortstat,
    getNameStatus: mockGetNameStatus,
    getDiffBetween: mockGetDiffBetween,
  };
});

// ─── Import after mocks ─────────────────────────────

import { cleanTmpDir } from '../test-utils.js';
import { evaluateIncrementalEligibility } from './shield.js';

// ─── Tests ──────────────────────────────────────────

describe('evaluateIncrementalEligibility', () => {
  let tmpDir: string;
  let cacheDir: string;
  let flagPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-incr-'));
    cacheDir = path.join(tmpDir, '.totem', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    flagPath = path.join(cacheDir, '.shield-passed');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('rejects when no shield state exists', async () => {
    // No .shield-passed file
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('No previous shield state');
  });

  it('rejects when shield state is invalid (too short)', async () => {
    fs.writeFileSync(flagPath, 'abc');
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Invalid shield state');
  });

  it('rejects when already at passed commit', async () => {
    const sha = 'a'.repeat(40);
    fs.writeFileSync(flagPath, sha);
    mockSafeExec.mockReturnValueOnce(sha); // git rev-parse HEAD
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Already at passed commit');
  });

  it('rejects when last passed commit is not an ancestor (rebase detected)', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha); // git rev-parse HEAD
    mockIsAncestor.mockReturnValueOnce(false);
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('rebase detected');
  });

  it('rejects when new files are introduced', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([
      { status: 'M', file: 'src/foo.ts' },
      { status: 'A', file: 'src/new-file.ts' },
    ]);
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Diff contains new or deleted files');
  });

  it('rejects when diff exceeds threshold', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([{ status: 'M', file: 'src/foo.ts' }]);
    mockGetShortstat.mockReturnValueOnce({ files: 1, insertions: 10, deletions: 8 });
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('exceeds 15 lines');
    expect(result.reason).toContain('18');
  });

  it('rejects when delta diff is empty', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([{ status: 'M', file: 'src/foo.ts' }]);
    mockGetShortstat.mockReturnValueOnce({ files: 1, insertions: 2, deletions: 1 });
    mockGetDiffBetween.mockReturnValueOnce('   ');
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('No diff content');
  });

  it('returns eligible for small modification-only diff', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const deltaDiff = 'diff --git a/src/foo.ts b/src/foo.ts\n-const x = 1;\n+const x = 2;';
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([{ status: 'M', file: 'src/foo.ts' }]);
    mockGetShortstat.mockReturnValueOnce({ files: 1, insertions: 1, deletions: 1 });
    mockGetDiffBetween.mockReturnValueOnce(deltaDiff);
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(true);
    expect(result.deltaDiff).toBe(deltaDiff);
    expect(result.changedFiles).toEqual(['src/foo.ts']);
    expect(result.linesChanged).toBe(2);
  });

  it('uses configRoot when provided', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-incr-cfg-'));
    const cfgCacheDir = path.join(configRoot, '.totem', 'cache');
    fs.mkdirSync(cfgCacheDir, { recursive: true });
    const cfgFlagPath = path.join(cfgCacheDir, '.shield-passed');
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const deltaDiff = 'diff --git a/src/foo.ts b/src/foo.ts\n+fixed typo';
    fs.writeFileSync(cfgFlagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([{ status: 'M', file: 'src/foo.ts' }]);
    mockGetShortstat.mockReturnValueOnce({ files: 1, insertions: 1, deletions: 0 });
    mockGetDiffBetween.mockReturnValueOnce(deltaDiff);
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem', configRoot);
    expect(result.eligible).toBe(true);
    cleanTmpDir(configRoot);
  });

  it('rejects when deleted files are present', async () => {
    const lastSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    fs.writeFileSync(flagPath, lastSha);
    mockSafeExec.mockReturnValueOnce(headSha);
    mockIsAncestor.mockReturnValueOnce(true);
    mockGetNameStatus.mockReturnValueOnce([{ status: 'D', file: 'src/old.ts' }]);
    const result = await evaluateIncrementalEligibility(tmpDir, '.totem');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Diff contains new or deleted files');
  });
});
