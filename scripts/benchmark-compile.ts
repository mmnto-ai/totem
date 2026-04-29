#!/usr/bin/env tsx
/**
 * Strategy #73 — Compilation Quality Benchmark
 * Gemini Pro vs gemma4:26b head-to-head on 30 curated lessons.
 *
 * Usage: pnpm tsx scripts/benchmark-compile.ts
 * Output: <strategyRoot>/research/benchmark-compilation-quality-results.md
 *
 * Strategy root is resolved via `resolveStrategyRoot` (mmnto-ai/totem#1710);
 * hard-fails when unresolvable.
 */

import { parseCompilerResponse, validateRegex } from '../packages/core/src/compiler.js';
import { resolveStrategyRoot } from '../packages/core/src/strategy-resolver.js';

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const OLLAMA_MODEL = 'gemma4:26b';
const OLLAMA_BASE = 'http://localhost:11434';
const TEMPERATURE = 0;

// CLI args: --models gemini,anthropic --tier ast-grep
const args = process.argv.slice(2);
const modelFlag = args.find((a) => a.startsWith('--models='))?.split('=')[1] ?? 'gemini,anthropic';
const tierFlag = args.find((a) => a.startsWith('--tier='))?.split('=')[1] ?? '';
const ENABLED_MODELS = modelFlag.split(',');
const TIER_FILTER = tierFlag;

// ── Compiler prompt (loaded inside main) ──

let COMPILER_PROMPT = '';

// ── Benchmark corpus ──

interface BenchmarkLesson {
  id: string;
  tier: string;
  heading: string;
  body: string;
  expectedEngine: string;
  scoringNotes: string;
}

const LESSONS: BenchmarkLesson[] = [
  // ─── Tier 1: Standard Structural ───
  {
    id: 'S01',
    tier: 'standard',
    heading: 'Runtime crashes from missing environment variables',
    body: 'Accessing process.env.MY_VAR without validation causes undefined-as-string bugs that surface only in production. Validate ALL required environment variables at build time using a schema (Zod, envalid) and fail fast. Fix: Validate environment variables at application startup using a schema library like Zod.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match process.env.FOO property access',
  },
  {
    id: 'S02',
    tier: 'standard',
    heading: 'Hardcoded localhost URLs in production code',
    body: 'WebSocket connections, API endpoints, and asset URLs that hardcode localhost or 127.0.0.1 work in dev but break in production. Always derive URLs from configuration or the request context. Fix: Read base URLs from environment variables or derive from the incoming request.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match http://localhost and ws://127.0.0.1',
  },
  {
    id: 'S03',
    tier: 'standard',
    heading: 'Silent TODO placeholders in production code',
    body: 'If a requested feature cannot be fully implemented, you MUST throw an explicit error or insert a visible warning. Never fail silently by returning null or leaving a hidden // TODO comment. Fix: Raise a NotImplementedError or render a visible placeholder.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match // TODO comments',
  },
  {
    id: 'S04',
    tier: 'standard',
    heading: 'Console.log statements left in production code',
    body: 'Console.log statements left in production code leak internal state to browser devtools and create noise in server logs. Remove all debugging console statements before merging. Fix: Use a structured logger for server-side logging. Remove client-side console.log calls.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match console.log/debug/info but NOT console.error/warn',
  },
  {
    id: 'S05',
    tier: 'standard',
    heading: 'Hardcoded numeric timeout values',
    body: 'Hardcoded timeout values like setTimeout(fn, 5000) scatter timing assumptions across the codebase. When requirements change, every callsite must be found manually. Fix: Extract timeout durations into named constants or configuration.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match setTimeout/setInterval with inline numbers',
  },
  {
    id: 'S06',
    tier: 'standard',
    heading: 'Direct DOM manipulation in React components',
    body: 'Direct DOM manipulation via document.getElementById or document.querySelector in React components bypasses the virtual DOM, causing stale references and reconciliation bugs. Fix: Use refs (useRef) for imperative DOM access.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match document.getElementById/querySelector/createElement',
  },
  {
    id: 'S07',
    tier: 'standard',
    heading: 'Synchronous file I/O in request handlers',
    body: 'Synchronous file operations (readFileSync, writeFileSync) block the event loop and destroy server throughput under concurrent load. Fix: Use async alternatives (readFile, writeFile) with await.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match readFileSync/writeFileSync/existsSync',
  },
  {
    id: 'S08',
    tier: 'standard',
    heading: 'Mutable default parameters in function signatures',
    body: 'Using mutable objects as default parameter values (function foo(arr = [])) causes shared state between calls in some edge cases and signals unclear intent. Fix: Use null or undefined as default, then create the object inside the function body.',
    expectedEngine: 'regex',
    scoringNotes:
      'Should match default params with [] or {}. Tricky — must handle arrow functions too.',
  },
  {
    id: 'S09',
    tier: 'standard',
    heading: 'Catch blocks that swallow errors silently',
    body: 'Empty catch blocks silently swallow errors, hiding bugs that surface later as mysterious state corruption. Every catch block must at minimum log the error. Fix: Log the caught error or re-throw it. Never leave a catch block empty.',
    expectedEngine: 'regex',
    scoringNotes: 'Should match catch (err) { } but NOT catch with body',
  },
  {
    id: 'S10',
    tier: 'standard',
    heading: 'Secret Management — detecting hardcoded credentials',
    body: 'Never commit API keys, tokens, or credentials to version control. Use environment variables loaded at runtime. If a secret is accidentally committed, rotate it immediately. Fix: Store secrets in environment variables or a secrets manager. Look for patterns like const API_KEY = "sk-..." or token: "ghp_...".',
    expectedEngine: 'regex',
    scoringNotes:
      'Should detect vendor-prefixed secret assignments. Should NOT match env var reads.',
  },

  // ─── Tier 2: Complex AST-Grep ───
  {
    id: 'A01',
    tier: 'ast-grep',
    heading: 'String.replace on process.cwd() instead of path.relative',
    body: "Using filePath.replace(process.cwd(), '') to make paths relative is fragile — it fails when cwd contains regex metacharacters or when the path doesn't start with cwd. Use path.relative(process.cwd(), filePath) instead. Fix: Replace all .replace(process.cwd(), ...) calls with path.relative().",
    expectedEngine: 'ast-grep',
    scoringNotes:
      'Must produce ast-grep pattern matching method call with process.cwd() as first arg',
  },
  {
    id: 'A02',
    tier: 'ast-grep',
    heading: 'Shell option in spawn() with array arguments',
    body: 'When spawn() receives arguments as an array (the safe form), adding shell: true negates the safety benefit by concatenating the array back into a shell string. Only use shell: true with the two-argument string form. Fix: Remove shell: true when passing args as an array to spawn().',
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must match three-argument spawn with array literal AND shell:true in options',
  },
  {
    id: 'A03',
    tier: 'ast-grep',
    heading: 'try/catch with expect.fail() anti-pattern in tests',
    body: "Using try/catch with expect.fail() in tests is an anti-pattern. If the code under test doesn't throw, the test passes silently (expect.fail is never reached). Use expect(promise).rejects.toThrow() instead. Fix: Replace try/catch/expect.fail with await expect(fn).rejects.toThrow().",
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must match full try-catch structure with expect.fail inside try block',
  },
  {
    id: 'A04',
    tier: 'ast-grep',
    heading: 'JSON.parse result used with unsafe type assertion',
    body: 'Casting JSON.parse() output directly with `as` bypasses runtime type checking. The parsed data may not match the asserted type, causing silent type-unsafe code. Fix: Validate parsed JSON with Zod or a runtime type guard before using it.',
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must detect `as` type assertion on JSON.parse result',
  },
  {
    id: 'A05',
    tier: 'ast-grep',
    heading: 'Array index access after indexOf without bounds check',
    body: 'Accessing args[args.indexOf(flag) + 1] without checking that indexOf returned a valid position gives undefined when the flag is missing, and the wrong value when the flag is the last element. Fix: Check the indexOf result before using it as an array index.',
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must match nested array access with indexOf + 1 arithmetic',
  },
  {
    id: 'A06',
    tier: 'ast-grep',
    heading: 'new RegExp with string concatenation for flags',
    body: "Blindly appending the 'g' flag to a RegExp without checking if it's already present causes duplicate flag errors at runtime. Fix: Check for existing flags before appending.",
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must match RegExp constructor with concatenated flag argument',
  },
  {
    id: 'A07',
    tier: 'ast-grep',
    heading: 'Async function passed to Array.forEach',
    body: 'Passing an async function to Array.forEach() silently drops the returned promises — errors are unhandled and iteration appears synchronous. Use for...of with await or Promise.all(arr.map(async ...)). Fix: Replace .forEach(async ...) with for...of loop or Promise.all(arr.map(...)).',
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must match forEach call with async arrow function callback',
  },
  {
    id: 'A08',
    tier: 'ast-grep',
    heading: 'Dynamic import() with template literal argument',
    body: 'Using import() with a fully dynamic argument (template literal or variable) defeats tree-shaking and may allow path traversal if the variable is user-controlled. Fix: Use static strings or constrained paths with import().',
    expectedEngine: 'ast-grep',
    scoringNotes:
      'Must match dynamic import with template literal. Should NOT match static strings.',
  },
  {
    id: 'A09',
    tier: 'ast-grep',
    heading: 'Event listener without cleanup in useEffect',
    body: 'Adding an event listener inside useEffect without returning a cleanup function that calls removeEventListener causes memory leaks on component unmount. Fix: Always return a cleanup function from useEffect that removes the listener.',
    expectedEngine: 'ast-grep',
    scoringNotes:
      'Borderline — regex or ast-grep both acceptable. Score on whether it catches the bug.',
  },
  {
    id: 'A10',
    tier: 'ast-grep',
    heading: 'Nested ternary expressions beyond two levels',
    body: 'Nested ternaries beyond two levels are unreadable and error-prone. Extracting to if/else blocks or a lookup object improves maintainability. Fix: Replace deeply nested ternaries with if/else chains or a mapping object.',
    expectedEngine: 'ast-grep',
    scoringNotes: 'Must detect ternary inside ternary. Tests recursive pattern nesting.',
  },

  // ─── Tier 3: Adversarial / ReDoS Traps ───
  {
    id: 'R01',
    tier: 'adversarial',
    heading: 'CSS class name conflicts from dynamic string building',
    body: 'Building CSS class names by concatenating user input or dynamic values creates injection vectors and specificity conflicts. Fix: Use CSS modules, Tailwind utility classes, or a classnames() utility library.',
    expectedEngine: 'regex',
    scoringNotes:
      'TRAP: naive .* between quotes causes catastrophic backtracking. Any unbounded .* is FAIL.',
  },
  {
    id: 'R02',
    tier: 'adversarial',
    heading: 'Deeply nested callback chains (callback hell)',
    body: 'Deeply nested callbacks make error handling impossible and create pyramid-shaped code. Fix: Refactor to async/await or Promise chains.',
    expectedEngine: 'regex',
    scoringNotes: 'TRAP: nested quantifiers like (.*)*. Any nested quantifier is FAIL.',
  },
  {
    id: 'R03',
    tier: 'adversarial',
    heading: 'HTML attribute injection via unescaped template literals',
    body: 'Inserting user-controlled values into HTML attributes without escaping enables attribute injection and XSS. Template literals like `<div class="${userInput}">` are especially dangerous. Fix: Use a framework\'s built-in escaping or DOMPurify.',
    expectedEngine: 'regex',
    scoringNotes: 'TRAP: alternation inside repetition. Unbounded nested quantifiers are FAIL.',
  },
  {
    id: 'R04',
    tier: 'adversarial',
    heading: 'Regex patterns that match their own suppression directive',
    body: 'When writing lint rules about comment quality or documentation, a naive pattern like //.*totem would match the suppression directives themselves, causing the rule to self-suppress at runtime. Fix: Exclude suppression directive patterns from comment-matching rules.',
    expectedEngine: 'regex',
    scoringNotes: 'TRAP: self-suppressing pattern. isSelfSuppressing guard should catch this.',
  },
  {
    id: 'R05',
    tier: 'adversarial',
    heading: 'Multiple export patterns from a single module',
    body: 'Modules that export more than one public API make dependency tracking harder and increase bundle size through missed tree-shaking. Prefer single-responsibility modules with one default export. Fix: Split large modules into focused files with single exports.',
    expectedEngine: 'regex',
    scoringNotes: 'TRAP: trailing .* or multi-line wildcards. Any [\\s\\S]* or (.|\\n)* is FAIL.',
  },

  // ─── Tier 4: Ambiguous / Semantic ───
  {
    id: 'M01',
    tier: 'ambiguous',
    heading: 'Premature abstraction in utility functions',
    body: 'Creating utility functions, helper classes, or wrapper abstractions before you have three concrete use cases leads to wrong abstractions that are harder to change than duplication. Fix: Tolerate duplication until patterns emerge naturally from real usage.',
    expectedEngine: 'non-compilable',
    scoringNotes: 'Correct answer: compilable=false. Any pattern is WRONG.',
  },
  {
    id: 'M02',
    tier: 'ambiguous',
    heading: 'Inconsistent error handling strategies across modules',
    body: 'Mixing try/catch, .catch(), error-first callbacks, and Result types across a codebase creates confusion about where errors are handled. Fix: Adopt a single error-handling strategy per layer.',
    expectedEngine: 'non-compilable',
    scoringNotes: 'Correct answer: compilable=false. Any pattern is WRONG.',
  },
  {
    id: 'M03',
    tier: 'ambiguous',
    heading: 'Feature flags left enabled after full rollout',
    body: 'Feature flags (e.g., if (flags.newCheckout)) that remain in code after the feature is fully rolled out create dead branches, confuse new developers, and bloat bundle size. Fix: Remove feature flag conditionals once the feature is permanently enabled.',
    expectedEngine: 'regex',
    scoringNotes: 'Debatable scope. Score on whether pattern is reasonable and well-scoped.',
  },
  {
    id: 'M04',
    tier: 'ambiguous',
    heading: 'Coupling between UI components and data fetching',
    body: 'Components that fetch their own data (via useEffect + fetch or useSWR) are tightly coupled to their data source, making them impossible to test without mocking network calls. Fix: Lift data fetching to parent components or use a data layer to decouple.',
    expectedEngine: 'regex',
    scoringNotes:
      'Debatable — narrow pattern or non-compilable both defensible. Score on reasoning.',
  },
  {
    id: 'M05',
    tier: 'ambiguous',
    heading: 'Magic strings for event names and action types',
    body: "Using raw string literals for event names (emit('user-logged-in')) and Redux action types (dispatch({ type: 'INCREMENT' })) causes silent bugs when strings are misspelled across files. Fix: Use TypeScript enums, const objects, or string literal union types.",
    expectedEngine: 'regex',
    scoringNotes:
      'Debatable scope. Challenge is scoping to event/action contexts without false positives.',
  },
];

// ── Model invocation ──

async function invokeGemini(prompt: string): Promise<{ response: string; durationMs: number }> {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
  });
  const start = Date.now();
  const result = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { temperature: TEMPERATURE },
  });
  return { response: result.text ?? '', durationMs: Date.now() - start };
}

async function invokeAnthropic(prompt: string): Promise<{ response: string; durationMs: number }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();
  const start = Date.now();
  const result = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    temperature: TEMPERATURE,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = result.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { response: text, durationMs: Date.now() - start };
}

async function invokeOllama(prompt: string): Promise<{ response: string; durationMs: number }> {
  const start = Date.now();
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: TEMPERATURE, num_ctx: 32768 },
    }),
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return { response: data.message?.content ?? '', durationMs: Date.now() - start };
}

// ── Scoring ──

interface CompileResult {
  lessonId: string;
  model: string;
  compilable: boolean | null;
  engine: string | null;
  pattern: string | null;
  message: string | null;
  reason: string | null;
  fileGlobs: string[] | null;
  severity: string | null;
  durationMs: number;
  parseSuccess: boolean;
  regexValid: boolean | null;
  regexRejectReason: string | null;
  rawResponse: string;
}

function scoreLesson(
  lesson: BenchmarkLesson,
  result: CompileResult,
): { correct: boolean; safe: boolean; notes: string } {
  // Parse failure
  if (!result.parseSuccess) {
    return { correct: false, safe: true, notes: 'Failed to parse LLM response' };
  }

  // Non-compilable lessons
  if (lesson.expectedEngine === 'non-compilable') {
    if (!result.compilable) {
      return { correct: true, safe: true, notes: 'Correctly identified as non-compilable' };
    }
    return {
      correct: false,
      safe: true,
      notes: 'Should have been non-compilable but generated a pattern',
    };
  }

  // Compilable lessons that model said non-compilable
  if (!result.compilable) {
    return { correct: false, safe: true, notes: `Model said non-compilable: ${result.reason}` };
  }

  // Safety checks for regex patterns
  let safe = true;
  let safetyNotes = '';
  if (result.engine === 'regex' && result.pattern) {
    // Check for ReDoS patterns
    if (/\.\*.*\.\*/.test(result.pattern)) {
      safe = false;
      safetyNotes += 'Multiple .* in pattern (potential backtracking). ';
    }
    if (/\([^)]*\*[^)]*\)\*/.test(result.pattern) || /\([^)]*\+[^)]*\)\+/.test(result.pattern)) {
      safe = false;
      safetyNotes += 'Nested quantifiers detected (ReDoS risk). ';
    }
    if (/\(\.\|\\n\)\*/.test(result.pattern) || /\[\\s\\S\]\*/.test(result.pattern)) {
      safe = false;
      safetyNotes += 'Multi-line wildcard detected. ';
    }
    if (!result.regexValid) {
      safe = false;
      safetyNotes += `Regex rejected: ${result.regexRejectReason}. `;
    }
  }

  // Engine correctness (ast-grep tier)
  if (lesson.tier === 'ast-grep' && result.engine !== 'ast-grep') {
    return {
      correct: false,
      safe,
      notes: `Expected ast-grep but got ${result.engine}. ${safetyNotes}`,
    };
  }

  return {
    correct: true,
    safe,
    notes: safetyNotes || 'OK',
  };
}

// ── Main ──

async function runBenchmark() {
  COMPILER_PROMPT = (await import('../packages/cli/src/commands/compile-templates.js'))
    .COMPILER_SYSTEM_PROMPT;

  const modelInvokers: [
    string,
    (p: string) => Promise<{ response: string; durationMs: number }>,
  ][] = [];
  if (ENABLED_MODELS.includes('gemini')) modelInvokers.push(['gemini', invokeGemini]);
  if (ENABLED_MODELS.includes('anthropic')) modelInvokers.push(['anthropic', invokeAnthropic]);
  if (ENABLED_MODELS.includes('ollama')) modelInvokers.push(['ollama', invokeOllama]);

  const filteredLessons = TIER_FILTER ? LESSONS.filter((l) => l.tier === TIER_FILTER) : LESSONS;

  console.error(`\n=== Compilation Quality Benchmark ===`);
  console.error(`Models: ${modelInvokers.map(([n]) => n).join(', ')}`);
  console.error(
    `Lessons: ${filteredLessons.length}${TIER_FILTER ? ` (tier: ${TIER_FILTER})` : ''} | Temperature: ${TEMPERATURE}\n`,
  );

  const results: CompileResult[] = [];

  for (const lesson of filteredLessons) {
    const prompt = `${COMPILER_PROMPT}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;

    for (const [modelName, invoke] of modelInvokers) {
      const tag = `[${lesson.id}] ${modelName}`;
      console.error(`${tag}: compiling "${lesson.heading}"...`);

      let response = '';
      let durationMs = 0;
      try {
        const r = await invoke(prompt);
        response = r.response;
        durationMs = r.durationMs;
      } catch (err) {
        console.error(`${tag}: ERROR — ${(err as Error).message}`);
        results.push({
          lessonId: lesson.id,
          model: modelName,
          compilable: null,
          engine: null,
          pattern: null,
          message: null,
          reason: null,
          fileGlobs: null,
          severity: null,
          durationMs: 0,
          parseSuccess: false,
          regexValid: null,
          regexRejectReason: null,
          rawResponse: `ERROR: ${(err as Error).message}`,
        });
        continue;
      }

      const parsed = parseCompilerResponse(response);
      let regexValid: boolean | null = null;
      let regexRejectReason: string | null = null;

      if (parsed?.pattern && parsed.engine !== 'ast-grep' && parsed.engine !== 'ast') {
        const validation = validateRegex(parsed.pattern);
        regexValid = validation.valid;
        regexRejectReason = validation.valid ? null : (validation.reason ?? 'unknown');
      }

      results.push({
        lessonId: lesson.id,
        model: modelName,
        compilable: parsed?.compilable ?? null,
        engine: parsed?.engine ?? (parsed?.pattern ? 'regex' : null),
        pattern: parsed?.pattern ?? parsed?.astGrepPattern?.toString() ?? parsed?.astQuery ?? null,
        message: parsed?.message ?? null,
        reason: parsed?.reason ?? null,
        fileGlobs: parsed?.fileGlobs ?? null,
        severity: parsed?.severity ?? null,
        durationMs,
        parseSuccess: parsed !== null,
        regexValid,
        regexRejectReason,
        rawResponse: response,
      });

      console.error(
        `${tag}: ${durationMs}ms — ${parsed ? (parsed.compilable ? `${parsed.engine ?? 'regex'}` : 'non-compilable') : 'PARSE FAIL'}`,
      );
    }
  }

  // ── Generate report ──
  const lines: string[] = [];
  lines.push('# Compilation Quality Benchmark — Results');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  const modelNames = modelInvokers.map(([n]) => n);
  lines.push(`**Models:** ${modelNames.join(', ')}`);
  lines.push(
    `**Temperature:** ${TEMPERATURE} | **Lessons:** ${filteredLessons.length}${TIER_FILTER ? ` (tier: ${TIER_FILTER})` : ''}`,
  );
  lines.push('');

  // Scorecard by tier
  const tiers = [...new Set(filteredLessons.map((l) => l.tier))];
  for (const tier of tiers) {
    const tierLessons = filteredLessons.filter((l) => l.tier === tier);
    lines.push(`## Tier: ${tier}`);
    lines.push('');
    const header = ['ID', 'Lesson', ...modelNames].join(' | ');
    const sep = ['----', '--------', ...modelNames.map(() => '--------')].join('|');
    lines.push(`| ${header} |`);
    lines.push(`|${sep}|`);

    for (const lesson of tierLessons) {
      const cells = [lesson.id, lesson.heading];
      for (const model of modelNames) {
        const r = results.find((mr) => mr.lessonId === lesson.id && mr.model === model);
        if (!r) {
          cells.push('SKIP');
          continue;
        }
        const score = scoreLesson(lesson, r);
        const icon = score.correct && score.safe ? 'PASS' : !score.safe ? 'UNSAFE' : 'FAIL';
        cells.push(`${icon} (${r.durationMs}ms)`);
      }
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  // Aggregate scores
  lines.push('## Aggregate Scorecard');
  lines.push('');
  for (const model of modelNames) {
    const modelResults = results.filter((r) => r.model === model);
    if (modelResults.length === 0) continue;
    const total = filteredLessons.length;
    const parseOk = modelResults.filter((r) => r.parseSuccess).length;
    const correct = filteredLessons.filter((l) => {
      const r = modelResults.find((mr) => mr.lessonId === l.id);
      return r && scoreLesson(l, r).correct;
    }).length;
    const safe = filteredLessons.filter((l) => {
      const r = modelResults.find((mr) => mr.lessonId === l.id);
      return r && scoreLesson(l, r).safe;
    }).length;
    const avgMs = Math.round(
      modelResults.reduce((s, r) => s + r.durationMs, 0) / modelResults.length,
    );

    lines.push(`### ${model}`);
    lines.push('');
    lines.push(`- **Parse success:** ${parseOk}/${total}`);
    lines.push(`- **Correctness:** ${correct}/${total} (${Math.round((correct / total) * 100)}%)`);
    lines.push(`- **Safety:** ${safe}/${total} (${Math.round((safe / total) * 100)}%)`);
    lines.push(`- **Avg latency:** ${avgMs}ms`);
    lines.push('');
  }

  // Detailed output per lesson
  lines.push('## Detailed Results');
  lines.push('');
  for (const lesson of filteredLessons) {
    lines.push(`### ${lesson.id} — ${lesson.heading}`);
    lines.push('');
    for (const model of modelNames) {
      const r = results.find((mr) => mr.lessonId === lesson.id && mr.model === model);
      if (!r) continue;
      lines.push(`**${model}** (${r.durationMs}ms):`);
      if (!r.parseSuccess) {
        lines.push('- Parse: FAILED');
        lines.push(`- Raw: \`${r.rawResponse.slice(0, 200)}\``);
      } else if (!r.compilable) {
        lines.push(`- Compilable: false — ${r.reason}`);
      } else {
        lines.push(`- Engine: ${r.engine}`);
        lines.push(`- Pattern: \`${r.pattern}\``);
        lines.push(`- Message: ${r.message}`);
        if (r.fileGlobs) lines.push(`- Globs: ${r.fileGlobs.join(', ')}`);
        if (r.regexValid === false) lines.push(`- Regex REJECTED: ${r.regexRejectReason}`);
      }
      lines.push('');
    }
  }

  const strategyStatus = resolveStrategyRoot(process.cwd());
  if (!strategyStatus.resolved) {
    console.error(`[bench] Cannot write report: ${strategyStatus.reason}`);
    console.error(
      '[bench] Set TOTEM_STRATEGY_ROOT, configure totem.config.ts:strategyRoot, or run from inside the totem checkout with a sibling totem-strategy clone.',
    );
    process.exit(1);
  }

  const report = lines.join('\n');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const researchDir = path.join(strategyStatus.path, 'research');
  fs.mkdirSync(researchDir, { recursive: true });

  const reportPath = path.join(researchDir, 'benchmark-compilation-quality-results.md');
  fs.writeFileSync(reportPath, report);
  console.error(`\nReport written to ${reportPath}`);

  // Also write raw JSON for analysis
  const rawPath = path.join(researchDir, 'benchmark-compilation-quality-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(results, null, 2));
  console.error(`Raw data written to ${rawPath}`);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
