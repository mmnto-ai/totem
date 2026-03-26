import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomSecretSchema, loadCustomSecrets } from './secrets.js';
import { cleanTmpDir } from './test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-secrets-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    cleanTmpDir(dir);
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// CustomSecretSchema direct validation
// ---------------------------------------------------------------------------

describe('CustomSecretSchema', () => {
  it('accepts valid pattern type', () => {
    const result = CustomSecretSchema.safeParse({ type: 'pattern', value: 'ACME-[A-Z]+' });
    expect(result.success).toBe(true);
  });

  it('accepts valid literal type', () => {
    const result = CustomSecretSchema.safeParse({ type: 'literal', value: 'my-secret-value' });
    expect(result.success).toBe(true);
  });

  it('rejects values shorter than 4 characters', () => {
    const result = CustomSecretSchema.safeParse({ type: 'literal', value: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('at least 4 characters');
    }
  });

  it('accepts values with exactly 4 characters', () => {
    const result = CustomSecretSchema.safeParse({ type: 'literal', value: 'abcd' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = CustomSecretSchema.safeParse({ type: 'regex', value: 'something-long' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadCustomSecrets
// ---------------------------------------------------------------------------

describe('loadCustomSecrets', () => {
  it('merges yaml and json configurations correctly', () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    // Write YAML config with secrets
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'targets:\n  - glob: "**/*.md"\n    type: spec\n    strategy: markdown-heading\nsecrets:\n  - type: pattern\n    value: "ACME-[A-Z]{4}"\n  - type: literal\n    value: "shared-secret-1"\n',
      'utf-8',
    );

    // Write local secrets.json
    const totemDirPath = path.join(cwd, totemDir);
    fs.mkdirSync(totemDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(totemDirPath, 'secrets.json'),
      JSON.stringify({
        secrets: [
          { type: 'literal', value: 'local-secret-1' },
          { type: 'pattern', value: 'LOCAL-\\d{6}' },
        ],
      }),
      'utf-8',
    );

    const result = loadCustomSecrets(cwd, totemDir);

    expect(result).toHaveLength(4);
    // Shared secrets first
    expect(result[0]).toEqual({ type: 'pattern', value: 'ACME-[A-Z]{4}' });
    expect(result[1]).toEqual({ type: 'literal', value: 'shared-secret-1' });
    // Local secrets after
    expect(result[2]).toEqual({ type: 'literal', value: 'local-secret-1' });
    expect(result[3]).toEqual({ type: 'pattern', value: 'LOCAL-\\d{6}' });
  });

  it('returns empty array when no secrets configured', () => {
    const cwd = makeTmpDir();

    // No YAML config, no secrets.json
    const result = loadCustomSecrets(cwd);
    expect(result).toEqual([]);
  });

  it('handles missing secrets.json gracefully', () => {
    const cwd = makeTmpDir();

    // YAML config with secrets, no secrets.json
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'secrets:\n  - type: literal\n    value: "yaml-only-secret"\n',
      'utf-8',
    );

    const result = loadCustomSecrets(cwd);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'literal', value: 'yaml-only-secret' });
  });

  it('handles missing yaml secrets gracefully', () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';

    // YAML config without secrets field
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'targets:\n  - glob: "**/*.md"\n    type: spec\n    strategy: markdown-heading\n',
      'utf-8',
    );

    // Local secrets.json exists
    const totemDirPath = path.join(cwd, totemDir);
    fs.mkdirSync(totemDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(totemDirPath, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'pattern', value: 'JSON-ONLY-\\d+' }],
      }),
      'utf-8',
    );

    const result = loadCustomSecrets(cwd, totemDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'pattern', value: 'JSON-ONLY-\\d+' });
  });

  it('skips invalid entries with warning', () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';
    const onWarn = vi.fn();

    // YAML config with a mix of valid and invalid secrets
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'secrets:\n  - type: literal\n    value: "valid-secret"\n  - type: literal\n    value: "ab"\n  - type: bogus\n    value: "also-invalid-type"\n',
      'utf-8',
    );

    const result = loadCustomSecrets(cwd, totemDir, onWarn);

    // Only the valid entry should survive
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'literal', value: 'valid-secret' });

    // Two warnings: one for too-short value, one for invalid type
    expect(onWarn).toHaveBeenCalledTimes(2);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Skipping invalid secret entry'));
  });

  it('resolves yaml config files in priority order', () => {
    const cwd = makeTmpDir();

    // Create totem.config.yaml (higher priority)
    fs.writeFileSync(
      path.join(cwd, 'totem.config.yaml'),
      'secrets:\n  - type: literal\n    value: "from-config-yaml"\n',
      'utf-8',
    );

    // Create totem.yaml (lower priority)
    fs.writeFileSync(
      path.join(cwd, 'totem.yaml'),
      'secrets:\n  - type: literal\n    value: "from-totem-yaml"\n',
      'utf-8',
    );

    const result = loadCustomSecrets(cwd);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'literal', value: 'from-config-yaml' });
  });

  it('handles malformed yaml config gracefully', () => {
    const cwd = makeTmpDir();
    const onWarn = vi.fn();

    fs.writeFileSync(path.join(cwd, 'totem.yaml'), ':\n  invalid: [yaml: {{\n', 'utf-8');

    const result = loadCustomSecrets(cwd, '.totem', onWarn);

    expect(result).toEqual([]);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
  });

  it('handles malformed secrets.json gracefully', () => {
    const cwd = makeTmpDir();
    const totemDir = '.totem';
    const onWarn = vi.fn();

    const totemDirPath = path.join(cwd, totemDir);
    fs.mkdirSync(totemDirPath, { recursive: true });
    fs.writeFileSync(path.join(totemDirPath, 'secrets.json'), '{ not valid json', 'utf-8');

    const result = loadCustomSecrets(cwd, totemDir, onWarn);

    expect(result).toEqual([]);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Failed to read secrets.json'));
  });
});
