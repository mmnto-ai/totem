import { describe, expect, it } from 'vitest';

import type { AuditProposal } from './audit.js';
import { formatProposalTable, parseAuditResponse } from './audit.js';

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
