import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IngestTarget } from '@mmnto/totem';

import {
  UNIVERSAL_BASELINE_LESSONS,
  UNIVERSAL_BASELINE_MARKDOWN,
  UNIVERSAL_BASELINE_MARKER,
} from '../assets/universal-baseline.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  buildNpxCommand,
  detectEmbeddingTier,
  detectReflexStatus,
  generateConfig,
  initCommand,
  installBaselineLessons,
  REFLEX_VERSION,
  scaffoldClaudeHooks,
  scaffoldClaudeWriteShield,
  scaffoldFile,
  scaffoldMcpConfig,
  upgradeReflexes,
} from './init.js';
import { detectProject } from './init-detect.js';
import {
  BARE_REF_REGEX_SOURCE,
  CLAUDE_PREWRITESHIELD,
  CLAUDE_PREWRITESHIELD_ENTRY,
  GEMINI_BEFORE_TOOL,
  generateConfigForFormat,
} from './init-templates.js';

const SERVER_ENTRY = { type: 'stdio', command: 'npx', args: ['-y', '@mmnto/mcp'] };

describe('buildNpxCommand', () => {
  it('returns cmd /c npx on Windows', () => {
    const result = buildNpxCommand(true);
    expect(result.command).toBe('cmd');
    expect(result.args).toEqual(['/c', 'npx', '-y', '@mmnto/mcp']);
  });

  it('returns bare npx on non-Windows', () => {
    const result = buildNpxCommand(false);
    expect(result.command).toBe('npx');
    expect(result.args).toEqual(['-y', '@mmnto/mcp']);
  });
});

describe('scaffoldMcpConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-init-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates a new file when none exists', () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result).toEqual({ action: 'created' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({
      mcpServers: {
        totem: SERVER_ENTRY,
      },
    });
  });

  it('creates parent directories if needed', () => {
    const filePath = path.join(tmpDir, '.gemini', 'settings.json');
    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result).toEqual({ action: 'created' });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('merges into existing file with other servers', () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    const existing = {
      mcpServers: {
        github: { command: 'gh', args: ['mcp'] },
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.mcpServers.github).toEqual({ command: 'gh', args: ['mcp'] });
    expect(content.mcpServers.totem).toEqual(SERVER_ENTRY);
  });

  it('merges into existing file with no mcpServers key', () => {
    const filePath = path.join(tmpDir, '.gemini', 'settings.json');
    fs.mkdirSync(path.join(tmpDir, '.gemini'));
    fs.writeFileSync(filePath, JSON.stringify({ otherKey: true }, null, 2), 'utf-8');

    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.otherKey).toBe(true);
    expect(content.mcpServers.totem).toEqual(SERVER_ENTRY);
  });

  it('skips when totem key already present', () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    const existing = {
      mcpServers: {
        totem: { command: 'old-command' },
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result).toEqual({ action: 'skipped' });
    // Verify it didn't overwrite the existing entry
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.mcpServers.totem.command).toBe('old-command');
  });

  it('returns error when mcpServers is not an object', () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(filePath, JSON.stringify({ mcpServers: 'not-an-object' }, null, 2), 'utf-8');

    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('must be an object');
  });

  it('returns error on malformed JSON', () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(filePath, '{ invalid json !!!', 'utf-8');

    const result = scaffoldMcpConfig(filePath, SERVER_ENTRY);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('invalid JSON');
    expect(result.err).toContain('at position'); // includes original parse error detail
  });
});

describe('scaffoldFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-scaffold-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  const MARKER = '// [totem] auto-generated';
  const CONTENT = `${MARKER}\nconsole.log("hello");\n`;

  it('creates a new file when none exists', () => {
    const filePath = path.join(tmpDir, 'hooks', 'SessionStart.js');
    const result = scaffoldFile(filePath, CONTENT, MARKER);

    expect(result).toEqual({ action: 'created' });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CONTENT);
  });

  it('creates parent directories as needed', () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'file.js');
    const result = scaffoldFile(filePath, CONTENT, MARKER);

    expect(result).toEqual({ action: 'created' });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('returns exists when marker is already present', () => {
    const filePath = path.join(tmpDir, 'hook.js');
    fs.writeFileSync(filePath, CONTENT, 'utf-8');

    const result = scaffoldFile(filePath, CONTENT, MARKER);

    expect(result).toEqual({ action: 'exists' });
  });

  it('skips when file exists without marker (user-customized)', () => {
    const filePath = path.join(tmpDir, 'hook.js');
    fs.writeFileSync(filePath, '// user custom hook\nconsole.log("mine");\n', 'utf-8');

    const result = scaffoldFile(filePath, CONTENT, MARKER);

    expect(result).toEqual({ action: 'skipped' });
    // Verify original content is preserved
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('user custom hook');
  });

  it('is idempotent — double invoke produces same result', () => {
    const filePath = path.join(tmpDir, 'hook.js');

    const first = scaffoldFile(filePath, CONTENT, MARKER);
    expect(first).toEqual({ action: 'created' });

    const second = scaffoldFile(filePath, CONTENT, MARKER);
    expect(second).toEqual({ action: 'exists' });

    // Content unchanged
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CONTENT);
  });

  it('uses default marker when none provided', () => {
    const filePath = path.join(tmpDir, 'default.js');
    const content = '// [totem] auto-generated\ndefault content\n';

    const result = scaffoldFile(filePath, content);
    expect(result).toEqual({ action: 'created' });

    const second = scaffoldFile(filePath, content);
    expect(second).toEqual({ action: 'exists' });
  });
});

describe('scaffoldClaudeHooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-claude-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates settings.local.json when none exists', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.local.json');
    const result = scaffoldClaudeHooks(filePath);

    expect(result).toEqual({ action: 'created' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.PreToolUse).toHaveLength(1);
    expect(content.hooks.PreToolUse[0].matcher).toBe('Bash');
    // Verify object format (not bare strings) — #153
    expect(content.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: expect.stringContaining('shield-gate'),
    });
  });

  it('creates parent directories as needed', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.local.json');
    scaffoldClaudeHooks(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('merges into existing config without hooks', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    fs.writeFileSync(filePath, JSON.stringify({ theme: 'dark' }, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.theme).toBe('dark');
    expect(content.hooks.PreToolUse).toBeDefined();
  });

  it('deep merges when hooks exist but no totem entry', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    const existing = { hooks: { PreToolUse: [{ matcher: 'custom', hooks: ['echo hi'] }] } };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Preserves existing entry
    expect(content.hooks.PreToolUse[0].matcher).toBe('custom');
    // Appends totem entry
    expect(content.hooks.PreToolUse[1].matcher).toBe('Bash');
    expect(JSON.stringify(content.hooks.PreToolUse[1])).toContain('shield-gate');
  });

  it('skips when totem shield hook exists (bare string format — legacy)', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    const existing = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: ['totem shield'] }] },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result).toEqual({ action: 'skipped' });
  });

  it('skips when totem shield hook exists (object format)', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'node .totem/hooks/shield-gate.js' }],
          },
        ],
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result).toEqual({ action: 'skipped' });
  });

  it('returns error on malformed JSON', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    fs.writeFileSync(filePath, '{ broken!!!', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('invalid JSON');
  });

  it('returns error when hooks has unexpected shape', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    fs.writeFileSync(filePath, JSON.stringify({ hooks: 'not-an-object' }, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('unexpected shape');
  });

  it('is idempotent — double invoke does not duplicate', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.local.json');

    const first = scaffoldClaudeHooks(filePath);
    expect(first).toEqual({ action: 'created' });

    const second = scaffoldClaudeHooks(filePath);
    expect(second).toEqual({ action: 'skipped' });
  });
});

describe('Claude shield-gate script scaffolding', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-shield-gate-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates shield-gate.cjs with correct content', () => {
    const filePath = path.join(tmpDir, '.totem', 'hooks', 'shield-gate.cjs');
    const MARKER = '// [totem] auto-generated';
    const CONTENT = `${MARKER} — Claude Code shield gate hook\nconst { execSync } = require('child_process');\n`;

    const result = scaffoldFile(filePath, CONTENT, MARKER);

    expect(result).toEqual({ action: 'created' });
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toContain('require');
    expect(written).toContain(MARKER);
  });

  it('uses .cjs extension for ESM compatibility', () => {
    const filePath = path.join(tmpDir, '.totem', 'hooks', 'shield-gate.cjs');
    const result = scaffoldFile(filePath, '// [totem] auto-generated\ntest\n');

    expect(result).toEqual({ action: 'created' });
    expect(filePath).toMatch(/\.cjs$/);
  });
});

describe('Gemini hook scaffolding', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gemini-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('scaffolds all three files', () => {
    const hooksDir = path.join(tmpDir, '.gemini', 'hooks');
    const skillsDir = path.join(tmpDir, '.gemini', 'skills');

    const sessionStart = scaffoldFile(
      path.join(hooksDir, 'SessionStart.js'),
      '// [totem] auto-generated\ntest\n',
    );
    const beforeTool = scaffoldFile(
      path.join(hooksDir, 'BeforeTool.js'),
      '// [totem] auto-generated\ntest\n',
    );
    const skill = scaffoldFile(
      path.join(skillsDir, 'totem.md'),
      '<!-- [totem] auto-generated — Totem Architect skill -->\ntest\n',
      '<!-- [totem] auto-generated — Totem Architect skill -->',
    );

    expect(sessionStart).toEqual({ action: 'created' });
    expect(beforeTool).toEqual({ action: 'created' });
    expect(skill).toEqual({ action: 'created' });

    // Second run — idempotent
    const sessionStart2 = scaffoldFile(
      path.join(hooksDir, 'SessionStart.js'),
      '// [totem] auto-generated\ntest\n',
    );
    expect(sessionStart2).toEqual({ action: 'exists' });
  });

  it('skips user-customized files', () => {
    const hooksDir = path.join(tmpDir, '.gemini', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'SessionStart.js'),
      '// my custom session hook\nconsole.log("custom");\n',
      'utf-8',
    );

    const result = scaffoldFile(
      path.join(hooksDir, 'SessionStart.js'),
      '// [totem] auto-generated\ntest\n',
    );
    expect(result).toEqual({ action: 'skipped' });
  });
});

describe('detectEmbeddingTier', () => {
  let tmpDir: string;
  const SAVED_OPENAI = process.env['OPENAI_API_KEY'];
  const SAVED_GEMINI = process.env['GEMINI_API_KEY'];
  const SAVED_GOOGLE = process.env['GOOGLE_API_KEY'];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
    delete process.env['OPENAI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    for (const [key, val] of [
      ['OPENAI_API_KEY', SAVED_OPENAI],
      ['GEMINI_API_KEY', SAVED_GEMINI],
      ['GOOGLE_API_KEY', SAVED_GOOGLE],
    ] as const) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  });

  it('returns openai when OPENAI_API_KEY is in env', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test123';
    expect(detectEmbeddingTier(tmpDir)).toBe('openai');
  });

  it('returns openai when OPENAI_API_KEY is in .env file', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=sk-test456\n', 'utf-8');
    expect(detectEmbeddingTier(tmpDir)).toBe('openai');
  });

  it('returns none when no API key is available', () => {
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });

  it('returns none when .env exists but has no API key', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'OTHER_VAR=value\n', 'utf-8');
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });

  it('returns none when OPENAI_API_KEY is empty in env', () => {
    process.env['OPENAI_API_KEY'] = '';
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });

  it('returns none when OPENAI_API_KEY is whitespace-only in env', () => {
    process.env['OPENAI_API_KEY'] = '   ';
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });

  it('returns none when OPENAI_API_KEY is empty in .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=\n', 'utf-8');
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });

  it('returns none when OPENAI_API_KEY is whitespace-only in .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=   \n', 'utf-8');
    expect(detectEmbeddingTier(tmpDir)).toBe('none');
  });
});

describe('generateConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-genconfig-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  const targets = [
    { glob: 'src/**/*.ts', type: 'code' as const, strategy: 'typescript-ast' as const },
  ];

  it('generates config with openai embedding', async () => {
    const config = await generateConfig(targets, 'openai', tmpDir);
    expect(config).toContain("provider: 'openai'");
    expect(config).toContain('text-embedding-3-small');
    expect(config).not.toContain('// embedding:');
  });

  it('generates config with ollama embedding', async () => {
    const config = await generateConfig(targets, 'ollama', tmpDir);
    expect(config).toContain("provider: 'ollama'");
    expect(config).toContain('nomic-embed-text');
  });

  it('generates Lite config with commented-out embedding', async () => {
    const config = await generateConfig(targets, 'none', tmpDir);
    expect(config).toContain('// embedding:');
    expect(config).toContain('Lite tier');
  });

  it('includes orchestrator block or comment when none detected', async () => {
    for (const tier of ['openai', 'ollama', 'none'] as const) {
      const config = await generateConfig(targets, tier, tmpDir);
      // Either a detected orchestrator or the fallback comment
      const hasOrchestrator =
        config.includes('orchestrator:') || config.includes('// orchestrator:');
      expect(hasOrchestrator).toBe(true);
    }
  });

  it('always includes ignorePatterns block', async () => {
    for (const tier of ['openai', 'ollama', 'none'] as const) {
      const config = await generateConfig(targets, tier, tmpDir);
      expect(config).toContain('ignorePatterns:');
      expect(config).toContain('**/__tests__/**');
      expect(config).toContain('**/*.test.ts');
      expect(config).toContain('**/*.spec.ts');
    }
  });
});

describe('Universal Baseline lessons', () => {
  it('UNIVERSAL_BASELINE_MARKER is an HTML comment', () => {
    expect(UNIVERSAL_BASELINE_MARKER).toMatch(/^<!--.*-->$/);
  });

  it('UNIVERSAL_BASELINE_MARKDOWN contains the marker', () => {
    expect(UNIVERSAL_BASELINE_MARKDOWN).toContain(UNIVERSAL_BASELINE_MARKER);
  });

  it('lessons follow the expected format for markdown chunker', () => {
    // Each lesson should have ## Lesson heading and **Tags:** line
    const headings = UNIVERSAL_BASELINE_MARKDOWN.match(/^## Lesson — /gm);
    const tags = UNIVERSAL_BASELINE_MARKDOWN.match(/^\*\*Tags:\*\* /gm);
    expect(headings).not.toBeNull();
    expect(tags).not.toBeNull();
    expect(headings!.length).toBe(UNIVERSAL_BASELINE_LESSONS.length);
    expect(headings!.length).toBe(tags!.length);
  });

  it('each lesson has non-empty content after the tags line', () => {
    const sections = UNIVERSAL_BASELINE_MARKDOWN.split(/^## Lesson — /m).filter(Boolean);
    for (const section of sections) {
      // Skip the marker-only preamble
      if (!section.includes('**Tags:**')) continue;
      const afterTags = section.split('**Tags:**')[1]!;
      const lines = afterTags.split('\n').filter((l) => l.trim());
      // Should have the tag values line + at least one content line
      expect(lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('baseline can be appended to existing lessons without duplication', () => {
    const existing = `# Totem Lessons\n\n---\n\n## Lesson — custom\n\n**Tags:** custom\n\nMy lesson.\n`;
    const combined = existing + UNIVERSAL_BASELINE_MARKDOWN;
    // Marker appears exactly once
    const markers = combined.match(
      new RegExp(UNIVERSAL_BASELINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    );
    expect(markers).toHaveLength(1);
  });

  it('marker check detects already-installed baseline', () => {
    const withBaseline = `# Totem Lessons\n\n---\n${UNIVERSAL_BASELINE_MARKDOWN}`;
    expect(withBaseline.includes(UNIVERSAL_BASELINE_MARKER)).toBe(true);
  });

  it('structured array matches rendered markdown', () => {
    for (const lesson of UNIVERSAL_BASELINE_LESSONS) {
      expect(UNIVERSAL_BASELINE_MARKDOWN).toContain(`## Lesson — ${lesson.heading}`);
    }
  });
});

describe('installBaselineLessons', () => {
  let tmpDir: string;
  let lessonsPath: string;
  const savedIsTTY = process.stdin.isTTY;

  const makeMockRl = (answer: string) =>
    ({ question: async () => answer }) as unknown as import('node:readline/promises').Interface;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-baseline-'));
    lessonsPath = path.join(tmpDir, 'baseline.md');
    // Force non-TTY so prompt is skipped (default to install)
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true });
  });

  it('installs baseline into empty lessons file (non-TTY defaults to yes)', async () => {
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('installed');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain(UNIVERSAL_BASELINE_MARKER);
    expect(content).toContain('Unhandled promise rejections');
  });

  it('returns exists when baseline is already present', async () => {
    fs.writeFileSync(lessonsPath, UNIVERSAL_BASELINE_MARKDOWN, 'utf-8');
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('exists');
  });

  it('returns exists when legacy baseline marker is present', async () => {
    fs.writeFileSync(lessonsPath, '<!-- totem:baseline -->\n\nold lessons', 'utf-8');
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('exists');
  });

  it('does not duplicate baseline on second call', async () => {
    await installBaselineLessons(lessonsPath, makeMockRl(''));
    await installBaselineLessons(lessonsPath, makeMockRl(''));
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    const matches = content.match(
      new RegExp(UNIVERSAL_BASELINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    );
    expect(matches).toHaveLength(1);
  });

  it('writes baseline file even when it does not exist yet', async () => {
    // Ensure the baseline file does not exist
    if (fs.existsSync(lessonsPath)) fs.unlinkSync(lessonsPath);
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('installed');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain(UNIVERSAL_BASELINE_MARKER);
  });

  it('skipped when user declines in TTY mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const result = await installBaselineLessons(lessonsPath, makeMockRl('n'));
    expect(result).toBe('skipped');
    expect(fs.existsSync(lessonsPath)).toBe(false);
  });

  it('installs when user accepts in TTY mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('installed');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain(UNIVERSAL_BASELINE_MARKER);
  });
});

// ─── Reflex versioning ──────────────────────────────────────

const LEGACY_BLOCK = `
## Totem AI Integration (Auto-Generated)
You have access to the Totem MCP for long-term project memory. You MUST operate with the following reflexes:

### Memory Reflexes
1. **Pull Before Planning:** Before writing specs, architecture, or fixing complex bugs, use \`search_knowledge\` to retrieve domain constraints and past traps.
2. **Proactive Anchoring (The 3 Triggers):** You must autonomously call \`add_lesson\` when any of the following occur — do NOT wait for the user to ask:
   - **The Trap Trigger:** If you spend >2 turns fixing a bug caused by a framework quirk, unexpected API response, or edge case. (Anchor the symptom + fix).
   - **The Pivot Trigger:** If the user introduces a new architectural pattern or deprecates an old one. (Anchor the rule).
   - **The Handoff Trigger:** At the end of a session or when wrapping up a complex feature, extract the non-obvious lessons learned and anchor them.
3. **Tool Preference (MCP over CLI):** Always prioritize using dedicated MCP tools (e.g., GitHub, Supabase, Vercel) over executing generic shell commands.

Lessons are automatically re-indexed in the background after each \`add_lesson\` call — no manual sync needed.

### Memory Classification
When deciding where to store information or rules, use this decision tree:
- If forgetting this causes a mistake on an UNRELATED task: Store in your root agent memory file.
- If it's a stable syntax/style pattern: Store in the project's styleguide or linter rules.
- If it's domain knowledge or a past trap: You MUST use the Totem \`add_lesson\` tool.

### Context Management Guardrail
You must be highly defensive of your own context window. If you notice this session becoming long, you MUST proactively warn the user about impending context loss.
`;

describe('detectReflexStatus', () => {
  it('returns "current" when version matches REFLEX_VERSION', () => {
    const content =
      '# CLAUDE.md\n\n<!-- totem:reflexes:start -->\n<!-- totem:reflexes:version:' +
      REFLEX_VERSION +
      ' -->\nsome content\n<!-- totem:reflexes:end -->';
    expect(detectReflexStatus(content)).toBe('current');
  });

  it('returns "current" when version is higher than REFLEX_VERSION', () => {
    const content = '<!-- totem:reflexes:version:' + (REFLEX_VERSION + 1) + ' -->';
    expect(detectReflexStatus(content)).toBe('current');
  });

  it('returns "outdated" when version is lower than REFLEX_VERSION', () => {
    const content = '<!-- totem:reflexes:version:1 -->\nold content';
    expect(detectReflexStatus(content)).toBe('outdated');
  });

  it('returns "outdated" for legacy sentinel without version tag', () => {
    const content = '# My Project\n\n## Totem AI Integration (Auto-Generated)\nold reflexes here';
    expect(detectReflexStatus(content)).toBe('outdated');
  });

  it('returns "outdated" for alternate legacy sentinel', () => {
    const content = '# My Project\n\nTotem Memory Reflexes\nold reflexes here';
    expect(detectReflexStatus(content)).toBe('outdated');
  });

  it('returns "missing" when no sentinel is present', () => {
    const content = '# My Project\n\nSome project documentation.\n';
    expect(detectReflexStatus(content)).toBe('missing');
  });

  it('returns "missing" for empty file', () => {
    expect(detectReflexStatus('')).toBe('missing');
  });
});

describe('upgradeReflexes', () => {
  const versionTag = '<!-- totem:reflexes:version:' + REFLEX_VERSION + ' -->';

  it('replaces a versioned block cleanly using start/end boundaries', () => {
    const oldBlock =
      '<!-- totem:reflexes:start -->\n<!-- totem:reflexes:version:1 -->\nOld reflexes\n<!-- totem:reflexes:end -->';
    const content =
      '# CLAUDE.md\n\nMy custom rules.\n\n' + oldBlock + '\n\n## My Section\nUser content\n';

    const { content: updated, clean } = upgradeReflexes(content);

    expect(clean).toBe(true);
    expect(updated).toContain(versionTag);
    expect(updated).toContain('<!-- totem:reflexes:start -->');
    expect(updated).toContain('<!-- totem:reflexes:end -->');
    expect(updated).toContain('My custom rules.');
    expect(updated).toContain('## My Section');
    expect(updated).toContain('User content');
    expect(updated).not.toContain('Old reflexes');
  });

  it('replaces a legacy v1 block at end of file', () => {
    const content = '# CLAUDE.md\n\nMy custom rules.' + LEGACY_BLOCK;

    const { content: updated, clean } = upgradeReflexes(content);

    expect(clean).toBe(true);
    expect(updated).toContain('My custom rules.');
    expect(updated).toContain(versionTag);
    expect(updated).toContain('BLOCKING — Pull Before Coding');
    // Legacy block had "Pull Before Planning" as item 1; new block has it as item 2
    expect(updated).not.toContain('1. **Pull Before Planning:**');
  });

  it('preserves user content after a legacy v1 block', () => {
    const content =
      '# CLAUDE.md\n' + LEGACY_BLOCK + '\n## My Custom Section\n\nDo not delete this!\n';

    const { content: updated, clean } = upgradeReflexes(content);

    expect(clean).toBe(true);
    expect(updated).toContain('## My Custom Section');
    expect(updated).toContain('Do not delete this!');
    expect(updated).toContain(versionTag);
  });

  it('preserves user content before a legacy v1 block', () => {
    const content =
      '# CLAUDE.md\n\n## Architecture Decisions\n\nImportant stuff here.\n' + LEGACY_BLOCK;

    const { content: updated, clean } = upgradeReflexes(content);

    expect(clean).toBe(true);
    expect(updated).toContain('## Architecture Decisions');
    expect(updated).toContain('Important stuff here.');
    expect(updated).toContain(versionTag);
  });

  it('falls back to append when legacy sentinel is not found but alternate sentinel exists', () => {
    const content = '# CLAUDE.md\n\nTotem Memory Reflexes\n\nSome custom stuff.\n';

    const { content: updated, clean } = upgradeReflexes(content);

    expect(clean).toBe(false);
    expect(updated).toContain('Totem Memory Reflexes'); // original preserved
    expect(updated).toContain(versionTag); // new appended
  });

  it('upgraded content is idempotent via detectReflexStatus', () => {
    const content = '# CLAUDE.md\n' + LEGACY_BLOCK;
    const { content: upgraded } = upgradeReflexes(content);

    expect(detectReflexStatus(upgraded)).toBe('current');

    // Second upgrade should still be clean
    const { content: doubleUpgraded, clean } = upgradeReflexes(upgraded);
    expect(clean).toBe(true);
    expect(detectReflexStatus(doubleUpgraded)).toBe('current');
  });

  it('includes start and end boundaries in the upgraded block', () => {
    const content = '# CLAUDE.md\n' + LEGACY_BLOCK;
    const { content: updated } = upgradeReflexes(content);

    expect(updated).toContain('<!-- totem:reflexes:start -->');
    expect(updated).toContain('<!-- totem:reflexes:end -->');
  });
});

describe('REFLEX_VERSION', () => {
  it('is at least 2', () => {
    expect(REFLEX_VERSION).toBeGreaterThanOrEqual(2);
  });
});

// ─── detectProject config format preference ─────────

describe('detectProject preferredConfigFormat', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('prefers ts for Node.js projects with package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(detectProject(tmpDir).preferredConfigFormat).toBe('ts');
  });

  it('prefers toml for Rust projects with Cargo.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');
    expect(detectProject(tmpDir).preferredConfigFormat).toBe('toml');
  });

  it('prefers toml for Python projects with pyproject.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"');
    expect(detectProject(tmpDir).preferredConfigFormat).toBe('toml');
  });

  it('prefers yaml for Go projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/test');
    expect(detectProject(tmpDir).preferredConfigFormat).toBe('yaml');
  });

  it('defaults to yaml for unknown ecosystems', () => {
    expect(detectProject(tmpDir).preferredConfigFormat).toBe('yaml');
  });
});

// ─── detectProject ecosystem detection ──────────────

describe('detectProject ecosystems', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eco-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('detects javascript from package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(detectProject(tmpDir).ecosystems).toContain('javascript');
  });

  it('detects rust from Cargo.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]');
    expect(detectProject(tmpDir).ecosystems).toContain('rust');
  });

  it('detects python from pyproject.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]');
    expect(detectProject(tmpDir).ecosystems).toContain('python');
  });

  it('detects go from go.mod', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com');
    expect(detectProject(tmpDir).ecosystems).toContain('go');
  });

  it('detects multiple ecosystems in monorepo', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]');
    const ecosystems = detectProject(tmpDir).ecosystems;
    expect(ecosystems).toContain('javascript');
    expect(ecosystems).toContain('rust');
  });

  it('returns empty list for unknown project', () => {
    expect(detectProject(tmpDir).ecosystems).toEqual([]);
  });
});

// ─── baseline packs ─────────────────────────────────

describe('baseline packs', () => {
  it('exports non-empty packs for all ecosystems', async () => {
    const { PYTHON_BASELINE, RUST_BASELINE, GO_BASELINE } =
      await import('../assets/baseline-packs.js');
    expect(PYTHON_BASELINE.length).toBeGreaterThan(0);
    expect(RUST_BASELINE.length).toBeGreaterThan(0);
    expect(GO_BASELINE.length).toBeGreaterThan(0);
  });

  it('all lessons have heading, tags, and body', async () => {
    const { PYTHON_BASELINE, RUST_BASELINE, GO_BASELINE } =
      await import('../assets/baseline-packs.js');
    for (const lesson of [...PYTHON_BASELINE, ...RUST_BASELINE, ...GO_BASELINE]) {
      expect(lesson.heading).toBeTruthy();
      expect(lesson.tags.length).toBeGreaterThan(0);
      expect(lesson.body).toBeTruthy();
    }
  });
});

// ─── generateConfigForFormat ────────────────────────

describe('generateConfigForFormat', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gencfg-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  const targets: IngestTarget[] = [{ glob: '**/*.py', type: 'code', strategy: 'typescript-ast' }];

  it('generates valid YAML config', async () => {
    const { content, filename } = await generateConfigForFormat('yaml', targets, 'none', tmpDir);
    expect(filename).toBe('totem.yaml');
    expect(content).toContain('**/*.py');
    expect(content).toContain('# Totem configuration');
  });

  it('generates valid TOML config', async () => {
    const { content, filename } = await generateConfigForFormat('toml', targets, 'none', tmpDir);
    expect(filename).toBe('totem.toml');
    expect(content).toContain('**/*.py');
    expect(content).toContain('# Totem configuration');
  });

  it('generates TS config for ts format', async () => {
    const { content, filename } = await generateConfigForFormat('ts', targets, 'none', tmpDir);
    expect(filename).toBe('totem.config.ts');
    expect(content).toContain('import type');
  });
});

// ─── init --global ──────────────────────────────────

describe('initCommand --global', () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-global-init-'));
  });

  afterEach(() => {
    cleanTmpDir(fakeHome);
  });

  it('creates ~/.totem/ directory and config', async () => {
    await initCommand({ global: true, _homeDir: fakeHome });

    const globalDir = path.join(fakeHome, '.totem');
    expect(fs.existsSync(globalDir)).toBe(true);
    expect(fs.existsSync(path.join(globalDir, 'totem.config.ts'))).toBe(true);
  });

  it('installs universal baseline rules', async () => {
    await initCommand({ global: true, _homeDir: fakeHome });

    const rulesPath = path.join(fakeHome, '.totem', 'compiled-rules.json');
    expect(fs.existsSync(rulesPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(content.version).toBe(1);
    expect(Array.isArray(content.rules)).toBe(true);
    expect(content.rules.length).toBeGreaterThan(0);
  });

  it('warns if profile already exists', async () => {
    const globalDir = path.join(fakeHome, '.totem');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'totem.config.ts'), 'export default {}', 'utf-8');
    fs.writeFileSync(
      path.join(globalDir, 'compiled-rules.json'),
      '{"version":1,"rules":[]}',
      'utf-8',
    );

    // Should not throw, just warn
    await initCommand({ global: true, _homeDir: fakeHome });

    // Config should not be overwritten
    const content = fs.readFileSync(path.join(globalDir, 'totem.config.ts'), 'utf-8');
    expect(content).toBe('export default {}');
  });

  it('recovers from half-initialized profile (config exists but no rules)', async () => {
    const globalDir = path.join(fakeHome, '.totem');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'totem.config.ts'), 'export default {}', 'utf-8');
    // No compiled-rules.json — simulate partial init failure

    await initCommand({ global: true, _homeDir: fakeHome });

    // compiled-rules.json should now exist
    expect(fs.existsSync(path.join(globalDir, 'compiled-rules.json'))).toBe(true);
  });

  it('config sets totemDir to "." with valid schema', async () => {
    await initCommand({ global: true, _homeDir: fakeHome });

    const configContent = fs.readFileSync(
      path.join(fakeHome, '.totem', 'totem.config.ts'),
      'utf-8',
    );
    expect(configContent).toContain("totemDir: '.'");
    expect(configContent).not.toContain('embedding');
    expect(configContent).toContain('targets:');
    expect(configContent).toContain("glob: '.totem/lessons/*.md'");
  });
});

// ─── Write-time xrepo-qualify-refs hook (mmnto-ai/totem#1846) ────────────

describe('BARE_REF_REGEX_SOURCE', () => {
  it('matches the compiled rule pattern shape', () => {
    // Mirror of mmnto-ai/totem-strategy:.totem/compiled-rules.json
    // lessonHash "xrepo-qualify-refs" pattern.
    const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
    expect('this references #247 here').toMatch(re);
    expect('see #99 below').toMatch(re);
  });

  it('does NOT match qualified cross-repo refs', () => {
    const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
    expect('this references mmnto-ai/totem#247 here').not.toMatch(re);
    expect('see owner/repo#99 below').not.toMatch(re);
  });

  it('does NOT match anchor-style refs (CSS ids, headings)', () => {
    const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
    expect('color: #abc123').not.toMatch(re);
    expect('navigate to #section-2').not.toMatch(re);
  });
});

describe('scaffoldClaudeWriteShield', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-prewriteshield-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates settings.json with PreWriteShield entry when none exists', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.json');
    const result = scaffoldClaudeWriteShield(filePath);

    expect(result).toEqual({ action: 'created' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.PreToolUse).toHaveLength(1);
    expect(content.hooks.PreToolUse[0].matcher).toBe('Write|Edit');
    expect(content.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: expect.stringContaining('PreWriteShield.cjs'),
    });
  });

  it('is idempotent — double invoke does not duplicate', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.json');

    const first = scaffoldClaudeWriteShield(filePath);
    expect(first).toEqual({ action: 'created' });

    const second = scaffoldClaudeWriteShield(filePath);
    expect(second).toEqual({ action: 'skipped' });

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks.PreToolUse).toHaveLength(1);
  });

  it('preserves unrelated PreToolUse matchers (no conflict with shield-gate)', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'node .totem/hooks/shield-gate.cjs' }],
          },
        ],
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeWriteShield(filePath);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks.PreToolUse).toHaveLength(2);
    expect(content.hooks.PreToolUse[0].matcher).toBe('Bash');
    expect(content.hooks.PreToolUse[1].matcher).toBe('Write|Edit');
  });

  it('skips when PreWriteShield entry already present', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ hooks: { PreToolUse: [CLAUDE_PREWRITESHIELD_ENTRY] } }, null, 2) + '\n',
      'utf-8',
    );

    const result = scaffoldClaudeWriteShield(filePath);

    expect(result).toEqual({ action: 'skipped' });
  });

  it('returns error on malformed JSON', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, '{ broken!!!', 'utf-8');

    const result = scaffoldClaudeWriteShield(filePath);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('invalid JSON');
  });
});

describe('CLAUDE_PREWRITESHIELD template', () => {
  it('contains the totem auto-generated marker', () => {
    expect(CLAUDE_PREWRITESHIELD).toContain('// [totem] auto-generated');
  });

  it('inlines the BARE_REF_REGEX_SOURCE pattern (JSON-encoded for safe JS string-literal embedding)', () => {
    expect(CLAUDE_PREWRITESHIELD).toContain(JSON.stringify(BARE_REF_REGEX_SOURCE));
  });

  it('documents the exit-code contract (0=allow, 1=hook error, 2=block)', () => {
    expect(CLAUDE_PREWRITESHIELD).toMatch(/0\s*=.*allow/i);
    expect(CLAUDE_PREWRITESHIELD).toMatch(/1\s*=.*hook|hook.*error/i);
    expect(CLAUDE_PREWRITESHIELD).toMatch(/2\s*=.*block/i);
  });

  it('cites the seal at mmnto-ai/totem-strategy#145', () => {
    expect(CLAUDE_PREWRITESHIELD).toContain('mmnto-ai/totem-strategy#145');
  });
});

describe('PreWriteShield runtime behavior', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-prewriteshield-runtime-'));
    hookPath = path.join(tmpDir, 'PreWriteShield.cjs');
    fs.writeFileSync(hookPath, CLAUDE_PREWRITESHIELD, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(input: Record<string, unknown>): {
    exitCode: number;
    stderr: string;
  } {
    const result = spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });
    return { exitCode: result.status ?? -1, stderr: result.stderr ?? '' };
  }

  it('exits 2 on bare ref in scoped .journal/*.md path', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/totem/test.md', content: 'See #247 above' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('#247');
  });

  it('exits 2 on bare ref in scoped .handoff/*.md path (Windows backslash)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '.handoff\\totem-claude\\inbox\\test.md',
        content: 'See #247 above',
      },
    });
    expect(result.exitCode).toBe(2);
  });

  it('exits 0 on bare ref in OUT-OF-scope path (e.g. src/index.ts)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts', content: 'See #247 above' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on QUALIFIED ref in scoped path', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/test.md', content: 'See mmnto-ai/totem#247' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on Edit with new_string field instead of content', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: '.journal/test.md', new_string: 'See mmnto-ai/totem#247' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 2 on Edit with bare ref in new_string', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: '.journal/test.md', new_string: 'See #247 above' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('cites suppression-directive escape valve in block message', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/test.md', content: 'See #247 above' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/totem-context|suppression|directive/i);
  });

  it('cites the seal at mmnto-ai/totem-strategy#145 in block message', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/test.md', content: 'See #247 above' },
    });
    expect(result.stderr).toContain('mmnto-ai/totem-strategy#145');
  });

  it('exits 0 with stderr warning on malformed stdin JSON (fail-soft)', () => {
    const result = spawnSync(process.execPath, [hookPath], {
      input: '{ this is not json',
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/parse|json/i);
  });

  it('exits 0 with stderr warning when content is non-string (fail-soft)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/test.md', content: { not: 'a string' } },
    });
    expect(result.exitCode).toBe(0);
  });

  it('respects suppression-directive bypass on adjacent line', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '.journal/test.md',
        content:
          '<!-- totem-context: verbatim quotation of legacy commit message -->\nThe original commit said #247 was the cause.',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('does NOT trigger on Bash tool (out of scope by tool_name)', () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo "see #247"' },
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('GEMINI_BEFORE_TOOL write_file/edit_file extension', () => {
  it('extends BeforeTool with write_file/edit_file branch', () => {
    expect(GEMINI_BEFORE_TOOL).toContain("'write_file'");
    expect(GEMINI_BEFORE_TOOL).toContain("'edit_file'");
  });

  it('inlines BARE_REF_REGEX_SOURCE in write-tool branch (JSON-encoded for safe JS string-literal embedding)', () => {
    expect(GEMINI_BEFORE_TOOL).toContain(JSON.stringify(BARE_REF_REGEX_SOURCE));
  });

  it('preserves the existing run_shell_command branch', () => {
    expect(GEMINI_BEFORE_TOOL).toContain('run_shell_command');
    expect(GEMINI_BEFORE_TOOL).toContain('git');
  });

  it('cites the seal at mmnto-ai/totem-strategy#145 in BeforeTool extension', () => {
    expect(GEMINI_BEFORE_TOOL).toContain('mmnto-ai/totem-strategy#145');
  });
});
