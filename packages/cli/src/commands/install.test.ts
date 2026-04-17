import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildTotemignoreDiff,
  detectPackageManager,
  isInExtends,
  isValidTarget,
  resolvePackName,
} from './install.js';

describe('resolvePackName', () => {
  it('strips the pack/ prefix from unscoped targets', () => {
    expect(resolvePackName('pack/agent-security')).toBe('agent-security');
  });

  it('strips the pack/ prefix from scoped targets', () => {
    expect(resolvePackName('pack/@scope/name')).toBe('@scope/name');
  });

  it('returns raw npm names unchanged (no double-strip)', () => {
    expect(resolvePackName('@scope/name')).toBe('@scope/name');
    expect(resolvePackName('name')).toBe('name');
  });
});

describe('isValidTarget', () => {
  it('accepts pack/<name> and pack/@scope/<name>', () => {
    expect(isValidTarget('pack/agent-security')).toBe(true);
    expect(isValidTarget('pack/@totem/pack-agent-security')).toBe(true);
  });

  it('rejects targets without the pack/ prefix', () => {
    expect(isValidTarget('agent-security')).toBe(false);
    expect(isValidTarget('@scope/name')).toBe(false);
  });

  it('rejects malformed scope patterns', () => {
    expect(isValidTarget('pack/@scope')).toBe(false);
    expect(isValidTarget('pack//name')).toBe(false);
    expect(isValidTarget('pack/@/name')).toBe(false);
  });

  it('rejects names with disallowed characters', () => {
    expect(isValidTarget('pack/my_pack')).toBe(false);
    expect(isValidTarget('pack/my pack')).toBe(false);
    expect(isValidTarget('pack/..')).toBe(false);
  });
});

describe('isInExtends', () => {
  it('returns true when the pack name appears inside a single-line extends array', () => {
    const config = `export default { extends: ['@totem/pack-agent-security'] };`;
    expect(isInExtends(config, '@totem/pack-agent-security')).toBe(true);
  });

  it('returns true when the pack name appears inside a multi-line extends array', () => {
    const config = `export default {
  extends: [
    '@totem/pack-agent-security',
    'my-other-pack',
  ],
};`;
    expect(isInExtends(config, '@totem/pack-agent-security')).toBe(true);
    expect(isInExtends(config, 'my-other-pack')).toBe(true);
  });

  it('returns false when the pack name appears only in a comment or unrelated field', () => {
    // CR finding on PR #1516 predecessor: substring-matching across the
    // whole config treats a comment mention as "already installed". The
    // check must scope to the extends array contents.
    const config = `// extends this soon: my-pack
export default { rules: ['my-pack'] };`;
    expect(isInExtends(config, 'my-pack')).toBe(false);
  });

  it('returns false when there is no extends array', () => {
    const config = `export default { rules: [] };`;
    expect(isInExtends(config, 'anything')).toBe(false);
  });

  it('matches regardless of quote style (single, double, backtick)', () => {
    expect(isInExtends(`extends: ['foo']`, 'foo')).toBe(true);
    expect(isInExtends(`extends: ["foo"]`, 'foo')).toBe(true);
    expect(isInExtends(`extends: [\`foo\`]`, 'foo')).toBe(true);
  });
});

describe('buildTotemignoreDiff', () => {
  it('returns the set of pack lines missing from the local file', () => {
    const pack = `node_modules\ndist\nbuild`;
    const local = `node_modules`;
    expect(buildTotemignoreDiff(pack, local)).toEqual(['dist', 'build']);
  });

  it('uses exact-line equality (not substring) to avoid the indexOf false positive', () => {
    // GCA finding on PR #1516 predecessor: `node` inside a pack file must
    // not match `node_modules` in the local file. Set-based exact match
    // over trimmed lines closes the hole.
    expect(buildTotemignoreDiff('node', 'node_modules')).toEqual(['node']);
  });

  it('ignores blank lines and trims whitespace', () => {
    const pack = `  dist  \n\n  build\n`;
    const local = `dist\n`;
    expect(buildTotemignoreDiff(pack, local)).toEqual(['build']);
  });

  it('returns empty when every pack line is already local', () => {
    expect(buildTotemignoreDiff(`a\nb\nc`, `a\nb\nc`)).toEqual([]);
  });

  it('returns every pack line when local is empty', () => {
    expect(buildTotemignoreDiff(`a\nb\nc`, '')).toEqual(['a', 'b', 'c']);
  });
});

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    const tempRoot = path.join(process.cwd(), '.totem', 'temp');
    fs.mkdirSync(tempRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tempRoot, 'totem-install-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('detects pnpm via pnpm-lock.yaml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('pnpm');
  });

  it('detects yarn via yarn.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('yarn');
  });

  it('detects bun via bun.lockb', () => {
    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('bun');
  });

  it('detects bun via bun.lock (text variant)', () => {
    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('bun');
  });

  it('prefers pnpm over yarn when both lockfiles coexist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('pnpm');
  });

  it('falls back to npm when no lockfile is present', () => {
    expect(detectPackageManager(fs, path, tmpDir)).toBe('npm');
  });
});
