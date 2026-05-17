import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { doctorClaimDisciplineCommand } from './doctor-claim-discipline.js';

// ─── Helpers ────────────────────────────────────────────

interface RuleFixture {
  lessonHash: string;
  lessonHeading: string;
  pattern: string;
  engine?: string;
  severity?: 'error' | 'warning';
  fileGlobs?: string[];
  message?: string;
  compiledAt?: string;
  status?: string;
}

function buildRulesFile(rules: RuleFixture[]): string {
  return JSON.stringify(
    {
      version: 1,
      rules: rules.map((r) => ({
        compiledAt: '2026-05-16T00:00:00.000Z',
        message: r.lessonHeading,
        engine: 'regex',
        severity: 'warning',
        ...r,
      })),
    },
    null,
    2,
  );
}

const ABSOLUTE_PROMISE_PATTERN =
  "\\b(?:[Ww]ill\\s+(?:stay|remain|always\\s+be|never\\s+(?:change|move))|[Ww]on['']t\\s+(?:change|ever)|[Gg]uarantees|[Pp]romises\\s+to)\\b";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-claim-disc-'));
  fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── doctorClaimDisciplineCommand ───────────────────────

describe('doctorClaimDisciplineCommand', () => {
  it('returns valid+no-findings when no in-scope surfaces exist', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.bypassed).toBe(false);
  });

  it('returns valid+inert-warning when in-scope surfaces exist but no WWND rules compiled', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\n\nClean prose.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'bbb1111111111111',
          lessonHeading: 'Some unrelated rule',
          pattern: 'XYZ',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('No WWND rules found'))).toBe(true);
  });

  it('fires Rule 1 on absolute-promise prose in README.md', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      '# Project\n\nThe core will always be free. We guarantees this.\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    // "will always be" should match
    expect(result.findings.some((f) => /will\s+always\s+be/i.test(f.match))).toBe(true);
    // All findings should be warning severity (Rule 1 default)
    expect(result.findings.every((f) => f.severity === 'warning')).toBe(true);
    // Validity: warning-severity findings don't fail the gate by default
    expect(result.valid).toBe(true);
    expect(result.bypassed).toBe(false);
  });

  it('does NOT fire Rule 1 on softened/backed prose', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      '# Project\n\nThe core stays free under the MIT LICENSE. We aim to keep it stable.\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('error-severity findings fail the gate when no bypass is set', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'We guarantees everything.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
          severity: 'error',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings.every((f) => f.severity === 'error')).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('TOTEM_GATE_BYPASS_JUSTIFICATION passes the gate and records justification', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'We guarantees everything.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
          severity: 'error',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({
      repoRootForTest: tmpDir,
      envForTest: {
        TOTEM_GATE_BYPASS_JUSTIFICATION: 'one-off marketing release; will address in follow-up PR',
      },
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.bypassed).toBe(true);
    expect(result.bypassJustification).toBe(
      'one-off marketing release; will address in follow-up PR',
    );
    expect(result.valid).toBe(true);
  });

  it('empty/whitespace TOTEM_GATE_BYPASS_JUSTIFICATION does NOT bypass', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'We guarantees everything.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
          severity: 'error',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({
      repoRootForTest: tmpDir,
      envForTest: { TOTEM_GATE_BYPASS_JUSTIFICATION: '   ' },
    });
    expect(result.bypassed).toBe(false);
    expect(result.valid).toBe(false);
  });

  // Note: ast/ast-grep engine skip-with-warning path is structurally testable
  // but loadCompiledRules schema-validates the full rule shape before
  // discoverWwndRules sees them, so a schema-incomplete ast-grep fixture
  // fails at load. PR β (which actually adds ast/ast-grep WWND rules) will
  // exercise the skip-with-warning path with proper fixtures.

  it('skips WWND rules with invalid regex (warning, not crash)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Some text.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'ddd1111111111111',
          lessonHeading: 'WWND Rule Y: Bad regex',
          pattern: '[unterminated character class',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('invalid regex'))).toBe(true);
  });

  it('skips non-active rules (status: archived)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'We guarantees everything.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'eee1111111111111',
          lessonHeading: 'WWND Rule Z: Archived rule',
          pattern: ABSOLUTE_PROMISE_PATTERN,
          status: 'archived',
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings).toHaveLength(0);
  });

  it('handles missing compiled-rules.json gracefully (warning, valid)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Some text.\n');
    // No compiled-rules.json written
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('compiled-rules.json not found'))).toBe(true);
  });

  it('scans AGENTS.md as in-scope surface', async () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'We promises to deliver.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings.some((f) => f.file === 'AGENTS.md')).toBe(true);
  });

  it('recursively walks docs/wiki/ for .md files', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'wiki', 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'wiki', 'top.md'),
      'Top-level wiki page guarantees everything.\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'wiki', 'nested', 'inner.md'),
      'Nested wiki page promises to be perfect.\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'compiled-rules.json'),
      buildRulesFile([
        {
          lessonHash: 'aaa1111111111111',
          lessonHeading: 'WWND Rule 1: Absolute-promise detection on public surfaces',
          pattern: ABSOLUTE_PROMISE_PATTERN,
        },
      ]),
    );
    const result = await doctorClaimDisciplineCommand({ repoRootForTest: tmpDir });
    const files = result.findings.map((f) => f.file);
    expect(files).toContain('docs/wiki/top.md');
    expect(files).toContain('docs/wiki/nested/inner.md');
  });
});
