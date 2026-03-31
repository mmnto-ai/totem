import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPattern } from './ast-grep-query.js';
import type { CompiledRule, DiffAddition } from './compiler.js';
import { applyRulesToAdditions, loadCompiledRules } from './compiler.js';
import { getErrorMessage } from './errors.js';

// ─── Types ───────────────────────────────────────────

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
  results: RuleTestResult[];
}

// ─── Fixture parsing ─────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const FAIL_SECTION_RE = /##\s*[Ss]hould\s+fail\s*\n+```[^\n]*\n([\s\S]*?)```/;
const PASS_SECTION_RE = /##\s*[Ss]hould\s+pass\s*\n+```[^\n]*\n([\s\S]*?)```/;

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

  return { ruleHash, filePath, failLines, passLines, fixturePath };
}

// ─── Fixture scaffolding ────────────────────────────

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

export function testRule(rule: CompiledRule, fixture: RuleTestFixture): RuleTestResult {
  const result: RuleTestResult = {
    ruleHash: rule.lessonHash,
    ruleHeading: rule.lessonHeading,
    fixturePath: fixture.fixturePath,
    missedFails: [],
    falsePositives: [],
    passed: true,
  };

  const isAstGrep = rule.engine === 'ast-grep' && rule.astGrepPattern;

  if (isAstGrep) {
    const ext = path.extname(fixture.filePath) || '.ts';
    const pattern = rule.astGrepPattern as AstGrepRule;

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
    // Regex-engine rules — test line by line
    for (const line of fixture.failLines) {
      const additions = linesToAdditions([line], fixture.filePath);
      const violations = applyRulesToAdditions([rule], additions);
      if (violations.length === 0) {
        result.missedFails.push(line);
      }
    }

    for (const line of fixture.passLines) {
      const additions = linesToAdditions([line], fixture.filePath);
      const violations = applyRulesToAdditions([rule], additions);
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
    return { total: 0, passed: 0, failed: 0, results: [] };
  }

  const ruleMap = new Map(rules.map((r) => [r.lessonHash, r]));
  const results: RuleTestResult[] = [];

  for (const fixture of fixtures) {
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
    results,
  };
}
