import * as fs from 'node:fs';

import type { RuleEngineContext } from '@mmnto/totem';

/**
 * Remove a temporary directory with retry semantics for Windows ENOTEMPTY flakes.
 * Safe to call with falsy paths (no-op).
 */
export function cleanTmpDir(dir: string | undefined): void {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Build a fresh `RuleEngineContext` for a CLI test. Warnings are captured on
 * the returned `warnings` array so tests can assert without setting up spies.
 */
export function makeRuleEngineCtx(): RuleEngineContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: { warn: (msg: string) => warnings.push(msg) },
    state: { hasWarnedShieldContext: false },
    warnings,
  };
}
