import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerEvent } from './ledger.js';
import { appendLedgerEvent, LedgerEventSchema, readLedgerEvents } from './ledger.js';
import { cleanTmpDir } from './test-utils.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ledger-'));
});

afterEach(() => {
  cleanTmpDir(tmpDir);
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

function makeActivityEvent(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    timestamp: '2026-05-15T03:00:00.000Z',
    type: 'mcp_call',
    justification: '',
    source: 'bot',
    agent_source: 'claude',
    session_id: '550e8400-e29b-41d4-a716-446655440000',
    activity_name: 'search_knowledge',
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

  it('accepts source: bot for bot-originated events', () => {
    const event = makeEvent({ source: 'bot', type: 'exemption' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('bot');
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

  // ─── Activity events (A.3.a schema extension) ────────────────

  it('accepts an mcp_call activity event with agent_source + session_id + activity_name', () => {
    const event = makeActivityEvent();
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('mcp_call');
      expect(result.data.agent_source).toBe('claude');
      expect(result.data.session_id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.data.activity_name).toBe('search_knowledge');
      expect(result.data.ruleId).toBeUndefined();
      expect(result.data.file).toBeUndefined();
    }
  });

  it('accepts a session_start activity event without ruleId or file', () => {
    const event = makeActivityEvent({
      type: 'session_start',
      activity_name: 'SessionStart',
    });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('session_start');
      expect(result.data.activity_name).toBe('SessionStart');
    }
  });

  it('accepts a tool_call_first_significant activity event', () => {
    const event = makeActivityEvent({
      type: 'tool_call_first_significant',
      activity_name: 'Write',
      file: 'src/foo.ts',
    });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts a hook_fire activity event with activity_name discriminator', () => {
    const event = makeActivityEvent({
      type: 'hook_fire',
      activity_name: 'PreToolUse',
    });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('accepts all three agent_source values', () => {
    for (const value of ['claude', 'gemini', 'human'] as const) {
      const event = makeActivityEvent({ agent_source: value });
      const result = LedgerEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown agent_source value', () => {
    const event = makeActivityEvent({
      // @ts-expect-error — intentionally invalid for the test
      agent_source: 'cursor',
    });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed session_id UUID', () => {
    const event = makeActivityEvent({ session_id: 'not-a-uuid' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed correlation_id UUID', () => {
    const event = makeActivityEvent({ correlation_id: 'not-a-uuid' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('rejects an empty activity_name', () => {
    const event = makeActivityEvent({ activity_name: '' });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('accepts a pre-A.3.a override event (no new optional fields populated)', () => {
    // Mirrors what a pre-A.3.a writer produces; round-trip must remain compatible.
    const legacyEvent = {
      timestamp: '2026-03-25T12:00:00.000Z',
      type: 'suppress' as const,
      ruleId: 'abc123',
      file: 'src/index.ts',
      justification: 'legacy',
      source: 'lint' as const,
    };
    const result = LedgerEventSchema.safeParse(legacyEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agent_source).toBeUndefined();
      expect(result.data.session_id).toBeUndefined();
      expect(result.data.correlation_id).toBeUndefined();
      expect(result.data.activity_name).toBeUndefined();
    }
  });

  it('accepts an override event with the new optional attribution fields populated', () => {
    const event = makeEvent({
      type: 'override',
      source: 'shield',
      agent_source: 'claude',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      correlation_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });
    const result = LedgerEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agent_source).toBe('claude');
      expect(result.data.correlation_id).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    }
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

  it('round-trips activity events alongside override events', () => {
    // Mixed-event ledger — simulates a real session where override events
    // (lint/shield bypasses) coexist with activity events (MCP calls, etc.).
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const sessionStart = makeActivityEvent({
      type: 'session_start',
      activity_name: 'SessionStart',
      session_id: sessionId,
    });
    const mcpCall = makeActivityEvent({
      type: 'mcp_call',
      activity_name: 'search_knowledge',
      session_id: sessionId,
    });
    const overrideEvent = makeEvent({
      type: 'override',
      source: 'shield',
      ruleId: 'rule-xyz',
      agent_source: 'claude',
      session_id: sessionId,
    });

    appendLedgerEvent(tmpDir, sessionStart);
    appendLedgerEvent(tmpDir, mcpCall);
    appendLedgerEvent(tmpDir, overrideEvent);

    const events = readLedgerEvents(tmpDir);
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('session_start');
    expect(events[1]!.type).toBe('mcp_call');
    expect(events[1]!.activity_name).toBe('search_knowledge');
    expect(events[2]!.type).toBe('override');
    expect(events[2]!.ruleId).toBe('rule-xyz');
    // All three share the session_id — enables per-session compliance computation (A.3.b).
    expect(events.every((e) => e.session_id === sessionId)).toBe(true);
  });
});
