import { describe, expect, it } from 'vitest';

import { LedgerEventSchema } from '../ledger.js';
import {
  checkQbdCorrelationId,
  decodeQbdMintInstant,
  mintQbdCorrelationId,
  QBD_CORRELATION_WINDOW_MS,
  QBD_MINT_TOLERANCE_MS,
} from './correlation-id.js';

const T0 = Date.parse('2026-07-28T12:00:00.000Z');

describe('mintQbdCorrelationId', () => {
  it('embeds the mint instant so the ID is self-dating', () => {
    const id = mintQbdCorrelationId(T0);
    expect(decodeQbdMintInstant(id)).toBe(T0);
  });

  it('is unique across calls at the same instant', () => {
    const a = mintQbdCorrelationId(T0);
    const b = mintQbdCorrelationId(T0);
    expect(a).not.toBe(b);
    expect(decodeQbdMintInstant(a)).toBe(decodeQbdMintInstant(b));
  });

  it('rejects a nonsense mint instant rather than emitting a bad ID', () => {
    expect(() => mintQbdCorrelationId(Number.NaN)).toThrow(RangeError);
    expect(() => mintQbdCorrelationId(-1)).toThrow(RangeError);
  });

  it('returns undefined decoding a non-QBD string', () => {
    expect(decodeQbdMintInstant('not-an-id')).toBeUndefined();
    expect(decodeQbdMintInstant('550e8400-e29b-41d4-a716-446655440000')).toBeUndefined();
  });
});

describe('checkQbdCorrelationId — the minted-at-write-time contract', () => {
  it('accepts a query ID minted at its own row instant', () => {
    const id = mintQbdCorrelationId(T0);
    expect(checkQbdCorrelationId(id, 'corpus_query', T0).ok).toBe(true);
  });

  it('REJECTS a query row whose ID was minted earlier — the backfill shape', () => {
    // The falsifier-2 case: an ID minted at some past moment, attached later to
    // a query row that was already on disk.
    const id = mintQbdCorrelationId(T0 - 60_000);
    const result = checkQbdCorrelationId(id, 'corpus_query', T0);
    expect(result.ok).toBe(false);
    expect(result.violation).toBe('query-id-not-self-minted');
  });

  it('accepts a derive ID minted earlier, inside the correlation window', () => {
    const id = mintQbdCorrelationId(T0 - 60_000);
    expect(checkQbdCorrelationId(id, 'derive_action', T0).ok).toBe(true);
  });

  it('REJECTS a derive ID minted after the derive it claims to have grounded', () => {
    const id = mintQbdCorrelationId(T0 + 60_000);
    const result = checkQbdCorrelationId(id, 'derive_action', T0);
    expect(result.ok).toBe(false);
    expect(result.violation).toBe('derive-id-minted-after-derive');
  });

  it('REJECTS a derive ID older than the correlation window', () => {
    const id = mintQbdCorrelationId(T0 - QBD_CORRELATION_WINDOW_MS - 1000);
    const result = checkQbdCorrelationId(id, 'derive_action', T0);
    expect(result.ok).toBe(false);
    expect(result.violation).toBe('derive-id-older-than-window');
  });

  it('tolerates sub-tolerance clock jitter on a query row', () => {
    const id = mintQbdCorrelationId(T0 - (QBD_MINT_TOLERANCE_MS - 1));
    expect(checkQbdCorrelationId(id, 'corpus_query', T0).ok).toBe(true);
  });

  it('REJECTS a malformed ID', () => {
    const result = checkQbdCorrelationId('qbd1-nope', 'corpus_query', T0);
    expect(result.ok).toBe(false);
    expect(result.violation).toBe('malformed-shape');
  });

  it('REJECTS the field on an event type with no query→derive semantics', () => {
    const id = mintQbdCorrelationId(T0);
    const result = checkQbdCorrelationId(id, 'mcp_call', T0);
    expect(result.ok).toBe(false);
    expect(result.violation).toBe('id-on-non-qbd-event');
  });
});

describe('LedgerEventSchema enforces the contract at the schema layer', () => {
  const baseRow = {
    timestamp: new Date(T0).toISOString(),
    type: 'derive_action' as const,
    activity_name: 'spec',
    source: 'lint' as const,
    justification: '',
  };

  it('parses a contract-valid correlated derive row', () => {
    const row = { ...baseRow, qbd_correlation_id: mintQbdCorrelationId(T0 - 60_000) };
    expect(LedgerEventSchema.safeParse(row).success).toBe(true);
  });

  it('parses an UNcorrelated derive row — it is a data point, not an error', () => {
    // Falsifier 1: a derive with no query behind it must survive parsing so it
    // can land in the denominator.
    expect(LedgerEventSchema.safeParse(baseRow).success).toBe(true);
  });

  it('REJECTS a backfilled ID — a schema violation, not a data point', () => {
    const row = { ...baseRow, qbd_correlation_id: mintQbdCorrelationId(T0 + 60_000) };
    const result = LedgerEventSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('derive-id-minted-after-derive');
    }
  });

  it('REJECTS a correlation ID stapled onto an unrelated event type', () => {
    const row = {
      timestamp: new Date(T0).toISOString(),
      type: 'mcp_call' as const,
      source: 'bot' as const,
      justification: '',
      qbd_correlation_id: mintQbdCorrelationId(T0),
    };
    expect(LedgerEventSchema.safeParse(row).success).toBe(false);
  });

  it('leaves pre-existing event types untouched', () => {
    const legacy = {
      timestamp: new Date(T0).toISOString(),
      type: 'suppress' as const,
      ruleId: 'abc123',
      file: 'packages/core/src/logger.ts',
      source: 'lint' as const,
      justification: 'logger module',
    };
    expect(LedgerEventSchema.safeParse(legacy).success).toBe(true);
  });
});
