import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectPackageManager, resolvePackName } from './install.js';

describe('install command', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    const tempRoot = path.join(process.cwd(), '.totem', 'temp');
    if (!fs.existsSync(tempRoot)) {
      fs.mkdirSync(tempRoot, { recursive: true });
    }
    tmpDir = fs.mkdtempSync(path.join(tempRoot, 'totem-install-'));
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
    expect(detectPackageManager(fs, path, tmpDir)).toBe('pnpm');
    fs.rmSync(path.join(tmpDir, 'pnpm-lock.yaml'));

    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('yarn');
    fs.rmSync(path.join(tmpDir, 'yarn.lock'));

    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('bun');
    // totem-context: intentional bun lockfile fixture for tests
    fs.rmSync(path.join(tmpDir, 'bun.lockb'), { force: true });
    // totem-context: intentional bun lockfile fixture for tests
    fs.rmSync(path.join(tmpDir, 'bun.lock'), { force: true });

    expect(detectPackageManager(fs, path, tmpDir)).toBe('npm');
  });

  // More tests would be written to mock child_process.execSync or safeExec.
});
