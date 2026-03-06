import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNpxCommand, scaffoldClaudeHooks, scaffoldFile, scaffoldMcpConfig } from './init.js';

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
    expect(JSON.stringify(content.hooks.PreToolUse[1])).toContain('totem shield');
  });

  it('skips when totem shield hook already exists', () => {
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

  it('returns error on malformed JSON', () => {
    const dir = path.join(tmpDir, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'settings.local.json');
    fs.writeFileSync(filePath, '{ broken!!!', 'utf-8');

    const result = scaffoldClaudeHooks(filePath);

    expect(result.action).toBe('skipped');
    expect(result.err).toContain('invalid JSON');
  });

  it('is idempotent — double invoke does not duplicate', () => {
    const filePath = path.join(tmpDir, '.claude', 'settings.local.json');

    const first = scaffoldClaudeHooks(filePath);
    expect(first).toEqual({ action: 'created' });

    const second = scaffoldClaudeHooks(filePath);
    expect(second).toEqual({ action: 'skipped' });
  });

  it('Gemini hooks scaffold all three files', () => {
    const geminiDir = path.join(tmpDir, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });

    const hooksDir = path.join(geminiDir, 'hooks');
    const skillsDir = path.join(geminiDir, 'skills');

    // Scaffold using scaffoldFile directly (same as installGeminiHooks internally)
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

  it('Gemini hooks skip user-customized files', () => {
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
