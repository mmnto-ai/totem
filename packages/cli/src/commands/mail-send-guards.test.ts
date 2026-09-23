/**
 * Send-side guards for `totem mail send` / `mail reply` and the `mail verify`
 * verb — four cohort datums on one seam:
 *
 * - mmnto-ai/totem#2930: the outbox root resolves to the hosting repository
 *   (walk-up), never the shell's cwd; a marker-less start is refused.
 * - mmnto-ai/totem#2887: an empty or whitespace-only body is refused at send;
 *   the listing flags a served frontmatter-only dispatch; `mail verify`.
 * - mmnto-ai/totem#2889: a `--slug` that begins with the recipient token is
 *   stripped of it, with a warning.
 * - mmnto-ai/totem#2929: a derived reply basename leads its topic with the
 *   sender token, so N seats replying to one kit never share a basename.
 *
 * Every fixture is a marker-bearing `<tmp>/workspace/<repo>/.totem/` tree:
 * the send now walks UP to the nearest marker (the same resolver the poll and
 * `mail mark` use), so a bare directory under the OS temp dir would resolve to
 * whatever host-level marker sits above it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findTotemRepoRootSync } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  formatTextResult,
  mailReply,
  mailSend,
  mailVerifyCommand,
  pollMail,
  verifyDispatch,
} from './mail.js';

let tmpRoot: string;
let workspace: string;

const fixedClock = (): Date => new Date('2026-09-23T01:52:41.106Z');
const STAMP = '2026-09-23T0152Z';

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** A marker-bearing repo root at `<workspace>/<basename>` (what `totem init` leaves). */
function repoRoot(basename = 'totem'): string {
  const root = mkDir(path.join(workspace, basename));
  mkDir(path.join(root, '.totem'));
  return root;
}

interface Dispatch {
  to: string;
  subject: string;
  /** Omit for a frontmatter-only file (nothing after the closing delimiter). */
  body?: string;
}

/** Write one ADR-098 dispatch into `<repo>/.totem/orchestration/<sender>/outbox/<name>`. */
function writeDispatch(repo: string, sender: string, name: string, d: Dispatch): string {
  const outbox = mkDir(path.join(repoRoot(repo), '.totem', 'orchestration', sender, 'outbox'));
  const lines = [
    '---',
    'schema: adr-098-v0.4',
    `from: ${sender}`,
    `to: ${d.to}`,
    'timestamp: 2026-09-23T01:00:00.000Z',
    `subject: ${d.subject}`,
    'expected-action: none',
    '---',
    '',
  ];
  if (d.body !== undefined) lines.push(d.body, '');
  const file = path.join(outbox, name);
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  return file;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mail-guards-'));
  workspace = mkDir(path.join(tmpRoot, 'workspace'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

const SEND = {
  to: 'strategy-claude',
  subject: 'lane handoff',
  from: 'totem-claude',
  body: 'the body',
  env: {},
  now: fixedClock,
  knownAgents: ['strategy-claude', 'totem-claude', 'totem-gemini'],
} as const;

// ─── mmnto-ai/totem#2930: the outbox root is the hosting repository ───

describe('mailSend — outbox root resolves to the hosting repository (mmnto-ai/totem#2930)', () => {
  it('a send from <repo>/tools/ lands in <repo>/.totem/orchestration/<seat>/outbox/, where the poll reads it, and mints nothing under tools/', () => {
    const root = repoRoot();
    const tools = mkDir(path.join(root, 'tools'));
    const res = mailSend({ ...SEND, repoRoot: tools });
    expect(res.filePath).toBe(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox', res.fileName),
    );
    expect(fs.existsSync(path.join(tools, '.totem'))).toBe(false);

    const inbox = pollMail({
      repoRoot: repoRoot('totem-strategy'),
      workspace,
      env: { TOTEM_SELF_AGENT: 'strategy-claude' },
    });
    expect(inbox.mail.map((m) => m.file)).toContain(res.fileName);
  });

  it('a reply from a subdirectory lands the reply AND the consume-mark in the real repo root', () => {
    const src = writeDispatch('totem-strategy', 'strategy-claude', `${STAMP}-totem-claude-ask.md`, {
      to: 'totem-claude',
      subject: 'an ask',
      body: 'please',
    });
    const root = repoRoot();
    const deep = mkDir(path.join(root, 'packages', 'cli'));
    const res = mailReply(src, {
      from: 'totem-claude',
      body: 'done',
      repoRoot: deep,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(path.dirname(res.filePath)).toBe(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    expect(res.mark?.markPath).toBe(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'processed', path.basename(src)),
    );
    expect(fs.existsSync(path.join(deep, '.totem'))).toBe(false);
  });

  // The refusal needs a start with NO marker at or above it. On a host whose
  // temp dir sits under a `.totem`/`.git` (this walker has no ceiling), the
  // fixture cannot be built, so the case is skipped LOUDLY rather than passed
  // vacuously; CI runners carry no such marker.
  const hostMarkerAboveTmp = findTotemRepoRootSync(os.tmpdir());
  it.skipIf(hostMarkerAboveTmp !== null)(
    'a start with no marker at or above it is refused, naming the directory, and mints nothing',
    () => {
      const nowhere = mkDir(path.join(tmpRoot, 'nowhere', 'deeper'));
      expect(() => mailSend({ ...SEND, repoRoot: nowhere })).toThrow(
        /not inside a totem repository: no \.totem\/ or \.git\/ marker at or above .*deeper/,
      );
      expect(fs.existsSync(path.join(nowhere, '.totem'))).toBe(false);
      expect(fs.existsSync(path.join(tmpRoot, 'nowhere', '.totem'))).toBe(false);
    },
  );
});

// ─── mmnto-ai/totem#2887: empty bodies ───

describe('mailSend — an empty body is refused at send (mmnto-ai/totem#2887)', () => {
  it('refuses a whitespace-only body, naming the source and its byte count; nothing is written', () => {
    const root = repoRoot();
    expect(() => mailSend({ ...SEND, body: ' \n\t', repoRoot: root })).toThrow(
      /dispatch body is empty \(the body argument: 3 bytes\) — nothing was written/,
    );
    expect(fs.existsSync(path.join(root, '.totem', 'orchestration'))).toBe(false);
  });

  it('refuses a whitespace-only --body-file the same way, naming the file', () => {
    const root = repoRoot();
    const bodyFile = path.join(tmpRoot, 'empty-deposit.md');
    fs.writeFileSync(bodyFile, '\n\n', 'utf-8');
    expect(() => mailSend({ ...SEND, body: undefined, bodyFile, repoRoot: root })).toThrow(
      /dispatch body is empty \(--body-file .*empty-deposit\.md: 2 bytes\)/,
    );
  });

  it('refuses a send with no body source at all (the old frontmatter-only dispatch)', () => {
    expect(() => mailSend({ ...SEND, body: undefined, repoRoot: repoRoot() })).toThrow(
      /dispatch body is empty \(the body argument: 0 bytes\)/,
    );
  });

  it('the listing flags a served frontmatter-only dispatch beside its subject, and --json carries bodyEmpty', () => {
    writeDispatch('totem-strategy', 'strategy-claude', `${STAMP}-totem-claude-empty.md`, {
      to: 'totem-claude',
      subject: 'DEPOSIT: S3 smell-read r2',
    });
    writeDispatch('totem-strategy', 'strategy-claude', `${STAMP}-totem-claude-full.md`, {
      to: 'totem-claude',
      subject: 'a full one',
      body: 'text',
    });
    const result = pollMail({
      repoRoot: repoRoot(),
      workspace,
      env: { TOTEM_SELF_AGENT: 'totem-claude' },
    });
    const byFile = new Map(result.mail.map((m) => [m.file, m]));
    expect(byFile.get(`${STAMP}-totem-claude-empty.md`)?.bodyEmpty).toBe(true);
    expect(byFile.get(`${STAMP}-totem-claude-full.md`)?.bodyEmpty).toBe(false);

    const text = formatTextResult(result);
    const lines = text.split('\n');
    const emptyIdx = lines.findIndex((l) => l.includes(`${STAMP}-totem-claude-empty.md`));
    expect(emptyIdx).toBeGreaterThan(-1);
    // The warning sits in the item's own block: after its read: line, before the next item.
    const block = lines.slice(emptyIdx, emptyIdx + 5).join('\n');
    expect(block).toMatch(
      /warning: body is EMPTY \(frontmatter only\).*ask strategy-claude to resend/,
    );
    const fullIdx = lines.findIndex((l) => l.includes(`${STAMP}-totem-claude-full.md`));
    expect(lines.slice(fullIdx, fullIdx + 4).join('\n')).not.toContain('body is EMPTY');
  });
});

// ─── mmnto-ai/totem#2889: recipient-prefixed slugs ───

describe('mailSend — a --slug that begins with the recipient token is stripped (mmnto-ai/totem#2889)', () => {
  it('strips the leading recipient token, composes <stamp>-<to>-<rest>.md, and says what it stripped', () => {
    const res = mailSend({ ...SEND, slug: 'strategy-claude-2-7-0-receipt', repoRoot: repoRoot() });
    expect(res.fileName).toBe(`${STAMP}-strategy-claude-2-7-0-receipt.md`);
    expect(
      res.warnings.some((w) => w.includes('began with the recipient token "strategy-claude"')),
    ).toBe(true);
  });

  it('a slug equal to the recipient token falls back to the subject-derived slug', () => {
    const res = mailSend({ ...SEND, slug: 'strategy-claude', repoRoot: repoRoot() });
    expect(res.fileName).toBe(`${STAMP}-strategy-claude-lane-handoff.md`);
    expect(res.warnings.some((w) => w.includes('(subject-derived)'))).toBe(true);
  });

  it('a slug that merely contains the recipient token later is untouched', () => {
    const res = mailSend({ ...SEND, slug: 'receipt-for-strategy-claude', repoRoot: repoRoot() });
    expect(res.fileName).toBe(`${STAMP}-strategy-claude-receipt-for-strategy-claude.md`);
    expect(res.warnings.some((w) => w.includes('recipient token'))).toBe(false);
  });
});

// ─── mmnto-ai/totem#2929: the sender token leads a derived reply basename ───

describe('mailReply — the sender token leads the derived basename (mmnto-ai/totem#2929)', () => {
  const KIT = `${STAMP}-broadcast-blind-round-s3.md`;

  it('two seats replying to one kit in the same minute get distinct basenames, and the collision sensor stays silent', () => {
    const kit = writeDispatch('totem-strategy', 'strategy-claude', KIT, {
      to: 'broadcast',
      subject: 'BLIND round: S3 smell-read r2 — deposit to strategy-claude by 2026-09-23T06:00Z',
      body: 'the kit',
    });
    const root = repoRoot();
    const a = mailReply(kit, {
      from: 'totem-claude',
      body: 'deposit A',
      repoRoot: root,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    const b = mailReply(kit, {
      from: 'totem-gemini',
      body: 'deposit B',
      repoRoot: root,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(a.fileName).toMatch(/^2026-09-23T0152Z-strategy-claude-totem-claude-re-blind-round-/);
    expect(b.fileName).toMatch(/^2026-09-23T0152Z-strategy-claude-totem-gemini-re-blind-round-/);
    expect(a.fileName).not.toBe(b.fileName);

    // The recipient's poll lists both and raises no cross-sender basename
    // collision (the mmnto-ai/totem#2311 sensor) — the class this closes.
    const inbox = pollMail({
      repoRoot: repoRoot('totem-strategy'),
      workspace,
      env: { TOTEM_SELF_AGENT: 'strategy-claude' },
    });
    expect(inbox.mail.map((m) => m.file).sort()).toEqual([a.fileName, b.fileName].sort());
    expect(inbox.warnings.some((w) => w.includes('converge'))).toBe(false);
  });

  it('an explicit --slug on reply is used verbatim, with no sender token added', () => {
    const kit = writeDispatch('totem-strategy', 'strategy-claude', KIT, {
      to: 'broadcast',
      subject: 'BLIND round: S3 smell-read r2',
      body: 'the kit',
    });
    const res = mailReply(kit, {
      from: 'totem-claude',
      body: 'deposit',
      slug: 'tc-s3-r2-deposit',
      repoRoot: repoRoot(),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(res.fileName).toBe(`${STAMP}-strategy-claude-tc-s3-r2-deposit.md`);
  });

  it('a plain send does not gain the sender token (send basenames are unchanged)', () => {
    const res = mailSend({ ...SEND, repoRoot: repoRoot() });
    expect(res.fileName).toBe(`${STAMP}-strategy-claude-lane-handoff.md`);
  });
});

// ─── mmnto-ai/totem#2887 ask 3: mail verify ───

describe('verifyDispatch — one dispatch, written and routable (mmnto-ai/totem#2887, ask 3)', () => {
  it('a dispatch the send wrote passes all four checks, and the send result carries the same verdict', () => {
    const res = mailSend({ ...SEND, repoRoot: repoRoot() });
    expect(res.verify?.ok).toBe(true);
    const v = verifyDispatch(res.filePath, { knownAgents: ['strategy-claude'] });
    expect(v.ok).toBe(true);
    expect(v.findings).toEqual([]);
    expect(v.checks.parse).toMatch(/^parse: ok/);
    expect(v.checks.recipient).toBe('recipient: ok (to: strategy-claude)');
    expect(v.checks.body).toBe('body: ok (non-empty)');
    expect(v.checks.placement).toBe(
      `placement: ok (.totem/orchestration/totem-claude/outbox/${res.fileName})`,
    );
  });

  it('a frontmatter-only file fails the body check and nothing else', () => {
    const file = writeDispatch('totem', 'totem-claude', `${STAMP}-strategy-claude-empty.md`, {
      to: 'strategy-claude',
      subject: 'empty',
    });
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.ok).toBe(false);
    expect(v.findings).toEqual([
      'body: FAIL — empty (frontmatter only); nothing for the recipient to act on',
    ]);
  });

  it('an unknown recipient fails the recipient check; broadcast passes it', () => {
    const bad = writeDispatch('totem', 'totem-claude', `${STAMP}-nobody-x.md`, {
      to: 'nobody-at-all',
      subject: 'x',
      body: 'b',
    });
    const v = verifyDispatch(bad, { knownAgents: ['strategy-claude'] });
    expect(v.findings).toEqual([
      'recipient: FAIL — to: "nobody-at-all" is neither broadcast nor a roster seat (one recipient per dispatch)',
    ]);
    const bcast = writeDispatch('totem', 'totem-claude', `${STAMP}-broadcast-y.md`, {
      to: 'broadcast',
      subject: 'y',
      body: 'b',
    });
    expect(verifyDispatch(bcast, { knownAgents: [] }).ok).toBe(true);
  });

  it('a file outside outbox depth 1 fails placement (no poll scans it)', () => {
    const root = repoRoot();
    const nested = mkDir(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox', 'drafts'),
    );
    const file = path.join(nested, `${STAMP}-strategy-claude-draft.md`);
    fs.writeFileSync(
      file,
      '---\nfrom: totem-claude\nto: strategy-claude\nsubject: draft\n---\n\nbody\n',
      'utf-8',
    );
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.ok).toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toMatch(
      /^placement: FAIL — not at \.totem\/orchestration\/<seat>\/outbox\/<file>/,
    );
  });

  it('a file that does not parse fails parse and leaves recipient and body unchecked', () => {
    const outbox = mkDir(
      path.join(repoRoot(), '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    const file = path.join(outbox, `${STAMP}-strategy-claude-stray.md`);
    fs.writeFileSync(file, 'not a dispatch\n', 'utf-8');
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.ok).toBe(false);
    expect(v.checks.parse).toMatch(/^parse: FAIL/);
    expect(v.checks.recipient).toMatch(/not checked/);
    expect(v.checks.body).toMatch(/not checked/);
  });

  it('an unreadable path is a hard error, never a silent "not verified"', () => {
    expect(() => verifyDispatch(path.join(tmpRoot, 'no-such-dispatch.md'))).toThrow(
      /cannot read the dispatch to verify/,
    );
  });

  it('mail verify --json emits the structured result on stdout and the exit still follows the verdict', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      const good = mailSend({ ...SEND, repoRoot: repoRoot() });
      const okResult = verifyDispatch(good.filePath, { knownAgents: ['strategy-claude'] });
      await expect(mailVerifyCommand(okResult, { json: true })).resolves.toBe(okResult);
      expect(JSON.parse(written[0] ?? '')).toMatchObject({ ok: true, findings: [] });

      const empty = writeDispatch('totem', 'totem-claude', `${STAMP}-strategy-claude-e.md`, {
        to: 'strategy-claude',
        subject: 'e',
      });
      const badResult = verifyDispatch(empty, { knownAgents: ['strategy-claude'] });
      await expect(mailVerifyCommand(badResult, { json: true })).rejects.toThrow(
        /not routable as written/,
      );
      expect(JSON.parse(written[1] ?? '')).toMatchObject({ ok: false });
      expect((JSON.parse(written[1] ?? '') as { findings: string[] }).findings).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
