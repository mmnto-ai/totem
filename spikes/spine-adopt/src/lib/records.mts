// ─── Record intake: parse → lower, once, shared by every harness ─────────────
//
// § Invariants: "Specimen sources parse via `parseRuleRecord` AND compile via
// `compileRuleRecord` with zero deviations (the language⇄glob floor and
// engine-binding assert live in the LOWERING, not the parser — M1's lesson)."
//
// Both steps FAIL LOUD. A `rejected` outcome is a counted, reported state inside
// core; here it is a spike defect, so it throws.

import * as fs from 'node:fs';

import { loadCoreBarrel, requireSymbols } from './spike-env.mts';
import { PINNED_NOW, recordRelPath, type Specimen } from './specimens.mts';

export interface CompiledSpecimen {
  specimen: Specimen;
  /** The raw YAML bytes as authored. */
  yamlText: string;
  /** `parseRuleRecord` output — `{record, derivedEngine, examplePairHashes}`. */
  parsed: any;
  /** The § Design 4 record itself (`parsed.record`), i.e. the authored key space. */
  record: any;
  /** `compileRuleRecord` output rule (a `CompiledRule`). */
  rule: any;
  /** 'regex' | 'ast-grep' — the lowered engine binding. */
  engine: string;
}

export async function loadCore(): Promise<Record<string, any>> {
  const core = await loadCoreBarrel();
  requireSymbols(core, [
    'parseRuleRecord',
    'compileRuleRecord',
    'applyRulesToAdditions',
    'applyRulesToAdditionsBounded',
    'applyAstRulesToAdditions',
    'matchAstGrepPattern',
    'matchAstGrepPatternsBatch',
    'parseFixture',
    'loadFixtures',
    'RegexEvaluator',
  ]);
  return core;
}

/** Parse + lower one specimen. Throws with the governing § on any rejection. */
export function compileSpecimen(core: Record<string, any>, s: Specimen): CompiledSpecimen {
  const yamlText = fs.readFileSync(s.recordFile, 'utf-8');
  let parsed: any;
  try {
    parsed = core.parseRuleRecord(yamlText, recordRelPath(s));
  } catch (err) {
    throw new Error(
      `specimen ${s.id} (${s.recordFile}) FAILED parseRuleRecord: ${(err as Error).message}`,
      { cause: err },
    );
  }
  const outcome = core.compileRuleRecord(parsed, { ruleId: s.ruleId, now: PINNED_NOW });
  if (outcome.kind !== 'compiled') {
    throw new Error(
      `specimen ${s.id} (${s.recordFile}) FAILED compileRuleRecord: ${outcome.reason ?? '(no reason)'}`,
    );
  }
  return {
    specimen: s,
    yamlText,
    parsed,
    record: parsed.record,
    rule: outcome.rule,
    engine: outcome.rule.engine,
  };
}

/** The engine-native ast query the shipped batch helper receives (`rule-engine.ts:1051`). */
export function astQueryOf(rule: any): string | Record<string, unknown> | null {
  return (rule.astGrepPattern ?? rule.astGrepYamlRule ?? null) as
    | string
    | Record<string, unknown>
    | null;
}
