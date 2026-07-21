import { describe, expect, it } from 'vitest';

import {
  AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
  type AutoCloseReceipt,
  buildDeclaredCloseKeys,
  buildReceipt,
  parseDeclaredCloseIntent,
  reconcile,
  scanPrCorpus,
} from './receipt.js';

const REPO = 'mmnto-ai/totem';

/** Verbatim body of commit b8aa74a2 on main — the real #2471→#2466 specimen. */
const B8AA74A2_BODY =
  'fix(review): deterministic skip paths no longer stamp the push gate (#2466) (#2471)\n' +
  '\n' +
  'Three deterministic skip paths (all-generated, all-non-code, filtered-empty) no longer ' +
  'mint the reviewed-content stamp; they log a shared NON-REVIEW notice instead. ' +
  'Does not close #2466 (live exit-0 half deferred to #2473).';

describe('parseDeclaredCloseIntent', () => {
  it('parses an HTML-comment marker with multiple refs', () => {
    expect(parseDeclaredCloseIntent('<!-- totem-close: #12, mmnto-ai/other#34 -->')).toEqual([
      { issue: 12 },
      { qualifier: 'mmnto-ai/other', issue: 34 },
    ]);
  });

  it('parses a Totem-Close: trailer line', () => {
    expect(parseDeclaredCloseIntent('body text\nTotem-Close: #99')).toEqual([{ issue: 99 }]);
  });

  it('returns [] when no marker present', () => {
    expect(parseDeclaredCloseIntent('just prose #5')).toEqual([]);
  });
});

describe('buildDeclaredCloseKeys', () => {
  it('adds both bare and self-qualified forms for a same-repo closing ref', () => {
    expect(buildDeclaredCloseKeys([{ number: 2466 }], [], REPO).sort()).toEqual(
      ['#2466', 'mmnto-ai/totem#2466'].sort(),
    );
  });

  it('merges closingIssuesReferences with structured intent', () => {
    const keys = buildDeclaredCloseKeys([{ number: 1 }], [{ issue: 2 }], REPO);
    expect(keys).toContain('#1');
    expect(keys).toContain('#2');
  });
});

describe('scanPrCorpus (D1)', () => {
  it('FAILS on an undeclared close-keyword ref in the corpus', () => {
    const r = scanPrCorpus({
      title: 'chore: cleanup',
      body: 'Does not close #2466',
      commitMessages: ['chore: cleanup'],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(false);
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.declaredCloseKeys).toEqual([]);
  });

  it('PASSES when the ref is declared via closingIssuesReferences', () => {
    const r = scanPrCorpus({
      title: 'feat: thing',
      body: 'Closes #2466',
      commitMessages: ['feat: thing'],
      closingIssuesReferences: [{ number: 2466 }],
      repo: REPO,
    });
    expect(r.ok).toBe(true);
    expect(r.undeclared).toEqual([]);
    expect(r.findings).toEqual(['#2466']);
  });

  it('PASSES when the ref is whitelisted via a structured-intent marker', () => {
    const r = scanPrCorpus({
      title: 'feat: thing',
      body: 'Fixes #700\n<!-- totem-close: #700 -->',
      commitMessages: [],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(true);
    expect(r.declaredCloseKeys).toContain('#700');
  });

  it('scans branch COMMIT MESSAGES, not just the PR description', () => {
    const r = scanPrCorpus({
      title: 'feat: thing',
      body: 'clean description',
      commitMessages: ['wip', 'fixes #321 in passing'],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(false);
    expect(r.undeclared).toEqual(['#321']);
  });
});

describe('buildReceipt', () => {
  it('captures the declared set and stamps the schema version', () => {
    const scan = scanPrCorpus({
      title: 't',
      body: 'Closes #5',
      commitMessages: [],
      closingIssuesReferences: [{ number: 5 }],
      repo: REPO,
    });
    const receipt = buildReceipt(
      { repo: REPO },
      42,
      'deadbeef',
      scan,
      new Date('2026-07-21T00:00:00Z'),
    );
    expect(receipt.schemaVersion).toBe(AUTO_CLOSE_RECEIPT_SCHEMA_VERSION);
    expect(receipt.prNumber).toBe(42);
    expect(receipt.headSha).toBe('deadbeef');
    expect(receipt.declaredCloseKeys).toContain('#5');
    expect(receipt.generatedAt).toBe('2026-07-21T00:00:00.000Z');
  });
});

describe('reconcile (D2, observation mode)', () => {
  const receiptWith = (keys: string[]): AutoCloseReceipt => ({
    schemaVersion: AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
    repo: REPO,
    prNumber: 2471,
    headSha: 'abc',
    declaredCloseKeys: keys,
    corpusFindings: [],
    generatedAt: '2026-07-21T00:00:00.000Z',
    note: '',
  });

  // ── positive controls: the b8aa74a2 specimen ──────────────────────────────

  it('POSITIVE CONTROL: zero-allowed-set receipt + b8aa74a2 body => anomaly', () => {
    const r = reconcile(receiptWith([]), B8AA74A2_BODY, { repo: REPO });
    expect(r.status).toBe('anomaly');
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.reopenCandidates).toEqual(['#2466']);
    expect(r.message).toMatch(/zero-allowed-set/);
  });

  it('POSITIVE CONTROL: missing receipt + b8aa74a2 body => missing-receipt', () => {
    const r = reconcile(null, B8AA74A2_BODY, { repo: REPO });
    expect(r.status).toBe('missing-receipt');
    expect(r.findings).toEqual(['#2466']);
    expect(r.reopenCandidates).toEqual(['#2466']);
  });

  // ── negative controls ─────────────────────────────────────────────────────

  it('NEGATIVE CONTROL: a genuinely declared close => clean', () => {
    const r = reconcile(receiptWith(['#2466', 'mmnto-ai/totem#2466']), 'Closes #2466', {
      repo: REPO,
    });
    expect(r.status).toBe('clean');
    expect(r.undeclared).toEqual([]);
  });

  it('NEGATIVE CONTROL: an empty-body subject with NO close keyword => clean even with null receipt', () => {
    // Under BLANK the squash message is the PR title only (empty body).
    const r = reconcile(null, 'refactor: tidy the widget (#2471)', { repo: REPO });
    expect(r.status).toBe('clean');
    expect(r.findings).toEqual([]);
    expect(r.bodyPresent).toBe(false);
  });

  it('reconciles a self-qualified declaration against a bare body ref', () => {
    const r = reconcile(receiptWith(['mmnto-ai/totem#2466']), 'Closes #2466', { repo: REPO });
    expect(r.status).toBe('clean');
  });

  // ── ambiguous: alert, never guess ─────────────────────────────────────────

  it('malformed receipt + closure-capable body => ambiguous-receipt', () => {
    const bad = { schemaVersion: 1 } as unknown as AutoCloseReceipt;
    const r = reconcile(bad, 'Closes #2466', { repo: REPO });
    expect(r.status).toBe('ambiguous-receipt');
  });

  it('receipt for the wrong PR => ambiguous-receipt', () => {
    const r = reconcile(receiptWith(['#2466']), 'Closes #2466', {
      repo: REPO,
      expectedPrNumber: 9999,
    });
    expect(r.status).toBe('ambiguous-receipt');
  });

  it('never populates a side-effecting field — reopenCandidates is advisory only', () => {
    const r = reconcile(receiptWith([]), B8AA74A2_BODY, { repo: REPO });
    // Observation mode: the candidates are reported but the caller must not act.
    expect(Array.isArray(r.reopenCandidates)).toBe(true);
  });

  // ── E-lever addendum: body-presence-first + unexpected-body (#1762 0235Z) ──

  it('EMPTY body + no close keyword => clean, bodyPresent=false (the BLANK normal state)', () => {
    const r = reconcile(null, 'chore: bump deps (#2500)', { repo: REPO });
    expect(r.status).toBe('clean');
    expect(r.bodyPresent).toBe(false);
  });

  it('NON-EMPTY body with NO close-keyword ref => unexpected-body (surfaced, not silent)', () => {
    // The interpretation call: a non-empty body under BLANK is posture-drift /
    // `--body`-override EVIDENCE — surfaced, but NOT a hard close-anomaly (no
    // closure harm), and carries no reopen candidates.
    const r = reconcile(null, 'feat: thing (#2500)\n\nSome authored body text, no issue closed.', {
      repo: REPO,
    });
    expect(r.status).toBe('unexpected-body');
    expect(r.bodyPresent).toBe(true);
    expect(r.reopenCandidates).toEqual([]);
    expect(r.message).toMatch(/posture-drift|--body/);
  });

  it('an UNDECLARED close-keyword ref beats the posture signal (body-present anomaly wins)', () => {
    // A local `--body` override carrying an undeclared close is the confirmed
    // vector — the hard anomaly must take precedence over unexpected-body.
    const r = reconcile(receiptWith([]), 'feat: thing (#2500)\n\nAlso closes #2466 in passing.', {
      repo: REPO,
    });
    expect(r.status).toBe('anomaly');
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.bodyPresent).toBe(true);
  });

  it('a close keyword in the SUBJECT (PR_TITLE) with empty body still reconciles', () => {
    // Under PR_TITLE the subject can carry a close; an undeclared one still alerts.
    const r = reconcile(receiptWith([]), 'Fix #2466: the widget', { repo: REPO });
    expect(r.status).toBe('anomaly');
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.bodyPresent).toBe(false);
  });
});
