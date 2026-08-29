// ─── Record intake: parse → lower, once, shared by every harness ─────────────
//
// § Invariants: "Specimen sources parse via `parseRuleRecord` AND compile via
// `compileRuleRecord` with zero deviations (the language⇄glob floor and
// engine-binding assert live in the LOWERING, not the parser — M1's lesson)."
//
// Both steps FAIL LOUD. A `rejected` outcome is a counted, reported state inside
// core; here it is a spike defect, so it throws.

import * as fs from 'node:fs';

import type { ExpressibilityClass } from './expressibility.mts';
import { gatePatterns, type PatternVerdict } from './lowering-gate.mts';
import {
  activeRecordSet,
  loadRecordSet,
  type RecordRow,
  type RecordSetId,
} from './record-sets.mts';
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

/**
 * Parse + lower one specimen, reporting a rejection instead of raising it. The
 * message text is the same one `compileSpecimen` throws, so the reject ROW a seed
 * run records and the THROW a specimens run raises say the identical thing.
 */
export function tryCompileSpecimen(
  core: Record<string, any>,
  s: Specimen,
): { ok: true; compiled: CompiledSpecimen } | { ok: false; reason: string; cause?: unknown } {
  const yamlText = fs.readFileSync(s.recordFile, 'utf-8');
  let parsed: any;
  try {
    parsed = core.parseRuleRecord(yamlText, recordRelPath(s));
  } catch (err) {
    return {
      ok: false,
      reason: `specimen ${s.id} (${s.recordFile}) FAILED parseRuleRecord: ${(err as Error).message}`,
      cause: err,
    };
  }
  const outcome = core.compileRuleRecord(parsed, { ruleId: s.ruleId, now: PINNED_NOW });
  if (outcome.kind !== 'compiled') {
    return {
      ok: false,
      reason: `specimen ${s.id} (${s.recordFile}) FAILED compileRuleRecord: ${outcome.reason ?? '(no reason)'}`,
    };
  }
  return {
    ok: true,
    compiled: {
      specimen: s,
      yamlText,
      parsed,
      record: parsed.record,
      rule: outcome.rule,
      engine: outcome.rule.engine,
    },
  };
}

/** Parse + lower one specimen. Throws with the governing § on any rejection. */
export function compileSpecimen(core: Record<string, any>, s: Specimen): CompiledSpecimen {
  const r = tryCompileSpecimen(core, s);
  if (!r.ok) throw new Error(r.reason, r.cause === undefined ? undefined : { cause: r.cause });
  return r.compiled;
}

// ─── Record-set intake (spec `.totem/specs/seed20-apparatus.md` § G3) ────────

export type RejectStage = 'shipped-compile' | 'target-lowering';

/**
 * A SCORED ROW, not a failed check. Apparatus health and record verdict are
 * different questions: a record the shipped compiler or the § Lowering 4 gate
 * refuses is a finding ABOUT THE RECORD, and the run continues without it.
 */
export interface RejectRow {
  recordId: string;
  seedEntry: string | null;
  ruleId: string;
  stage: RejectStage;
  reason: string;
  class?: ExpressibilityClass;
}

export interface IntakeRow {
  specimen: RecordRow;
  status: 'ok' | 'rejected';
  /** null ONLY when the shipped compile rejected the record. */
  compiled: CompiledSpecimen | null;
  /** The § Lowering 4 verdicts, in `src/lower.mts`'s order. Empty when `compiled` is null. */
  patterns: PatternVerdict[];
  reject: RejectRow | null;
}

export interface Intake {
  recordSet: RecordSetId;
  rows: IntakeRow[];
  /** Rows that passed BOTH gates — the only ones that get a policy, a bundle or a chain. */
  accepted: IntakeRow[];
  /** Rows the SHIPPED compiler accepted, target-lowering rejects included. */
  shippedCompiled: IntakeRow[];
  rejects: RejectRow[];
}

/**
 * Load the active record set and run both gates over it.
 *
 * On `specimens` a rejection THROWS, exactly as it always did — the spec says all
 * five specimens lower, so a rejection there is a spike defect. On `seed20` it is
 * a reject row and the run continues; downstream stages consume `accepted`, so a
 * rejected record gets no fact bundle, no policy, no wasm and no chain BY
 * CONSTRUCTION rather than by a filter each stage has to remember.
 */
export function intakeRecordSet(core: Record<string, any>): Intake {
  const recordSet = activeRecordSet();
  const scoreRejects = recordSet === 'seed20';
  const rows: IntakeRow[] = [];

  for (const s of loadRecordSet(recordSet)) {
    const attempt = tryCompileSpecimen(core, s);
    if (!attempt.ok) {
      if (!scoreRejects) {
        throw new Error(
          attempt.reason,
          attempt.cause === undefined ? undefined : { cause: attempt.cause },
        );
      }
      rows.push({
        specimen: s,
        status: 'rejected',
        compiled: null,
        patterns: [],
        reject: {
          recordId: s.id,
          seedEntry: s.seedEntry,
          ruleId: s.ruleId,
          stage: 'shipped-compile',
          reason: attempt.reason,
        },
      });
      continue;
    }

    const compiled = attempt.compiled;
    const patterns = gatePatterns(compiled.rule as Record<string, unknown>, compiled.engine);
    const refused = patterns.filter((p) => !p.lowered);
    if (refused.length === 0) {
      rows.push({ specimen: s, status: 'ok', compiled, patterns, reject: null });
      continue;
    }
    if (!scoreRejects) {
      // The pre-existing throw, verbatim (`src/lower.mts` § Lowering 4's reject).
      throw new Error(
        `specimen ${s.id} carries an RE2-inexpressible pattern; the spec says all five specimens lower.`,
      );
    }
    const first = refused[0]!;
    rows.push({
      specimen: s,
      status: 'rejected',
      compiled,
      patterns,
      reject: {
        recordId: s.id,
        seedEntry: s.seedEntry,
        ruleId: s.ruleId,
        stage: 'target-lowering',
        reason: `${refused.map((p) => `${p.role} REJECTED (${p.class})`).join('; ')} — ${first.reason}`,
        class: first.class,
      },
    });
  }

  return {
    recordSet,
    rows,
    accepted: rows.filter((r) => r.status === 'ok'),
    shippedCompiled: rows.filter((r) => r.compiled !== null),
    rejects: rows.flatMap((r) => (r.reject ? [r.reject] : [])),
  };
}

/** The engine-native ast query the shipped batch helper receives (`rule-engine.ts:1051`). */
export function astQueryOf(rule: any): string | Record<string, unknown> | null {
  return (rule.astGrepPattern ?? rule.astGrepYamlRule ?? null) as
    | string
    | Record<string, unknown>
    | null;
}
