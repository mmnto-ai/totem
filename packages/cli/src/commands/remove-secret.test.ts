import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecretsFile } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { removeSecretCommand } from './remove-secret.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-remove-secret-'));
  tmpDirs.push(dir);
  return dir;
}

function writeSecretsJson(cwd: string, totemDir: string, data: SecretsFile): void {
  const dirPath = path.join(cwd, totemDir);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(
    path.join(dirPath, 'secrets.json'),
    JSON.stringify(data, null, 2) + '\n',
    'utf-8',
  );
}

function readSecretsJson(cwd: string, totemDir: string): SecretsFile {
  const content = fs.readFileSync(path.join(cwd, totemDir, 'secrets.json'), 'utf-8');
  return JSON.parse(content) as SecretsFile;
}

// ─── Tests ──────────────────────────────────────────────

describe('removeSecretCommand', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    for (const dir of tmpDirs) {
      cleanTmpDir(dir);
    }
    tmpDirs = [];
  });

  it('removes entry at specified index', async () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    writeSecretsJson(cwd, totemDir, {
      secrets: [
        { type: 'literal', value: 'first-secret' },
        { type: 'pattern', value: 'PATTERN-\\d+' },
        { type: 'literal', value: 'third-secret' },
      ],
    });

    // Remove the second entry (index 2, which is the second local/json secret)
    await removeSecretCommand('2', cwd, totemDir);

    const updated = readSecretsJson(cwd, totemDir);
    expect(updated.secrets).toHaveLength(2);
    expect(updated.secrets[0].value).toBe('first-secret');
    expect(updated.secrets[1].value).toBe('third-secret');

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Removed');
  });

  it('rejects out-of-range index', async () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    writeSecretsJson(cwd, totemDir, {
      secrets: [{ type: 'literal', value: 'only-secret' }],
    });

    await expect(removeSecretCommand('5', cwd, totemDir)).rejects.toThrow('process.exit called');

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('out of range');
  });

  it('rejects removal of shared yaml secrets', async () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    // Write a YAML config with a shared secret
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'secrets:\n  - type: literal\n    value: "yaml-secret-val"\n',
      'utf-8',
    );

    // Write local secrets.json
    writeSecretsJson(cwd, totemDir, {
      secrets: [{ type: 'literal', value: 'local-secret' }],
    });

    // Index 1 should be the yaml secret
    await expect(removeSecretCommand('1', cwd, totemDir)).rejects.toThrow('process.exit called');

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Cannot remove shared secrets from CLI');
    expect(output).toContain('totem.config.yaml');
  });
});
