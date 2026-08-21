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

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  CompiledRule,
  DiffAddition,
  RuleEventCallback,
  Violation,
} from '../compiler-schema.js';
import { TotemParseError } from '../errors.js';
import {
  extractJustification,
  getRustTestSpans,
  isProductionRustRule,
  isSuppressed,
  type RuleEngineContext,
} from '../rule-engine.js';
// Prop 310 slice 2 — the record-grammar runtime semantics, shared with
// `rule-engine.ts` so both regex dispatchers scope and gate identically.
import { requiresSuppressesMatch, ruleAppliesToFile } from '../spine/record-runtime.js';
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
  /**
   * Prop 310 § Design 8 — whole-file reader for a `requires: {scope: file}`
   * check. Same shape as the ast path's shipped `readStrategy` 7th parameter, so
   * `totem lint --staged` threads the SAME `git show :<file>` reader into both
   * dispatchers and the requirement is evaluated against the bytes being
   * committed. Omitted ⇒ the worktree file is read.
   *
   * Reached only after a record-path rule with a file-scoped requirement has
   * matched its target, so it adds no IO to the legacy corpus.
   */
  readStrategy?: (filePath: string) => Promise<string | null>;
}

export interface BoundedApplyResult {
  violations: Violation[];
  timeoutOutcomes: RuleTimeoutOutcome[];
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

  const rustTestSpansCache = new Map<string, { startLine: number; endLine: number }[]>();
  const getRustSpans = async (file: string) => {
    if (rustTestSpansCache.has(file)) return rustTestSpansCache.get(file)!;
    try {
      const fullPath = path.resolve(options.repoRoot, file);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const spans = getRustTestSpans(content);
      rustTestSpansCache.set(file, spans);
      return spans;
      // totem-context: span-read failure yields no spans → no exemption → the rule still FIRES; the exemption fails toward flagging, never toward suppression.
    } catch {
      rustTestSpansCache.set(file, []);
      return [];
    }
  };

  // Prop 310 § Design 8 — whole-file text for a `requires: {scope: file}` check,
  // memoized per invocation. Prefers the caller's `readStrategy` (staged mode's
  // `git show :<file>`) so the requirement is judged against the same bytes as
  // the rest of the lint; a read failure yields `null`, which the evaluator
  // treats as "context absent" and therefore FIRES — the safe direction.
  const fileTextCache = new Map<string, string | null>();
  const getFileText = async (file: string): Promise<string | null> => {
    if (fileTextCache.has(file)) return fileTextCache.get(file) ?? null;
    let text: string | null = null;
    if (options.readStrategy) {
      // DELIBERATELY unwrapped: the caller's reader owns its own failure
      // contract. Staged mode's reader throws `STAGED_READ_FAILED` precisely so
      // an unreadable index entry surfaces instead of silently degrading, and a
      // catch here would convert that loud failure into a quiet one. A reader
      // that means "absent" returns `null`, which is handled below.
      text = await options.readStrategy(file);
    } else {
      try {
        text = await fs.promises.readFile(path.resolve(options.repoRoot, file), 'utf-8');
        // totem-context: read failure yields no required-context evidence → the requirement is UNMET → the rule still FIRES; fails toward flagging, never toward suppression.
      } catch {
        text = null;
      }
    }
    fileTextCache.set(file, text);
    return text;
  };

  for (const rule of regexRules) {
    // Partition additions by file so the evaluator can batch one rule per
    // file at a time. File granularity matches the fileGlobs scoping and
    // keeps timeout isolation per rule-file pair.
    const byFile = new Map<string, DiffAddition[]>();
    for (const addition of additions) {
      // Prop 310 § Design 7 — the two-array scope rule for record-path rules,
      // the shipped `fileMatchesGlobs` predicate for every legacy rule. This
      // dispatcher is the one `totem lint` uses for regex rules, so without the
      // shared predicate a record rule's `excludeGlobs` would be ignored here
      // and its `*.ts` silently promoted tree-wide — the scope WIDENING the
      // grammar exists to prevent (falsification round, 2026-08-21).
      if (!ruleAppliesToFile(rule, addition.file)) continue;
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

        // Prop 310 § Design 8 — pass two, ahead of every other per-match check:
        // the requirement is part of the MATCH PREDICATE, so a locus whose
        // required context is present is not a match at all and emits neither a
        // violation nor a `suppress` event. The file text is resolved here rather
        // than lazily because this dispatcher is async and `requiresSuppressesMatch`
        // is a pure sync predicate; `line` scope never triggers the read.
        if (rule.requires !== undefined) {
          const fileText = rule.requires.scope === 'file' ? await getFileText(file) : null;
          if (requiresSuppressesMatch(rule, { line: addition.line, file: () => fileText })) {
            continue;
          }
        }

        // Exempt matches inside inline Rust test modules for production-only Rust rules
        if (isProductionRustRule(rule)) {
          const spans = await getRustSpans(file);
          const isExempt = spans.some(
            (s) => addition.lineNumber >= s.startLine && addition.lineNumber <= s.endLine,
          );
          if (isExempt) {
            // Emit a suppress event so metrics distinguish "matched but
            // test-span-exempt" from "never matched" (#2397 / greptile P2).
            onRuleEvent?.('suppress', rule.lessonHash, {
              file: addition.file,
              line: addition.lineNumber,
              justification: 'exempt: inline #[cfg(test)] module span (#2397)',
              immutable: rule.immutable,
            });
            continue;
          }
        }

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
