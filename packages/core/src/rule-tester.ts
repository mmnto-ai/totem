import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CompiledRule, DiffAddition } from './compiler.js';
import { applyRulesToAdditions, loadCompiledRules } from './compiler.js';

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

export function parseFixture(content: string, fixturePath: string): RuleTestFixture | null {
  const frontmatter = FRONTMATTER_RE.exec(content);
  if (!frontmatter) return null;

  const meta = frontmatter[1]!;
  const ruleMatch = /rule:\s*(.+)/.exec(meta);
  const fileMatch = /file:\s*(.+)/.exec(meta);

  if (!ruleMatch) return null;

  const ruleHash = ruleMatch[1]!.trim();
  const filePath = fileMatch ? fileMatch[1]!.trim() : 'src/example.ts';

  const failMatch = FAIL_SECTION_RE.exec(content);
  const passMatch = PASS_SECTION_RE.exec(content);

  const failLines = failMatch ? failMatch[1]!.split('\n').filter((l) => l.trim().length > 0) : [];
  const passLines = passMatch ? passMatch[1]!.split('\n').filter((l) => l.trim().length > 0) : [];

  return { ruleHash, filePath, failLines, passLines, fixturePath };
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

  // Test fail lines — each should produce at least one violation
  for (const line of fixture.failLines) {
    const additions = linesToAdditions([line], fixture.filePath);
    const violations = applyRulesToAdditions([rule], additions);
    if (violations.length === 0) {
      result.missedFails.push(line);
    }
  }

  // Test pass lines — none should produce violations
  for (const line of fixture.passLines) {
    const additions = linesToAdditions([line], fixture.filePath);
    const violations = applyRulesToAdditions([rule], additions);
    if (violations.length > 0) {
      result.falsePositives.push(line);
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
