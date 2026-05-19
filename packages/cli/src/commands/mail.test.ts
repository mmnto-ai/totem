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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { type MailPollResult, pollMail } from './mail.js';

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
  it('skips files without `to:` in the frontmatter', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: 'noto.md', to: 'totem-claude', raw: '---\nfrom: x\n---\n' },
    ]);
    const result = poll();
    expect(result.mail).toEqual([]);
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
