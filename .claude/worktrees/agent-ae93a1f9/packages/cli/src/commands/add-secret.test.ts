import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecretsFile } from '@mmnto/totem';

import { addSecretCommand } from './add-secret.js';

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-add-secret-'));
}

function readSecrets(cwd: string): SecretsFile {
  const content = fs.readFileSync(path.join(cwd, '.totem', 'secrets.json'), 'utf-8');
  return JSON.parse(content) as SecretsFile;
}

// ─── Tests ──────────────────────────────────────────────

describe('addSecretCommand', () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('creates secrets.json with new literal secret', async () => {
    await addSecretCommand('my-secret-value', {}, tmpDir);

    const data = readSecrets(tmpDir);
    expect(data.secrets).toHaveLength(1);
    expect(data.secrets[0]).toEqual({ type: 'literal', value: 'my-secret-value' });
  });

  it('appends to existing secrets.json', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    const existing: SecretsFile = { secrets: [{ type: 'literal', value: 'existing-secret' }] };
    fs.writeFileSync(path.join(totemDir, 'secrets.json'), JSON.stringify(existing, null, 2));

    await addSecretCommand('second-secret', {}, tmpDir);

    const data = readSecrets(tmpDir);
    expect(data.secrets).toHaveLength(2);
    expect(data.secrets[0]).toEqual({ type: 'literal', value: 'existing-secret' });
    expect(data.secrets[1]).toEqual({ type: 'literal', value: 'second-secret' });
  });

  it('rejects values shorter than 4 characters', async () => {
    await addSecretCommand('abc', {}, tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('at least 4 characters');
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'secrets.json'))).toBe(false);
  });

  it('rejects invalid regex with --pattern', async () => {
    await addSecretCommand('[invalid(', { pattern: true }, tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Invalid regex');
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'secrets.json'))).toBe(false);
  });

  it('stores pattern type with --pattern flag', async () => {
    await addSecretCommand('ACME_[A-Z0-9]{8}', { pattern: true }, tmpDir);

    const data = readSecrets(tmpDir);
    expect(data.secrets).toHaveLength(1);
    expect(data.secrets[0]).toEqual({ type: 'pattern', value: 'ACME_[A-Z0-9]{8}' });
  });

  it('ensures .gitignore contains secrets.json path', async () => {
    // Create a .gitignore without the secrets entry
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n.env\n');

    await addSecretCommand('test-secret', {}, tmpDir);

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.totem/secrets.json');
    // Should not duplicate existing lines
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('.env');
  });

  it('creates .gitignore if it does not exist', async () => {
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);

    await addSecretCommand('test-secret', {}, tmpDir);

    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignore.trim()).toBe('.totem/secrets.json');
  });

  it('rejects duplicate entries', async () => {
    // First add
    await addSecretCommand('duplicate-val', {}, tmpDir);

    // Second add — same type + value
    await addSecretCommand('duplicate-val', {}, tmpDir);
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Duplicate');

    // Should still only have one entry
    const data = readSecrets(tmpDir);
    expect(data.secrets).toHaveLength(1);
  });

  it('does not duplicate .gitignore entry when already present', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.totem/secrets.json\n');

    await addSecretCommand('test-secret', {}, tmpDir);

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const matches = gitignore.split('\n').filter((line) => line.trim() === '.totem/secrets.json');
    expect(matches).toHaveLength(1);
  });
});
