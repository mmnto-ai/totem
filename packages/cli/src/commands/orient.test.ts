import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardItem } from '../adapters/github-cli-project.js';
import type { StandardIssueWithBody } from '../adapters/issue-adapter.js';
import type { StandardPrListItem } from '../adapters/pr-adapter.js';

// ─── Adapter mocks (control every primitive orient fetches) ─────────────

const mockFetchOpenPRs = vi.fn<() => StandardPrListItem[]>();
vi.mock('../adapters/github-cli-pr.js', () => ({
  GitHubCliPrAdapter: class {
    fetchOpenPRs() {
      return mockFetchOpenPRs();
    }
  },
}));

const mockFetchOpenIssuesWithBody = vi.fn<() => StandardIssueWithBody[]>();
vi.mock('../adapters/github-cli.js', () => ({
  GitHubCliAdapter: class {
    fetchOpenIssuesWithBody() {
      return mockFetchOpenIssuesWithBody();
    }
  },
}));

const mockFetchBoardItems = vi.fn<() => BoardItem[]>();
vi.mock('../adapters/github-cli-project.js', async () => {
  const actual = await vi.importActual<typeof import('../adapters/github-cli-project.js')>(
    '../adapters/github-cli-project.js',
  );
  return { ...actual, fetchBoardItems: () => mockFetchBoardItems() };
});

// ─── @mmnto/totem mock (gh repo view slug + freeze + registry + git root) ─
//
// CRITICAL: orient must NEVER reach the embedder. We provide a `createEmbedder`
// that throws if called — the structural guard that orient dodges #2018 (it
// runs green with `@google/genai` absent because it never touches embeddings).

const mockSafeExec = vi.fn<() => string>();
const mockReadRegistry = vi.fn<() => Record<string, unknown>>(() => ({}));
const embedderTripwire = vi.fn(() => {
  throw new Error('orient must never reach the embedder (#2018 structural guard)');
});
// The repo root orient resolves to. Tests point it at a real temp dir so the
// REAL readFreezeConfig (kept un-mocked) reads a real `.totem/freeze.json` —
// exercising the actual fail-loud reader rather than a stub.
let repoRoot = '/repo/root';

// Spread the real core module, overriding only the primitives orient reads.
// Full replacement is fragile (core has many transitive exports the adapters
// need); status.test.ts uses this same importActual pattern. Note:
// `readFreezeConfig` is intentionally NOT overridden — the freeze section is
// tested against the real reader via a real temp `.totem/freeze.json`.
vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: () => mockSafeExec(),
    readRegistry: () => mockReadRegistry(),
    resolveGitRoot: () => repoRoot,
    // #2018 structural tripwire: orient must never construct an embedder/store.
    createEmbedder: embedderTripwire,
    LanceStore: class {
      constructor() {
        embedderTripwire();
      }
    },
  };
});

// ─── utils mock (config / project number resolution) ────────────────────

const mockLoadConfig = vi.fn();
vi.mock('../utils.js', () => ({
  resolveConfigPath: () => '/repo/root/totem.config.ts',
  loadConfig: () => mockLoadConfig(),
}));

import {
  deriveOrientReport,
  orientCommand,
  type OrientReport,
  renderOrientForSession,
  renderReport,
} from './orient.js';

// ─── Test harness ───────────────────────────────────────

let stdout: string;
let writeSpy: ReturnType<typeof vi.spyOn>;

function runJson(): Promise<void> {
  return orientCommand({ json: true });
}

function parseJson(): OrientReport {
  return JSON.parse(stdout) as OrientReport;
}

let tmpRoot: string;

beforeEach(() => {
  stdout = '';
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
  // Real temp repo root so the real readFreezeConfig has a real (empty) .totem.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orient-'));
  fs.mkdirSync(path.join(tmpRoot, '.totem'), { recursive: true });
  repoRoot = tmpRoot;
  // Default happy-path primitives.
  mockSafeExec.mockReturnValue(JSON.stringify({ owner: { login: 'mmnto-ai' }, name: 'totem' }));
  mockReadRegistry.mockReturnValue({});
  mockFetchOpenPRs.mockReturnValue([]);
  mockFetchOpenIssuesWithBody.mockReturnValue([]);
  mockFetchBoardItems.mockReturnValue([]);
  mockLoadConfig.mockResolvedValue({ orient: undefined });
  delete process.env['TOTEM_ORIENT_PROJECT'];
});

afterEach(() => {
  writeSpy.mockRestore();
  vi.clearAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env['TOTEM_ORIENT_PROJECT'];
});

// ─── Per-section failure isolation ──────────────────────

describe('orient per-section failure isolation', () => {
  it('an issue-fetch failure does not blank the PR section', async () => {
    mockFetchOpenPRs.mockReturnValue([
      { number: 5, title: 'fix', headRefName: 'fix/x', isDraft: false },
    ]);
    mockFetchOpenIssuesWithBody.mockImplementation(() => {
      throw new Error('gh issue list exploded');
    });
    await runJson();
    const r = parseJson();
    // PRs still derive…
    expect(r.openPRs).toEqual([{ number: 5, title: 'fix', headRefName: 'fix/x', isDraft: false }]);
    // …while the issue-derived sections surface as { error }.
    expect(r.epics).toEqual({ error: 'gh issue list exploded' });
    expect(r.otherOpenIssues).toEqual({ error: 'gh issue list exploded' });
  });

  it('a malformed freeze.json isolates to the parked section only ({error}, not blank)', async () => {
    // Real malformed file → real readFreezeConfig throws TotemConfigError.
    fs.writeFileSync(path.join(tmpRoot, '.totem', 'freeze.json'), '{ not valid json');
    mockFetchOpenPRs.mockReturnValue([
      { number: 9, title: 'fix', headRefName: 'fix/y', isDraft: false },
    ]);
    await runJson();
    const r = parseJson();
    expect(r.parked).toHaveProperty('error', expect.stringMatching(/freeze\.json/i));
    // The PR section still derives — failure is isolated.
    expect(r.openPRs).toEqual([{ number: 9, title: 'fix', headRefName: 'fix/y', isDraft: false }]);
  });

  it('derives real parked entries from a valid freeze.json', async () => {
    fs.writeFileSync(
      path.join(tmpRoot, '.totem', 'freeze.json'),
      JSON.stringify({
        frozen: [{ subsystem: 'embedder', since: '2026-01-01', reason: 'blocked. extra' }],
      }),
    );
    await runJson();
    const r = parseJson();
    expect(r.parked).toEqual([
      { subsystem: 'embedder', since: '2026-01-01', reason: 'blocked. extra' },
    ]);
  });
});

// ─── Unexpected shape → {error}, never empty ────────────

describe('orient unexpected-shape handling', () => {
  it('an unexpected gh repo view shape surfaces as a repo { error }, not a blank', async () => {
    mockSafeExec.mockReturnValue(JSON.stringify({ owner: {}, name: '' }));
    await runJson();
    const r = parseJson();
    expect(r.repo).toEqual({ error: 'unexpected `gh repo view` shape' });
  });
});

// ─── Cross-repo parent guard ────────────────────────────

describe('orient cross-repo parent guard', () => {
  it('a cross-repo Parent ref never attaches a child to a same-numbered LOCAL epic', async () => {
    mockSafeExec.mockReturnValue(JSON.stringify({ owner: { login: 'mmnto-ai' }, name: 'totem' }));
    mockFetchOpenIssuesWithBody.mockReturnValue([
      { number: 50, title: 'Local epic', body: '', labels: ['type: epic'] },
      // Child points at other-repo#50 — must NOT attach to local #50.
      {
        number: 51,
        title: 'Foreign child',
        body: '**Parent:** other-owner/other-repo#50',
        labels: [],
      },
      // Child points at LOCAL #50 (bare ref) — must attach.
      { number: 52, title: 'Local child', body: '**Parent:** #50', labels: [] },
    ]);
    await runJson();
    const r = parseJson();
    expect(r.epics).toEqual([
      {
        number: 50,
        title: 'Local epic',
        labels: ['type: epic'],
        subIssues: [{ number: 52, title: 'Local child' }],
      },
    ]);
    // The foreign-parent child stays in OTHER (never dropped, never mis-attached).
    expect(r.otherOpenIssues).toEqual([{ number: 51, title: 'Foreign child', labels: [] }]);
  });
});

// ─── Board path + coherence ─────────────────────────────

describe('orient board + coherence', () => {
  beforeEach(() => {
    process.env['TOTEM_ORIENT_PROJECT'] = '1';
  });

  it('filters the board to active items and flags issue drift in --json', async () => {
    mockFetchOpenIssuesWithBody.mockReturnValue([
      { number: 200, title: 'Open issue', body: '', labels: [] },
    ]);
    const local = { contentRepo: 'mmnto-ai/totem', contentType: 'Issue' };
    mockFetchBoardItems.mockReturnValue([
      { status: 'In Progress', title: 'Active drift', contentNumber: 100, ...local }, // not open → drift
      { status: 'In Review', title: 'Active ok', contentNumber: 200, ...local }, // open → ok
      { status: 'Done', title: 'Terminal', contentNumber: 999, ...local }, // terminal → filtered + never flagged
    ]);
    await runJson();
    const r = parseJson();
    expect(r.board).toEqual([
      { status: 'In Progress', title: 'Active drift', contentNumber: 100 },
      { status: 'In Review', title: 'Active ok', contentNumber: 200 },
    ]);
    expect(r.coherence).toEqual([
      {
        boardItemTitle: 'Active drift',
        boardStatus: 'In Progress',
        issueNumber: 100,
        kind: 'issue-closed-or-absent',
      },
    ]);
    // JSON consumers can tell a configured board apart from an unconfigured one.
    expect(r.boardConfigured).toBe(true);
  });

  // Regression for the #2044 controller-review bug: GH Project #1 is an org board
  // spanning repos. A card for a (still-open) strategy issue must SHOW on the board
  // but NEVER be flagged as drift against THIS repo's open-issue set.
  it('shows cross-repo cards on the board but never flags them as drift', async () => {
    mockFetchOpenIssuesWithBody.mockReturnValue([]); // this repo has no open issues
    mockFetchBoardItems.mockReturnValue([
      {
        status: 'In Progress',
        title: 'Strategy work',
        contentNumber: 433,
        contentRepo: 'mmnto-ai/totem-strategy', // different repo
        contentType: 'Issue',
      },
    ]);
    await runJson();
    const r = parseJson();
    // Shown on the org board view…
    expect(r.board).toEqual([
      { status: 'In Progress', title: 'Strategy work', contentNumber: 433 },
    ]);
    // …but NOT flagged — #433 lives in another repo, not this repo's issue set.
    expect(r.coherence).toEqual([]);
  });
});

// ─── Honest absence: no board configured ────────────────

describe('orient honest-absence (no board configured)', () => {
  it('renders an honest "no board configured" line, not an error', async () => {
    // No env, no config field → board absent (configured=false).
    mockLoadConfig.mockResolvedValue({ orient: undefined });
    await orientCommand({ json: false });
    expect(stdout).toContain('no board configured (set orient.projectNumber');
    expect(stdout).not.toContain('could not derive');
  });

  it('marks boardConfigured:false in --json so consumers tell it apart from an empty board', async () => {
    // Unconfigured board and a configured-but-empty board both have `board: []`;
    // the boolean is the only signal that disambiguates them for a JSON pipe.
    mockLoadConfig.mockResolvedValue({ orient: undefined });
    await runJson();
    const r = parseJson();
    expect(r.board).toEqual([]);
    expect(r.boardConfigured).toBe(false);
  });

  it('renders "freshness unknown — not yet synced" when no registry entry matches', async () => {
    mockReadRegistry.mockReturnValue({});
    await orientCommand({ json: false });
    expect(stdout).toContain('freshness unknown — not yet synced');
  });
});

// ─── Fail loud, not silent absence: malformed board config ──
//
// A user who SET TOTEM_ORIENT_PROJECT expects a board; a non-numeric value must
// surface as a loud { error } (Tenet 4), NOT masquerade as "no board configured".
describe('orient fail-loud on invalid board config', () => {
  it('a non-numeric TOTEM_ORIENT_PROJECT surfaces a board { error }, not honest absence', async () => {
    process.env['TOTEM_ORIENT_PROJECT'] = 'my-project';
    await runJson();
    const r = parseJson();
    expect(r.board).toHaveProperty('error', expect.stringMatching(/TOTEM_ORIENT_PROJECT/));
    // configured:true — the user DID configure (just malformed), so it's not "no board".
    expect(r.boardConfigured).toBe(true);
    // Board fetch is never attempted for an invalid number (no extra gh call).
    expect(mockFetchBoardItems).not.toHaveBeenCalled();
  });

  it('renders the malformed-config error loudly, not the "no board configured" line', async () => {
    process.env['TOTEM_ORIENT_PROJECT'] = 'not-a-number';
    await orientCommand({ json: false });
    expect(stdout).toContain('could not derive');
    expect(stdout).not.toContain('no board configured');
  });
});

// ─── --json and human render share board filter + coherence ─

describe('orient --json and human render parity', () => {
  beforeEach(() => {
    process.env['TOTEM_ORIENT_PROJECT'] = '1';
  });

  it('both surfaces honor the same active-board filter and coherence set', async () => {
    mockFetchOpenIssuesWithBody.mockReturnValue([]);
    mockFetchBoardItems.mockReturnValue([
      {
        status: 'In Progress',
        title: 'Drifting card',
        contentNumber: 77,
        contentRepo: 'mmnto-ai/totem',
        contentType: 'Issue',
      },
      { status: 'Todo', title: 'Hidden todo', contentNumber: 88 },
    ]);

    // JSON surface
    await runJson();
    const r = parseJson();
    expect(r.board).toHaveLength(1);
    expect(r.board).toEqual([{ status: 'In Progress', title: 'Drifting card', contentNumber: 77 }]);
    expect(r.coherence).toHaveLength(1);

    // Human surface, rendered from the SAME report
    const human = renderReport(r);
    expect(human).toContain('Drifting card');
    expect(human).not.toContain('Hidden todo'); // Todo filtered out of the active board
    expect(human).toContain('issue #77 is closed/absent'); // same coherence flag
  });
});

// ─── Footer + embedder tripwire ─────────────────────────

describe('orient footer and #2018 structural guard', () => {
  it('always emits the snapshot-not-source + perceptual-carve-out footer', async () => {
    await orientCommand({ json: false });
    expect(stdout).toContain('this output is a');
    expect(stdout).toContain('snapshot/cache, not a source');
    expect(stdout).toContain('Deeper judgment is perceptual');
    expect(stdout).toContain('ask the human');
  });

  it('never reaches the embedder (runs green with @google/genai absent)', async () => {
    await orientCommand({ json: false });
    expect(embedderTripwire).not.toHaveBeenCalled();
  });
});

// ─── PR-2: programmatic entry + session-start projection (mmnto-ai/totem#2044) ──

describe('deriveOrientReport — one derivation, two callers (cannot diverge)', () => {
  it('returns the SAME report `orient --json` serializes (modulo the derivedAt stamp)', async () => {
    // A small but non-empty world so the comparison is meaningful.
    mockFetchOpenPRs.mockReturnValue([
      { number: 42, title: 'do thing', headRefName: 'feat/x', isDraft: false },
    ]);
    mockFetchOpenIssuesWithBody.mockReturnValue([
      { number: 7, title: 'Other Seven', body: '', labels: [] },
    ]);

    await runJson();
    const fromCommand = parseJson();
    const fromApi = await deriveOrientReport(repoRoot);

    // derivedAt is a wall-clock stamp set per call — the only field allowed to differ.
    const { derivedAt: _a, ...cmdRest } = fromCommand;
    const { derivedAt: _b, ...apiRest } = fromApi;
    expect(apiRest).toEqual(cmdRest);
  });
});

describe('renderOrientForSession — bounded Tier-A projection', () => {
  function makeReport(overrides: Partial<OrientReport> = {}): OrientReport {
    return {
      repo: 'mmnto-ai/totem',
      derivedAt: '2026-06-01T00:00:00.000Z',
      indexFreshness: { synced: false },
      parked: [],
      openPRs: [],
      board: [],
      coherence: [],
      epics: [],
      otherOpenIssues: [],
      boardConfigured: false,
      ...overrides,
    };
  }

  it('surfaces high-value signals (parked, open PR, coherence drift) + a counts pointer', () => {
    const block = renderOrientForSession(
      makeReport({
        parked: [{ subsystem: 'embedder', since: '2026-01-01' }],
        openPRs: [{ number: 42, title: 'do thing', headRefName: 'feat/x', isDraft: false }],
        coherence: [
          {
            boardItemTitle: 'Stale card',
            boardStatus: 'In Progress',
            issueNumber: 99,
            kind: 'issue-closed-or-absent',
          },
        ],
        epics: [{ number: 1, title: 'Epic One', labels: ['type: epic'], subIssues: [] }],
        otherOpenIssues: [{ number: 7, title: 'Other Seven', labels: [] }],
      }),
    );
    expect(block).toContain('embedder'); // parked subsystem
    expect(block).toContain('#42'); // open PR
    expect(block).toContain('do thing');
    expect(block).toContain('#99'); // coherence drift
    expect(block).toContain('1 epic · 1 other open issue'); // counts pointer
    expect(block).toContain('run `totem orient`');
  });

  it('NEVER enumerates epics / children / other issues (the #467 Tier-A-lean guard)', () => {
    const block = renderOrientForSession(
      makeReport({
        epics: [
          {
            number: 1,
            title: 'Epic One',
            labels: ['type: epic'],
            subIssues: [{ number: 2, title: 'Child Two' }],
          },
        ],
        otherOpenIssues: [{ number: 7, title: 'Other Seven', labels: [] }],
      }),
    );
    // Counts only — the titles must not appear (pointers not bodies).
    expect(block).toContain('1 epic · 1 other open issue');
    expect(block).not.toContain('Epic One');
    expect(block).not.toContain('Child Two');
    expect(block).not.toContain('Other Seven');
  });

  it('an {error} section renders a fail-loud `⚠ could not derive` line, never a silent omit', () => {
    const parkedErr = renderOrientForSession(
      makeReport({ parked: { error: 'freeze.json unreadable' } }),
    );
    expect(parkedErr).toContain('⚠ could not derive');
    expect(parkedErr).toContain('freeze.json unreadable');

    // epics + otherOpenIssues share deriveIssues → one issues error line.
    const issuesErr = renderOrientForSession(
      makeReport({
        epics: { error: 'gh issue list exploded' },
        otherOpenIssues: { error: 'gh issue list exploded' },
      }),
    );
    expect(issuesErr).toContain('issues: ⚠ could not derive: gh issue list exploded');
  });

  it('surfaces an otherOpenIssues error that splits independently from epics (Tenet 4 type-gap)', () => {
    // toReport couples these today, but the type permits the split — a derived
    // `epics` with an errored `otherOpenIssues` must still fail loud, not coerce
    // the count to 0 silently.
    const block = renderOrientForSession(
      makeReport({
        epics: [{ number: 1, title: 'Epic One', labels: ['type: epic'], subIssues: [] }],
        otherOpenIssues: { error: 'gh issue list (others) exploded' },
      }),
    );
    expect(block).toContain(
      'other open issues: ⚠ could not derive: gh issue list (others) exploded',
    );
    expect(block).toContain('1 epic'); // epics still surface
  });

  it('returns "" when there is nothing high-signal (so the hook omits the block)', () => {
    expect(renderOrientForSession(makeReport())).toBe('');
    // A zero count must NOT emit a "0 epics" pointer line.
    expect(renderOrientForSession(makeReport({ epics: [], otherOpenIssues: [] }))).toBe('');
  });

  it('is HARD-BOUNDED — long content cannot blow past the char cap (net-neutral-truncation guardrail)', () => {
    // Within the per-section item cap (10) but with long titles, so the CHAR
    // ceiling — not the item cap — is what bounds the block.
    const longTitle = 'x'.repeat(300);
    const prs = Array.from({ length: 10 }, (_, i) => ({
      number: i,
      title: longTitle,
      headRefName: `feat/branch-${i}`,
      isDraft: false,
    }));
    const block = renderOrientForSession(makeReport({ openPRs: prs }));
    // Bounded: ≤ SESSION_BLOCK_MAX_CHARS (1500) plus the short truncation marker.
    expect(block.length).toBeLessThanOrEqual(1500 + 32);
    expect(block).toContain('…(orient block truncated)');
  });

  it('caps per-section item counts with a "… and N more" overflow line', () => {
    const flood = Array.from({ length: 25 }, (_, i) => ({
      number: i,
      title: `t${i}`,
      headRefName: `b${i}`,
      isDraft: false,
    }));
    const block = renderOrientForSession(makeReport({ openPRs: flood }));
    expect(block).toContain('more open PRs');
  });
});

// ─── orient --session — boot-safe SessionStart projection (PR-3, #2044) ──

describe('orient --session — boot-safe SessionStart projection', () => {
  it('emits the bounded session projection to stdout when there is high-signal state', async () => {
    mockFetchOpenPRs.mockReturnValue([
      { number: 42, title: 'wire orient', headRefName: 'feat/orient', isDraft: false },
    ]);
    await orientCommand({ session: true });
    // The bounded `renderOrientForSession` projection — header + the PR line…
    expect(stdout).toContain('orient (derived state)');
    expect(stdout).toContain('◐ PR #42');
    // …NOT the full human render (that's `orient` without --session): no full
    // banner header, no footer. The two surfaces must not be confused.
    expect(stdout).not.toContain('═══ totem orient');
    expect(stdout).not.toContain('end orient. State derives');
  });

  it('emits NOTHING when there is no high-signal state (so the hook omits the block)', async () => {
    // beforeEach defaults: no PRs / issues / board / freeze → projection is "".
    await orientCommand({ session: true });
    expect(stdout).toBe('');
  });

  it('is boot-safe — a section failure surfaces a fail-loud line but never rejects', async () => {
    // A malformed freeze.json makes the REAL readFreezeConfig throw, isolating the
    // parked section to { error } (no thrown derivation). Proves the session path
    // RESOLVES — a SessionStart hook must never crash the boot (lesson 8d363778) —
    // AND surfaces the failure loudly (Tenet 4), never a silent blank.
    fs.writeFileSync(path.join(tmpRoot, '.totem', 'freeze.json'), '{ not valid json');
    await expect(orientCommand({ session: true })).resolves.toBeUndefined();
    expect(stdout).toContain('could not derive');
  });

  it('with --json: surfaces an ignored-flag note on stderr, still renders the raw block (not JSON)', async () => {
    mockFetchOpenPRs.mockReturnValue([
      { number: 42, title: 'wire orient', headRefName: 'feat/orient', isDraft: false },
    ]);
    let stderr = '';
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
      });
    await orientCommand({ session: true, json: true });
    errSpy.mockRestore();
    // The ignored --json is surfaced (not silently dropped) — greptile mmnto-ai/totem#2062 G2.
    expect(stderr).toContain('--json ignored');
    // …and stdout is still the bounded session projection, NOT the JSON report.
    expect(stdout).toContain('◐ PR #42');
    expect(stdout).not.toContain('"openPRs"');
  });
});
