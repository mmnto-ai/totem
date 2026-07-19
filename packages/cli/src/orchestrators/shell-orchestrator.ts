import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { log } from '../ui.js';
import type {
  OrchestratorInvokeOptions,
  OrchestratorResult,
  RuntimeBoundedTextEvidence,
  RuntimeInvokeAttemptEvidence,
  RuntimeInvokeRoute,
  RuntimeProcessEvidence,
} from './orchestrator.js';
import {
  assertValidModelName,
  classifyInvokeFailure,
  OrchestratorInvokeError,
} from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000;
const LLM_MAX_OUTPUT = 50 * 1024 * 1024; // 50 MB — safety cap on streamed output
const RUNTIME_EVIDENCE_LIMIT_BYTES = 64 * 1024;
const RUNTIME_EVIDENCE_SEGMENT_BYTES = RUNTIME_EVIDENCE_LIMIT_BYTES / 2;
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

interface StreamCapture {
  append(chunk: Buffer | string): void;
  semanticText(): string;
  evidence(): RuntimeBoundedTextEvidence;
}

function decodeUtf8Segment(buffer: Buffer, trimFromStart: boolean): string {
  let decoded = buffer.toString('utf8');
  while (Buffer.byteLength(decoded, 'utf8') > buffer.length && decoded.length > 0) {
    decoded = trimFromStart ? decoded.slice(1) : decoded.slice(0, -1);
  }
  return decoded;
}

/**
 * Retain the legacy 50 MiB semantic stream independently from the much
 * smaller diagnostic head/tail window. Evidence remains raw in memory; DLP
 * masking happens at the run-artifact boundary.
 */
function createStreamCapture(): StreamCapture {
  const semanticChunks: Buffer[] = [];
  let semanticBytes = 0;
  let observedBytes = 0;
  let prefix: Buffer = Buffer.alloc(0);
  let tail: Buffer = Buffer.alloc(0);

  return {
    append(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      observedBytes += bytes.length;

      if (semanticBytes < LLM_MAX_OUTPUT) {
        const remaining = LLM_MAX_OUTPUT - semanticBytes;
        const retained = bytes.subarray(0, remaining);
        if (retained.length > 0) semanticChunks.push(retained);
        semanticBytes += retained.length;
      }

      if (prefix.length < RUNTIME_EVIDENCE_LIMIT_BYTES) {
        const remaining = RUNTIME_EVIDENCE_LIMIT_BYTES - prefix.length;
        prefix = Buffer.concat([prefix, bytes.subarray(0, remaining)]);
      }

      if (bytes.length >= RUNTIME_EVIDENCE_SEGMENT_BYTES) {
        tail = bytes.subarray(bytes.length - RUNTIME_EVIDENCE_SEGMENT_BYTES);
      } else {
        const combined = Buffer.concat([tail, bytes]);
        tail = combined.subarray(Math.max(0, combined.length - RUNTIME_EVIDENCE_SEGMENT_BYTES));
      }
    },
    semanticText() {
      return Buffer.concat(semanticChunks, semanticBytes).toString('utf8');
    },
    evidence() {
      const truncated = observedBytes > RUNTIME_EVIDENCE_LIMIT_BYTES;
      const headBuffer = truncated ? prefix.subarray(0, RUNTIME_EVIDENCE_SEGMENT_BYTES) : prefix;
      const head = decodeUtf8Segment(headBuffer, false);
      const tailText = truncated ? decodeUtf8Segment(tail, true) : undefined;
      const retainedBytes =
        Buffer.byteLength(head, 'utf8') +
        (tailText === undefined ? 0 : Buffer.byteLength(tailText, 'utf8'));
      return {
        encoding: 'utf-8',
        head,
        ...(tailText !== undefined ? { tail: tailText } : {}),
        observedBytes,
        retainedBytes,
        limitBytes: RUNTIME_EVIDENCE_LIMIT_BYTES,
        truncated,
      };
    },
  };
}

type KillableChild = Pick<ReturnType<typeof spawn>, 'pid' | 'kill'>;

/** Best-effort tree termination that never prevents timeout settlement. */
export function killShellProcessTree(
  child: KillableChild,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: typeof spawn = spawn,
  killGroup: typeof process.kill = process.kill,
): void {
  let directKillAttempted = false;
  const killChild = () => {
    if (directKillAttempted) return;
    directKillAttempted = true;
    try {
      child.kill();
      // totem-context: timeout teardown is best-effort; a kill race must not replace or block the already-determined timeout rejection.
    } catch (_err) {
      void _err;
    }
  };

  if (platform === 'win32' && child.pid) {
    try {
      const taskkill = spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      taskkill.once('error', killChild);
      taskkill.once('close', (code) => {
        if (code !== 0) killChild();
      });
      // totem-context: taskkill can be absent or race process exit; direct child kill is the intentional best-effort fallback.
    } catch (_err) {
      killChild();
    }
    return;
  }

  if (child.pid) {
    try {
      killGroup(-child.pid);
      // totem-context: Unix process-group exit races are expected during timeout teardown; fall back to direct child kill without changing settlement.
    } catch (_err) {
      killChild();
    }
    return;
  }

  // A spawn can time out before a pid is assigned.
  killChild();
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
    // totem-context: non-JSON is a supported shell-provider output shape; the caller intentionally falls back to normalized raw text.
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

const ClaudeOutputSchema = z.object({
  type: z.literal('result'),
  is_error: z.literal(false),
  result: z.string(),
});

/** Unwrap only Claude CLI's typed success envelope, never arbitrary outer JSON. */
export function tryParseClaudeJson(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
    // totem-context: non-JSON Claude output is valid when JSON mode is not configured; the caller intentionally preserves normalized raw text.
  } catch {
    return null;
  }
  const result = ClaudeOutputSchema.safeParse(data);
  return result.success ? result.data.result : null;
}

function isClaudeCommand(command: string): boolean {
  return /(?:^|[\s"'])claude(?:\.exe)?(?:[\s"']|$)/i.test(command);
}

// ─── Shell orchestrator ─────────────────────────────

export interface ShellOrchestratorOptions extends OrchestratorInvokeOptions {
  command: string;
  /** Internal provenance supplied by the factory/fallback wrapper. */
  provider?: string;
  /** Internal provenance supplied by the factory/fallback wrapper. */
  route?: RuntimeInvokeRoute;
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
  const provider = opts.provider ?? 'shell';
  const route = opts.route ?? 'configured-shell';

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
    const execution = await new Promise<{
      raw: string;
      process: RuntimeProcessEvidence;
      durationMs: number;
    }>((resolve, reject) => {
      const stdout = createStreamCapture();
      const stderr = createStreamCapture();
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(resolvedCmd, {
          cwd,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: !IS_WIN, // process group for clean tree-kill on Unix
        });
        // totem-context: synchronous spawn failures are converted into the structured process-spawn contract and rejected below; no failure is swallowed.
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        const attempt: RuntimeInvokeAttemptEvidence = {
          sequence: 1,
          route,
          provider,
          model,
          status: 'failed',
          durationMs: Date.now() - startMs,
          failureKind: 'process-spawn',
          ...('code' in cause && typeof cause.code === 'string'
            ? { providerCode: cause.code }
            : {}),
          process: {
            exitCode: null,
            signal: null,
            timedOut: false,
            stdout: stdout.evidence(),
            stderr: stderr.evidence(),
          },
        };
        reject(
          new OrchestratorInvokeError(
            'Shell orchestrator command failed to start.',
            'process-spawn',
            [attempt],
            { cause },
          ),
        );
        return;
      }

      let timedOut = false;
      let settled = false;

      child.stdout!.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr!.on('data', (chunk: Buffer) => stderr.append(chunk));

      const processEvidence = (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
      ): RuntimeProcessEvidence => ({
        exitCode,
        signal,
        timedOut,
        ...(timedOut ? { timeoutMs: LLM_TIMEOUT_MS } : {}),
        stdout: stdout.evidence(),
        stderr: stderr.evidence(),
      });

      const rejectInvocation = (
        err: Error,
        process: RuntimeProcessEvidence,
        context: Parameters<typeof classifyInvokeFailure>[1],
        classificationSource: Error = err,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const failureKind = classifyInvokeFailure(classificationSource, context);
        const attempt: RuntimeInvokeAttemptEvidence = {
          sequence: 1,
          route,
          provider,
          model,
          status: 'failed',
          durationMs: Date.now() - startMs,
          failureKind,
          ...('status' in classificationSource && typeof classificationSource.status === 'number'
            ? { providerStatus: classificationSource.status }
            : {}),
          ...('code' in classificationSource && typeof classificationSource.code === 'string'
            ? { providerCode: classificationSource.code }
            : {}),
          process,
        };
        reject(new OrchestratorInvokeError(err.message, failureKind, [attempt], { cause: err }));
      };

      const killTree = () => {
        // On Windows with shell: true, child.kill() only kills the shell,
        // leaving the actual process (grandchild) alive as a zombie.
        killShellProcessTree(child);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
        const err = Object.assign(
          new Error(`[Totem Error] Orchestrator timed out after ${LLM_TIMEOUT_MS / 1000}s.`),
          { code: 'ETIMEDOUT' },
        );
        rejectInvocation(err, processEvidence(null, null), { timedOut: true });
      }, LLM_TIMEOUT_MS);

      child.on('error', (err) => {
        const spawnErr = Object.assign(
          new Error('[Totem Error] Shell orchestrator command failed to start.', {
            cause: err,
          }),
          'code' in err ? { code: err.code } : {},
        );
        rejectInvocation(spawnErr, processEvidence(null, null), { spawnFailed: true });
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        const normalizedSignal = (signal ?? null) as NodeJS.Signals | null;
        const process = processEvidence(code, normalizedSignal);

        if (code !== 0 || normalizedSignal !== null) {
          const closedWithoutStatus = code === null && normalizedSignal === null;
          const processDescription = closedWithoutStatus
            ? 'closed without an exit code or signal'
            : normalizedSignal === null
              ? `exited with code ${code}`
              : `exited with code ${code} (signal ${normalizedSignal})`;
          const err = new Error(
            `[Totem Error] Shell orchestrator command failed: Process ${processDescription}.`,
          );
          const diagnosticText = [process.stderr?.head, process.stderr?.tail]
            .filter((part): part is string => part !== undefined)
            .join('\n');
          const classificationSource = Object.assign(
            new Error(diagnosticText),
            code === null ? {} : { exitCode: code },
          );
          const failureContext: Parameters<typeof classifyInvokeFailure>[1] = {
            ...(code === null ? {} : { exitCode: code }),
            ...(normalizedSignal === null ? {} : { signal: normalizedSignal }),
          };
          rejectInvocation(err, process, failureContext, classificationSource);
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve({ raw: stdout.semanticText(), process, durationMs: Date.now() - startMs });
      });
    });

    const { raw, process: executionProcess, durationMs: wallMs } = execution;
    const succeededAttempt: RuntimeInvokeAttemptEvidence = {
      sequence: 1,
      route,
      provider,
      model,
      status: 'succeeded',
      durationMs: wallMs,
      process: executionProcess,
    };

    const gemini = tryParseGeminiJson(raw);
    if (gemini) {
      return {
        content: gemini.content,
        inputTokens: gemini.inputTokens,
        outputTokens: gemini.outputTokens,
        durationMs: gemini.latencyMs ?? wallMs,
        attempts: [succeededAttempt],
      };
    }

    const claude = isClaudeCommand(resolvedCmd) ? tryParseClaudeJson(raw) : null;
    return {
      content: (claude ?? raw).trim(),
      inputTokens: null,
      outputTokens: null,
      durationMs: wallMs,
      attempts: [succeededAttempt],
    };
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp cleanup is best-effort
    }
  }
}
