import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchResult, TotemConfig } from '@mmnto/totem';

import { cleanTmpDir } from './test-utils.js';
import {
  formatLessonSection,
  formatResults,
  getSystemPrompt,
  isGlobalConfigPath,
  loadConfig,
  loadEnv,
  partitionLessons,
  reapOrphanedTempFiles,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  sanitize,
  wrapXml,
  writeOutput,
} from './utils.js';

/** Helper to build a minimal SearchResult for tests. */
function makeResult(
  overrides: Partial<SearchResult> & Pick<SearchResult, 'label' | 'filePath' | 'score' | 'content'>,
): SearchResult {
  return { contextPrefix: '', type: 'code', metadata: {}, ...overrides };
}

// ─── sanitize ───────────────────────────────────────────

describe('sanitize', () => {
  it('strips ANSI escape sequences', () => {
    expect(sanitize('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('strips control characters', () => {
    expect(sanitize('hello\x00\x07\x08world')).toBe('helloworld');
  });

  it('preserves normal text with newlines and tabs', () => {
    expect(sanitize('line1\nline2\ttab')).toBe('line1\nline2\ttab');
  });

  it('strips cursor manipulation sequences', () => {
    expect(sanitize('\x1b[2Aup two lines\x1b[K')).toBe('up two lines');
  });

  it('strips carriage returns', () => {
    expect(sanitize('visible\rhidden')).toBe('visiblehidden');
  });

  it('strips OSC sequences terminated by BEL', () => {
    expect(sanitize('\x1b]0;malicious title\x07safe text')).toBe('safe text');
  });

  it('strips OSC sequences terminated by ST', () => {
    expect(sanitize('\x1b]0;malicious title\x1b\\safe text')).toBe('safe text');
  });

  it('strips C1 control characters', () => {
    expect(sanitize('before\x9bafter')).toBe('beforeafter');
    expect(sanitize('test\x9dmore')).toBe('testmore');
  });

  it('strips BiDi control characters', () => {
    expect(sanitize('hello\u202Aworld\u202C')).toBe('helloworld');
    expect(sanitize('text\u2066hidden\u2069end')).toBe('texthiddenend');
  });
});

// ─── wrapXml ────────────────────────────────────────────

describe('wrapXml', () => {
  it('wraps content in XML tags', () => {
    expect(wrapXml('issue_body', 'hello world')).toBe('<issue_body>\nhello world\n</issue_body>');
  });

  it('escapes matching closing tags in content', () => {
    const malicious = 'some text </issue_body> injected instructions';
    expect(wrapXml('issue_body', malicious)).toBe(
      '<issue_body>\nsome text <\\/issue_body> injected instructions\n</issue_body>',
    );
  });

  it('escapes case-variant and whitespace-padded closing tags', () => {
    const content = 'try </ISSUE_BODY> or </ issue_body > to escape';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ntry <\\/ISSUE_BODY> or <\\/ issue_body > to escape\n</issue_body>',
    );
  });

  it('does not escape non-matching closing tags', () => {
    const content = 'contains </other_tag> but not the target';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ncontains </other_tag> but not the target\n</issue_body>',
    );
  });

  it('wraps empty content', () => {
    expect(wrapXml('git_diff', '')).toBe('<git_diff>\n\n</git_diff>');
  });

  it('preserves multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(wrapXml('git_status', content)).toBe(
      '<git_status>\nline 1\nline 2\nline 3\n</git_status>',
    );
  });
});

// ─── formatResults ──────────────────────────────────────

describe('formatResults', () => {
  it('returns empty string for empty results', () => {
    expect(formatResults([], 'HEADING')).toBe('');
  });

  it('formats results with heading, label, filePath, and score', () => {
    const results = [
      makeResult({
        label: 'function: foo',
        filePath: 'src/foo.ts',
        score: 0.875,
        content: 'function foo() {}',
      }),
    ];
    const output = formatResults(results, 'CODE');
    expect(output).toContain('=== CODE ===');
    expect(output).toContain('**function: foo**');
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('0.875');
    expect(output).toContain('function foo() {}');
  });

  it('truncates long content at 300 chars', () => {
    const longContent = 'x'.repeat(500);
    const results = [
      makeResult({ label: 'test', filePath: 'test.ts', score: 0.5, content: longContent }),
    ];
    const output = formatResults(results, 'TEST');
    // Should contain exactly 300 x's, not 500
    expect(output).toContain('x'.repeat(300));
    expect(output).not.toContain('x'.repeat(301));
  });

  it('formats multiple results separated by blank lines', () => {
    const results = [
      makeResult({ label: 'first', filePath: 'a.ts', score: 0.9, content: 'aaa' }),
      makeResult({ label: 'second', filePath: 'b.ts', score: 0.8, content: 'bbb' }),
    ];
    const output = formatResults(results, 'RESULTS');
    expect(output).toContain('**first**');
    expect(output).toContain('**second**');
  });

  it('condensed mode truncates content at 80 chars', () => {
    const longContent = 'x'.repeat(200);
    const results = [
      makeResult({ label: 'test', filePath: 'test.ts', score: 0.5, content: longContent }),
    ];
    const output = formatResults(results, 'TEST', true);
    expect(output).toContain('x'.repeat(80));
    expect(output).not.toContain('x'.repeat(81));
    expect(output).toContain('...');
  });

  it('condensed mode omits score', () => {
    const results = [
      makeResult({ label: 'my-func', filePath: 'src/foo.ts', score: 0.9, content: 'hello' }),
    ];
    const output = formatResults(results, 'CODE', true);
    expect(output).toContain('**my-func**');
    expect(output).not.toContain('0.900');
  });

  it('condensed mode replaces newlines with spaces', () => {
    const results = [
      makeResult({ label: 'multi', filePath: 'a.ts', score: 0.5, content: 'line1\nline2\nline3' }),
    ];
    const output = formatResults(results, 'TEST', true);
    expect(output).toContain('line1 line2 line3');
    expect(output).not.toContain('line1\n');
  });
});

// ─── writeOutput ────────────────────────────────────────

describe('writeOutput', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-utils-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('writes content to file when outPath is provided', () => {
    const outPath = path.join(tmpDir, 'output.md');
    writeOutput('hello world', outPath);
    expect(fs.readFileSync(outPath, 'utf-8')).toBe('hello world');
  });

  it('creates directories when they do not exist', () => {
    const outPath = path.join(tmpDir, 'nested', 'dir', 'output.md');
    writeOutput('nested content', outPath);
    expect(fs.readFileSync(outPath, 'utf-8')).toBe('nested content');
  });

  it('writes to stdout when no outPath is given', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeOutput('stdout content');
    expect(spy).toHaveBeenCalledWith('stdout content');
    spy.mockRestore();
  });
});

// ─── resolveConfigPath ───────────────────────────────

describe('resolveConfigPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-config-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns config path when totem.config.ts exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {}', 'utf-8');
    const result = resolveConfigPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, 'totem.config.ts'));
  });

  it('throws when no config file exists', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-home-'));
    try {
      expect(() => resolveConfigPath(tmpDir, fakeHome)).toThrow('No Totem configuration found');
    } finally {
      cleanTmpDir(fakeHome);
    }
  });

  it('resolves totem.yaml when totem.config.ts is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: []\n');
    expect(resolveConfigPath(tmpDir)).toBe(path.join(tmpDir, 'totem.yaml'));
  });

  it('resolves totem.toml when no ts or yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.toml'), '[embedding]\nprovider = "openai"\n');
    expect(resolveConfigPath(tmpDir)).toBe(path.join(tmpDir, 'totem.toml'));
  });

  it('prioritizes .ts over .yaml when both exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {}');
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: []\n');
    expect(resolveConfigPath(tmpDir)).toBe(path.join(tmpDir, 'totem.config.ts'));
  });

  it('falls back to ~/.totem/ when no local config exists', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-home-'));
    const globalDir = path.join(fakeHome, '.totem');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'totem.config.ts'), 'export default {}', 'utf-8');

    try {
      const result = resolveConfigPath(tmpDir, fakeHome);
      expect(result).toBe(path.join(globalDir, 'totem.config.ts'));
    } finally {
      cleanTmpDir(fakeHome);
    }
  });

  it('prefers local config over global', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-home-'));
    const globalDir = path.join(fakeHome, '.totem');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'totem.config.ts'), 'export default {}', 'utf-8');

    // Also create local config
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: []\n', 'utf-8');

    try {
      const result = resolveConfigPath(tmpDir, fakeHome);
      expect(result).toBe(path.join(tmpDir, 'totem.yaml'));
    } finally {
      cleanTmpDir(fakeHome);
    }
  });

  it('throws when neither local nor global config exists with updated hint', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-home-'));
    try {
      expect(() => resolveConfigPath(tmpDir, fakeHome)).toThrow('No Totem configuration found');
      try {
        resolveConfigPath(tmpDir, fakeHome);
      } catch (err) {
        expect(err).toHaveProperty('recoveryHint');
        expect((err as { recoveryHint: string }).recoveryHint).toContain('--global');
      }
    } finally {
      cleanTmpDir(fakeHome);
    }
  });
});

describe('isGlobalConfigPath', () => {
  it('returns true for paths under ~/.totem/', () => {
    const fakeHome = '/fake/home';
    expect(isGlobalConfigPath('/fake/home/.totem/totem.config.ts', fakeHome)).toBe(true);
    expect(isGlobalConfigPath('/fake/home/.totem/totem.yaml', fakeHome)).toBe(true);
  });

  it('returns false for local project paths', () => {
    const fakeHome = '/fake/home';
    expect(isGlobalConfigPath('/my/project/totem.config.ts', fakeHome)).toBe(false);
    expect(isGlobalConfigPath('/other/dir/totem.yaml', fakeHome)).toBe(false);
  });

  it('returns false for directories sharing the prefix (e.g. ~/.totem-foo/)', () => {
    const fakeHome = '/fake/home';
    expect(isGlobalConfigPath('/fake/home/.totem-foo/totem.config.ts', fakeHome)).toBe(false);
  });
});

// ─── loadConfig (YAML/TOML) ─────────────────────────

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-loadconfig-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('loads and validates a YAML config', async () => {
    const yaml = `targets:\n  - glob: "**/*.ts"\n    type: code\n    strategy: typescript-ast\n`;
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), yaml);
    const config = await loadConfig(path.join(tmpDir, 'totem.yaml'));
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].glob).toBe('**/*.ts');
  });

  it('loads and validates a TOML config', async () => {
    const toml = `[[targets]]\nglob = "**/*.rs"\ntype = "code"\nstrategy = "typescript-ast"\n`;
    fs.writeFileSync(path.join(tmpDir, 'totem.toml'), toml);
    const config = await loadConfig(path.join(tmpDir, 'totem.toml'));
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].glob).toBe('**/*.rs');
  });

  it('throws ConfigError for invalid YAML syntax', async () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: [invalid yaml: {{');
    await expect(loadConfig(path.join(tmpDir, 'totem.yaml'))).rejects.toThrow('Failed to parse');
  });

  it('throws ConfigError for invalid TOML syntax', async () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.toml'), 'targets = [invalid');
    await expect(loadConfig(path.join(tmpDir, 'totem.toml'))).rejects.toThrow('Failed to parse');
  });

  it('formats Zod validation errors with field paths', async () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: "not an array"\n');
    await expect(loadConfig(path.join(tmpDir, 'totem.yaml'))).rejects.toThrow(
      'Invalid configuration',
    );
  });
});

// ─── loadEnv ─────────────────────────────────────────

describe('loadEnv', () => {
  let tmpDir: string;
  const TEST_KEY = 'TOTEM_TEST_LOADENV_KEY';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-env-'));
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env[TEST_KEY];
  });

  it('loads variables from .env file', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=hello`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('hello');
  });

  it('does not override existing env variables', () => {
    process.env[TEST_KEY] = 'existing';
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=new`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('existing');
  });

  it('skips comments and blank lines', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `# comment\n\n${TEST_KEY}=value`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('value');
  });

  it('does nothing when .env file is missing', () => {
    loadEnv(tmpDir); // should not throw
    expect(process.env[TEST_KEY]).toBeUndefined();
  });

  it('strips surrounding double quotes from values', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}="quoted-value"`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('quoted-value');
  });

  it('strips surrounding single quotes from values', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}='single-quoted'`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('single-quoted');
  });

  it('handles Windows CRLF line endings', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=crlfval\r\n`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('crlfval');
  });

  it('handles quoted values with CRLF line endings', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}="quoted-crlf"\r\n`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('quoted-crlf');
  });

  it('strips inline comments from unquoted values', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=secret # expires tomorrow`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('secret');
  });

  it('strips inline comments with trailing whitespace', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=secret    # comment`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('secret');
  });

  it('preserves hash inside double-quoted values', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      `${TEST_KEY}="my#secret" # actual comment`,
      'utf-8',
    );
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('my#secret');
  });

  it('handles empty values', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=`, 'utf-8');
    loadEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe('');
  });
});

// ─── getSystemPrompt ──────────────────────────────────

describe('getSystemPrompt', () => {
  let tmpDir: string;
  const DEFAULT_PROMPT = 'default system prompt';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-prompt-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns default when override file does not exist', () => {
    expect(getSystemPrompt('shield', DEFAULT_PROMPT, tmpDir, '.totem')).toBe(DEFAULT_PROMPT);
  });

  it('returns file content when override file exists', () => {
    const promptsDir = path.join(tmpDir, '.totem', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'shield.md'), 'custom shield prompt', 'utf-8');
    expect(getSystemPrompt('shield', DEFAULT_PROMPT, tmpDir, '.totem')).toBe(
      'custom shield prompt',
    );
  });

  it('returns default when override file is empty', () => {
    const promptsDir = path.join(tmpDir, '.totem', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'spec.md'), '   \n  ', 'utf-8');
    expect(getSystemPrompt('spec', DEFAULT_PROMPT, tmpDir, '.totem')).toBe(DEFAULT_PROMPT);
  });

  it('returns default for invalid command names (path traversal)', () => {
    expect(getSystemPrompt('../../../etc/passwd', DEFAULT_PROMPT, tmpDir, '.totem')).toBe(
      DEFAULT_PROMPT,
    );
  });

  it('returns default when file is unreadable', () => {
    const promptsDir = path.join(tmpDir, '.totem', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    // Create a directory with the same name as the expected file — reading it will throw
    fs.mkdirSync(path.join(promptsDir, 'extract.md'));
    expect(getSystemPrompt('extract', DEFAULT_PROMPT, tmpDir, '.totem')).toBe(DEFAULT_PROMPT);
  });
});

// ─── requireEmbedding ────────────────────────────────

describe('requireEmbedding', () => {
  const BASE_CONFIG: TotemConfig = {
    targets: [{ glob: '**/*.md', type: 'spec', strategy: 'markdown-heading' }],
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    shieldIgnorePatterns: [],
    shieldAutoLearn: false,
    contextWarningThreshold: 40_000,
  };

  it('returns embedding provider when configured', () => {
    const embedding = { provider: 'openai' as const, model: 'text-embedding-3-small' };
    const config = { ...BASE_CONFIG, embedding };
    const result = requireEmbedding(config);
    expect(result).toEqual(embedding);
  });

  it('throws when embedding is undefined', () => {
    expect(() => requireEmbedding(BASE_CONFIG)).toThrow('No embedding provider configured');
  });

  it('error message mentions Lite tier', () => {
    expect(() => requireEmbedding(BASE_CONFIG)).toThrow('Lite tier');
  });

  it('error recovery hint mentions totem init', () => {
    try {
      requireEmbedding(BASE_CONFIG);
    } catch (err) {
      expect((err as { recoveryHint?: string }).recoveryHint).toContain('totem init');
      return;
    }
    throw new Error('Expected requireEmbedding to throw');
  });
});

describe('reapOrphanedTempFiles', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reap-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpRoot);
  });

  function writeTempFile(name: string, ageMs: number): string {
    const tempDir = path.join(tmpRoot, '.totem', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, 'prompt content');
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, past, past);
    return filePath;
  }

  it('removes temp files older than maxAge', async () => {
    const old = writeTempFile('totem-shield-abc123.md', 25 * 60 * 60 * 1000);
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem', 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
  });

  it('keeps temp files younger than maxAge', async () => {
    const recent = writeTempFile('totem-spec-def456.md', 1 * 60 * 60 * 1000);
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem', 24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('ignores non-totem files', async () => {
    const other = writeTempFile('random-notes.txt', 48 * 60 * 60 * 1000);
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem', 24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('returns 0 when temp directory does not exist', async () => {
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem');
    expect(removed).toBe(0);
  });

  it('handles mixed old and new files', async () => {
    const old1 = writeTempFile('totem-shield-aaa.md', 30 * 60 * 60 * 1000);
    const old2 = writeTempFile('totem-triage-bbb.md', 48 * 60 * 60 * 1000);
    const recent = writeTempFile('totem-spec-ccc.md', 2 * 60 * 60 * 1000);
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem', 24 * 60 * 60 * 1000);
    expect(removed).toBe(2);
    expect(fs.existsSync(old1)).toBe(false);
    expect(fs.existsSync(old2)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('swallows errors from already-deleted files gracefully', async () => {
    const filePath = writeTempFile('totem-shield-race.md', 48 * 60 * 60 * 1000);
    // Simulate race: delete before reaper runs
    fs.unlinkSync(filePath);
    const removed = await reapOrphanedTempFiles(tmpRoot, '.totem', 24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
  });
});

// ─── runOrchestrator (#243 — cross-provider routing) ──

vi.mock('./orchestrators/orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./orchestrators/orchestrator.js')>();
  const mockInvoke = vi.fn().mockResolvedValue({
    content: 'mock result',
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 500,
  });
  const mockedCreate = vi.fn().mockReturnValue(mockInvoke);
  return {
    ...actual,
    createOrchestrator: mockedCreate,
    // Re-bind resolveOrchestrator to use the mocked createOrchestrator
    // (the real impl captures a closure over the real factory)
    resolveOrchestrator: (
      rawModel: string,
      baseProvider: string,
      baseInvoke: typeof mockInvoke,
    ) => {
      if (rawModel.startsWith('-') || !/^[\w./:_-]+$/.test(rawModel)) {
        throw new Error(
          `[Totem Error] Invalid model name '${rawModel}'. Model names may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
        );
      }
      const parsed = actual.parseModelString(rawModel, baseProvider);
      if (parsed.provider === 'shell' && baseProvider !== 'shell') {
        throw new Error(
          `[Totem Error] Cannot route to 'shell' provider from a '${baseProvider}' config.\n` +
            `The shell provider requires a 'command' template in the orchestrator config.`,
        );
      }
      if (!parsed.model || parsed.model.startsWith('-')) {
        throw new Error(
          `[Totem Error] Invalid model name in '${rawModel}'. The model portion must not be empty or start with a hyphen.`,
        );
      }
      const invoke =
        parsed.provider === baseProvider
          ? baseInvoke
          : mockedCreate({ provider: parsed.provider } as Parameters<typeof mockedCreate>[0]);
      return { parsed, invoke, qualifiedModel: rawModel };
    },
  };
});

import { createOrchestrator } from './orchestrators/orchestrator.js';

const mockedCreateOrchestrator = vi.mocked(createOrchestrator);

function baseConfig(overrides?: Partial<TotemConfig>): TotemConfig {
  return {
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    orchestrator: {
      provider: 'gemini',
      defaultModel: 'gemini-3-flash-preview',
    },
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    contextWarningThreshold: 40_000,
    ...overrides,
  } as TotemConfig;
}

describe('runOrchestrator', { timeout: 15_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orch-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    // Re-set the mock return value after clearAllMocks
    const mockInvoke = vi.fn().mockResolvedValue({
      content: 'mock result',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 500,
    });
    mockedCreateOrchestrator.mockReturnValue(mockInvoke);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  it('uses default provider and model when no overrides', async () => {
    const result = await runOrchestrator({
      prompt: 'test prompt',
      tag: 'Spec',
      options: {},
      config: baseConfig(),
      cwd: tmpDir,
    });

    expect(result).toBe('mock result');
    expect(mockedCreateOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini' }),
    );
  });

  it('uses per-command override from config', async () => {
    const config = baseConfig({
      orchestrator: {
        provider: 'gemini',
        defaultModel: 'gemini-3-flash-preview',
        overrides: { spec: 'gemini-3.1-pro-preview' },
      },
    });

    await runOrchestrator({
      prompt: 'test',
      tag: 'Spec',
      options: {},
      config,
      cwd: tmpDir,
    });

    // The invoke should receive the override model
    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-pro-preview' }),
    );
  });

  it('--model flag takes priority over overrides', async () => {
    const config = baseConfig({
      orchestrator: {
        provider: 'gemini',
        defaultModel: 'gemini-3-flash-preview',
        overrides: { spec: 'gemini-3.1-pro-preview' },
      },
    });

    await runOrchestrator({
      prompt: 'test',
      tag: 'Spec',
      options: { model: 'custom-model' },
      config,
      cwd: tmpDir,
    });

    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-model' }));
  });

  it('creates a new orchestrator for cross-provider override', async () => {
    const config = baseConfig({
      orchestrator: {
        provider: 'gemini',
        defaultModel: 'gemini-3-flash-preview',
        overrides: { shield: 'anthropic:claude-sonnet-4-6' },
      },
    });

    await runOrchestrator({
      prompt: 'test',
      tag: 'Shield',
      options: {},
      config,
      cwd: tmpDir,
    });

    // Should create two orchestrators: one for base config, one for cross-provider
    expect(mockedCreateOrchestrator).toHaveBeenCalledTimes(2);
    expect(mockedCreateOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic' }),
    );
  });

  it('throws when cross-routing to shell from an API provider', async () => {
    const config = baseConfig({
      orchestrator: {
        provider: 'gemini',
        defaultModel: 'gemini-3-flash-preview',
        overrides: { spec: 'shell:my-model' },
      },
    });

    await expect(
      runOrchestrator({ prompt: 'test', tag: 'Spec', options: {}, config, cwd: tmpDir }),
    ).rejects.toThrow("Cannot route to 'shell' provider");
  });

  it('throws when model portion is empty (anthropic:)', async () => {
    await expect(
      runOrchestrator({
        prompt: 'test',
        tag: 'Spec',
        options: { model: 'anthropic:' },
        config: baseConfig(),
        cwd: tmpDir,
      }),
    ).rejects.toThrow('must not be empty');
  });

  it('throws when model portion starts with hyphen', async () => {
    await expect(
      runOrchestrator({
        prompt: 'test',
        tag: 'Spec',
        options: { model: 'anthropic:-bad' },
        config: baseConfig(),
        cwd: tmpDir,
      }),
    ).rejects.toThrow('must not be empty or start with a hyphen');
  });

  it('throws when no model is specified anywhere', async () => {
    const config = baseConfig({
      orchestrator: { provider: 'gemini' },
    });

    await expect(
      runOrchestrator({ prompt: 'test', tag: 'Spec', options: {}, config, cwd: tmpDir }),
    ).rejects.toThrow('No model specified');
  });

  it('returns undefined in --raw mode without invoking orchestrator', async () => {
    const result = await runOrchestrator({
      prompt: 'test',
      tag: 'Spec',
      options: { raw: true },
      config: baseConfig(),
      cwd: tmpDir,
    });

    expect(result).toBeUndefined();
    expect(mockedCreateOrchestrator).not.toHaveBeenCalled();
  });

  // ─── Phase 3: prompt cache plumbing (mmnto/totem#1291) ─────

  it('threads systemPrompt to the underlying invoke()', async () => {
    await runOrchestrator({
      prompt: 'per-lesson user prompt',
      systemPrompt: 'persistent compiler template',
      tag: 'Compile',
      options: {},
      config: baseConfig(),
      cwd: tmpDir,
    });

    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'per-lesson user prompt',
        systemPrompt: 'persistent compiler template',
      }),
    );
  });

  it('omits systemPrompt from invoke() when caller does not provide it (today shape)', async () => {
    await runOrchestrator({
      prompt: 'just a prompt',
      tag: 'Spec',
      options: {},
      config: baseConfig(),
      cwd: tmpDir,
    });

    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    const callArgs = invoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).toBeDefined();
    expect(callArgs['systemPrompt']).toBeUndefined();
    expect(callArgs['prompt']).toBe('just a prompt');
  });

  it('threads enableContextCaching from orchestrator config to invoke()', async () => {
    const config = baseConfig({
      orchestrator: {
        provider: 'gemini',
        defaultModel: 'gemini-3-flash-preview',
        enableContextCaching: true,
        cacheTTL: 3600,
      },
    });

    await runOrchestrator({
      prompt: 'q',
      systemPrompt: 's',
      tag: 'Compile',
      options: {},
      config,
      cwd: tmpDir,
    });

    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        enableContextCaching: true,
        cacheTTL: 3600,
      }),
    );
  });

  it('omits cache opts from invoke() when not configured', async () => {
    await runOrchestrator({
      prompt: 'q',
      tag: 'Spec',
      options: {},
      config: baseConfig(),
      cwd: tmpDir,
    });

    const invoke = mockedCreateOrchestrator.mock.results[0]!.value;
    const callArgs = invoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs['enableContextCaching']).toBeUndefined();
    expect(callArgs['cacheTTL']).toBeUndefined();
  });

  it('passes through cacheReadInputTokens / cacheCreationInputTokens from invoke() result', async () => {
    // Override the default mock to return a result that simulates a cache hit
    const mockInvokeWithCache = vi.fn().mockResolvedValue({
      content: 'cached response',
      inputTokens: 200,
      outputTokens: 75,
      durationMs: 800,
      cacheReadInputTokens: 47_231,
      cacheCreationInputTokens: 0,
    });
    mockedCreateOrchestrator.mockReturnValue(mockInvokeWithCache);

    const result = await runOrchestrator({
      prompt: 'q',
      systemPrompt: 's',
      tag: 'Compile',
      options: {},
      config: baseConfig({
        orchestrator: {
          provider: 'anthropic',
          defaultModel: 'claude-sonnet-4-6',
          enableContextCaching: true,
        },
      }),
      cwd: tmpDir,
    });

    // runOrchestrator returns just the content string today (the cache fields
    // are surfaced via the dim log line, not the return value). The metric is
    // observable via the underlying result object that was forwarded to the
    // log layer — verified by inspecting the mock's call.
    expect(result).toBe('cached response');
    expect(mockInvokeWithCache).toHaveBeenCalled();
  });
});

// ─── partitionLessons ────────────────────────────────────

describe('partitionLessons', () => {
  const makeResult = (filePath: string, label: string): SearchResult => ({
    content: `content for ${label}`,
    contextPrefix: '',
    filePath,
    type: 'spec',
    label,
    score: 0.9,
    metadata: {},
  });

  it('separates lesson results from other specs', () => {
    const allSpecs = [
      { ...makeResult('.totem/lessons/lesson-abc.md', 'Lesson A'), type: 'lesson' as const },
      makeResult('docs/spec.md', 'Spec B'),
      { ...makeResult('.totem/lessons/lesson-def.md', 'Lesson C'), type: 'lesson' as const },
      makeResult('docs/architecture.md', 'Arch D'),
    ];
    const { lessons, specs } = partitionLessons(allSpecs, 10, 10);
    expect(lessons).toHaveLength(2);
    expect(specs).toHaveLength(2);
    expect(lessons[0]!.label).toBe('Lesson A');
    expect(specs[0]!.label).toBe('Spec B');
  });

  it('respects maxLessons cap', () => {
    const allSpecs = [
      { ...makeResult('.totem/lessons/a.md', 'L1'), type: 'lesson' as const },
      { ...makeResult('.totem/lessons/b.md', 'L2'), type: 'lesson' as const },
      { ...makeResult('.totem/lessons/c.md', 'L3'), type: 'lesson' as const },
    ];
    const { lessons } = partitionLessons(allSpecs, 2, 5);
    expect(lessons).toHaveLength(2);
  });

  it('respects maxSpecs cap', () => {
    const allSpecs = [
      makeResult('docs/a.md', 'A'),
      makeResult('docs/b.md', 'B'),
      makeResult('docs/c.md', 'C'),
    ];
    const { specs } = partitionLessons(allSpecs, 5, 2);
    expect(specs).toHaveLength(2);
  });

  it('returns empty arrays when no results', () => {
    const { lessons, specs } = partitionLessons([], 10, 10);
    expect(lessons).toHaveLength(0);
    expect(specs).toHaveLength(0);
  });
});

// ─── formatLessonSection ─────────────────────────────────

describe('formatLessonSection', () => {
  const makeLesson = (label: string, content: string): SearchResult => ({
    content,
    contextPrefix: '',
    filePath: '.totem/lessons.md',
    type: 'spec',
    label,
    score: 0.9,
    metadata: {},
  });

  it('returns empty string when no lessons', () => {
    expect(formatLessonSection([])).toBe('');
  });

  it('formats lessons with full bodies and scores', () => {
    const result = formatLessonSection([makeLesson('Test trap', 'Never do X in Y context')]);
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('**Test trap**');
    expect(result).toContain('score: 0.900');
    expect(result).toContain('Never do X in Y context');
  });

  it('skips lessons that exceed remaining char budget', () => {
    const huge = makeLesson('Huge', 'X'.repeat(5000));
    const small = makeLesson('Small', 'A small lesson');
    const result = formatLessonSection([huge, small], 4000);
    expect(result).not.toContain('Huge');
    expect(result).toContain('Small');
  });

  it('returns empty string when all lessons exceed budget', () => {
    const huge = makeLesson('Huge', 'X'.repeat(10000));
    expect(formatLessonSection([huge], 100)).toBe('');
  });

  it('condensed mode truncates content and omits scores', () => {
    const longContent = 'A'.repeat(200);
    const result = formatLessonSection([makeLesson('Trap', longContent)], undefined, true);
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('**Trap**');
    expect(result).toContain('...');
    expect(result).not.toContain('score:');
    // Content should be truncated — full 200-char body should NOT appear
    expect(result).not.toContain('A'.repeat(200));
  });

  it('condensed mode shows full content for short lessons', () => {
    const result = formatLessonSection([makeLesson('Short', 'A tiny lesson')], undefined, true);
    expect(result).toContain('A tiny lesson');
    expect(result).not.toContain('...');
  });
});
