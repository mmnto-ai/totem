import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// The latest-journal pick of the bespoke SessionStart hook
// (.claude/hooks/session-context.mjs) lives in .claude/hooks/lib/select-latest-journal.mjs
// so the algorithm is exercised here without spawning the hook (mmnto-ai/totem#2828;
// bot round 1 on mmnto-ai/totem#2831 asked for executed behaviour, not source-text
// locks alone — those stay in init.test.ts). The module is plain ESM JavaScript at the
// repo root, outside the package's TypeScript program, so it is loaded by URL.

type StatFailure = { file: string; message: string };
type Pick = {
  files: string[];
  lexicalLatest: string;
  mtimeLatest: string;
  latest: string;
  drift: boolean;
  reason: 'lexical' | 'newest-write' | 'lexical-unreadable';
  statFailures: StatFailure[];
};
type SelectLatestJournal = (
  entries: string[],
  statMtimeMs: (file: string) => number,
) => Pick | null;

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const helperPath = path.join(repoRoot, '.claude', 'hooks', 'lib', 'select-latest-journal.mjs');

let selectLatestJournal: SelectLatestJournal;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(helperPath).href)) as {
    selectLatestJournal: SelectLatestJournal;
  };
  selectLatestJournal = mod.selectLatestJournal;
});

/** A stat function over a fixed mtime table; a missing key throws like fs would. */
function statOf(table: Record<string, number>): (file: string) => number {
  return (file) => {
    if (!(file in table)) {
      throw new Error(`ENOENT: no such file or directory, stat '${file}'`);
    }
    return table[file]!;
  };
}

const T1 = 1_000;
const T2 = 2_000;
const T3 = 3_000;

describe('selectLatestJournal — the recency policy behind the hook', () => {
  it('a conforming directory (counter order == write order) serves the lexical-newest with no drift', () => {
    const pick = selectLatestJournal(
      ['claude-0001-a.md', 'claude-0002-b.md', 'claude-0003-c.md'],
      statOf({
        'claude-0001-a.md': T1,
        'claude-0002-b.md': T2,
        'claude-0003-c.md': T3,
      }),
    );
    expect(pick).not.toBeNull();
    expect(pick!.latest).toBe('claude-0003-c.md');
    expect(pick!.lexicalLatest).toBe('claude-0003-c.md');
    expect(pick!.drift).toBe(false);
    expect(pick!.reason).toBe('lexical');
    expect(pick!.statFailures).toEqual([]);
  });

  it('a clock-named file that out-sorts a later write is naming drift: the newer write is served and named', () => {
    // The 2026-09-07 incident shape: `claude-2315-…` (a 23:15 clock stamp) out-sorted the
    // 01:33 signoff `claude-0132-…`; the pre-fix hook served the stale file silently.
    const pick = selectLatestJournal(
      ['claude-0001-first.md', 'claude-2315-clock-named.md', 'claude-0100-newest-write.md'],
      statOf({
        'claude-0001-first.md': T1,
        'claude-2315-clock-named.md': T2,
        'claude-0100-newest-write.md': T3,
      }),
    );
    expect(pick!.lexicalLatest).toBe('claude-2315-clock-named.md');
    expect(pick!.mtimeLatest).toBe('claude-0100-newest-write.md');
    expect(pick!.latest).toBe('claude-0100-newest-write.md');
    expect(pick!.drift).toBe(true);
    expect(pick!.reason).toBe('newest-write');
  });

  it('an mtime tie keeps the lexical pick (no drift reported)', () => {
    const pick = selectLatestJournal(
      ['claude-0001-a.md', 'claude-0002-b.md'],
      statOf({
        'claude-0001-a.md': T2,
        'claude-0002-b.md': T2,
      }),
    );
    expect(pick!.latest).toBe('claude-0002-b.md');
    expect(pick!.drift).toBe(false);
  });

  it('a sibling whose stat throws is skipped and reported — it never drops the pick', () => {
    // The GCA / Greptile / CodeRabbit round-1 finding: pre-fix, one dangling entry threw
    // inside the hook's outer try and the whole journal block was lost.
    const pick = selectLatestJournal(
      ['claude-0001-a.md', 'claude-0002-dangling.md', 'claude-0003-c.md'],
      statOf({ 'claude-0001-a.md': T1, 'claude-0003-c.md': T3 }),
    );
    expect(pick!.latest).toBe('claude-0003-c.md');
    expect(pick!.drift).toBe(false);
    expect(pick!.reason).toBe('lexical');
    expect(pick!.statFailures).toHaveLength(1);
    expect(pick!.statFailures[0]!.file).toBe('claude-0002-dangling.md');
    expect(pick!.statFailures[0]!.message).toContain('ENOENT');
  });

  it('when the lexical-newest itself cannot be stat-ed, the newest readable write is served and the reason says so, not drift', () => {
    const pick = selectLatestJournal(
      ['claude-0001-a.md', 'claude-0002-b.md', 'claude-0003-gone.md'],
      statOf({
        'claude-0001-a.md': T1,
        'claude-0002-b.md': T2,
      }),
    );
    expect(pick!.lexicalLatest).toBe('claude-0003-gone.md');
    expect(pick!.latest).toBe('claude-0002-b.md');
    expect(pick!.drift).toBe(false);
    expect(pick!.reason).toBe('lexical-unreadable');
    expect(pick!.statFailures.map((s) => s.file)).toEqual(['claude-0003-gone.md']);
  });

  it('when nothing can be stat-ed the lexical pick stands with every failure reported', () => {
    const pick = selectLatestJournal(['claude-0001-a.md', 'claude-0002-b.md'], statOf({}));
    expect(pick!.latest).toBe('claude-0002-b.md');
    expect(pick!.reason).toBe('lexical');
    expect(pick!.drift).toBe(false);
    expect(pick!.statFailures).toHaveLength(2);
  });

  it('filters non-markdown entries and returns null for an empty directory', () => {
    expect(selectLatestJournal(['legacy', 'notes.txt'], statOf({}))).toBeNull();
    const pick = selectLatestJournal(
      ['legacy', 'claude-0001-a.md'],
      statOf({ 'claude-0001-a.md': T1 }),
    );
    expect(pick!.files).toEqual(['claude-0001-a.md']);
    expect(pick!.latest).toBe('claude-0001-a.md');
  });
});
