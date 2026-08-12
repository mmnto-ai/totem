/**
 * Induced lifecycle CHAIN tests (mmnto-ai/totem#2511, fold — falsification
 * finding 3): the REAL seat verbs chained into the REAL `pollMail`, so the
 * verb→poll coupling is exercised end-to-end rather than each half against
 * hand-written fixtures. The charter's fixture-ts-HOSTED induced run cannot
 * execute in this repo's CI (the fixture repo is not vendored); this in-repo
 * chain carries the same assertions — add → poll visibility · suspend →
 * denominator exclusion measured through the poll · remove → retired with
 * retention intact — and the manual built-CLI receipt against a fixture-ts
 * copy is recorded on the PR.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pollMail } from './mail.js';
import { seatAddCommand, seatRemoveCommand, seatSuspendCommand } from './seat.js';

const NOW = '2026-08-11T09:00:00.000Z';
const SEAT_A = 'chain-claude';
const SEAT_B = 'chain-kimi';
const ENV = { TOTEM_SELF_AGENT: `${SEAT_A},${SEAT_B}` };
const BCAST = '2026-08-11T0930Z-broadcast-chain-note.md';
const DIRECTED = '2026-08-11T0931Z-chain-kimi-task.md';

let workspace = '';
let repo = '';
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chain-')));
  repo = path.join(workspace, 'totem');
  fs.mkdirSync(path.join(repo, '.totem', 'orchestration'), { recursive: true });
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  fs.rmSync(workspace, { recursive: true, force: true });
});

function writePeerOutbox(name: string, to: string): void {
  const outbox = path.join(
    workspace,
    'totem-strategy',
    '.totem',
    'orchestration',
    'strategy-claude',
    'outbox',
  );
  fs.mkdirSync(outbox, { recursive: true });
  fs.writeFileSync(
    path.join(outbox, name),
    `---\nfrom: strategy-claude\nto: ${to}\ndate: 2026-08-11T0930Z\nsubject: chain\n---\nbody\n`,
    'utf-8',
  );
}

function writeBroadcastMark(seat: string, name: string): void {
  const dir = path.join(repo, '.totem', 'orchestration', seat, 'processed', '_broadcast');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '---\nto: broadcast\n---\n', 'utf-8');
}

function poll(): ReturnType<typeof pollMail> {
  return pollMail({ repoRoot: repo, workspace, env: ENV });
}

describe('seat verbs chained into pollMail (mmnto-ai/totem#2511 induced chain)', () => {
  it('add → poll visibility: a verb-created seat receives directed and broadcast mail', async () => {
    await seatAddCommand(SEAT_A, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    await seatAddCommand(SEAT_B, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    writePeerOutbox(DIRECTED, SEAT_B);
    writePeerOutbox(BCAST, 'broadcast');

    const result = poll();
    expect(result.mail.map((m) => m.file).sort()).toEqual([BCAST, DIRECTED].sort());
    expect(result.warnings).toEqual([]);
    expect(result.notices).toEqual([]);
  });

  it('suspend → denominator exclusion measured THROUGH the poll: the active seat’s mark alone closes the broadcast; the held directed mail surfaces with the notice', async () => {
    await seatAddCommand(SEAT_A, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    await seatAddCommand(SEAT_B, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    writePeerOutbox(DIRECTED, SEAT_B);
    writePeerOutbox(BCAST, 'broadcast');
    // Positive control BEFORE the transition: with both seats active, one mark
    // does NOT close the broadcast (required = 2) — so the closure below is a
    // measured consequence of the verb, not of the fixture.
    writeBroadcastMark(SEAT_A, BCAST);
    expect(poll().mail.map((m) => m.file)).toContain(BCAST);

    await seatSuspendCommand(SEAT_B, {
      cwdForTest: repo,
      envForTest: {},
      nowForTest: NOW,
      reason: 'chain drill',
    });

    const after = poll();
    // Broadcast: required dropped to the ONE active seat, whose mark exists.
    expect(after.mail.map((m) => m.file)).toEqual([DIRECTED]);
    // Held directed mail surfaces, annotated on the non-gating channel.
    expect(after.warnings).toEqual([]);
    expect(after.notices.some((n) => n.includes('suspended seat'))).toBe(true);
  });

  it('remove → retired with retention intact: dirs, outbox marks, and held mail all survive; the poll names the retired addressee', async () => {
    await seatAddCommand(SEAT_A, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    await seatAddCommand(SEAT_B, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });
    writePeerOutbox(DIRECTED, SEAT_B);
    writeBroadcastMark(SEAT_B, BCAST);

    await seatRemoveCommand(SEAT_B, { cwdForTest: repo, envForTest: {}, nowForTest: NOW });

    const marker = JSON.parse(
      fs.readFileSync(
        path.join(repo, '.totem', 'orchestration', SEAT_B, 'lifecycle.json'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(marker['state']).toBe('retired');
    // Retention: the seat's dirs and marks are untouched by the verb.
    expect(
      fs.existsSync(path.join(repo, '.totem', 'orchestration', SEAT_B, 'processed', '_broadcast')),
    ).toBe(true);
    expect(fs.existsSync(path.join(repo, '.totem', 'orchestration', SEAT_B, 'outbox'))).toBe(true);

    const after = poll();
    // Held mail still surfaces (obligation held), named as retired-addressed.
    expect(after.mail.map((m) => m.file)).toEqual([DIRECTED]);
    expect(after.notices.some((n) => n.includes('addressed to retired seat'))).toBe(true);
    expect(after.warnings).toEqual([]);
  });
});
