import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNpxCommand, scaffoldFile, scaffoldMcpConfig } from './init.js';

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
