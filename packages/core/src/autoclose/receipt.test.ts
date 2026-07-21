import { describe, expect, it } from 'vitest';

import {
  AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
  type AutoCloseReceipt,
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

/**
 * Verbatim squash body of totem-strategy#948 (dependabot, first merge under
 * BLANK — strategy-claude 0330Z). BLANK suppresses the prose body but RFC-822
 * attribution trailers survive; after trailer-strip the body is empty → clean.
 */
const STRATEGY_948_BODY =
  'build(deps): bump actions/setup-node from 6 to 7 (#948)\n' +
  '\n' +
  'Signed-off-by: dependabot[bot] <support@github.com>\n' +
  'Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>';

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

describe('scanPrCorpus (D1) — marker-only authorization (codex #3 circularity fix)', () => {
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
    expect(r.declaredByMarker).toEqual([]);
  });

  it('FAILS even when closingIssuesReferences lists the ref (GitHub-derived => cannot authorize)', () => {
    // The circular self-whitelist: GitHub DERIVES closingIssuesReferences from the
    // body keyword, so it must NOT authorize the same finding (codex #3). This
    // replaces the prior test that locked the circular pass.
    const r = scanPrCorpus({
      title: 'feat: thing',
      body: 'Closes #2466',
      commitMessages: ['feat: thing'],
      closingIssuesReferences: [{ number: 2466 }],
      repo: REPO,
    });
    expect(r.ok).toBe(false);
    expect(r.undeclared).toEqual(['#2466']);
    // Recorded as observed GitHub state, but NOT authorizing.
    expect(r.closingIssuesReferences).toContain('#2466');
    expect(r.declaredByMarker).toEqual([]);
  });

  it('PASSES when the ref is authorized by a provenance-distinct totem-close marker', () => {
    const r = scanPrCorpus({
      title: 'feat: thing',
      body: 'Fixes #700\n<!-- totem-close: #700 -->',
      commitMessages: [],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(true);
    expect(r.declaredByMarker).toContain('#700');
  });

  it('the totem-close marker does NOT self-flag (stripIntentMarkers runs first)', () => {
    // `totem-close: #700` contains `close: #700` — a keyword-adjacent ref — so a
    // marker-only body must produce ZERO findings, else the marker whitelists a
    // finding it itself created.
    const r = scanPrCorpus({
      title: 't',
      body: '<!-- totem-close: #700 -->',
      commitMessages: [],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.declaredByMarker).toContain('#700');
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

  it('catches the issue-URL close form (kimi BLOCKING-1)', () => {
    const r = scanPrCorpus({
      title: 't',
      body: 'Fixes https://github.com/mmnto-ai/totem/issues/2466',
      commitMessages: [],
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(false);
    expect(r.undeclared).toEqual(['mmnto-ai/totem#2466']);
  });

  it('scans a >100-commit branch to exhaustion (codex #4 — no 100-cap in the scan)', () => {
    const commitMessages = Array.from({ length: 150 }, (_, i) =>
      i === 120 ? 'fixes #4242 in passing' : `chore: commit ${i}`,
    );
    const r = scanPrCorpus({
      title: 'feat: big',
      body: 'clean',
      commitMessages,
      closingIssuesReferences: [],
      repo: REPO,
    });
    expect(r.ok).toBe(false);
    expect(r.undeclared).toEqual(['#4242']);
  });
});

describe('buildReceipt', () => {
  it('records the marker set + informational closing refs and stamps the schema version', () => {
    const scan = scanPrCorpus({
      title: 't',
      body: 'Fixes #5\n<!-- totem-close: #5 -->',
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
    expect(receipt.declaredByMarker).toContain('#5');
    expect(receipt.closingIssuesReferences).toContain('#5');
    expect(receipt.generatedAt).toBe('2026-07-21T00:00:00.000Z');
  });
});

describe('reconcile (D2, observation mode)', () => {
  const receiptWith = (markerKeys: string[]): AutoCloseReceipt => ({
    schemaVersion: AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
    repo: REPO,
    prNumber: 2471,
    headSha: 'abc',
    declaredByMarker: markerKeys,
    closingIssuesReferences: [],
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

  it('NEGATIVE CONTROL: a marker-authorized close => clean', () => {
    const r = reconcile(receiptWith(['#2466', 'mmnto-ai/totem#2466']), 'Closes #2466', {
      repo: REPO,
    });
    expect(r.status).toBe('clean');
    expect(r.undeclared).toEqual([]);
  });

  it('NEGATIVE CONTROL: an empty-body subject with NO close keyword => clean even with null receipt', () => {
    const r = reconcile(null, 'refactor: tidy the widget (#2471)', { repo: REPO });
    expect(r.status).toBe('clean');
    expect(r.findings).toEqual([]);
    expect(r.bodyPresent).toBe(false);
  });

  it('TRAILER-STRIP: the totem-strategy#948 dependabot squash body => clean (0330Z)', () => {
    // Attribution trailers survive BLANK; after trailer-strip the body is empty.
    const r = reconcile(null, STRATEGY_948_BODY, { repo: 'mmnto-ai/totem-strategy' });
    expect(r.status).toBe('clean');
    expect(r.bodyPresent).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it('reconciles a self-qualified marker declaration against a bare body ref', () => {
    const r = reconcile(receiptWith(['mmnto-ai/totem#2466']), 'Closes #2466', { repo: REPO });
    expect(r.status).toBe('clean');
  });

  // ── ambiguous: alert, never guess ─────────────────────────────────────────

  it('malformed receipt + closure-capable body => ambiguous-receipt', () => {
    const bad = { schemaVersion: 2 } as unknown as AutoCloseReceipt;
    const r = reconcile(bad, 'Closes #2466', { repo: REPO });
    expect(r.status).toBe('ambiguous-receipt');
  });

  it('a v1-shaped receipt (declaredCloseKeys, no declaredByMarker) => ambiguous-receipt', () => {
    const stale = {
      schemaVersion: 1,
      declaredCloseKeys: ['#2466'],
    } as unknown as AutoCloseReceipt;
    const r = reconcile(stale, 'Closes #2466', { repo: REPO });
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
    expect(Array.isArray(r.reopenCandidates)).toBe(true);
  });

  // ── E-lever addendum: body-presence-first + unexpected-body (#1762 0235Z) ──

  it('EMPTY body + no close keyword => clean, bodyPresent=false (the BLANK normal state)', () => {
    const r = reconcile(null, 'chore: bump deps (#2500)', { repo: REPO });
    expect(r.status).toBe('clean');
    expect(r.bodyPresent).toBe(false);
  });

  it('NON-EMPTY body with NO close-keyword ref => unexpected-body (surfaced, not silent)', () => {
    const r = reconcile(null, 'feat: thing (#2500)\n\nSome authored body text, no issue closed.', {
      repo: REPO,
    });
    expect(r.status).toBe('unexpected-body');
    expect(r.bodyPresent).toBe(true);
    expect(r.reopenCandidates).toEqual([]);
    expect(r.message).toMatch(/posture-drift|--body/);
  });

  it('an UNAUTHORIZED close-keyword ref beats the posture signal (body-present anomaly wins)', () => {
    const r = reconcile(receiptWith([]), 'feat: thing (#2500)\n\nAlso closes #2466 in passing.', {
      repo: REPO,
    });
    expect(r.status).toBe('anomaly');
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.bodyPresent).toBe(true);
  });

  it('a close keyword in the SUBJECT (PR_TITLE) with empty body still reconciles', () => {
    const r = reconcile(receiptWith([]), 'Fix #2466: the widget', { repo: REPO });
    expect(r.status).toBe('anomaly');
    expect(r.undeclared).toEqual(['#2466']);
    expect(r.bodyPresent).toBe(false);
  });
});
