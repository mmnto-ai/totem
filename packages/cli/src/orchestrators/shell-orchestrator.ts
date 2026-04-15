import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { assertValidModelName, isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000;
const LLM_MAX_OUTPUT = 50 * 1024 * 1024; // 50 MB — safety cap on streamed output
const TEMP_ID_BYTES = 4;

/** execFileSync on Windows can't resolve executables without `shell: true`. */
const IS_WIN = process.platform === 'win32';

function quoteShellArg(value: string): string {
  // Windows quoting is genuinely ambiguous — `cmd.exe` has no universal
  // quote-escape; `""` (doubling) works inside cmd's own quote state and
  // `\"` works for the Microsoft C-runtime argv parser used by most target
  // binaries. Neither is safe when an unchecked string contains BOTH `"`
  // and shell metacharacters. The real defense is the upstream allow-list
  // (`MODEL_NAME_RE` below, which rejects `"` outright). We emit `\"` here
  // so the quoted output at least parses correctly under MSVCRT rules for
  // the well-known tools we pipe to (gemini, claude, ollama). If a future
  // caller passes an unchecked path, the right fix is to pre-validate or
  // to stop using `shell: true` — not to defeat shell quoting entirely in
  // this helper. See GCA + Shield discussion on mmnto/totem#1429.
  return IS_WIN ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

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

  // Reject poisoned model names BEFORE we ever interpolate into a shell string.
  // The {model} token used to be substituted raw, which turned a config-supplied
  // string into a shell-injection sink. A malicious totem.config.ts could set
  // `defaultModel: "gemini-1.5; rm -rf /"` and ride `shell: true` straight to
  // arbitrary code execution. `assertValidModelName` is the single shared gate
  // used here and in `resolveOrchestrator` so any model accepted by one path
  // is accepted by the other (and vice versa). Covers regex allow-list +
  // leading-dash reject + post-parse model-portion check (catches `gemini:`
  // and `anthropic:-foo` which pass the flat regex but are unsafe). CR catch
  // on mmnto/totem#1429.
  assertValidModelName(model);

  const fullPrompt =
    systemPrompt !== undefined && systemPrompt.length > 0 ? `${systemPrompt}\n\n${prompt}` : prompt;
  const tmpName = `totem-${tag.toLowerCase()}-${crypto.randomBytes(TEMP_ID_BYTES).toString('hex')}.md`;
  const tempDir = path.join(cwd, totemDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, tmpName);

  fs.writeFileSync(tempPath, fullPrompt, { encoding: 'utf-8', mode: 0o600 });

  // Defense in depth: even after the allow-list above rejects shell metacharacters,
  // we still shell-quote the model token at interpolation. Matches the treatment
  // {file} has always had. Two layers: validate, then escape.
  //
  // Use replacer FUNCTIONS instead of string replacements. `String.prototype.replace`
  // interprets `$&`, `$'`, `$n`, etc. in a replacement STRING as back-references, so
  // a `cwd` that happens to contain `$&` (e.g., a directory named `project$&`) would
  // splice the regex match back in and corrupt the interpolated command. The
  // function form bypasses that special-casing entirely. Shield catch on
  // mmnto/totem#1429 GCA follow-up.
  const quotedPath = quoteShellArg(tempPath);
  const quotedModel = quoteShellArg(model);
  const resolvedCmd = command
    .replace(/\{file\}/g, () => quotedPath)
    .replace(/\{model\}/g, () => quotedModel);

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
