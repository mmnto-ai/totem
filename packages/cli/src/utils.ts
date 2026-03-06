import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type { SearchResult, TotemConfig } from '@mmnto/totem';
import { TotemConfigSchema } from '@mmnto/totem';

import { bold, dim, error as errorColor, log, success as successColor } from './ui.js';

// ─── Shared constants ────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000;
const TEMP_ID_BYTES = 4;
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
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1]!.trim();
      const value = match[2]!.trim();
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

export interface OrchestratorResult {
  content: string;
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

const GeminiModelStatsSchema = z.object({
  tokens: z.object({ input: z.number(), candidates: z.number() }).optional(),
  api: z.object({ totalLatencyMs: z.number() }).optional(),
});

const GeminiOutputSchema = z.object({
  response: z.string(),
  stats: z.object({ models: z.record(GeminiModelStatsSchema) }),
});

/**
 * Try to parse Gemini CLI JSON output. Returns extracted data or null if
 * the output is not valid Gemini JSON (e.g. raw text from a non-Gemini orchestrator).
 */
export function tryParseGeminiJson(
  raw: string,
): { content: string; inputTokens: number; outputTokens: number; latencyMs: number | null } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = GeminiOutputSchema.safeParse(data);
  if (!result.success) return null;

  const allModelStats = Object.values(result.data.stats.models);
  if (allModelStats.length === 0) return null;

  const inputTokens = allModelStats.reduce((sum, s) => sum + (s.tokens?.input ?? 0), 0);
  const outputTokens = allModelStats.reduce((sum, s) => sum + (s.tokens?.candidates ?? 0), 0);
  const latencyMs = allModelStats.reduce((sum, s) => sum + (s.api?.totalLatencyMs ?? 0), 0) || null;

  return {
    content: result.data.response,
    inputTokens,
    outputTokens,
    latencyMs,
  };
}

// ─── Shell orchestrator ─────────────────────────────────

export function invokeShellOrchestrator(
  prompt: string,
  command: string,
  model: string,
  cwd: string,
  tag: string,
  totemDir: string,
): OrchestratorResult {
  const tmpName = `totem-${tag.toLowerCase()}-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
  const tempDir = path.join(cwd, totemDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, tmpName);

  try {
    fs.writeFileSync(tempPath, prompt, { encoding: 'utf-8', mode: 0o600 });

    const quotedPath = IS_WIN
      ? `"${tempPath.replace(/"/g, '""')}"`
      : `'${tempPath.replace(/'/g, "'\\''")}'`;
    const resolvedCmd = command.replace(/\{file\}/g, quotedPath).replace(/\{model\}/g, model);

    log.info(tag, 'Invoking orchestrator (this may take 15-60 seconds)...');

    const startMs = Date.now();
    const raw = execSync(resolvedCmd, {
      cwd,
      encoding: 'utf-8',
      timeout: LLM_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const wallMs = Date.now() - startMs;

    const gemini = tryParseGeminiJson(raw);
    if (gemini) {
      return {
        content: gemini.content,
        inputTokens: gemini.inputTokens,
        outputTokens: gemini.outputTokens,
        durationMs: gemini.latencyMs ?? wallMs,
      };
    }

    return { content: raw.trim(), inputTokens: null, outputTokens: null, durationMs: wallMs };
  } catch (err: unknown) {
    const execErr = err as { stderr?: Buffer | string };
    const stderr = execErr.stderr ? execErr.stderr.toString() : '';
    const msg = err instanceof Error ? err.message : String(err);
    const fullError = `${msg}\n${stderr}`;

    const lowerMsg = fullError.toLowerCase();
    if (
      lowerMsg.includes('quota') ||
      lowerMsg.includes('429') ||
      lowerMsg.includes('too many requests')
    ) {
      const quotaErr = new Error(fullError);
      quotaErr.name = 'QuotaError';
      throw quotaErr;
    }

    throw new Error(`[Totem Error] Shell orchestrator command failed: ${fullError}`);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
  }
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

/** Strip ANSI escape sequences, control characters, and BiDi overrides to prevent terminal injection. */
const CONTROL_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]|[\u202A-\u202E\u2066-\u2069]/g;

export function sanitize(text: string): string {
  return text.replace(CONTROL_RE, '');
}

// ─── XML delimiting ─────────────────────────────────────

/**
 * Wrap external/user-supplied content in XML tags to create a clear boundary
 * between system instructions and passive data. Escapes matching closing tags
 * in the content to prevent breakout.
 */
export function wrapXml(tag: string, content: string): string {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escaped = content.replace(
    new RegExp('<\\/\\s*' + safeTag + '\\s*>', 'gi'),
    `&lt;/${tag}&gt;`,
  );
  return `<${tag}>\n${escaped}\n</${tag}>`;
}

// ─── Context formatting ─────────────────────────────────

const MAX_RESULT_CONTENT_LENGTH = 300;

export function formatResults(results: SearchResult[], heading: string): string {
  if (results.length === 0) return '';
  const items = results
    .map(
      (r) =>
        `- **${r.label}** (${r.filePath}, score: ${r.score.toFixed(3)})\n  ${r.content.slice(0, MAX_RESULT_CONTENT_LENGTH).replace(/\n/g, '\n  ')}`,
    )
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
  shield: 0,
  handoff: 0,
  learn: 0,
};

/**
 * Validate orchestrator config, then either output raw context (--raw) or
 * invoke the shell orchestrator and return the LLM content.
 *
 * Returns `undefined` in --raw mode (prompt already written to output).
 * Returns the LLM response content string otherwise.
 * Callers are responsible for writing output via `writeOutput()`.
 */
export function runOrchestrator(opts: {
  prompt: string;
  tag: string;
  options: OrchestratorRunOptions;
  config: TotemConfig;
  cwd: string;
  totalResults?: number;
}): string | undefined {
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

  if (config.orchestrator.provider !== 'shell') {
    throw new Error(
      `[Totem Error] Unsupported orchestrator provider: '${config.orchestrator.provider}'. Only 'shell' is supported.`,
    );
  }

  const tagKey = tag.toLowerCase();
  let model =
    options.model ?? config.orchestrator.overrides?.[tagKey] ?? config.orchestrator.defaultModel;
  if (!model) {
    throw new Error(
      `[Totem Error] No model specified. Provide one with --model, set a command-specific model in 'overrides', or set a 'defaultModel' in your orchestrator config.`,
    );
  }
  if (model.startsWith('-') || !MODEL_NAME_RE.test(model)) {
    throw new Error(
      `[Totem Error] Invalid model name '${model}'. Model names may not start with a hyphen and may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
    );
  }
  log.info(tag, `Model: ${bold(model)}`);

  const ttlSeconds = config.orchestrator.cacheTtls?.[tagKey] ?? DEFAULT_TTLS[tagKey] ?? 0;
  const useCache = ttlSeconds > 0 && !options.fresh;
  let cachePath = '';

  if (useCache) {
    const hash = crypto
      .createHash('sha256')
      .update(prompt)
      .update(model)
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
    result = invokeShellOrchestrator(
      prompt,
      config.orchestrator.command,
      model,
      cwd,
      tag,
      config.totemDir,
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'QuotaError') {
      const fallback = config.orchestrator.fallbackModel;
      if (fallback && model !== fallback) {
        log.warn(
          tag,
          `Quota exhausted for ${model}. Retrying with fallback model: ${bold(fallback)}...`,
        );
        try {
          result = invokeShellOrchestrator(
            prompt,
            config.orchestrator.command,
            fallback,
            cwd,
            tag,
            config.totemDir,
          );
          // Note: we update `model` to the fallback so telemetry logs the correct one
          model = fallback;
        } catch (fallbackErr: unknown) {
          const originalMsg = err.message;
          const fallbackMsg =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(
            `[Totem Error] Primary model '${model}' failed and fallback model '${fallback}' also failed.\n\n` +
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
      model,
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
