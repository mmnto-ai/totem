// Serena pilot runner: executes both arms over the matched task set, scores
// correctness against pre-derived ground truth, and computes the kill-threshold
// verdict MECHANICALLY.
//
// Kill threshold (ruled): the pilot FAILS unless
//   (median tool-output bytes OR median wall time drops >= 25%)
//   AND there is NO missed baseline answer on the serena arm.
// Zero-mutation and clean-uninstall are verified by the surrounding shell steps
// and folded into the final verdict in PILOT.md.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { McpStdioClient } from './client.mjs';
import {
  serverSpec,
  WORKTREE,
  ARTIFACTS_DIR,
  RG,
  SERENA_TAG,
  SERENA_COMMIT,
  SERENA_GIT,
  EDITING_TOOLS,
  SHELL_TOOLS,
  MEMORY_TOOLS,
} from './config.mjs';
import { TASKS } from './tasks.mjs';

/** Normalise a path-bearing blob so serena's escaped Windows paths and
 *  ripgrep's Windows paths compare against forward-slash ground truth. */
function norm(s) {
  return s.replace(/\\+/g, '/').toLowerCase();
}

function scoreArm(text, task) {
  const hay = norm(text);
  const missed = task.groundTruth.filter((g) => !hay.includes(norm(g)));
  if (task.mustContainAny && !task.mustContainAny.some((m) => text.includes(m))) {
    missed.push(`<line-marker: one of ${task.mustContainAny.join('|')}>`);
  }
  // False positives: files the arm surfaced that carry no reference of the kind
  // the task asked for (almost always a comment-only mention).
  const decoysReported = (task.decoys ?? [])
    .filter((d) => hay.includes(norm(d.file)))
    .map((d) => d.file);
  return { missed, correct: missed.length === 0, decoysReported };
}

/**
 * Run one ripgrep invocation, measuring wall time and stdout bytes.
 *
 * Two non-obvious requirements, both learned the hard way in this pilot:
 *   - an explicit search path ('.') MUST be passed. With no path argument and a
 *     non-TTY stdin, ripgrep searches STDIN instead of the directory tree.
 *   - stdin is set to 'ignore' so that even a malformed argv cannot leave rg
 *     blocked forever reading a pipe that is never closed.
 * Without these, the baseline arm hangs indefinitely and the hang looks
 * (wrongly) like a serena/language-server stall.
 */
function runRg(argsWithoutPath) {
  const args = [...argsWithoutPath, '.'];
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(RG, args, {
      cwd: WORKTREE,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('close', (code) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const buf = Buffer.concat(out);
      resolve({
        argv: args,
        ms,
        bytes: buf.length,
        text: buf.toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        exitCode: code,
      });
    });
    child.on('error', (e) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ argv: args, ms, bytes: 0, text: '', stderr: String(e), exitCode: -1 });
    });
  });
}

async function runBaseline(task) {
  const calls = [];
  for (const args of task.baseline) {
    const r = await runRg(args);
    calls.push(r);
    if (task.baselineStopOnFirstNonEmpty && r.text.trim().length > 0) break;
  }
  const text = calls.map((c) => c.text).join('\n');
  return {
    calls: calls.map(({ argv, ms, bytes, exitCode }) => ({ argv, ms, bytes, exitCode })),
    bytes: calls.reduce((a, c) => a + c.bytes, 0),
    ms: calls.reduce((a, c) => a + c.ms, 0),
    text,
    ...scoreArm(text, task),
  };
}

async function runSerena(task, client) {
  let calls;
  try {
    calls = await task.serena(client);
  } catch (e) {
    return {
      calls: [],
      bytes: 0,
      ms: 0,
      text: '',
      missed: task.groundTruth.slice(),
      correct: false,
      decoysReported: [],
      failure: e.message,
    };
  }
  const text = calls.map((c) => c.text).join('\n');
  return {
    calls: calls.map(({ name, args, ms, bytes, envelopeBytes, isError }) => ({
      name,
      args,
      ms,
      bytes,
      envelopeBytes,
      isError,
    })),
    bytes: calls.reduce((a, c) => a + c.bytes, 0),
    ms: calls.reduce((a, c) => a + c.ms, 0),
    text,
    ...scoreArm(text, task),
  };
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- main

const client = new McpStdioClient(serverSpec());
client.start();

const report = {
  pilot: 'serena retrieval-only pilot (mmnto-ai/totem)',
  generatedAt: new Date().toISOString(),
  worktree: WORKTREE,
  pin: {
    tag: SERENA_TAG,
    commit: SERENA_COMMIT,
    source: SERENA_GIT,
    note:
      'MCP serverInfo.version reports 1.28.1, which is the `mcp` Python SDK ' +
      'version (pyproject: mcp==1.28.1), NOT serena. The serena pin must be ' +
      'verified out-of-band: pyproject version = 1.7.0 at commit ' +
      SERENA_COMMIT +
      '.',
  },
  friction: [],
  tasks: [],
};

try {
  const init = await client.initialize();
  report.handshake = { initializeMs: init.ms, serverInfo: init.result?.serverInfo ?? null };

  const tools = await client.listTools();
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  report.exposedTools = {
    listMs: tools.ms,
    count: names.length,
    names,
    retrievalOnlyVerification: {
      editingVerbsExposed: names.filter((n) => EDITING_TOOLS.includes(n)),
      shellVerbsExposed: names.filter((n) => SHELL_TOOLS.includes(n)),
      memoryVerbsExposed: names.filter((n) => MEMORY_TOOLS.includes(n)),
      pass:
        names.filter(
          (n) => EDITING_TOOLS.includes(n) || SHELL_TOOLS.includes(n) || MEMORY_TOOLS.includes(n),
        ).length === 0,
    },
  };

  // ---- indexing cost, measured separately from per-task cost -------------
  const cold = await client.callTool(
    'find_symbol',
    { name_path_pattern: 'compileRuleRecord', relative_path: '' },
    { timeoutMs: 900000 },
  );
  const warm = await client.callTool(
    'find_symbol',
    { name_path_pattern: 'compileRuleRecord', relative_path: '' },
    { timeoutMs: 300000 },
  );
  report.indexing = {
    initializeMs: init.ms,
    coldFirstSymbolCallMs: cold.ms,
    warmSameCallMs: warm.ms,
    attributedIndexingMs: cold.ms - warm.ms,
    note:
      'serena starts lazily: `initialize` returns before the TypeScript language ' +
      'server is spawned. The first symbol-level call pays LSP launch + workspace ' +
      'indexing; attributedIndexingMs is (cold - warm) on an identical call. ' +
      'All per-task numbers below are WARM.',
  };

  // ---- the matched task set ---------------------------------------------
  for (const task of TASKS) {
    process.stderr.write(`running ${task.id}...\n`);
    const serena = await runSerena(task, client);
    const baseline = await runBaseline(task);
    report.tasks.push({
      id: task.id,
      kind: task.kind,
      question: task.question,
      groundTruthFiles: task.groundTruth,
      serena: { ...serena, text: undefined },
      baseline: { ...baseline, text: undefined },
      serenaTextSample: serena.text.slice(0, 1200),
      baselineTextSample: baseline.text.slice(0, 1200),
    });
  }
} catch (err) {
  report.fatal = { message: err.message, stderrTail: client.stderr.slice(-8000) };
  process.exitCode = 1;
} finally {
  await client.stop();
}

// ---- medians + mechanical verdict ---------------------------------------
const rows = report.tasks;
const sBytes = rows.map((r) => r.serena.bytes);
const bBytes = rows.map((r) => r.baseline.bytes);
const sMs = rows.map((r) => r.serena.ms);
const bMs = rows.map((r) => r.baseline.ms);

const medSerenaBytes = median(sBytes);
const medBaseBytes = median(bBytes);
const medSerenaMs = median(sMs);
const medBaseMs = median(bMs);

const pct = (base, arm) => (base === 0 || base === null ? null : ((base - arm) / base) * 100);

const bytesReductionPct = pct(medBaseBytes, medSerenaBytes);
const timeReductionPct = pct(medBaseMs, medSerenaMs);

const serenaMissed = rows.filter((r) => !r.serena.correct);
const baselineMissed = rows.filter((r) => !r.baseline.correct);

report.medians = {
  serenaBytes: medSerenaBytes,
  baselineBytes: medBaseBytes,
  serenaMs: medSerenaMs,
  baselineMs: medBaseMs,
  bytesReductionPct,
  timeReductionPct,
};

report.correctness = {
  tasksRun: rows.length,
  serenaMissedTasks: serenaMissed.map((r) => ({ id: r.id, missed: r.serena.missed })),
  baselineMissedTasks: baselineMissed.map((r) => ({ id: r.id, missed: r.baseline.missed })),
  baselineMissedSomethingSerenaFound: rows
    .filter((r) => !r.baseline.correct && r.serena.correct)
    .map((r) => ({ id: r.id, baselineMissed: r.baseline.missed })),
};

const thresholdMet =
  (bytesReductionPct !== null && bytesReductionPct >= 25) ||
  (timeReductionPct !== null && timeReductionPct >= 25);
// `rows` is empty when the run died before any task completed (the block below
// runs outside the try). An empty set must not read as "missed nothing".
const noMissedOnSerena = rows.length > 0 && serenaMissed.length === 0;

report.verdict = {
  criteria: {
    medianReductionAtLeast25PctInBytesOrTime: thresholdMet,
    zeroMissedAnswersOnSerenaArm: noMissedOnSerena,
    retrievalOnlyBoundVerified: report.exposedTools?.retrievalOnlyVerification?.pass ?? false,
  },
  // Zero-mutation and uninstall are shell-verified outside this script and
  // recorded in PILOT.md; they are the remaining two conjuncts.
  measurementVerdict: thresholdMet && noMissedOnSerena ? 'PASS' : 'FAIL',
  rationale: [
    thresholdMet
      ? `median ${bytesReductionPct >= 25 ? 'bytes' : 'time'} reduction met the >=25% bar ` +
        `(bytes ${bytesReductionPct?.toFixed(1)}%, time ${timeReductionPct?.toFixed(1)}%)`
      : `neither median dropped >=25% (bytes ${bytesReductionPct?.toFixed(1)}%, ` +
        `time ${timeReductionPct?.toFixed(1)}%; negative = serena WORSE than baseline)`,
    noMissedOnSerena
      ? 'serena arm missed no ground-truth answer'
      : `serena arm MISSED answers on ${serenaMissed.map((r) => r.id).join(',')}`,
  ].join('; '),
};

report.precision = {
  note:
    'decoys are files a naive whole-word text search reports but which carry no ' +
    'reference of the kind the task asked for (usually a comment-only mention). ' +
    'Surfacing one is a false positive.',
  perTask: rows.map((r) => ({
    id: r.id,
    serenaDecoys: r.serena.decoysReported ?? [],
    baselineDecoys: r.baseline.decoysReported ?? [],
  })),
  serenaFalsePositiveCount: rows.reduce((a, r) => a + (r.serena.decoysReported?.length ?? 0), 0),
  baselineFalsePositiveCount: rows.reduce(
    (a, r) => a + (r.baseline.decoysReported?.length ?? 0),
    0,
  ),
};

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const label = process.env.PILOT_RUN_LABEL ?? '';
report.runLabel = label || 'default';
report.cacheState = process.env.PILOT_CACHE_STATE ?? 'unspecified';
const outPath = path.join(ARTIFACTS_DIR, label ? `serena-run-${label}.json` : 'serena-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

// ---- console table -------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(
  '\n' +
    pad('task', 5) +
    padl('serena B', 10) +
    padl('base B', 10) +
    padl('B red%', 9) +
    padl('serena ms', 11) +
    padl('base ms', 10) +
    padl('ms red%', 9) +
    '  miss(s/b)',
);
console.log('-'.repeat(80));
for (const r of rows) {
  const br = pct(r.baseline.bytes, r.serena.bytes);
  const mr = pct(r.baseline.ms, r.serena.ms);
  console.log(
    pad(r.id, 5) +
      padl(r.serena.bytes, 10) +
      padl(r.baseline.bytes, 10) +
      padl(br === null ? '-' : br.toFixed(1), 9) +
      padl(r.serena.ms.toFixed(0), 11) +
      padl(r.baseline.ms.toFixed(0), 10) +
      padl(mr === null ? '-' : mr.toFixed(1), 9) +
      `  ${r.serena.missed.length}/${r.baseline.missed.length}` +
      `   fp ${r.serena.decoysReported?.length ?? 0}/${r.baseline.decoysReported?.length ?? 0}`,
  );
}
console.log('-'.repeat(80));
console.log(
  pad('MED', 5) +
    padl(medSerenaBytes, 10) +
    padl(medBaseBytes, 10) +
    padl(bytesReductionPct === null ? '-' : bytesReductionPct.toFixed(1), 9) +
    padl(medSerenaMs?.toFixed(0), 11) +
    padl(medBaseMs?.toFixed(0), 10) +
    padl(timeReductionPct === null ? '-' : timeReductionPct.toFixed(1), 9),
);

console.log(
  `\nindexing: initialize=${report.indexing?.initializeMs?.toFixed(0)}ms  ` +
    `cold=${report.indexing?.coldFirstSymbolCallMs?.toFixed(0)}ms  ` +
    `warm=${report.indexing?.warmSameCallMs?.toFixed(0)}ms  ` +
    `attributed indexing=${report.indexing?.attributedIndexingMs?.toFixed(0)}ms`,
);
console.log(
  `exposed tools: ${report.exposedTools?.count}, retrieval-only pass=${report.exposedTools?.retrievalOnlyVerification?.pass}`,
);
console.log(`serena missed tasks: ${serenaMissed.map((r) => r.id).join(',') || 'none'}`);
console.log(`baseline missed tasks: ${baselineMissed.map((r) => r.id).join(',') || 'none'}`);
console.log(
  `\nMEASUREMENT VERDICT: ${report.verdict.measurementVerdict} -- ${report.verdict.rationale}`,
);
console.log(`report written: ${outPath}`);
