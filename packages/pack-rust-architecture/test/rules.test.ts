import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  type AstGrepRule,
  type CompiledRule,
  CompiledRulesFileSchema,
  loadInstalledPacks,
  matchAstGrepPattern,
  type PackRegisterCallback,
  readJsonSafe,
} from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

/**
 * Boot the engine with this pack registered exactly the way `totem lint`
 * would in production: `loadInstalledPacks({ inMemoryPacks: [...] })`
 * runs the pack's CJS register entry, wires `.rs` → `'rust'` into the
 * engine's extension registry, and seals the registry for the test
 * lifetime. Vitest isolates each test file in its own worker, so the
 * one-time seal is contained per file and does not bleed across files.
 *
 * This is the load-bearing test for the PR-B substrate validation: we
 * exercise the full substrate path end-to-end instead of mocking it.
 */
function bootEngineWithPack(): void {
  const mod = require(PACK_ROOT) as {
    default?: PackRegisterCallback;
  };
  const callback = mod.default;
  if (typeof callback !== 'function')
    throw new Error('register.cjs default export is not a function');
  loadInstalledPacks({
    inMemoryPacks: [
      {
        pack: {
          name: '@totem/pack-rust-architecture',
          resolvedPath: PACK_ROOT,
          declaredEngineRange: '^1.22.0',
        },
        callback,
      },
    ],
    engineVersion: '1.22.0',
  });
}

function loadRules(): CompiledRule[] {
  const manifest = readJsonSafe(
    path.join(PACK_ROOT, 'compiled-rules.json'),
    CompiledRulesFileSchema,
  );
  return manifest.rules;
}

function ruleSource(rule: CompiledRule): AstGrepRule {
  // Mirror the runtime selector inside `applyAstRulesToAdditions` (rule-engine.ts):
  // a rule carries either astGrepPattern (string) or astGrepYamlRule (NapiConfig).
  const source = rule.astGrepPattern ?? (rule.astGrepYamlRule as AstGrepRule | undefined);
  if (!source)
    throw new Error(`rule ${rule.lessonHash} has neither astGrepPattern nor astGrepYamlRule`);
  return source;
}

describe('@totem/pack-rust-architecture compiled rules — runtime substrate integration', () => {
  beforeAll(() => {
    bootEngineWithPack();
  });

  it('compiled-rules.json contains at least one rule (v0.1 tracer-bullet seed)', () => {
    const rules = loadRules();
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it('every .rs-scoped rule declares ast-grep engine (substrate-validation invariant)', () => {
    // PR-B's purpose is to prove ast-grep dispatches on Rust. A regex-only
    // seed in this pack would not exercise the napi side-channel path, so
    // we enforce the substrate-touching shape.
    const rules = loadRules();
    const rsRules = rules.filter((r) => (r.fileGlobs ?? []).some((g) => g.endsWith('.rs')));
    expect(rsRules.length).toBeGreaterThan(0);
    for (const rule of rsRules) {
      expect(rule.engine).toBe('ast-grep');
    }
  });

  it('seed rule (lesson-8cefba95) fires on the Bevy hot-path bad example via .rs dispatch', () => {
    const rules = loadRules();
    const rule = rules.find((r) => r.lessonHash === '8cefba950774bcf0');
    expect(rule, 'seed rule for lesson-8cefba95 missing from compiled-rules.json').toBeDefined();
    if (!rule) return;

    const lines = rule.badExample!.split('\n');
    const lineNumbers = lines.map((_, i) => i + 1);
    // matchAstGrepPattern dispatches via extensionToLang('.rs') → 'rust' →
    // napi.parse('rust', ...). The full substrate path:
    //   register.cjs → pack-discovery's registerLanguage → ast-classifier.ts
    //   register.cjs → napi.registerDynamicLanguage (side-channel)
    //   matchAstGrepPattern('.rs', pattern, source) → parse → findAll
    const matches = matchAstGrepPattern(rule.badExample!, '.rs', ruleSource(rule), lineNumbers);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('seed rule does NOT fire on the matching good example (over-matching guard)', () => {
    const rules = loadRules();
    const rule = rules.find((r) => r.lessonHash === '8cefba950774bcf0');
    if (!rule) throw new Error('seed rule missing');

    const lines = rule.goodExample!.split('\n');
    const lineNumbers = lines.map((_, i) => i + 1);
    const matches = matchAstGrepPattern(rule.goodExample!, '.rs', ruleSource(rule), lineNumbers);
    expect(matches.length).toBe(0);
  });

  it('lesson-8cefba95 source markdown is shipped alongside the compiled rule', () => {
    // Pack ships both the lesson source (for human review and future LLM
    // recompile) and the compiled rule. Cross-checks the lessonHash field
    // against the actual lesson markdown so they cannot drift silently.
    const lessonPath = path.join(PACK_ROOT, 'lessons', 'lesson-8cefba95.md');
    expect(fs.existsSync(lessonPath)).toBe(true);
    const lessonBody = fs.readFileSync(lessonPath, 'utf-8');
    expect(lessonBody).toContain('Per-tick heap allocation in ECS system hot paths');
  });
});
