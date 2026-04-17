import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectPackageManager, installCommand, resolvePackName } from './install.js';

describe('install command', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-install-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
      throw new Error(`Process exited with code: ${code}`);
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('resolves scoped and unscoped pack names correctly', () => {
    expect(resolvePackName('pack/@scope/name')).toBe('@scope/name');
    expect(resolvePackName('pack/name')).toBe('name');
    expect(resolvePackName('@scope/name')).toBe('@scope/name');
    expect(resolvePackName('name')).toBe('name');
  });

  it('detects package manager correctly', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
    fs.rmSync(path.join(tmpDir, 'pnpm-lock.yaml'));

    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('yarn');
    fs.rmSync(path.join(tmpDir, 'yarn.lock'));

    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('bun');
    fs.rmSync(path.join(tmpDir, 'bun.lock'));

    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  // More tests would be written to mock child_process.execSync or safeExec.
});
