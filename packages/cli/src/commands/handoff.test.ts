import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRecentLessons } from './handoff.js';

describe('readRecentLessons', () => {
  let tmpDir: string;
  const totemDir = '.totem';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-handoff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when lessons.md does not exist', () => {
    expect(readRecentLessons(tmpDir, totemDir)).toBe('');
  });

  it('returns full content when file is short', () => {
    const lessonsDir = path.join(tmpDir, totemDir);
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, 'lessons.md'), '## Lesson\nSome content', 'utf-8');
    expect(readRecentLessons(tmpDir, totemDir)).toBe('## Lesson\nSome content');
  });

  it('returns only the last 100 lines for long files', () => {
    const lessonsDir = path.join(tmpDir, totemDir);
    fs.mkdirSync(lessonsDir, { recursive: true });
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(path.join(lessonsDir, 'lessons.md'), lines.join('\n'), 'utf-8');

    const result = readRecentLessons(tmpDir, totemDir);
    expect(result).toContain('Line 200');
    expect(result).toContain('Line 101');
    expect(result).not.toContain('Line 100\n');
  });
});
