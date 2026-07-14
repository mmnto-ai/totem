/**
 * Tests for `totem mail` (mmnto-ai/totem#1970, ADR-106 § 3 / ADR-107).
 *
 * Filesystem-driven: every test builds a fresh `<tmp>/workspace/<repo>/.totem/orchestration/`
 * tree, exercises the poll, and asserts on the structured `MailPollResult`.
 * Skips the human-text formatter path except where the formatter's behavior
 * itself is under test — JSON output is the durable contract for hook
 * consumers, the text output is human-only.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findTotemRepoRootSync } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { log } from '../ui.js';
import {
  composeDispatch,
  type DispatchHeader,
  mailCommand,
  type MailPollResult,
  mailReply,
  mailSend,
  pollMail,
  resolveMailExitCode,
  resolveSelfSender,
  validateDispatchContent,
} from './mail.js';

// ─── Fixture helpers ────────────────────────────────────

let tmpRoot: string;
let workspace: string;

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

interface OutboxFile {
  /** Filename (e.g. `2026-05-18T1734Z-strategy-claude.md`). */
  name: string;
  /** Recipient agent-id (or `broadcast`). Written as frontmatter `to:`. */
  to: string;
  /** Optional `from:`. */
  from?: string;
  /** Optional `subject:`. */
  subject?: string;
  /** Optional ISO `date:`. */
  date?: string;
  /** Optional override of the entire file contents (skips frontmatter helper). */
  raw?: string;
}

/**
 * Build a sibling repo with `<repo>/.totem/orchestration/<senderAgent>/outbox/<file>.md`
 * entries. `senderAgent` is the agent-id directory name; recipient lives in
 * the frontmatter `to:` field.
 */
function writeOutbox(repo: string, senderAgent: string, files: OutboxFile[]): string {
  const outbox = path.join(workspace, repo, '.totem', 'orchestration', senderAgent, 'outbox');
  mkDir(outbox);
  for (const f of files) {
    const content =
      f.raw ??
      [
        '---',
        `from: ${f.from ?? senderAgent}`,
        `to: ${f.to}`,
        `date: ${f.date ?? '2026-05-18T1700Z'}`,
        `subject: ${f.subject ?? '(no subject)'}`,
        '---',
        '',
        'Body text.',
        '',
      ].join('\n');
    fs.writeFileSync(path.join(outbox, f.name), content, 'utf-8');
  }
  return outbox;
}

function writeProcessed(repo: string, recipientAgent: string, names: string[]): void {
  const dir = path.join(workspace, repo, '.totem', 'orchestration', recipientAgent, 'processed');
  mkDir(dir);
  for (const n of names) fs.writeFileSync(path.join(dir, n), '---\nto: x\n---\n', 'utf-8');
}

function writeBroadcastProcessed(repo: string, recipientAgent: string, names: string[]): void {
  const dir = path.join(
    workspace,
    repo,
    '.totem',
    'orchestration',
    recipientAgent,
    'processed',
    '_broadcast',
  );
  mkDir(dir);
  for (const n of names) fs.writeFileSync(path.join(dir, n), '---\nto: broadcast\n---\n', 'utf-8');
}

/**
 * `totem` is the only cohort name resolveSelfAgents pre-knows; using it as
 * the "self" repo keeps the SELF_AGENT resolution working off the basename
 * map without needing a config.json or env override for every test.
 */
function selfRepoRoot(): string {
  const root = mkDir(path.join(workspace, 'totem'));
  // A real repo root carries a `.totem` marker (`totem init`). Since mmnto-ai/totem#2312
  // the poll derives the repo root by walking UP to the nearest `.totem`/`.git`
  // marker, so the fixture must present one — else the walk climbs past this
  // marker-less dir to a host-level ancestor marker (e.g. `~/.totem`) and
  // self-resolution reads the wrong basename.
  mkDir(path.join(root, '.totem'));
  return root;
}

/**
 * Build a marker-bearing repo root at `<workspace>/<basename>` with no outbox of
 * its own (a recipient repo). Same rationale as `selfRepoRoot` — the #2312
 * walk-up needs a marker to anchor on.
 */
function markedRepoRoot(basename: string): string {
  const root = mkDir(path.join(workspace, basename));
  mkDir(path.join(root, '.totem'));
  return root;
}

/**
 * Build a frontmatter-only dispatch (zero blank lines) carrying the whole
 * message in an oversized `subject:` — the cohort adr-098 shape whose
 * silent drop is the mmnto-ai/totem#2118 regression class (observed live
 * at 2,110–4,163 bytes; the predecessor parser rejected anything > 2 KiB
 * without a blank-line separator).
 */
function frontmatterOnlyDispatch(subjectBytes: number, eol: '\n' | '\r\n' = '\n'): string {
  return [
    '---',
    'schema: adr-098-v0.4',
    'from: strategy-claude',
    'to: totem-claude',
    'date: 2026-06-07T2015Z',
    `subject: "[${'W'.repeat(subjectBytes)}]"`,
    'priority: normal',
    '---',
    '',
  ].join(eol);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mail-'));
  workspace = mkDir(path.join(tmpRoot, 'workspace'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

function poll(opts: Parameters<typeof pollMail>[0] = {}): MailPollResult {
  return pollMail({ repoRoot: selfRepoRoot(), workspace, env: {}, ...opts });
}

// ─── Basic filter behavior ──────────────────────────────

describe('pollMail — basic filter behavior', () => {
  it('returns no mail when workspace is empty', () => {
    const result = poll();
    expect(result.mail).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.workspace).toBe(path.resolve(workspace));
  });

  it('returns mail addressed to a SELF_AGENT', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z-strategy-claude.md', to: 'totem-claude', subject: 'lane' },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('totem-claude');
    expect(result.mail[0]!.from).toBe('strategy-claude');
    expect(result.mail[0]!.repo).toBe('totem-strategy');
    expect(result.mail[0]!.subject).toBe('lane');
  });

  it('returns mail addressed to broadcast', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z.md', to: 'broadcast', subject: 'cohort announcement' },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('broadcast');
  });

  it('skips mail addressed to a different agent', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1918Z.md', to: 'lc-claude', subject: 'not-mine' },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
  });

  it('matches `to:` case-insensitively (back-compat with arhgap11-Gemini)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z.md', to: 'Totem-Claude', subject: 'case test' },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('Totem-Claude');
  });

  it('returns mail from multiple sibling repos in one scan', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1700Z.md', to: 'totem-claude', subject: 'strategy reply' },
    ]);
    writeOutbox('liquid-city', 'lc-claude', [
      { name: '2026-05-18T1800Z.md', to: 'totem-claude', subject: 'lc heads-up' },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(2);
    const repos = result.mail.map((m) => m.repo).sort();
    expect(repos).toEqual(['liquid-city', 'totem-strategy']);
  });
});

// ─── Symlink guard (mmnto-ai/totem#2355) ────────────────

describe('pollMail — symlinked agent/outbox dirs are not traversed (mmnto-ai/totem#2355)', () => {
  /**
   * Portable directory symlink: 'junction' needs no elevation on Windows and
   * the type argument is ignored on POSIX (plain symlink). Junction targets
   * must be absolute — all fixture paths are tmpRoot-absolute.
   */
  function symlinkDir(target: string, linkPath: string): void {
    fs.symlinkSync(target, linkPath, 'junction');
  }

  function writeRogueMail(dir: string, name: string): void {
    fs.writeFileSync(
      path.join(dir, name),
      '---\nfrom: rogue-agent\nto: totem-claude\ndate: 2026-07-14T0000Z\nsubject: exfil\n---\n\nBody.\n',
      'utf-8',
    );
  }

  it('skips a symlinked agent dir during the outbox scan', () => {
    const outside = mkDir(path.join(tmpRoot, 'outside', 'rogue-agent', 'outbox'));
    writeRogueMail(outside, '2026-07-14T0000Z-rogue.md');
    const orchDir = mkDir(path.join(workspace, 'totem-strategy', '.totem', 'orchestration'));
    symlinkDir(path.join(tmpRoot, 'outside', 'rogue-agent'), path.join(orchDir, 'rogue-agent'));

    const result = poll();
    expect(result.mail).toEqual([]);
    expect(result.scanned).toBe(0);
  });

  it('skips a symlinked outbox dir under a real agent dir', () => {
    const loot = mkDir(path.join(tmpRoot, 'loot'));
    writeRogueMail(loot, '2026-07-14T0001Z-loot.md');
    const agentDir = mkDir(
      path.join(workspace, 'totem-strategy', '.totem', 'orchestration', 'sneaky-agent'),
    );
    symlinkDir(loot, path.join(agentDir, 'outbox'));

    const result = poll();
    expect(result.mail).toEqual([]);
    expect(result.scanned).toBe(0);
  });

  it('still scans a real sibling outbox alongside a symlinked agent dir', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-14T0002Z.md', to: 'totem-claude', subject: 'real mail' },
    ]);
    const outside = mkDir(path.join(tmpRoot, 'outside2', 'rogue-agent', 'outbox'));
    writeRogueMail(outside, '2026-07-14T0003Z.md');
    const orchDir = path.join(workspace, 'totem-strategy', '.totem', 'orchestration');
    symlinkDir(path.join(tmpRoot, 'outside2', 'rogue-agent'), path.join(orchDir, 'rogue-agent'));

    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('real mail');
  });
});

// ─── Processed/ exclusion ───────────────────────────────

describe('pollMail — processed/ exclusion', () => {
  it('excludes mail already in processed/', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z.md', to: 'totem-claude', subject: 'already actioned' },
      { name: '2026-05-18T1918Z.md', to: 'totem-claude', subject: 'still unread' },
    ]);
    writeProcessed('totem', 'totem-claude', ['2026-05-18T1734Z.md']);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.file).toBe('2026-05-18T1918Z.md');
  });

  it('excludes mail already in processed/_broadcast/', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-17T0103Z.md', to: 'broadcast', subject: 'cohort freeze' },
    ]);
    writeBroadcastProcessed('totem', 'totem-claude', ['2026-05-17T0103Z.md']);
    const result = poll();
    expect(result.mail).toEqual([]);
  });

  it('uses processed/ from every SELF_AGENT (multi-agent repos)', () => {
    // Pre-populate processed for totem-gemini; mail addressed to totem-gemini
    // should be excluded even though totem-claude is also a SELF_AGENT.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1700Z.md', to: 'totem-gemini', subject: 'already done' },
    ]);
    writeProcessed('totem', 'totem-gemini', ['2026-05-18T1700Z.md']);
    const result = poll();
    expect(result.mail).toEqual([]);
  });

  it('includeProcessed returns the RAW addressed-inbound set (does NOT subtract processed) — ADR-106 § A2.1', () => {
    // The pre-dedupe discovery `ecl-gc` compaction consumes: an already-handled
    // dispatch stays VISIBLE so its mark reads as load-bearing, not inert.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z.md', to: 'totem-claude', subject: 'already actioned' },
      { name: '2026-05-18T1918Z.md', to: 'totem-claude', subject: 'still unread' },
    ]);
    writeProcessed('totem', 'totem-claude', ['2026-05-18T1734Z.md']);
    // Default (reader) view subtracts the mark → 1 unread.
    expect(poll().mail).toHaveLength(1);
    // Pre-dedupe view keeps BOTH → the raw addressed-inbound set. NON-VACUITY:
    // feeding the default 1-item list back to compaction would delete the
    // handled mark (the A2.1 false-unread bomb).
    const raw = poll({ includeProcessed: true });
    expect(raw.mail.map((m) => m.file).sort()).toEqual([
      '2026-05-18T1734Z.md',
      '2026-05-18T1918Z.md',
    ]);
  });
});

// ─── Cross-sender basename-collision sensor ─────────────

describe('pollMail — cross-sender basename-collision sensor (mmnto-ai/totem#2311)', () => {
  const NAME = '2026-07-06T1717Z-totem-claude-blind-reply.md';

  it('warns once when two distinct senders converge on one addressed-inbound basename', () => {
    writeOutbox('totem-strategy', 'strategy-gemini', [{ name: NAME, to: 'totem-claude' }]);
    writeOutbox('totem-strategy', 'strategy-agy', [{ name: NAME, to: 'totem-claude' }]);
    const result = poll();
    const collisionWarnings = result.warnings.filter((w) =>
      w.startsWith('cross-sender basename collision'),
    );
    expect(collisionWarnings).toHaveLength(1);
    expect(collisionWarnings[0]).toContain(NAME);
    expect(collisionWarnings[0]).toContain('totem-strategy/strategy-gemini');
    expect(collisionWarnings[0]).toContain('totem-strategy/strategy-agy');
    // Sensor, not actuator (Tenet 13): both dispatches still surface as mail.
    expect(result.mail).toHaveLength(2);
  });

  it('fires on a broadcast + directed mix (both are addressed-inbound for this seat)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [{ name: NAME, to: 'broadcast' }]);
    writeOutbox('liquid-city', 'lc-claude', [{ name: NAME, to: 'totem-claude' }]);
    const result = poll();
    expect(
      result.warnings.filter((w) => w.startsWith('cross-sender basename collision')),
    ).toHaveLength(1);
  });

  it('does NOT fire on same-sender copies across repos (broadcast fan-out reads)', () => {
    // One dispatch, fanned out by the SAME seat into two repos: a single mark
    // shadowing all copies is correct handled-semantics, not a drop hazard.
    writeOutbox('totem-strategy', 'strategy-claude', [{ name: NAME, to: 'broadcast' }]);
    writeOutbox('liquid-city', 'strategy-claude', [{ name: NAME, to: 'broadcast' }]);
    const result = poll();
    expect(result.warnings).toEqual([]);
  });

  it('keys the sender on the outbox-owner seat, not the forgeable from: field', () => {
    // Same outbox owner, divergent from: headers — still ONE writer (single-
    // writer discipline), so no collision. The inverse (distinct owners with
    // an identical forged from:) must still fire.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: NAME, to: 'totem-claude', from: 'someone-else' },
    ]);
    writeOutbox('liquid-city', 'strategy-claude', [{ name: NAME, to: 'totem-claude' }]);
    expect(poll().warnings).toEqual([]);

    writeOutbox('totem-status', 'status-claude', [
      { name: NAME, to: 'totem-claude', from: 'strategy-claude' },
    ]);
    writeOutbox('skynet-sports', 'skynet-claude', [
      { name: NAME, to: 'totem-claude', from: 'strategy-claude' },
    ]);
    expect(
      poll().warnings.filter((w) => w.startsWith('cross-sender basename collision')),
    ).toHaveLength(1);
  });

  it('does NOT fire when neither same-basename dispatch is addressed to this seat', () => {
    writeOutbox('totem-strategy', 'strategy-gemini', [{ name: NAME, to: 'lc-claude' }]);
    writeOutbox('totem-strategy', 'strategy-agy', [{ name: NAME, to: 'lc-claude' }]);
    const result = poll();
    expect(result.warnings).toEqual([]);
  });

  it('emits ONE warning naming all sender paths when three seats collide', () => {
    writeOutbox('totem-strategy', 'strategy-gemini', [{ name: NAME, to: 'totem-claude' }]);
    writeOutbox('totem-strategy', 'strategy-agy', [{ name: NAME, to: 'totem-claude' }]);
    writeOutbox('liquid-city', 'lc-claude', [{ name: NAME, to: 'totem-claude' }]);
    const result = poll();
    const collisionWarnings = result.warnings.filter((w) =>
      w.startsWith('cross-sender basename collision'),
    );
    expect(collisionWarnings).toHaveLength(1);
    expect(collisionWarnings[0]).toContain('totem-strategy/strategy-gemini');
    expect(collisionWarnings[0]).toContain('totem-strategy/strategy-agy');
    expect(collisionWarnings[0]).toContain('liquid-city/lc-claude');
  });

  it('a processed/ mark hides the coexistence window from the READER poll but not from the compaction view', () => {
    // The reader poll filters BOTH files by basename at pass 1 — the exact
    // shadow this sensor exists to catch, detectable only while both are
    // unread. The compaction discovery poll (`includeProcessed`, ADR-106
    // § A2.1) sees through marks, so the warning fires there and reds the
    // A2.2 gate via the existing `warnings.length === 0` arm (#2309).
    writeOutbox('totem-strategy', 'strategy-gemini', [{ name: NAME, to: 'totem-claude' }]);
    writeOutbox('totem-strategy', 'strategy-agy', [{ name: NAME, to: 'totem-claude' }]);
    writeProcessed('totem', 'totem-claude', [NAME]);
    expect(poll().warnings).toEqual([]);
    const raw = poll({ includeProcessed: true });
    expect(
      raw.warnings.filter((w) => w.startsWith('cross-sender basename collision')),
    ).toHaveLength(1);
  });
});

// ─── Outbox roster-validation sensor (mmnto-ai/totem#2335) ──────────────

describe('pollMail — outbox roster-validation sensor (mmnto-ai/totem#2335)', () => {
  const UNRESOLVABLE_PREFIX = 'unresolvable outbox address';

  it('warns on the `to: cohort` exhibit — a non-roster literal invisible to every seat-scoped poll', () => {
    // The live exhibit: a verdict deposited with `to: cohort` matched no seat,
    // so it never surfaced as unread and "looked sent forever."
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-11T0900Z-cohort-verdict.md', to: 'cohort', subject: 'r2 verdict' },
    ]);
    const result = poll();
    const rosterWarnings = result.warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX));
    expect(rosterWarnings).toHaveLength(1);
    expect(rosterWarnings[0]).toContain('2026-07-11T0900Z-cohort-verdict.md');
    expect(rosterWarnings[0]).toContain('cohort');
    // Sensor, not gate (Tenet 13): unread counting is untouched — the file is
    // (correctly) not addressed to this seat, so it stays out of `mail`; the
    // warning is the only surface it appears on.
    expect(result.mail).toEqual([]);
  });

  it('warns on any unresolvable `to:` address, naming the file and the address', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-11T1000Z-typo.md', to: 'totem-claud', subject: 'fat-fingered recipient' },
    ]);
    const rosterWarnings = poll().warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX));
    expect(rosterWarnings).toHaveLength(1);
    expect(rosterWarnings[0]).toContain('2026-07-11T1000Z-typo.md');
    expect(rosterWarnings[0]).toContain('totem-claud');
  });

  it('does NOT warn on a valid roster recipient — including one addressed to another seat', () => {
    // Roster ≠ this seat's self-set: a dispatch to lc-claude (a cohort-map
    // agent, not self) is deliverable and must not warn, even though it is
    // filtered OUT of this seat's mail. broadcast is a routing literal, valid too.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'a.md', to: 'totem-claude', subject: 'to me' },
      { name: 'b.md', to: 'lc-claude', subject: 'to a peer seat' },
      { name: 'c.md', to: 'broadcast', subject: 'cohort-wide' },
    ]);
    expect(poll().warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX))).toEqual([]);
  });

  it('never false-flags an env/config self-id that sits outside the cohort map (#2141 union)', () => {
    // A self-id resolved from TOTEM_SELF_AGENT (not the hardcoded map) is a
    // valid recipient here; the roster unions it so self-addressed mail is
    // never reported unresolvable.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'x.md', to: 'custom-id', subject: 'env self' },
    ]);
    const result = poll({ env: { TOTEM_SELF_AGENT: 'custom-id' } });
    expect(result.warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX))).toEqual([]);
    expect(result.mail).toHaveLength(1);
  });

  it('a mail-shaped file with no `to:` keeps its distinct parse-fail message; the roster sensor does not re-warn it', () => {
    // Same undeliverable class, different surface: the no-`to:` reject is
    // already loud via the parse-fail path ("no to: field in frontmatter"), so
    // the roster sensor must not double-warn it.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'noto.md', to: 'unused', raw: '---\nfrom: strategy-claude\n---\n' },
    ]);
    const result = poll();
    expect(
      result.warnings.some((w) => w.startsWith('mail parse failed') && w.includes('no to: field')),
    ).toBe(true);
    expect(result.warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX))).toEqual([]);
    expect(result.mail).toEqual([]);
  });

  it('stays silent on a non-mail-shaped stray (no `---` opener) — the #2118 unclearable-noise invariant', () => {
    // The roster sensor runs only on successfully-parsed dispatches; a stray
    // .md that isn't mail-shaped must not draw a permanent, unclearable warning.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'stray.md', to: 'unused', raw: 'to: cohort\njust a note\n' },
    ]);
    expect(poll().warnings).toEqual([]);
  });

  it('warns once per unresolvable dispatch (per-file, not basename-deduped)', () => {
    // Distinct from the #2311 basename sensor (which dedupes by basename): each
    // stranded dispatch is independently undeliverable, so each is named.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-11T1100Z-cohort-1.md', to: 'cohort', subject: 'one' },
      { name: '2026-07-11T1200Z-cohort-2.md', to: 'cohort', subject: 'two' },
    ]);
    expect(poll().warnings.filter((w) => w.startsWith(UNRESOLVABLE_PREFIX))).toHaveLength(2);
  });
});

// ─── Sort + metadata ────────────────────────────────────

describe('pollMail — sort + metadata', () => {
  it('sorts newest-first by frontmatter date', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'a.md', to: 'totem-claude', date: '2026-05-18T1000Z', subject: 'older' },
      { name: 'b.md', to: 'totem-claude', date: '2026-05-18T2000Z', subject: 'newer' },
      { name: 'c.md', to: 'totem-claude', date: '2026-05-18T1500Z', subject: 'middle' },
    ]);
    const result = poll();
    expect(result.mail.map((m) => m.subject)).toEqual(['newer', 'middle', 'older']);
  });

  it('falls back to filename sort when date is absent', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1000Z.md', to: 'totem-claude', raw: '---\nto: totem-claude\n---\n' },
      { name: '2026-05-18T2000Z.md', to: 'totem-claude', raw: '---\nto: totem-claude\n---\n' },
    ]);
    const result = poll();
    expect(result.mail[0]!.file).toBe('2026-05-18T2000Z.md');
    expect(result.mail[1]!.file).toBe('2026-05-18T1000Z.md');
  });

  it('preserves the `to:` field verbatim (mixed case) in result metadata', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'x.md', to: 'Totem-Claude', subject: 'mixed case to' },
    ]);
    const result = poll();
    expect(result.mail[0]!.to).toBe('Totem-Claude');
  });

  it('captures `from:` from frontmatter when present', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'x.md',
        to: 'totem-claude',
        from: 'override-sender',
        subject: 'overridden from field',
      },
    ]);
    const result = poll();
    expect(result.mail[0]!.from).toBe('override-sender');
  });

  it('falls back to outbox-dir name when from: is absent', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'x.md',
        to: 'totem-claude',
        raw: '---\nto: totem-claude\nsubject: no from field\n---\n',
      },
    ]);
    const result = poll();
    expect(result.mail[0]!.from).toBe('strategy-claude');
  });

  it('reports `(no subject)` when subject is absent', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'x.md', to: 'totem-claude', raw: '---\nto: totem-claude\n---\n' },
    ]);
    const result = poll();
    expect(result.mail[0]!.subject).toBe('(no subject)');
  });
});

// ─── Frontmatter parsing robustness ─────────────────────

describe('pollMail — frontmatter parsing', () => {
  it('skips files without `to:` in the frontmatter — with a warning (mail-shaped sender error)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'noto.md', to: 'totem-claude', raw: '---\nfrom: x\n---\n' },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    // An outbox is dispatches-only by ADR-106 § 3; a `to:`-less mail-shaped
    // file there is sender error, surfaced loud (mmnto-ai/totem#2118).
    expect(
      result.warnings.some((w) => w.startsWith('mail parse failed') && w.includes('noto.md')),
    ).toBe(true);
  });

  it('only reads frontmatter from the header block (body `to:` cannot fabricate a match)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'body-to.md',
        to: 'unused',
        raw: '---\nfrom: x\n---\n\nto: totem-claude\nsubject: body forge\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    // Rejected for the right reason: no `to:` INSIDE the delimited header.
    expect(
      result.warnings.some((w) => w.startsWith('mail parse failed') && w.includes('body-to.md')),
    ).toBe(true);
  });

  it('handles CRLF line endings', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'crlf.md',
        to: 'totem-claude',
        raw: '---\r\nfrom: strategy-claude\r\nto: totem-claude\r\nsubject: crlf\r\n---\r\n\r\nBody.\r\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('crlf');
  });

  it('non-.md files are ignored', () => {
    const outbox = writeOutbox('totem-strategy', 'strategy-claude', []);
    fs.writeFileSync(
      path.join(outbox, 'note.txt'),
      '---\nto: totem-claude\n---\nshould be skipped',
      'utf-8',
    );
    const result = poll();
    expect(result.mail).toEqual([]);
  });
});

// ─── SELF_AGENT precedence + warnings ───────────────────

describe('pollMail — SELF_AGENT resolution', () => {
  it('records resolution source = map for a known repo', () => {
    const result = poll();
    expect(result.selfAgents.source).toBe('map');
    expect(result.selfAgents.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('respects TOTEM_SELF_AGENT env override', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'x.md', to: 'custom-id', subject: 'custom' },
    ]);
    const result = poll({ env: { TOTEM_SELF_AGENT: 'custom-id' } });
    expect(result.selfAgents.source).toBe('env');
    expect(result.mail).toHaveLength(1);
  });

  it('warns when SELF_AGENT cannot be resolved', () => {
    const unknownRoot = mkDir(path.join(tmpRoot, 'workspace', 'unknown-repo'));
    // Marker so the #2312 walk-up anchors here (basename `unknown-repo` ⇒ self
    // unresolved) instead of climbing to a host-level ancestor marker.
    mkDir(path.join(unknownRoot, '.totem'));
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'x.md', to: 'something', subject: 'orphan' },
    ]);
    const result = pollMail({ repoRoot: unknownRoot, workspace, env: {} });
    expect(result.selfAgents.source).toBe('none');
    expect(result.selfAgents.agents).toEqual([]);
    expect(result.warnings.some((w) => w.includes('no SELF_AGENT resolved'))).toBe(true);
    // With no SELF, only broadcast survives the filter.
    expect(result.mail).toEqual([]);
  });

  it('still surfaces broadcast mail when SELF_AGENT cannot be resolved', () => {
    const unknownRoot = mkDir(path.join(tmpRoot, 'workspace', 'unknown-repo'));
    // Marker so the #2312 walk-up anchors here (basename `unknown-repo` ⇒ self
    // unresolved) instead of climbing to a host-level ancestor marker.
    mkDir(path.join(unknownRoot, '.totem'));
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'b.md', to: 'broadcast', subject: 'cohort' },
    ]);
    const result = pollMail({ repoRoot: unknownRoot, workspace, env: {} });
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('broadcast');
  });
});

// ─── Workspace + recursive ──────────────────────────────

describe('pollMail — workspace', () => {
  it('honors the --workspace option', () => {
    const alt = mkDir(path.join(tmpRoot, 'alt-workspace'));
    fs.mkdirSync(
      path.join(alt, 'totem-strategy', '.totem', 'orchestration', 'strategy-claude', 'outbox'),
      {
        recursive: true,
      },
    );
    fs.writeFileSync(
      path.join(
        alt,
        'totem-strategy',
        '.totem',
        'orchestration',
        'strategy-claude',
        'outbox',
        'x.md',
      ),
      '---\nto: totem-claude\nsubject: alt-workspace\n---\n',
      'utf-8',
    );
    const result = poll({ workspace: alt });
    expect(result.mail).toHaveLength(1);
    expect(result.workspace).toBe(path.resolve(alt));
  });

  it('honors TOTEM_WORKSPACE env var', () => {
    const alt = mkDir(path.join(tmpRoot, 'env-workspace'));
    fs.mkdirSync(
      path.join(alt, 'totem-strategy', '.totem', 'orchestration', 'strategy-claude', 'outbox'),
      {
        recursive: true,
      },
    );
    fs.writeFileSync(
      path.join(
        alt,
        'totem-strategy',
        '.totem',
        'orchestration',
        'strategy-claude',
        'outbox',
        'x.md',
      ),
      '---\nto: totem-claude\n---\n',
      'utf-8',
    );
    const result = poll({ workspace: undefined, env: { TOTEM_WORKSPACE: alt } });
    expect(result.workspace).toBe(path.resolve(alt));
    expect(result.mail).toHaveLength(1);
  });

  it('warns and returns empty when workspace does not exist', () => {
    const missing = path.join(tmpRoot, 'does-not-exist');
    const result = poll({ workspace: missing });
    expect(result.warnings.some((w) => w.includes('workspace does not exist'))).toBe(true);
    expect(result.mail).toEqual([]);
  });

  it('--recursive descends into nested layouts', () => {
    // Sibling repo nested inside a wrapper dir; default scan misses it,
    // recursive scan finds it.
    const wrapper = mkDir(path.join(workspace, 'wrapper-dir'));
    fs.mkdirSync(
      path.join(wrapper, 'nested-strategy', '.totem', 'orchestration', 'strategy-claude', 'outbox'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        wrapper,
        'nested-strategy',
        '.totem',
        'orchestration',
        'strategy-claude',
        'outbox',
        'x.md',
      ),
      '---\nto: totem-claude\nsubject: nested\n---\n',
      'utf-8',
    );

    const flat = poll({ recursive: false });
    expect(flat.mail).toEqual([]);

    const recursive = poll({ recursive: true });
    expect(recursive.mail).toHaveLength(1);
    expect(recursive.mail[0]!.subject).toBe('nested');
    // Label uses the immediate parent dir (where `.totem/orchestration/`
    // lives), not the top-level wrapper — readers expect "the repo" to be
    // the leaf, not the container.
    expect(recursive.mail[0]!.repo).toBe('nested-strategy');
  });

  it('skips dot-directories and node_modules during recursive scan', () => {
    const node = mkDir(path.join(workspace, 'node_modules', 'fake-pkg'));
    fs.mkdirSync(path.join(node, '.totem', 'orchestration', 'strategy-claude', 'outbox'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(node, '.totem', 'orchestration', 'strategy-claude', 'outbox', 'x.md'),
      '---\nto: totem-claude\nsubject: spam\n---\n',
      'utf-8',
    );
    const result = poll({ recursive: true });
    expect(result.mail).toEqual([]);
  });
});

// ─── Subdirectory workspace derivation (mmnto-ai/totem#2312) ───────────────
// Run from a SUBDIRECTORY, the old `path.resolve(cwd)` made repoRoot the subdir
// and `workspace = dirname(subdir)` garbage — nothing scanned, a false-clean
// verdict at exit 0. The walk-up derives the real root, so workspace resolves
// to its parent and directed mail is found. `workspace` is intentionally NOT
// passed here so the derivation (not the injection) is under test.

describe('pollMail — subdirectory workspace derivation (mmnto-ai/totem#2312)', () => {
  it('walks up from a deep .totem subdir to the real root; workspace = parent-of-root and mail is found', () => {
    // `<workspace>/totem/.totem/...` makes `totem` the marked repo root; the
    // walk must anchor there from a nested processed/ subdir.
    const repoRoot = selfRepoRoot();
    const subdir = mkDir(
      path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'processed'),
    );
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z-totem-claude.md', to: 'totem-claude', subject: 'from a subdir' },
    ]);
    // No `workspace` override — derivation must find `<workspace>` (parent of
    // the resolved root `<workspace>/totem`).
    const result = pollMail({ repoRoot: subdir, env: {} });
    expect(result.workspace).toBe(path.resolve(workspace));
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('totem-claude');
    expect(result.mail[0]!.subject).toBe('from a subdir');
  });

  it('also anchors on a `.git` marker (dir) with no `.totem` at the root', () => {
    // `.git` created as a plain directory via fs — never a git spawn (Windows
    // leaves a temp-cwd git process undeletable). Root has ONLY `.git` (no
    // `.totem`), so this isolates the `.git`-marker arm; basename `totem`
    // resolves self via the cohort map even without a `.totem/orchestration` tree.
    const repoRoot = mkDir(path.join(workspace, 'totem'));
    fs.mkdirSync(path.join(repoRoot, '.git'));
    const subdir = mkDir(path.join(repoRoot, 'src', 'deep'));
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1800Z-totem-claude.md', to: 'totem-claude', subject: 'git-marked' },
    ]);
    const result = pollMail({ repoRoot: subdir, env: {} });
    expect(result.workspace).toBe(path.resolve(workspace));
    expect(result.selfAgents.agents).toContain('totem-claude');
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('git-marked');
  });

  it('a marker-less start dir resolves to its nearest marked ancestor (no garbage; deterministic)', () => {
    // A bare start dir with no marker of its own must not yield garbage: the walk
    // climbs to the nearest real root and derives workspace as that root's parent.
    // A controlled ancestor marker fixes the stop point regardless of host tmp
    // ancestry (the literal null→given-dir fallback is unit-tested on the helper).
    const anchor = mkDir(path.join(tmpRoot, 'anchor-repo'));
    mkDir(path.join(anchor, '.totem'));
    const bare = mkDir(path.join(anchor, 'nested', 'start'));
    const result = pollMail({ repoRoot: bare, env: {} });
    expect(result.workspace).toBe(path.resolve(tmpRoot)); // parent of anchor-repo
  });

  it('a marker-less start dir falls back to the given dir when the ancestry is marker-free', () => {
    // The literal pre-#2312 behavior: `findTotemRepoRootSync` returns null ⇒
    // repoRoot stays the given dir ⇒ workspace = its parent. Guarded like
    // findRepoRootSync's own null-case test — some dev hosts nest tmp under a
    // marker (e.g. `~/.totem`), where the walk anchors upward instead.
    const bare = mkDir(path.join(tmpRoot, 'bare-parent', 'bare-repo'));
    const result = pollMail({ repoRoot: bare, env: {} });
    if (findTotemRepoRootSync(bare) === null) {
      expect(result.workspace).toBe(path.resolve(path.join(tmpRoot, 'bare-parent')));
    } else {
      expect(path.isAbsolute(result.workspace)).toBe(true);
    }
  });
});

// ─── MAX_SCAN truncation ────────────────────────────────

describe('pollMail — MAX_SCAN truncation', () => {
  it('marks truncated and stops scanning at the cap (scanned <= maxScan)', () => {
    // Cap MECHANICS exercised via the maxScan injection point (the production
    // default is 5000 — mmnto-ai/totem#2144; building 5000-file fixtures per
    // test would test the filesystem, not the cap). Filenames chosen ascending
    // so DESC sort lists the highest-numbered first; truncation drops the
    // *oldest* tail, preserving the newest mail.
    const files: OutboxFile[] = [];
    for (let i = 0; i < 510; i++) {
      const num = String(i).padStart(5, '0');
      files.push({ name: `${num}.md`, to: 'totem-claude', subject: `n${i}` });
    }
    writeOutbox('totem-strategy', 'strategy-claude', files);
    const result = poll({ maxScan: 500 });
    expect(result.truncated).toBe(true);
    // Contract: scanned never exceeds the cap. Documents the pre-increment
    // off-by-one fix from CR R1 (#1971).
    expect(result.scanned).toBeLessThanOrEqual(500);
    expect(result.scanned).toBe(500);
    // Newest file (highest number) must be in the result; the cap drops the tail.
    expect(result.mail.some((m) => m.file === '00509.md')).toBe(true);
  });

  it('the default cap is no longer the operating regime: 510 unread files do NOT truncate (#2144)', () => {
    // The inherited 500 tripped on every real poll once cohort outboxes
    // outgrew it. The raised default must absorb today's realistic volume.
    const files: OutboxFile[] = [];
    for (let i = 0; i < 510; i++) {
      const num = String(i).padStart(5, '0');
      files.push({ name: `${num}.md`, to: 'totem-claude', subject: `n${i}` });
    }
    writeOutbox('totem-strategy', 'strategy-claude', files);
    const result = poll();
    expect(result.truncated).toBe(false);
    expect(result.scanned).toBe(510);
  });

  it('preserves global newest-first ordering under truncation across repos (GCA R2 #1971)', () => {
    // Without global ordering, alphabet-early repos (e.g. `apple-repo`) could
    // hog the cap. Confirm that the newest files across BOTH repos survive,
    // even when alphabet-first repo has enough files to exhaust the cap alone.
    const oldFiles: OutboxFile[] = [];
    for (let i = 0; i < 600; i++) {
      // Year 2024 — these are "old" in the global ordering.
      oldFiles.push({
        name: `2024-${String(i).padStart(5, '0')}.md`,
        to: 'totem-claude',
        subject: `old-${i}`,
      });
    }
    writeOutbox('apple-repo', 'apple-sender', oldFiles);
    const newFiles: OutboxFile[] = [];
    for (let i = 0; i < 5; i++) {
      // Year 2027 — newer than every apple-repo file. Global sort must
      // surface these even though apple-repo would alphabetically come first.
      newFiles.push({
        name: `2027-${String(i).padStart(5, '0')}.md`,
        to: 'totem-claude',
        subject: `fresh-${i}`,
      });
    }
    writeOutbox('zebra-repo', 'zebra-sender', newFiles);

    const result = poll({ maxScan: 500 });
    expect(result.truncated).toBe(true);
    expect(result.scanned).toBe(500);
    // All 5 fresh entries must be in the result. Pre-fix, they would have
    // been dropped because apple-repo's 500 stale files hit the cap first.
    const freshSubjects = result.mail.map((m) => m.subject).filter((s) => s.startsWith('fresh-'));
    expect(freshSubjects).toHaveLength(5);
  });
});

// ─── Self-token priority + directed truncation warning (#2144) ───────────

describe('pollMail — self-token scan priority (mmnto-ai/totem#2144)', () => {
  it('a self-token file older than every other-recipient file still beats the cap (bucket A first)', () => {
    // The #2144 victim class: old self-addressed mail crowded out of the
    // horizon by newer other-seat traffic. The positional filename token
    // rescues it ahead of the merged pool.
    const others: OutboxFile[] = [];
    for (let i = 0; i < 20; i++) {
      others.push({
        name: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T${String(i).padStart(4, '0')}Z-lc-claude-n${i}.md`,
        to: 'lc-claude',
        subject: `other-${i}`,
      });
    }
    writeOutbox('totem-strategy', 'strategy-claude', [
      ...others,
      { name: '2020-01-01T0000Z-totem-claude-ancient.md', to: 'totem-claude', subject: 'ancient' },
    ]);
    const result = poll({ maxScan: 10 });
    expect(result.truncated).toBe(true);
    expect(result.mail.some((m) => m.subject === 'ancient')).toBe(true);
  });

  it('a known-other token with `to: self` inside is never demoted below the global baseline (codex F2)', () => {
    // Ordering must not become delivery: the mislabeled-filename file is the
    // NEWEST candidate, so today's global newest-first delivers it — the
    // bucketing must too (other-token files stay MERGED at baseline, not
    // demoted behind tokenless files).
    const tokenless: OutboxFile[] = [];
    for (let i = 0; i < 10; i++) {
      tokenless.push({
        name: `1999-legacy-${String(i).padStart(3, '0')}.md`,
        to: 'lc-claude',
        subject: `legacy-${i}`,
      });
    }
    writeOutbox('totem-strategy', 'strategy-claude', [
      ...tokenless,
      // Newest in the global DESC order ('2026…' outranks every '1999…'),
      // token says lc-claude, header says totem-claude.
      { name: '2026-12-31T2359Z-lc-claude-mislabeled.md', to: 'totem-claude', subject: 'rescue' },
    ]);
    const result = poll({ maxScan: 5 });
    expect(result.truncated).toBe(true);
    expect(result.mail.some((m) => m.subject === 'rescue')).toBe(true);
  });

  it('positional matching: a slug word equal to a self id does not claim bucket A (strategy 2b)', () => {
    // `...-lc-claude-totem-claude-handoff.md` is addressed to lc-claude; the
    // self id appears in the SLUG. Positional matching must not promote it —
    // under a tight cap it competes at baseline and loses to newer files.
    const fresh: OutboxFile[] = [];
    for (let i = 0; i < 6; i++) {
      fresh.push({
        name: `2027-01-0${i + 1}T0000Z-lc-claude-n${i}.md`,
        to: 'lc-claude',
        subject: `fresh-${i}`,
      });
    }
    writeOutbox('totem-strategy', 'strategy-claude', [
      ...fresh,
      {
        name: '2026-01-01T0000Z-lc-claude-totem-claude-handoff.md',
        to: 'lc-claude',
        subject: 'slug-trap',
      },
    ]);
    const result = poll({ maxScan: 5 });
    expect(result.truncated).toBe(true);
    // Not delivered (addressed to lc-claude anyway) AND no directed warning —
    // the slug-trap file must not be counted as possible self mail.
    expect(result.warnings.every((w) => !w.includes('slug-trap'))).toBe(true);
    expect(result.warnings.every((w) => !w.includes('beyond the scan horizon'))).toBe(true);
  });

  it('directed warning names self-token files dropped beyond the horizon; generic-only otherwise', () => {
    const selfFlood: OutboxFile[] = [];
    for (let i = 0; i < 6; i++) {
      selfFlood.push({
        name: `2026-06-0${i + 1}T0000Z-totem-claude-s${i}.md`,
        to: 'totem-claude',
        subject: `self-${i}`,
      });
    }
    writeOutbox('totem-strategy', 'strategy-claude', selfFlood);
    const result = poll({ maxScan: 3 });
    expect(result.truncated).toBe(true);
    const directed = result.warnings.filter((w) => w.includes('beyond the scan horizon'));
    expect(directed).toHaveLength(1);
    expect(directed[0]).toContain('2026-06-01T0000Z-totem-claude-s0.md');

    // Other-recipient-only overflow: truncated, but no directed warning.
    cleanTmpDir(tmpRoot);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mail-'));
    workspace = mkDir(path.join(tmpRoot, 'workspace'));
    const otherFlood: OutboxFile[] = [];
    for (let i = 0; i < 6; i++) {
      otherFlood.push({
        name: `2026-06-0${i + 1}T0000Z-lc-claude-o${i}.md`,
        to: 'lc-claude',
        subject: `other-${i}`,
      });
    }
    writeOutbox('totem-strategy', 'strategy-claude', otherFlood);
    const generic = poll({ maxScan: 3 });
    expect(generic.truncated).toBe(true);
    expect(generic.warnings.every((w) => !w.includes('beyond the scan horizon'))).toBe(true);
  });
});

// ─── Bounded header reads (#2144, codex F3) ───────────────────────────────

describe('pollMail — bounded header reads (mmnto-ai/totem#2144)', () => {
  it('a multi-byte char split at the read boundary fails LOUD with the window reason (never silent)', () => {
    // 4 opener bytes + 9000 × 2-byte 'é' = 18004 bytes, no closing delimiter
    // within the 16387-byte window; byte 16387 lands mid-char. The reject
    // must be the mail-shaped window warning — the inv6/Tenet-4 property.
    const raw = `---\n${'é'.repeat(9000)}`;
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-01T0000Z-totem-claude-boundary.md', to: 'ignored', raw },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(0);
    const parseWarnings = result.warnings.filter((w) => w.includes('byte search window'));
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('boundary.md');
  });

  it('a closing delimiter split across the read boundary fails LOUD with the window reason', () => {
    // Padding sized so `\n---\n` starts at byte 16386 and the 16387-byte read
    // cuts it mid-delimiter: parse fails, sourceTruncated names the window.
    const raw = `---\n${'x'.repeat(16382)}\n---\nto: totem-claude\n`;
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-01T0000Z-totem-claude-split.md', to: 'ignored', raw },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(0);
    const parseWarnings = result.warnings.filter((w) => w.includes('byte search window'));
    expect(parseWarnings).toHaveLength(1);
  });
});

// ─── Send-side dir-derived recipient validation (#2141) ───────────────────

describe('mailSend — workspace-known recipients (mmnto-ai/totem#2141)', () => {
  it('a dir-registered seat in any workspace repo is a known recipient (no unknown-recipient warning)', () => {
    const repoRoot = selfRepoRoot();
    mkDir(path.join(workspace, 'other-repo', '.totem', 'orchestration', 'totem-codex'));
    const result = mailSend({
      to: 'totem-codex',
      subject: 'design review ask',
      from: 'totem-claude',
      body: 'ping',
      repoRoot,
      workspace,
      env: {},
      now: () => new Date('2026-06-12T01:00:00Z'),
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('an unregistered recipient still warns (advisory, inv6 — the dispatch writes anyway)', () => {
    const repoRoot = selfRepoRoot();
    const result = mailSend({
      to: 'nobody-anywhere',
      subject: 'typo check',
      from: 'totem-claude',
      body: 'ping',
      repoRoot,
      workspace,
      env: {},
      now: () => new Date('2026-06-12T01:00:00Z'),
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nobody-anywhere');
    expect(fs.existsSync(result.filePath)).toBe(true);
  });
});

// ─── Dir-derived self resolution surfaces through the poll (#2141) ────────

describe('pollMail — dir-derived seats (mmnto-ai/totem#2141)', () => {
  it('mail addressed to a dir-registered seat surfaces with source dirs+map (the totem-codex exhibit)', () => {
    const repoRoot = selfRepoRoot();
    mkDir(path.join(repoRoot, '.totem', 'orchestration', 'totem-codex'));
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-01T0000Z-totem-codex-hello.md', to: 'totem-codex', subject: 'for codex' },
    ]);
    const result = poll();
    expect(result.selfAgents.source).toBe('dirs+map');
    expect(result.selfAgents.agents).toContain('totem-codex');
    expect(result.mail.some((m) => m.subject === 'for codex')).toBe(true);
  });

  it('the config warn-shape surfaces through the poll warnings stream', () => {
    const repoRoot = selfRepoRoot();
    const orchDir = mkDir(path.join(repoRoot, '.totem', 'orchestration'));
    mkDir(path.join(orchDir, 'totem-codex'));
    fs.writeFileSync(
      path.join(orchDir, 'config.json'),
      JSON.stringify({ host_agents: ['totem-claude'] }),
      'utf-8',
    );
    const result = poll();
    expect(result.selfAgents.source).toBe('config');
    expect(result.warnings.some((w) => w.includes('omits present seat dir'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('totem-codex'))).toBe(true);
  });
});

// ─── Frontmatter forge defense (GCA R2 security finding on #1971) ───────

describe('pollMail — frontmatter forge defense', () => {
  it('rejects files that do not start with the YAML `---` delimiter — silently (not mail-shaped)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'no-delimiter.md',
        to: 'unused',
        raw: 'to: totem-claude\nsubject: forged\nbody text\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    // A stray .md is non-mail by contract; warning on it every poll would be
    // permanent, unclearable noise (mmnto-ai/totem#2118 design note).
    expect(result.warnings).toEqual([]);
  });

  it('rejects mail-shaped files with no closing `---` delimiter — and warns', () => {
    // The forge defense, re-derived for delimiter parsing: without a closing
    // `---`, body lines can't be distinguished from frontmatter, so the file
    // is rejected — but LOUDLY now (mmnto-ai/totem#2118: parse-null was the
    // only warning-less failure path in the module).
    const filler = 'x'.repeat(2500);
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'huge-no-close.md',
        to: 'unused',
        raw: `---\nfrom: strategy-claude\n${filler}\nto: totem-claude\nsubject: forged\n`,
      },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    expect(
      result.warnings.some(
        (w) => w.startsWith('mail parse failed') && w.includes('huge-no-close.md'),
      ),
    ).toBe(true);
  });

  it('accepts a frontmatter-only file regardless of blank-line separators (delimiter semantics)', () => {
    // Supersedes the old "small file without blank-line separator" leniency:
    // the closing `---` is the header terminator, full stop.
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'small-no-separator.md',
        to: 'totem-claude',
        raw: '---\nfrom: strategy-claude\nto: totem-claude\nsubject: tight\n---\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('tight');
  });
});

// ─── Frontmatter-only dispatches > 2 KiB (#2118 regression class) ───────

describe('pollMail — frontmatter-only dispatches (#2118)', () => {
  it('parses a frontmatter-only dispatch larger than 2 KiB with zero blank lines', () => {
    // The 8/8 miss class: cohort dispatches carry the whole message in
    // `subject:` (observed live at 2,110–4,163 bytes, zero blank lines). The
    // predecessor parser silently dropped every one of these over 2 KiB.
    const raw = frontmatterOnlyDispatch(3300);
    expect(raw.length).toBeGreaterThan(2048); // guard: the fixture exercises the old cap
    expect(raw).not.toMatch(/\n\n/); // guard: genuinely zero blank lines
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-07T2015Z-totem-claude.md', to: 'unused', raw },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('totem-claude');
    expect(result.mail[0]!.date).toBe('2026-06-07T2015Z');
    expect(result.warnings).toEqual([]);
  });

  it('parses a large frontmatter-only CRLF dispatch identically', () => {
    const raw = frontmatterOnlyDispatch(3300, '\r\n');
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'crlf-large.md', to: 'unused', raw },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.to).toBe('totem-claude');
  });

  it('rejects a dispatch whose closing `---` sits beyond the search window — and warns', () => {
    // Pathological-file bound: the cap now bounds the SEARCH WINDOW for the
    // closing delimiter instead of rejecting any large no-blank-line file.
    const raw = frontmatterOnlyDispatch(20_000);
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'over-window.md', to: 'unused', raw },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    expect(
      result.warnings.some(
        (w) => w.startsWith('mail parse failed') && w.includes('over-window.md'),
      ),
    ).toBe(true);
  });

  it('a blank line INSIDE the frontmatter does not truncate the header', () => {
    // The old splitter cut the header at the first blank line — a blank line
    // inside the frontmatter region hid every field after it.
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'inner-blank.md',
        to: 'unused',
        raw: '---\nfrom: strategy-claude\n\nto: totem-claude\nsubject: post-blank\n---\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('post-blank');
  });

  it('accepts trailing whitespace on the closing `---` line (hand-authored dispatches)', () => {
    // Greptile R1 on mmnto-ai/totem#2119: tolerate `---  \n` as the closing
    // delimiter. (The
    // block-scalar rationale in the finding doesn't hold — YAML block-scalar
    // content must be indented, so a column-0 `---` can't occur inside one —
    // but trailing-whitespace tolerance is a real hand-edit robustness win.)
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'trailing-ws-close.md',
        to: 'unused',
        raw: '---\nfrom: strategy-claude\nto: totem-claude\nsubject: ws close\n---  \nBody.\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('ws close');
  });

  it('reports the search-window reason only when content actually exceeds the window', () => {
    // Greptile R1 on mmnto-ai/totem#2119: the window is content.slice(3, 3 +
    // MAX), so files
    // of MAX+1..MAX+3 bytes are NOT truncated — the reason must be the plain
    // "no closing --- delimiter", reserving the window message for genuine
    // truncation.
    const atBoundary = `---\n${'x'.repeat(16_382)}`; // 16,386 bytes, no close
    const overBoundary = `---\n${'x'.repeat(17_000)}`; // truncated by the window
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'at-boundary.md', to: 'unused', raw: atBoundary },
      { name: 'over-boundary.md', to: 'unused', raw: overBoundary },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
    const atWarning = result.warnings.find((w) => w.includes('at-boundary.md'));
    const overWarning = result.warnings.find((w) => w.includes('over-boundary.md'));
    expect(atWarning).toContain('no closing --- delimiter');
    expect(atWarning).not.toContain('search window');
    expect(overWarning).toContain('search window');
  });

  it('parses the interim sender-discipline shape (blank line + body footer after closing `---`)', () => {
    // The cohort's send-side hotfix while old readers are deployed; the new
    // parser must treat the footer as body, not header.
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: 'footer.md',
        to: 'unused',
        raw: '---\nfrom: strategy-claude\nto: totem-claude\nsubject: with footer\n---\n\nFull content in subject above.\n',
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe('with footer');
  });
});

// ─── mailCommand --json (#2097) ─────────────────────────

describe('mailCommand — --json output', () => {
  it('emits valid JSON to stdout when json is set', async () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-07T2015Z.md', to: 'totem-claude', subject: 'json contract' },
    ]);
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
        return true;
      });
    try {
      await mailCommand({ json: true, repoRoot: selfRepoRoot(), workspace, env: {} });
    } finally {
      spy.mockRestore();
    }
    // The JSON contract is a single stdout write — one parseable payload,
    // nothing interleaved.
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!) as MailPollResult;
    expect(parsed.mail).toHaveLength(1);
    expect(parsed.mail[0]!.subject).toBe('json contract');
    expect(parsed.warnings).toEqual([]);
  });
});

// ─── Exit contract + NOT-DERIVED verdict (mmnto-ai/totem#2312) ─────────────

describe('resolveMailExitCode (unit)', () => {
  function result(selfAgents: MailPollResult['selfAgents']): MailPollResult {
    return { selfAgents, mail: [], scanned: 0, truncated: false, workspace: '/w', warnings: [] };
  }
  it('is 2 when self is unresolved (source none), 0 when resolved', () => {
    expect(resolveMailExitCode(result({ agents: [], source: 'none' }))).toBe(2);
    expect(resolveMailExitCode(result({ agents: ['totem-claude'], source: 'map' }))).toBe(0);
  });
});

describe('mailCommand — exit contract + NOT-DERIVED verdict (mmnto-ai/totem#2312)', () => {
  function unknownRepo(): string {
    // Marker-bearing so the #2312 walk-up anchors here (basename `unknown-repo`
    // ⇒ self unresolved) instead of climbing to a host-level ancestor marker.
    return markedRepoRoot('unknown-repo');
  }

  it('unresolved self ⇒ NOT-DERIVED text (never the clean line) and exit 2', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(log, 'info').mockImplementation((_tag: string, msg: string) => {
      lines.push(msg);
    });
    let exitCode: number;
    try {
      ({ exitCode } = await mailCommand({ repoRoot: unknownRepo(), workspace, env: {} }));
    } finally {
      spy.mockRestore();
    }
    const text = lines.join('\n');
    expect(exitCode).toBe(2);
    expect(text).toContain('NOT DERIVED');
    expect(text).not.toContain('No unread mail');
  });

  it('unresolved self + waiting broadcast ⇒ NOT-DERIVED carries a broadcast-count hint, exit 2', async () => {
    // Broadcasts pass the self-filter even with an empty self-set — the verdict
    // stays withheld, but waiting mail must not be invisible (greptile P2 on
    // mmnto-ai/totem#2313): the hint counts it and points at --json.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1900Z-broadcast.md', to: 'broadcast', subject: 'cohort-wide' },
    ]);
    const lines: string[] = [];
    const spy = vi.spyOn(log, 'info').mockImplementation((_tag: string, msg: string) => {
      lines.push(msg);
    });
    let exitCode: number;
    try {
      ({ exitCode } = await mailCommand({ repoRoot: unknownRepo(), workspace, env: {} }));
    } finally {
      spy.mockRestore();
    }
    const text = lines.join('\n');
    expect(exitCode).toBe(2);
    expect(text).toContain('NOT DERIVED');
    expect(text).toContain('1 broadcast dispatch(es) present');
    expect(text).not.toContain('No unread mail');
    expect(text).not.toContain('unread:');
  });

  it('resolved self + genuinely empty inbox ⇒ clean line and exit 0', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(log, 'info').mockImplementation((_tag: string, msg: string) => {
      lines.push(msg);
    });
    let exitCode: number;
    try {
      ({ exitCode } = await mailCommand({ repoRoot: selfRepoRoot(), workspace, env: {} }));
    } finally {
      spy.mockRestore();
    }
    const text = lines.join('\n');
    expect(exitCode).toBe(0);
    expect(text).toContain('No unread mail');
    expect(text).not.toContain('NOT DERIVED');
  });

  it('--json on the unresolved arm still emits the JSON result AND exits 2', async () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
        return true;
      });
    let exitCode: number;
    try {
      ({ exitCode } = await mailCommand({
        json: true,
        repoRoot: unknownRepo(),
        workspace,
        env: {},
      }));
    } finally {
      spy.mockRestore();
    }
    expect(exitCode).toBe(2);
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!) as MailPollResult;
    expect(parsed.selfAgents.source).toBe('none');
    expect(parsed.warnings.some((w) => w.includes('no SELF_AGENT resolved'))).toBe(true);
  });
});

// ─── Structured warnings on FS failures ─────────────────

describe('pollMail — structured warnings on FS failures', () => {
  it('emits a warning when processed/ exists but is unreadable', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-05-18T1734Z.md', to: 'totem-claude', subject: 'live' },
    ]);
    // Create processed/ as a FILE (not a dir) so readdirSync throws ENOTDIR.
    // existsSync is true (it's a file), readdir then fails — exercises the
    // catch-and-warn path for processed/ specifically.
    const selfProcessed = path.join(selfRepoRoot(), '.totem', 'orchestration', 'totem-claude');
    mkDir(selfProcessed);
    fs.writeFileSync(path.join(selfProcessed, 'processed'), 'not a directory');
    const result = poll();
    // Mail still surfaces (degraded — no exclusion filter), warning recorded.
    expect(result.mail).toHaveLength(1);
    expect(result.warnings.some((w) => w.startsWith('processed/ scan failed'))).toBe(true);
  });
});

// ─── Reader: timestamp: (ADR-098 v0.4) with date: fallback ──

describe('parseHeader — timestamp:/date: precedence (mmnto-ai/totem#2042)', () => {
  function rawDispatch(fields: string[]): string {
    return ['---', ...fields, '---', '', 'body', ''].join('\n');
  }

  it('reads timestamp: as the displayed time', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: '2026-06-09T1734Z-ts.md',
        to: 'totem-claude',
        raw: rawDispatch([
          'from: strategy-claude',
          'to: totem-claude',
          'timestamp: 2026-06-09T17:34:37.127Z',
          'subject: ts-test',
        ]),
      },
    ]);
    const result = poll();
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.date).toBe('2026-06-09T17:34:37.127Z');
  });

  it('prefers timestamp: over a legacy date: when both present', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: '2026-06-09T1734Z-both.md',
        to: 'totem-claude',
        raw: rawDispatch([
          'from: strategy-claude',
          'to: totem-claude',
          'date: 2026-01-01T0000Z',
          'timestamp: 2026-06-09T17:34:37.127Z',
          'subject: both',
        ]),
      },
    ]);
    expect(poll().mail[0]!.date).toBe('2026-06-09T17:34:37.127Z');
  });

  it('still falls back to legacy date: (backwards-compat read)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-09T1734Z-legacy.md', to: 'totem-claude', date: '2026-05-18T1700Z' },
    ]);
    expect(poll().mail[0]!.date).toBe('2026-05-18T1700Z');
  });
});

// ─── Outbound: send / reply (mmnto-ai/totem#2042) ───────

describe('mailSend — actuator (mmnto-ai/totem#2042)', () => {
  const fixedClock = (): Date => new Date('2026-06-09T17:34:37.127Z');
  function sendRepo(basename = 'totem'): string {
    return mkDir(path.join(workspace, basename));
  }

  it('writes a v0.4-compliant dispatch the poller reads back (sensor↔actuator round-trip)', () => {
    const res = mailSend({
      to: 'strategy-claude',
      subject: 'lane handoff',
      from: 'totem-claude',
      body: 'the body',
      repoRoot: sendRepo(),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude', 'totem-claude'],
    });
    // Structural v0.4 compliance, by construction.
    const written = fs.readFileSync(res.filePath, 'utf-8');
    expect(written).toContain('schema: adr-098-v0.4');
    expect(written).toContain('timestamp: 2026-06-09T17:34:37.127Z');
    expect(written).toContain('expected-action: none');
    expect(res.warnings).toEqual([]);

    // The poller (sensor) surfaces exactly what the actuator emitted.
    const recipientRepo = markedRepoRoot('totem-strategy');
    const inbox = pollMail({ repoRoot: recipientRepo, workspace, env: {} });
    expect(inbox.mail).toHaveLength(1);
    expect(inbox.mail[0]!.to).toBe('strategy-claude');
    expect(inbox.mail[0]!.from).toBe('totem-claude');
    expect(inbox.mail[0]!.subject).toBe('lane handoff');
    expect(inbox.mail[0]!.date).toBe('2026-06-09T17:34:37.127Z');
  });

  it('FAIL-OPEN: writes to an unknown recipient anyway, with a loud warning (inv6)', () => {
    const res = mailSend({
      to: 'totem-typoo',
      subject: 's',
      from: 'totem-claude',
      repoRoot: sendRepo(),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude', 'totem-claude'],
    });
    expect(fs.existsSync(res.filePath)).toBe(true); // NOT blocked
    expect(res.warnings.some((w) => w.includes('not a known cohort agent'))).toBe(true);
  });

  it('treats broadcast as a known recipient (no warning)', () => {
    const res = mailSend({
      to: 'broadcast',
      subject: 's',
      from: 'totem-claude',
      repoRoot: sendRepo(),
      env: {},
      now: fixedClock,
      knownAgents: ['totem-claude'],
    });
    expect(res.warnings).toEqual([]);
  });

  it('hard-errors on ambiguous self with no --from (never silently picks one)', () => {
    expect(() =>
      mailSend({ to: 'strategy-claude', subject: 's', repoRoot: sendRepo('totem'), env: {} }),
    ).toThrow(/ambiguous sender/);
  });

  it('hard-errors on unresolvable self (never writes .../undefined/outbox)', () => {
    expect(() =>
      mailSend({ to: 'x', subject: 's', repoRoot: sendRepo('not-a-cohort-repo'), env: {} }),
    ).toThrow(/cannot resolve a sender/);
  });

  it('hard-errors on missing --to / --subject', () => {
    const repo = sendRepo();
    expect(() =>
      mailSend({ to: '  ', subject: 's', from: 'totem-claude', repoRoot: repo, env: {} }),
    ).toThrow(/--to/);
    expect(() =>
      mailSend({ to: 'x', subject: '', from: 'totem-claude', repoRoot: repo, env: {} }),
    ).toThrow(/--subject/);
  });

  it('hard-errors on an unreadable --body-file (never ships an empty body)', () => {
    expect(() =>
      mailSend({
        to: 'strategy-claude',
        subject: 's',
        from: 'totem-claude',
        bodyFile: path.join(tmpRoot, 'no-such-body.md'),
        repoRoot: sendRepo(),
        env: {},
        now: fixedClock,
      }),
    ).toThrow(/--body-file unreadable/);
  });

  it('disambiguates same-minute collisions into distinct files', () => {
    const repo = sendRepo();
    const common = {
      to: 'strategy-claude',
      subject: 'same slug here',
      from: 'totem-claude',
      repoRoot: repo,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    } as const;
    const r1 = mailSend({ ...common });
    const r2 = mailSend({ ...common });
    expect(r1.filePath).not.toBe(r2.filePath);
    expect(fs.existsSync(r1.filePath)).toBe(true);
    expect(fs.existsSync(r2.filePath)).toBe(true);
  });

  it('creates the outbox tree on a fresh repo', () => {
    const repo = sendRepo('totem');
    const res = mailSend({
      to: 'strategy-claude',
      subject: 's',
      from: 'totem-claude',
      repoRoot: repo,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(res.filePath).toContain(path.join('.totem', 'orchestration', 'totem-claude', 'outbox'));
    expect(fs.existsSync(res.filePath)).toBe(true);
  });

  it('rejects a path-traversal --from', () => {
    expect(() =>
      mailSend({
        to: 'x',
        subject: 's',
        from: '../evil',
        repoRoot: sendRepo(),
        env: {},
        now: fixedClock,
      }),
    ).toThrow(/path-traversal/);
  });

  it('rejects a path-traversal --to and never escapes the outbox (#2134)', () => {
    const repo = sendRepo();
    expect(() =>
      mailSend({
        to: '../../../evil',
        subject: 's',
        from: 'totem-claude',
        repoRoot: repo,
        env: {},
        now: fixedClock,
        knownAgents: ['totem-claude'],
      }),
    ).toThrow(/path-traversal/);
    // The guard fires before any mkdir/write, so nothing escaped — not even the
    // sender's own outbox was created.
    expect(
      fs.existsSync(path.join(repo, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    ).toBe(false);
  });

  it('rejects control/whitespace/win32-reserved characters in agent ids (#2134 R2)', () => {
    const repo = sendRepo();
    // Built via fromCharCode so the source file itself carries no raw control
    // bytes; ESC is the canonical terminal-injection probe (CR R2).
    const esc = String.fromCharCode(0x1b);
    for (const evil of [`evil${esc}]0;pwn`, 'two words', 'a:b', 'a*b']) {
      expect(() =>
        mailSend({
          to: evil,
          subject: 's',
          from: 'totem-claude',
          repoRoot: repo,
          env: {},
          now: fixedClock,
          knownAgents: ['totem-claude'],
        }),
      ).toThrow(/unsafe characters/);
    }
  });

  it('never echoes a rejected id raw — control bytes are JSON-escaped in the error (#2134 R3)', () => {
    const esc = String.fromCharCode(0x1b);
    let thrown: unknown;
    try {
      mailSend({
        to: `evil${esc}x`,
        subject: 's',
        from: 'totem-claude',
        repoRoot: sendRepo(),
        env: {},
        now: fixedClock,
        knownAgents: ['totem-claude'],
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // The rejection message must not re-create the very terminal injection it
    // blocks: no raw ESC on stderr, only its JSON-escaped spelling.
    expect(String(thrown)).not.toContain(esc);
    expect(String(thrown)).toContain('u001b');
  });

  it('surfaces the original write error even when temp cleanup also fails (#2134 R2)', () => {
    // GCA R2: a cleanup rmSync that throws must not shadow the actuation
    // error — the failed write is the signal. No fs mocking (ESM namespaces
    // are not spyable): instead, learn the deterministic target path from a
    // clean send, then plant a NON-EMPTY DIRECTORY at `<filePath>.tmp` so
    // (a) writeFileSync(tmp) fails with the original error (EISDIR), and
    // (b) the cleanup rmSync(tmp) also fails (directory, no `recursive`).
    const repo = sendRepo();
    const common = {
      to: 'strategy-claude',
      subject: 'shadow probe',
      from: 'totem-claude',
      repoRoot: repo,
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    } as const;
    const probe = mailSend({ ...common });
    fs.rmSync(probe.filePath); // free the slot so the rerun recomputes the same path
    const tmpAsDir = `${probe.filePath}.tmp`;
    fs.mkdirSync(tmpAsDir);
    fs.writeFileSync(path.join(tmpAsDir, 'occupant.txt'), 'x', 'utf-8');
    try {
      expect(() => mailSend({ ...common })).toThrow(/write failed.*could not be removed/);
    } finally {
      fs.rmSync(tmpAsDir, { recursive: true, force: true });
    }
  });
});

describe('mailReply — sugar (mmnto-ai/totem#2042)', () => {
  const fixedClock = (): Date => new Date('2026-06-09T18:00:00.000Z');

  function writeSource(): string {
    const outbox = mkDir(
      path.join(
        workspace,
        'totem-strategy',
        '.totem',
        'orchestration',
        'strategy-claude',
        'outbox',
      ),
    );
    const p = path.join(outbox, '2026-06-09T1710Z-totem-claude-orig.md');
    fs.writeFileSync(
      p,
      [
        '---',
        'schema: adr-098-v0.4',
        'from: strategy-claude',
        'to: totem-claude',
        'timestamp: 2026-06-09T17:10:00.000Z',
        'subject: Original subject',
        '---',
        '',
        'orig body',
        '',
      ].join('\n'),
      'utf-8',
    );
    return p;
  }

  it('infers to/subject/in-reply-to from the source dispatch', () => {
    const src = writeSource();
    const res = mailReply(src, {
      from: 'totem-claude',
      repoRoot: mkDir(path.join(workspace, 'totem')),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(res.header.to).toBe('strategy-claude'); // = source.from
    expect(res.header.subject).toBe('Re: Original subject');
    // Portable repo-relative wire form — never the absolute local path
    // (GCA R3 on mmnto-ai/totem#2134: no drive letters/usernames in shared
    // frontmatter).
    expect(res.header.inReplyTo).toBe(
      '.totem/orchestration/strategy-claude/outbox/2026-06-09T1710Z-totem-claude-orig.md',
    );
  });

  it('falls back to the outbox-dir agent when the source has no from: (#2134 R3)', () => {
    // Reader parity: pollMail accepts a from:-less dispatch by falling back to
    // the outbox directory name — reply must not hard-fail where the reader
    // succeeded.
    const outbox = mkDir(
      path.join(
        workspace,
        'totem-strategy',
        '.totem',
        'orchestration',
        'strategy-claude',
        'outbox',
      ),
    );
    const src = path.join(outbox, '2026-06-09T1700Z-totem-claude-legacy.md');
    fs.writeFileSync(src, '---\nto: totem-claude\nsubject: legacy mail\n---\n\nBody.\n', 'utf-8');
    const res = mailReply(src, {
      from: 'totem-claude',
      repoRoot: mkDir(path.join(workspace, 'totem')),
      env: {},
      now: fixedClock,
      knownAgents: ['strategy-claude'],
    });
    expect(res.header.to).toBe('strategy-claude'); // derived from <agent>/outbox/ layout
  });

  it('hard-errors when the source dispatch is missing', () => {
    expect(() =>
      mailReply(path.join(tmpRoot, 'nope.md'), {
        from: 'totem-claude',
        repoRoot: mkDir(path.join(workspace, 'totem')),
        env: {},
      }),
    ).toThrow(/cannot read reply source dispatch/);
  });
});

describe('validateDispatchContent / composeDispatch / resolveSelfSender (units)', () => {
  it('warns on unknown recipient, silent on known + broadcast (exact predicate)', () => {
    expect(validateDispatchContent({ to: 'nope' }, ['totem-claude'])).toHaveLength(1);
    expect(validateDispatchContent({ to: 'totem-claude' }, ['totem-claude'])).toHaveLength(0);
    expect(validateDispatchContent({ to: 'broadcast' }, ['totem-claude'])).toHaveLength(0);
    expect(validateDispatchContent({ to: 'TOTEM-CLAUDE' }, ['totem-claude'])).toHaveLength(0); // case-insensitive
  });

  it('quotes YAML-unsafe subjects so the emit is valid YAML (and unquotes refs)', () => {
    const header: DispatchHeader = {
      schema: 'adr-098-v0.4',
      from: 'totem-claude',
      to: 'strategy-claude',
      timestamp: '2026-06-09T17:34:37.127Z',
      subject: '[#42 brackets: and colon]',
      expectedAction: 'none',
      related: ['mmnto-ai/totem#2042'],
    };
    const md = composeDispatch(header, 'body');
    expect(md).toContain('subject: "[#42 brackets: and colon]"');
    expect(md).toContain('  - mmnto-ai/totem#2042'); // ref stays unquoted
    expect(md).toContain('related-issues:');
  });

  it('quotes boolean/null/numeric-shaped scalars so YAML readers keep the string type (#2134 R3)', () => {
    const base: Omit<DispatchHeader, 'subject'> = {
      schema: 'adr-098-v0.4',
      from: 'totem-claude',
      to: 'strategy-claude',
      timestamp: '2026-06-09T17:34:37.127Z',
      expectedAction: 'none',
    };
    for (const subject of ['true', 'NO', 'y', 'null', '~', '42', '-3.5', '1e5', '123.']) {
      const md = composeDispatch({ ...base, subject }, 'body');
      expect(md).toContain(`subject: ${JSON.stringify(subject)}`);
    }
    // Ordinary prose subjects stay unquoted (the de-facto wire shape).
    expect(composeDispatch({ ...base, subject: 'plain words' }, 'body')).toContain(
      'subject: plain words',
    );
  });

  it('round-trips a quoted subject without accreting quotes (#2134 R3)', () => {
    // compose → poll: the reader must surface the subject the sender typed,
    // not yamlScalar's emit-quoting (CR R3 — `Re: "..."` accretion class).
    const subject = 'R3: the colon-space forces quoting';
    const md = composeDispatch(
      {
        schema: 'adr-098-v0.4',
        from: 'strategy-claude',
        to: 'totem-claude',
        timestamp: '2026-06-09T17:34:37.127Z',
        subject,
        expectedAction: 'none',
      },
      'body',
    );
    expect(md).toContain(`subject: ${JSON.stringify(subject)}`); // quoted on the wire
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-06-09T1734Z-roundtrip.md', to: 'totem-claude', raw: md },
    ]);
    const result = pollMail({ repoRoot: selfRepoRoot(), workspace, env: {} });
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.subject).toBe(subject); // unquoted on read
  });

  it('never decodes control/newline escapes out of a quoted subject (#2134 R4)', () => {
    // A quoted wire subject encoding control bytes must surface in its escaped
    // spelling — decoding it would hand `formatTextResult` raw ESC/newline for
    // stderr (the terminal-injection class the agent-id guard blocks).
    const escapedEsc = 'subject: "esc \\u001b[31m red"';
    const escapedNewline = 'subject: "line1\\nline2"';
    for (const [name, subjectLine] of [
      ['2026-06-09T1735Z-esc.md', escapedEsc],
      ['2026-06-09T1736Z-newline.md', escapedNewline],
    ] as const) {
      writeOutbox('totem-strategy', 'strategy-claude', [
        {
          name,
          to: 'totem-claude',
          raw: ['---', 'from: strategy-claude', 'to: totem-claude', subjectLine, '---', ''].join(
            '\n',
          ),
        },
      ]);
    }
    const result = pollMail({ repoRoot: selfRepoRoot(), workspace, env: {} });
    expect(result.mail).toHaveLength(2);
    const esc = String.fromCharCode(0x1b);
    for (const entry of result.mail) {
      expect(entry.subject).not.toContain(esc);
      expect(entry.subject).not.toContain('\n');
      expect(entry.subject.startsWith('"')).toBe(true); // verbatim, still quoted
    }
  });

  it('escapes raw control bytes from hand-authored wire fields (#2134 R5)', () => {
    // The escaped-sequence guard (R4) covers the wire ENCODING of controls;
    // this covers raw bytes typed directly into a dispatch — quoted, unquoted,
    // and in from: — a reader exposure that predates the actuator.
    const esc = String.fromCharCode(0x1b);
    writeOutbox('totem-strategy', 'strategy-claude', [
      {
        name: '2026-06-09T1737Z-rawquoted.md',
        to: 'totem-claude',
        raw: [
          '---',
          `from: strategy${esc}-claude`,
          'to: totem-claude',
          `subject: "quoted ${esc}[31m raw"`,
          '---',
          '',
        ].join('\n'),
      },
      {
        name: '2026-06-09T1738Z-rawunquoted.md',
        to: 'totem-claude',
        raw: [
          '---',
          'from: strategy-claude',
          'to: totem-claude',
          `subject: unquoted ${esc}[31m raw`,
          '---',
          '',
        ].join('\n'),
      },
    ]);
    const result = pollMail({ repoRoot: selfRepoRoot(), workspace, env: {} });
    expect(result.mail).toHaveLength(2);
    for (const entry of result.mail) {
      expect(entry.subject).not.toContain(esc);
      expect(entry.from).not.toContain(esc);
      expect(entry.subject).toContain('u001b'); // escaped spelling — lossless, visible
    }
  });

  it('resolveSelfSender: explicit > unambiguous map > error', () => {
    const totemRepo = mkDir(path.join(workspace, 'totem'));
    expect(resolveSelfSender(totemRepo, {}, 'totem-gemini')).toBe('totem-gemini'); // explicit wins
    expect(resolveSelfSender(totemRepo, { TOTEM_SELF_AGENT: 'totem-claude' })).toBe('totem-claude'); // env → single
    expect(() => resolveSelfSender(totemRepo, {})).toThrow(/ambiguous/); // map → 2 agents
  });
});
