import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { authoredWhitelist } from './authored-whitelist.js';

/**
 * The five rows shipped before the Gate 5 set, in table order: the cert-#1 set
 * (ADR-112 §3 / mmnto-ai/totem#2291) and the two mechanism-validating exemplars.
 */
const SHIPPED_ROWS = [
  { engine: 'regex', structuralClass: 'debug-assert-len-mismatch' },
  { engine: 'ast-grep', structuralClass: 'procgen-entropy-clock-source' },
  { engine: 'ast-grep', structuralClass: 'is_finite' },
  { engine: 'regex', structuralClass: 'forbidden-literal-token' },
  { engine: 'ast-grep', structuralClass: 'node-shape-presence' },
] as const;

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

describe('authoredWhitelist — the Gate 5 batch-1 class set (delivered data)', () => {
  it('carries the five shipped rows first, then the five delivered rows in the delivered order', () => {
    const table = authoredWhitelist();
    expect(table).toHaveLength(SHIPPED_ROWS.length + GATE5_BATCH_1_ROWS.length);
    expect(table.slice(0, SHIPPED_ROWS.length)).toEqual(SHIPPED_ROWS);
    expect(table.slice(SHIPPED_ROWS.length)).toEqual(GATE5_BATCH_1_ROWS);
  });

  it('types every delivered row ast-grep (rule 2 was measured by the scorer; no regex class was delivered)', () => {
    for (const row of authoredWhitelist().slice(SHIPPED_ROWS.length)) {
      expect(row.engine).toBe('ast-grep');
    }
  });

  it('pins the set id (sha256 over the delivered rows in committed order, compact JSON bytes)', () => {
    const delivered = authoredWhitelist()
      .slice(SHIPPED_ROWS.length)
      .map((r) => ({ engine: r.engine, structuralClass: r.structuralClass }));
    const bytes = JSON.stringify(delivered);
    const sha = createHash('sha256').update(bytes, 'utf8').digest('hex');
    expect(sha).toBe(GATE5_BATCH_1_SET_SHA256);
    expect(`static-whitelist@gate5-${sha.slice(0, 8)}`).toBe(GATE5_BATCH_1_JUDGED_BY);
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
