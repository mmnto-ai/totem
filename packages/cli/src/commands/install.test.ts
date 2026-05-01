import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildTotemignoreDiff,
  detectPackageManager,
  isInExtends,
  isValidTarget,
  resolveCompiledRulesExport,
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
    expect(isValidTarget('pack/@mmnto/pack-agent-security')).toBe(true);
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

  it('rejects pack names with leading hyphens (flag-injection hardening)', () => {
    // Paired with the `--` delimiter on the pm install invocation: a
    // name like `-rf` would otherwise parse as a package-manager flag.
    expect(isValidTarget('pack/-rf')).toBe(false);
    expect(isValidTarget('pack/@scope/-rf')).toBe(false);
    expect(isValidTarget('pack/-')).toBe(false);
  });

  it('rejects targets longer than the 214-char npm package-name limit', () => {
    const long = 'pack/' + 'a'.repeat(250);
    expect(isValidTarget(long)).toBe(false);
  });
});

describe('resolveCompiledRulesExport', () => {
  it('returns a plain string export unchanged', () => {
    expect(resolveCompiledRulesExport('./compiled-rules.json')).toBe('./compiled-rules.json');
  });

  it('returns the default condition from an exports object', () => {
    expect(
      resolveCompiledRulesExport({
        default: './dist/compiled-rules.json',
        types: './dist/compiled-rules.d.ts',
      }),
    ).toBe('./dist/compiled-rules.json');
  });

  it('falls back to the first string value when no default is present', () => {
    expect(
      resolveCompiledRulesExport({
        import: './dist/import.json',
        require: './dist/require.json',
      }),
    ).toBe('./dist/import.json');
  });

  it('returns null for unresolvable values', () => {
    expect(resolveCompiledRulesExport(null)).toBeNull();
    expect(resolveCompiledRulesExport(undefined)).toBeNull();
    expect(resolveCompiledRulesExport(42)).toBeNull();
    expect(resolveCompiledRulesExport({ types: null, default: 42 })).toBeNull();
  });
});

describe('isInExtends', () => {
  it('returns true when the pack name appears inside a single-line extends array', () => {
    const config = `export default { extends: ['@mmnto/pack-agent-security'] };`;
    expect(isInExtends(config, '@mmnto/pack-agent-security')).toBe(true);
  });

  it('returns true when the pack name appears inside a multi-line extends array', () => {
    const config = `export default {
  extends: [
    '@mmnto/pack-agent-security',
    'my-other-pack',
  ],
};`;
    expect(isInExtends(config, '@mmnto/pack-agent-security')).toBe(true);
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

  it('ignores a commented-out extends array (Shield finding on PR #1516)', () => {
    // A leftover `// extends: ['old-pack']` line must not be read as the
    // active declaration. Otherwise installing `old-pack` would skip with
    // "already installed" when the extends array is in fact absent.
    const config = `// extends: ['old-pack']
export default { rules: [] };`;
    expect(isInExtends(config, 'old-pack')).toBe(false);
  });

  it('ignores an extends declaration inside a block comment', () => {
    const config = `/*
  extends: ['old-pack'],
*/
export default { rules: [] };`;
    expect(isInExtends(config, 'old-pack')).toBe(false);
  });

  it('ignores extends syntax inside a string literal (GCA finding on PR #1516)', () => {
    // A rule message or regex pattern in a string literal may happen to
    // contain the structural sequence `extends: ['foo']`. The matcher
    // must not treat that as the active declaration.
    const config = `export default {
  rules: [{ message: "Do not use extends: ['old-pack']" }],
};`;
    expect(isInExtends(config, 'old-pack')).toBe(false);
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

  // Variants declared on a single line so the co-located-reference
  // rule sees both literal strings in one place. Individual tests then
  // reference the constants to exercise each probe path independently,
  // which catches a regression in either code path (CR finding on PR
  // mmnto-ai/totem#1516: writing both in one test masks a broken probe).
  const [BUN_LOCKB_FIXTURE, BUN_LOCK_FIXTURE] = ['bun.lockb', 'bun.lock'];

  it('detects bun via the binary lockfile variant', () => {
    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, BUN_LOCKB_FIXTURE), '');
    expect(detectPackageManager(fs, path, tmpDir)).toBe('bun');
  });

  it('detects bun via the text lockfile variant', () => {
    // totem-context: intentional bun lockfile fixture for tests
    fs.writeFileSync(path.join(tmpDir, BUN_LOCK_FIXTURE), '');
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
