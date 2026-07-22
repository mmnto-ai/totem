import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestTarget } from '@mmnto/totem';
import { AUTO_CLOSE_REGEX_SOURCE, LedgerEventSchema, resolveSelfAgents } from '@mmnto/totem';

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
  OLLAMA_FLOOR_DEFAULT_BASE_URL,
  probeOllamaFloor,
  REFLEX_VERSION,
  scaffoldClaudeHooks,
  scaffoldClaudeSessionStart,
  scaffoldClaudeSkill,
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
  CLAUDE_SESSION_START,
  CLAUDE_SESSION_START_ENTRY,
  DISTRIBUTED_CLAUDE_SKILLS,
  GEMINI_BEFORE_TOOL,
  GEMINI_SESSION_START,
  generateConfigForFormat,
  REVIEW_LOOP_SKILL_CONTENT,
  REVIEW_REPLY_SKILL_CONTENT,
  SIGNOFF_SKILL_CONTENT,
  SIGNON_SKILL_CONTENT,
  SKILL_MARKER_END,
  SKILL_MARKER_START,
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

  it('skips a user file that merely QUOTES the marker (marker not at start), never exists', () => {
    // Positional ownership gate (mmnto-ai/totem#2413): a user-owned file that quotes
    // the marker string in its body is NOT marker-headed → `skipped` (not `exists`),
    // and never written (even with an end marker threaded, i.e. via `--force` callers).
    const filePath = path.join(tmpDir, 'hook.js');
    const quotesMarker = `// user hook\n// see: ${MARKER}\nconsole.log("mine");\n`;
    fs.writeFileSync(filePath, quotesMarker, 'utf-8');

    expect(scaffoldFile(filePath, CONTENT, MARKER, '// [totem] end auto-generated')).toEqual({
      action: 'skipped',
    });
    // Byte-untouched.
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(quotesMarker);
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

// ─── Ollama floor probe (mmnto-ai/totem#1851 PR-2) ────────

describe('probeOllamaFloor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns available=true with detected message when Ollama is reachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const result = await probeOllamaFloor();
    expect(result.available).toBe(true);
    expect(result.baseUrl).toBe(OLLAMA_FLOOR_DEFAULT_BASE_URL);
    expect(result.message).toContain(OLLAMA_FLOOR_DEFAULT_BASE_URL);
    // Spec contract beats: floor framing + "no API key, no quota, runs locally"
    expect(result.message).toContain('no API key, no quota, runs locally');
  });

  it('returns available=false with install hint when Ollama is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const result = await probeOllamaFloor();
    expect(result.available).toBe(false);
    expect(result.baseUrl).toBe(OLLAMA_FLOOR_DEFAULT_BASE_URL);
    // Spec contract: install URL surfaces only when absent
    expect(result.message).toContain('https://ollama.com');
    // Floor framing preserved across both states
    expect(result.message).toContain('no API key, no quota, runs locally');
  });

  it('does not throw when probe times out (returns available=false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    const result = await probeOllamaFloor();
    expect(result.available).toBe(false);
    expect(result.message).toContain('https://ollama.com');
  });

  it('does not throw when isOllamaAvailable itself rejects (dependency-level failure)', async () => {
    // Locks the never-throws contract against a regression in the
    // upstream `isOllamaAvailable` primitive: even if a future refactor
    // loosens its swallow-all-errors guarantee, `probeOllamaFloor`
    // still returns the absent state so init doesn't abort mid-flight.
    const totem = await import('@mmnto/totem');
    vi.spyOn(totem, 'isOllamaAvailable').mockRejectedValueOnce(
      new Error('simulated upstream contract regression'),
    );

    const result = await probeOllamaFloor();
    expect(result.available).toBe(false);
    expect(result.baseUrl).toBe(OLLAMA_FLOOR_DEFAULT_BASE_URL);
    expect(result.message).toContain('https://ollama.com');
    expect(result.message).toContain('no API key, no quota, runs locally');
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

// Phase C slice 1 — symmetric Claude SessionStart hook (mmnto-ai/totem#1845).
// Locks the install-side parity with .gemini/hooks/SessionStart.js: scaffold
// the .cjs script, merge a SessionStart entry into committed
// .claude/settings.json, idempotency on re-run, preserve user hooks +
// coexist with Phase B's PreWriteShield entry under the same hooks object.
describe('scaffoldClaudeSessionStart', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-claude-sessionstart-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates settings.json with SessionStart entry when none exists', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.json');
    const result = scaffoldClaudeSessionStart(filePath);

    expect(result).toEqual({ action: 'created' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.SessionStart).toHaveLength(1);
    expect(content.hooks.SessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'node .claude/hooks/SessionStart.cjs',
      timeout: 30000,
    });
    // SessionStart entries do NOT carry a `matcher` field.
    expect(content.hooks.SessionStart[0].matcher).toBeUndefined();
  });

  it('is idempotent — double invoke does not duplicate', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.json');

    const first = scaffoldClaudeSessionStart(filePath);
    expect(first).toEqual({ action: 'created' });

    const second = scaffoldClaudeSessionStart(filePath);
    expect(second).toEqual({ action: 'skipped' });

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks.SessionStart).toHaveLength(1);
  });

  it('preserves a user-defined SessionStart entry alongside the Totem entry', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo "user-defined"' }] }],
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeSessionStart(filePath);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks.SessionStart).toHaveLength(2);
    expect(content.hooks.SessionStart[0].hooks[0].command).toBe('echo "user-defined"');
    expect(content.hooks.SessionStart[1].hooks[0].command).toContain('SessionStart.cjs');
  });

  it('coexists with Phase B PreWriteShield entry under the same hooks object', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    const existing = {
      hooks: { PreToolUse: [CLAUDE_PREWRITESHIELD_ENTRY] },
    };
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    const result = scaffoldClaudeSessionStart(filePath);

    expect(result).toEqual({ action: 'merged' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.hooks.PreToolUse).toHaveLength(1);
    expect(content.hooks.PreToolUse[0].matcher).toBe('Write|Edit');
    expect(content.hooks.SessionStart).toHaveLength(1);
    expect(content.hooks.SessionStart[0].hooks[0].command).toContain('SessionStart.cjs');
  });

  it('skips when a Totem SessionStart entry is already present', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ hooks: { SessionStart: [CLAUDE_SESSION_START_ENTRY] } }, null, 2) + '\n',
      'utf-8',
    );

    const result = scaffoldClaudeSessionStart(filePath);

    expect(result).toEqual({ action: 'skipped' });
  });

  it('returns error on malformed JSON', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, '{ broken!!!', 'utf-8');

    const result = scaffoldClaudeSessionStart(filePath);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('invalid JSON');
  });
});

describe('CLAUDE_SESSION_START template', () => {
  it('contains the totem auto-generated marker', () => {
    expect(CLAUDE_SESSION_START).toContain('// [totem] auto-generated');
  });

  it('routes stderr to stdout (substring contract)', () => {
    // The hook MUST surface CLI stderr alongside stdout because the Totem
    // CLI writes diagnostic output (the actual `describe` text) to stderr;
    // routing it to stdout is the only way Claude sees the orientation
    // banner in its prompt context. Substring-match keeps copy edits cheap
    // while still locking the breadcrumb chain.
    expect(CLAUDE_SESSION_START).toContain('result.stdout');
    expect(CLAUDE_SESSION_START).toContain('result.stderr');
    expect(CLAUDE_SESSION_START).toContain('process.stdout.write');
  });

  it('includes the @mmnto/cli not-installed fallback message', () => {
    expect(CLAUDE_SESSION_START).toContain('@mmnto/cli not installed');
  });

  it('includes the process-error fallback path', () => {
    expect(CLAUDE_SESSION_START).toContain('Briefing unavailable');
  });

  it('uses the canonical node_modules/@mmnto/cli/dist/index.js path probe', () => {
    expect(CLAUDE_SESSION_START).toContain('@mmnto');
    expect(CLAUDE_SESSION_START).toContain("'cli'");
    expect(CLAUDE_SESSION_START).toContain("'dist'");
    expect(CLAUDE_SESSION_START).toContain("'index.js'");
  });

  // A.3.a — SessionStart hook mints session_id + emits session_start ledger event
  it('mints a session_id via crypto.randomUUID', () => {
    expect(CLAUDE_SESSION_START).toContain('randomUUID');
    expect(CLAUDE_SESSION_START).toContain("require('crypto')");
  });

  it('persists session_id to .totem/ledger/.session-id', () => {
    expect(CLAUDE_SESSION_START).toContain(".totem'");
    expect(CLAUDE_SESSION_START).toContain("'ledger'");
    expect(CLAUDE_SESSION_START).toContain(".session-id'");
  });

  it('appends a session_start event to events.ndjson', () => {
    expect(CLAUDE_SESSION_START).toContain("type: 'session_start'");
    expect(CLAUDE_SESSION_START).toContain("activity_name: 'SessionStart'");
    expect(CLAUDE_SESSION_START).toContain('events.ndjson');
    expect(CLAUDE_SESSION_START).toContain('appendFileSync');
  });

  it('derives agent_source from TOTEM_SELF_AGENT instead of stamping a vendor literal', () => {
    // Amended ADR-078 (strategy#879): agent_source is seat-id ∪ {human};
    // 'claude' is a vendor class with no reverse projection to a seat. The
    // hook stamps the env-carried seat and omits the field when unset
    // (Tenet 4: stamp absence, never guess).
    expect(CLAUDE_SESSION_START).toContain('TOTEM_SELF_AGENT');
    expect(CLAUDE_SESSION_START).toContain('agent_source: selfAgent');
    expect(CLAUDE_SESSION_START).not.toContain("agent_source: 'claude'");
  });

  it('keeps the session-start writer fire-and-forget (no rethrow)', () => {
    // The ledger-write block must catch its own errors and NOT block the
    // briefing path that follows. Per Tenet 4 + lesson-b1bae311 (sensors,
    // not actuators). CR R1 (#1920) replaced the empty catch with a stderr
    // breadcrumb — confirm the breadcrumb shape lands in the template.
    expect(CLAUDE_SESSION_START).toContain('catch (err)');
    expect(CLAUDE_SESSION_START).toContain('process.stderr.write');
    expect(CLAUDE_SESSION_START).toContain('Session-start telemetry unavailable');
  });

  it('does NOT propagate strategy-repo-specific orientation pointers', () => {
    // OQ 2 disposition: keep the fallback generic. The strategy reference
    // mentions README.md, design-tenets.md, .journal/strategy/ — none of
    // those should leak into the consumer-facing baseline.
    expect(CLAUDE_SESSION_START).not.toContain('design-tenets');
    expect(CLAUDE_SESSION_START).not.toContain('.journal/strategy');
  });

  it('appends `totem orient --session` ADDITIVELY after the describe briefing (#2044 PR-3)', () => {
    // Tenet 13 sensor separation: describe (static identity) is NOT replaced —
    // orient (live in-flight state) is appended after it. Both must be present,
    // and orient runs via the same node_modules/@mmnto/cli dist probe as describe.
    expect(CLAUDE_SESSION_START).toContain("'describe'"); // describe retained
    expect(CLAUDE_SESSION_START).toContain("'orient'");
    expect(CLAUDE_SESSION_START).toContain("'--session'");
    // Append, not prepend/replace: describe must precede orient in the script.
    expect(CLAUDE_SESSION_START.indexOf("'describe'")).toBeLessThan(
      CLAUDE_SESSION_START.indexOf("'--session'"),
    );
  });
});

describe('GEMINI_SESSION_START template', () => {
  // Locks the family-canonical convergence on `totem describe` per
  // mmnto-ai/totem#1884. The hook must call `describe` to emit the
  // orientation banner consumers integrate against at session start;
  // `status` produces health output (manifest freshness, shield drift)
  // which serves a different purpose. Catches template drift before it
  // ships to fresh-init repos.
  it('contains the totem auto-generated marker', () => {
    expect(GEMINI_SESSION_START).toContain('// [totem] auto-generated');
  });

  it('calls `totem describe` (canonical orientation command)', () => {
    expect(GEMINI_SESSION_START).toContain("'totem describe'");
  });

  it('does NOT call `totem status` (the prior drifted shape)', () => {
    expect(GEMINI_SESSION_START).not.toContain("'totem status'");
  });

  it('uses a 30-second timeout matching the Claude-side hook contract', () => {
    expect(GEMINI_SESSION_START).toContain('timeout: 30000');
  });

  it('routes diagnostic stdio so the banner lands in the session prompt', () => {
    // Gemini SessionStart hooks inherit stdio; the third entry must be
    // 'inherit' for the orientation output to reach the agent.
    expect(GEMINI_SESSION_START).toContain("stdio: ['ignore', 'inherit', 'inherit']");
  });

  it('emits a generic fallback breadcrumb when describe fails', () => {
    // No strategy-repo-specific pointers leak; matches the Claude-side
    // fallback wording for cross-agent consistency.
    expect(GEMINI_SESSION_START).toContain('Briefing unavailable');
    expect(GEMINI_SESSION_START).not.toContain('design-tenets');
    expect(GEMINI_SESSION_START).not.toContain('.journal/strategy');
  });

  it('appends `totem orient --session` ADDITIVELY after describe (#2044 PR-3)', () => {
    // Tenet 13: describe (static identity) retained; orient (live in-flight)
    // appended after it — both present, describe first.
    expect(GEMINI_SESSION_START).toContain("'totem describe'"); // retained
    expect(GEMINI_SESSION_START).toContain("'totem orient --session'");
    expect(GEMINI_SESSION_START.indexOf("'totem describe'")).toBeLessThan(
      GEMINI_SESSION_START.indexOf("'totem orient --session'"),
    );
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

  it('inlines the shared AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762, JSON-encoded)', () => {
    expect(CLAUDE_PREWRITESHIELD).toContain(JSON.stringify(AUTO_CLOSE_REGEX_SOURCE));
  });

  it('cites the auto-close issue mmnto-ai/totem#1762', () => {
    expect(CLAUDE_PREWRITESHIELD).toContain('mmnto-ai/totem#1762');
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

  // ─── Auto-close keyword guard (mmnto-ai/totem#1762) ───────────────────────

  it('exits 2 on a close keyword adjacent to an issue ref in a **/*.md write', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'docs/x.md', content: 'Closes #131' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/auto-close/i);
    expect(result.stderr).toContain('#131');
  });

  it('exits 2 even under NEGATION (presence invariant — the #2471 shape)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.journal/t.md', content: 'Does not close #2466' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/auto-close/i);
    expect(result.stderr).toContain('#2466');
  });

  it('exits 2 on a QUALIFIED close ref (owner/repo#N still auto-closes)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'docs/x.md', content: 'Closes mmnto-ai/totem#131' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/auto-close/i);
  });

  it('exits 2 on the issue-URL close form (kimi BLOCKING-1)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'docs/x.md',
        content: 'Fixes https://github.com/mmnto-ai/totem/issues/2466',
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/auto-close/i);
    expect(result.stderr).toContain('mmnto-ai/totem#2466');
  });

  it('EXEMPTS .github/** from the auto-close guard (AC-4 — keywords intentional there)', () => {
    // Qualified ref so the sealed bare-ref arm (unchanged) also stays quiet; this
    // isolates the auto-close .github exemption.
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '.github/PULL_REQUEST_TEMPLATE.md',
        content: 'Closes mmnto-ai/totem#131',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('EXEMPTS .totem/** from the auto-close guard (gemini #2 — tool/agent-authored content)', () => {
    // Qualified ref isolates the auto-close .totem exemption from the sealed
    // bare-ref rule (which still applies to .totem/*.md — out of this slice's scope).
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.totem/lessons/x.md', content: 'Closes mmnto-ai/totem#131' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('does NOT exempt .changeset/** (its prose is composed into the VP-PR description)', () => {
    // gemini #2 DECLINED half: changeset prose lands in the Version-Packages PR
    // description (an auto-close surface — verified on PR mmnto-ai/totem#2474).
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '.changeset/happy-lions.md', content: 'Fixes mmnto-ai/totem#131' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/auto-close/i);
  });

  it('respects the suppression-directive bypass for a verbatim-quoted close keyword', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'docs/x.md',
        content:
          '<!-- totem-context: verbatim quotation of a historical commit -->\nThe commit said closes #131.',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on a non-keyword issue reference in markdown (references/see form)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'docs/x.md',
        content: 'references mmnto-ai/totem#131 and see mmnto-ai/totem#5',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  // ─── Dispatch frontmatter-quoting guard (mmnto-ai/totem-status#123) ────────

  const OUTBOX_MD = '.totem/orchestration/totem-claude/outbox/2026-07-22T1200Z-reply.md';

  it('exits 2 on an unquoted ": " in an outbox subject: value (strict-YAML breaker)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content: '---\nschema: adr-098-v0.4\nsubject: Re: parity round -- positions\n---\nBody.',
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('subject');
    expect(result.stderr).toMatch(/quote/i);
    expect(result.stderr).toContain('mmnto-ai/totem-status#123');
  });

  it('exits 2 on an unquoted ": " in expected-action: (and names the offending key)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content: '---\nsubject: "safe"\nexpected-action: reply by Friday: with positions\n---\n',
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('expected-action');
  });

  it('exits 2 on a TRAILING colon in an unquoted subject: value', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: OUTBOX_MD, content: '---\nsubject: Re:\n---\n' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('exits 2 at a Windows-backslash outbox path too', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '.totem\\orchestration\\totem-claude\\outbox\\reply.md',
        content: '---\nsubject: Re: broken -- title\n---\n',
      },
    });
    expect(result.exitCode).toBe(2);
  });

  it('exits 0 on a double-quoted subject carrying colons', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content: '---\nsubject: "Re: parity round -- positions"\n---\nBody.',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 2 on a fake block-scalar header with trailing text (">note: x" is not valid YAML)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content: '---\nsubject: >note: this is not a block scalar\n---\n',
      },
    });
    expect(result.exitCode).toBe(2);
  });

  it('exits 0 on a single-quoted value and on a block scalar (>-)', () => {
    const single = runHook({
      tool_name: 'Write',
      tool_input: { file_path: OUTBOX_MD, content: "---\nsubject: 'Re: quoted'\n---\n" },
    });
    expect(single.exitCode).toBe(0);
    const folded = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content: '---\nsubject: >-\n  Re: folded -- safe\n---\n',
      },
    });
    expect(folded.exitCode).toBe(0);
  });

  it('exits 0 on a colon-free unquoted subject (plain scalars stay legal)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: OUTBOX_MD, content: '---\nsubject: parity round positions\n---\n' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('scans the leading frontmatter block ONLY on full-file writes (body prose stays writable)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: OUTBOX_MD,
        content:
          '---\nsubject: "safe"\n---\nsubject: unquoted: colon in body prose about the schema',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('does NOT fire outside the outbox surface (same content at a .journal path)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '.journal/test.md',
        content: '---\nsubject: Re: not a dispatch -- out of scope\n---\n',
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 2 on an Edit fragment reintroducing an unquoted subject (fragment mode)', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: OUTBOX_MD, new_string: 'subject: Re: sharpened -- title' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('honors the totem-context escape in fragment mode (schema discussion in a body edit)', () => {
    const result = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: OUTBOX_MD,
        new_string:
          '<!-- totem-context: verbatim quotation of the malformed specimen -->\nsubject: Re: the specimen that broke strict YAML',
      },
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('CLAUDE_SESSION_START runtime behavior (A.3.a ledger write)', () => {
  // Fail-fast guard for the spawned hook process, matching the 30s timeout
  // the hook's own internal spawnSync uses — a stalled child must fail the
  // test, not hang the runner (CR round 2).
  const HOOK_SPAWN_TIMEOUT_MS = 30_000;

  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-sessionstart-runtime-'));
    hookPath = path.join(tmpDir, 'SessionStart.cjs');
    fs.writeFileSync(hookPath, CLAUDE_SESSION_START, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * Execute the rendered hook in tmpDir with a controlled TOTEM_SELF_AGENT
   * and return the latest session_start event it appended. `undefined`
   * removes the variable so the test is hermetic even when the host shell
   * exports a seat.
   */
  function runHook(selfAgent?: string): Record<string, unknown> {
    const env = { ...process.env };
    delete env['TOTEM_SELF_AGENT'];
    if (selfAgent !== undefined) env['TOTEM_SELF_AGENT'] = selfAgent;
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: tmpDir,
      env,
      encoding: 'utf-8',
      timeout: HOOK_SPAWN_TIMEOUT_MS,
    });
    expect(result.status).toBe(0);
    const ndjson = fs.readFileSync(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'), 'utf-8');
    const lines = ndjson.trim().split('\n');
    return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  }

  it('omits agent_source entirely when TOTEM_SELF_AGENT is unset (Tenet 4: stamp absence)', () => {
    const event = runHook();
    expect('agent_source' in event).toBe(false);
    expect(event.type).toBe('session_start');
    expect(typeof event.session_id).toBe('string');
  });

  it('omits agent_source when TOTEM_SELF_AGENT is empty or comma/whitespace noise', () => {
    for (const value of ['', '   ', ' , ,']) {
      const event = runHook(value);
      expect('agent_source' in event).toBe(false);
    }
  });

  it('stamps the first trimmed non-empty entry from a comma-separated roster', () => {
    const event = runHook(' , strategy-claude , lc-codex ');
    expect(event['agent_source']).toBe('strategy-claude');
  });

  it('stays in parity with resolveSelfAgents env parsing (sync-anchor drift sensor)', () => {
    // The template inlines the comma-split/trim/first-non-empty parse because
    // the rendered standalone .cjs cannot import @mmnto/totem. This parity
    // check is the automated drift sensor behind the sync-anchor comment: if
    // the shared env-parse semantics ever change, this test forces the
    // template to change in the same PR.
    const roster = ' , strategy-claude , lc-codex ';
    const event = runHook(roster);
    const resolved = resolveSelfAgents(tmpDir, { TOTEM_SELF_AGENT: roster });
    expect(resolved.source).toBe('env');
    expect(event['agent_source']).toBe(resolved.agents[0]);
  });

  it('emits an event that parses under the widened schema with a seat-id value', () => {
    // The end-to-end regression this PR fixes: under the old vendor enum a
    // seat-valued session_start would fail safeParse and readLedgerEvents
    // would silently drop it.
    const event = runHook('totem-claude');
    const parsed = LedgerEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.agent_source).toBe('totem-claude');
    }
  });
});

describe('GEMINI_BEFORE_TOOL write_file/replace extension', () => {
  it('gates BOTH check functions on write_file + replace (+ legacy edit_file)', () => {
    // Gemini CLI's real write tools are `write_file` + `replace` — there is NO
    // `edit_file` (docs.gemini file-system tools; gemini-cli#20321). Every check
    // function must list `replace`, else surgical edits bypass the hook
    // (gemini #1). `edit_file` is kept for backward-safety.
    const gates = [...GEMINI_BEFORE_TOOL.matchAll(/toolName !== '([a-z_]+)'/g)].map((m) => m[1]);
    for (const wanted of ['write_file', 'replace']) {
      expect(gates.filter((g) => g === wanted).length).toBeGreaterThanOrEqual(2);
    }
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

  it('inlines the shared AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762, parity with PreWriteShield)', () => {
    expect(GEMINI_BEFORE_TOOL).toContain(JSON.stringify(AUTO_CLOSE_REGEX_SOURCE));
  });

  it('wires the auto-close check into beforeTool and cites mmnto-ai/totem#1762', () => {
    expect(GEMINI_BEFORE_TOOL).toContain('checkAutoCloseKeywords(toolName, toolInput)');
    expect(GEMINI_BEFORE_TOOL).toContain('mmnto-ai/totem#1762');
  });
});

describe('GEMINI_BEFORE_TOOL auto-close runtime behavior (mmnto-ai/totem#1762)', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gemini-beforetool-'));
    hookPath = path.join(tmpDir, 'BeforeTool.js');
    fs.writeFileSync(hookPath, GEMINI_BEFORE_TOOL, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** Require the rendered hook fresh and report whether it threw. */
  function runBeforeTool(
    tool: string,
    input: Record<string, unknown>,
  ): { threw: boolean; message: string } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const beforeTool = require(hookPath) as (t: string, i: unknown) => void;
    try {
      beforeTool(tool, input);
      return { threw: false, message: '' };
    } catch (err) {
      return { threw: true, message: err instanceof Error ? err.message : String(err) };
    }
  }

  it('throws (blocks) on a close keyword adjacent to an issue ref in a **/*.md write, even negated', () => {
    const r = runBeforeTool('write_file', {
      file_path: 'docs/x.md',
      content: 'Does not close #2466',
    });
    expect(r.threw).toBe(true);
    expect(r.message).toMatch(/auto-close/i);
    expect(r.message).toContain('#2466');
  });

  it('blocks the auto-close rule via the real `replace` edit tool (gemini #1)', () => {
    const r = runBeforeTool('replace', {
      file_path: 'docs/x.md',
      new_string: 'Fixes https://github.com/mmnto-ai/totem/issues/2466',
    });
    expect(r.threw).toBe(true);
    expect(r.message).toContain('mmnto-ai/totem#2466');
  });

  it('blocks the xrepo bare-ref rule via `replace` too (fixes the same pre-existing gap)', () => {
    const r = runBeforeTool('replace', { file_path: '.journal/x.md', new_string: 'see #9 above' });
    expect(r.threw).toBe(true);
    expect(r.message).toMatch(/Bare PR\/issue/i);
  });

  it('uses the [totem BeforeTool] prefix, not [totem PreWriteShield] (gemini #3)', () => {
    const r = runBeforeTool('write_file', { file_path: 'docs/x.md', content: 'Closes #5' });
    expect(r.message).toContain('[totem BeforeTool]');
    expect(r.message).not.toContain('PreWriteShield');
  });

  it('exempts .github/** (qualified ref keeps the bare-ref arm quiet too)', () => {
    const r = runBeforeTool('write_file', {
      file_path: '.github/x.md',
      content: 'Closes mmnto-ai/totem#5',
    });
    expect(r.threw).toBe(false);
  });

  it('exempts .totem/** from the auto-close rule (gemini #2)', () => {
    const r = runBeforeTool('write_file', {
      file_path: '.totem/lessons/x.md',
      content: 'Closes mmnto-ai/totem#5',
    });
    expect(r.threw).toBe(false);
  });

  it('does not throw on a non-keyword reference form', () => {
    const r = runBeforeTool('edit_file', {
      file_path: 'docs/x.md',
      new_string: 'see mmnto-ai/totem#5',
    });
    expect(r.threw).toBe(false);
  });

  // ─── Dispatch frontmatter-quoting guard (mmnto-ai/totem-status#123) ────────

  it('throws on an unquoted ": " in an outbox subject: value (parity with PreWriteShield)', () => {
    const r = runBeforeTool('write_file', {
      file_path: '.totem/orchestration/totem-gemini/outbox/reply.md',
      content: '---\nsubject: Re: parity round -- positions\n---\nBody.',
    });
    expect(r.threw).toBe(true);
    expect(r.message).toContain('[totem BeforeTool]');
    expect(r.message).toContain('mmnto-ai/totem-status#123');
  });

  it('does not throw on a quoted outbox subject', () => {
    const r = runBeforeTool('write_file', {
      file_path: '.totem/orchestration/totem-gemini/outbox/reply.md',
      content: '---\nsubject: "Re: parity round -- positions"\n---\nBody.',
    });
    expect(r.threw).toBe(false);
  });

  it('blocks the quoting guard via the real `replace` edit tool too', () => {
    const r = runBeforeTool('replace', {
      file_path: '.totem/orchestration/totem-gemini/outbox/reply.md',
      new_string: 'subject: Re: reintroduced -- unquoted',
    });
    expect(r.threw).toBe(true);
    expect(r.message).toMatch(/quote/i);
  });

  it('blocks the quoting guard via the legacy `edit_file` gate (backward-safety branch)', () => {
    const r = runBeforeTool('edit_file', {
      file_path: '.totem/orchestration/totem-gemini/outbox/reply.md',
      new_string: 'subject: Re: legacy tool -- unquoted',
    });
    expect(r.threw).toBe(true);
  });
});

describe('scaffoldClaudeSkill (mmnto-ai/totem#1890 Phase C slice 3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-skill-test-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates the file with canonical content when none exists', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('created');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SIGNOFF_SKILL_CONTENT);
  });

  it('refreshes inside-marker content and preserves user addenda below the end marker', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const oldCanonical = `---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

${SKILL_MARKER_START}
OLD canonical step 1.
OLD canonical step 2.
${SKILL_MARKER_END}

## User addenda

LC-specific: run \`pnpm docs:inject\` before journal write.
`;
    fs.writeFileSync(filePath, oldCanonical, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('refreshed');

    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('LC-specific: run `pnpm docs:inject`');
    // Inside-marker content should match canonical's inside-marker section.
    const canonicalEnd = SIGNOFF_SKILL_CONTENT.indexOf(SKILL_MARKER_END);
    expect(
      after.startsWith(SIGNOFF_SKILL_CONTENT.slice(0, canonicalEnd + SKILL_MARKER_END.length)),
    ).toBe(true);
  });

  it('returns `unchanged` when the file already matches canonical byte-for-byte', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, SIGNOFF_SKILL_CONTENT, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('unchanged');
  });

  it('preserves a user-authored file without markers and surfaces a migration hint', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const userContent = '# My custom signoff\n\nDo it my way.\n';
    fs.writeFileSync(filePath, userContent, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('preserved');
    expect(result.err).toContain('canonical markers');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(userContent);
  });

  it('preserves a file whose markers are out of order (malformed)', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const malformed = `# Custom\n${SKILL_MARKER_END}\n[bogus content]\n${SKILL_MARKER_START}\n`;
    fs.writeFileSync(filePath, malformed, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('preserved');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(malformed);
  });

  it('DISTRIBUTED_CLAUDE_SKILLS lists signoff, signon, review-reply, and review-loop with their canonical content', () => {
    const names = DISTRIBUTED_CLAUDE_SKILLS.map((s) => s.name);
    expect(names).toEqual(['signoff', 'signon', 'review-reply', 'review-loop']);
    const lookup = Object.fromEntries(DISTRIBUTED_CLAUDE_SKILLS.map((s) => [s.name, s.content]));
    expect(lookup.signoff).toBe(SIGNOFF_SKILL_CONTENT);
    expect(lookup.signon).toBe(SIGNON_SKILL_CONTENT);
    expect(lookup['review-reply']).toBe(REVIEW_REPLY_SKILL_CONTENT);
    expect(lookup['review-loop']).toBe(REVIEW_LOOP_SKILL_CONTENT);
  });

  // ─── review-loop distribution (Prop 304 R2, mmnto-ai/totem#2106) ──────────
  // The warm-lane thin driver scaffolds like its siblings: created on a fresh
  // repo, refreshed inside the markers while preserving below-marker user
  // addenda, unchanged when byte-identical. Mirrors the signoff coverage above
  // so the new skill rides the same marker-based replace contract.
  it('scaffolds review-loop SKILL.md with canonical content + markers on a fresh repo', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'review-loop', 'SKILL.md');
    const result = scaffoldClaudeSkill(filePath, REVIEW_LOOP_SKILL_CONTENT);
    expect(result.action).toBe('created');
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe(REVIEW_LOOP_SKILL_CONTENT);
    expect(written).toContain(SKILL_MARKER_START);
    expect(written).toContain(SKILL_MARKER_END);
  });

  it('refreshes review-loop inside markers and preserves user addenda below', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'review-loop', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stale = `---
name: review-loop
description: stale
---

${SKILL_MARKER_START}
OLD driver step.
${SKILL_MARKER_END}

## User addenda

Local override: post covariate line to the ops channel too.
`;
    fs.writeFileSync(filePath, stale, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, REVIEW_LOOP_SKILL_CONTENT);
    expect(result.action).toBe('refreshed');
    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('Local override: post covariate line to the ops channel too.');
    const canonicalEnd = REVIEW_LOOP_SKILL_CONTENT.indexOf(SKILL_MARKER_END);
    expect(
      after.startsWith(REVIEW_LOOP_SKILL_CONTENT.slice(0, canonicalEnd + SKILL_MARKER_END.length)),
    ).toBe(true);
  });

  it('returns `unchanged` for a review-loop file already matching canonical', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'review-loop', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, REVIEW_LOOP_SKILL_CONTENT, 'utf-8');
    const result = scaffoldClaudeSkill(filePath, REVIEW_LOOP_SKILL_CONTENT);
    expect(result.action).toBe('unchanged');
  });
});

describe('scaffoldClaudeSkill --force-skill-refresh (W3.5, mmnto-ai/totem#2008)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-skill-force-test-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // Invariant 1: default behavior is unchanged. Without force, marker-less
  // files still hit the `preserved` outcome.
  it('without force: marker-less file still preserved (default behavior unchanged)', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const userContent = '# My custom signoff\n\nDo it my way.\n';
    fs.writeFileSync(filePath, userContent, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('preserved');
    expect(result.forceSuppressed).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(userContent);
  });

  // Invariant 2: force overrides preservation for marker-less files. The
  // result becomes `refreshed` with `forceSuppressed: true`, file content
  // is byte-identical to canonical.
  it('with force: marker-less file overwritten + forceSuppressed: true', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const userContent = '# My custom signoff\n\nDo it my way.\n';
    fs.writeFileSync(filePath, userContent, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(result.action).toBe('refreshed');
    expect(result.forceSuppressed).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SIGNOFF_SKILL_CONTENT);
  });

  // Invariant 3: force on a fresh repo (no existing file) is a no-op for
  // force — outcome stays `created`, no `forceSuppressed` flag.
  it('with force: fresh repo (no file) yields `created` with no forceSuppressed', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(result.action).toBe('created');
    expect(result.forceSuppressed).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SIGNOFF_SKILL_CONTENT);
  });

  // Invariant 4: cross-marker preservation contract holds under force. For
  // marker-bearing files, force does NOT additionally overwrite below-marker
  // user customization — only the inside-marker section is refreshed.
  it('with force: marker-bearing file preserves below-marker user content', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const stale = `---
name: signoff
description: stale
---

${SKILL_MARKER_START}
OLD content.
${SKILL_MARKER_END}

## User addenda

Force should NOT erase this line.
`;
    fs.writeFileSync(filePath, stale, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(result.action).toBe('refreshed');
    // forceSuppressed is NOT set — the marker-bearing path was taken, not
    // the no-marker suppression path.
    expect(result.forceSuppressed).toBeUndefined();

    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('Force should NOT erase this line.');
    const canonicalEnd = SIGNOFF_SKILL_CONTENT.indexOf(SKILL_MARKER_END);
    expect(
      after.startsWith(SIGNOFF_SKILL_CONTENT.slice(0, canonicalEnd + SKILL_MARKER_END.length)),
    ).toBe(true);
  });

  // Invariant 5: force on marker-bearing files matches the default refresh
  // path — no spurious forceSuppressed flag. (Combines with invariant 8: the
  // caller's warn-fire condition must read `forceSuppressed === true`.)
  it('with force: marker-bearing file refreshes without forceSuppressed flag', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Marker-bearing file that's already canonical. Should match `unchanged`,
    // not `refreshed` — but either way, no forceSuppressed flag.
    fs.writeFileSync(filePath, SIGNOFF_SKILL_CONTENT, 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(result.action).toBe('unchanged');
    expect(result.forceSuppressed).toBeUndefined();
  });

  // Invariant 8: forceSuppressed is set ONLY on the no-marker suppression
  // path. Both invariants 4 and 5 above already prove the negative case for
  // marker-bearing files; this is an explicit assertion to lock the
  // signal-to-noise discipline at the unit level.
  it('forceSuppressed is set ONLY on the no-marker suppression path', () => {
    const dir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(dir, { recursive: true });

    // Case A: marker-less file + force → forceSuppressed: true
    const markerLessPath = path.join(dir, 'a', 'SKILL.md');
    fs.mkdirSync(path.dirname(markerLessPath), { recursive: true });
    fs.writeFileSync(markerLessPath, 'no markers here\n', 'utf-8');
    const a = scaffoldClaudeSkill(markerLessPath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(a.forceSuppressed).toBe(true);

    // Case B: marker-bearing file (stale inside-marker) + force → no flag
    const markerBearingPath = path.join(dir, 'b', 'SKILL.md');
    fs.mkdirSync(path.dirname(markerBearingPath), { recursive: true });
    fs.writeFileSync(
      markerBearingPath,
      `${SKILL_MARKER_START}\nstale\n${SKILL_MARKER_END}\nuser addenda\n`,
      'utf-8',
    );
    const b = scaffoldClaudeSkill(markerBearingPath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(b.forceSuppressed).toBeUndefined();

    // Case C: fresh repo + force → no flag (no suppression happened)
    const freshPath = path.join(dir, 'c', 'SKILL.md');
    const c = scaffoldClaudeSkill(freshPath, SIGNOFF_SKILL_CONTENT, { force: true });
    expect(c.forceSuppressed).toBeUndefined();

    // Case D: marker-less file + NO force → preserved, no flag (default path)
    const markerLessPath2 = path.join(dir, 'd', 'SKILL.md');
    fs.mkdirSync(path.dirname(markerLessPath2), { recursive: true });
    fs.writeFileSync(markerLessPath2, 'no markers here either\n', 'utf-8');
    const d = scaffoldClaudeSkill(markerLessPath2, SIGNOFF_SKILL_CONTENT);
    expect(d.action).toBe('preserved');
    expect(d.forceSuppressed).toBeUndefined();
  });

  // Invariant 2 (text alignment): the preserve-path error hint advertises
  // the `--force-skill-refresh` flag as the explicit override path.
  it('preserve-path error hint advertises --force-skill-refresh', () => {
    const filePath = path.join(tmpDir, '.claude', 'skills', 'signoff', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Custom\n', 'utf-8');

    const result = scaffoldClaudeSkill(filePath, SIGNOFF_SKILL_CONTENT);
    expect(result.action).toBe('preserved');
    expect(result.err).toContain('--force-skill-refresh');
  });
});

describe('Distributed skill constants match source-of-truth (mmnto-ai/totem#1890)', () => {
  // The canonical skill content embedded in init-templates.ts MUST match the
  // SKILL.md file checked into .claude/skills/<name>/SKILL.md verbatim. If
  // they drift, consumers of `totem init` ship stale skill content. This
  // invariant fails CI rather than silently propagating the drift.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

  it('SIGNOFF_SKILL_CONTENT matches .claude/skills/signoff/SKILL.md', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, '.claude', 'skills', 'signoff', 'SKILL.md'),
      'utf-8',
    );
    expect(SIGNOFF_SKILL_CONTENT).toBe(source);
  });

  // ECL outbox-prune step (mmnto-ai/totem#2279): a new step 5 (prune) inserted
  // after branch-cleanup, with the old Report step renumbered to 6.
  it('SIGNOFF_SKILL_CONTENT carries the ecl-gc prune+compact step and renumbers Report to 6', () => {
    // The step names the self-resolving mechanism with compaction (mmnto-ai/totem#2307).
    expect(SIGNOFF_SKILL_CONTENT).toContain('totem ecl-gc --apply --compact');
    // It is step 5 (inserted after branch-cleanup), now covering prune + compaction.
    expect(SIGNOFF_SKILL_CONTENT).toContain(
      '5. **Prune + compact your own ECL cursor (retention + processed-mark GC).**',
    );
    // Compaction DOES touch processed/ (by design) — the retained promise is
    // journal/-only, not the old "never touches processed/" claim.
    expect(SIGNOFF_SKILL_CONTENT).toContain('Neither phase touches `journal/`');
    // The exit-code contract must be documented so a 1/3 exit does not block the seal.
    expect(SIGNOFF_SKILL_CONTENT).toContain('Do not block the seal on `1` or `3`');
    // The Report step is now step 6, and step 5 is no longer Report.
    expect(SIGNOFF_SKILL_CONTENT).toContain('6. **Report:**');
    expect(SIGNOFF_SKILL_CONTENT).not.toContain('5. **Report:**');
    // Ordering invariant: the gc step precedes the (renumbered) Report step.
    expect(SIGNOFF_SKILL_CONTENT.indexOf('5. **Prune + compact your own ECL cursor')).toBeLessThan(
      SIGNOFF_SKILL_CONTENT.indexOf('6. **Report:**'),
    );
  });

  it('SIGNON_SKILL_CONTENT matches .claude/skills/signon/SKILL.md', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, '.claude', 'skills', 'signon', 'SKILL.md'),
      'utf-8',
    );
    expect(SIGNON_SKILL_CONTENT).toBe(source);
  });

  it('REVIEW_REPLY_SKILL_CONTENT matches .claude/skills/review-reply/SKILL.md', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, '.claude', 'skills', 'review-reply', 'SKILL.md'),
      'utf-8',
    );
    expect(REVIEW_REPLY_SKILL_CONTENT).toBe(source);
  });

  it('REVIEW_LOOP_SKILL_CONTENT matches .claude/skills/review-loop/SKILL.md', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, '.claude', 'skills', 'review-loop', 'SKILL.md'),
      'utf-8',
    );
    expect(REVIEW_LOOP_SKILL_CONTENT).toBe(source);
  });

  // The covariate PR-line is a versioned contract (format v1) consumed by a
  // measurement pilot (Prop 304 R2, mmnto-ai/totem#2106). Its shape is grep-able
  // and MUST NOT drift without a spec amendment — lock the exact template string
  // + the v1 do-not-alter marker into the canonical skill content.
  it('REVIEW_LOOP_SKILL_CONTENT carries the exact covariate line format v1 contract', () => {
    expect(REVIEW_LOOP_SKILL_CONTENT).toContain(
      'local-lane: <verdictHash8> round=<n> settled=<true|false> lanes=<completed>/<attempted>',
    );
    expect(REVIEW_LOOP_SKILL_CONTENT).toContain(
      'covariate line format v1 — do not alter without a spec amendment',
    );
  });

  // rev-6 item 4: the consolidated round-disposition comment is a CONCRETE, executable
  // step — it EXECUTES `totem review --covariate` inside the comment-assembly flow, so the
  // covariate line no longer rides a conditional aside that never runs. Lock the executable
  // invocation (a fenced command, not merely a mention) into the disposition step.
  it('REVIEW_REPLY_SKILL_CONTENT wires `totem review --covariate` into the consolidated disposition step (rev-6 item 4)', () => {
    const parts = REVIEW_REPLY_SKILL_CONTENT.split('## Consolidated round-disposition comment');
    expect(parts.length).toBe(2);
    const section = parts[1]!;
    // Executable (a fenced bash command), not merely mentioned in prose.
    expect(section).toContain('```bash\ntotem review --covariate\n```');
    // The step carries the non-empty local-lane line into the comment body.
    expect(section).toMatch(/local-lane:/);
    // It is a step of the disposition flow the operator gates (single-comment ownership).
    expect(section).toMatch(/operator-gated/);
    // The `done` action reaches this step (wired into the flow, not orphaned).
    expect(REVIEW_REPLY_SKILL_CONTENT).toMatch(/EXECUTES `totem review --covariate`/);
  });
});
