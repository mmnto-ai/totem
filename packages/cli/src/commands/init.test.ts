import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BASELINE_MARKER, UNIVERSAL_LESSONS_MARKDOWN } from '../assets/universal-lessons.js';
import {
  buildNpxCommand,
  detectEmbeddingTier,
  detectReflexStatus,
  generateConfig,
  installBaselineLessons,
  REFLEX_VERSION,
  scaffoldClaudeHooks,
  scaffoldFile,
  scaffoldMcpConfig,
  upgradeReflexes,
} from './init.js';

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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
  const SAVED_KEY = process.env['OPENAI_API_KEY'];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (SAVED_KEY !== undefined) {
      process.env['OPENAI_API_KEY'] = SAVED_KEY;
    } else {
      delete process.env['OPENAI_API_KEY'];
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
  const targets = [
    { glob: 'src/**/*.ts', type: 'code' as const, strategy: 'typescript-ast' as const },
  ];

  it('generates config with openai embedding', () => {
    const config = generateConfig(targets, 'openai');
    expect(config).toContain("provider: 'openai'");
    expect(config).toContain('text-embedding-3-small');
    expect(config).not.toContain('// embedding:');
  });

  it('generates config with ollama embedding', () => {
    const config = generateConfig(targets, 'ollama');
    expect(config).toContain("provider: 'ollama'");
    expect(config).toContain('nomic-embed-text');
  });

  it('generates Lite config with commented-out embedding', () => {
    const config = generateConfig(targets, 'none');
    expect(config).toContain('// embedding:');
    expect(config).toContain('Lite tier');
  });

  it('always includes orchestrator block', () => {
    for (const tier of ['openai', 'ollama', 'none'] as const) {
      const config = generateConfig(targets, tier);
      expect(config).toContain("provider: 'shell'");
    }
  });

  it('always includes ignorePatterns block', () => {
    const config = generateConfig(targets, 'openai');
    expect(config).toContain('ignorePatterns:');
    expect(config).toContain('**/__tests__/**');
    expect(config).toContain('**/*.test.ts');
    expect(config).toContain('**/*.spec.ts');
  });
});

describe('Universal Lessons baseline', () => {
  it('BASELINE_MARKER is an HTML comment', () => {
    expect(BASELINE_MARKER).toMatch(/^<!--.*-->$/);
  });

  it('UNIVERSAL_LESSONS_MARKDOWN contains the marker', () => {
    expect(UNIVERSAL_LESSONS_MARKDOWN).toContain(BASELINE_MARKER);
  });

  it('lessons follow the expected format for markdown chunker', () => {
    // Each lesson should have ## Lesson heading and **Tags:** line
    const headings = UNIVERSAL_LESSONS_MARKDOWN.match(/^## Lesson — /gm);
    const tags = UNIVERSAL_LESSONS_MARKDOWN.match(/^\*\*Tags:\*\* /gm);
    expect(headings).not.toBeNull();
    expect(tags).not.toBeNull();
    expect(headings!.length).toBe(10);
    expect(headings!.length).toBe(tags!.length);
  });

  it('each lesson has non-empty content after the tags line', () => {
    const sections = UNIVERSAL_LESSONS_MARKDOWN.split(/^## Lesson — /m).filter(Boolean);
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
    const combined = existing + UNIVERSAL_LESSONS_MARKDOWN;
    // Marker appears exactly once
    const markers = combined.match(
      new RegExp(BASELINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    );
    expect(markers).toHaveLength(1);
  });

  it('marker check detects already-installed baseline', () => {
    const withBaseline = `# Totem Lessons\n\n---\n${UNIVERSAL_LESSONS_MARKDOWN}`;
    expect(withBaseline.includes(BASELINE_MARKER)).toBe(true);
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
    lessonsPath = path.join(tmpDir, 'lessons.md');
    fs.writeFileSync(lessonsPath, '# Totem Lessons\n\n---\n', 'utf-8');
    // Force non-TTY so prompt is skipped (default to install)
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true });
  });

  it('installs baseline into empty lessons file (non-TTY defaults to yes)', async () => {
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('installed');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain(BASELINE_MARKER);
    expect(content).toContain('prompt-injection');
  });

  it('returns exists when baseline is already present', async () => {
    fs.appendFileSync(lessonsPath, UNIVERSAL_LESSONS_MARKDOWN, 'utf-8');
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('exists');
  });

  it('does not duplicate baseline on second call', async () => {
    await installBaselineLessons(lessonsPath, makeMockRl(''));
    await installBaselineLessons(lessonsPath, makeMockRl(''));
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    const matches = content.match(
      new RegExp(BASELINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    );
    expect(matches).toHaveLength(1);
  });

  it('preserves existing user lessons when installing baseline', async () => {
    const userLesson = '\n## Lesson — custom\n\n**Tags:** custom\n\nMy custom lesson.\n';
    fs.appendFileSync(lessonsPath, userLesson, 'utf-8');
    await installBaselineLessons(lessonsPath, makeMockRl(''));
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain('My custom lesson.');
    expect(content).toContain(BASELINE_MARKER);
  });

  it('skipped when user declines in TTY mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const result = await installBaselineLessons(lessonsPath, makeMockRl('n'));
    expect(result).toBe('skipped');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).not.toContain(BASELINE_MARKER);
  });

  it('installs when user accepts in TTY mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const result = await installBaselineLessons(lessonsPath, makeMockRl(''));
    expect(result).toBe('installed');
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain(BASELINE_MARKER);
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
