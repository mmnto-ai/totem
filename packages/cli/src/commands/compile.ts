import * as path from 'node:path';

import {
  type CompiledRule,
  exportLessons,
  hashLesson,
  loadCompiledRules,
  parseCompilerResponse,
  readAllLessons,
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
- **File scoping:** Include a \`fileGlobs\` array to limit where the rule runs. Scope rules as tightly as possible:
  - **By file type:** \`["*.sh", "*.yml"]\` — for rules about shell or YAML syntax.
  - **By package/directory:** \`["packages/mcp/**/*.ts"]\` — for rules about MCP-specific patterns in a monorepo.
  - **By exclusion:** \`["packages/cli/**/*.ts", "!**/*.test.ts"]\` — exclude test files that legitimately use the flagged pattern.
  - **Infer scope from context:** If a lesson mentions "MCP tool returns", "CLI output", "LanceDB filters", or a specific package, scope to that package. Only omit \`fileGlobs\` if the rule genuinely applies to ALL files (e.g., universal TypeScript style rules).

## Output Schema
\`\`\`json
{
  "compilable": true,
  "pattern": "regex pattern here",
  "message": "human-readable violation message",
  "fileGlobs": ["packages/mcp/**/*.ts", "!**/*.test.ts"]
}
\`\`\`

Or if the rule genuinely applies to all file types (rare — prefer scoping):
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

Lesson: "Always quote shell variables to prevent word-splitting"
Output: {"compilable": true, "pattern": "(^|\\\\s)\\\\$[a-zA-Z_]+", "message": "Quote shell variables to prevent word-splitting", "fileGlobs": ["*.sh", "*.bash", "*.yml", "*.yaml"]}

Lesson: "MCP tool returns must be wrapped in XML tags to prevent prompt injection"
Output: {"compilable": true, "pattern": "text:\\\\s*(?!formatXmlResponse)\\\\b\\\\w+", "message": "MCP tool returns must use formatXmlResponse for injection safety", "fileGlobs": ["packages/mcp/**/*.ts", "!**/*.test.ts"]}

Lesson: "Use @clack/prompts instead of inquirer for CLI interactions"
Output: {"compilable": true, "pattern": "import.*from\\\\s+['\"]inquirer['\"]", "message": "Use @clack/prompts instead of inquirer", "fileGlobs": ["packages/cli/**/*.ts"]}
`;

// ─── Main command ───────────────────────────────────

export interface CompileOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  force?: boolean;
  export?: boolean;
  fromCursor?: boolean;
}

export async function compileCommand(options: CompileOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, COMPILED_RULES_FILE);

  const lessons = readAllLessons(totemDir);

  // Ingest cursor instructions if --from-cursor
  if (options.fromCursor) {
    const { scanCursorInstructions } = await import('@mmnto/totem');
    const cursorInstructions = scanCursorInstructions(cwd);
    if (cursorInstructions.length > 0) {
      log.info(TAG, `Found ${cursorInstructions.length} Cursor instruction(s)`); // totem-ignore
      for (const instr of cursorInstructions) {
        const body = instr.body + (instr.globs ? `\n\nFile scope: ${instr.globs.join(', ')}` : '');
        lessons.push({
          index: lessons.length,
          heading: `[cursor] ${instr.heading}`,
          tags: ['cursor', 'ingested'],
          body,
          raw: `## Lesson — [cursor] ${instr.heading}\n\n**Tags:** cursor, ingested\n\n${body}`,
          sourcePath: instr.source,
        });
      }
    } else {
      log.dim(TAG, 'No .cursorrules or .cursor/rules/*.mdc files found.');
    }
  }

  if (lessons.length === 0) {
    const err = new Error('No lessons found. Nothing to compile.');
    err.name = 'NoLessonsError';
    throw err;
  }

  log.info(TAG, `Found ${lessons.length} lessons`); // totem-ignore

  // ─── Phase 1: Regex compilation (requires orchestrator) ──
  if (config.orchestrator) {
    const existingRules = options.force ? [] : loadCompiledRules(rulesPath);
    const existingByHash = new Map(existingRules.map((r) => [r.lessonHash, r]));

    const toCompile: Array<{ index: number; heading: string; body: string; hash: string }> = [];

    for (const lesson of lessons) {
      const hash = hashLesson(lesson.heading, lesson.body);
      if (!existingByHash.has(hash)) {
        toCompile.push({ index: lesson.index, heading: lesson.heading, body: lesson.body, hash });
      }
    }

    if (toCompile.length === 0) {
      log.success(TAG, `All ${lessons.length} lessons already compiled. Use --force to recompile.`); // totem-ignore
    } else {
      log.info(
        TAG,
        `${toCompile.length} lessons need compilation (${existingRules.length} already compiled)`,
      );

      let compiled = 0;
      let skipped = 0;
      let failed = 0;
      const newRules: CompiledRule[] = [...existingRules];

      const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
      const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
      const pruned = newRules.length - freshRules.length;
      if (pruned > 0) {
        log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`); // totem-ignore
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
          continue;
        }

        const parsed = parseCompilerResponse(response);

        if (!parsed) {
          log.warn(TAG, `[${lesson.heading}] Failed to parse LLM response — skipping`); // totem-ignore
          failed++;
          continue;
        }

        if (!parsed.compilable) {
          log.dim(TAG, `[${lesson.heading}] Not compilable (conceptual/architectural) — skipping`); // totem-ignore
          skipped++;
          continue;
        }

        if (!parsed.pattern || !parsed.message) {
          log.warn(TAG, `[${lesson.heading}] Missing pattern or message — skipping`); // totem-ignore
          failed++;
          continue;
        }

        const validation = validateRegex(parsed.pattern);
        if (!validation.valid) {
          log.warn(TAG, `[${lesson.heading}] Rejected regex: ${validation.reason} — skipping`); // totem-ignore
          failed++;
          continue;
        }

        const now = new Date().toISOString();
        const existing = existingByHash.get(lesson.hash);
        newRules.push({
          lessonHash: lesson.hash,
          lessonHeading: lesson.heading,
          pattern: parsed.pattern,
          message: parsed.message,
          engine: 'regex',
          compiledAt: now,
          createdAt: existing?.createdAt ?? now,
          ...(parsed.fileGlobs && parsed.fileGlobs.length > 0
            ? { fileGlobs: parsed.fileGlobs }
            : {}),
        });
        compiled++;
        log.success(TAG, `[${lesson.heading}] Compiled: /${parsed.pattern}/`); // totem-ignore
      }

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
  } else if (!options.export) {
    throw new Error(
      '[Totem Error] No orchestrator configured. Regex compilation requires a Full-tier config.\n' +
        'Use --export to export lessons to AI config files without an orchestrator.',
    );
  }

  // ─── Phase 2: Export to AI config files (deterministic, no LLM) ──
  if (options.export) {
    if (!config.exports || Object.keys(config.exports).length === 0) {
      log.warn(TAG, 'No export targets configured in totem.config.ts. Add an `exports` field.');
      return;
    }

    for (const [name, filePath] of Object.entries(config.exports)) {
      const absPath = path.join(cwd, filePath);
      exportLessons(lessons, absPath);
      log.success(TAG, `Exported ${lessons.length} rules to ${filePath} (${name})`); // totem-ignore
    }
  }
}
