/**
 * Bounded-execution variant of `applyRulesToAdditions` (mmnto-ai/totem#1641).
 *
 * Routes every regex rule through the persistent-worker `RegexEvaluator`
 * so a catastrophic-backtracking pattern terminates at the configured
 * timeout rather than hanging the lint process indefinitely. Engine layer
 * is policy-free: it records `RuleTimeoutOutcome` entries and lets the
 * caller (CLI) decide whether to surface them as exit-code contributors
 * (strict) or as skipped warnings (lenient).
 *
 * Scope: regex-engine rules only. ast / ast-grep rules are not ReDoS-
 * susceptible and are evaluated by `applyAstRulesToAdditions` / the
 * compound-rule pipeline under separate bounds.
 */

import type {
  CompiledRule,
  DiffAddition,
  RuleEventCallback,
  Violation,
} from '../compiler-schema.js';
import { TotemParseError } from '../errors.js';
import {
  extractJustification,
  isSuppressed,
  matchesGlob,
  type RuleEngineContext,
} from '../rule-engine.js';
import type { RegexEvaluator } from './evaluator.js';
import { redactPath } from './telemetry.js';

export type TimeoutMode = 'strict' | 'lenient';

export interface RuleTimeoutOutcome {
  ruleHash: string;
  file: string;
  elapsedMs: number;
  mode: TimeoutMode;
}

export interface BoundedApplyOptions {
  evaluator: RegexEvaluator;
  timeoutMode: TimeoutMode;
  repoRoot: string;
}

export interface BoundedApplyResult {
  violations: Violation[];
  timeoutOutcomes: RuleTimeoutOutcome[];
}

function fileMatchesGlobs(filePath: string, globs: readonly string[]): boolean {
  const hasIncludes = globs.some((g) => !g.startsWith('!'));
  let matched = !hasIncludes;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matchesGlob(filePath, glob.slice(1))) return false;
    } else if (matchesGlob(filePath, glob)) {
      matched = true;
    }
  }
  return matched;
}

export async function applyRulesToAdditionsBounded(
  ctx: RuleEngineContext,
  rules: readonly CompiledRule[],
  additions: readonly DiffAddition[],
  options: BoundedApplyOptions,
  onRuleEvent?: RuleEventCallback,
): Promise<BoundedApplyResult> {
  const violations: Violation[] = [];
  const timeoutOutcomes: RuleTimeoutOutcome[] = [];

  if (additions.length === 0 || rules.length === 0) {
    return { violations, timeoutOutcomes };
  }

  const regexRules = rules.filter((r) => r.engine === 'regex' || !r.engine);

  for (const rule of regexRules) {
    // Partition additions by file so the evaluator can batch one rule per
    // file at a time. File granularity matches the fileGlobs scoping and
    // keeps timeout isolation per rule-file pair.
    const byFile = new Map<string, DiffAddition[]>();
    for (const addition of additions) {
      if (rule.fileGlobs && rule.fileGlobs.length > 0) {
        if (!fileMatchesGlobs(addition.file, rule.fileGlobs)) continue;
      }
      const bucket = byFile.get(addition.file) ?? [];
      bucket.push(addition);
      byFile.set(addition.file, bucket);
    }

    for (const [file, fileAdditions] of byFile) {
      const result = await options.evaluator.evaluate({
        ruleHash: rule.lessonHash,
        pattern: rule.pattern,
        flags: '',
        lines: fileAdditions.map((a) => a.line),
        redactedPath: redactPath(file, options.repoRoot),
      });

      if (result.kind === 'error') {
        // Fail loud (matches rule-engine.ts pre-#1641 contract at line
        // 247). An uncompilable compiled rule means the validator was
        // bypassed or the manifest was edited by hand; silently skipping
        // would mark the diff "compliant" while a load-bearing rule is
        // mute.
        throw new TotemParseError(
          `Rule ${rule.lessonHash} has an invalid regex pattern and cannot be evaluated.`,
          `Re-run 'totem lesson compile' to regenerate the rule, or archive it via 'totem doctor --pr' if the source lesson cannot produce a valid pattern. Pattern: ${JSON.stringify(rule.pattern)} — worker reported: ${result.message}`,
        );
      }

      if (result.kind === 'timeout') {
        timeoutOutcomes.push({
          ruleHash: rule.lessonHash,
          file,
          elapsedMs: result.elapsedMs,
          mode: options.timeoutMode,
        });
        onRuleEvent?.('failure', rule.lessonHash, {
          file,
          line: 0,
          failureReason: `timeout after ${result.elapsedMs}ms (mode: ${options.timeoutMode})`,
        });
        continue;
      }

      for (const matchedIndex of result.matchedIndices) {
        const addition = fileAdditions[matchedIndex];
        if (!addition) continue;

        if (isSuppressed(ctx, addition.line, addition.precedingLine)) {
          onRuleEvent?.('suppress', rule.lessonHash, {
            file: addition.file,
            line: addition.lineNumber,
            justification: extractJustification(ctx, addition.line, addition.precedingLine),
            immutable: rule.immutable,
          });
          continue;
        }

        onRuleEvent?.('trigger', rule.lessonHash, {
          file: addition.file,
          line: addition.lineNumber,
          astContext: addition.astContext,
        });

        if (!addition.astContext || addition.astContext === 'code') {
          violations.push({
            rule,
            file: addition.file,
            line: addition.line,
            lineNumber: addition.lineNumber,
          });
        }
      }
    }
  }

  return { violations, timeoutOutcomes };
}
