import { loadFixtures, type RuleTestFixture } from '@mmnto/totem';

import { loadCompiledHooks } from './loader.js';
import { evaluateHook, type ToolCallPayload } from './runtime.js';
import type { CompiledHookRule } from './schema.js';

/**
 * Hooks-surface fixture test runner (ADR-104 § Convergence).
 *
 * Walks fixtures with `surface: hooks` from `.totem/tests/`, looks up the
 * matching compiled hook by id, and evaluates each fixture line against
 * the hook. Failures are reported per-line so authors can iterate on
 * specific examples.
 *
 * Fixture semantics for hooks (corpus-driven):
 * - `corpus: fail` (or `## Should fail` block) — each line is a tool-call
 *   payload that MUST cause the hook to reject; lines that allow are
 *   `missedFails`.
 * - `corpus: pass` (or `## Should pass` block) — each line is a tool-call
 *   payload that MUST allow; lines that reject are `falsePositives`.
 *
 * Both blocks may appear in a single fixture (matches the rules-surface
 * dual-section pattern). The corpus frontmatter field is informational
 * for hooks fixtures — the section names carry the same intent and the
 * runner exercises both.
 *
 * The tool for each payload is sourced from the matched hook's
 * `trigger.tool`. Fixtures do not encode the tool explicitly; the hook
 * declares which tool it gates, so the fixture body is just the args
 * payload the hook would see at runtime.
 *
 * The runner is deterministic Node.js — no LLM calls — mirroring the
 * `totem hook run` contract. Loader warnings and structured errors flow
 * through to the summary so the CLI surface can echo them to stderr.
 */

export interface HookTestFailure {
  line: string;
  expected: 'allow' | 'reject';
  actual: 'allow' | 'reject';
}

export interface HookTestResult {
  hookId: string;
  packId: string;
  fixturePath: string;
  failures: HookTestFailure[];
  passed: boolean;
}

export interface HookTestSummary {
  total: number;
  passed: number;
  failed: number;
  /** Fixtures referencing a hook id not present in the loaded manifest. */
  unknownHooks: { fixturePath: string; hookId: string }[];
  results: HookTestResult[];
  loadWarnings: string[];
  loadErrors: { code: string; message: string }[];
}

export interface RunHookTestsOptions {
  manifestPath: string;
  testsDir: string;
  installedPackVersions: Record<string, string>;
}

export function runHookTests(options: RunHookTestsOptions): HookTestSummary {
  const { hooks, warnings, errors } = loadCompiledHooks({
    manifestPath: options.manifestPath,
    installedPackVersions: options.installedPackVersions,
  });

  const fixtures = loadFixtures(options.testsDir).filter((f) => f.surface === 'hooks');

  const hooksById = new Map<string, CompiledHookRule>(hooks.map((h) => [h.id, h]));
  const results: HookTestResult[] = [];
  const unknownHooks: { fixturePath: string; hookId: string }[] = [];

  for (const fixture of fixtures) {
    const hook = hooksById.get(fixture.ruleHash);
    if (!hook) {
      unknownHooks.push({ fixturePath: fixture.fixturePath, hookId: fixture.ruleHash });
      continue;
    }
    results.push(testHook(hook, fixture));
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    unknownHooks,
    results,
    loadWarnings: warnings,
    loadErrors: errors.map((e) => ({ code: e.code, message: e.message })),
  };
}

function testHook(hook: CompiledHookRule, fixture: RuleTestFixture): HookTestResult {
  const failures: HookTestFailure[] = [];
  const tool = hook.trigger.tool;

  for (const args of fixture.failLines) {
    const payload: ToolCallPayload = { tool, args };
    const decision = evaluateHook(hook, payload).decision;
    if (decision !== 'reject') {
      failures.push({ line: args, expected: 'reject', actual: decision });
    }
  }

  for (const args of fixture.passLines) {
    const payload: ToolCallPayload = { tool, args };
    const decision = evaluateHook(hook, payload).decision;
    if (decision !== 'allow') {
      failures.push({ line: args, expected: 'allow', actual: decision });
    }
  }

  return {
    hookId: hook.id,
    packId: hook.packId,
    fixturePath: fixture.fixturePath,
    failures,
    passed: failures.length === 0,
  };
}
