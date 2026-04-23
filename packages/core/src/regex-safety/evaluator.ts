/**
 * Persistent-worker regex evaluator with per-batch timeout (mmnto-ai/totem#1641).
 *
 * Spawns one Node worker thread on construction, serializes batches onto
 * it, and enforces a main-thread timeout. If a pattern catastrophic-
 * backtracks inside the worker, the main-thread timer fires, calls
 * `worker.terminate()`, and respawns a fresh worker for the next batch.
 * Every evaluation resolves with one of three outcomes — `ok` (matched
 * indices + elapsed + softWarning flag), `timeout` (the worker was
 * terminated), or `error` (the pattern was syntactically invalid; the
 * worker is still alive). The caller decides strict vs lenient handling.
 *
 * Invariants:
 * - At most one `Worker` alive per evaluator instance.
 * - `pending` never holds stale entries past a batch's terminal state.
 * - Batches are serialized (one in-flight at a time) — no multiplexing.
 * - Telemetry is emitted on every terminal outcome via the
 *   `onTelemetry` callback the caller supplies; if absent, telemetry
 *   is silently dropped (safe — the evaluator itself never fails on
 *   telemetry-sink failure).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { TotemError } from '../errors.js';
import type { RegexTelemetry } from './telemetry.js';
import type { EvaluateRequest, EvaluateResponse } from './worker.js';

export interface RegexEvaluatorConfig {
  /** Hard timeout per batch (ms). Exceeded batches terminate the worker. */
  timeoutMs: number;
  /** Soft-warning threshold (ms). Sub-timeout but slow; sets the flag on telemetry. */
  softWarningMs: number;
}

export interface EvaluateInput {
  ruleHash: string;
  pattern: string;
  flags: string;
  lines: readonly string[];
}

export type EvaluateResult =
  | { kind: 'ok'; matchedIndices: number[]; elapsedMs: number; softWarningTriggered: boolean }
  | { kind: 'timeout'; elapsedMs: number }
  | { kind: 'error'; message: string; elapsedMs: number };

const DEFAULT_CONFIG: RegexEvaluatorConfig = {
  timeoutMs: 100,
  softWarningMs: 50,
};

type PendingEntry = {
  resolve: (result: EvaluateResult) => void;
  timer: NodeJS.Timeout;
  ruleHash: string;
  startedAt: number;
  inputSize: number;
  redactedPath: string;
};

function resolveWorkerPath(): string {
  // In the built bundle, this module compiles to dist/regex-safety/evaluator.js
  // sitting next to dist/regex-safety/worker.js — the relative lookup
  // resolves directly. In vitest/dev the current module is the .ts source
  // file under src/regex-safety/ with no sibling worker.js; fall back to
  // the built dist path so tests can exercise the real worker without
  // requiring a loader shim.
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  const siblingJs = path.join(dir, 'worker.js');
  if (fs.existsSync(siblingJs)) return siblingJs;
  const distFallback = path.resolve(dir, '..', '..', 'dist', 'regex-safety', 'worker.js');
  if (fs.existsSync(distFallback)) return distFallback;
  // Last resort: return the expected sibling path. Worker() will throw
  // a descriptive MODULE_NOT_FOUND the caller can surface.
  return siblingJs;
}

export class RegexEvaluator {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly config: RegexEvaluatorConfig;
  private readonly onTelemetry: ((record: RegexTelemetry) => void) | undefined;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  /**
   * Coalesces concurrent respawn requests (mmnto-ai/totem#1641 Shield review
   * round-1). Without this, a timeout event firing at roughly the same
   * moment as a worker `error` event can call `spawnWorker()` twice,
   * leaking a thread. `evaluate()` also awaits this promise before
   * `postMessage` so a batch scheduled during a respawn waits for the
   * new worker instead of silently dropping against a null handle.
   */
  private respawnPromise: Promise<void> | null = null;
  /**
   * Worker-online gate (mmnto-ai/totem#1641, CI round-1 fix). The Node
   * `Worker` constructor returns before the thread is actually running
   * (thread-spawn takes ~30-50ms). If `evaluate()` starts its timeout
   * timer before the worker is online, a slow CI box can trip a
   * spurious timeout on the first batch. Gate postMessage on this
   * promise so cold-start cost never counts against the budget.
   */
  private workerReady: Promise<void> = Promise.resolve();
  /**
   * Consecutive-respawn counter (Shield review round-1). If the worker
   * keeps dying at spawn time (missing worker.js, syntax error in the
   * worker script, etc.), unbounded respawn becomes a CPU-pegging loop.
   * The counter increments on each respawn, resets on every successful
   * evaluation, and flips `permanentlyFailed` once the budget is spent.
   */
  private consecutiveRespawns = 0;
  private permanentlyFailed = false;
  private static readonly MAX_CONSECUTIVE_RESPAWNS = 3;

  constructor(
    config: Partial<RegexEvaluatorConfig> = {},
    onTelemetry?: (record: RegexTelemetry) => void,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onTelemetry = onTelemetry;
    this.spawnWorker();
  }

  async evaluate(input: EvaluateInput & { redactedPath?: string }): Promise<EvaluateResult> {
    if (this.disposed) {
      throw new TotemError(
        'CHECK_FAILED',
        'RegexEvaluator has been disposed',
        'Construct a new RegexEvaluator before calling evaluate(). The dispose() method releases the worker and marks the instance unusable (mmnto-ai/totem#1641).',
      );
    }
    if (this.permanentlyFailed) {
      throw new TotemError(
        'CHECK_FAILED',
        `RegexEvaluator exhausted ${RegexEvaluator.MAX_CONSECUTIVE_RESPAWNS} consecutive respawn attempts without a successful evaluation`,
        'The regex worker script likely failed to initialize (missing worker.js, syntax error in the worker module, or a Node version that cannot load it). Inspect the worker script at packages/core/src/regex-safety/worker.ts and rebuild @mmnto/totem.',
      );
    }

    // Serialize: the next batch waits for the current one to finish.
    // Single-worker invariant — no batch multiplexing.
    const previous = this.queue;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queue = previous.then(() => gate);
    await previous;

    // Wait for any in-flight respawn so postMessage does not race a
    // null `this.worker` handle (Shield review round-1 race fix).
    if (this.respawnPromise) {
      await this.respawnPromise;
    }

    // Wait for the worker thread to finish spawning before posting.
    // Cold-start (thread spawn + module load) is ~30-50ms and must not
    // count against the batch timeout budget, otherwise a slow CI box
    // trips a spurious timeout on the first batch (CI round-1 fix).
    await this.workerReady;

    try {
      return await this.evaluateOnce(input);
    } finally {
      release();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.queue;
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  private evaluateOnce(input: EvaluateInput & { redactedPath?: string }): Promise<EvaluateResult> {
    return new Promise<EvaluateResult>((resolve) => {
      const id = crypto.randomBytes(8).toString('hex');
      const startedAt = Date.now();
      const inputSize = input.lines.reduce((acc, line) => acc + line.length, 0);

      const timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);

        const elapsedMs = Date.now() - startedAt;
        this.emitTelemetry({
          ruleHash: entry.ruleHash,
          redactedPath: entry.redactedPath,
          matchedInputSize: entry.inputSize,
          elapsedTimeMs: elapsedMs,
          timeoutTriggered: true,
          softWarningTriggered: false,
        });

        // Terminate worker — the regex is hung on a line we can't interrupt.
        // Await respawn before resolving so the next queued evaluate() does
        // not race a not-yet-spawned worker and get a second timeout.
        void this.respawnWorker().finally(() => {
          entry.resolve({ kind: 'timeout', elapsedMs });
        });
      }, this.config.timeoutMs);

      this.pending.set(id, {
        resolve,
        timer,
        ruleHash: input.ruleHash,
        startedAt,
        inputSize,
        redactedPath: input.redactedPath ?? '<unknown>',
      });

      const request: EvaluateRequest = {
        id,
        pattern: input.pattern,
        flags: input.flags,
        lines: input.lines,
      };
      this.worker?.postMessage(request);
    });
  }

  private spawnWorker(): void {
    const worker = new Worker(resolveWorkerPath());
    this.worker = worker;
    this.workerReady = new Promise<void>((resolve) => {
      worker.once('online', () => resolve());
    });
    worker.on('message', (response: EvaluateResponse) => this.handleMessage(response));
    worker.on('error', () => {
      // Worker crashed outside of a normal message flow (e.g., an
      // internal error). The queued-evaluate lock only releases when
      // the in-flight promise resolves, so we must await respawn before
      // resolving pending entries — otherwise the next evaluate() races
      // a null `this.worker` and postMessage silently drops (spurious
      // timeout on the next batch). Same invariant the timeout path
      // already relies on (see evaluateOnce timer callback above).
      void this.respawnWorker().finally(() => {
        this.rejectAllPendingAsCrash();
      });
    });
    worker.on('exit', (code) => {
      // GCA PR #1644 round-1 — handle unexpected worker exits (OOM kill,
      // internal Node crash) that do not surface through the `error`
      // event. Skip respawn on graceful exit (code 0) and on explicit
      // dispose (terminate() drives exit with non-zero, but we only
      // spin up the respawn after checking the flag). Skip if this
      // handle is no longer the active worker — `respawnWorker` calls
      // `terminate()` on the prior worker before setting a new one, and
      // the exit event for the old handle fires after the field has
      // moved on; respawning again would leak a thread.
      if (this.disposed) return;
      if (code === 0) return;
      if (this.worker !== worker) return;
      void this.respawnWorker().finally(() => {
        this.rejectAllPendingAsCrash();
      });
    });
  }

  private async respawnWorker(): Promise<void> {
    // Coalesce concurrent respawn calls (Shield review round-1). If two
    // events (timeout + error) both request a respawn, they share the
    // same in-flight promise instead of spawning two workers.
    if (this.respawnPromise) return this.respawnPromise;
    if (this.disposed) return;

    this.respawnPromise = (async () => {
      try {
        this.consecutiveRespawns += 1;
        if (this.consecutiveRespawns > RegexEvaluator.MAX_CONSECUTIVE_RESPAWNS) {
          this.permanentlyFailed = true;
          this.rejectAllPendingAsCrash();
          return;
        }

        const old = this.worker;
        this.worker = null;
        if (old) {
          try {
            await old.terminate(); // totem-context: intentional best-effort cleanup — terminate() on an already-dead or still-initializing worker can throw, no recovery path at this layer; the new worker spawn is the load-bearing step.
          } catch {
            // No-op (see totem-context on the terminate() call above).
          }
        }
        if (this.disposed) return;
        this.spawnWorker();
      } finally {
        this.respawnPromise = null;
      }
    })();
    return this.respawnPromise;
  }

  private handleMessage(response: EvaluateResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    clearTimeout(entry.timer);
    // Any successful round-trip resets the respawn-failure counter.
    // Persistent spawn failures only matter when they fire back-to-back
    // with no intervening successful evaluation (Shield review round-1).
    this.consecutiveRespawns = 0;

    const elapsedMs = Date.now() - entry.startedAt;
    const softWarningTriggered = elapsedMs >= this.config.softWarningMs;

    this.emitTelemetry({
      ruleHash: entry.ruleHash,
      redactedPath: entry.redactedPath,
      matchedInputSize: entry.inputSize,
      elapsedTimeMs: elapsedMs,
      timeoutTriggered: false,
      softWarningTriggered: response.kind === 'ok' ? softWarningTriggered : false,
    });

    if (response.kind === 'ok') {
      entry.resolve({
        kind: 'ok',
        matchedIndices: response.matchedIndices,
        elapsedMs,
        softWarningTriggered,
      });
    } else {
      entry.resolve({ kind: 'error', message: response.message, elapsedMs });
    }
  }

  private rejectAllPendingAsCrash(): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      const elapsedMs = Date.now() - entry.startedAt;
      this.emitTelemetry({
        ruleHash: entry.ruleHash,
        redactedPath: entry.redactedPath,
        matchedInputSize: entry.inputSize,
        elapsedTimeMs: elapsedMs,
        timeoutTriggered: true,
        softWarningTriggered: false,
      });
      entry.resolve({ kind: 'timeout', elapsedMs });
      this.pending.delete(id);
    }
  }

  private emitTelemetry(record: RegexTelemetry): void {
    if (!this.onTelemetry) return;
    try {
      this.onTelemetry(record); // totem-context: intentional best-effort telemetry — the evaluator's correctness contract is regex matches, not telemetry delivery; sink failures (bad callback, disk full, permission error) must not interfere with match results.
    } catch {
      // No-op (see totem-context on the onTelemetry call above).
    }
  }
}
