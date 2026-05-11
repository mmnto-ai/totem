import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPattern } from './ast-grep-query.js';
import type { CompiledRule, DiffAddition, RuleEngineContext } from './compiler.js';
import { applyRulesToAdditions, loadCompiledRules } from './compiler.js';
import { getErrorMessage } from './errors.js';

// ─── Types ───────────────────────────────────────────

/**
 * Valid values for the `surface:` frontmatter field on a test fixture.
 *
 * Per ADR-104 § Convergence: the existing single-file fixture schema is
 * extended additively with `surface: rules | hooks`. The field dispatches
 * which matcher consumes the fixture. Defaults to `'rules'` when absent
 * (backwards-compat for existing fixtures predating the hook engine).
 */
export const FIXTURE_SURFACES = ['rules', 'hooks'] as const;
export type FixtureSurface = (typeof FIXTURE_SURFACES)[number];

/**
 * Valid values for the `corpus:` frontmatter field on a test fixture.
 *
 * Per ADR-104 § Convergence: tags a fixture as a positive (`pass`) or
 * negative (`fail`) case. Defaults to `'pass'` when absent (backwards-compat
 * for existing dual-section rules-surface fixtures, where the pass/fail
 * semantic was carried by ## section headings inside the fixture body).
 */
export const FIXTURE_CORPORA = ['pass', 'fail'] as const;
export type FixtureCorpus = (typeof FIXTURE_CORPORA)[number];

/**
 * Fixture for verifying compiled rule patterns against examples.
 * Used by the rule testing infrastructure to validate hits (fail lines)
 * and misses (pass lines) for regex and AST-grep rules.
 *
 * The `surface` and `corpus` fields are filled with their defaults when
 * absent from the fixture frontmatter (ADR-104 § Convergence — additive,
 * backwards-compatible). PR-1's runtime keeps the existing dual-section
 * behavior on `surface: rules`; the hooks-surface dispatch lands in the
 * PR-1 follow-on.
 */
export interface RuleTestFixture {
  /** lessonHash of the rule to test */
  ruleHash: string;
  /** Virtual file path for glob matching (e.g., "src/example.ts") */
  filePath: string;
  /** Lines that SHOULD trigger the rule */
  failLines: string[];
  /** Lines that should NOT trigger the rule */
  passLines: string[];
  /** Source file path of the fixture */
  fixturePath: string;
  /**
   * Which matcher pipeline consumes this fixture. Always populated by
   * `parseFixture` (defaults to `'rules'`). Marked optional so existing
   * call sites that construct fixtures inline (test scaffolding, the
   * compile pipeline) compile without per-site updates.
   */
  surface?: FixtureSurface;
  /**
   * Whether the fixture asserts a positive or negative case. Always
   * populated by `parseFixture` (defaults to `'pass'`). Optional for the
   * same reason as `surface`.
   */
  corpus?: FixtureCorpus;
}

export interface RuleTestResult {
  ruleHash: string;
  ruleHeading: string;
  fixturePath: string;
  /** Lines from fail section that did NOT trigger (false negatives) */
  missedFails: string[];
  /** Lines from pass section that DID trigger (false positives) */
  falsePositives: string[];
  /** Whether the test passed (no missed fails AND no false positives) */
  passed: boolean;
}

export interface RuleTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  skippedFixtures: { path: string; ruleHash: string; ruleHeading: string }[];
  results: RuleTestResult[];
}

// ─── Fixture parsing ─────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const FAIL_SECTION_RE = /##\s*[Ss]hould\s+fail\s*\n+```[^\n]*\n([\s\S]*?)```/;
const PASS_SECTION_RE = /##\s*[Ss]hould\s+pass\s*\n+```[^\n]*\n([\s\S]*?)```/;

const TODO_MARKER = '// TODO: add code that should';

/**
 * Extract a simple `key: value` from frontmatter using line iteration —
 * avoids needing a full YAML parser and stays consistent with the existing
 * regex-based field extraction. Returns `undefined` when the key is absent
 * or has no value after the colon.
 */
function extractFrontmatterField(meta: string, key: string): string | undefined {
  const prefix = `${key}:`;
  for (const line of meta.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** Return true when every line in the fixture is a scaffolding placeholder. */
export function isTodoFixture(fixture: RuleTestFixture): boolean {
  const allLines = [...fixture.failLines, ...fixture.passLines];
  return allLines.length === 0 || allLines.every((l) => l.includes(TODO_MARKER));
}

// totem-ignore-next-line — .exec() calls below are for trusted local fixture parsing, not security-sensitive
export function parseFixture(content: string, fixturePath: string): RuleTestFixture | null {
  const frontmatter = FRONTMATTER_RE.exec(content); // totem-ignore
  if (!frontmatter) return null;

  const meta = frontmatter[1]!;
  const ruleMatch = /rule:\s*(.+)/.exec(meta); // totem-ignore
  const fileMatch = /file:\s*(.+)/.exec(meta); // totem-ignore

  if (!ruleMatch) return null;

  const ruleHash = ruleMatch[1]!.trim();
  const filePath = fileMatch ? fileMatch[1]!.trim() : 'src/example.ts'; // totem-ignore — default fixture path

  const failMatch = FAIL_SECTION_RE.exec(content); // totem-ignore
  const passMatch = PASS_SECTION_RE.exec(content); // totem-ignore

  const failLines = failMatch ? failMatch[1]!.split('\n').filter((l) => l.trim().length > 0) : [];
  const passLines = passMatch ? passMatch[1]!.split('\n').filter((l) => l.trim().length > 0) : [];

  // ADR-104 § Convergence — additive `surface:` and `corpus:` frontmatter
  // fields. Both default when absent (backwards-compat with existing
  // fixtures predating the hook engine). Invalid values reject the fixture
  // entirely rather than defaulting silently — a typo in the enum would
  // otherwise misroute the matcher dispatch in PR-1's follow-on.
  const surfaceRaw = extractFrontmatterField(meta, 'surface');
  let surface: FixtureSurface = 'rules';
  if (surfaceRaw !== undefined) {
    if (!FIXTURE_SURFACES.includes(surfaceRaw as FixtureSurface)) {
      return null;
    }
    surface = surfaceRaw as FixtureSurface;
  }

  const corpusRaw = extractFrontmatterField(meta, 'corpus');
  let corpus: FixtureCorpus = 'pass';
  if (corpusRaw !== undefined) {
    if (!FIXTURE_CORPORA.includes(corpusRaw as FixtureCorpus)) {
      return null;
    }
    corpus = corpusRaw as FixtureCorpus;
  }

  return { ruleHash, filePath, failLines, passLines, fixturePath, surface, corpus };
}

// ─── Fixture scaffolding ────────────────────────────

/** Generate a markdown test fixture skeleton compatible with {@link parseFixture}. */
export function scaffoldFixture(opts: {
  ruleHash: string;
  filePath?: string;
  failLines?: string[];
  passLines?: string[];
  heading?: string;
}): string {
  const filePath = opts.filePath ?? 'src/example.ts';
  const failContent =
    opts.failLines && opts.failLines.length > 0
      ? opts.failLines.join('\n')
      : '// TODO: add code that should trigger this rule';
  const passContent =
    opts.passLines && opts.passLines.length > 0
      ? opts.passLines.join('\n')
      : '// TODO: add code that should NOT trigger this rule';

  const heading = opts.heading ? [`<!-- ${opts.heading} -->`, ''] : [];

  return [
    '---',
    `rule: ${opts.ruleHash}`,
    `file: ${filePath}`,
    '---',
    '',
    ...heading,
    '## Should fail',
    '',
    '```ts',
    failContent,
    '```',
    '',
    '## Should pass',
    '',
    '```ts',
    passContent,
    '```',
    '',
  ].join('\n');
}

/** Return the canonical fixture path for a given rule hash: `<testsDir>/test-<hash>.md`. */
export function scaffoldFixturePath(testsDir: string, ruleHash: string): string {
  return path.join(testsDir, `test-${ruleHash}.md`);
}

// ─── Test execution ──────────────────────────────────

function linesToAdditions(lines: string[], filePath: string): DiffAddition[] {
  return lines.map((line, i) => ({
    file: filePath,
    line,
    lineNumber: i + 1,
    precedingLine: i > 0 ? lines[i - 1]! : null,
  }));
}

/**
 * Existing test infrastructure for compiled rule verification.
 * Validates regex patterns against hit/miss examples from fixture files.
 * Use this instead of building new verification functions.
 */
export function testRule(rule: CompiledRule, fixture: RuleTestFixture): RuleTestResult {
  const result: RuleTestResult = {
    ruleHash: rule.lessonHash,
    ruleHeading: rule.lessonHeading,
    fixturePath: fixture.fixturePath,
    missedFails: [],
    falsePositives: [],
    passed: true,
  };

  // Either a flat astGrepPattern (string) or a compound astGrepYamlRule
  // (NapiConfig object). Mutual exclusion is enforced by the schema
  // superRefine; the test runner just picks whichever shape is present.
  // mmnto/totem#1408 adds the compound path.
  const astGrepRule: AstGrepRule | undefined =
    rule.engine === 'ast-grep'
      ? (rule.astGrepPattern ?? (rule.astGrepYamlRule as AstGrepRule | undefined))
      : undefined;
  const isAstGrep = astGrepRule !== undefined;

  if (isAstGrep) {
    const ext = path.extname(fixture.filePath) || '.ts';
    const pattern = astGrepRule as AstGrepRule;

    // Test fail block — parse all fail lines as one snippet; expect at least one match
    if (fixture.failLines.length > 0) {
      const content = fixture.failLines.join('\n');
      const allLineNums = fixture.failLines.map((_, i) => i + 1);
      try {
        const matches = matchAstGrepPattern(content, ext, pattern, allLineNums);
        if (matches.length === 0) {
          result.missedFails.push(fixture.failLines.join('\n'));
        }
      } catch (err) {
        result.missedFails.push(`[ast-grep error] ${getErrorMessage(err)}`);
      }
    }

    // Test pass block — parse all pass lines as one snippet; expect zero matches
    if (fixture.passLines.length > 0) {
      const content = fixture.passLines.join('\n');
      const allLineNums = fixture.passLines.map((_, i) => i + 1);
      try {
        const matches = matchAstGrepPattern(content, ext, pattern, allLineNums);
        if (matches.length > 0) {
          result.falsePositives.push(fixture.passLines.join('\n'));
        }
      } catch (err) {
        result.falsePositives.push(`[ast-grep error] ${getErrorMessage(err)}`);
      }
    }
  } else {
    // Regex-engine rules — test line by line. Fixture runs are synthetic;
    // any shield-context: deprecation that slips through goes to a no-op
    // logger to keep fixture semantics isolated from production warnings.
    const ctx: RuleEngineContext = {
      logger: { warn: () => {} },
      state: { hasWarnedShieldContext: false },
    };
    for (const line of fixture.failLines) {
      const additions = linesToAdditions([line], fixture.filePath);
      const violations = applyRulesToAdditions(ctx, [rule], additions);
      if (violations.length === 0) {
        result.missedFails.push(line);
      }
    }

    for (const line of fixture.passLines) {
      const additions = linesToAdditions([line], fixture.filePath);
      const violations = applyRulesToAdditions(ctx, [rule], additions);
      if (violations.length > 0) {
        result.falsePositives.push(line);
      }
    }
  }

  result.passed = result.missedFails.length === 0 && result.falsePositives.length === 0;
  return result;
}

// ─── Runner ──────────────────────────────────────────

export function loadFixtures(testsDir: string): RuleTestFixture[] {
  if (!fs.existsSync(testsDir)) return [];

  const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.md'));
  const fixtures: RuleTestFixture[] = [];

  for (const file of files) {
    const filePath = path.join(testsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixture = parseFixture(content, filePath);
    if (fixture) fixtures.push(fixture);
  }

  return fixtures;
}

export function runRuleTests(rulesPath: string, testsDir: string): RuleTestSummary {
  const rules = loadCompiledRules(rulesPath);
  const fixtures = loadFixtures(testsDir);

  if (fixtures.length === 0) {
    return { total: 0, passed: 0, failed: 0, skipped: 0, skippedFixtures: [], results: [] };
  }

  const ruleMap = new Map(rules.map((r) => [r.lessonHash, r]));
  const results: RuleTestResult[] = [];
  const skippedFixtures: { path: string; ruleHash: string; ruleHeading: string }[] = [];

  for (const fixture of fixtures) {
    if (isTodoFixture(fixture)) {
      const heading = ruleMap.get(fixture.ruleHash)?.lessonHeading ?? '';
      skippedFixtures.push({
        path: fixture.fixturePath,
        ruleHash: fixture.ruleHash,
        ruleHeading: heading,
      });
      continue;
    }

    const rule = ruleMap.get(fixture.ruleHash);
    if (!rule) {
      results.push({
        ruleHash: fixture.ruleHash,
        ruleHeading: `(unknown — hash ${fixture.ruleHash} not found in compiled rules)`,
        fixturePath: fixture.fixturePath,
        missedFails: fixture.failLines,
        falsePositives: [],
        passed: false,
      });
      continue;
    }

    results.push(testRule(rule, fixture));
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    skipped: skippedFixtures.length,
    skippedFixtures,
    results,
  };
}
