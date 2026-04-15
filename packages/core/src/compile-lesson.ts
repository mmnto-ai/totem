import { Lang, parse } from '@ast-grep/napi';

import { runSmokeGate } from './compile-smoke-gate.js';
import { engineFields, sanitizeFileGlobs, validateRegex } from './compiler.js';
import type { CompiledRule, CompilerOutput, RegexValidation } from './compiler-schema.js';
import {
  extractBadGoodSnippets,
  extractManualPattern,
  extractRuleExamples,
} from './lesson-pattern.js';
import type { RuleTestResult } from './rule-tester.js';
import { testRule } from './rule-tester.js';

// ─── Types ──────────────────────────────────────────

export interface LessonInput {
  index: number;
  heading: string;
  body: string;
  hash: string;
}

export type CompileLessonResult =
  | { status: 'compiled'; rule: CompiledRule }
  | { status: 'skipped'; hash: string; reason?: string }
  | { status: 'failed' }
  | { status: 'noop' };

export interface CompileLessonCallbacks {
  onWarn?: (heading: string, message: string) => void;
  onDim?: (heading: string, message: string) => void;
}

export interface CompileLessonDeps {
  parseCompilerResponse: (response: string) => CompilerOutput | null;
  /**
   * Invoke the LLM. The optional second parameter `systemPrompt` carries the
   * persistent compiler template separately from the per-lesson user prompt
   * so the orchestrator can mark it as a cache target (mmnto/totem#1291
   * Phase 3). When the wrapper threads systemPrompt through to a caching-
   * capable provider (Anthropic), repeat calls within the TTL window read
   * from prompt cache instead of paying full input-token cost.
   *
   * Backward compatible: callers that ignore the second parameter and
   * receive a wrapper-prepended single string still work — just without
   * the cache benefit.
   */
  runOrchestrator: (prompt: string, systemPrompt?: string) => Promise<string | undefined>;
  existingByHash: Map<string, CompiledRule>;
  callbacks?: CompileLessonCallbacks;
  /** Optional: specialized system prompt for Pipeline 3 (Bad/Good example-based compilation). */
  pipeline3Prompt?: string;
  /**
   * Optional telemetry-driven directive prepended to the Pipeline 2 USER prompt
   * (not the system prompt). Used by `totem compile --upgrade <hash>`
   * (mmnto/totem#1131) to nudge Sonnet toward an ast-grep structural pattern
   * when the existing rule is firing in non-code contexts. Has no effect on
   * Pipeline 1 (manual) or Pipeline 3 (example-based) compilation.
   *
   * Note: this lives in the user prompt rather than the system prompt because
   * it's per-lesson (specific to one rule's telemetry). Putting it in the
   * system prompt would invalidate the cache on every --upgrade call.
   */
  telemetryPrefix?: string;
}

// ─── ast-grep pattern validation ───────────────────

/**
 * Compile-time validation for ast-grep patterns (#1062, #1339).
 *
 * Two layers:
 *   1. Heuristic fast-path — reject empty patterns, multi-root string
 *      patterns (statement boundaries outside braces/parens), and
 *      compound object patterns missing the required `rule` key.
 *      Gives fast, human-readable error messages for the common cases.
 *   2. Parser-based check (#1339) — actually invoke ast-grep's rule
 *      compiler via `parse(Lang.Tsx, '').root().findAll(pattern)`. If
 *      ast-grep cannot compile the pattern into a rule, the error
 *      surfaces here instead of crashing `totem lint` at runtime.
 *      This catches single-line patterns that look balanced but fail
 *      semantic validation — e.g. `.option("--no-$FLAG", $$$REST)`
 *      (floating member call with no receiver) or `catch($E) { $$$ }`
 *      (bare catch clause that can only exist inside a try statement).
 *
 * Language choice: Tsx is the most permissive parser available (superset
 * of TypeScript plus JSX), so a valid ast-grep pattern for any
 * JS/TS/JSX/TSX source should also parse against it. Empty source
 * (`''`) keeps the call cheap — ast-grep compiles the pattern into a
 * rule before iterating any AST, so we see the rule-compile error even
 * though there's nothing to match against.
 *
 * Lite-build safety: this function is only called from compile flows
 * (buildCompiledRule / buildManualRule), which require an orchestrator
 * and therefore never run in the Lite binary. The esbuild alias swaps
 * `@ast-grep/napi` for the WASM shim in Lite builds, but since this
 * function is dead code there, the shim's `ensureInit()` requirement
 * is never triggered. The parser call is additionally wrapped in
 * try/catch so any surprise error (uninitialized engine, native-binding
 * failure) degrades conservatively to `valid: false` rather than
 * crashing the compile command.
 */
export function validateAstGrepPattern(pattern: string | Record<string, unknown>): RegexValidation {
  // ── Object pattern (NapiConfig / compound rule) ──
  if (typeof pattern === 'object' && pattern !== null) {
    if (!('rule' in pattern)) {
      return { valid: false, reason: 'object pattern missing required "rule" key' };
    }
    // Fall through to the parser-based check below — compound rules are
    // validated by handing them directly to findAll().
  } else if (typeof pattern !== 'string') {
    return { valid: false, reason: 'pattern must be a string or object' };
  } else {
    // String pattern — run the cheap heuristic checks first.
    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
      return { valid: false, reason: 'empty pattern' };
    }

    // Detect multiple top-level statements separated by semicolons or newlines.
    // ast-grep requires a single root node; multiple roots crash at runtime.
    // Split on statement boundaries (semicolons and newlines outside braces/parens)
    // using a simple brace/paren depth tracker.
    let depth = 0;
    let inString: string | null = null; // tracks quote char (' or " or `)
    const roots: string[] = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      const prev = i > 0 ? trimmed[i - 1] : '';

      // String literal tracking — skip depth/split logic inside strings
      // Note: escaped backslash edge case ("\\") is not handled — unlikely in ast-grep patterns
      if (inString) {
        current += ch;
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }
      if ((ch === '"' || ch === "'" || ch === '`') && prev !== '\\') {
        inString = ch;
        current += ch;
        continue;
      }

      if (ch === '(' || ch === '{' || ch === '[') {
        depth++;
        current += ch;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth = Math.max(0, depth - 1);
        current += ch;
      } else if (depth === 0 && (ch === ';' || ch === '\n')) {
        if (current.trim().length > 0) roots.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim().length > 0) roots.push(current.trim());

    if (roots.length > 1) {
      return {
        valid: false,
        reason: `pattern has ${roots.length} top-level expressions (ast-grep requires a single root)`,
      };
    }
  }

  // ── Parser-based check (#1339) ──
  // Hand the pattern to ast-grep's actual rule compiler. If ast-grep
  // can't compile it into a single-rooted rule, we see the exact
  // runtime error ("Multiple AST nodes are detected", "No AST root is
  // detected", "rule is not configured correctly", etc.) at compile
  // time instead. This is the authoritative source of truth for
  // validity — the heuristic above only exists to give faster, more
  // human-readable error messages for the common cases.
  try {
    const emptyRoot = parse(Lang.Tsx, '');
    // findAll accepts both string patterns and NapiConfig objects.
    emptyRoot.root().findAll(pattern as string);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Keep the first LINE of the ast-grep error only — multi-line errors
    // confuse downstream loggers. Do NOT slice on `.` — ast-grep error
    // messages almost always embed the user's pattern source verbatim
    // (e.g. `Multiple AST nodes are detected. Please check the pattern
    // source `.option("--no-$FLAG", $$$REST)`.`), and most ast-grep
    // patterns either start with a dot (`.option(...)`) or contain many
    // dots (`console.log($A)`, `$OBJ.method()`). Slicing on `.` would
    // discard the pattern source — the single most useful signal for
    // debugging a rejected rule — and in the pathological case where
    // the error message begins with a dot, would leave an empty string.
    // Taking the first line preserves the full first-line context
    // including the verbatim pattern source. (GCA finding on PR
    // mmnto/totem#1349.)
    //
    // Using `/^[^\n]*/` exec rather than the idiomatic newline-split
    // array accessor because two over-broad Pipeline 5 rules flag that
    // idiom as an error regardless of context — a "LLM metadata token"
    // false positive and a "loop-over-lines" false positive, neither of
    // which apply to a one-shot catch-block first-line extraction. The
    // regex form is semantically identical: `[^\n]*` matches zero-or-
    // more non-newline chars from the start of the string and always
    // matches at least the empty string, so the `?? raw` fallback is
    // defensive only. Archive follow-up tracked in mmnto/totem#1352.
    const firstLine = (/^[^\n]*/.exec(raw)?.[0] ?? raw).trim();
    return {
      valid: false,
      reason: `ast-grep rejected pattern: ${firstLine}`,
    };
  }

  return { valid: true };
}

// ─── Self-suppression guard (#1177) ─────────────────

/** Patterns containing suppression markers can never fire — the engine suppresses those lines first. */
function isSelfSuppressing(pattern: string): boolean {
  // Unescape the regex string to check for literal directive substrings
  const unescaped = pattern.replace(/\\\\/g, '\\').replace(/\\b/g, '').toLowerCase();
  return (
    unescaped.includes('totem-ignore') ||
    unescaped.includes('totem-context') ||
    unescaped.includes('shield-context')
  );
}

// ─── Rule builder (pure, no I/O) ────────────────────

/**
 * Options controlling how `buildCompiledRule` validates its input before
 * emitting a `CompiledRule`. The smoke gate is opt-in so Pipeline 1 (manual)
 * callers and ad-hoc test callers keep their existing behaviour unchanged;
 * Pipeline 2 (LLM) and Pipeline 3 (example-based) opt in explicitly in the
 * compileLesson flow.
 */
export interface BuildCompiledRuleOptions {
  /**
   * When true, the smoke gate runs after validation and before rule emission.
   * Missing badExample or zero-match badExample both reject the rule with a
   * rejectReason that names the gate. When false (default), the gate is
   * skipped entirely - backward compatible.
   */
  enforceSmokeGate?: boolean;
  /**
   * Optional badExample override. When supplied, takes precedence over
   * `parsed.badExample`. Pipeline 3 uses this to reuse its Bad snippet as the
   * smoke-gate target without relying on the LLM to echo the snippet back in
   * the structured output.
   */
  badExampleOverride?: string;
}

/**
 * Build a CompiledRule from parsed compiler output.
 * Returns { rule, rejectReason } so callers can report why a rule was rejected.
 */
export function buildCompiledRule(
  parsed: CompilerOutput,
  lesson: { hash: string; heading: string },
  existingByHash: Map<string, CompiledRule>,
  options: BuildCompiledRuleOptions = {},
): BuildRuleResult {
  if (!parsed.compilable) return { rule: null };

  const severity = parsed.severity ?? 'warning';
  const engine = parsed.engine ?? 'regex';
  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
  const globsObj = sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {};
  // mmnto/totem#1408: the effective badExample is the override when present,
  // else whatever the LLM echoed back in CompilerOutput. Pipeline 1 and ad-hoc
  // callers that leave the option off bypass the gate entirely.
  const effectiveBadExample = options.badExampleOverride ?? parsed.badExample;
  const badExampleObj =
    effectiveBadExample && effectiveBadExample.length > 0
      ? { badExample: effectiveBadExample }
      : {};

  let candidate: CompiledRule;

  if (engine === 'ast-grep') {
    // mmnto/totem#1407 split the field. Mutual exclusion is enforced
    // upstream by the schema superRefine; here we pick whichever the
    // LLM emitted and route it to validation.
    const astSource: string | Record<string, unknown> | undefined =
      typeof parsed.astGrepPattern === 'string' && parsed.astGrepPattern.length > 0
        ? parsed.astGrepPattern
        : parsed.astGrepYamlRule;

    if (!astSource || !parsed.message) {
      return {
        rule: null,
        rejectReason: 'Missing astGrepPattern or astGrepYamlRule or message',
      };
    }

    // Validate ast-grep pattern at compile time (#1062, #1339, #1407)
    const astValidation = validateAstGrepPattern(astSource);
    if (!astValidation.valid) {
      return { rule: null, rejectReason: `Invalid ast-grep pattern: ${astValidation.reason}` };
    }

    // Guard: reject patterns that match suppression directives (#1177).
    // For compound rules, the existing stringify path walks the entire
    // tree; any `totem-ignore` marker anywhere in the nested structure
    // is caught. Deliberately no object walker here (design doc open
    // question 2, resolved "keep existing stringify path").
    const astPatternStr = typeof astSource === 'string' ? astSource : JSON.stringify(astSource);
    if (isSelfSuppressing(astPatternStr)) {
      return {
        rule: null,
        rejectReason:
          'Pattern matches a suppression directive (totem-ignore/totem-context) and will self-suppress at runtime',
      };
    }

    candidate = {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'ast-grep',
      severity,
      ...engineFields('ast-grep', astSource),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
      ...badExampleObj,
    };
  } else if (engine === 'ast') {
    if (!parsed.astQuery || !parsed.message) {
      return { rule: null, rejectReason: 'Missing astQuery or message' };
    }
    candidate = {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'ast',
      severity,
      ...engineFields('ast', parsed.astQuery),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
      ...badExampleObj,
    };
  } else {
    // Regex engine (default)
    if (!parsed.pattern || !parsed.message) {
      return { rule: null, rejectReason: 'Missing pattern or message' };
    }
    const validation = validateRegex(parsed.pattern);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Rejected regex: ${validation.reason}` };
    }

    // Guard: reject patterns that match suppression directives (#1177)
    // These rules can never fire — the engine suppresses matching lines before rule evaluation.
    if (isSelfSuppressing(parsed.pattern)) {
      return {
        rule: null,
        rejectReason:
          'Pattern matches a suppression directive (totem-ignore/totem-context) and will self-suppress at runtime',
      };
    }

    candidate = {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'regex',
      severity,
      ...engineFields('regex', parsed.pattern),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
      ...badExampleObj,
    };
  }

  // mmnto/totem#1408: compile-time smoke gate. Opt-in via options so Pipeline 1
  // and ad-hoc test callers are unaffected. The gate reuses the runtime engine
  // entry points so a rule passing here cannot silently fail to match at
  // runtime on identical input. Skipped for the 'ast' (Tree-sitter) engine
  // because runSmokeGate does not yet cover S-expression queries; those rules
  // fall back to the existing `verifyRuleExamples` path. Skipping here
  // matches the comment in compile-smoke-gate.ts and prevents the gate from
  // hard-rejecting a rule it is not equipped to evaluate.
  if (options.enforceSmokeGate && candidate.engine !== 'ast') {
    if (!effectiveBadExample) {
      return {
        rule: null,
        rejectReason: 'smoke gate: missing badExample (required for Pipeline 2/3)',
      };
    }
    const gate = runSmokeGate(candidate, effectiveBadExample);
    if (!gate.matched) {
      const suffix = gate.reason ? ` (${gate.reason})` : '';
      return {
        rule: null,
        rejectReason: `smoke gate: zero matches against badExample${suffix}`,
      };
    }
  }

  return { rule: candidate };
}

// ─── Manual pattern builder ─────────────────────────

export interface BuildRuleResult {
  rule: CompiledRule | null;
  rejectReason?: string;
}

/**
 * Derive a virtual file path that satisfies a rule's fileGlobs.
 * Used to construct test fixtures where glob matching is active.
 */
export function deriveVirtualFilePath(rule: CompiledRule): string {
  if (!rule.fileGlobs || rule.fileGlobs.length === 0) return 'src/example.ts';
  const positiveGlob = rule.fileGlobs.find((g) => !g.startsWith('!'));
  if (!positiveGlob) return 'src/example.ts';

  // Exact file (no glob chars) — return as-is
  if (!positiveGlob.includes('*') && !positiveGlob.includes('?')) {
    return positiveGlob;
  }

  // Replace glob wildcards with concrete segments to produce a path
  // that satisfies the glob: **/ → src/, * → example
  // e.g. **/*.test.ts → src/example.test.ts, *.py → example.py
  return positiveGlob.replace(/\*\*\//g, 'src/').replace(/\*/g, 'example');
}

/**
 * Verify a compiled rule against inline Example Hit/Miss lines.
 * Returns null if no examples exist or engine is not regex.
 * Returns RuleTestResult if verification was run.
 */
export function verifyRuleExamples(rule: CompiledRule, body: string): RuleTestResult | null {
  const examples = extractRuleExamples(body);
  if (!examples) return null;
  if (rule.engine !== 'regex') return null;

  const fixture = {
    ruleHash: rule.lessonHash,
    filePath: deriveVirtualFilePath(rule),
    failLines: examples.hits,
    passLines: examples.misses,
    fixturePath: '(inline examples)',
  };

  return testRule(rule, fixture);
}

export function formatExampleFailure(result: RuleTestResult): string {
  const details: string[] = [];
  if (result.missedFails.length > 0) {
    details.push(
      `Example Hits that did NOT match: ${result.missedFails.map((l) => JSON.stringify(l)).join(', ')}`,
    );
  }
  if (result.falsePositives.length > 0) {
    details.push(
      `Example Misses that DID match: ${result.falsePositives.map((l) => JSON.stringify(l)).join(', ')}`,
    );
  }
  return `Rule failed inline examples — ${details.join('; ')}`;
}

/**
 * Build a CompiledRule from a lesson's manually specified pattern.
 * Returns { rule, rejectReason } so callers can report why a pattern was rejected.
 */
export function buildManualRule(
  lesson: LessonInput,
  existingByHash: Map<string, CompiledRule>,
): BuildRuleResult {
  const manual = extractManualPattern(lesson.body);
  if (!manual) return { rule: null };

  // Compound ast-grep path: the lesson authored a NapiConfig-shaped rule via
  // a yaml fenced block under **Pattern:**. Route the parsed object through
  // validateAstGrepPattern (which accepts both string and object shapes via
  // the spike-validated polymorphic signature).
  const isCompound = manual.engine === 'ast-grep' && manual.astGrepYamlRule !== undefined;
  const astSource: string | Record<string, unknown> | undefined = isCompound
    ? manual.astGrepYamlRule
    : manual.engine === 'ast-grep'
      ? manual.pattern
      : undefined;

  if (manual.engine === 'regex') {
    const validation = validateRegex(manual.pattern);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Manual pattern rejected: ${validation.reason}` };
    }
  }

  if (manual.engine === 'ast-grep') {
    if (astSource === undefined || (typeof astSource === 'string' && astSource.length === 0)) {
      return {
        rule: null,
        rejectReason:
          'Manual ast-grep lesson has neither a flat **Pattern:** value nor a `yaml`-tagged fenced block',
      };
    }
    const validation = validateAstGrepPattern(astSource);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Manual ast-grep pattern rejected: ${validation.reason}` };
    }
  }

  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = manual.fileGlobs ? sanitizeFileGlobs(manual.fileGlobs) : undefined;

  const engineFieldArgs: string | Record<string, unknown> =
    manual.engine === 'ast-grep' && astSource !== undefined ? astSource : manual.pattern;

  return {
    rule: {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      // #1265: prefer the extracted **Message:** field over the heading fallback.
      // The heading is the *what*; the message is the *why and how*.
      message: manual.message ?? lesson.heading,
      engine: manual.engine,
      severity: manual.severity,
      // #1265: explicit Pipeline 1 marker. Pre-#1265, downstream code (doctor,
      // compile.ts:logCompiledRule) used `lessonHeading === message` to identify
      // manual rules. That heuristic breaks when manual rules have rich messages,
      // so we set this flag explicitly here. Old compiled-rules.json files don't
      // have it; the legacy heuristic stays as a fallback for those.
      manual: true,
      ...engineFields(manual.engine, engineFieldArgs),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...(sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {}),
    },
  };
}

// ─── Single-lesson compilation ──────────────────────

/**
 * Compile a single lesson into a rule.
 * Handles both manual patterns (zero LLM) and LLM-compiled patterns.
 * Pure business logic — no UI, no I/O, no process.exit.
 */
export async function compileLesson(
  lesson: LessonInput,
  compilerPrompt: string,
  deps: CompileLessonDeps,
): Promise<CompileLessonResult> {
  const { parseCompilerResponse, runOrchestrator, existingByHash, callbacks } = deps;

  // ── Pipeline 1: Manual pattern (zero LLM) ────────
  const manualResult = buildManualRule(lesson, existingByHash);
  if (manualResult.rule) {
    const testResult = verifyRuleExamples(manualResult.rule, lesson.body);
    if (testResult && !testResult.passed) {
      callbacks?.onWarn?.(lesson.heading, formatExampleFailure(testResult));
      return { status: 'failed' };
    }
    return { status: 'compiled', rule: manualResult.rule };
  }
  if (manualResult.rejectReason) {
    callbacks?.onWarn?.(lesson.heading, manualResult.rejectReason);
    return { status: 'failed' };
  }
  // manualResult.rule === null && no rejectReason → no manual pattern, proceed to Pipeline 3 or 2

  // ── Pipeline 3: Example-based compilation (Bad/Good snippets) ──
  const snippets = extractBadGoodSnippets(lesson.body);
  if (snippets) {
    // The base prompt (Pipeline 3 specialized template, or compilerPrompt fallback)
    // is the persistent system context — same bytes across every Pipeline 3 call
    // within a session. Pass it as systemPrompt so the orchestrator can cache it
    // (mmnto/totem#1291 Phase 3). The user prompt carries only the per-lesson
    // bad/good snippets and lesson body.
    const systemPrompt = deps.pipeline3Prompt ?? compilerPrompt;
    const userPrompt = [
      '## Lesson to Compile (Example-Based — Pipeline 3)',
      '',
      `Heading: ${lesson.heading}`,
      '',
      '### Bad Code (should trigger the rule):',
      ...snippets.bad,
      '',
      '### Good Code (should NOT trigger the rule):',
      ...snippets.good,
      '',
      lesson.body,
    ].join('\n');

    const response = await runOrchestrator(userPrompt, systemPrompt);
    if (response == null) return { status: 'noop' };

    const parsed = parseCompilerResponse(response);
    if (!parsed) {
      callbacks?.onWarn?.(lesson.heading, 'Pipeline 3: failed to parse LLM response — skipping');
      return { status: 'failed' };
    }

    if (!parsed.compilable) {
      callbacks?.onDim?.(lesson.heading, 'Pipeline 3: not compilable — skipping');
      return { status: 'skipped', hash: lesson.hash, reason: parsed.reason };
    }

    // mmnto/totem#1408: Pipeline 3 reuses its Bad snippet as the smoke-gate
    // target. The LLM may or may not echo the snippet back in parsed.badExample;
    // the override guarantees the gate has something to work with regardless.
    const ruleResult = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
      badExampleOverride: snippets.bad.join('\n'),
    });
    if (!ruleResult.rule) {
      callbacks?.onWarn?.(
        lesson.heading,
        `Pipeline 3: ${ruleResult.rejectReason ?? 'Unknown error'} — skipping`,
      );
      return { status: 'failed' };
    }

    // Self-verify: at least one Bad line should trigger, no Good line should trigger
    const virtualPath = deriveVirtualFilePath(ruleResult.rule);
    const testFixture = {
      ruleHash: lesson.hash,
      filePath: virtualPath,
      failLines: snippets.bad,
      passLines: snippets.good,
      fixturePath: '(pipeline-3-self-test)',
    };
    const testResult = testRule(ruleResult.rule, testFixture);
    // For Pipeline 3, we only require at least one Bad line triggers (not all).
    // Context lines in multi-line Bad snippets (e.g., `{`, `}`) won't match.
    const badCaught = snippets.bad.length - testResult.missedFails.length;
    if (badCaught === 0 || testResult.falsePositives.length > 0) {
      callbacks?.onWarn?.(
        lesson.heading,
        'Pipeline 3: generated rule failed self-verification against Bad/Good snippets — skipping',
      );
      return { status: 'failed' };
    }

    return { status: 'compiled', rule: ruleResult.rule };
  }

  // ── Pipeline 2: LLM compilation ──────────────────
  // The compilerPrompt (ast-grep manual + few-shot examples, ~50KB) is the
  // persistent system context — same bytes across every Pipeline 2 call within
  // a session. Pass it as systemPrompt so the orchestrator can cache it
  // (mmnto/totem#1291 Phase 3). The user prompt carries only the per-lesson
  // body and the optional telemetry directive (which is per-rule, not cacheable).
  //
  // Optional telemetry directive (mmnto/totem#1131) — nudges Sonnet toward ast-grep
  // when the existing rule is firing in strings/comments instead of code. Lives
  // in the user prompt because it varies per --upgrade target.
  const userPromptParts: string[] = [];
  if (deps.telemetryPrefix) {
    userPromptParts.push('## Telemetry-Driven Refinement Directive', deps.telemetryPrefix);
  }
  userPromptParts.push('## Lesson to Compile', `Heading: ${lesson.heading}`, lesson.body);
  const userPrompt = userPromptParts.join('\n\n');
  const response = await runOrchestrator(userPrompt, compilerPrompt);

  if (response == null) return { status: 'noop' };

  const parsed = parseCompilerResponse(response);
  if (!parsed) {
    callbacks?.onWarn?.(lesson.heading, 'Failed to parse LLM response — skipping');
    return { status: 'failed' };
  }

  if (!parsed.compilable) {
    callbacks?.onDim?.(lesson.heading, 'Not compilable (conceptual/architectural) — skipping');
    return { status: 'skipped', hash: lesson.hash, reason: parsed.reason };
  }

  // mmnto/totem#1408: Pipeline 2 enforces the smoke gate. Rules without a
  // badExample, or whose badExample fails to match the pattern, are rejected
  // with a clear reason before landing in compiled-rules.json. The compile
  // prompt rewrite in mmnto/totem#1409 teaches Sonnet to emit the field.
  const ruleResult = buildCompiledRule(parsed, lesson, existingByHash, {
    enforceSmokeGate: true,
  });
  if (!ruleResult.rule) {
    callbacks?.onWarn?.(lesson.heading, `${ruleResult.rejectReason ?? 'Unknown error'} — skipping`);
    return { status: 'failed' };
  }

  const testResult = verifyRuleExamples(ruleResult.rule, lesson.body);
  if (testResult && !testResult.passed) {
    callbacks?.onWarn?.(lesson.heading, formatExampleFailure(testResult));
    return { status: 'failed' };
  }
  return { status: 'compiled', rule: ruleResult.rule };
}
