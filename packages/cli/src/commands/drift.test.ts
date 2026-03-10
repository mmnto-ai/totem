import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectDrift, parseLessonsFile } from '@mmnto/totem';

// ─── detectDrift integration (via core) ──────────────

describe('drift gate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-drift-gate-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when all file references exist', () => {
    const content = `# Lessons

## Lesson — Index module

**Tags:** core

The entry point is \`src/index.ts\`.
`;
    const lessons = parseLessonsFile(content);
    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(0);
  });

  it('fails when a referenced file has been deleted', () => {
    const content = `# Lessons

## Lesson — Deleted file trap

**Tags:** trap

The handler was in \`src/handler.ts\` but it was removed.
`;
    const lessons = parseLessonsFile(content);
    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.orphanedRefs).toEqual(['src/handler.ts']);
  });

  it('fails when a renamed file is referenced', () => {
    const content = `# Lessons

## Lesson — Old path

**Tags:** refactor

Previously at \`src/old-name.ts\`, now renamed.
`;
    const lessons = parseLessonsFile(content);
    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.orphanedRefs).toEqual(['src/old-name.ts']);
  });

  it('reports multiple stale refs across multiple lessons', () => {
    const content = `# Lessons

## Lesson — First stale

**Tags:** a

See \`src/gone-a.ts\` for details.

## Lesson — Second stale

**Tags:** b

The file \`src/gone-b.ts\` was removed.
`;
    const lessons = parseLessonsFile(content);
    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(2);
  });

  it('ignores lessons with no file references', () => {
    const content = `# Lessons

## Lesson — General advice

**Tags:** best-practice

Always use \`const\` instead of \`let\`.
`;
    const lessons = parseLessonsFile(content);
    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(0);
  });
});
