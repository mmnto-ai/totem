import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocTarget } from '@mmnto/totem';

import { DOCS_SYSTEM_PROMPT, docsCommand, extractUpdatedDocument, stripIssueRefs } from './docs.js';

// ─── Mocks ──────────────────────────────────────────────

vi.mock('../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveConfigPath: vi.fn().mockReturnValue('/fake/totem.config.ts'),
    loadEnv: vi.fn(),
    loadConfig: vi.fn(),
    runOrchestrator: vi
      .fn()
      .mockResolvedValue(
        '<updated_document>\n# Updated README\n\nNew content here.\n</updated_document>',
      ),
    getSystemPrompt: vi.fn().mockReturnValue('system prompt'),
    writeOutput: vi.fn(),
  };
});

vi.mock('../git.js', () => ({
  getLatestTag: vi.fn().mockReturnValue('v0.14.0'),
  getGitLogSince: vi.fn().mockReturnValue('abc1234 feat: new feature\ndef5678 fix: bug fix'),
  isFileDirty: vi.fn().mockReturnValue(false),
}));

vi.mock('../adapters/github-cli.js', () => ({
  GitHubCliAdapter: vi.fn().mockImplementation(() => ({
    fetchClosedIssues: vi
      .fn()
      .mockReturnValue([
        { number: 108, title: 'Clean up temp files', closedAt: '2026-03-06T00:00:00Z' },
      ]),
  })),
}));

import { isFileDirty } from '../git.js';
import { loadConfig, runOrchestrator } from '../utils.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

function setupTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-docs-test-'));
  // Create docs directory and active_work.md
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'active_work.md'), '# Active Work\n', 'utf-8');
  return dir;
}

function writeDoc(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function mockConfig(docs?: DocTarget[]): void {
  vi.mocked(loadConfig).mockResolvedValue({
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    ...(docs !== undefined ? { docs } : {}),
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    shieldIgnorePatterns: [],
    contextWarningThreshold: 40_000,
  });
}

// ─── Tests ──────────────────────────────────────────────

describe('docsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress expected stderr from saga validator rejections and doc processing (#547)
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset return values (clearAllMocks only clears call records, not implementations)
    vi.mocked(isFileDirty).mockReturnValue(false);
    vi.mocked(runOrchestrator).mockResolvedValue(
      '<updated_document>\n# Updated README\n\nNew content here.\n</updated_document>',
    );
    tmpDir = setupTmpDir();
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when no docs configured', async () => {
    mockConfig();

    await expect(docsCommand([], {})).rejects.toThrow('No docs configured');
  });

  it('throws when docs array is empty', async () => {
    mockConfig([]);

    await expect(docsCommand([], {})).rejects.toThrow('No docs configured');
  });

  it('throws when --only matches no docs', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    await expect(docsCommand([], { only: 'nonexistent' })).rejects.toThrow(
      "--only 'nonexistent' matched no configured docs",
    );
  });

  it('filters docs with --only', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' },
    ]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    await docsCommand([], { only: 'readme' });

    // Only one orchestrator call (for README.md)
    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('throws when target file has uncommitted changes', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    vi.mocked(isFileDirty).mockReturnValue(true);

    await expect(docsCommand([], {})).rejects.toThrow('uncommitted changes');
  });

  it('allows dirty files in --dry-run mode', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    vi.mocked(isFileDirty).mockReturnValue(true);
    writeDoc(tmpDir, 'README.md', '# Old README\n');

    // Should not throw
    await docsCommand([], { dryRun: true });
    expect(runOrchestrator).toHaveBeenCalledTimes(1);

    // File should NOT be modified in dry-run
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toBe('# Old README\n');
  });

  it('writes updated content to disk', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    await docsCommand([], {});

    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('Updated README');
  });

  it('skips files that do not exist', async () => {
    mockConfig([{ path: 'nonexistent.md', description: 'missing', trigger: 'post-release' }]);

    // Should not throw — just skip
    await docsCommand([], {});
    expect(runOrchestrator).not.toHaveBeenCalled();
  });

  it('processes multiple docs sequentially', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' },
    ]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    await docsCommand([], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('rejects update when saga validator detects checkbox mutation', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    // Original has a checked checkbox
    writeDoc(tmpDir, 'README.md', '# Roadmap\n\n- [x] Phase 1 complete\n- [ ] Phase 2\n');

    // LLM unchecks it — saga validator should reject
    vi.mocked(runOrchestrator).mockResolvedValue(
      '<updated_document>\n# Roadmap\n\n- [ ] Phase 1 complete\n- [ ] Phase 2\n</updated_document>',
    );

    await docsCommand([], {});

    // File should NOT be modified — original preserved
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('- [x] Phase 1 complete');
  });

  it('rejects update when saga validator detects excessive deletion', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    // Original is substantial
    writeDoc(tmpDir, 'README.md', '# Big Doc\n\n' + 'Content line.\n'.repeat(100));

    // LLM returns a tiny replacement
    vi.mocked(runOrchestrator).mockResolvedValue(
      '<updated_document>\n# Big Doc\n\nTiny.\n</updated_document>',
    );

    await docsCommand([], {});

    // File should NOT be modified — original preserved
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('Content line.');
  });

  it('rejects response missing closing updated_document tag', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' }]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    // Simulate truncated response — opening tag but no closing tag
    vi.mocked(runOrchestrator).mockResolvedValue('<updated_document>\n# Truncated content');

    await docsCommand([], {});

    // File should NOT be modified
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toBe('# Old README\n');
  });

  // ─── Positional path targeting ───────────────────────────

  it('targets a single doc by path', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' as const },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' as const },
    ]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    await docsCommand(['README.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('targets multiple docs by path', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' as const },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' as const },
      { path: 'docs/architecture.md', description: 'arch', trigger: 'post-release' as const },
    ]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');
    writeDoc(tmpDir, 'docs/architecture.md', '# Old Arch\n');

    await docsCommand(['README.md', 'docs/roadmap.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('normalizes ./prefix in positional paths', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' as const },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' as const },
    ]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    await docsCommand(['./README.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('throws for unknown positional paths (fail-fast)', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' as const }]);

    await expect(docsCommand(['nonexistent.md'], {})).rejects.toThrow(
      'Unknown doc path(s): nonexistent.md',
    );
  });

  it('deduplicates positional paths', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' as const }]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    await docsCommand(['README.md', 'README.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('deduplicates normalization-equivalent paths (README.md vs ./README.md)', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' as const }]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    await docsCommand(['README.md', './README.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('throws when both positional paths and --only are provided', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' as const },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' as const },
    ]);

    await expect(docsCommand(['README.md'], { only: 'roadmap' })).rejects.toThrow(
      'Cannot combine positional doc paths with --only flag',
    );
  });

  it('resolves absolute paths against cwd', async () => {
    mockConfig([{ path: 'README.md', description: 'readme', trigger: 'post-release' as const }]);

    writeDoc(tmpDir, 'README.md', '# Old README\n');

    // Absolute path should resolve to the same relative config key
    await docsCommand([path.join(tmpDir, 'README.md')], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('scopes dirty check to targeted docs only', async () => {
    mockConfig([
      { path: 'README.md', description: 'readme', trigger: 'post-release' as const },
      { path: 'docs/roadmap.md', description: 'roadmap', trigger: 'post-release' as const },
    ]);

    // Only roadmap is dirty, but we're targeting README
    vi.mocked(isFileDirty).mockImplementation((_cwd, filePath) => filePath === 'docs/roadmap.md');
    writeDoc(tmpDir, 'README.md', '# Old README\n');
    writeDoc(tmpDir, 'docs/roadmap.md', '# Old Roadmap\n');

    // Should succeed — README is not dirty
    await docsCommand(['README.md'], {});

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
  });
});

// ─── DOCS_SYSTEM_PROMPT ─────────────────────────────────

describe('DOCS_SYSTEM_PROMPT', () => {
  it('includes formatting rules section', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('## Formatting Rules');
  });

  it('enforces sub-bullet threshold', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('Sub-Bullet Threshold');
    expect(DOCS_SYSTEM_PROMPT).toContain('nested sub-bullets');
  });

  it('enforces completed phase summary rule', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('Completed Phase Summary');
    expect(DOCS_SYSTEM_PROMPT).toContain('summarized in 1-2 sentences max');
  });

  it('enforces line length via semantic limit (not character counting)', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('two short sentences');
    expect(DOCS_SYSTEM_PROMPT).not.toMatch(/\d+ characters/);
  });

  it('prohibits issue/PR references in user-facing docs', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('No Issue/PR References');
    expect(DOCS_SYSTEM_PROMPT).toContain('NEVER include GitHub issue or PR references');
  });

  it('prohibits internal jargon', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('No Internal Jargon');
    expect(DOCS_SYSTEM_PROMPT).toContain('Pipeline 1');
  });

  it('includes pinned content to protect the tagline', () => {
    expect(DOCS_SYSTEM_PROMPT).toContain('## Pinned Content');
    expect(DOCS_SYSTEM_PROMPT).toContain('Stop repeating yourself');
    expect(DOCS_SYSTEM_PROMPT).toContain('brilliant goldfish');
  });
});

// ─── extractUpdatedDocument ─────────────────────────────

describe('extractUpdatedDocument', () => {
  it('extracts content from valid wrapper', () => {
    const input = '<updated_document>\n# Hello\nWorld\n</updated_document>';
    expect(extractUpdatedDocument(input)).toBe('# Hello\nWorld');
  });

  it('returns null when closing tag is missing', () => {
    expect(extractUpdatedDocument('<updated_document>\n# Truncated')).toBeNull();
  });

  it('returns null when wrapper is absent', () => {
    expect(extractUpdatedDocument('# Just plain markdown')).toBeNull();
  });

  it('handles extra whitespace around tags', () => {
    const input = '  <updated_document>\n# Content\n  </updated_document>  ';
    expect(extractUpdatedDocument(input)).toBe('# Content');
  });
});

// ─── stripIssueRefs ─────────────────────────────────────

describe('stripIssueRefs', () => {
  it('strips parenthesized single refs', () => {
    expect(stripIssueRefs('security hardening (#714)')).toBe('security hardening');
  });

  it('strips parenthesized multi refs', () => {
    expect(stripIssueRefs('fixes (#714, #801)')).toBe('fixes');
  });

  it('strips "fixes #NNN" style refs', () => {
    expect(stripIssueRefs('applied patch (fixes #793)')).toBe('applied patch');
  });

  it('strips standalone refs in prose', () => {
    expect(stripIssueRefs('security hardening #801 was applied')).toBe(
      'security hardening was applied',
    );
  });

  it('preserves markdown anchors', () => {
    expect(stripIssueRefs('[link](#my-heading)')).toBe('[link](#my-heading)');
  });

  it('preserves short numbers', () => {
    expect(stripIssueRefs('use #42 as the answer')).toBe('use #42 as the answer');
  });

  it('cleans double spaces left behind', () => {
    expect(stripIssueRefs('feature (#714) is ready')).toBe('feature is ready');
  });
});
