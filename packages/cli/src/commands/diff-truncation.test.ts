import { describe, expect, it } from 'vitest';

import {
  describeDiffTruncation,
  DIFF_TRUNCATION_MARKER_HEAD,
  diffTruncationNotice,
  MAX_DIFF_CHARS,
  truncateDiffForReview,
} from './shield-templates.js';

// ─── mmnto-ai/totem#2954: the review window's cut lands on a boundary, keeps its coverage, and says what it dropped ───

/** A file whose hunks each carry one long removed line and a short added one. */
function file(name: string, bodyChars: number, hunks = 1): string {
  const head = `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n`;
  const per = Math.max(1, Math.floor(bodyChars / hunks));
  let out = head;
  for (let h = 0; h < hunks; h++) {
    out += `@@ -${h + 1},1 +${h + 1},1 @@\n-${'x'.repeat(per)}\n+y\n`;
  }
  return out;
}

/** A new file: one hunk of `lines` added lines, `lineChars` wide (a large new module). */
function multiLineFile(name: string, lines: number, lineChars: number): string {
  let out = `diff --git a/${name} b/${name}\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n`;
  for (let i = 0; i < lines; i++) out += `+${'m'.repeat(lineChars)}\n`;
  return out;
}

/** Index of the newline that starts the nth (0-based) hunk header in the diff. */
function nthHunkBoundary(diff: string, n: number): number {
  let pos = -1;
  for (let i = 0; i <= n; i++) {
    pos = diff.indexOf('\n@@ ', pos + 1);
    if (pos === -1) throw new Error(`no hunk ${n}`);
  }
  return pos;
}

describe('truncateDiffForReview', () => {
  it('returns a diff within the window unchanged', () => {
    const diff = file('a.ts', 100);
    const t = truncateDiffForReview(diff, 1_000);
    expect(t).toEqual({
      delivered: diff,
      truncated: false,
      deliveredChars: diff.length,
      totalChars: diff.length,
      cutAt: 'none',
      omittedFiles: [],
      partialFile: null,
    });
  });

  it('cuts on the last file boundary within the window and names every file not shown', () => {
    const a = file('a.ts', 400);
    const b = file('b.ts', 400);
    const c = file('c.ts', 400);
    const diff = a + b + c;
    const limit = a.length + b.length + 20; // just inside c's header
    const t = truncateDiffForReview(diff, limit);
    expect(t.truncated).toBe(true);
    expect(t.cutAt).toBe('file');
    // Exactly a and b (b's trailing newline is the cut).
    expect(t.delivered.startsWith((a + b).slice(0, -1))).toBe(true);
    expect(t.delivered).not.toContain('diff --git a/c.ts');
    expect(t.deliveredChars).toBe(a.length + b.length - 1);
    expect(t.totalChars).toBe(diff.length);
    expect(t.omittedFiles).toEqual(['c.ts']);
    expect(t.partialFile).toBeNull();
    expect(
      t.delivered.endsWith(
        `\n${DIFF_TRUNCATION_MARKER_HEAD}: ${a.length + b.length - 1} of ${diff.length} chars delivered, cut at a file boundary; 1 file(s) not shown: c.ts] ...`,
      ),
    ).toBe(true);
  });

  it('cuts on a hunk boundary that sits within the last tenth of the window, naming the partial file', () => {
    const a = file('a.ts', 100);
    const b = file('b.ts', 3_000, 6);
    const diff = a + b;
    const boundary = nthHunkBoundary(diff, 4); // a's hunk is the 0th; this is b's fourth
    const t = truncateDiffForReview(diff, boundary + 20);
    expect(t.cutAt).toBe('hunk');
    expect(t.deliveredChars).toBe(boundary);
    expect(t.partialFile).toBe('b.ts');
    expect(t.omittedFiles).toEqual([]);
    // Ends on a whole hunk: the delivered content's last line is a "+y" line.
    expect(t.delivered.slice(0, t.deliveredChars).endsWith('+y')).toBe(true);
    expect(t.delivered).toContain('b.ts shown in part; no whole file omitted]');
  });

  it('fills the window on a line boundary when the boundary cut would give up more than a tenth (a small edit, then one large new file)', () => {
    const small = file('a.ts', 80);
    const big = multiLineFile('new-module.ts', 1_400, 40); // ~58 KB, one hunk
    const t = truncateDiffForReview(small + big);
    expect(t.cutAt).toBe('line');
    expect(t.partialFile).toBe('new-module.ts');
    expect(t.omittedFiles).toEqual([]);
    expect(t.deliveredChars).toBeGreaterThan(MAX_DIFF_CHARS * 0.9);
    expect(t.deliveredChars).toBeLessThanOrEqual(MAX_DIFF_CHARS);
    expect(t.delivered.slice(0, t.deliveredChars).endsWith('m'.repeat(40))).toBe(true);
  });

  it('takes the file boundary when it costs at most a tenth of the window', () => {
    const a = multiLineFile('a.ts', 1_200, 40);
    const b = multiLineFile('b.ts', 200, 40);
    const t = truncateDiffForReview(a + b, a.length + 3_000);
    expect(t.cutAt).toBe('file');
    expect(t.deliveredChars).toBe(a.length - 1);
    expect(t.omittedFiles).toEqual(['b.ts']);
  });

  it('falls back to a line boundary when a single hunk is wider than the window', () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,3 @@\n+${'p'.repeat(300)}\n+${'q'.repeat(300)}\n+${'r'.repeat(300)}\n`;
    const t = truncateDiffForReview(diff, 500);
    expect(t.cutAt).toBe('line');
    expect(t.partialFile).toBe('a.ts');
    expect(t.delivered.slice(0, t.deliveredChars).endsWith('p'.repeat(300))).toBe(true);
    expect(t.deliveredChars).toBeLessThanOrEqual(500);
  });

  it('hard-cuts at the window when the last line boundary would give up more than half (one line wider than the window)', () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n+${'p'.repeat(5_000)}\n`;
    const t = truncateDiffForReview(diff, 1_000);
    expect(t.cutAt).toBe('char');
    expect(t.deliveredChars).toBe(1_000);
    expect(t.partialFile).toBe('a.ts');
  });

  it('hard-cuts at the window when the diff has no newline within it', () => {
    const diff = 'z'.repeat(2_000);
    const t = truncateDiffForReview(diff, 500);
    expect(t.cutAt).toBe('char');
    expect(t.deliveredChars).toBe(500);
    expect(
      t.delivered.startsWith(
        'z'.repeat(500) +
          '\n... [diff truncated: 500 of 2000 chars delivered, cut at a char boundary;',
      ),
    ).toBe(true);
  });

  it('delivers at least half the window when the first file alone exceeds it', () => {
    const diff = file('only.ts', 5_000, 10);
    const t = truncateDiffForReview(diff, 1_200);
    expect(t.deliveredChars).toBeGreaterThanOrEqual(600);
    expect(t.deliveredChars).toBeLessThanOrEqual(1_200);
    expect(t.partialFile).toBe('only.ts');
    expect(t.omittedFiles).toEqual([]);
  });

  it('names a quoted, hunk-less omitted file by its unquoted path — spaces and octal escapes decoded (greptile on mmnto-ai/totem#2959)', () => {
    const a = file('a.ts', 400);
    // A mode-only change has no `+++` line; git C-quotes a name with a space or
    // a non-ASCII byte in the header operands.
    const spaced = 'diff --git "a/my file.png" "b/my file.png"\nold mode 100644\nnew mode 100755\n';
    const escaped =
      'diff --git "a/caf\\303\\251 \\"x\\".txt" "b/caf\\303\\251 \\"x\\".txt"\nold mode 100644\nnew mode 100755\n';
    const mixed =
      'diff --git a/plain.txt "b/re named.txt"\nsimilarity index 100%\nrename from plain.txt\nrename to "re named.txt"\n';
    const diff = a + spaced + escaped + mixed;
    const t = truncateDiffForReview(diff, a.length + 10);
    expect(t.cutAt).toBe('file');
    expect(t.omittedFiles).toEqual(['my file.png', 'café "x".txt', 're named.txt']);
    expect(t.delivered).toContain('3 file(s) not shown: my file.png, café "x".txt, re named.txt');
  });

  it('collapses a long omitted-file list after twelve names', () => {
    const files = Array.from({ length: 15 }, (_, i) => file(`f${i}.ts`, 50));
    const diff = files.join('');
    const t = truncateDiffForReview(diff, files[0]!.length + 2);
    expect(t.cutAt).toBe('file');
    expect(t.omittedFiles).toHaveLength(14);
    expect(t.delivered).toContain(
      '14 file(s) not shown: f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, f7.ts, f8.ts, f9.ts, f10.ts, f11.ts, f12.ts (+2 more)]',
    );
  });

  it('defaults the window to MAX_DIFF_CHARS', () => {
    const t = truncateDiffForReview('a\n'.repeat(MAX_DIFF_CHARS));
    expect(t.truncated).toBe(true);
    expect(t.deliveredChars).toBeLessThanOrEqual(MAX_DIFF_CHARS);
  });

  it('reads a limit that is not a positive number as the default window', () => {
    const small = 'a\n'.repeat(10);
    expect(truncateDiffForReview(small, 0).truncated).toBe(false);
    expect(truncateDiffForReview(small, -5).truncated).toBe(false);
    expect(truncateDiffForReview(small, Number.NaN).truncated).toBe(false);
    const big = 'a\n'.repeat(MAX_DIFF_CHARS);
    expect(truncateDiffForReview(big, 0).deliveredChars).toBeLessThanOrEqual(MAX_DIFF_CHARS);
  });

  describe('the coverage floors, pinned at their thresholds', () => {
    it('a file boundary is taken at nine tenths of the window and refused just below it', () => {
      const a = multiLineFile('a.ts', 100, 40);
      const b = multiLineFile('b.ts', 100, 40);
      const diff = a + b;
      const boundary = a.length - 1; // the newline before b's header
      const taken = Math.floor(boundary / 0.9); // boundary >= 0.9 * taken
      const refused = Math.floor(boundary / 0.9) + 2; // boundary < 0.9 * refused
      expect(boundary).toBeGreaterThanOrEqual(taken * 0.9);
      expect(boundary).toBeLessThan(refused * 0.9);
      const t1 = truncateDiffForReview(diff, taken);
      expect(t1.cutAt).toBe('file');
      expect(t1.deliveredChars).toBe(boundary);
      const t2 = truncateDiffForReview(diff, refused);
      // The only structural cut failed the floor; b's lines fill the window instead.
      expect(t2.cutAt).toBe('line');
      expect(t2.partialFile).toBe('b.ts');
      expect(t2.deliveredChars).toBeGreaterThan(boundary);
    });

    it('a line boundary is taken at half the window and refused just below it', () => {
      // One delivered content line, then one line far wider than any window.
      const head = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n+first\n';
      const diff = head + '+' + 'w'.repeat(5_000) + '\n';
      const boundary = head.length - 1; // the newline ending "+first"
      const taken = boundary * 2; // boundary >= 0.5 * taken
      const refused = boundary * 2 + 2; // boundary < 0.5 * refused
      const t1 = truncateDiffForReview(diff, taken);
      expect(t1.cutAt).toBe('line');
      expect(t1.deliveredChars).toBe(boundary);
      const t2 = truncateDiffForReview(diff, refused);
      expect(t2.cutAt).toBe('char');
      expect(t2.deliveredChars).toBe(refused);
    });
  });

  describe('a line cut never leaves a file as a bare header', () => {
    it('falls back to the file boundary before the header when that clears half the window', () => {
      const a = multiLineFile('a.ts', 500, 60); // ~30 KB
      const b = `diff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+${'z'.repeat(60_000)}\n`;
      const t = truncateDiffForReview(a + b);
      // The file boundary (~30 KB) fails the nine-tenths floor; the last line
      // boundary within the window ends b's `@@` line (a bare header), so the
      // cut falls back to the file boundary, which clears the half-window floor.
      expect(t.cutAt).toBe('file');
      expect(t.deliveredChars).toBe(a.length - 1);
      expect(t.omittedFiles).toEqual(['b.ts']);
      expect(t.partialFile).toBeNull();
    });

    it('falls back to the window when the file boundary before the header is below half', () => {
      const a = multiLineFile('a.ts', 300, 60); // ~18 KB, below half of 50,000
      const b = `diff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+${'z'.repeat(60_000)}\n`;
      const t = truncateDiffForReview(a + b);
      expect(t.cutAt).toBe('char');
      expect(t.deliveredChars).toBe(MAX_DIFF_CHARS);
      expect(t.partialFile).toBe('b.ts');
      expect(t.omittedFiles).toEqual([]);
    });

    it('a line cut inside the first file with only its header delivered goes to the window', () => {
      const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n+${'z'.repeat(5_000)}\n`;
      const t = truncateDiffForReview(diff, 100); // the `@@` line ends at ~62 >= 50
      expect(t.cutAt).toBe('char');
      expect(t.deliveredChars).toBe(100);
    });
  });

  describe('file names in the marker', () => {
    // A complete first file, then the file under test, cut at the boundary between them.
    const first = file('a.ts', 300);
    const omittedAfter = (second: string): string[] =>
      truncateDiffForReview(first + second, first.length + 10).omittedFiles;

    it('reads a path containing " b/" from the +++ operand', () => {
      const second =
        'diff --git a/x b/y.ts b/x b/y.ts\n--- a/x b/y.ts\n+++ b/x b/y.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n';
      expect(omittedAfter(second)).toEqual(['x b/y.ts']);
    });

    it('unquotes a quoted path and decodes its octal byte escapes (greptile on mmnto-ai/totem#2959)', () => {
      const second =
        'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"\n--- "a/caf\\303\\251.ts"\n+++ "b/caf\\303\\251.ts"\n@@ -1,1 +1,1 @@\n-x\n+y\n';
      expect(omittedAfter(second)).toEqual(['café.ts']);
    });

    it('names a pure rename (no --- / +++ lines) by its rename-to path', () => {
      const second =
        'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n';
      expect(omittedAfter(second)).toEqual(['new.ts']);
    });

    it('names a hunk-less header with unequal sides by its b/ operand', () => {
      const second =
        'diff --git a/old.bin b/new.bin\nBinary files a/old.bin and b/new.bin differ\n';
      expect(omittedAfter(second)).toEqual(['new.bin']);
    });

    it('names a deleted file by its --- operand', () => {
      const second =
        'diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n';
      expect(omittedAfter(second)).toEqual(['gone.ts']);
    });

    it('names a renamed file by its new path', () => {
      const second =
        'diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n';
      expect(omittedAfter(second)).toEqual(['new.ts']);
    });

    it('drops the CR of a CRLF header', () => {
      const second =
        'diff --git a/b.ts b/b.ts\r\n--- a/b.ts\r\n+++ b/b.ts\r\n@@ -1,1 +1,1 @@\r\n-x\r\n+y\r\n';
      expect(omittedAfter(second)).toEqual(['b.ts']);
    });

    it('falls back to the header for a block without --- / +++ lines (a binary file)', () => {
      const second = 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n';
      expect(omittedAfter(second)).toEqual(['i.png']);
    });

    it('never matches a content line that starts with "diff --git" or "@@" (a patch of a patch)', () => {
      const second =
        'diff --git a/p.patch b/p.patch\n--- a/p.patch\n+++ b/p.patch\n@@ -1,2 +1,2 @@\n-diff --git a/inner.ts b/inner.ts\n+@@ -1,1 +1,1 @@\n';
      expect(omittedAfter(second)).toEqual(['p.patch']);
    });
  });
});

describe('describeDiffTruncation / diffTruncationNotice', () => {
  it('name the sizes, the boundary, the partial file and the omitted files', () => {
    const diff = file('a.ts', 100) + file('b.ts', 3_000, 6);
    const limit = nthHunkBoundary(diff, 3) + 10;
    const t = truncateDiffForReview(diff, limit);
    const warn = describeDiffTruncation(t, limit);
    expect(warn).toContain(
      `Delivered code diff ${t.totalChars} chars exceeds the ${limit}-char review window`,
    );
    expect(warn).toContain(`${t.deliveredChars} chars delivered (cut at a hunk boundary)`);
    expect(warn).toContain('b.ts shown in part');
    expect(warn).toContain('narrower --diff <range>');
    const notice = diffTruncationNotice(t);
    expect(notice.startsWith('=== DIFF TRUNCATION NOTICE ===\n')).toBe(true);
    expect(notice).toContain(`${t.deliveredChars} of ${t.totalChars} chars delivered`);
    expect(notice).toContain('answer in the required format');
  });
});
