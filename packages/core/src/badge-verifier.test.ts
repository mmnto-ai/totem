import { describe, expect, it } from 'vitest';

import {
  BadgeVerificationResultSchema,
  DEFAULT_TOOL_INTEGRATIONS,
  extractBadgesFromDiff,
  type ExtractedBadge,
  type ToolIntegrationConfig,
  ToolIntegrationConfigSchema,
  verifySelfReferenceLinks,
  verifyToolClaims,
} from './badge-verifier.js';

function makeBadge(overrides: Partial<ExtractedBadge> = {}): ExtractedBadge {
  return {
    rawUrl: 'https://img.shields.io/badge/x-y-blue',
    altText: '',
    label: 'x',
    message: 'y',
    file: 'README.md',
    lineNumber: 1,
    ...overrides,
  };
}

const README_DIFF_HEADER = `diff --git a/README.md b/README.md
index aaaaaa..bbbbbb 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,5 @@\n`;

const DIFF_NOT_README_HEADER = `diff --git a/docs/other.md b/docs/other.md
index aaaaaa..bbbbbb 100644
--- a/docs/other.md
+++ b/docs/other.md
@@ -1,5 +1,5 @@\n`;

describe('badge-verifier — schemas', () => {
  it('ToolIntegrationConfigSchema accepts a mapping of tool name to path list', () => {
    const parsed = ToolIntegrationConfigSchema.parse({
      claude: ['.claude/', 'CLAUDE.md'],
      gemini: ['.gemini/'],
    });
    expect(parsed.claude).toEqual(['.claude/', 'CLAUDE.md']);
  });

  it('ToolIntegrationConfigSchema rejects empty path arrays', () => {
    expect(() => ToolIntegrationConfigSchema.parse({ claude: [] })).toThrow();
  });

  it('BadgeVerificationResultSchema valid===true iff errors empty', () => {
    const ok = BadgeVerificationResultSchema.parse({
      valid: true,
      errors: [],
      warnings: ['something'],
    });
    expect(ok.valid).toBe(true);
    expect(ok.warnings).toHaveLength(1);
  });

  it('DEFAULT_TOOL_INTEGRATIONS includes the 5 tools named in mmnto-ai/totem#1924', () => {
    expect(Object.keys(DEFAULT_TOOL_INTEGRATIONS).sort()).toEqual([
      'claude',
      'copilot',
      'cursor',
      'gemini',
      'windsurf',
    ]);
    // Every tool has at least one falsifying path
    for (const [, paths] of Object.entries(DEFAULT_TOOL_INTEGRATIONS)) {
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});

describe('badge-verifier — extractBadgesFromDiff', () => {
  it('extracts url, decoded text, and link target from complex multiline diffs', () => {
    // The TEST DIRECTIVE from spec — proves shields.io URL encoding (_, --) decodes correctly.
    const diff =
      README_DIFF_HEADER +
      ` # Totem\n` +
      `+[![Tool-agnostic](https://img.shields.io/badge/Tool--agnostic-AGENTS.md-blue)](./AGENTS.md)\n` +
      `+[![Build Status](https://img.shields.io/badge/build-passing-green)](https://example.com/ci)\n` +
      `+Some text with [![Hello World](https://img.shields.io/badge/Hello_World-yes-blue)](https://example.com)\n` +
      ` ## Other\n`;

    const badges = extractBadgesFromDiff(diff);

    expect(badges).toHaveLength(3);
    expect(badges[0]).toMatchObject({
      rawUrl: 'https://img.shields.io/badge/Tool--agnostic-AGENTS.md-blue',
      label: 'Tool-agnostic',
      message: 'AGENTS.md',
      linkTarget: './AGENTS.md',
      file: 'README.md',
    });
    expect(badges[1]).toMatchObject({
      rawUrl: 'https://img.shields.io/badge/build-passing-green',
      label: 'build',
      message: 'passing',
      linkTarget: 'https://example.com/ci',
    });
    expect(badges[2]).toMatchObject({
      label: 'Hello World',
      message: 'yes',
    });
  });

  it('ignores - (removed) lines', () => {
    const diff =
      README_DIFF_HEADER +
      ` # Totem\n` +
      `-[![Old](https://img.shields.io/badge/Old-badge-red)](./old.md)\n` +
      `+[![New](https://img.shields.io/badge/New-badge-green)](./new.md)\n`;

    const badges = extractBadgesFromDiff(diff);
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe('New');
  });

  it('ignores badges in files other than README.md', () => {
    const diff =
      DIFF_NOT_README_HEADER +
      ` text\n` +
      `+[![Tool](https://img.shields.io/badge/Tool-agnostic-blue)](./foo.md)\n`;

    expect(extractBadgesFromDiff(diff)).toHaveLength(0);
  });

  it('handles badge without surrounding markdown link', () => {
    const diff = README_DIFF_HEADER + `+![alt](https://img.shields.io/badge/MIT-License-green)\n`;

    const badges = extractBadgesFromDiff(diff);
    expect(badges).toHaveLength(1);
    expect(badges[0]?.linkTarget).toBeUndefined();
    expect(badges[0]?.label).toBe('MIT');
    expect(badges[0]?.message).toBe('License');
  });

  it('decodes percent-encoded characters in label/message', () => {
    const diff =
      README_DIFF_HEADER +
      `+[![X](https://img.shields.io/badge/Apache%202.0-license-blue)](./LICENSE)\n`;

    const badges = extractBadgesFromDiff(diff);
    expect(badges[0]?.label).toBe('Apache 2.0');
  });

  it('treats 2-part shields URLs (/<MESSAGE>-<COLOR>) as empty-label per shields.io spec', () => {
    // GCA review on mmnto-ai/totem#1934: `/badge/Claude-blue` means MESSAGE=Claude,
    // COLOR=blue, LABEL=''. Without the 2-part branch, "Claude" lands in label,
    // and downstream consumers that key on label vs message misidentify.
    const diff =
      README_DIFF_HEADER + `+[![X](https://img.shields.io/badge/Claude-blue)](https://claude.ai)\n`;
    const badges = extractBadgesFromDiff(diff);
    expect(badges[0]?.label).toBe('');
    expect(badges[0]?.message).toBe('Claude');
  });

  it('returns empty array when diff has no README.md changes', () => {
    expect(extractBadgesFromDiff('')).toEqual([]);
    expect(extractBadgesFromDiff(DIFF_NOT_README_HEADER + ` text\n+more text\n`)).toEqual([]);
  });
});

describe('badge-verifier — verifyToolClaims', () => {
  const config = DEFAULT_TOOL_INTEGRATIONS;
  const noPathsExist = (_p: string) => false;
  const allPathsExist = (_p: string) => true;

  it('returns 2 errors when badge claims Claude and Cursor but neither integration file exists', () => {
    const badge = makeBadge({ label: 'Tool', message: 'Claude · Cursor' });
    const errors = verifyToolClaims([badge], config, '/repo', noPathsExist);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.toLowerCase().includes('claude'))).toBe(true);
    expect(errors.some((e) => e.toLowerCase().includes('cursor'))).toBe(true);
  });

  it('returns 0 errors when at least one config path exists for the claimed tool', () => {
    const badge = makeBadge({ label: 'Integration', message: 'Claude' });
    const errors = verifyToolClaims([badge], config, '/repo', (p) => p.endsWith('CLAUDE.md'));
    expect(errors).toHaveLength(0);
  });

  it('returns 0 errors when no tool name appears in badge text', () => {
    const badge = makeBadge({ label: 'build', message: 'passing' });
    const errors = verifyToolClaims([badge], config, '/repo', noPathsExist);
    expect(errors).toHaveLength(0);
  });

  it('matches tool names case-insensitively with word boundaries', () => {
    // "claudette" should NOT match "claude" — word-boundary required.
    const badge1 = makeBadge({ message: 'claudette' });
    expect(verifyToolClaims([badge1], config, '/repo', noPathsExist)).toHaveLength(0);
    // "CLAUDE" uppercase should match.
    const badge2 = makeBadge({ message: 'CLAUDE' });
    expect(verifyToolClaims([badge2], config, '/repo', noPathsExist)).toHaveLength(1);
  });

  it('does not double-count tools that appear in both label and message', () => {
    const badge = makeBadge({ label: 'Claude', message: 'Claude integration' });
    const errors = verifyToolClaims([badge], config, '/repo', noPathsExist);
    expect(errors).toHaveLength(1);
  });

  it('error message names the tool and at least one expected path', () => {
    const badge = makeBadge({ message: 'gemini' });
    const errors = verifyToolClaims([badge], config, '/repo', noPathsExist);
    expect(errors[0]).toContain('gemini');
    expect(errors[0]).toMatch(/\.gemini\/|GEMINI\.md/);
  });

  it('passes through cleanly when all paths exist', () => {
    const badge = makeBadge({ message: 'Claude Gemini Cursor' });
    expect(verifyToolClaims([badge], config, '/repo', allPathsExist)).toHaveLength(0);
  });

  it('rejects configured paths that escape repoRoot via .. traversal', () => {
    // CR review on mmnto-ai/totem#1934: a configured path like '../CLAUDE.md' would
    // satisfy the claim with a file outside the repo, defeating the falsifying metric.
    const escapeConfig: ToolIntegrationConfig = {
      claude: ['../CLAUDE.md', '../../CLAUDE.md'],
    };
    const badge = makeBadge({ message: 'Claude' });
    // Predicate returns true for everything — but the path-escape guard must filter
    // before existence-checking, so we still get an error.
    const errors = verifyToolClaims([badge], escapeConfig, '/repo/root', () => true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/claude/i);
  });
});

describe('badge-verifier — verifySelfReferenceLinks', () => {
  it('rejects AGENTS.md badge pointing to internal ADR instead of canonical standard', () => {
    // The TEST DIRECTIVE from spec — circular claim: badge claims AGENTS.md compliance
    // but links to an internal ADR (not the upstream standard).
    const badge = makeBadge({
      label: 'AGENTS.md',
      message: 'compliant',
      linkTarget: 'https://github.com/mmnto-ai/totem/blob/main/docs/ADR-038.md',
    });
    const errors = verifySelfReferenceLinks([badge]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/AGENTS\.md|self-reference|internal/i);
  });

  it('rejects standard-claim badge linked to a relative internal path', () => {
    const badge = makeBadge({
      label: 'MIT',
      message: 'license',
      linkTarget: './docs/licensing.md',
    });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(1);
  });

  it('rejects standard-claim badge linked to mmnto-ai/<anything>', () => {
    const badge = makeBadge({
      label: 'Apache 2.0',
      message: 'license',
      linkTarget: 'https://github.com/mmnto-ai/totem-strategy',
    });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(1);
  });

  it('accepts AGENTS.md badge linked to canonical upstream', () => {
    const badge = makeBadge({
      label: 'AGENTS.md',
      message: 'compliant',
      linkTarget: 'https://agents.md/',
    });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(0);
  });

  it('accepts MIT badge linked to opensource.org', () => {
    const badge = makeBadge({
      label: 'MIT',
      message: 'license',
      linkTarget: 'https://opensource.org/licenses/MIT',
    });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(0);
  });

  it('ignores non-standard-claim badges entirely (no self-reference check)', () => {
    const badge = makeBadge({
      label: 'build',
      message: 'passing',
      linkTarget: './docs/ci.md',
    });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(0);
  });

  it('ignores standard-claim badges with no link target', () => {
    const badge = makeBadge({ label: 'AGENTS.md', message: 'compliant' });
    expect(verifySelfReferenceLinks([badge])).toHaveLength(0);
  });

  it('flags bare relative paths like LICENSE or docs/ADR-038.md as internal', () => {
    // CR review on mmnto-ai/totem#1934: hardcoded `./` / `../` regex missed bare
    // README-relative targets. Inversion: anything without http(s):// is internal.
    const cases: Array<{ linkTarget: string; expectFlag: boolean }> = [
      { linkTarget: 'LICENSE', expectFlag: true },
      { linkTarget: 'docs/ADR-038.md', expectFlag: true },
      { linkTarget: 'AGENTS.md', expectFlag: true },
      { linkTarget: './AGENTS.md', expectFlag: true },
      { linkTarget: '../AGENTS.md', expectFlag: true },
      { linkTarget: 'https://agents.md/', expectFlag: false },
      { linkTarget: 'http://opensource.org/licenses/MIT', expectFlag: false },
    ];
    for (const { linkTarget, expectFlag } of cases) {
      const badge = makeBadge({ label: 'AGENTS.md', message: 'compliant', linkTarget });
      const errors = verifySelfReferenceLinks([badge]);
      expect(errors).toHaveLength(expectFlag ? 1 : 0);
    }
  });
});
