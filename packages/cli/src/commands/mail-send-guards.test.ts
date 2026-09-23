/**
 * Send-side guards for `totem mail send` / `mail reply` and the `mail verify`
 * verb — four cohort datums on one seam:
 *
 * - mmnto-ai/totem#2930: the outbox root is the repository TOPLEVEL (the
 *   nearest `.git`-bearing ancestor) that carries `.totem/` and hosts the
 *   sending seat, never the shell's cwd and never a stray `.totem/` under a
 *   subdirectory; anything else is refused.
 * - mmnto-ai/totem#2887: an empty or whitespace-only body is refused at send;
 *   the listing flags a served frontmatter-only dispatch; `mail verify`.
 * - mmnto-ai/totem#2889: a `--slug` that begins with the recipient token is
 *   stripped of it, with a warning.
 * - mmnto-ai/totem#2929: a derived reply basename leads its topic with the
 *   sender token, so N seats replying to one kit never share a basename.
 *
 * Every sender fixture is a `<tmp>/workspace/<repo>/` tree with `.git`,
 * `.totem/` and the registered seat directories: the send resolves on `.git`,
 * so a bare directory under the OS temp dir resolves to nothing (refused) and
 * a `.totem` above the temp dir (this build host has an empty one) is inert.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemError } from '@mmnto/totem';

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

/**
 * A repository root at `<workspace>/<basename>`: `.git` (the toplevel the send
 * resolves to), `.totem/` (what `totem init` leaves) and the seat directories
 * `totem seat add` registers — the send refuses to mint a seat
 * (mmnto-ai/totem#2930).
 */
function repoRoot(
  basename = 'totem',
  seats: readonly string[] = ['totem-claude', 'totem-gemini'],
): string {
  const root = mkDir(path.join(workspace, basename));
  mkDir(path.join(root, '.git'));
  mkDir(path.join(root, '.totem'));
  for (const seat of seats) mkDir(path.join(root, '.totem', 'orchestration', seat));
  return root;
}

/** The nearest `.git`-bearing ancestor of `dir`, or null — the send's own rule. */
function gitAbove(dir: string): string | null {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
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

  it("a stray .totem/ in a subdirectory (a tool's temp state) is never the root: the send lands at the git toplevel (leg F1)", () => {
    const root = repoRoot();
    mkDir(path.join(root, 'packages', 'cli', '.totem', 'temp'));
    const start = mkDir(path.join(root, 'packages', 'cli', 'src'));
    const res = mailSend({ ...SEND, repoRoot: start });
    expect(path.dirname(res.filePath)).toBe(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    expect(fs.existsSync(path.join(root, 'packages', 'cli', '.totem', 'orchestration'))).toBe(
      false,
    );
    expect(res.verify?.ok).toBe(true);
  });

  it("a phantom outbox under a subdirectory (the old bug's residue, hosting the seat) is skipped for the git toplevel and gains no file", () => {
    const root = repoRoot();
    const phantom = mkDir(
      path.join(root, 'apps', 'game', '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    const start = mkDir(path.join(root, 'apps', 'game', 'src'));
    const res = mailSend({ ...SEND, repoRoot: start });
    expect(path.dirname(res.filePath)).toBe(
      path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    expect(fs.readdirSync(phantom)).toEqual([]);
  });

  it('with TOTEM_WORKSPACE set, a resident-shaped clone outside the workspace, or nested inside a resident, is refused: no poll of that workspace enumerates it (third leg F1)', () => {
    const env = { TOTEM_WORKSPACE: workspace };
    const elsewhere = mkDir(path.join(tmpRoot, 'elsewhere', 'clone'));
    mkDir(path.join(elsewhere, '.git'));
    mkDir(path.join(elsewhere, '.totem', 'orchestration', 'totem-claude'));
    expect(() => mailSend({ ...SEND, env, repoRoot: elsewhere })).toThrow(
      /clone is not a direct child of the workspace TOTEM_WORKSPACE names/,
    );
    const nested = mkDir(path.join(repoRoot(), 'vendor', 'inner'));
    mkDir(path.join(nested, '.git'));
    mkDir(path.join(nested, '.totem', 'orchestration', 'totem-claude'));
    expect(() => mailSend({ ...SEND, env, repoRoot: path.join(nested, 'src') })).toThrow(
      /inner is not a direct child of the workspace/,
    );
    expect(
      fs.existsSync(path.join(nested, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    ).toBe(false);
    // A resident that IS a workspace child passes the same pin.
    expect(mailSend({ ...SEND, env, repoRoot: repoRoot('totem-b') }).verify?.ok).toBe(true);
  });

  it('without a workspace pin, a resident-shaped clone elsewhere is ACCEPTED: the residual the send cannot decide locally (disclosed, not certified as clean)', () => {
    const elsewhere = mkDir(path.join(tmpRoot, 'elsewhere', 'clone'));
    mkDir(path.join(elsewhere, '.git'));
    mkDir(path.join(elsewhere, '.totem', 'orchestration', 'totem-claude'));
    const res = mailSend({ ...SEND, repoRoot: elsewhere });
    expect(path.dirname(res.filePath)).toBe(
      path.join(elsewhere, '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    // Its parent is its workspace by definition; a poll of THIS fixture's
    // workspace never lists it. That gap closes only with the pin above.
    const inbox = pollMail({
      repoRoot: repoRoot('totem-strategy'),
      workspace,
      env: { TOTEM_SELF_AGENT: 'strategy-claude' },
    });
    expect(inbox.mail.map((m) => m.file)).not.toContain(res.fileName);
  });

  it('a resident whose .totem/ is a junction or symlink is refused: the reader follows no link (third leg F3)', () => {
    const real = mkDir(path.join(tmpRoot, 'realtotem', 'orchestration', 'totem-claude'));
    const repo = mkDir(path.join(workspace, 'symrepo'));
    mkDir(path.join(repo, '.git'));
    fs.symlinkSync(path.dirname(path.dirname(real)), path.join(repo, '.totem'), 'junction');
    expect(() => mailSend({ ...SEND, repoRoot: repo })).toThrow(
      /carries no real \.totem\/ directory \(absent, or a link the reader never follows\)/,
    );
  });

  it('a git repository with no .totem/ is refused: nothing is minted there', () => {
    const plain = mkDir(path.join(workspace, 'plain-git'));
    mkDir(path.join(plain, '.git'));
    expect(() => mailSend({ ...SEND, repoRoot: plain })).toThrow(
      /not a totem repository: .*plain-git .*carries no real \.totem\/ directory/,
    );
    expect(fs.existsSync(path.join(plain, '.totem'))).toBe(false);
  });

  it("a worktree (a .git FILE) is never a seat's host, even with a seat directory registered there: refused, naming the resident checkout (re-arm F1)", () => {
    const main = repoRoot();
    const wt = mkDir(path.join(workspace, 'worktrees', 'wt1'));
    fs.writeFileSync(
      path.join(wt, '.git'),
      `gitdir: ${path.join(main, '.git', 'worktrees', 'wt1')}\n`,
      'utf-8',
    );
    mkDir(path.join(wt, '.totem', 'orchestration', 'totem-claude'));
    let caught: unknown;
    try {
      mailSend({ ...SEND, repoRoot: path.join(wt, 'packages') });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TotemError);
    expect((caught as Error).message).toMatch(
      /wt1: its \.git is a file \(a worktree's or a submodule's pointer at .*totem\), never a seat's host/,
    );
    expect((caught as { recoveryHint?: string }).recoveryHint).toContain(
      `resident checkout at ${main}`,
    );
    expect(fs.existsSync(path.join(wt, '.totem', 'orchestration', 'totem-claude', 'outbox'))).toBe(
      false,
    );
  });

  it('a resident checkout that has not registered the sending seat is refused, naming the seat and the cure', () => {
    const wt = repoRoot('totem-wt', []);
    let caught: unknown;
    try {
      mailSend({ ...SEND, repoRoot: wt });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TotemError);
    expect((caught as Error).message).toMatch(
      /does not host seat "totem-claude": no \.totem\/orchestration\/totem-claude\/ there/,
    );
    // The cure rides the recovery hint, the line the CLI boundary prints as `Fix:`.
    expect((caught as { recoveryHint?: string }).recoveryHint).toContain(
      'totem seat add totem-claude',
    );
    expect(fs.existsSync(path.join(wt, '.totem', 'orchestration', 'totem-claude'))).toBe(false);
  });

  // The refusal needs a start with NO `.git` at or above it. On a host whose
  // temp dir sits inside a git repository the fixture cannot be built, so the
  // case is skipped LOUDLY rather than passed vacuously; CI runners' temp dirs
  // carry none. A `.totem` above the temp dir (this build host has an empty
  // one directly under %TEMP%) no longer matters: the send resolves on `.git`.
  const gitAboveTmp = gitAbove(os.tmpdir());
  it.skipIf(gitAboveTmp !== null)(
    'a start with no .git at or above it is refused, naming the directory, and mints nothing',
    () => {
      const nowhere = mkDir(path.join(tmpRoot, 'nowhere', 'deeper'));
      expect(() => mailSend({ ...SEND, repoRoot: nowhere })).toThrow(
        /not inside a repository: no \.git at or above .*deeper/,
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
    expect(
      fs.existsSync(path.join(root, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    ).toBe(false);
  });

  it('the subject-only class ADR-106 tolerates (the mmnto-ai/totem#2118 shape) reads bodyEmpty: true, and the line does not claim a transport drop', () => {
    writeDispatch('totem-strategy', 'strategy-claude', `${STAMP}-totem-claude-subject-only.md`, {
      to: 'totem-claude',
      subject: `[${'W'.repeat(2500)}]`,
    });
    const result = pollMail({
      repoRoot: repoRoot(),
      workspace,
      env: { TOTEM_SELF_AGENT: 'totem-claude' },
    });
    const entry = result.mail.find((m) => m.file === `${STAMP}-totem-claude-subject-only.md`);
    expect(entry?.bodyEmpty).toBe(true);
    const text = formatTextResult(result);
    expect(text).toContain('unless the subject carries the whole message');
    expect(text).not.toContain('did not land');
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

  it('compares the SLUGIFIED forms: a spaced or underscored recipient prefix is stripped too (leg F3)', () => {
    const a = mailSend({ ...SEND, slug: 'Strategy Claude review', repoRoot: repoRoot() });
    expect(a.fileName).toBe(`${STAMP}-strategy-claude-review.md`);
    expect(a.warnings.some((w) => w.includes('began with the recipient token'))).toBe(true);
    const b = mailSend({ ...SEND, slug: 'strategy_claude-review', repoRoot: repoRoot('totem-b') });
    expect(b.fileName).toBe(`${STAMP}-strategy-claude-review.md`);
    expect(b.warnings.some((w) => w.includes('began with the recipient token'))).toBe(true);
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

  it("a blank --slug on reply is no slug: the sender token still leads (leg F7's nit)", () => {
    const kit = writeDispatch('totem-strategy', 'strategy-claude', KIT, {
      to: 'broadcast',
      subject: 'BLIND round: S3 smell-read r2',
      body: 'the kit',
    });
    const res = mailReply(kit, {
      from: 'totem-claude',
      body: 'deposit',
      slug: '   ',
      repoRoot: repoRoot(),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(res.fileName).toMatch(/^2026-09-23T0152Z-strategy-claude-totem-claude-re-blind-round-/);
  });

  it('two seats replying with --slug <recipient> (stripped to nothing) still get distinct basenames: the token applies to a slug that is no slug (re-arm F2)', () => {
    const kit = writeDispatch('totem-strategy', 'strategy-claude', KIT, {
      to: 'broadcast',
      subject: 'kit round',
      body: 'the kit',
    });
    const root = repoRoot();
    const reply = (from: string) =>
      mailReply(kit, {
        from,
        body: `deposit ${from}`,
        slug: 'strategy-claude',
        repoRoot: root,
        env: {},
        now: fixedClock,
        knownAgents: ['strategy-claude'],
      });
    const a = reply('totem-claude');
    const b = reply('totem-gemini');
    expect(a.fileName).toBe(`${STAMP}-strategy-claude-totem-claude-re-kit-round.md`);
    expect(b.fileName).toBe(`${STAMP}-strategy-claude-totem-gemini-re-kit-round.md`);
    expect(a.warnings.some((w) => w.includes('began with the recipient token'))).toBe(true);
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

  it("the roster derives from the FILE's repository, never the cwd: a seat registered only in the fixture workspace resolves (leg F4)", () => {
    const file = writeDispatch('totem', 'totem-claude', `${STAMP}-fixture-seat-hello.md`, {
      to: 'fixture-seat',
      subject: 'hello',
      body: 'b',
    });
    mkDir(path.join(workspace, 'fixture-repo', '.totem', 'orchestration', 'fixture-seat'));
    const v = verifyDispatch(file, { env: {} });
    expect(v.checks.recipient).toBe('recipient: ok (to: fixture-seat)');
  });

  it('a dispatch under a .totem/ whose parent carries no .git fails placement: the phantom the send refuses (leg F1)', () => {
    const root = repoRoot();
    const phantomOutbox = mkDir(
      path.join(root, 'packages', 'cli', '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    const file = path.join(phantomOutbox, `${STAMP}-strategy-claude-lost.md`);
    fs.writeFileSync(
      file,
      '---\nfrom: totem-claude\nto: strategy-claude\nsubject: lost\n---\n\nbody\n',
      'utf-8',
    );
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.ok).toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toMatch(
      /^placement: FAIL — .*packages[\\/]cli is not a resident checkout \(no \.git directory there/,
    );
  });

  it('a dispatch inside a worktree (a .git FILE at the root) fails placement: no poll enumerates a worktree (re-arm F1)', () => {
    const main = repoRoot();
    const wt = mkDir(path.join(workspace, 'worktrees', 'wt2'));
    fs.writeFileSync(
      path.join(wt, '.git'),
      `gitdir: ${path.join(main, '.git', 'worktrees', 'wt2')}\n`,
      'utf-8',
    );
    const outbox = mkDir(path.join(wt, '.totem', 'orchestration', 'totem-claude', 'outbox'));
    const file = path.join(outbox, `${STAMP}-strategy-claude-wt.md`);
    fs.writeFileSync(
      file,
      '---\nfrom: totem-claude\nto: strategy-claude\nsubject: wt\n---\n\nbody\n',
      'utf-8',
    );
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.findings).toEqual([
      expect.stringMatching(/^placement: FAIL — .*wt2 is not a resident checkout/),
    ]);
  });

  it('findings keep the documented order (parse, recipient, body, placement) whatever order the checks ran in (re-arm F4)', () => {
    const root = repoRoot();
    const phantomOutbox = mkDir(
      path.join(root, 'packages', 'core', '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    const file = path.join(phantomOutbox, `${STAMP}-nobody-z.md`);
    fs.writeFileSync(
      file,
      '---\nfrom: totem-claude\nto: nobody-at-all\nsubject: z\n---\n',
      'utf-8',
    );
    const v = verifyDispatch(file, { knownAgents: ['strategy-claude'] });
    expect(v.findings.map((f) => f.split(':')[0])).toEqual(['recipient', 'body', 'placement']);
  });

  it('on a phantom the roster comes from the cwd resolution, not the phantom tree: a seat registered only in the cwd workspace resolves and only placement fails (re-arm F5, third leg F2)', () => {
    const root = repoRoot();
    // Registered ONLY under the cwd-resolved workspace, never under the
    // phantom's parent (`root/packages`), and absent from the static cohort
    // map — so a roster read from the phantom's tree cannot know it.
    mkDir(path.join(workspace, 'fixture-repo', '.totem', 'orchestration', 'fixture-seat'));
    const phantomOutbox = mkDir(
      path.join(root, 'packages', 'core', '.totem', 'orchestration', 'totem-claude', 'outbox'),
    );
    const file = path.join(phantomOutbox, `${STAMP}-fixture-seat-p.md`);
    fs.writeFileSync(
      file,
      '---\nfrom: totem-claude\nto: fixture-seat\nsubject: p\n---\n\nbody\n',
      'utf-8',
    );
    const v = verifyDispatch(file, { env: {}, repoRoot: root });
    expect(v.checks.recipient).toBe('recipient: ok (to: fixture-seat)');
    expect(v.findings.map((f) => f.split(':')[0])).toEqual(['placement']);
  });

  it('with a workspace named, placement fails for a dispatch in a resident-shaped clone that is not its direct child, and for a junctioned .totem/ (third leg F1, F3)', () => {
    const elsewhere = mkDir(path.join(tmpRoot, 'elsewhere', 'clone'));
    mkDir(path.join(elsewhere, '.git'));
    const outbox = mkDir(path.join(elsewhere, '.totem', 'orchestration', 'totem-claude', 'outbox'));
    const file = path.join(outbox, `${STAMP}-strategy-claude-far.md`);
    const text = '---\nfrom: totem-claude\nto: strategy-claude\nsubject: far\n---\n\nbody\n';
    fs.writeFileSync(file, text, 'utf-8');
    const far = verifyDispatch(file, { knownAgents: ['strategy-claude'], workspace });
    expect(far.findings).toEqual([
      expect.stringMatching(/^placement: FAIL — .*clone is not a direct child of the workspace/),
    ]);
    expect(verifyDispatch(file, { knownAgents: ['strategy-claude'], env: {} }).ok).toBe(true);

    const real = mkDir(path.join(tmpRoot, 'realtotem2', 'orchestration', 'totem-claude', 'outbox'));
    const repo = mkDir(path.join(workspace, 'symrepo2'));
    mkDir(path.join(repo, '.git'));
    fs.symlinkSync(
      path.dirname(path.dirname(path.dirname(real))),
      path.join(repo, '.totem'),
      'junction',
    );
    const linked = path.join(
      repo,
      '.totem',
      'orchestration',
      'totem-claude',
      'outbox',
      `${STAMP}-strategy-claude-link.md`,
    );
    fs.writeFileSync(linked, text, 'utf-8');
    const viaLink = verifyDispatch(linked, { knownAgents: ['strategy-claude'], env: {} });
    expect(viaLink.findings).toEqual([
      expect.stringMatching(/^placement: FAIL — .*is not a resident checkout/),
    ]);
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
