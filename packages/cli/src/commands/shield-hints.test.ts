import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assemblePrompt, assembleStructuralPrompt } from './shield.js';
import { extractShieldHints } from './shield-hints.js';

// ─── extractShieldHints ─────────────────────────────

describe('extractShieldHints', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-shield-hints-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns DLP hint when diff contains [REDACTED]', () => {
    const diff = `diff --git a/src/foo.test.ts b/src/foo.test.ts
+const pattern = /[REDACTED]/;`;
    const hints = extractShieldHints(diff, [], tmpDir);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('DLP');
    expect(hints[0]).toContain('[REDACTED]');
  });

  it('returns DLP hint when diff contains *redacted*', () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
+const secret = '*redacted*';`;
    const hints = extractShieldHints(diff, [], tmpDir);
    expect(hints.some((h) => h.includes('DLP'))).toBe(true);
  });

  it('returns test coverage hint when changedFiles include test files', () => {
    const diff = 'diff --git a/src/foo.ts b/src/foo.ts\n+export const x = 1;';
    const hints = extractShieldHints(diff, ['src/foo.ts', 'src/foo.test.ts'], tmpDir);
    expect(hints.some((h) => h.includes('test files'))).toBe(true);
    expect(hints.some((h) => h.includes('Do not flag missing test coverage'))).toBe(true);
  });

  it('matches .spec.tsx and .test.js files for test hint', () => {
    const diff = 'diff --git a/x b/x\n+x';
    const hints = extractShieldHints(diff, ['src/app.spec.tsx', 'src/util.test.js'], tmpDir);
    expect(hints.some((h) => h.includes('test files'))).toBe(true);
  });

  it('returns new file hint when diff contains new file mode', () => {
    const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
+export const y = 2;`;
    const hints = extractShieldHints(diff, [], tmpDir);
    expect(hints.some((h) => h.includes('1 new file(s)'))).toBe(true);
  });

  it('counts multiple new files correctly', () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
new file mode 100644
+content a
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
+content b`;
    const hints = extractShieldHints(diff, [], tmpDir);
    expect(hints.some((h) => h.includes('2 new file(s)'))).toBe(true);
  });

  it('extracts shield-context annotations from files on disk', () => {
    const filePath = path.join(tmpDir, 'wrapper.ts');
    fs.writeFileSync(filePath, '// shield-context: thin wrapper around node:fs\nexport {};');
    const hints = extractShieldHints('diff', ['wrapper.ts'], tmpDir);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('[wrapper.ts]');
    expect(hints[0]).toContain('thin wrapper around node:fs');
  });

  it('returns empty array when no hints match', () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return 42;
 }`;
    const hints = extractShieldHints(diff, ['src/foo.ts'], tmpDir);
    // src/foo.ts doesn't exist on disk, so no annotations; no test files, no DLP, no new files
    expect(hints).toHaveLength(0);
  });

  it('ignores files that do not exist on disk', () => {
    const hints = extractShieldHints('diff', ['nonexistent/file.ts'], tmpDir);
    // Should not throw and should return empty
    expect(hints).toHaveLength(0);
  });

  it('handles multiple shield-context annotations in one file', () => {
    const filePath = path.join(tmpDir, 'multi.ts');
    fs.writeFileSync(
      filePath,
      [
        '// shield-context: wraps external API',
        'import { api } from "ext";',
        '// shield-context: error codes are vendor-defined',
        'export const CODE = 42;',
      ].join('\n'),
    );
    const hints = extractShieldHints('diff', ['multi.ts'], tmpDir);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('wraps external API');
    expect(hints[1]).toContain('error codes are vendor-defined');
  });

  it('handles indented shield-context annotations', () => {
    const filePath = path.join(tmpDir, 'indented.ts');
    fs.writeFileSync(filePath, '  // shield-context: indented hint\nexport {};');
    const hints = extractShieldHints('diff', ['indented.ts'], tmpDir);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('indented hint');
  });
});

// ─── assemblePrompt with smartHints ──────────────────

describe('assemblePrompt with smartHints', () => {
  const emptyContext = { specs: [], sessions: [], code: [], lessons: [] };
  const sampleDiff = 'diff --git a/x b/x\n+line';
  const changedFiles = ['x'];

  it('includes smart review hints section when hints are provided', () => {
    const prompt = assemblePrompt(sampleDiff, changedFiles, emptyContext, 'SYSTEM', [
      'DLP artifacts present',
    ]);
    expect(prompt).toContain('=== SMART REVIEW HINTS ===');
    expect(prompt).toContain('auto-detected from the diff');
    expect(prompt).toContain('- DLP artifacts present');
  });

  it('does NOT include hints section when no hints are provided', () => {
    const prompt = assemblePrompt(sampleDiff, changedFiles, emptyContext, 'SYSTEM');
    expect(prompt).not.toContain('SMART REVIEW HINTS');
  });

  it('does NOT include hints section when hints array is empty', () => {
    const prompt = assemblePrompt(sampleDiff, changedFiles, emptyContext, 'SYSTEM', []);
    expect(prompt).not.toContain('SMART REVIEW HINTS');
  });

  it('includes multiple hints as bullet points', () => {
    const hints = ['Hint one', 'Hint two', 'Hint three'];
    const prompt = assemblePrompt(sampleDiff, changedFiles, emptyContext, 'SYSTEM', hints);
    expect(prompt).toContain('- Hint one');
    expect(prompt).toContain('- Hint two');
    expect(prompt).toContain('- Hint three');
  });
});

// ─── assembleStructuralPrompt with smartHints ────────

describe('assembleStructuralPrompt with smartHints', () => {
  const sampleDiff = 'diff --git a/x b/x\n+line';
  const changedFiles = ['x'];

  it('includes smart review hints section when hints are provided', () => {
    const prompt = assembleStructuralPrompt(sampleDiff, changedFiles, 'SYSTEM', [
      'Test files in diff',
    ]);
    expect(prompt).toContain('=== SMART REVIEW HINTS ===');
    expect(prompt).toContain('- Test files in diff');
  });

  it('does NOT include hints section when no hints are provided', () => {
    const prompt = assembleStructuralPrompt(sampleDiff, changedFiles, 'SYSTEM');
    expect(prompt).not.toContain('SMART REVIEW HINTS');
  });
});
