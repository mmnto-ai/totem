// ─── #709 cert-corpus materialization producer — CLI (git I/O + writers) ─────
//
// `totem spine windtunnel materialize --lc-dir <p> --manifest <seed.json>` turns a
// curated seed manifest + the lc clone into the 4 unproduced cert-run scoring
// fixtures (the lock, split.json, pr-diffs.json, the positive/negative control
// dirs) so `loadCertRunFixtures` stops throwing. The PURE derivation + lock
// assembly live in core (`deriveCorpus` / `buildWindtunnelLock`); this module is
// the git I/O + the writers (panel OQ2 — CLI = I/O driver only).
//
// Fold-3 (codex panel): the producer-owned git helpers are FAIL-LOUD — unlike the
// advisory `git.ts` helpers (which swallow errors → ''/[]), a git fault here
// throws, and an empty diff for a code-touching corpus PR is rejected (a wrong
// ref must never become a silently-empty frozen fixture).

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ResolvedPrInput } from '@mmnto/totem';

import { computeFixtureSha, enumeratePrMetas } from './spine-windtunnel.js';

type SafeExecFn = typeof import('@mmnto/totem').safeExec;

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

/** Run git FAIL-LOUD (Tenet 4) — no swallowing to ''/[] like the advisory git.ts helpers (fold-3). */
function gitText(args: string[], cwd: string, safeExec: SafeExecFn, what: string): string {
  try {
    return safeExec('git', args, { cwd }).replace(/\r\n/g, '\n');
  } catch (err) {
    // §9: original as `cause`, never concatenate `err.message`. Stays a plain Error
    // (like the shipped `enumeratePrMetas`) — wrapped into a TotemError at the
    // command boundary, which carries this through the cause chain.
    throw new Error(`cert-corpus materialize: git ${what} failed in ${cwd}`, { cause: err });
  }
}

interface PrGitResolution {
  baseSha: string;
  headSha: string;
  diff: string;
}

/**
 * Resolve a squash-merged PR's base/head/diff off the lc clone (fail-loud).
 * head = the squash merge commit (already a 40-hex SHA from `enumeratePrMetas`);
 * base = its first parent; diff = base..head. Rejects an empty diff — every
 * corpus PR is code-touching by construction, so an empty diff means a wrong ref
 * or a silent git fault, not a real no-op (fold-3 no-silent-empty).
 */
export function resolvePrGit(
  lcDir: string,
  mergeCommit: string,
  safeExec: SafeExecFn,
): PrGitResolution {
  const headSha = mergeCommit;
  const baseSha = gitText(
    ['rev-parse', '--verify', '--end-of-options', `${mergeCommit}^`],
    lcDir,
    safeExec,
    `rev-parse parent of ${mergeCommit}`,
  ).trim();
  const diff = gitText(
    ['diff', '--no-color', '--no-ext-diff', '--end-of-options', baseSha, headSha],
    lcDir,
    safeExec,
    `diff ${baseSha}..${headSha}`,
  );
  if (diff.trim().length === 0) {
    throw new Error(
      `cert-corpus materialize: PR merge ${mergeCommit} produced an EMPTY diff (${baseSha}..${headSha}) — ` +
        `a code-touching corpus PR must have a non-empty diff (fold-3 no-silent-empty).`,
    );
  }
  return { baseSha, headSha, diff };
}

export interface MaterializeOptions {
  lcDir?: string;
  manifestPath: string;
  /** Override the gate-1 output dir (default: dirname of the seed's canonicalPath, under the repo root). */
  outDir?: string;
  /** Working dir the repo root + manifest path resolve from (default: `process.cwd()`; injected for tests). */
  cwd?: string;
}

/**
 * Materialize the cert-run scoring corpus (the producer slice of strategy#709).
 * Two-phase lock: this writes the lock WITHOUT `llmReplaySha` (the producer can't
 * know it — `record` runs after); `freeze` stamps + seals it (panel OQ-seq).
 */
export async function materializeCommand(opts: MaterializeOptions): Promise<void> {
  const {
    safeExec,
    resolveGitRoot,
    TotemError,
    CertCorpusSeedSchema,
    deriveCorpus,
    buildWindtunnelLock,
    canonicalStringify,
    parsePrNumber,
    parseRevertSha,
    isBotIdentity,
  } = await import('@mmnto/totem');

  const cwd = opts.cwd ?? process.cwd();
  const repoRoot = resolveGitRoot(cwd) ?? cwd;
  const lcDir = opts.lcDir ?? process.env['TOTEM_LC_DIR'];
  if (!lcDir) {
    throw new TotemError(
      'CONFIG_INVALID',
      'cert-corpus materialize requires the lc clone (--lc-dir or TOTEM_LC_DIR).',
      'Pass --lc-dir <path-to-liquid-city-clone> whose history includes the seed asOfCommit.',
    );
  }

  // Constrain every seed-derived write/delete target to within `repoRoot` (CR
  // panel 🔴): the producer mkdir/writes the gate-1 dir and RECURSIVELY deletes
  // the control dirs, so an absolute or `../` ref in the seed (or a typo) could
  // escape the workspace. `path.resolve` collapses `..` and lets an absolute ref
  // ignore `repoRoot`; a `..`-leading or absolute relative path — or repoRoot
  // itself — is refused fail-loud (no write/delete outside, never ON, the root).
  const resolveWithinRepo = (input: string, field: string): string => {
    const abs = path.resolve(repoRoot, input);
    const rel = path.relative(repoRoot, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new TotemError(
        'CONFIG_INVALID',
        `cert-corpus materialize: ${field} ("${input}") resolves outside (or onto) the repo root — refusing to write/delete there.`,
        `Provide a repo-relative ${field} nested under ${repoRoot}.`,
      );
    }
    return abs;
  };

  // 1. Load + validate the curated seed manifest.
  let seedRaw: unknown;
  try {
    seedRaw = JSON.parse(fs.readFileSync(path.resolve(cwd, opts.manifestPath), 'utf-8'));
  } catch (err) {
    throw new TotemError(
      'CONFIG_INVALID',
      `cert-corpus materialize: cannot read/parse the seed manifest at ${opts.manifestPath}`,
      'Provide a valid JSON seed manifest (see CertCorpusSeedSchema).',
      err,
    );
  }
  const seedParse = CertCorpusSeedSchema.safeParse(seedRaw);
  if (!seedParse.success) {
    const issues = seedParse.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new TotemError(
      'CONFIG_INVALID',
      `cert-corpus materialize: seed manifest invalid:\n${issues}`,
      'Fix the seed manifest and retry.',
    );
  }
  const seed = seedParse.data;

  // 2. Enumerate PRs off the clone, then derive (pure) — corpus + split + roles.
  let metas;
  try {
    metas = enumeratePrMetas(seed.selectionRule.asOfCommit, lcDir, safeExec, {
      parsePrNumber,
      parseRevertSha,
      isBotIdentity,
    });
  } catch (err) {
    // §9: pass the original as `cause`, never concatenate `err.message` (the debug
    // logger surfaces the cause chain). The hint points there for the specifics.
    throw new TotemError(
      'CONFIG_INVALID',
      `cert-corpus materialize: PR enumeration failed off ${lcDir}`,
      'Verify --lc-dir is an lc clone whose history includes asOfCommit and the merge subjects are well-formed (TOTEM_DEBUG=1 surfaces the underlying fault).',
      err,
    );
  }
  // deriveCorpus throws CertCorpusSeedError / SplitCoverError — already structured,
  // user-facing fail-loud errors; let them propagate verbatim (§9: don't re-wrap +
  // concatenate err.message, which would bury the specific reason behind a
  // debug-only cause).
  const { corpus, split, prDiffRoles } = deriveCorpus({ seed, metas });

  // 3. Resolve git base/head/diff for EVERY corpus PR (fail-loud; validates non-empty).
  const mergeByPr = new Map(metas.map((m) => [m.pr, m.mergeCommit]));
  const gitByPr = new Map<number, PrGitResolution>();
  try {
    for (const pr of corpus) {
      gitByPr.set(pr, resolvePrGit(lcDir, mergeByPr.get(pr)!, safeExec));
    }
  } catch (err) {
    // §9: original as `cause`, no `err.message` concatenation.
    throw new TotemError(
      'CONFIG_INVALID',
      'cert-corpus materialize: git resolution failed for one or more corpus PRs',
      'Verify the lc clone is complete at asOfCommit (all corpus merge commits + parents present); TOTEM_DEBUG=1 surfaces the underlying git fault.',
      err,
    );
  }

  const resolvedPrs: ResolvedPrInput[] = corpus.map((pr) => {
    const g = gitByPr.get(pr)!;
    return { pr, mergeCommit: mergeByPr.get(pr)!, baseSha: g.baseSha, headSha: g.headSha };
  });

  // 4. pr-diffs = the held-out (scored) slice; strict roles from core (targetRuleId iff positive).
  const prDiffs = prDiffRoles.map((role) => {
    const diff = gitByPr.get(role.pr)!.diff;
    return role.targetRuleId
      ? { pr: role.pr, diff, controlKind: role.controlKind, targetRuleId: role.targetRuleId }
      : { pr: role.pr, diff, controlKind: role.controlKind };
  });

  // 5. Write split.json + pr-diffs.json (canonical, sorted-key, LF + trailing newline).
  const gate1Dir = opts.outDir
    ? path.resolve(cwd, opts.outDir)
    : resolveWithinRepo(path.dirname(seed.canonicalPath), 'seed.canonicalPath directory');
  fs.mkdirSync(gate1Dir, { recursive: true });

  // Atomic write (GCA panel): serialize to a temp file then rename, so a reader / CI
  // gate never observes a partially-written manifest. Returns the exact bytes written,
  // so an integrity digest can be taken over the on-disk content, not a re-derived
  // form that could drift from it.
  const writeCanonical = (file: string, value: unknown): string => {
    const text = `${canonicalStringify(value, 2)}\n`;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, file);
    return text;
  };
  writeCanonical(path.join(gate1Dir, 'split.json'), split);
  const prDiffsText = writeCanonical(path.join(gate1Dir, 'pr-diffs.json'), prDiffs);

  // fold-2: integrity digest over the EXACT on-disk `pr-diffs.json` bytes (indented +
  // trailing newline, as written above) — the SCORING source `loadCertRunFixtures`
  // reads independently of the control dirs. Hashing the on-disk bytes (not the
  // compact `canonicalStringify`) lets a freeze/run enforcer `sha256` the file
  // directly, tool-agnostically (greptile/GCA panel). The producer STAMPS it here;
  // freeze/run will re-derive + assert it to close the hole `fixtureSha`
  // (control-dirs-only) leaves — that enforcement is the follow-up slice (#2225),
  // not yet wired, so the digest is stamped-but-not-yet-authoritative.
  const prDiffsSha = sha256Hex(prDiffsText);

  // 6. Control dirs — one `<pr>.diff` per control PR, derived from the SAME resolved
  // diff (single-source, fold-5). Clean first so stale files never pollute fixtureSha.
  const posDir = resolveWithinRepo(seed.controls.positiveRef, 'seed.controls.positiveRef');
  const negDir = resolveWithinRepo(seed.controls.negativeRef, 'seed.controls.negativeRef');
  for (const dir of [posDir, negDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const role of prDiffRoles) {
    if (role.controlKind === 'corpus') continue;
    const dir = role.controlKind === 'positive' ? posDir : negDir;
    fs.writeFileSync(path.join(dir, `${role.pr}.diff`), gitByPr.get(role.pr)!.diff, 'utf-8');
  }

  const fixtureSha = computeFixtureSha([posDir, negDir], repoRoot, safeExec);
  if (!fixtureSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      'cert-corpus materialize: the seed declares no positive/negative controls, so there is nothing ' +
        'for the §5 integrity gate (fixtureSha) to hash.',
      'Add at least one positive and/or negative control to the seed (non-vacuity).',
    );
  }

  // 7. Assemble + write the lock (two-phase: no llmReplaySha — freeze seals it post-record).
  const lock = buildWindtunnelLock({ seed, resolvedPrs, integrity: { fixtureSha, prDiffsSha } });
  writeCanonical(path.join(gate1Dir, path.basename(seed.canonicalPath)), lock);

  console.error(`[CertCorpusMaterialize] gate1Dir: ${gate1Dir}`);
  console.error(
    `  corpus: ${corpus.length} PR(s) · train: ${split.trainPrs.length} · held-out (scored): ${split.heldOutPrs.length}`,
  );
  console.error(
    `  controls: ${split.positiveControlPrs.length} positive · ${split.negativeControlPrs.length} negative`,
  );
  console.error(`  fixtureSha:  ${fixtureSha}`);
  console.error(`  prDiffsSha:  ${prDiffsSha}`);
  console.error(
    `  llmReplaySha: (pending — run \`spine windtunnel record\` then \`freeze\` to seal)`,
  );
  console.error(
    `  Wrote split.json, pr-diffs.json, ${path.basename(seed.canonicalPath)} + control dirs.`,
  );
}
