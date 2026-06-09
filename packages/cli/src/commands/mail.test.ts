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

import { cleanTmpDir } from '../test-utils.js';
import {
  composeDispatch,
  type DispatchHeader,
  mailCommand,
  type MailPollResult,
  mailReply,
  mailSend,
  pollMail,
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
  return mkDir(path.join(workspace, 'totem'));
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

// ─── MAX_SCAN truncation ────────────────────────────────

describe('pollMail — MAX_SCAN truncation', () => {
  it('marks truncated and stops scanning at the cap (scanned <= MAX_SCAN)', () => {
    // Generate > MAX_SCAN files (501) so the cap is exercised. Filenames
    // chosen ascending so DESC sort lists the highest-numbered first;
    // truncation drops the *oldest* tail, preserving the newest mail.
    const files: OutboxFile[] = [];
    for (let i = 0; i < 510; i++) {
      const num = String(i).padStart(5, '0');
      files.push({ name: `${num}.md`, to: 'totem-claude', subject: `n${i}` });
    }
    writeOutbox('totem-strategy', 'strategy-claude', files);
    const result = poll();
    expect(result.truncated).toBe(true);
    // Contract: scanned never exceeds MAX_SCAN. Documents the pre-increment
    // off-by-one fix from CR R1 (#1971).
    expect(result.scanned).toBeLessThanOrEqual(500);
    expect(result.scanned).toBe(500);
    // Newest file (highest number) must be in the result; the cap drops the tail.
    expect(result.mail.some((m) => m.file === '00509.md')).toBe(true);
  });

  it('preserves global newest-first ordering under truncation across repos (GCA R2 #1971)', () => {
    // Without global ordering, alphabet-early repos (e.g. `apple-repo`) could
    // hog MAX_SCAN. Confirm that the newest files across BOTH repos survive,
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

    const result = poll();
    expect(result.truncated).toBe(true);
    expect(result.scanned).toBe(500);
    // All 5 fresh entries must be in the result. Pre-fix, they would have
    // been dropped because apple-repo's 500 stale files hit the cap first.
    const freshSubjects = result.mail.map((m) => m.subject).filter((s) => s.startsWith('fresh-'));
    expect(freshSubjects).toHaveLength(5);
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
    const recipientRepo = mkDir(path.join(workspace, 'totem-strategy'));
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
    expect(res.header.inReplyTo).toBe(src);
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

  it('resolveSelfSender: explicit > unambiguous map > error', () => {
    const totemRepo = mkDir(path.join(workspace, 'totem'));
    expect(resolveSelfSender(totemRepo, {}, 'totem-gemini')).toBe('totem-gemini'); // explicit wins
    expect(resolveSelfSender(totemRepo, { TOTEM_SELF_AGENT: 'totem-claude' })).toBe('totem-claude'); // env → single
    expect(() => resolveSelfSender(totemRepo, {})).toThrow(/ambiguous/); // map → 2 agents
  });
});
