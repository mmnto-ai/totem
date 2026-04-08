import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000;
const LLM_MAX_OUTPUT = 50 * 1024 * 1024; // 50 MB — safety cap on streamed output
const TEMP_ID_BYTES = 4;

/** execFileSync on Windows can't resolve executables without `shell: true`. */
const IS_WIN = process.platform === 'win32';

// ─── Gemini CLI JSON parsing ─────────────────────────

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

// ─── Shell orchestrator ─────────────────────────────

export interface ShellOrchestratorOptions extends OrchestratorInvokeOptions {
  command: string;
}

export async function invokeShellOrchestrator(
  opts: ShellOrchestratorOptions,
): Promise<OrchestratorResult> {
  // mmnto/totem#1291 Phase 3: opts.systemPrompt is concatenated with prompt
  // before being written to the tempfile because shell orchestrators talk to
  // CLI binaries (`gemini`, `claude`) that consume one piped prompt and have
  // no structured system/user message API. Concatenation matches the legacy
  // single-string behavior — without this, Phase 3's prompt split would
  // silently strip compiler instructions when compile is routed through a
  // shell CLI fallback. Caught by Shield AI on the first push attempt as
  // part of the same cascade as the Gemini/OpenAI/Ollama fixes.
  const { prompt, systemPrompt, command, model, cwd, tag, totemDir } = opts;
  const fullPrompt =
    systemPrompt !== undefined && systemPrompt.length > 0 ? `${systemPrompt}\n\n${prompt}` : prompt;
  const tmpName = `totem-${tag.toLowerCase()}-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
  const tempDir = path.join(cwd, totemDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, tmpName);

  fs.writeFileSync(tempPath, fullPrompt, { encoding: 'utf-8', mode: 0o600 });

  const quotedPath = IS_WIN
    ? `"${tempPath.replace(/"/g, '""')}"`
    : `'${tempPath.replace(/'/g, "'\\''")}'`;
  const resolvedCmd = command.replace(/\{file\}/g, quotedPath).replace(/\{model\}/g, model);

  log.info(tag, 'Invoking orchestrator (this may take 15-60 seconds)...');

  const startMs = Date.now();

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(resolvedCmd, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WIN, // process group for clean tree-kill on Unix
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < LLM_MAX_OUTPUT) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < LLM_MAX_OUTPUT) stderr += chunk.toString();
      });

      const killTree = () => {
        // On Windows with shell: true, child.kill() only kills the shell,
        // leaving the actual process (grandchild) alive as a zombie.
        // Use taskkill /T to kill the entire process tree.
        if (IS_WIN && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } catch (_err) {
            // taskkill failed — fall back to basic kill
            child.kill();
          }
        } else if (child.pid) {
          process.kill(-child.pid); // totem-ignore — Unix process group kill
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, LLM_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(`[Totem Error] Shell orchestrator command failed: ${err.message}\n${stderr}`),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            Object.assign(
              new Error(
                `[Totem Error] Orchestrator timed out after ${LLM_TIMEOUT_MS / 1000}s.\n${stderr}`,
              ),
              { code: 'ETIMEDOUT' },
            ),
          );
          return;
        }

        if (code !== 0) {
          const fullError = new Error(`Process exited with code ${code}\n${stderr}`);
          if (isQuotaError(fullError)) {
            fullError.name = 'QuotaError';
            reject(fullError);
          } else {
            reject(
              new Error(`[Totem Error] Shell orchestrator command failed: ${fullError.message}`),
            );
          }
          return;
        }

        resolve(stdout);
      });
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
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
  }
}
