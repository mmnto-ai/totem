// ─── #709 ground-truth deriver — slice 5d-iii-i: the derive-labels command ────
//
// `totem spine windtunnel derive-labels [--lock-path] [--lc-dir] [--output-dir]`
// produces `ground-truth-labels.json` — the cert-run ANSWER KEY (firingLabelId →
// TP|FP) — by enumerating firings byte-identically to the certifying run (the
// SHARED firing-setup) and joining each against the frozen held-out
// `corpus-dispositions.json` (5d-ii) through the closed 5d-i taxonomy. HARD-GATES
// `controls.integrity.corpusDispositionsSha` before deriving (a tampered
// disposition would silently flip a label — the #2224/#2225 lesson) and stamps
// `controls.integrity.groundTruthSha` over the emitted answer key. A by-hand
// producer step (like `materialize` / `fetch-dispositions`): the certifying RUN
// consumes the frozen labels (5d-iii-ii) and never re-derives — that, plus the
// digest, is what makes "the run graded against the key the deriver emitted"
// verifiable. The deriver MUST NOT call `loadCertRunFixtures` (it reads the file
// we emit — circularity); it uses `assembleCertifyingCorpus({ skipGroundTruth })`.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assembleAuthoredCertifyingCorpus,
  assembleCertifyingCorpus,
  buildGate1Stage4Deps,
  CORPUS_DISPOSITIONS_FILE,
  GROUND_TRUTH_FILE,
} from './spine-cert-run-corpus.js';
import { buildCertifyingFirings, buildReadStrategy } from './spine-windtunnel.js';

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

export interface DeriveLabelsOptions {
  /** Path to the wind-tunnel lock (default `.totem/spine/gate-1/windtunnel.lock.json`). */
  lockPath?: string;
  /** Path to the lc clone (env: TOTEM_LC_DIR) — the post-image blob source the firings read. */
  lcDir?: string;
  /** Gate-1 output dir (default: the lock's dir). */
  outputDir?: string;
  /**
   * The `.totem` dir holding the authored producer's `spine/authored-rules.yaml` + ledger
   * (authored producer only). Defaults to the convention `<gate1Dir>/../..` (gate-1 lives at
   * `.totem/spine/gate-1`). Injected explicitly for tests + non-conventional layouts (D2.6).
   */
  totemDir?: string;
  /** Working dir (default `process.cwd()`; injected for tests). */
  cwd?: string;
}

export async function deriveLabelsCommand(opts: DeriveLabelsOptions): Promise<void> {
  const {
    WindtunnelLockSchema,
    CorpusDispositionsSchema,
    deriveLabelsFromDispositions,
    canonicalStringify,
    safeExec,
    TotemError,
  } = await import('@mmnto/totem');

  const cwd = opts.cwd ?? process.cwd();
  const lockPath = opts.lockPath
    ? path.resolve(cwd, opts.lockPath)
    : path.resolve(cwd, '.totem/spine/gate-1/windtunnel.lock.json');
  const gate1Dir = opts.outputDir ? path.resolve(cwd, opts.outputDir) : path.dirname(lockPath);
  const lcDir = opts.lcDir ?? process.env['TOTEM_LC_DIR'];

  // The deriver enumerates REAL firings over the post-image, so it needs the lc
  // clone — without it `readStrategy` returns null for every file and NO rule
  // fires, silently minting an empty answer key. Fail loud (Tenet 4).
  if (!lcDir) {
    throw new TotemError(
      'CONFIG_INVALID',
      'derive-labels: no lc clone (--lc-dir / TOTEM_LC_DIR) — cannot read the post-image to ' +
        'enumerate firings, so the answer key would be silently empty.',
      'Provide the lc clone via --lc-dir or the TOTEM_LC_DIR environment variable.',
    );
  }

  const readRaw = (p: string, hint: string): string => {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `derive-labels: required file not found at ${p}`,
        hint,
        err,
      );
    }
  };
  // Wrap JSON.parse so a malformed fixture surfaces a structured CLI error instead of a
  // raw SyntaxError (GCA) — `TotemError('CONFIG_INVALID')` to match the CLI-layer
  // convention in `loadCertRunFixtures` / `fetch-dispositions` (NOT TotemParseError,
  // which the styleguide reserves for the core compile/parse layer).
  const parseJson = (raw: string, p: string, hint: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new TotemError('CONFIG_INVALID', `derive-labels: ${p} is not valid JSON`, hint, err);
    }
  };

  const lockHint = 'Run `spine windtunnel materialize` first.';
  const lock = WindtunnelLockSchema.parse(
    parseJson(readRaw(lockPath, lockHint), lockPath, lockHint),
  );

  // ── corpusDispositionsSha derive-time HARD-GATE (must LAND — the #2224 trap
  // #2225 closed for prDiffsSha). Verify-then-parse on a SINGLE read (no check/use
  // split), CRLF→LF normalized to match the 5d-ii stamp + freeze-warn. A tampered
  // disposition would silently flip a label, so a missing OR mismatched digest is a
  // hard fail BEFORE any firing enumeration or label emission. ──
  const expectedDispositionsSha = lock.controls.integrity.corpusDispositionsSha;
  if (!expectedDispositionsSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      'derive-labels: lock is missing controls.integrity.corpusDispositionsSha — the held-out ' +
        'disposition provenance cannot be integrity-checked, so the answer key cannot be trusted.',
      'Run `spine windtunnel fetch-dispositions` first (5d-ii stamps the digest).',
    );
  }
  const dispositionsPath = path.join(gate1Dir, CORPUS_DISPOSITIONS_FILE);
  const dispositionsRaw = readRaw(
    dispositionsPath,
    'Run `spine windtunnel fetch-dispositions` first (it writes corpus-dispositions.json).',
  );
  const actualDispositionsSha = sha256Hex(dispositionsRaw.replace(/\r\n/g, '\n'));
  if (actualDispositionsSha !== expectedDispositionsSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      `derive-labels: corpus-dispositions.json integrity FAILED — expected ${expectedDispositionsSha}, ` +
        `got ${actualDispositionsSha} (the frozen disposition provenance was tampered or re-serialized).`,
      'Restore the frozen corpus-dispositions.json or re-run `spine windtunnel fetch-dispositions`.',
    );
  }
  const dispositions = CorpusDispositionsSchema.parse(
    parseJson(
      dispositionsRaw,
      dispositionsPath,
      'Restore the frozen corpus-dispositions.json or re-run `spine windtunnel fetch-dispositions`.',
    ),
  );

  // ── Enumerate firings via the SHARED path — byte-identical to the certifying
  // run (assembleCertifyingCorpus + buildCertifyingFirings). skipGroundTruth: the
  // deriver PRODUCES the answer key, so it must not read it (circularity guard). ──
  const asOf = lock.corpus.selectionRule.asOfCommit;
  const readStrategy = buildReadStrategy(lcDir, asOf, safeExec);
  const stage4 = buildGate1Stage4Deps(lcDir, asOf, safeExec);
  // `now` feeds the corpus compile-stage timestamp only; it does NOT enter the
  // content-based firing labelId, so the answer key is deterministic regardless.
  const now = new Date().toISOString();
  // `seedClassesProvided` is intentionally omitted (defaults false), matching the run's
  // `buildReplayCorpusProvider` call which also leaves it false (greptile). It is safe to
  // pin: it is a fold-I §7 ledger ATTESTATION threaded only into the extract-stage ledger
  // — it does not enter rule compilation or the content-based labelId — so it cannot break
  // the byte-identical guarantee even if a future run set it. Thread it through both the
  // run and the deriver together if it ever becomes a real RunOption.
  // ADR-112 §6 D2.6: an AUTHORED lock assembles the corpus from the authored substrate
  // (window-wide, via the derive-path sibling); a MINED lock keeps the byte-unchanged replay
  // assembly. Both skip ground-truth (the deriver PRODUCES it). The producerKind read lives
  // here in the producer command — the RUN-path §8 single home (resolveCertifyingCorpusProvider)
  // is untouched (gemini single-home ruling); the mined deriver already bypasses it likewise.
  const producerKind = lock.producerKind ?? 'mined';
  const { corpus } =
    producerKind === 'authored'
      ? await assembleAuthoredCertifyingCorpus(
          {
            gate1Dir,
            // gate-1 lives at `.totem/spine/gate-1` → `.totem` is two dirs up (convention),
            // overridable for tests / non-standard layouts.
            totemDir: opts.totemDir
              ? path.resolve(cwd, opts.totemDir)
              : path.dirname(path.dirname(gate1Dir)),
            stage4,
            now,
          },
          lock,
        )
      : await assembleCertifyingCorpus({ gate1Dir, stage4, now, skipGroundTruth: true }, lock);
  const built = await buildCertifyingFirings({
    rules: corpus.rules,
    prDiffs: corpus.prDiffs,
    readStrategy,
    logPrefix: '[DeriveLabels]',
  });

  // ── Derive the answer key (pure, zero-LLM) ──
  const { labels, diagnostics, evidence } = deriveLabelsFromDispositions(
    built.firings,
    dispositions,
  );

  // ── Write the answer key canonically (sorted-key, LF + trailing newline) so the
  // groundTruthSha covers the exact on-disk bytes a run/freeze enforcer re-hashes. ──
  fs.mkdirSync(gate1Dir, { recursive: true });
  const gtPath = path.join(gate1Dir, GROUND_TRUTH_FILE);
  const text = `${canonicalStringify(labels, 2)}\n`;
  const gtTmp = `${gtPath}.tmp`;
  fs.writeFileSync(gtTmp, text, 'utf-8');
  fs.renameSync(gtTmp, gtPath);
  const groundTruthSha = sha256Hex(text);

  // ── Stamp groundTruthSha into the lock (read-modify-write canonical), mirroring
  // how `fetch-dispositions` stamps corpusDispositionsSha. Idempotent. The run-side
  // verify + freeze-warn land in 5d-iii-ii (producer → enforcement split). ──
  const stampedLock = {
    ...lock,
    controls: {
      ...lock.controls,
      integrity: { ...lock.controls.integrity, groundTruthSha },
    },
  };
  const lockText = `${canonicalStringify(stampedLock, 2)}\n`;
  const lockTmp = `${lockPath}.tmp`;
  fs.writeFileSync(lockTmp, lockText, 'utf-8');
  fs.renameSync(lockTmp, lockPath);

  // ── Diagnostic report (gemini: deriver reports DATA QUALITY). Deterministic +
  // zero-LLM. A sparse answer key is HONEST-NEGATIVE territory — contract-working,
  // not failure — so surface the coverage + why, never densify-to-PASS. ──
  const d = diagnostics;
  const labeled = d.labelCounts.TP + d.labelCounts.FP;
  console.error(`[DeriveLabels] gate1Dir: ${gate1Dir}`);
  console.error(
    `  firings: ${d.totalFirings} (corpus ${d.corpusFirings} · positive ${d.positiveFirings} · negative ${d.negativeFirings})`,
  );
  console.error(`  labeled: ${labeled} (TP ${d.labelCounts.TP} · FP ${d.labelCounts.FP})`);
  console.error(
    `  disposition density: ${(d.dispositionDensity * 100).toFixed(1)}% ` +
      `(${d.boundCorpusFirings}/${d.corpusFirings} corpus firings bound a disposition)`,
  );
  console.error(
    `  unlabeled: ${d.unlabeledFirings} (${(d.unlabeledRate * 100).toFixed(1)}% of scored) — ` +
      `no-match ${d.unlabeledByReason['no-matching-disposition']} · ` +
      `ambiguous ${d.unlabeledByReason['ambiguous-multiple-dispositions']} · ` +
      `unlabeled-class ${d.unlabeledByReason['unlabeled-class']} · ` +
      `incidental-positive ${d.unlabeledByReason['incidental-positive']}`,
  );
  console.error(`  groundTruthSha: ${groundTruthSha} (stamped into ${path.basename(lockPath)})`);
  console.error(
    `  Wrote ${GROUND_TRUTH_FILE} (${evidence.length} labeled firing(s) with disposition provenance).`,
  );
}
