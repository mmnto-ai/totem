import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { listSecretsCommand, maskLiteral } from './list-secrets.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-list-secrets-'));
  tmpDirs.push(dir);
  return dir;
}

// ─── Tests ──────────────────────────────────────────────

describe('maskLiteral', () => {
  it('masks values longer than 4 chars', () => {
    expect(maskLiteral('my-secret-key')).toBe('my-s***');
  });

  it('masks values with exactly 4 chars', () => {
    expect(maskLiteral('abcd')).toBe('****');
  });

  it('masks values shorter than 4 chars', () => {
    expect(maskLiteral('abc')).toBe('****');
  });
});

describe('listSecretsCommand', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    for (const dir of tmpDirs) {
      cleanTmpDir(dir);
    }
    tmpDirs = [];
  });

  it('shows both shared and local secrets with source labels', async () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    // Write YAML config with a shared secret
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'secrets:\n  - type: pattern\n    value: "ACME-[A-Z]{4}"\n  - type: literal\n    value: "shared-secret-1"\n',
      'utf-8',
    );

    // Write local secrets.json
    const totemDirPath = path.join(cwd, totemDir);
    fs.mkdirSync(totemDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(totemDirPath, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'literal', value: 'local-secret-1' }],
      }),
      'utf-8',
    );

    const entries = await listSecretsCommand(cwd, totemDir);

    expect(entries).toHaveLength(3);
    expect(entries[0].source).toBe('shared/yaml');
    expect(entries[1].source).toBe('shared/yaml');
    expect(entries[2].source).toBe('local/json');

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('shared/yaml');
    expect(output).toContain('local/json');
    expect(output).toContain('3 custom secret(s) configured');
  });

  it('shows message when no secrets configured', async () => {
    const cwd = makeTmpDir();

    const entries = await listSecretsCommand(cwd);

    expect(entries).toHaveLength(0);

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('No custom secrets configured.');
  });

  it('masks literal values but shows pattern values', async () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    const totemDirPath = path.join(cwd, totemDir);
    fs.mkdirSync(totemDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(totemDirPath, 'secrets.json'),
      JSON.stringify({
        secrets: [
          { type: 'literal', value: 'super-secret-value' },
          { type: 'pattern', value: 'ACME-[A-Z]{4}' },
        ],
      }),
      'utf-8',
    );

    await listSecretsCommand(cwd, totemDir);

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    // Literal should be masked
    expect(output).toContain('supe***');
    expect(output).not.toContain('super-secret-value');
    // Pattern should be shown in full
    expect(output).toContain('ACME-[A-Z]{4}');
  });
});
