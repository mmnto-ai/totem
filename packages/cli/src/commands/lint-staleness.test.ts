import { describe, expect, it } from 'vitest';

import {
  classifyLessonsByMtime,
  formatStalenessWarning,
  type LessonDelta,
  parseLessonNameStatus,
  PROVENANCE_LESSON_FILE_CAP,
  type ProvenanceValue,
  STALE_LESSON_NAME_CAP,
  UNTRACKED_PROVENANCE,
} from './lint-staleness.js';

// The whole point of these helpers is to be PURE — no real git repo, no temp
// dir (the cohort's no-real-git-with-cwd=temp-on-Windows rule). The "git seam"
// is `git diff --name-status` OUTPUT, fed here as synthetic strings.

const LESSONS_PREFIX = '.totem/lessons';
const basename = (p: string): string => p.split('/').pop() ?? p;

describe('parseLessonNameStatus', () => {
  it('classifies added / changed / removed lessons', () => {
    const raw = [
      'A\t.totem/lessons/lesson-added.md',
      'M\t.totem/lessons/lesson-changed.md',
      'D\t.totem/lessons/lesson-removed.md',
    ].join('\n');

    const delta = parseLessonNameStatus(raw, LESSONS_PREFIX);

    expect(delta.entries).toEqual([
      { path: '.totem/lessons/lesson-added.md', kind: 'added' },
      { path: '.totem/lessons/lesson-changed.md', kind: 'changed' },
      { path: '.totem/lessons/lesson-removed.md', kind: 'removed' },
    ]);
  });

  it('treats a rename destination as changed and a copy destination as added', () => {
    const raw = [
      'R096\t.totem/lessons/old-name.md\t.totem/lessons/new-name.md',
      'C100\t.totem/lessons/src.md\t.totem/lessons/copy.md',
    ].join('\n');

    const delta = parseLessonNameStatus(raw, LESSONS_PREFIX);

    // Sorted by path: copy.md < new-name.md.
    expect(delta.entries).toEqual([
      { path: '.totem/lessons/copy.md', kind: 'added' },
      { path: '.totem/lessons/new-name.md', kind: 'changed' },
    ]);
  });

  it('maps a type-change (T) to changed', () => {
    const delta = parseLessonNameStatus('T\t.totem/lessons/lesson-t.md', LESSONS_PREFIX);
    expect(delta.entries).toEqual([{ path: '.totem/lessons/lesson-t.md', kind: 'changed' }]);
  });

  it('filters out non-.md files and paths outside the lessons prefix', () => {
    const raw = [
      'M\t.totem/lessons/lesson-keep.md',
      'M\t.totem/lessons/notes.txt', // not .md
      'M\t.totem/compiled-rules.json', // outside prefix
      'M\tsrc/other/lesson-elsewhere.md', // outside prefix
    ].join('\n');

    const delta = parseLessonNameStatus(raw, LESSONS_PREFIX);

    expect(delta.entries).toEqual([{ path: '.totem/lessons/lesson-keep.md', kind: 'changed' }]);
  });

  it('ignores unknown status letters (e.g. unmerged) rather than guessing', () => {
    const raw = ['U\t.totem/lessons/lesson-unmerged.md', 'A\t.totem/lessons/lesson-real.md'].join(
      '\n',
    );

    const delta = parseLessonNameStatus(raw, LESSONS_PREFIX);

    expect(delta.entries).toEqual([{ path: '.totem/lessons/lesson-real.md', kind: 'added' }]);
  });

  it('is empty for empty/whitespace input and tolerates a trailing prefix slash', () => {
    expect(parseLessonNameStatus('', LESSONS_PREFIX).entries).toEqual([]);
    expect(parseLessonNameStatus('\n  \n', LESSONS_PREFIX).entries).toEqual([]);

    const delta = parseLessonNameStatus('A\t.totem/lessons/x.md', `${LESSONS_PREFIX}/`);
    expect(delta.entries).toEqual([{ path: '.totem/lessons/x.md', kind: 'added' }]);
  });

  it('sorts entries by path for deterministic output', () => {
    const raw = [
      'A\t.totem/lessons/zeta.md',
      'A\t.totem/lessons/alpha.md',
      'A\t.totem/lessons/mid.md',
    ].join('\n');

    const delta = parseLessonNameStatus(raw, LESSONS_PREFIX);

    expect(delta.entries.map((e) => e.path)).toEqual([
      '.totem/lessons/alpha.md',
      '.totem/lessons/mid.md',
      '.totem/lessons/zeta.md',
    ]);
  });
});

describe('classifyLessonsByMtime', () => {
  const COMPILED_AT = 1_000;

  it('names files whose mtime is strictly after the compile instant as changed', () => {
    const delta = classifyLessonsByMtime(
      [
        { path: 'newer.md', mtimeMs: 2_000 },
        { path: 'older.md', mtimeMs: 500 },
        { path: 'equal.md', mtimeMs: 1_000 }, // not strictly after — excluded
      ],
      COMPILED_AT,
    );

    expect(delta.entries).toEqual([{ path: 'newer.md', kind: 'changed' }]);
  });

  it('returns an empty delta when compiledAt is not finite (unparseable date)', () => {
    const delta = classifyLessonsByMtime([{ path: 'a.md', mtimeMs: 9_999 }], Number.NaN);
    expect(delta.entries).toEqual([]);
  });

  it('sorts the fallback entries by path', () => {
    const delta = classifyLessonsByMtime(
      [
        { path: 'b.md', mtimeMs: 5_000 },
        { path: 'a.md', mtimeMs: 5_000 },
      ],
      COMPILED_AT,
    );
    expect(delta.entries.map((e) => e.path)).toEqual(['a.md', 'b.md']);
  });
});

describe('formatStalenessWarning', () => {
  const opts = (provenance: Map<string, ProvenanceValue> | null) => ({
    nameCap: STALE_LESSON_NAME_CAP,
    displayNameFor: basename,
    provenance,
  });

  it('falls back to the generic line (stable prefix + remediation) when nothing is named', () => {
    const msg = formatStalenessWarning({ entries: [] }, opts(null));
    expect(msg).toBe(
      "Compile manifest is stale — lessons changed since last compile. Run 'totem lesson compile' to update.",
    );
    // The stable prefix stays intact for any consumer matching on it.
    expect(msg.startsWith('Compile manifest is stale')).toBe(true);
  });

  it('names lessons with their change kind and last-commit provenance', () => {
    const delta: LessonDelta = {
      entries: [
        { path: '.totem/lessons/a.md', kind: 'added' },
        { path: '.totem/lessons/b.md', kind: 'changed' },
      ],
    };
    const provenance = new Map<string, ProvenanceValue>([
      ['.totem/lessons/a.md', { shortSha: 'abc1234', author: 'Ada Lovelace' }],
      ['.totem/lessons/b.md', { shortSha: 'def5678', author: 'Alan Turing' }],
    ]);

    const msg = formatStalenessWarning(delta, opts(provenance));

    expect(msg).toBe(
      [
        'Compile manifest is stale — 2 lesson(s) changed since last compile.',
        '  • a.md (added) — abc1234 by Ada Lovelace',
        '  • b.md (changed) — def5678 by Alan Turing',
        "Run 'totem lesson compile' to update.",
      ].join('\n'),
    );
  });

  it('marks a lesson with no commit history as (untracked) — the #2113 class', () => {
    const delta: LessonDelta = { entries: [{ path: '.totem/lessons/scratch.md', kind: 'added' }] };
    const provenance = new Map<string, ProvenanceValue>([
      ['.totem/lessons/scratch.md', UNTRACKED_PROVENANCE],
    ]);

    const msg = formatStalenessWarning(delta, opts(provenance));

    expect(msg).toContain('  • scratch.md (added) (untracked)');
  });

  it('renders name-only (no provenance suffix) when provenance is null', () => {
    const delta: LessonDelta = { entries: [{ path: '.totem/lessons/a.md', kind: 'changed' }] };

    const msg = formatStalenessWarning(delta, opts(null));
    const namedLine = msg.split('\n').find((l) => l.startsWith('  • '));

    // The named line carries the kind but NO ` — <sha> by <author>` provenance
    // suffix (the header line legitimately keeps its em dash).
    expect(namedLine).toBe('  • a.md (changed)');
    expect(msg).not.toContain('(untracked)');
  });

  it('caps the named list and appends "…and K more"', () => {
    const entries = Array.from({ length: STALE_LESSON_NAME_CAP + 3 }, (_, i) => ({
      path: `.totem/lessons/lesson-${String(i).padStart(2, '0')}.md`,
      kind: 'changed' as const,
    }));

    const msg = formatStalenessWarning({ entries }, opts(null));
    const lines = msg.split('\n');

    // 1 header + nameCap named + 1 "…and K more" + 1 remediation.
    expect(lines).toHaveLength(STALE_LESSON_NAME_CAP + 3);
    expect(lines[0]).toBe(
      `Compile manifest is stale — ${STALE_LESSON_NAME_CAP + 3} lesson(s) changed since last compile.`,
    );
    const namedLines = lines.filter((l) => l.startsWith('  • '));
    expect(namedLines).toHaveLength(STALE_LESSON_NAME_CAP);
    expect(msg).toContain(`  …and 3 more.`);
    expect(lines[lines.length - 1]).toBe("Run 'totem lesson compile' to update.");
  });

  it('does not append the "more" tail when the count is exactly at the cap', () => {
    const entries = Array.from({ length: STALE_LESSON_NAME_CAP }, (_, i) => ({
      path: `.totem/lessons/lesson-${i}.md`,
      kind: 'added' as const,
    }));

    const msg = formatStalenessWarning({ entries }, opts(null));

    expect(msg).not.toContain('more.');
  });
});

describe('constants', () => {
  it('exposes a positive name cap and a provenance file cap', () => {
    expect(STALE_LESSON_NAME_CAP).toBeGreaterThan(0);
    expect(PROVENANCE_LESSON_FILE_CAP).toBeGreaterThan(STALE_LESSON_NAME_CAP);
  });
});
