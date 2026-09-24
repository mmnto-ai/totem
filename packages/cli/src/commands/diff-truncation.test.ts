import { describe, expect, it } from 'vitest';

import {
  describeDiffTruncation,
  DIFF_TRUNCATION_MARKER_HEAD,
  diffTruncationNotice,
  MAX_DIFF_CHARS,
  truncateDiffForReview,
} from './shield-templates.js';

// ─── mmnto-ai/totem#2954: the review window's cut lands on a boundary and says what it dropped ───

function file(name: string, bodyChars: number, hunks = 1): string {
  const head = `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n`;
  const per = Math.max(1, Math.floor(bodyChars / hunks));
  let out = head;
  for (let h = 0; h < hunks; h++) {
    out += `@@ -${h + 1},1 +${h + 1},1 @@\n-${'x'.repeat(per)}\n+y\n`;
  }
  return out;
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
    const limit = a.length + b.length + 50; // inside c's header/body
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
    expect(t.delivered.endsWith(
      `\n${DIFF_TRUNCATION_MARKER_HEAD}: ${a.length + b.length - 1} of ${diff.length} chars delivered, cut at a file boundary; 1 file(s) not shown: c.ts] ...`,
    )).toBe(true);
  });

  it('cuts on a hunk boundary when that delivers more than the last file boundary, naming the partial file', () => {
    const a = file('a.ts', 100);
    const b = file('b.ts', 3_000, 6); // six hunks of ~500
    const diff = a + b;
    const limit = a.length + 1_600; // inside b, after roughly three hunks
    const t = truncateDiffForReview(diff, limit);
    expect(t.cutAt).toBe('hunk');
    expect(t.partialFile).toBe('b.ts');
    expect(t.omittedFiles).toEqual([]);
    // Ends on a whole hunk: the delivered content's last line is a "+y" line.
    const content = t.delivered.slice(0, t.deliveredChars);
    expect(content.endsWith('+y')).toBe(true);
    expect(t.deliveredChars).toBeLessThanOrEqual(limit);
    expect(t.delivered).toContain('b.ts shown in part; no whole file omitted]');
  });

  it('falls back to a line boundary when a single hunk is wider than the window', () => {
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,3 @@\n+${'p'.repeat(300)}\n+${'q'.repeat(300)}\n+${'r'.repeat(300)}\n`;
    const t = truncateDiffForReview(diff, 500);
    expect(t.cutAt).toBe('line');
    expect(t.partialFile).toBe('a.ts');
    expect(t.delivered.slice(0, t.deliveredChars).endsWith('p'.repeat(300))).toBe(true);
    expect(t.deliveredChars).toBeLessThanOrEqual(500);
  });

  it('hard-cuts at the window only when the diff has no newline within it', () => {
    const diff = 'z'.repeat(2_000);
    const t = truncateDiffForReview(diff, 500);
    expect(t.cutAt).toBe('char');
    expect(t.deliveredChars).toBe(500);
    expect(t.delivered.startsWith('z'.repeat(500) + '\n... [diff truncated: 500 of 2000 chars delivered, cut at a char boundary;')).toBe(true);
  });

  it('never delivers an empty prefix when the first file alone exceeds the window', () => {
    const diff = file('only.ts', 5_000, 10);
    const t = truncateDiffForReview(diff, 1_200);
    expect(t.deliveredChars).toBeGreaterThan(0);
    expect(t.deliveredChars).toBeLessThanOrEqual(1_200);
    expect(['hunk', 'line']).toContain(t.cutAt);
    expect(t.partialFile).toBe('only.ts');
  });

  it('collapses a long omitted-file list after twelve names', () => {
    const files = Array.from({ length: 15 }, (_, i) => file(`f${i}.ts`, 50));
    const diff = files.join('');
    const t = truncateDiffForReview(diff, files[0]!.length + 10);
    expect(t.omittedFiles).toHaveLength(14);
    expect(t.delivered).toContain('14 file(s) not shown: f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, f7.ts, f8.ts, f9.ts, f10.ts, f11.ts, f12.ts (+2 more)]');
  });

  it('defaults the window to MAX_DIFF_CHARS', () => {
    const t = truncateDiffForReview('a\n'.repeat(MAX_DIFF_CHARS));
    expect(t.truncated).toBe(true);
    expect(t.deliveredChars).toBeLessThanOrEqual(MAX_DIFF_CHARS);
  });
});

describe('describeDiffTruncation / diffTruncationNotice', () => {
  it('name the sizes, the boundary, the partial file and the omitted files', () => {
    const t = truncateDiffForReview(file('a.ts', 100) + file('b.ts', 3_000, 6), 900);
    const warn = describeDiffTruncation(t, 900);
    expect(warn).toContain(`Delivered code diff ${t.totalChars} chars exceeds the 900-char review window`);
    expect(warn).toContain(`${t.deliveredChars} chars delivered (cut at a hunk boundary)`);
    expect(warn).toContain('b.ts shown in part');
    expect(warn).toContain('narrower --diff <range>');
    const notice = diffTruncationNotice(t);
    expect(notice.startsWith('=== DIFF TRUNCATION NOTICE ===\n')).toBe(true);
    expect(notice).toContain(`${t.deliveredChars} of ${t.totalChars} chars delivered`);
    expect(notice).toContain('answer in the required format');
  });
});
