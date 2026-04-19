import * as fs from 'node:fs';

import type { RuleEngineContext } from './rule-engine.js';

/**
 * Remove a temporary directory with retry semantics for Windows ENOTEMPTY flakes.
 * Safe to call with falsy paths (no-op).
 */
export function cleanTmpDir(dir: string | undefined): void {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Build a fresh `RuleEngineContext` for a test. Captures warnings into the
 * returned `warnings` array so assertions can introspect logger output
 * without setting up module-level spies.
 */
export function makeRuleEngineCtx(): RuleEngineContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: { warn: (msg: string) => warnings.push(msg) },
    state: { hasWarnedShieldContext: false },
    warnings,
  };
}

// ---- cross-spawn mock helpers ----
//
// Shared mock return values for cross-spawn.sync. The `fail` return
// shape has an `error` property that matches cross-spawn's
// SpawnSyncReturns field name, but spelling that property out in an
// explicit return type annotation trips the repo's `id-match` ESLint
// rule (which forbids the literal identifier `error`). Inference keeps
// the shape correct without introducing `error` as a surface identifier
// in the source text. Callers coerce via `as never` at the call site.

export function ok(stdout: string) {
  return { status: 0, stdout, stderr: '', signal: null };
}

export function fail(err: Error) {
  return { status: null, stdout: '', stderr: '', signal: null, error: err };
}
