import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerEvent } from './ledger.js';
import { appendLedgerEvent, LedgerEventSchema, readLedgerEvents } from './ledger.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ledger-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function makeEvent(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    timestamp: '2026-03-25T12:00:00.000Z',
    type: 'suppress',
    ruleId: 'abc123',
    file: 'src/index.ts',
    justification: '',
    source: 'lint',
    ...overrides,
  };
}

// ─── LedgerEventSchema ─────────────────────────────────

describe('LedgerEventSchema', () => {
  it('validates a well-formed event', () => {
    const event = makeEvent({ line: 42, justification: 'Legacy code' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timestamp).toBe('2026-03-25T12:00:00.000Z');
      expect(result.data.type).toBe('suppress');
      expect(result.data.ruleId).toBe('abc123');
      expect(result.data.file).toBe('src/index.ts');
      expect(result.data.line).toBe(42);
      expect(result.data.justification).toBe('Legacy code');
      expect(result.data.source).toBe('lint');
    }
  });

  it('rejects missing required fields', () => {
    const incomplete = { timestamp: '2026-03-25T12:00:00.000Z', type: 'suppress' };
    const result = LedgerEventSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp format', () => {
    const event = makeEvent({ timestamp: 'not-a-timestamp' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});

// ─── appendLedgerEvent ──────────────────────────────────

describe('appendLedgerEvent', () => {
  it('creates ledger directory and file on first write', () => {
    const event = makeEvent();
    appendLedgerEvent(tmpDir, event);

    const filePath = path.join(tmpDir, 'ledger', 'events.ndjson');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.ruleId).toBe('abc123');
  });

  it('appends multiple events as separate lines', () => {
    const event1 = makeEvent({ ruleId: 'rule1' });
    const event2 = makeEvent({ ruleId: 'rule2' });
    const event3 = makeEvent({ ruleId: 'rule3', type: 'override', source: 'shield' });

    appendLedgerEvent(tmpDir, event1);
    appendLedgerEvent(tmpDir, event2);
    appendLedgerEvent(tmpDir, event3);

    const filePath = path.join(tmpDir, 'ledger', 'events.ndjson');
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3);

    expect(JSON.parse(lines[0]!).ruleId).toBe('rule1');
    expect(JSON.parse(lines[1]!).ruleId).toBe('rule2');
    expect(JSON.parse(lines[2]!).ruleId).toBe('rule3');
  });

  it('preserves NDJSON format with multiline justification', () => {
    const event = makeEvent({
      justification: 'Line one\nLine two\nLine three',
    });
    appendLedgerEvent(tmpDir, event);

    const filePath = path.join(tmpDir, 'ledger', 'events.ndjson');
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    // Should be exactly one NDJSON line despite multiline justification
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.justification).toBe('Line one\nLine two\nLine three');
  });

  it('logs warning on I/O failure without throwing', () => {
    const onWarn = vi.fn();
    // Use a path that cannot be created (file as parent directory)
    // Create a file where the ledger directory should be, blocking mkdirSync
    fs.writeFileSync(path.join(tmpDir, 'ledger'), 'not-a-directory');

    const event = makeEvent();
    // Should not throw
    appendLedgerEvent(tmpDir, event, onWarn);

    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toContain('Trap Ledger write failed');
  });
});

// ─── readLedgerEvents ───────────────────────────────────

describe('readLedgerEvents', () => {
  it('returns all valid events from file', () => {
    const event1 = makeEvent({ ruleId: 'rule1' });
    const event2 = makeEvent({ ruleId: 'rule2', type: 'override', source: 'shield' });

    appendLedgerEvent(tmpDir, event1);
    appendLedgerEvent(tmpDir, event2);

    const events = readLedgerEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0]!.ruleId).toBe('rule1');
    expect(events[1]!.ruleId).toBe('rule2');
    expect(events[1]!.type).toBe('override');
    expect(events[1]!.source).toBe('shield');
  });

  it('skips malformed lines gracefully', () => {
    const ledgerDir = path.join(tmpDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const filePath = path.join(ledgerDir, 'events.ndjson');

    const validEvent = makeEvent({ ruleId: 'valid-rule' });
    const content =
      [
        JSON.stringify(validEvent),
        '{{{invalid json',
        JSON.stringify({ type: 'suppress' }), // missing required fields
        JSON.stringify(makeEvent({ ruleId: 'another-valid' })),
      ].join('\n') + '\n';

    fs.writeFileSync(filePath, content, 'utf-8');

    const events = readLedgerEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0]!.ruleId).toBe('valid-rule');
    expect(events[1]!.ruleId).toBe('another-valid');
  });

  it('returns empty array when file does not exist', () => {
    const events = readLedgerEvents(tmpDir);
    expect(events).toEqual([]);
  });
});
