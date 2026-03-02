import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SearchResult, TotemConfig } from '@mmnto/totem';
import { TotemConfigSchema } from '@mmnto/totem';

// ─── Shared constants ────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000;
const TEMP_ID_BYTES = 4;
const MODEL_NAME_RE = /^[\w./:_-]+$/;

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

// ─── Shell orchestrator ─────────────────────────────────

export function invokeShellOrchestrator(
  prompt: string,
  command: string,
  model: string,
  cwd: string,
  tag: string,
  totemDir: string,
): string {
  const tmpName = `totem-${tag.toLowerCase()}-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
  const tempDir = path.join(cwd, totemDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, tmpName);

  try {
    fs.writeFileSync(tempPath, prompt, { encoding: 'utf-8', mode: 0o600 });

    const resolvedCmd = command.replace(/\{file\}/g, `"${tempPath}"`).replace(/\{model\}/g, model);

    console.error(`[${tag}] Invoking orchestrator (this may take 15-60 seconds)...`);

    const result = execSync(resolvedCmd, {
      cwd,
      encoding: 'utf-8',
      timeout: LLM_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    return result.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Totem Error] Shell orchestrator command failed: ${msg}`);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
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
}

/**
 * Validate orchestrator config, then either output raw context (--raw) or
 * invoke the shell orchestrator and write the result.
 */
export function runOrchestrator(opts: {
  prompt: string;
  tag: string;
  options: OrchestratorRunOptions;
  config: TotemConfig;
  cwd: string;
  totalResults?: number;
}): void {
  const { prompt, tag, options, config, cwd } = opts;

  // --raw mode: output context only
  if (options.raw) {
    writeOutput(prompt, options.out);
    const suffix = opts.totalResults != null ? ` (${opts.totalResults} chunks)` : '';
    console.error(`[${tag}] Raw context output complete${suffix}.`);
    return;
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

  const model = options.model ?? config.orchestrator.defaultModel;
  if (!model) {
    throw new Error(
      `[Totem Error] No model specified. Provide one with --model or set 'defaultModel' in your orchestrator config.`,
    );
  }
  if (model.startsWith('-') || !MODEL_NAME_RE.test(model)) {
    throw new Error(
      `[Totem Error] Invalid model name '${model}'. Model names may not start with a hyphen and may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
    );
  }
  console.error(`[${tag}] Model: ${model}`);

  const result = invokeShellOrchestrator(
    prompt,
    config.orchestrator.command,
    model,
    cwd,
    tag,
    config.totemDir,
  );
  writeOutput(result, options.out);

  if (options.out) {
    console.error(`[${tag}] Written to ${options.out}`);
  }
}
