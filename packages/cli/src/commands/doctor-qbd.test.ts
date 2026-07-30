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

let cwd: string;
let lines: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-cli-'));
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

  it('a broken scan never renders like a clean 0%', async () => {
    // The defect class ADR-115 § 2 names: degraded state that is
    // indistinguishable from verified state. A bare "0.00" with no envelope
    // would be exactly that.
    const content = ['{ torn', '{ also torn'].join('\n');
    await doctorQbdComplianceCommand({ cwdForTest: cwd, ledgerContentForTest: content });

    const out = output();
    expect(out).toContain('DEGRADED');
    expect(out).toContain('2 malformed JSON line(s)');
    // No clean number is presented.
    expect(out).not.toMatch(/compliance: \d/);
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
