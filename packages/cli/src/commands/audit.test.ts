import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditProposal } from './audit.js';
import {
  executeProposals,
  formatProposalTable,
  loadStrategicDocs,
  MAX_STRATEGIC_CONTEXT_CHARS,
  parseAuditResponse,
  selectProposals,
  validateMergeTargets,
} from './audit.js';

// ─── parseAuditResponse ─────────────────────────────────

describe('parseAuditResponse', () => {
  it('parses valid proposals from XML-wrapped JSON', () => {
    const content = `Here are my proposals:
<audit_proposals>
[
  { "number": 42, "title": "Widget support", "action": "KEEP", "rationale": "Aligns with roadmap." },
  { "number": 99, "title": "Legacy auth", "action": "CLOSE", "rationale": "Superseded by #150." }
]
</audit_proposals>`;

    const proposals = parseAuditResponse(content);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toEqual({
      number: 42,
      title: 'Widget support',
      action: 'KEEP',
      newTier: undefined,
      mergeInto: undefined,
      rationale: 'Aligns with roadmap.',
    });
    expect(proposals[1]!.action).toBe('CLOSE');
  });

  it('parses REPRIORITIZE with newTier', () => {
    const content = `<audit_proposals>
[{ "number": 55, "title": "Perf", "action": "REPRIORITIZE", "newTier": "tier-3", "rationale": "Defer." }]
</audit_proposals>`;

    const proposals = parseAuditResponse(content);
    expect(proposals[0]!.newTier).toBe('tier-3');
  });

  it('parses MERGE with mergeInto', () => {
    const content = `<audit_proposals>
[{ "number": 88, "title": "Colors", "action": "MERGE", "mergeInto": 42, "rationale": "Subset of #42." }]
</audit_proposals>`;

    const proposals = parseAuditResponse(content);
    expect(proposals[0]!.mergeInto).toBe(42);
  });

  it('normalizes action case', () => {
    const content = `<audit_proposals>
[{ "number": 1, "title": "Test", "action": "close", "rationale": "Done." }]
</audit_proposals>`;

    const proposals = parseAuditResponse(content);
    expect(proposals[0]!.action).toBe('CLOSE');
  });

  it('throws on missing XML wrapper', () => {
    expect(() => parseAuditResponse('Just some text without tags')).toThrow(
      'missing <audit_proposals> wrapper',
    );
  });

  it('throws on invalid JSON inside tags', () => {
    const content = '<audit_proposals>not json</audit_proposals>';
    expect(() => parseAuditResponse(content)).toThrow('Failed to parse');
  });

  it('throws on non-array JSON', () => {
    const content = '<audit_proposals>{"number": 1}</audit_proposals>';
    expect(() => parseAuditResponse(content)).toThrow('must be a JSON array');
  });

  it('throws on invalid action', () => {
    const content = `<audit_proposals>
[{ "number": 1, "title": "Test", "action": "DELETE", "rationale": "Bad." }]
</audit_proposals>`;
    expect(() => parseAuditResponse(content)).toThrow('Invalid action "DELETE"');
  });
});

// ─── formatProposalTable ────────────────────────────────

describe('formatProposalTable', () => {
  const proposals: AuditProposal[] = [
    { number: 42, title: 'Widget support', action: 'KEEP', rationale: 'Good.' },
    {
      number: 55,
      title: 'Perf',
      action: 'REPRIORITIZE',
      newTier: 'tier-3',
      rationale: 'Defer.',
    },
    { number: 88, title: 'Colors', action: 'MERGE', mergeInto: 42, rationale: 'Subset.' },
    { number: 99, title: 'Legacy', action: 'CLOSE', rationale: 'Obsolete.' },
  ];

  it('generates a markdown table with all proposals', () => {
    const table = formatProposalTable(proposals);
    expect(table).toContain('| Issue | Title | Action | Rationale |');
    expect(table).toContain('#42');
    expect(table).toContain('#99');
  });

  it('shows tier for REPRIORITIZE', () => {
    const table = formatProposalTable(proposals);
    expect(table).toContain('REPRI → tier-3');
  });

  it('shows merge target for MERGE', () => {
    const table = formatProposalTable(proposals);
    expect(table).toContain('MERGE → #42');
  });

  it('handles empty array', () => {
    const table = formatProposalTable([]);
    const lines = table.split('\n');
    expect(lines).toHaveLength(2); // header + separator only
  });
});

// ─── validateMergeTargets ───────────────────────────────

describe('validateMergeTargets', () => {
  it('returns empty array when all merge targets are valid', () => {
    const proposals: AuditProposal[] = [
      { number: 88, title: 'Colors', action: 'MERGE', mergeInto: 42, rationale: 'Subset.' },
    ];
    const errors = validateMergeTargets(proposals, new Set([42, 88, 99]));
    expect(errors).toHaveLength(0);
  });

  it('returns errors for invalid merge targets', () => {
    const proposals: AuditProposal[] = [
      { number: 88, title: 'Colors', action: 'MERGE', mergeInto: 999, rationale: 'Bad.' },
    ];
    const errors = validateMergeTargets(proposals, new Set([42, 88]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('#999');
    expect(errors[0]).toContain('not in the backlog');
  });

  it('ignores non-MERGE proposals', () => {
    const proposals: AuditProposal[] = [
      { number: 42, title: 'Widget', action: 'KEEP', rationale: 'Good.' },
      { number: 99, title: 'Legacy', action: 'CLOSE', rationale: 'Old.' },
    ];
    const errors = validateMergeTargets(proposals, new Set([42]));
    expect(errors).toHaveLength(0);
  });
});

// ─── selectProposals ────────────────────────────────────

describe('selectProposals', () => {
  const proposals: AuditProposal[] = [
    { number: 42, title: 'Widget', action: 'KEEP', rationale: 'Good.' },
    { number: 99, title: 'Legacy', action: 'CLOSE', rationale: 'Obsolete.' },
    { number: 55, title: 'Perf', action: 'REPRIORITIZE', newTier: 'tier-3', rationale: 'Defer.' },
  ];

  it('returns all actionable proposals in --yes mode', async () => {
    const selected = await selectProposals(proposals, { yes: true, isTTY: false });
    expect(selected).toHaveLength(2); // CLOSE + REPRIORITIZE, not KEEP
    expect(selected.map((p) => p.number)).toEqual([99, 55]);
  });

  it('returns empty array when all proposals are KEEP', async () => {
    const keepOnly: AuditProposal[] = [
      { number: 1, title: 'A', action: 'KEEP', rationale: 'Good.' },
      { number: 2, title: 'B', action: 'KEEP', rationale: 'Good.' },
    ];
    const selected = await selectProposals(keepOnly, { yes: true, isTTY: false });
    expect(selected).toHaveLength(0);
  });

  it('throws in non-TTY without --yes', async () => {
    await expect(selectProposals(proposals, { yes: false, isTTY: false })).rejects.toThrow(
      'non-interactive mode',
    );
  });
});

// ─── executeProposals ───────────────────────────────────

vi.mock('../adapters/gh-utils.js', () => ({
  ghExec: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ghExec: mockGhExec } =
  await vi.importMock<typeof import('../adapters/gh-utils.js')>('../adapters/gh-utils.js');

describe('executeProposals', () => {
  beforeEach(() => {
    vi.mocked(mockGhExec).mockReset();
  });

  it('closes issues with comment and close commands', () => {
    const proposals: AuditProposal[] = [
      { number: 99, title: 'Legacy', action: 'CLOSE', rationale: 'Done.' },
    ];
    const result = executeProposals(proposals, '/tmp/test');
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    // ghExec called for: comment (--body-file) + close
    expect(vi.mocked(mockGhExec)).toHaveBeenCalledTimes(2);
  });

  it('continues on failure and reports errors', () => {
    vi.mocked(mockGhExec).mockImplementationOnce(() => {
      throw new Error('rate limit');
    });
    const proposals: AuditProposal[] = [
      { number: 99, title: 'Legacy', action: 'CLOSE', rationale: 'Done.' },
      { number: 55, title: 'Perf', action: 'CLOSE', rationale: 'Old.' },
    ];
    const result = executeProposals(proposals, '/tmp/test');
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('#99');
  });

  it('skips KEEP proposals', () => {
    const proposals: AuditProposal[] = [
      { number: 42, title: 'Widget', action: 'KEEP', rationale: 'Good.' },
    ];
    const result = executeProposals(proposals, '/tmp/test');
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(vi.mocked(mockGhExec)).not.toHaveBeenCalled();
  });

  it('reports error when REPRIORITIZE missing newTier', () => {
    const proposals: AuditProposal[] = [
      { number: 55, title: 'Perf', action: 'REPRIORITIZE', rationale: 'Defer.' },
    ];
    const result = executeProposals(proposals, '/tmp/test');
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.errors[0]).toContain('missing newTier');
  });

  it('reports error when MERGE missing mergeInto', () => {
    const proposals: AuditProposal[] = [
      { number: 88, title: 'Colors', action: 'MERGE', rationale: 'Subset.' },
    ];
    const result = executeProposals(proposals, '/tmp/test');
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.errors[0]).toContain('missing mergeInto');
  });
});

// ─── loadStrategicDocs ──────────────────────────────────

describe('loadStrategicDocs', () => {
  it('truncates when content exceeds MAX_STRATEGIC_CONTEXT_CHARS', () => {
    // Create a temp dir with a massive file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-audit-test-'));
    const strategyDir = path.join(tmpDir, '.strategy');
    fs.mkdirSync(strategyDir, { recursive: true });
    const bigContent = 'x'.repeat(MAX_STRATEGIC_CONTEXT_CHARS + 10_000);
    fs.writeFileSync(path.join(strategyDir, 'big.md'), bigContent);

    try {
      const result = loadStrategicDocs(tmpDir);
      expect(result.length).toBeLessThanOrEqual(MAX_STRATEGIC_CONTEXT_CHARS);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty string when no strategic docs exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-audit-test-'));
    try {
      const result = loadStrategicDocs(tmpDir);
      expect(result).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
