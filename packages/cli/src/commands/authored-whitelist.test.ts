import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROSE_EXTENSIONS } from '@mmnto/totem';

import { authoredWhitelist } from './authored-whitelist.js';
import { classifyFile } from './shield-classify.js';

/**
 * The five rows shipped before the Gate 5 sets, in table order: the cert-#1 set
 * (ADR-112 §3 / mmnto-ai/totem#2291) and the two mechanism-validating exemplars.
 * The exemplar `regex/forbidden-literal-token` carries the prose scope tag since
 * mmnto-ai/totem#2988.
 */
const SHIPPED_ROWS = [
  { engine: 'regex', structuralClass: 'debug-assert-len-mismatch' },
  { engine: 'ast-grep', structuralClass: 'procgen-entropy-clock-source' },
  { engine: 'ast-grep', structuralClass: 'is_finite' },
  { engine: 'regex', structuralClass: 'forbidden-literal-token', scope: 'prose' },
  { engine: 'ast-grep', structuralClass: 'node-shape-presence' },
] as const;

/** The one tagged row's class (mmnto-ai/totem#2988). */
const EXEMPLAR_CLASS = 'forbidden-literal-token';

/**
 * The owner-form set id (mmnto-ai/totem#2988, Q2): `static-whitelist@owner-<sha8>`, the first 8
 * hex of the sha256 over the compact `JSON.stringify` of `{ rows: [{ engine, structuralClass,
 * scope }], proseExtensions: [...] }` for the tagged row, key order as written. A second digest
 * construction on purpose: the `gate5-` form digests `{ engine, structuralClass }` only and
 * cannot carry the tag or the constant. Built below from the LIVE table row and the LIVE core
 * constant, so a change to either moves the digest and this test says so.
 */
const OWNER_SET_SHA256 = '4efdb174a16e037c7b889a0a334fe25ef07fbb5b5e97550baec3656b9de5dde5';
const OWNER_JUDGED_BY = 'static-whitelist@owner-4efdb174';

/**
 * The Gate 5 batch-1 class set as DELIVERED (strategy-claude's dispatch of
 * 2026-09-24T00:28:55Z, set `gate5-2263305c` batch 1): five ast-grep rows, in this
 * order. The set id is `static-whitelist@gate5-<setSha8>`, where setSha8 is the
 * first 8 hex of the sha256 over these rows' compact JSON bytes (`JSON.stringify`,
 * key order `engine` then `structuralClass`, no whitespace) in committed order —
 * the `--judged-by` the batch-1 intake pin passes explicitly. A row edit, a reorder
 * or a re-typing changes the id, and this test says so instead of letting the
 * ledger read `revised` under a stale id.
 */
const GATE5_BATCH_1_ROWS = [
  { engine: 'ast-grep', structuralClass: 'forbidden-callee-call' },
  { engine: 'ast-grep', structuralClass: 'static-import-from-module' },
  { engine: 'ast-grep', structuralClass: 'catch-without-rethrow' },
  { engine: 'ast-grep', structuralClass: 'type-assertion-on-call' },
  { engine: 'ast-grep', structuralClass: 'forbidden-constructor-throw' },
] as const;

const GATE5_BATCH_1_SET_SHA256 = '6cba570671625739d69745949cb38ddde8aaa1ecb7e52f8c869fef57423714b1';
const GATE5_BATCH_1_JUDGED_BY = 'static-whitelist@gate5-6cba5706';

/**
 * The Gate 5 batch-2 class set as DELIVERED (strategy-claude's dispatch of
 * 2026-09-27T21:35:02Z, set `gate5-2263305c` batch 2): two ast-grep rows, in this
 * order, appended after batch 1's five. The set id follows the SAME rule over the
 * batch's OWN slice — never the union with batch 1 — because each batch's rows ride
 * their own patch (the scorer's set-id form of 2026-09-24: one id over the union only
 * when several batches ride one patch). Batch 1's id does not move when batch 2 lands.
 */
const GATE5_BATCH_2_ROWS = [
  { engine: 'ast-grep', structuralClass: 'forbidden-fixed-call-expression' },
  { engine: 'ast-grep', structuralClass: 'callee-call-without-argument' },
] as const;

const GATE5_BATCH_2_SET_SHA256 = '9668b6332b838f4f3f360e1af05bc1ba7f41291f1d64fc3f21f5e2db0f376d86';
const GATE5_BATCH_2_JUDGED_BY = 'static-whitelist@gate5-9668b633';

/**
 * The Gate 5 batch-3 class set as DELIVERED (strategy-claude's dispatch of
 * 2026-09-29T19:47:14Z, set `gate5-2263305c` batch 3): ONE ast-grep row, appended
 * after batch 2's two. The set id follows the SAME rule over the batch's OWN slice:
 * a one-row batch still digests a one-element ARRAY (72 bytes), not the bare object.
 * The name's regex twin was withheld in batch 1 and again here, so it is no row — the
 * class-name uniqueness test below is what would refuse it. The ids of batches 1 and
 * 2 do not move when batch 3 lands.
 */
const GATE5_BATCH_3_ROWS = [
  { engine: 'ast-grep', structuralClass: 'forbidden-callee-literal-arg' },
] as const;

const GATE5_BATCH_3_SET_SHA256 = '21c0175af0f54906db87e0b95273632c9982f272f9a99d125386df4b1aecd205';
const GATE5_BATCH_3_JUDGED_BY = 'static-whitelist@gate5-21c0175a';

/** The delivered batches in table order: each slice's start index and its pinned digest. */
const DELIVERED_BATCHES = [
  {
    name: 'batch 1',
    rows: GATE5_BATCH_1_ROWS,
    sha256: GATE5_BATCH_1_SET_SHA256,
    judgedBy: GATE5_BATCH_1_JUDGED_BY,
  },
  {
    name: 'batch 2',
    rows: GATE5_BATCH_2_ROWS,
    sha256: GATE5_BATCH_2_SET_SHA256,
    judgedBy: GATE5_BATCH_2_JUDGED_BY,
  },
  {
    name: 'batch 3',
    rows: GATE5_BATCH_3_ROWS,
    sha256: GATE5_BATCH_3_SET_SHA256,
    judgedBy: GATE5_BATCH_3_JUDGED_BY,
  },
] as const;

/** The one set-id rule: sha256 over ONE compact JSON array of `{ engine, structuralClass }` rows. */
function setDigest(rows: readonly { engine: string; structuralClass: string }[]): string {
  const bytes = JSON.stringify(
    rows.map((r) => ({ engine: r.engine, structuralClass: r.structuralClass })),
  );
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

describe('authoredWhitelist — the Gate 5 class sets (delivered data, batches 1, 2 and 3)', () => {
  it('carries the five shipped rows first, then batches 1, 2 and 3 in their delivered orders', () => {
    const table = authoredWhitelist();
    const batch1Start = SHIPPED_ROWS.length;
    const batch2Start = batch1Start + GATE5_BATCH_1_ROWS.length;
    const batch3Start = batch2Start + GATE5_BATCH_2_ROWS.length;
    expect(table).toHaveLength(batch3Start + GATE5_BATCH_3_ROWS.length);
    expect(table.slice(0, batch1Start)).toEqual(SHIPPED_ROWS);
    expect(table.slice(batch1Start, batch2Start)).toEqual(GATE5_BATCH_1_ROWS);
    expect(table.slice(batch2Start, batch3Start)).toEqual(GATE5_BATCH_2_ROWS);
    expect(table.slice(batch3Start)).toEqual(GATE5_BATCH_3_ROWS);
  });

  it('types every delivered row ast-grep (batch 1: rule 2 measured; batches 2 and 3: rule 2 modal under D7 = (a); no regex class delivered)', () => {
    const delivered = authoredWhitelist().slice(SHIPPED_ROWS.length);
    expect(delivered).toHaveLength(
      GATE5_BATCH_1_ROWS.length + GATE5_BATCH_2_ROWS.length + GATE5_BATCH_3_ROWS.length,
    );
    for (const row of delivered) {
      expect(row.engine).toBe('ast-grep');
    }
  });

  it('pins each batch set id over its OWN slice in committed order (compact JSON bytes)', () => {
    // Each batch's id is the digest of ITS slice: a digest over several batches together is not
    // a set id while the batches ride separate patches (the scorer's set-id form), and no
    // assertion here compares against it — an inequality between digests of different arrays
    // holds by construction and would pin nothing (leg b2r-F3).
    const table = authoredWhitelist();
    let start = SHIPPED_ROWS.length;
    for (const batch of DELIVERED_BATCHES) {
      const slice = table.slice(start, start + batch.rows.length);
      const sha = setDigest(slice);
      expect(sha, batch.name).toBe(batch.sha256);
      expect(`static-whitelist@gate5-${sha.slice(0, 8)}`, batch.name).toBe(batch.judgedBy);
      start += batch.rows.length;
    }
  });

  it('keeps every (engine, structuralClass) pair unique and no class name under two engines', () => {
    const table = authoredWhitelist();
    const pairs = new Set(table.map((r) => JSON.stringify([r.engine, r.structuralClass])));
    const classes = new Set(table.map((r) => r.structuralClass));
    expect(pairs.size).toBe(table.length);
    expect(classes.size).toBe(table.length);
  });

  it('hands out frozen rows in a frozen table', () => {
    const table = authoredWhitelist();
    expect(Object.isFrozen(table)).toBe(true);
    for (const row of table) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });
});

describe('authoredWhitelist — the prose scope tag and the owner-form set id (mmnto-ai/totem#2988)', () => {
  it('the exemplar row is the ONLY tagged row, and its tag is prose', () => {
    const tagged = authoredWhitelist().filter((r) => r.scope !== undefined);
    expect(tagged).toEqual([{ engine: 'regex', structuralClass: EXEMPLAR_CLASS, scope: 'prose' }]);
  });

  it('pins the owner-form set id over the LIVE tagged row and the LIVE prose-extension constant', () => {
    // A second digest construction on purpose: `setDigest` (the gate5- form) maps rows to
    // `{ engine, structuralClass }` and cannot carry the tag or the constant.
    const row = authoredWhitelist().find((r) => r.structuralClass === EXEMPLAR_CLASS);
    expect(row).toBeDefined();
    const bytes = JSON.stringify({
      rows: [{ engine: row!.engine, structuralClass: row!.structuralClass, scope: row!.scope }],
      proseExtensions: [...PROSE_EXTENSIONS],
    });
    const sha = createHash('sha256').update(bytes, 'utf8').digest('hex');
    expect(sha).toBe(OWNER_SET_SHA256);
    expect(`static-whitelist@owner-${sha.slice(0, 8)}`).toBe(OWNER_JUDGED_BY);
  });

  it('the header carries P1’s clause verbatim on one line, immediately after rule 2’s regex sentence (source-text pin)', () => {
    const P1_CLAUSE =
      "A class whose rule's scope reaches no source file (prose extensions only) has no doc-comment seam for this sentence to guard.";
    const PRECEDING_SENTENCE = 'Classes whose tokens never appear in prose may be regex.';
    const lines = fs
      .readFileSync(path.join(__dirname, 'authored-whitelist.ts'), 'utf-8')
      .split('\n')
      .map((l) => l.replace(/\r$/, ''));
    const at = lines.flatMap((l, i) => (l.includes(P1_CLAUSE) ? [i] : []));
    expect(at).toHaveLength(1);
    const i = at[0]!;
    expect(lines[i]).toBe(`// ${P1_CLAUSE}`);
    expect(lines[i - 1]?.endsWith(PRECEDING_SENTENCE)).toBe(true);
  });

  it('each prose extension classifies NON_CODE in the review classifier (the prose four ⊂ its non-code set)', () => {
    for (const ext of PROSE_EXTENSIONS) {
      expect(classifyFile(`x.${ext}`), ext).toBe('NON_CODE');
    }
  });
});
