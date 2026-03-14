import * as path from 'node:path';

import type { RuleTestResult } from '@mmnto/totem';
import { runRuleTests } from '@mmnto/totem';

import { bold, errorColor, log, success as successColor } from '../ui.js';
import { loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

const TAG = 'Test';

export async function testRulesCommand(opts: { filter?: string }): Promise<void> {
  const cwd = process.cwd();
  loadEnv(cwd);

  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const rulesPath = path.join(cwd, config.totemDir, 'compiled-rules.json');
  const testsDir = path.join(cwd, config.totemDir, 'tests');

  log.info(TAG, 'Running rule tests...');

  const summary = runRuleTests(rulesPath, testsDir);

  if (summary.total === 0) {
    log.dim(TAG, `No test fixtures found in ${config.totemDir}/tests/`);
    log.dim(TAG, 'Create a fixture with:');
    log.dim(TAG, '');
    log.dim(TAG, '  ---');
    log.dim(TAG, '  rule: <lessonHash from compiled-rules.json>');
    log.dim(TAG, '  file: src/example.ts');
    log.dim(TAG, '  ---');
    log.dim(TAG, '');
    log.dim(TAG, '  ## Should fail');
    log.dim(TAG, '  ```ts');
    log.dim(TAG, '  const data = JSON.parse(response);');
    log.dim(TAG, '  ```');
    log.dim(TAG, '');
    log.dim(TAG, '  ## Should pass');
    log.dim(TAG, '  ```ts');
    log.dim(TAG, '  const data = safeJsonParse(response);');
    log.dim(TAG, '  ```');
    return;
  }

  // Filter results if --filter is provided
  let results = summary.results;
  if (opts.filter) {
    const filter = opts.filter.toLowerCase();
    results = results.filter(
      (r) => r.ruleHash.includes(filter) || r.ruleHeading.toLowerCase().includes(filter),
    );
  }

  // Display results
  for (const result of results) {
    if (result.passed) {
      log.success(TAG, `${result.ruleHeading} — PASS`);
    } else {
      printFailure(result);
    }
  }

  // Summary line
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  console.error('');
  if (failedCount === 0) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} — ${passedCount} rule test(s) passed`);
  } else {
    const label = errorColor(bold('FAIL'));
    log.info(TAG, `${label} — ${failedCount} failed, ${passedCount} passed`);
    process.exit(1);
  }
}

function printFailure(result: RuleTestResult): void {
  log.error('Totem Error', `${result.ruleHeading} — FAIL`);

  if (result.missedFails.length > 0) {
    log.warn(TAG, '  Missed violations (should have caught these):');
    for (const line of result.missedFails) {
      console.error(`    - ${line.trim()}`);
    }
  }

  if (result.falsePositives.length > 0) {
    log.warn(TAG, '  False positives (should NOT have caught these):');
    for (const line of result.falsePositives) {
      console.error(`    - ${line.trim()}`);
    }
  }
}
