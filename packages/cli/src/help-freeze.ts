import * as path from 'node:path';

/**
 * Derive whether a rule-compilation freeze is VISIBLE in the repo at `cwd`, for
 * the render-time `[frozen]` help badge (mmnto-ai/totem#2336 D2.4).
 *
 * Reads the canonical freeze primitive — `readEffectiveFreezes` (local
 * freeze.json ∪ the distributed `@mmnto/strategy-doctrine` cohort snapshot) —
 * and matches the canonical machine key `RULE_COMPILATION_FREEZE_ID`, exactly
 * as the verify-manifest gate does. Derived, never hardcoded (Tenet 20): a
 * consumer with no freeze.json and no doctrine pin gets `false` (plain help);
 * the badge surfaces a cohort fact, not a product fact.
 *
 * This lives in a module the full CLI wires and tests import directly, and that
 * neither help.ts nor the esbuild-lite bundle pulls in — the Lite binary renders
 * plain help with no freeze read.
 *
 * The LOCAL freeze read keeps its fail-closed contract: a corrupt freeze.json
 * THROWS (TotemConfigError), which the help wiring routes to the standard CLI
 * error boundary. The badge never silently swallows a corrupt gate input
 * (no fail-open catch).
 *
 * `@mmnto/totem` is imported dynamically inside the function per the repo rule
 * banning top-level VALUE imports from core in CLI files.
 */
export async function deriveRuleCompilationFrozen(
  cwd: string,
  opts: { totemDir?: string; packageName?: string } = {},
): Promise<boolean> {
  const { readEffectiveFreezes, RULE_COMPILATION_FREEZE_ID } = await import('@mmnto/totem');
  const totemDir = opts.totemDir ?? path.join(cwd, '.totem');
  let packageName = opts.packageName;
  if (packageName === undefined) {
    const { DOCTRINE_PIN_PACKAGE } = await import('./commands/init-doctrine.js');
    packageName = DOCTRINE_PIN_PACKAGE;
  }
  const result = readEffectiveFreezes(cwd, totemDir, packageName);
  return result.entries.some((f) => f.entry.id === RULE_COMPILATION_FREEZE_ID);
}
