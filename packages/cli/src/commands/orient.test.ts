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

import { orientCommand, type OrientReport, renderReport } from './orient.js';

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
    mockFetchBoardItems.mockReturnValue([
      { status: 'In Progress', title: 'Active drift', contentNumber: 100 }, // #100 not open → drift
      { status: 'In Review', title: 'Active ok', contentNumber: 200 }, // open → ok
      { status: 'Done', title: 'Terminal', contentNumber: 999 }, // terminal → filtered + never flagged
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

  it('renders "freshness unknown — not yet synced" when no registry entry matches', async () => {
    mockReadRegistry.mockReturnValue({});
    await orientCommand({ json: false });
    expect(stdout).toContain('freshness unknown — not yet synced');
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
      { status: 'In Progress', title: 'Drifting card', contentNumber: 77 },
      { status: 'Todo', title: 'Hidden todo', contentNumber: 88 },
    ]);

    // JSON surface
    await runJson();
    const r = parseJson();
    expect(r.board).toHaveLength(1);
    expect(r.board).toEqual([{ status: 'In Progress', title: 'Drifting card', contentNumber: 77 }]);
    expect(r.coherence).toHaveLength(1);

    // Human surface, rendered from the SAME report
    const human = renderReport(r, true);
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
