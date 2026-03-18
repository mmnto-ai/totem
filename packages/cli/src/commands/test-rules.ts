const TAG = 'Test';

export async function testRulesCommand(opts: { filter?: string }): Promise<void> {
  const path = await import('node:path');
  const { log, bold, errorColor, success: successColor } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const { runRuleTests, sanitize } = await import('@mmnto/totem');

  const cwd = process.cwd();
  loadEnv(cwd);

  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const rulesPath = path.join(cwd, config.totemDir, 'compiled-rules.json');
  const testsDir = path.join(cwd, config.totemDir, 'tests');

  log.info(TAG, 'Running rule tests...');

  const summary = runRuleTests(rulesPath, testsDir);

  if (summary.total === 0) {
    log.dim(TAG, `No test fixtures found in ${config.totemDir}/tests/`); // totem-ignore — config.totemDir is our own config, not untrusted
    log.dim(TAG, 'Create a fixture with:');
    log.dim(TAG, '');
    log.dim(TAG, '  ---');
    log.dim(TAG, '  rule: <lessonHash from compiled-rules.json>');
    log.dim(TAG, '  file: src/example.ts'); // totem-ignore — static example text
    log.dim(TAG, '  ---');
    log.dim(TAG, '');
    log.dim(TAG, '  ## Should fail');
    log.dim(TAG, '  ```ts');
    log.dim(TAG, '  const data = JSON.parse(response);'); // totem-ignore — static example text
    log.dim(TAG, '  ```');
    log.dim(TAG, '');
    log.dim(TAG, '  ## Should pass');
    log.dim(TAG, '  ```ts');
    log.dim(TAG, '  const data = safeJsonParse(response);'); // totem-ignore — static example text
    log.dim(TAG, '  ```');
    return;
  }

  // Filter results if --filter is provided
  let results = summary.results;
  if (opts.filter) {
    const filter = opts.filter.toLowerCase();
    results = results.filter(
      (r) =>
        r.ruleHash.toLowerCase().includes(filter) || r.ruleHeading.toLowerCase().includes(filter),
    );
  }

  // Display results
  for (const result of results) {
    const heading = sanitize(result.ruleHeading);
    if (result.passed) {
      log.success(TAG, `${heading} — PASS`);
    } else {
      log.error('Totem Error', `${heading} — FAIL`);

      if (result.missedFails.length > 0) {
        log.warn(TAG, '  Missed violations (should have caught these):');
        for (const line of result.missedFails) {
          console.error(`    - ${sanitize(line.trim())}`);
        }
      }

      if (result.falsePositives.length > 0) {
        log.warn(TAG, '  False positives (should NOT have caught these):');
        for (const line of result.falsePositives) {
          console.error(`    - ${sanitize(line.trim())}`);
        }
      }
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
