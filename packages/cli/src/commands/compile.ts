import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type CompiledRule,
  hashLesson,
  loadCompiledRules,
  parseCompilerResponse,
  parseLessonsFile,
  saveCompiledRules,
  validateRegex,
} from '@mmnto/totem';

import { log } from '../ui.js';
import { loadConfig, loadEnv, resolveConfigPath, runOrchestrator } from '../utils.js';

// ─── Constants ──────────────────────────────────────

const TAG = 'Compile';
const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Compiler prompt ────────────────────────────────

const COMPILER_SYSTEM_PROMPT = `# Lesson Compiler — Regex Rule Extraction

## Identity
You are a deterministic rule compiler. Your job is to read a single natural-language lesson and determine whether it can be expressed as a regex pattern that catches violations in source code diffs.

## Rules
- Output ONLY valid JSON — no markdown, no explanation, no preamble.
- The regex will be tested against individual lines added in a git diff (lines starting with \`+\`).
- The regex should catch **violations** (code that breaks the lesson's rule), NOT conformance.
- Use JavaScript RegExp syntax.
- Keep patterns simple and precise — avoid overly broad matches that cause false positives.
- If the lesson describes an architectural principle, design philosophy, or conceptual guideline that cannot be expressed as a line-level regex, set \`compilable\` to \`false\`.

## Output Schema
\`\`\`json
{
  "compilable": true,
  "pattern": "regex pattern here",
  "message": "human-readable violation message"
}
\`\`\`

Or if the lesson cannot be compiled:
\`\`\`json
{
  "compilable": false
}
\`\`\`

## Examples

Lesson: "Use \`err\` (never \`error\`) in catch blocks"
Output: {"compilable": true, "pattern": "catch\\\\s*\\\\(\\\\s*error\\\\s*[\\\\):]", "message": "Use 'err' instead of 'error' in catch blocks (project convention)"}

Lesson: "LanceDB does NOT support GROUP BY aggregation"
Output: {"compilable": false}

Lesson: "Never use npm in this pnpm monorepo — always use pnpm"
Output: {"compilable": true, "pattern": "\\\\bnpm\\\\s+(install|run|exec|ci|test)\\\\b", "message": "Use pnpm instead of npm in this monorepo"}
`;

// ─── Main command ───────────────────────────────────

export interface CompileOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  force?: boolean;
}

export async function compileCommand(options: CompileOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const lessonsPath = path.join(totemDir, 'lessons.md');
  const rulesPath = path.join(totemDir, COMPILED_RULES_FILE);

  if (!fs.existsSync(lessonsPath)) {
    log.warn(TAG, 'No lessons.md found. Nothing to compile.');
    return;
  }

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lessons = parseLessonsFile(content);

  if (lessons.length === 0) {
    log.warn(TAG, 'No lessons found in lessons.md.');
    return;
  }

  log.info(TAG, `Found ${lessons.length} lessons in lessons.md`);

  // Load existing compiled rules
  const existingRules = options.force ? [] : loadCompiledRules(rulesPath);
  const existingByHash = new Map(existingRules.map((r) => [r.lessonHash, r]));

  // Determine which lessons need compilation
  const toCompile: Array<{ index: number; heading: string; body: string; hash: string }> = [];

  for (const lesson of lessons) {
    const hash = hashLesson(lesson.heading, lesson.body);
    if (!existingByHash.has(hash)) {
      toCompile.push({ index: lesson.index, heading: lesson.heading, body: lesson.body, hash });
    }
  }

  if (toCompile.length === 0) {
    log.success(TAG, `All ${lessons.length} lessons already compiled. Use --force to recompile.`);
    return;
  }

  log.info(
    TAG,
    `${toCompile.length} lessons need compilation (${existingRules.length} already compiled)`,
  );

  // Compile each lesson
  let compiled = 0;
  let skipped = 0;
  let failed = 0;
  const newRules: CompiledRule[] = [...existingRules];

  // Remove stale rules (lessons that no longer exist)
  const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
  const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
  const pruned = newRules.length - freshRules.length;
  if (pruned > 0) {
    log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`);
  }
  newRules.length = 0;
  newRules.push(...freshRules);

  for (const lesson of toCompile) {
    const prompt = `${COMPILER_SYSTEM_PROMPT}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;

    const response = await runOrchestrator({
      prompt,
      tag: TAG,
      options,
      config,
      cwd,
    });

    if (response == null) {
      // --raw mode — prompt was output, nothing to parse
      continue;
    }

    const parsed = parseCompilerResponse(response);

    if (!parsed) {
      log.warn(TAG, `[${lesson.heading}] Failed to parse LLM response — skipping`);
      failed++;
      continue;
    }

    if (!parsed.compilable) {
      log.dim(TAG, `[${lesson.heading}] Not compilable (conceptual/architectural) — skipping`);
      skipped++;
      continue;
    }

    if (!parsed.pattern || !parsed.message) {
      log.warn(TAG, `[${lesson.heading}] Missing pattern or message — skipping`);
      failed++;
      continue;
    }

    if (!validateRegex(parsed.pattern)) {
      log.warn(TAG, `[${lesson.heading}] Invalid regex: ${parsed.pattern} — skipping`);
      failed++;
      continue;
    }

    newRules.push({
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      pattern: parsed.pattern,
      message: parsed.message,
      engine: 'regex',
      compiledAt: new Date().toISOString(),
    });
    compiled++;
    log.success(TAG, `[${lesson.heading}] Compiled: /${parsed.pattern}/`);
  }

  // Save results
  if (!options.raw) {
    saveCompiledRules(rulesPath, newRules);
    log.info(
      TAG,
      `Results: ${compiled} compiled, ${skipped} skipped (conceptual), ${failed} failed`,
    );
    log.success(
      TAG,
      `${newRules.length} total rules saved to ${config.totemDir}/${COMPILED_RULES_FILE}`,
    );
  }
}
