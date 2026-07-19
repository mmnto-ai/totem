import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CompiledRulesFileSchema } from '../compiler-schema.js';
import { fileMatchesGlobs, matchesGlob, matchesPathGlob } from './glob.js';

interface ProfileFixture {
  axis: string;
  filePath: string;
  glob: string;
  ruleEngine: boolean;
  pathClassifier: boolean;
}

const DIVERGENCE_FIXTURES: readonly ProfileFixture[] = [
  {
    axis: 'bare patterns match basenames at depth only in the rule profile',
    filePath: 'nested/Dockerfile',
    glob: 'Dockerfile',
    ruleEngine: true,
    pathClassifier: false,
  },
  {
    axis: 'question marks remain literal in the rule profile',
    filePath: 'src/a.ts',
    glob: 'src/?.ts',
    ruleEngine: false,
    pathClassifier: true,
  },
  {
    axis: 'brace groups remain literal in the rule profile',
    filePath: 'src/a.ts',
    glob: 'src/*.{ts,tsx}',
    ruleEngine: false,
    pathClassifier: true,
  },
  {
    axis: 'glob-side backslashes normalize only in the classifier profile',
    filePath: 'src/a.ts',
    glob: 'src\\*.ts',
    ruleEngine: false,
    pathClassifier: true,
  },
  {
    axis: 'general segment stars remain muted in the rule profile',
    filePath: 'src/pkg/index.ts',
    glob: 'src/*/index.ts',
    ruleEngine: false,
    pathClassifier: true,
  },
  {
    axis: 'basename-length behavior stays frozen for *.ext-shaped patterns',
    filePath: 'test.js',
    glob: '*.test.js',
    ruleEngine: false,
    pathClassifier: false,
  },
  {
    axis: 'matching remains case-sensitive on every platform',
    filePath: 'SRC/a.ts',
    glob: 'src/*.ts',
    ruleEngine: false,
    pathClassifier: false,
  },
  {
    axis: 'trailing-slash patterns stay dead for normal file paths',
    filePath: 'src/a.ts',
    glob: 'src/**/*.ts/',
    ruleEngine: false,
    pathClassifier: false,
  },
];

const AGREEMENT_FIXTURES: readonly Omit<ProfileFixture, 'ruleEngine' | 'pathClassifier'>[] = [
  {
    axis: 'zero-segment **/ matches root files',
    filePath: 'README.md',
    glob: '**/*.md',
  },
  {
    axis: 'recursive extensions match nested files',
    filePath: 'packages/core/src/index.ts',
    glob: '**/*.ts',
  },
  {
    axis: 'directory-prefixed recursion stays repo-root anchored',
    filePath: 'packages/core/src/index.ts',
    glob: 'packages/core/**/*.ts',
  },
  {
    axis: 'path-shaped literals match exactly',
    filePath: 'src/a.ts',
    glob: 'src/a.ts',
  },
  {
    axis: 'path-side Windows separators normalize',
    filePath: 'src\\a.ts',
    glob: 'src/*.ts',
  },
  {
    axis: '*.test.* matching stays basename-only',
    filePath: 'a.test.ts',
    glob: '*.test.*',
  },
];

describe('glob compatibility profiles', () => {
  for (const fixture of DIVERGENCE_FIXTURES) {
    it(fixture.axis, () => {
      expect(matchesGlob(fixture.filePath, fixture.glob)).toBe(fixture.ruleEngine);
      expect(matchesPathGlob(fixture.filePath, fixture.glob)).toBe(fixture.pathClassifier);
    });
  }

  for (const fixture of AGREEMENT_FIXTURES) {
    it(`agreement: ${fixture.axis}`, () => {
      expect(matchesGlob(fixture.filePath, fixture.glob)).toBe(true);
      expect(matchesPathGlob(fixture.filePath, fixture.glob)).toBe(true);
    });
  }

  it('rejects suffix matching on path-shaped literals', () => {
    expect(matchesGlob('packages/src/foo.ts', 'src/foo.ts')).toBe(false);
  });

  it('preserves the rule profile middle-globstar boundary behavior', () => {
    expect(matchesGlob('packages/cli/commands/a.ts', 'packages/cli/**/commands/**/*.ts')).toBe(
      true,
    );
    expect(
      matchesGlob('packages/cli/nested/commands/a.ts', 'packages/cli/**/commands/**/*.ts'),
    ).toBe(false);
    expect(
      matchesPathGlob('packages/cli/nested/commands/a.ts', 'packages/cli/**/commands/**/*.ts'),
    ).toBe(true);
  });

  it('preserves the rule profile empty recursive suffix behavior', () => {
    expect(matchesGlob('prefix/nested/a.ts', 'prefix/**/')).toBe(true);
    expect(matchesPathGlob('prefix/nested/a.ts', 'prefix/**/')).toBe(false);
  });

  it('preserves bare-basename matching across line terminators in rule paths', () => {
    expect(matchesGlob('dir\n/Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('dir\n/Dockerfile.dev', 'Dockerfile')).toBe(false);
    expect(matchesPathGlob('dir\n/Dockerfile', 'Dockerfile')).toBe(false);
    expect(matchesPathGlob('Dockerfile', 'Dockerfile')).toBe(true);
  });

  it('preserves rule globstar matching across line terminators without widening the classifier', () => {
    expect(matchesGlob('dir/a\nb', 'dir/**')).toBe(true);
    expect(matchesGlob('other/a\nb', 'dir/**')).toBe(false);
    expect(matchesPathGlob('dir/a\nb', 'dir/**')).toBe(false);
    expect(matchesPathGlob('dir/ab', 'dir/**')).toBe(true);
  });

  it('preserves leading *. suffix semantics across slash-bearing tails', () => {
    expect(matchesGlob('nested/a.foo/bar', '*.foo/bar')).toBe(true);
    expect(matchesGlob('a.foo/bar', '*.foo/bar')).toBe(true);
    expect(matchesGlob('nested/a.foo/baz', '*.foo/bar')).toBe(false);
    expect(matchesGlob('nested/a.foo/bar.ts', '*.foo/bar.*')).toBe(false);
    expect(matchesGlob('nested/a.foo/.txt', '*.foo/.*')).toBe(false);
    expect(matchesPathGlob('nested/a.foo/bar', '*.foo/bar')).toBe(false);
    expect(matchesPathGlob('a.foo/bar', '*.foo/bar')).toBe(true);
  });

  it('keeps slash-bearing directory-extension remainders dead in the rule profile', () => {
    expect(matchesGlob('dir/a.ts/foo', 'dir/*.ts/foo')).toBe(false);
    expect(matchesGlob('dir/a.ts', 'dir/*.ts')).toBe(true);
    expect(matchesGlob('dir/nested/a.ts', 'dir/*.ts')).toBe(false);
    expect(matchesGlob('dir/a.ts/foo', 'dir/a.ts/foo')).toBe(true);
    expect(matchesPathGlob('dir/a.ts/foo', 'dir/*.ts/foo')).toBe(true);
  });

  it('keeps rule matching stable after more unique patterns than the bounded cache retains', () => {
    const patternCount = 600;
    for (let index = 0; index < patternCount; index++) {
      expect(matchesGlob(`nested/file-${index}.txt`, `file-${index}.txt`)).toBe(true);
    }
    expect(matchesGlob('nested/file-0.txt', 'file-0.txt')).toBe(true);
    expect(matchesGlob('nested/file-599.txt', 'file-599.txt')).toBe(true);
  });
});

describe('fileMatchesGlobs', () => {
  it('applies positive and negative globs with negative-wins precedence', () => {
    expect(fileMatchesGlobs('src/a.ts', ['**/*.ts', '!**/*.test.*'])).toBe(true);
    expect(fileMatchesGlobs('src/a.test.ts', ['!**/*.test.*', '**/*.ts'])).toBe(false);
    expect(fileMatchesGlobs('src/a.test.ts', ['**/*.ts', '!**/*.test.*'])).toBe(false);
  });

  it('defaults to included when there are no positive globs', () => {
    expect(fileMatchesGlobs('src/a.ts', [])).toBe(true);
    expect(fileMatchesGlobs('src/a.ts', ['!**/*.test.*'])).toBe(true);
    expect(fileMatchesGlobs('src/a.test.ts', ['!**/*.test.*'])).toBe(false);
  });
});

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  const end = start === -1 ? -1 : pattern.indexOf('}', start + 1);
  if (start === -1 || end === -1) return [pattern];

  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  return pattern
    .slice(start + 1, end)
    .split(',')
    .flatMap((alternative) => expandBraces(`${prefix}${alternative}${suffix}`));
}

function renderGlob(pattern: string, nestedGlobstar: boolean): string {
  const normalized = pattern.replace(/\\/g, '/');
  let rendered = '';
  let index = 0;

  while (index < normalized.length) {
    if (normalized.slice(index, index + 3) === '**/') {
      rendered += nestedGlobstar ? 'nested/' : '';
      index += 3;
    } else if (normalized.slice(index, index + 2) === '**') {
      rendered += 'nested/file';
      index += 2;
    } else if (normalized[index] === '*') {
      rendered += 'sample';
      index += 1;
    } else if (normalized[index] === '?') {
      rendered += 'q';
      index += 1;
    } else {
      rendered += normalized[index];
      index += 1;
    }
  }

  return rendered;
}

function renderPathSet(unsignedGlobs: readonly string[]): string[] {
  const paths = new Set([
    'Dockerfile',
    'nested/Dockerfile',
    'README.md',
    'package.json',
    'test.js',
    'src/a.ts',
    'src/a.tsx',
    'src/a.js',
    'src/a.test.ts',
    'src/.test.fixtures/a.ts',
    'src/pkg/index.ts',
    'SRC/a.ts',
    'dir/file.ts',
    'nested/dir/file.ts',
    'packages/core/src/index.ts',
    'packages/cli/src/install-hooks.test.ts',
    'packages/core/README.md',
    'target/file.rs',
  ]);

  for (const glob of unsignedGlobs) {
    for (const expanded of expandBraces(glob)) {
      for (const nestedGlobstar of [false, true]) {
        const rendered = renderGlob(expanded, nestedGlobstar);
        if (rendered.length === 0) continue;
        if (rendered.endsWith('/')) {
          paths.add(`${rendered}file.ts`);
        } else {
          paths.add(rendered);
          if (!rendered.includes('/')) paths.add(`nested/${rendered}`);
        }
      }
    }
  }

  for (const rendered of [...paths]) {
    if (rendered.includes('/')) paths.add(rendered.replace(/\//g, '\\'));
  }

  return [...paths].sort();
}

describe('frozen compiled-rule glob corpus', () => {
  it('pins all 255 signed globs, including dead negatives, against rendered paths', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const corpusPath = path.resolve(testDir, '../../../../.totem/compiled-rules.json');
    const corpus = CompiledRulesFileSchema.parse(JSON.parse(readFileSync(corpusPath, 'utf8')));
    const signedGlobs = [
      ...new Set(
        corpus.rules.flatMap((rule) =>
          (rule.fileGlobs ?? []).filter((glob): glob is string => typeof glob === 'string'),
        ),
      ),
    ].sort();
    const unsignedGlobs = [...new Set(signedGlobs.map((glob) => glob.replace(/^!/, '')))];
    const renderedPaths = renderPathSet(unsignedGlobs);
    const rows = signedGlobs.map((signedGlob) => {
      const glob = signedGlob.replace(/^!/, '');
      const matches = renderedPaths.flatMap((filePath, index) =>
        matchesGlob(filePath, glob) ? [index] : [],
      );
      return { signedGlob, matches };
    });
    const digest = createHash('sha256')
      .update(JSON.stringify({ renderedPaths, rows }))
      .digest('hex');

    expect(signedGlobs).toHaveLength(255);
    expect(renderedPaths).toHaveLength(815);
    expect(rows.filter((row) => row.matches.length === 0)).toHaveLength(39);
    expect(digest).toBe('896b5817271daa1c62a55a508baa1cb091e9643b3421a7452c394e7bb7cb1367');
  });
});
