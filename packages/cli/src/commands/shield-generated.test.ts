import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildGeneratedArtifactSection,
  classifyGeneratedArtifacts,
  DEFAULT_GENERATED_ARTIFACT_GLOBS,
  formatGeneratedArtifactLine,
  gitattributesPatternToGlob,
  hashDiffSection,
  readGitattributesGeneratedPatterns,
  splitDiffIntoFileSections,
} from './shield-generated.js';

// ─── Diff builders ──────────────────────────────────────

/** A minimal modified-file (regenerated) diff section. */
function modifiedSection(file: string, added = 1, removed = 1): string {
  const plus = Array.from({ length: added }, (_, i) => `+added-${i}`).join('\n');
  const minus = Array.from({ length: removed }, (_, i) => `-removed-${i}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `index 1111111..2222222 100644`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed} +1,${added} @@`,
    minus,
    plus,
    '',
  ].join('\n');
}

function addedSection(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `new file mode 100644`,
    `index 0000000..3333333`,
    `--- /dev/null`,
    `+++ b/${file}`,
    `@@ -0,0 +1,2 @@`,
    `+line one`,
    `+line two`,
    '',
  ].join('\n');
}

function deletedSection(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `deleted file mode 100644`,
    `index 4444444..0000000`,
    `--- a/${file}`,
    `+++ /dev/null`,
    `@@ -1,1 +0,0 @@`,
    `-only line`,
    '',
  ].join('\n');
}

function binarySection(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `index 5555555..6666666 100644`,
    `Binary files a/${file} and b/${file} differ`,
    '',
  ].join('\n');
}

// ─── splitDiffIntoFileSections ──────────────────────────

describe('splitDiffIntoFileSections', () => {
  it('reconstructs the input exactly when sections are joined', () => {
    const diff = modifiedSection('src/a.ts') + modifiedSection('src/b.ts');
    const sections = splitDiffIntoFileSections(diff);
    expect(sections.map((s) => s.section).join('')).toBe(diff);
  });

  it('extracts the destination path of each section', () => {
    const diff = modifiedSection('src/a.ts') + addedSection('dist/out.js');
    const sections = splitDiffIntoFileSections(diff);
    expect(sections.map((s) => s.file)).toEqual(['src/a.ts', 'dist/out.js']);
  });

  it('handles quoted (spaced) paths', () => {
    const diff = [
      'diff --git "a/my file.ts" "b/my file.ts"',
      '--- "a/my file.ts"',
      '+++ "b/my file.ts"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const sections = splitDiffIntoFileSections(diff);
    expect(sections[0]?.file).toBe('my file.ts');
  });

  it('returns an empty array for an empty diff', () => {
    expect(splitDiffIntoFileSections('')).toEqual([]);
  });

  it('parses a newline-less section (truncated diff tail) without truncating the filename', () => {
    // GCA round on #2443: indexOf('\n') === -1 previously fed slice(0, -1),
    // chopping the final character and breaking the $-anchored path match.
    const sections = splitDiffIntoFileSections('diff --git a/dist/out.js b/dist/out.js');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('dist/out.js');
  });
});

// ─── hashDiffSection ────────────────────────────────────

describe('hashDiffSection', () => {
  it('is deterministic and 12 hex chars', () => {
    const section = modifiedSection('pnpm-lock.yaml');
    const h1 = hashDiffSection(section);
    const h2 = hashDiffSection(section);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{12}$/);
  });

  it('differs when the section content differs', () => {
    expect(hashDiffSection(modifiedSection('a', 1, 1))).not.toBe(
      hashDiffSection(modifiedSection('a', 2, 1)),
    );
  });
});

// ─── classifyGeneratedArtifacts ─────────────────────────

describe('classifyGeneratedArtifacts', () => {
  it('leaves the diff and files byte-identical when nothing matches', () => {
    const diff = modifiedSection('src/foo.ts') + modifiedSection('src/bar.ts');
    const changedFiles = ['src/foo.ts', 'src/bar.ts'];
    const result = classifyGeneratedArtifacts({ diff, changedFiles });
    expect(result.keptDiff).toBe(diff);
    expect(result.keptFiles).toEqual(changedFiles);
    expect(result.artifactFiles).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  it('classifies a lockfile, strips its bytes, and keeps a summary', () => {
    const diff = modifiedSection('pnpm-lock.yaml', 42, 13) + modifiedSection('src/foo.ts');
    const changedFiles = ['pnpm-lock.yaml', 'src/foo.ts'];
    const result = classifyGeneratedArtifacts({ diff, changedFiles });

    expect(result.artifactFiles).toEqual(['pnpm-lock.yaml']);
    expect(result.keptFiles).toEqual(['src/foo.ts']);
    // The lockfile bytes are gone from the kept diff; the code file remains.
    expect(result.keptDiff).not.toContain('pnpm-lock.yaml');
    expect(result.keptDiff).toContain('src/foo.ts');

    const summary = result.summaries[0];
    expect(summary?.file).toBe('pnpm-lock.yaml');
    expect(summary?.shape).toBe('regenerated');
    expect(summary?.addedLines).toBe(42);
    expect(summary?.removedLines).toBe(13);
    expect(summary?.binary).toBe(false);
    expect(summary?.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('classifies nested build output (**/dist/**) and *.wasm and compiled-rules.json', () => {
    const files = [
      'packages/cli/dist/index.js',
      'src/pkg.wasm',
      '.totem/compiled-rules.json',
      'src/keep.ts',
    ];
    const diff = files.map((f) => modifiedSection(f)).join('');
    const result = classifyGeneratedArtifacts({ diff, changedFiles: files });
    expect(result.artifactFiles.sort()).toEqual(
      ['.totem/compiled-rules.json', 'packages/cli/dist/index.js', 'src/pkg.wasm'].sort(),
    );
    expect(result.keptFiles).toEqual(['src/keep.ts']);
  });

  it('detects added / deleted / regenerated change shapes', () => {
    const diff =
      addedSection('dist/new.js') + deletedSection('dist/old.js') + modifiedSection('dist/mod.js');
    const changedFiles = ['dist/new.js', 'dist/old.js', 'dist/mod.js'];
    const result = classifyGeneratedArtifacts({ diff, changedFiles });
    const byFile = Object.fromEntries(result.summaries.map((s) => [s.file, s.shape]));
    expect(byFile['dist/new.js']).toBe('added');
    expect(byFile['dist/old.js']).toBe('deleted');
    expect(byFile['dist/mod.js']).toBe('regenerated');
  });

  it('counts hunk content beginning with ++/-- (e.g. `+++i;`) and still skips the `+++ `/`--- ` headers', () => {
    // GCA round on #2443: a bare `+++` prefix check swallowed real added lines
    // like C's `++i;` (rendered `+++i;` in a hunk). Headers always carry a
    // space (`+++ b/...`, `+++ /dev/null`) — that is the discriminator.
    const section = [
      'diff --git a/dist/gen.c b/dist/gen.c',
      'index 1111111..2222222 100644',
      '--- a/dist/gen.c',
      '+++ b/dist/gen.c',
      '@@ -1,2 +1,2 @@',
      '---x;',
      '+++i;',
      '',
    ].join('\n');
    const result = classifyGeneratedArtifacts({
      diff: section,
      changedFiles: ['dist/gen.c'],
      generatedGlobs: [...DEFAULT_GENERATED_ARTIFACT_GLOBS],
      excludeGlobs: [],
    });
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.addedLines).toBe(1);
    expect(result.summaries[0]?.removedLines).toBe(1);
  });

  it('marks a binary artifact and reports no line counts', () => {
    const diff = binarySection('src/pkg.wasm');
    const result = classifyGeneratedArtifacts({ diff, changedFiles: ['src/pkg.wasm'] });
    const summary = result.summaries[0];
    expect(summary?.binary).toBe(true);
    expect(summary?.addedLines).toBe(0);
    expect(summary?.removedLines).toBe(0);
  });

  it('honors an un-mark (exclude) glob — a matched default is NOT generated', () => {
    const diff = modifiedSection('pnpm-lock.yaml');
    const result = classifyGeneratedArtifacts({
      diff,
      changedFiles: ['pnpm-lock.yaml'],
      excludeGlobs: ['**/pnpm-lock.yaml'],
    });
    expect(result.artifactFiles).toEqual([]);
    expect(result.keptDiff).toBe(diff);
  });

  it('honors an added generated glob passed by the caller', () => {
    const diff = modifiedSection('dashboards/report.html');
    const result = classifyGeneratedArtifacts({
      diff,
      changedFiles: ['dashboards/report.html'],
      generatedGlobs: [...DEFAULT_GENERATED_ARTIFACT_GLOBS, '**/dashboards/**'],
    });
    expect(result.artifactFiles).toEqual(['dashboards/report.html']);
  });

  it('produces an all-generated (empty kept diff) result', () => {
    const diff = modifiedSection('pnpm-lock.yaml') + modifiedSection('yarn.lock');
    const result = classifyGeneratedArtifacts({
      diff,
      changedFiles: ['pnpm-lock.yaml', 'yarn.lock'],
    });
    expect(result.keptDiff.trim()).toBe('');
    expect(result.keptFiles).toEqual([]);
    expect(result.summaries).toHaveLength(2);
  });
});

// ─── gitattributesPatternToGlob ─────────────────────────

describe('gitattributesPatternToGlob', () => {
  it('strips a leading root-anchor slash', () => {
    expect(gitattributesPatternToGlob('/dist/bundle.js')).toBe('dist/bundle.js');
  });

  it('expands a trailing directory slash to a recursive glob', () => {
    expect(gitattributesPatternToGlob('generated/')).toBe('generated/**');
  });

  it('passes a bare extension pattern through unchanged', () => {
    expect(gitattributesPatternToGlob('*.lock')).toBe('*.lock');
  });
});

// ─── readGitattributesGeneratedPatterns ─────────────────

describe('readGitattributesGeneratedPatterns', () => {
  let dir: string | undefined;
  afterEach(() => {
    cleanTmpDir(dir);
    dir = undefined;
  });

  it('returns empty pattern lists when .gitattributes is absent', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gitattr-'));
    expect(readGitattributesGeneratedPatterns(dir)).toEqual({ generated: [], notGenerated: [] });
  });

  it('parses generated (true) and un-mark (false) markers, skipping comments', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gitattr-'));
    fs.writeFileSync(
      path.join(dir, '.gitattributes'),
      [
        '# a comment',
        'dashboards/** linguist-generated',
        'src/vendor.js linguist-generated=true',
        'src/hand-written.min.js linguist-generated=false',
        'legacy/build.js -linguist-generated',
        '*.ts text',
        '',
      ].join('\n'),
      'utf-8',
    );
    const result = readGitattributesGeneratedPatterns(dir);
    expect(result.generated).toContain('dashboards/**');
    expect(result.generated).toContain('src/vendor.js');
    expect(result.notGenerated).toContain('src/hand-written.min.js');
    expect(result.notGenerated).toContain('legacy/build.js');
    // A non-generated attribute line contributes nothing.
    expect(result.generated).not.toContain('*.ts');
  });

  it('wires .gitattributes patterns end-to-end through classification', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gitattr-'));
    fs.writeFileSync(
      path.join(dir, '.gitattributes'),
      // Un-mark a default match AND add a repo-specific generated dir.
      ['**/pnpm-lock.yaml linguist-generated=false', 'dashboards/ linguist-generated', ''].join(
        '\n',
      ),
      'utf-8',
    );
    const gitattr = readGitattributesGeneratedPatterns(dir);
    const diff = modifiedSection('pnpm-lock.yaml') + modifiedSection('dashboards/x.html');
    const result = classifyGeneratedArtifacts({
      diff,
      changedFiles: ['pnpm-lock.yaml', 'dashboards/x.html'],
      generatedGlobs: [...DEFAULT_GENERATED_ARTIFACT_GLOBS, ...gitattr.generated],
      excludeGlobs: gitattr.notGenerated,
    });
    // pnpm-lock.yaml un-marked → kept; dashboards/ added → excluded.
    expect(result.keptFiles).toContain('pnpm-lock.yaml');
    expect(result.artifactFiles).toEqual(['dashboards/x.html']);
  });
});

// ─── rendering ──────────────────────────────────────────

describe('formatGeneratedArtifactLine', () => {
  it('renders shape, size delta, and hash', () => {
    const line = formatGeneratedArtifactLine({
      file: 'pnpm-lock.yaml',
      shape: 'regenerated',
      addedLines: 42,
      removedLines: 13,
      binary: false,
      hash: 'abcdef012345',
    });
    expect(line).toBe('- pnpm-lock.yaml — regenerated, +42/-13 lines, hash abcdef012345');
  });

  it('renders "binary" instead of line counts for a binary artifact', () => {
    const line = formatGeneratedArtifactLine({
      file: 'src/pkg.wasm',
      shape: 'regenerated',
      addedLines: 0,
      removedLines: 0,
      binary: true,
      hash: 'abcdef012345',
    });
    expect(line).toContain('binary');
    expect(line).not.toContain('lines');
  });
});

describe('buildGeneratedArtifactSection', () => {
  it('returns an empty string when there are no artifacts', () => {
    expect(buildGeneratedArtifactSection([])).toBe('');
  });

  it('labels the block as a summary, not diff content (#2329 guard)', () => {
    const section = buildGeneratedArtifactSection([
      {
        file: 'pnpm-lock.yaml',
        shape: 'regenerated',
        addedLines: 1,
        removedLines: 1,
        binary: false,
        hash: 'abcdef012345',
      },
    ]);
    expect(section).toContain('EXCLUDED GENERATED ARTIFACTS');
    expect(section).toContain('NOT DIFF CONTENT');
    expect(section).toContain('<generated_artifacts_summary>');
    expect(section).toContain('- pnpm-lock.yaml — regenerated');
  });
});
