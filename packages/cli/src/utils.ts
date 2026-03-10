import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SearchResult, TotemConfig } from '@mmnto/totem';
import { TotemConfigSchema } from '@mmnto/totem';

import type { OrchestratorResult } from './orchestrators/orchestrator.js';
import { createOrchestrator, resolveOrchestrator } from './orchestrators/orchestrator.js';
import { bold, log } from './ui.js';

// ─── Shared constants ────────────────────────────────────

const MODEL_NAME_RE = /^[\w./:_-]+$/;
const TELEMETRY_FILE = 'telemetry.jsonl';

/** execFileSync on Windows can't resolve executables without `shell: true`. */
export const IS_WIN = process.platform === 'win32';

/** Timeout for GitHub CLI calls (ms). */
export const GH_TIMEOUT_MS = 15_000;

/**
 * Load environment variables from .env file (does not override existing).
 */
export function loadEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1]!.trim();
      const raw = match[2]!.trim();
      const value = raw.replace(/^(['"])(.*)(\1)$/, '$2');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Load and parse totem.config.ts via jiti.
 */
export async function loadConfig(configPath: string): Promise<TotemConfig> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  return TotemConfigSchema.parse(raw);
}

/**
 * Resolve config path and validate it exists. Exits if missing.
 */
export function resolveConfigPath(cwd: string): string {
  const configPath = path.join(cwd, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error('[Totem Error] No totem.config.ts found. Run `totem init` first.');
  }
  return configPath;
}

// Re-export from core — unified embedding guard (#187)
export { requireEmbedding } from '@mmnto/totem';

// ─── Telemetry ──────────────────────────────────────────

interface TelemetryEntry {
  timestamp: string;
  tag: string;
  model: string;
  promptChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}

function appendTelemetry(entry: TelemetryEntry, cwd: string, totemDir: string): void {
  try {
    const tempDir = path.join(cwd, totemDir, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.appendFileSync(path.join(tempDir, TELEMETRY_FILE), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Telemetry is best-effort — never block the command, but warn on failure
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Totem', `Failed to write telemetry: ${msg}`);
  }
}

// ─── Orphaned temp file cleanup ──────────────────────────

const TEMP_FILE_RE = /^totem-.*\.md$/;
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Reap orphaned temp files older than `maxAgeMs` from `.totem/temp/`.
 * Fire-and-forget — never blocks the CLI critical path.
 */
export async function reapOrphanedTempFiles(
  cwd: string,
  totemDir: string,
  maxAgeMs: number = TEMP_MAX_AGE_MS,
): Promise<number> {
  const tempDir = path.join(cwd, totemDir, 'temp');
  const { readdir, stat, unlink } = fs.promises;

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch {
    return 0; // Directory doesn't exist yet — nothing to clean
  }

  let removed = 0;
  const now = Date.now();

  for (const entry of entries) {
    if (!TEMP_FILE_RE.test(entry)) continue;

    const filePath = path.join(tempDir, entry);
    try {
      const info = await stat(filePath);
      if (now - info.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        removed++;
      }
    } catch {
      // ENOENT (race), EACCES/EPERM (permissions) — swallow silently
    }
  }

  return removed;
}

// ─── System prompt overrides ─────────────────────────────

const SAFE_COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;

/**
 * Load a custom system prompt from `.totem/prompts/<commandName>.md` if it exists.
 * Falls back to the built-in default prompt when the file is missing, empty, or unreadable.
 */
export function getSystemPrompt(
  commandName: string,
  defaultPrompt: string,
  cwd: string,
  totemDir: string,
): string {
  if (!SAFE_COMMAND_NAME_RE.test(commandName)) return defaultPrompt;

  const promptPath = path.join(cwd, totemDir, 'prompts', `${commandName}.md`);
  if (!fs.existsSync(promptPath)) return defaultPrompt;

  try {
    const content = fs.readFileSync(promptPath, 'utf-8');
    if (!content.trim()) return defaultPrompt;
    return content;
  } catch {
    return defaultPrompt;
  }
}

// ─── Output helpers ─────────────────────────────────────

export function writeOutput(content: string, outPath?: string): void {
  if (outPath) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outPath, content, 'utf-8');
  } else {
    console.log(content);
  }
}

// ─── Terminal sanitization ───────────────────────────────

// Re-export from core — shared between CLI and MCP (#207)
export { sanitize } from '@mmnto/totem';

// ─── XML delimiting ─────────────────────────────────────

// Re-export from core — unified XML escaping (#158)
export { wrapXml } from '@mmnto/totem';

// ─── Context formatting ─────────────────────────────────

const MAX_RESULT_CONTENT_LENGTH = 300;
const CONDENSED_CONTENT_LENGTH = 80;

export function formatResults(
  results: SearchResult[],
  heading: string,
  condensed?: boolean,
): string {
  if (results.length === 0) return '';
  const maxLen = condensed ? CONDENSED_CONTENT_LENGTH : MAX_RESULT_CONTENT_LENGTH;
  const items = results
    .map((r) => {
      const ellipsis = r.content.length > maxLen ? '...' : '';
      const truncated = r.content.slice(0, maxLen);

      if (condensed) {
        const snippet = truncated.replace(/\n/g, ' ');
        return `- **${r.label}** (${r.filePath}) ${snippet}${ellipsis}`;
      }

      const snippet = truncated.replace(/\n/g, '\n  ');
      return (
        `- **${r.label}** (${r.filePath}, score: ${r.score.toFixed(3)})\n  ` +
        `${snippet}${ellipsis}`
      );
    })
    .join('\n\n');
  return `\n=== ${heading} ===\n${items}\n`;
}

// ─── Orchestrator runner ─────────────────────────────────

export interface OrchestratorRunOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
}

const DEFAULT_TTLS: Record<string, number> = {
  triage: 3600, // 1 hour
  briefing: 1800, // 30 min
  spec: 3600, // 1 hour
  docs: 0, // No cache — each run should reflect latest state
  shield: 0,
  handoff: 0,
  learn: 0,
};

/**
 * Validate orchestrator config, then either output raw context (--raw) or
 * invoke the configured orchestrator provider and return the LLM content.
 *
 * Returns `undefined` in --raw mode (prompt already written to output).
 * Returns the LLM response content string otherwise.
 * Callers are responsible for writing output via `writeOutput()`.
 */
export async function runOrchestrator(opts: {
  prompt: string;
  tag: string;
  options: OrchestratorRunOptions;
  config: TotemConfig;
  cwd: string;
  totalResults?: number;
}): Promise<string | undefined> {
  const { prompt, tag, options, config, cwd } = opts;

  // --raw mode: output context only
  if (options.raw) {
    writeOutput(prompt, options.out);
    const suffix = opts.totalResults != null ? ` (${opts.totalResults} chunks)` : '';
    log.dim(tag, `Raw context output complete${suffix}.`);
    return undefined;
  }

  // Require orchestrator for LLM synthesis
  if (!config.orchestrator) {
    throw new Error(
      `[Totem Error] No orchestrator configured. Add an 'orchestrator' block to totem.config.ts.\n` +
        `Example:\n  orchestrator: {\n    provider: 'shell',\n    command: 'gemini --model {model} -e none < {file}',\n    defaultModel: 'gemini-2.5-pro',\n  }`,
    );
  }

  const baseProvider = config.orchestrator.provider;
  const baseInvoke = createOrchestrator(config.orchestrator);

  const tagKey = tag.toLowerCase();
  const rawModel =
    options.model ?? config.orchestrator.overrides?.[tagKey] ?? config.orchestrator.defaultModel;
  if (!rawModel) {
    throw new Error(
      `[Totem Error] No model specified. Provide one with --model, set a command-specific model in 'overrides', or set a 'defaultModel' in your orchestrator config.`,
    );
  }
  if (rawModel.startsWith('-') || !MODEL_NAME_RE.test(rawModel)) {
    throw new Error(
      `[Totem Error] Invalid model name '${rawModel}'. Model names may not start with a hyphen and may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
    );
  }

  let resolved = resolveOrchestrator(rawModel, baseProvider, baseInvoke);
  let model = resolved.parsed.model;
  let qualifiedModel = resolved.qualifiedModel;
  let invoke = resolved.invoke;
  log.info(tag, `Model: ${bold(rawModel)}`);

  const ttlSeconds = config.orchestrator.cacheTtls?.[tagKey] ?? DEFAULT_TTLS[tagKey] ?? 0;
  const useCache = ttlSeconds > 0 && !options.fresh;
  let cachePath = '';

  if (useCache) {
    const hash = crypto
      .createHash('sha256')
      .update(prompt)
      .update(qualifiedModel)
      .digest('hex')
      .slice(0, 16);
    const cacheDir = path.join(cwd, config.totemDir, 'cache');
    cachePath = path.join(cacheDir, `${tagKey}-${hash}.json`);

    if (fs.existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const ageMs = Date.now() - cacheData.timestamp;
        if (ageMs < ttlSeconds * 1000) {
          log.dim(tag, `Result loaded from cache (TTL: ${ttlSeconds}s)`);
          return cacheData.content;
        }
      } catch {
        // Ignore cache read errors
      }
    }
  }

  let result: OrchestratorResult;
  try {
    result = await invoke({ prompt, model, cwd, tag, totemDir: config.totemDir });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'QuotaError') {
      const rawFallback = config.orchestrator.fallbackModel;
      if (rawFallback && rawModel !== rawFallback) {
        log.warn(
          tag,
          `Quota exhausted for ${rawModel}. Retrying with fallback model: ${bold(rawFallback)}...`,
        );
        const fallbackResolved = resolveOrchestrator(rawFallback, baseProvider, baseInvoke);
        try {
          result = await fallbackResolved.invoke({
            prompt,
            model: fallbackResolved.parsed.model,
            cwd,
            tag,
            totemDir: config.totemDir,
          });
          // Update model/invoke so telemetry and cache log the correct values
          model = fallbackResolved.parsed.model;
          qualifiedModel = fallbackResolved.qualifiedModel;
          resolved = fallbackResolved;
          invoke = fallbackResolved.invoke;
        } catch (fallbackErr: unknown) {
          const originalMsg = err.message;
          const fallbackMsg =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(
            `[Totem Error] Primary model '${rawModel}' failed and fallback model '${rawFallback}' also failed.\n\n` +
              `Primary error:\n${originalMsg}\n\n` +
              `Fallback error:\n${fallbackMsg}`,
          );
        }
      } else {
        throw new Error(
          `[Totem Error] Quota exhausted for ${model}.\n` +
            `  Quota resets on a rolling daily window.\n` +
            `  Options:\n` +
            `    - Switch to a flash model: totem <command> --model <name>\n` +
            `    - Inspect the prompt without calling the API: totem <command> --raw\n` +
            `    - Set a fallbackModel in totem.config.ts`,
        );
      }
    } else {
      throw err;
    }
  }

  if (useCache && result.content && result.durationMs > 0) {
    try {
      // Recalculate cache path — `model` may have changed to fallbackModel
      const cacheHash = crypto
        .createHash('sha256')
        .update(prompt)
        .update(model)
        .digest('hex')
        .slice(0, 16);
      const cacheDir = path.join(cwd, config.totemDir, 'cache');
      const finalCachePath = path.join(cacheDir, `${tagKey}-${cacheHash}.json`);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        finalCachePath,
        JSON.stringify({
          timestamp: Date.now(),
          content: result.content,
        }),
        { encoding: 'utf-8', mode: 0o600 },
      );
    } catch {
      // Ignore cache write errors
    }
  }

  // Log telemetry
  appendTelemetry(
    {
      timestamp: new Date().toISOString(),
      tag,
      model: qualifiedModel,
      promptChars: prompt.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
    },
    cwd,
    config.totemDir,
  );

  // Console summary
  const secs = (result.durationMs / 1000).toFixed(1);
  if (result.inputTokens != null && result.outputTokens != null) {
    const inTok = result.inputTokens.toLocaleString();
    const outTok = result.outputTokens.toLocaleString();
    log.success(tag, `Done: ${secs}s | ${inTok} in | ${outTok} out`);
  } else {
    log.success(tag, `Done: ${secs}s | ${(prompt.length / 1024).toFixed(0)}KB prompt`);
  }

  return result.content;
}
