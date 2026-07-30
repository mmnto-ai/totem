/**
 * Render tests for the `totem doctor --compliance` query-before-derive section
 * (mmnto-ai/totem#2510).
 *
 * The degraded-read block follows the ADR-115 § 2 convention: this is a
 * READ-ONLY path, so the backstop is an explicit `DEGRADED` / `UNVERIFIED`
 * envelope in the rendered output — never a nonzero exit — and the per-item
 * accounting is asserted by the specific failing class being NAMED. The control
 * assertion pins that a clean ledger renders no envelope at all, so the envelope
 * cannot rot into decoration that is always present.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { doctorQbdComplianceCommand } from './doctor-qbd.js';

const T0 = Date.parse('2026-07-28T12:00:00.000Z');

/**
 * Strip ANSI so assertions are colour-independent regardless of whether
 * picocolors decides this environment supports colour. Constructed via
 * `String.fromCharCode(27)` so no raw ESC control byte is authored into source.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** A minimal VALID config — `targets` requires at least one entry. */
const TOTEM_YAML = [
  'targets:',
  '  - glob: "src/**/*.ts"',
  '    type: code',
  '    strategy: file',
  '',
].join('\n');

let cwd: string;
let lines: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-cli-')));
  // A real local config, so resolution stays LOCAL. Without one, this machine's
  // global `~/.totem/` profile wins the lookup and the reader would resolve a
  // ledger outside the fixture entirely.
  fs.writeFileSync(path.join(cwd, 'totem.yaml'), TOTEM_YAML, 'utf-8');
  lines = [];
  spy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
    lines.push(String(msg).replace(ANSI, ''));
  });
});

afterEach(() => {
  spy.mockRestore();
  cleanTmpDir(cwd);
});

function output(): string {
  return lines.join('\n');
}

function sid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function correlatedLedger(): Promise<string> {
  const { mintQbdCorrelationId } = await import('@mmnto/totem');
  const id = mintQbdCorrelationId(T0);
  return [
    JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'corpus_query',
      activity_name: 'totem_search',
      source: 'lint',
      justification: '',
      qbd_correlation_id: id,
      session_id: sid(1),
    }),
    JSON.stringify({
      timestamp: new Date(T0 + 1000).toISOString(),
      type: 'derive_action',
      activity_name: 'spec',
      source: 'lint',
      justification: '',
      qbd_correlation_id: id,
      session_id: sid(1),
    }),
    JSON.stringify({
      timestamp: new Date(T0 + 2000).toISOString(),
      type: 'derive_action',
      activity_name: 'orient',
      source: 'lint',
      justification: '',
      session_id: sid(1),
    }),
  ].join('\n');
}

describe('doctorQbdComplianceCommand — clean render', () => {
  it('renders the number with its raw counts', async () => {
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    // One correlated derive of two → 0.50.
    expect(output()).toContain('compliance: 0.50 (1/2)');
  });

  it('states the pre-registered threshold and window VERBATIM', async () => {
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    expect(output()).toContain(
      'compliance ≥ 0.50, evaluated over the first 20 instrumented sessions carrying ≥1 derive-class event, regardless of query count',
    );
  });

  it('holds the verdict at PENDING until the window fills', async () => {
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    expect(output()).toContain('verdict: PENDING');
    expect(output()).toContain('1/20 instrumented sessions');
  });

  it('names the ritual-query limitation instead of claiming it solved', async () => {
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    expect(output()).toContain('ADJACENCY, not influence');
    expect(output()).toContain('Named, not solved.');
  });

  it('renders NO degraded envelope on a clean ledger (control)', async () => {
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    expect(output()).not.toContain('DEGRADED');
    expect(output()).not.toContain('UNVERIFIED');
  });

  it('never touches the exit code (Tenet 13 sensor)', async () => {
    const before = process.exitCode;
    await doctorQbdComplianceCommand({
      cwdForTest: cwd,
      ledgerContentForTest: await correlatedLedger(),
    });
    expect(process.exitCode).toBe(before);
  });
});

describe('doctorQbdComplianceCommand — degraded render (ADR-115 § 2)', () => {
  it('announces DEGRADED/UNVERIFIED and names the failing items', async () => {
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    // A backfilled row (ID minted an hour after the derive) plus a torn line.
    const backfilled = mintQbdCorrelationId(T0 + 3_600_000);
    const content = [
      JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type: 'derive_action',
        activity_name: 'spec',
        source: 'lint',
        justification: '',
        qbd_correlation_id: backfilled,
        session_id: sid(1),
      }),
      '{ torn line',
      JSON.stringify({
        timestamp: new Date(T0 + 1000).toISOString(),
        type: 'derive_action',
        activity_name: 'orient',
        source: 'lint',
        justification: '',
        session_id: sid(1),
      }),
    ].join('\n');

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });

    const out = output();
    // The envelope itself.
    expect(out).toContain('DEGRADED');
    expect(out).toContain('compliance (UNVERIFIED)');
    // Per-item accounting, by class.
    expect(out).toContain('1 malformed JSON line(s)');
    expect(out).toContain('1 correlation-contract violation(s)');
  });

  it('a broken scan never renders like a clean number', async () => {
    // The defect class ADR-115 § 2 names: degraded state that is
    // indistinguishable from verified state.
    //
    // The fixture MUST contain real derives. An earlier version used two torn
    // lines and nothing else, so the scan had zero derive events and rendered
    // "n/a" — meaning `not.toMatch(/compliance: \d/)` passed no matter what
    // label the code used. The assertion only bites when a number genuinely
    // would have been printed.
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    const id = mintQbdCorrelationId(T0);
    const content = [
      JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type: 'corpus_query',
        activity_name: 'totem_search',
        source: 'lint',
        justification: '',
        qbd_correlation_id: id,
        session_id: sid(1),
      }),
      JSON.stringify({
        timestamp: new Date(T0 + 1000).toISOString(),
        type: 'derive_action',
        activity_name: 'spec',
        source: 'lint',
        justification: '',
        qbd_correlation_id: id,
        session_id: sid(1),
      }),
      '{ torn',
      '{ also torn',
    ].join('\n');

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });

    const out = output();
    expect(out).toContain('DEGRADED');
    expect(out).toContain('2 malformed JSON line(s)');
    // A number IS computed here (1/1) — but it must never appear unlabelled.
    expect(out).toContain('compliance (UNVERIFIED): 1.00 (1/1)');
    expect(out).not.toMatch(/(?<!\()compliance: \d/);
  });

  it('DEGRADES on a backdated append', async () => {
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    const backdated = Date.parse('2019-01-01T00:00:00.000Z');
    const content = [
      JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type: 'derive_action',
        activity_name: 'spec',
        source: 'lint',
        justification: '',
        session_id: sid(1),
      }),
      JSON.stringify({
        timestamp: new Date(backdated).toISOString(),
        type: 'corpus_query',
        activity_name: 'totem_search',
        source: 'lint',
        justification: '',
        qbd_correlation_id: mintQbdCorrelationId(backdated),
        session_id: sid(2),
      }),
    ].join('\n');

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });
    expect(output()).toContain('backdated append');
  });

  it('reports an unknown event type as an advisory, NOT as DEGRADED', async () => {
    const content = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'some_future_event_type',
      source: 'lint',
      justification: '',
    });

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });
    const out = output();
    expect(out).toContain('version skew');
    expect(out).not.toContain('DEGRADED');
  });

  it('flags an orphan correlation rather than crediting it', async () => {
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    const orphan = mintQbdCorrelationId(T0);
    const content = JSON.stringify({
      timestamp: new Date(T0 + 1000).toISOString(),
      type: 'derive_action',
      activity_name: 'review',
      source: 'lint',
      justification: '',
      qbd_correlation_id: orphan,
      session_id: sid(1),
    });

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });

    const out = output();
    expect(out).toContain('DEGRADED');
    expect(out).toContain('no preceding query row');
    expect(out).toContain('compliance (UNVERIFIED): 0.00 (0/1)');
  });
});

describe('doctorQbdComplianceCommand — real on-disk read', () => {
  /** Build N instrumented sessions on disk, correlated or not. */
  async function writeLedger(sessions: number, correlated: boolean): Promise<void> {
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    const lines: string[] = [];
    for (let i = 0; i < sessions; i++) {
      const ms = T0 + i * 86_400_000;
      if (correlated) {
        const id = mintQbdCorrelationId(ms);
        lines.push(
          JSON.stringify({
            timestamp: new Date(ms).toISOString(),
            type: 'corpus_query',
            activity_name: 'totem_search',
            source: 'lint',
            justification: '',
            qbd_correlation_id: id,
            session_id: sid(i),
          }),
          JSON.stringify({
            timestamp: new Date(ms + 1000).toISOString(),
            type: 'derive_action',
            activity_name: 'spec',
            source: 'lint',
            justification: '',
            qbd_correlation_id: id,
            session_id: sid(i),
          }),
        );
      } else {
        lines.push(
          JSON.stringify({
            timestamp: new Date(ms).toISOString(),
            type: 'derive_action',
            activity_name: 'spec',
            source: 'lint',
            justification: '',
            session_id: sid(i),
          }),
        );
      }
    }
    const dir = path.join(cwd, '.totem', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.ndjson'), lines.join('\n') + '\n', 'utf-8');
  }

  it('reads a real events.ndjson off disk through the production path', async () => {
    // No `ledgerContentForTest` — this exercises the actual file read, which
    // every other test in this file stubs past.
    await writeLedger(2, true);
    await doctorQbdComplianceCommand({ cwdForTest: cwd });

    const out = output();
    expect(out).toContain('compliance: 1.00 (2/2)');
    expect(out).not.toContain('SKIP');
  });

  it('renders PASS on a filled window at or above the floor, exit code untouched', async () => {
    await writeLedger(20, true);
    const before = process.exitCode;
    await doctorQbdComplianceCommand({ cwdForTest: cwd });

    expect(output()).toContain('verdict: PASS');
    expect(process.exitCode).toBe(before);
  });

  it('renders FAIL below the floor and STILL leaves the exit code alone', async () => {
    // The sensor-not-actuator contract matters most on the failing branch:
    // this is the one a reader would expect to gate, and it must not.
    await writeLedger(20, false);
    const before = process.exitCode;
    await doctorQbdComplianceCommand({ cwdForTest: cwd });

    const out = output();
    expect(out).toContain('verdict: FAIL');
    expect(out).toContain('FALSIFIED');
    expect(process.exitCode).toBe(before);
  });

  it('SKIPs honestly when the ledger path is unreadable', async () => {
    // Induce a real errno: a DIRECTORY where events.ndjson should be, so the
    // read throws EISDIR rather than ENOENT.
    const dir = path.join(cwd, '.totem', 'ledger', 'events.ndjson');
    fs.mkdirSync(dir, { recursive: true });

    await doctorQbdComplianceCommand({ cwdForTest: cwd });
    const out = output();
    expect(out).toContain('SKIP');
    expect(out).toContain('unreadable');
    expect(out).not.toContain('0.00');
  });
});

describe('doctorQbdComplianceCommand — absent and empty states', () => {
  it('SKIPs on a missing ledger — not a fail, and emphatically not 0%', async () => {
    await doctorQbdComplianceCommand({ cwdForTest: cwd });
    const out = output();
    expect(out).toContain('SKIP');
    expect(out).not.toContain('0.00');
    expect(out).not.toContain('DEGRADED');
  });

  it('renders n/a rather than 0% when there are no derive-class events', async () => {
    const { mintQbdCorrelationId } = await import('@mmnto/totem');
    const content = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'corpus_query',
      activity_name: 'totem_search',
      source: 'lint',
      justification: '',
      qbd_correlation_id: mintQbdCorrelationId(T0),
      session_id: sid(1),
    });

    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });
    expect(output()).toContain('n/a (0 derive-class events)');
  });
});
