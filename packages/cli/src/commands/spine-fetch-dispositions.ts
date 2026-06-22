// ─── #709 ground-truth deriver — slice 5d-ii: the fetch-dispositions command ──
//
// `totem spine windtunnel fetch-dispositions [--lock-path] [--output-dir]`
// freezes `corpus-dispositions.json` — the held-out CORPUS PRs' review threads,
// span-anchored — and stamps `controls.integrity.corpusDispositionsSha` into the
// lock. A by-hand, live producer step (like `record`): NEVER CI (the adapter's
// hard-gate enforces it). The certifying RUN never touches this; only the deriver
// (5d-iii) reads the frozen file. This module is the I/O driver (load → fetch →
// canonical write → stamp); the fetch + mapping live in the adapter, the schema
// in core.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CorpusDisposition } from '@mmnto/totem';

import { CorpusDispositionSourceAdapter } from './spine-corpus-disposition-source.js';

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

/** The held-out disposition source — the live adapter in the CLI, a fake in tests. */
export interface CorpusDispositionSource {
  fetch(pr: number): Promise<CorpusDisposition>;
}

export interface FetchDispositionsOptions {
  /** Path to the wind-tunnel lock (default `.totem/spine/gate-1/windtunnel.lock.json`). */
  lockPath?: string;
  /** Gate-1 output dir (default: the lock's dir). */
  outputDir?: string;
  /** Working dir (default `process.cwd()`; injected for tests). */
  cwd?: string;
  /** Injected source (tests). In the live CLI it is built from the lock's repo. */
  source?: CorpusDispositionSource;
}

/**
 * Compute the held-out CORPUS PRs whose dispositions label firings: `heldOutPrs`
 * minus the positive/negative controls (positives are structural-TP; negatives
 * are culled — neither reads a disposition). Deterministic ascending order.
 */
export function corpusHeldOutPrs(split: {
  heldOutPrs: number[];
  positiveControlPrs: number[];
  negativeControlPrs: number[];
}): number[] {
  const controls = new Set([...split.positiveControlPrs, ...split.negativeControlPrs]);
  return split.heldOutPrs.filter((pr) => !controls.has(pr)).sort((a, b) => a - b);
}

export async function fetchDispositionsCommand(opts: FetchDispositionsOptions): Promise<void> {
  const {
    WindtunnelLockSchema,
    SplitArtifactSchema,
    CorpusDispositionsSchema,
    canonicalStringify,
    TotemError,
  } = await import('@mmnto/totem');

  const cwd = opts.cwd ?? process.cwd();
  const lockPath = opts.lockPath
    ? path.resolve(cwd, opts.lockPath)
    : path.resolve(cwd, '.totem/spine/gate-1/windtunnel.lock.json');
  const gate1Dir = opts.outputDir ? path.resolve(cwd, opts.outputDir) : path.dirname(lockPath);

  const readJsonFile = (p: string): unknown => {
    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf-8');
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `fetch-dispositions: required file not found at ${p}`,
        'Run `spine windtunnel materialize` first (lock + split.json must exist).',
        err,
      );
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `fetch-dispositions: ${p} is not valid JSON`,
        'Fix the JSON and retry.',
        err,
      );
    }
  };

  const lock = WindtunnelLockSchema.parse(readJsonFile(lockPath));
  const split = SplitArtifactSchema.parse(readJsonFile(path.join(gate1Dir, 'split.json')));

  const prs = corpusHeldOutPrs(split);
  if (prs.length === 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      'fetch-dispositions: the split has no held-out CORPUS PRs (all held-out PRs are controls).',
      'A cert corpus needs ≥1 non-control held-out PR for the answer key to label.',
    );
  }

  // Build the live source from the lock's repo unless a fake is injected (tests).
  let source = opts.source;
  if (!source) {
    // Require EXACTLY "owner/name" (greptile #2231 P2): a bare `!owner || !name`
    // guard lets "github.com/owner/name" through as owner="github.com" → wrong
    // fetch + a confusing "repo not found". The lock schema is plain z.string(),
    // so this is the only parse-time defense.
    const repoParts = lock.corpus.repo.split('/');
    if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
      throw new TotemError(
        'CONFIG_INVALID',
        `fetch-dispositions: lock.corpus.repo "${lock.corpus.repo}" is not "owner/name".`,
        'Set corpus.repo in the lock to the "owner/name" form.',
      );
    }
    source = new CorpusDispositionSourceAdapter({ owner: repoParts[0], name: repoParts[1], cwd });
  }

  // Fetch each held-out corpus PR (fail-loud — the freeze is all-or-nothing).
  const dispositions: CorpusDisposition[] = [];
  for (const pr of prs) {
    dispositions.push(await source.fetch(pr));
  }
  // Sort by pr for a deterministic frozen artifact (fetch order is already ascending,
  // but sort defensively so an injected source can't perturb the on-disk bytes/digest).
  dispositions.sort((a, b) => a.pr - b.pr);

  // Write-side Zod validation (agy) BEFORE writing — never freeze a malformed artifact.
  const validated = CorpusDispositionsSchema.parse(dispositions);

  // Canonical write (sorted-key, LF + trailing newline) — the digest is over these
  // exact on-disk bytes, so a freeze/deriver enforcer can sha256 the file directly.
  fs.mkdirSync(gate1Dir, { recursive: true });
  const dispositionsPath = path.join(gate1Dir, 'corpus-dispositions.json');
  const text = `${canonicalStringify(validated, 2)}\n`;
  const tmp = `${dispositionsPath}.tmp`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, dispositionsPath);
  const corpusDispositionsSha = sha256Hex(text);

  // Stamp the provenance digest into the lock (read-modify-write canonical), mirroring
  // how `materialize` stamps prDiffsSha. Idempotent: re-running overwrites the field.
  const stampedLock = {
    ...lock,
    controls: {
      ...lock.controls,
      integrity: { ...lock.controls.integrity, corpusDispositionsSha },
    },
  };
  const lockText = `${canonicalStringify(stampedLock, 2)}\n`;
  const lockTmp = `${lockPath}.tmp`;
  fs.writeFileSync(lockTmp, lockText, 'utf-8');
  fs.renameSync(lockTmp, lockPath);

  const threadCount = validated.reduce((n, d) => n + d.threads.length, 0);
  console.error(`[FetchDispositions] gate1Dir: ${gate1Dir}`);
  console.error(`  held-out corpus PRs: ${prs.length} · review threads: ${threadCount}`);
  console.error(
    `  corpusDispositionsSha: ${corpusDispositionsSha} (stamped into ${path.basename(lockPath)})`,
  );
  console.error(`  Wrote corpus-dispositions.json (the deriver's frozen provenance).`);
}
