import { describe, expect, it } from 'vitest';

import {
  classifyDisposition,
  type DispositionClass,
  type DispositionComment,
  dispositionToLabel,
} from './disposition-taxonomy.js';

// A held-out review thread: a bot finding + zero-or-more human replies.
const BOT = 'coderabbitai[bot]';
const HUMAN = 'satur8d';

function thread(...replies: string[]): DispositionComment[] {
  return [
    { author: BOT, body: 'Potential null deref on `foo.bar` here.' },
    ...replies.map((body) => ({ author: HUMAN, body })),
  ];
}

describe('classifyDisposition — accepted-fix ⟹ TP', () => {
  it.each([
    'Fixed in the latest push.',
    'Good catch — fixed.',
    'It has now been addressed.',
    'This has been fixed.',
    'The fix has been applied.',
  ])('credits an unambiguous fix reply: %s', (reply) => {
    expect(classifyDisposition(thread(reply))).toBe('accepted-fix');
  });

  it('maps accepted-fix → TP', () => {
    expect(dispositionToLabel('accepted-fix')).toBe('TP');
  });
});

describe('classifyDisposition — declined-as-false-positive ⟹ FP (correctness rebuttals only)', () => {
  it.each([
    'This is a false positive — the value is never null here.',
    'Not a bug, the guard above covers it.',
    'Works as intended.',
    'This is by design.',
    'This is intentional — we want the eager throw.',
    'Not applicable here.',
  ])('credits an unambiguous correctness rebuttal: %s', (reply) => {
    expect(classifyDisposition(thread(reply))).toBe('declined-as-false-positive');
  });

  it('maps declined-as-false-positive → FP', () => {
    expect(dispositionToLabel('declined-as-false-positive')).toBe('FP');
  });
});

describe('classifyDisposition — soft declines ⟹ UNLABELED', () => {
  it('scope: out-of-scope / separate PR', () => {
    expect(classifyDisposition(thread('Out of scope for this PR.'))).toBe('scope');
    expect(classifyDisposition(thread('Will do this in a separate PR.'))).toBe('scope');
  });

  it('defer: follow-up / tracked / won’t fix', () => {
    expect(classifyDisposition(thread('Tracked in #1234, follow-up.'))).toBe('defer');
    expect(classifyDisposition(thread("Won't fix for now."))).toBe('defer');
  });

  it('superseded: the flagged code was refactored away', () => {
    expect(classifyDisposition(thread('Refactored — no longer applies.'))).toBe('superseded');
  });

  it('style: a subjective nit', () => {
    expect(classifyDisposition(thread('Just a nit, leaving as-is.'))).toBe('style');
  });

  it.each<DispositionClass>(['scope', 'defer', 'superseded', 'style', 'ambiguous'])(
    'every UNLABELED class maps to null: %s',
    (cls) => {
      expect(dispositionToLabel(cls)).toBeNull();
    },
  );
});

describe('classifyDisposition — ambiguous ⟹ UNLABELED (conservative-by-construction)', () => {
  it('no human reply (bot-only thread) is ambiguous — isResolved alone is never TP', () => {
    expect(classifyDisposition([{ author: BOT, body: 'Consider extracting this.' }])).toBe(
      'ambiguous',
    );
  });

  it('an empty / whitespace human reply is ambiguous', () => {
    expect(classifyDisposition(thread('   '))).toBe('ambiguous');
  });

  it('a human reply with no recognizable disposition is ambiguous', () => {
    expect(classifyDisposition(thread('Thanks for the review!'))).toBe('ambiguous');
  });

  it('conflicting fix + false-positive signals collapse to ambiguous', () => {
    expect(classifyDisposition(thread('It is by design, but I fixed it anyway.'))).toBe(
      'ambiguous',
    );
  });

  it('an impure fix (fix + scope) does not credit TP', () => {
    expect(classifyDisposition(thread('Fixed the related part; the rest is out of scope.'))).toBe(
      'ambiguous',
    );
  });

  it('an impure rebuttal (false-positive + defer) does not credit FP', () => {
    expect(
      classifyDisposition(thread('Arguably a false positive, but tracked in #99 either way.')),
    ).toBe('ambiguous');
  });
});

describe("codex's falsifying case — a scope/defer decline must NEVER become FP", () => {
  it('"declined, tracked for later / too broad for this PR" is UNLABELED, not FP', () => {
    const cls = classifyDisposition(thread('Declined — tracked for later, too broad for this PR.'));
    expect(cls).not.toBe('declined-as-false-positive');
    expect(dispositionToLabel(cls)).toBeNull();
  });

  it('the binary primitive would have called this `declined`; we keep it UNLABELED', () => {
    // bare "declined" with no correctness rebuttal is not an FP claim.
    expect(dispositionToLabel(classifyDisposition(thread('Declined.')))).toBeNull();
  });
});

describe('classifyDisposition — bot replies are not dispositions', () => {
  it('a bot follow-up does not count as a human fix signal', () => {
    const t: DispositionComment[] = [
      { author: BOT, body: 'Potential issue.' },
      { author: 'greptileai[bot]', body: 'Fixed in the suggested commit.' },
    ];
    expect(classifyDisposition(t)).toBe('ambiguous');
  });
});

describe('classifyDisposition — negation / over-match regressions (#2230 bot panel + strategy-claude)', () => {
  it('GCA :95 — "this is not correct" / "correct, I will fix it" is an AGREEMENT, never FP', () => {
    expect(dispositionToLabel(classifyDisposition(thread('This is not correct.')))).not.toBe('FP');
    expect(
      dispositionToLabel(classifyDisposition(thread('You are correct, I will fix it.'))),
    ).not.toBe('FP');
  });

  it('greptile :91 — "this behavior is not intentional" is not a false-positive rebuttal', () => {
    expect(
      classifyDisposition(thread('This behavior is not intentional but matches the contract.')),
    ).not.toBe('declined-as-false-positive');
  });

  it('strategy-claude — "intentionally structured it, will fix the edge case" is not FP', () => {
    // future-tense "will fix" is not in the fix bank; the anchored `is intentional`
    // no longer trips on the bare adverb → no false FP.
    expect(
      classifyDisposition(thread('Intentionally structured it this way; will fix the edge case.')),
    ).not.toBe('declined-as-false-positive');
  });

  it('greptile :78 P1 — negation-blind "not been addressed" / "not applied" is not a fix', () => {
    expect(classifyDisposition(thread('This has not been addressed yet.'))).not.toBe(
      'accepted-fix',
    );
    expect(classifyDisposition(thread('That was not applied.'))).not.toBe('accepted-fix');
  });

  it('strategy-claude / greptile — "Well done, but this still needs work" is not a fix', () => {
    expect(classifyDisposition(thread('Well done, but this still needs work.'))).not.toBe(
      'accepted-fix',
    );
  });

  it('greptile :112 — lowercase "todo: track this" is recognized as a defer', () => {
    expect(classifyDisposition(thread('todo: track this separately.'))).toBe('defer');
  });

  it('CR round-2 — praise words dropped: "not a good catch" is not a fix, "good catch" alone is not TP', () => {
    expect(classifyDisposition(thread('Not a good catch — the guard is in the parent.'))).not.toBe(
      'accepted-fix',
    );
    // bare praise without a fix confirmation is not an accepted-fix (only "…, fixed" is).
    expect(classifyDisposition(thread('Good catch!'))).toBe('ambiguous');
  });
});
