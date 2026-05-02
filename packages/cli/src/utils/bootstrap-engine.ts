/**
 * Boot the Totem engine for a CLI command (mmnto-ai/totem#1794).
 *
 * Invokes `loadInstalledPacks()` so pack-contributed languages, chunkers,
 * and grammars register before any AST rule dispatch. Wire this after
 * `loadConfig()` and before any rule-execution surface in every CLI
 * command that consumes AST rules or chunk strategies (lint, shield,
 * compile, test-rules) — see ADR-097 § 10 Pack Discovery Phase + the
 * pack-substrate spec at `.totem/specs/pack-substrate-bundle.md:107`.
 *
 * Idempotent within a single Node process via the `isEngineSealed()`
 * short-circuit: production CLI invocations are fresh processes (one
 * call), but Vitest harnesses run multiple commands sequentially in
 * one process and would otherwise hit the "engine sealed" throw on the
 * second call.
 *
 * Per ADR-097 § 5 Q5: synchronous, fail-loud on any pack callback
 * error. The helper does not catch — pack-side bugs surface verbatim
 * at the CLI boundary right after `loadConfig`, where the user's
 * mental context is "did I install this right?" rather than deep in
 * an AST dispatch path.
 */

import type { TotemConfig } from '@mmnto/totem';

export async function bootstrapEngine(config: TotemConfig, projectRoot: string): Promise<void> {
  // Dynamic value imports per `.gemini/styleguide.md` § 6 — keeps any
  // future helper added to this file from accidentally pulling
  // `@mmnto/totem`'s heavy runtime deps at module-resolution time.
  // `import type` above is erased at compile time and stays static.
  const { isEngineSealed, loadInstalledPacks } = await import('@mmnto/totem');
  if (isEngineSealed()) return;
  loadInstalledPacks({ projectRoot, totemDir: config.totemDir });
}
