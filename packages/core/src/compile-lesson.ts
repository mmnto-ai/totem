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
  runOrchestrator: (prompt: string) => Promise<string | undefined>;
  existingByHash: Map<string, CompiledRule>;
  callbacks?: CompileLessonCallbacks;
}

// ─── ast-grep pattern validation ───────────────────

/**
 * Lightweight compile-time validation for ast-grep patterns (#1062).
 * Catches malformed patterns before they crash lint at runtime.
 *
 * String patterns: reject if empty or contains multiple top-level AST roots
 * (e.g. "componentDidCatch($$$) {}" has a function call + block → multi-root).
 * Object patterns (NapiConfig): reject if missing `rule` key.
 */
export function validateAstGrepPattern(pattern: string | Record<string, unknown>): RegexValidation {
  // ── Object pattern (NapiConfig / compound rule) ──
  if (typeof pattern === 'object' && pattern !== null) {
    if (!('rule' in pattern)) {
      return { valid: false, reason: 'object pattern missing required "rule" key' };
    }
    return { valid: true };
  }

  // ── String pattern ──
  if (typeof pattern !== 'string') {
    return { valid: false, reason: 'pattern must be a string or object' };
  }

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

  return { valid: true };
}

// ─── Rule builder (pure, no I/O) ────────────────────

/**
 * Build a CompiledRule from parsed compiler output.
 * Returns { rule, rejectReason } so callers can report why a rule was rejected.
 */
export function buildCompiledRule(
  parsed: CompilerOutput,
  lesson: { hash: string; heading: string },
  existingByHash: Map<string, CompiledRule>,
): BuildRuleResult {
  if (!parsed.compilable) return { rule: null };

  const severity = parsed.severity ?? 'warning';
  const engine = parsed.engine ?? 'regex';
  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
  const globsObj = sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {};

  if (engine === 'ast-grep') {
    if (!parsed.astGrepPattern || !parsed.message) {
      return { rule: null, rejectReason: 'Missing astGrepPattern or message' };
    }

    // Validate ast-grep pattern at compile time (#1062)
    const astValidation = validateAstGrepPattern(parsed.astGrepPattern);
    if (!astValidation.valid) {
      return { rule: null, rejectReason: `Invalid ast-grep pattern: ${astValidation.reason}` };
    }

    return {
      rule: {
        lessonHash: lesson.hash,
        lessonHeading: lesson.heading,
        message: parsed.message,
        engine: 'ast-grep',
        severity,
        ...engineFields('ast-grep', parsed.astGrepPattern),
        compiledAt: now,
        createdAt: existing?.createdAt ?? now,
        ...globsObj,
      },
    };
  }

  if (engine === 'ast') {
    if (!parsed.astQuery || !parsed.message) {
      return { rule: null, rejectReason: 'Missing astQuery or message' };
    }
    return {
      rule: {
        lessonHash: lesson.hash,
        lessonHeading: lesson.heading,
        message: parsed.message,
        engine: 'ast',
        severity,
        ...engineFields('ast', parsed.astQuery),
        compiledAt: now,
        createdAt: existing?.createdAt ?? now,
        ...globsObj,
      },
    };
  }

  // Regex engine (default)
  if (!parsed.pattern || !parsed.message) {
    return { rule: null, rejectReason: 'Missing pattern or message' };
  }
  const validation = validateRegex(parsed.pattern);
  if (!validation.valid) {
    return { rule: null, rejectReason: `Rejected regex: ${validation.reason}` };
  }

  return {
    rule: {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'regex',
      severity,
      ...engineFields('regex', parsed.pattern),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
    },
  };
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

  if (manual.engine === 'regex') {
    const validation = validateRegex(manual.pattern);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Manual pattern rejected: ${validation.reason}` };
    }
  }

  if (manual.engine === 'ast-grep') {
    const validation = validateAstGrepPattern(manual.pattern);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Manual ast-grep pattern rejected: ${validation.reason}` };
    }
  }

  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = manual.fileGlobs ? sanitizeFileGlobs(manual.fileGlobs) : undefined;

  return {
    rule: {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: lesson.heading,
      engine: manual.engine,
      severity: manual.severity,
      ...engineFields(manual.engine, manual.pattern),
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
    // Build a constrained prompt with the bad/good examples
    const examplePrompt = [
      compilerPrompt,
      '',
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

    const response = await runOrchestrator(examplePrompt);
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

    const ruleResult = buildCompiledRule(parsed, lesson, existingByHash);
    if (!ruleResult.rule) {
      callbacks?.onWarn?.(
        lesson.heading,
        `Pipeline 3: ${ruleResult.rejectReason ?? 'Unknown error'} — skipping`,
      );
      return { status: 'failed' };
    }

    // Self-verify: Bad lines should trigger, Good lines should not
    const testFixture = {
      ruleHash: lesson.hash,
      filePath: deriveVirtualFilePath(ruleResult.rule),
      failLines: snippets.bad,
      passLines: snippets.good,
      fixturePath: '(pipeline-3-self-test)',
    };
    const testResult = testRule(ruleResult.rule, testFixture);
    if (!testResult.passed) {
      callbacks?.onWarn?.(
        lesson.heading,
        'Pipeline 3: generated rule failed self-verification against Bad/Good snippets — skipping',
      );
      return { status: 'failed' };
    }

    return { status: 'compiled', rule: ruleResult.rule };
  }

  // ── Pipeline 2: LLM compilation ──────────────────
  const prompt = `${compilerPrompt}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;
  const response = await runOrchestrator(prompt);

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

  const ruleResult = buildCompiledRule(parsed, lesson, existingByHash);
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
