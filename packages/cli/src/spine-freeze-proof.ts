// ─── ADR-112 §5.1/§8 R1 — the shared-history freeze proof (topology-first) ────
//
// The cli-side git plumbing for the (a) commit-anchored tamper-evidence leg
// (codex fold-1): TOPOLOGY IS THE PROOF. Every assertion here derives from the
// SHARED ref (`origin/main` by default) — never HEAD, a local branch, or a
// local-only ref — because `GIT_COMMITTER_DATE` is trivially settable while a
// rewrite of shared history is observable. The one timestamp comparison
// (`frozenAt` ≤ the introducing commit's committer date) is a CONSISTENCY CHECK
// with its own distinct diagnostic (t2/t8), never the proof.
//
// Failure rows are a NON-ALIASING partition (codex fold-4): each row names a
// distinct way the freeze chain can be broken, with a `freeze-proof[<row>]`
// prefix so no two failures read alike. "Uncommitted" and "committed locally
// but not shared" are DIFFERENT rows — only the latter can fool a local
// HEAD-ancestor proof. Library module (static imports, like
// authored-rule-intake.ts); command wrappers stay lazy.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  canonicalStringify,
  FROZEN_SPLIT_FILE,
  type FrozenSplitArtifact,
  FrozenSplitArtifactSchema,
  SPLIT_REF_RE,
  TotemError,
  verifyFreezeIntegrity,
} from '@mmnto/totem';

type SafeExecFn = typeof import('@mmnto/totem').safeExec;

/** The shared ref the proof derives from. Tests point this at a real fixture remote. */
export const DEFAULT_SHARED_REF = 'origin/main';

/** LF-normalize for blob comparison (the same normalization `generateInputHash` applies). */
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

/**
 * Optional-read `git show <commit>:<path>` — returns `undefined` where the blob
 * cannot be rendered (a deletion commit in the path's rev-list is the legitimate
 * case). The optionality is this helper's CONTRACT, not a swallowed failure: the
 * one caller treats `undefined` as skip-this-commit and keeps its own fail-loud
 * for the no-commit-matches outcome.
 */
function tryGitShow(
  commit: string,
  relPath: string,
  cwd: string,
  safeExec: SafeExecFn,
): string | undefined {
  try {
    return safeExec('git', ['show', `${commit}:${relPath}`], { cwd }).replace(/\r\n/g, '\n');
  } catch (err) {
    // ONLY the blob-absent family degrades to undefined (the optional-read
    // contract); any other git fault propagates — fail loud, never drift.
    const message = err instanceof Error ? err.message : String(err);
    if (
      !/does not exist|exists on disk, but not in|invalid object name|bad revision/i.test(message)
    ) {
      throw err;
    }
    return undefined;
  }
}

/** One fail-loud row of the freeze-proof failure partition — distinct, never aliasing. */
export function freezeProofFailure(
  row: string,
  detail: string,
  fix: string,
  cause?: unknown,
): TotemError {
  return new TotemError('GATE_INVALID', `freeze-proof[${row}]: ${detail}`, fix, cause);
}

function gitText(args: string[], cwd: string, safeExec: SafeExecFn, what: string): string {
  try {
    return safeExec('git', args, { cwd }).replace(/\r\n/g, '\n');
  } catch (err) {
    throw new TotemError(
      'GIT_FAILED',
      `freeze-proof: git ${what} failed in ${cwd}`,
      'Verify git is installed and the repository/ref is valid.',
      err,
    );
  }
}

/** A PROVEN freeze binding — the artifact behind a content-addressed splitRef,
 *  integrity-checked AND shared-history-proven. The ONLY sanctioned constructor is
 *  `resolveProvenFreezeBinding` below: every consumer that threads a binding into
 *  `runRuleAuthor` goes through resolve+prove, so no caller can introduce an
 *  unverified binding (the never-unverified-binding invariant — strategy #2293
 *  round-1 couple read). */
export interface FreezeBinding {
  artifact: FrozenSplitArtifact;
}

/** A resolved frozen-split artifact + where it lives (repo-relative, forward-slash for git). */
export interface ResolvedFrozenSplit {
  artifact: FrozenSplitArtifact;
  absPath: string;
  /** Repo-relative, '/'-separated (the form every git invocation here consumes). */
  relPath: string;
}

/**
 * Resolve a frozen-split artifact by its content-addressed `splitRef` inside the
 * tracked freeze home (`<totemDir>/spine/<gate>/frozen-split.json`). Fail-loud
 * rows: `ref-unresolved` (no artifact carries the ref — including the
 * artifact-absent case), `ref-ambiguous` (more than one does), and
 * `artifact-integrity` (an artifact whose recomputed content address or
 * commitment does not match its own fields — an in-place edit, t7).
 */
export function resolveFrozenSplitByRef(
  totemDir: string,
  repoRoot: string,
  splitRef: string,
): ResolvedFrozenSplit {
  const spineDir = path.join(totemDir, 'spine');
  const candidates: string[] = [];
  if (fs.existsSync(spineDir)) {
    for (const entry of fs.readdirSync(spineDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = path.join(spineDir, entry.name, FROZEN_SPLIT_FILE);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }

  const matches: ResolvedFrozenSplit[] = [];
  for (const absPath of candidates) {
    let parsed: FrozenSplitArtifact;
    try {
      parsed = FrozenSplitArtifactSchema.parse(JSON.parse(fs.readFileSync(absPath, 'utf-8')));
    } catch (err) {
      throw freezeProofFailure(
        'artifact-integrity',
        `frozen split at ${absPath} is malformed or violates the artifact schema`,
        'A frozen artifact is never hand-edited; restore it from shared history.',
        err,
      );
    }
    if (parsed.splitRef !== splitRef) continue;
    const integrity = verifyFreezeIntegrity(parsed);
    if (!integrity.ok) {
      throw freezeProofFailure(
        'artifact-integrity',
        `frozen split at ${absPath} fails its own content address/commitment — expected splitRef ${integrity.expectedSplitRef} / commitment ${integrity.expectedCommitment}, artifact carries ${parsed.splitRef} / ${parsed.freezeCommitment} (in-place edit, t7)`,
        'A frozen artifact is never edited after freeze; restore it from shared history or re-freeze via a new PR.',
      );
    }
    matches.push({
      artifact: parsed,
      absPath,
      relPath: path.relative(repoRoot, absPath).replace(/\\/g, '/'),
    });
  }

  if (matches.length === 0) {
    throw freezeProofFailure(
      'ref-unresolved',
      `no frozen split artifact under ${spineDir} carries splitRef ${splitRef}`,
      `Run \`totem spine freeze-split\` and land the artifact (${FROZEN_SPLIT_FILE}) via the freeze PR before authoring.`,
    );
  }
  if (matches.length > 1) {
    throw freezeProofFailure(
      'ref-ambiguous',
      `${matches.length} frozen split artifacts carry splitRef ${splitRef}: ${matches.map((m) => m.relPath).join(', ')}`,
      'A content-addressed ref must resolve to exactly one tracked artifact; remove the duplicates.',
    );
  }
  return matches[0]!;
}

/** The proof's product: the artifact's introducing commit on the shared ref. */
export interface SharedFreezeProof {
  introducingCommit: string;
  committerDate: string;
}

/**
 * The (a)-leg shared-history proof for a frozen split artifact. Topology rows:
 * `artifact-uncommitted` (working tree only) · `artifact-not-shared` (committed
 * locally, absent from the shared ref's ancestry — the row a HEAD-ancestor proof
 * would miss) · `artifact-blob-differs` (current bytes ≠ the blob at the shared
 * introducing commit — covers post-freeze edits whether or not committed) ·
 * `temporal-consistency` (frozenAt postdates the introducing commit's committer
 * date — t2/t8's distinct diagnostic; a consistency check, never the proof).
 */
export function verifySharedFrozenSplit(args: {
  repoRoot: string;
  resolved: ResolvedFrozenSplit;
  safeExec: SafeExecFn;
  sharedRef?: string;
}): SharedFreezeProof {
  const { repoRoot, resolved, safeExec } = args;
  const sharedRef = args.sharedRef ?? DEFAULT_SHARED_REF;
  const { relPath, absPath, artifact } = resolved;

  try {
    safeExec('git', ['ls-files', '--error-unmatch', '--', relPath], { cwd: repoRoot });
  } catch (err) {
    throw freezeProofFailure(
      'artifact-uncommitted',
      `frozen split ${relPath} is not tracked — it exists in the working tree only, so the commit-anchor has nothing to anchor to (t5)`,
      'Commit the frozen artifact and land it on the shared ref via the freeze PR before authoring.',
      err,
    );
  }

  // The anchor is the first shared commit carrying THIS CONTENT — not merely the
  // first commit touching the path: a legitimate re-freeze reuses the path with
  // new content, and its anchor is the re-freeze commit, while the superseded
  // version keeps its own (older) anchor in history.
  const pathCommits = gitText(
    ['rev-list', '--reverse', sharedRef, '--', relPath],
    repoRoot,
    safeExec,
    `rev-list ${sharedRef} -- ${relPath}`,
  )
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (pathCommits.length === 0) {
    throw freezeProofFailure(
      'artifact-not-shared',
      `frozen split ${relPath} is tracked locally but absent from ${sharedRef} ancestry — a local commit is not a shared anchor (back-dating it would be unobservable)`,
      `Push/merge the freeze PR so the artifact lands on ${sharedRef}, then author.`,
    );
  }

  const currentBytes = lf(fs.readFileSync(absPath, 'utf-8')).trim();
  let introducing: string | undefined;
  for (const commit of pathCommits) {
    // Optional read by CONTRACT: `rev-list -- <path>` includes commits that DELETE
    // the path, and `git show` legitimately cannot render the blob there (GCA #2293
    // round 2). An unreadable commit simply cannot be the introducing match — skipping
    // is the detector's correct read, and a fully-unmatched artifact still fail-louds
    // as artifact-blob-differs below (the conservative direction is preserved).
    const blob = tryGitShow(commit, relPath, repoRoot, safeExec);
    if (blob !== undefined && lf(blob).trim() === currentBytes) {
      introducing = commit;
      break;
    }
  }
  if (introducing === undefined) {
    throw freezeProofFailure(
      'artifact-blob-differs',
      `frozen split ${relPath} matches NO shared version of the path on ${sharedRef} — the working copy was modified after freeze, or this freeze never landed (t7)`,
      'Restore the artifact from shared history; a legitimate re-freeze lands via a new PR before authoring.',
    );
  }

  const committerDate = gitText(
    ['show', '-s', '--format=%cI', introducing],
    repoRoot,
    safeExec,
    `show -s ${introducing}`,
  ).trim();
  // Schema construction enforces presence, but a schema-bypassed artifact must
  // fail LOUD here — `Date.parse('')` is NaN and every NaN comparison is false,
  // which would silently no-op the consistency row (greptile #2293 round 1).
  const frozenAt = artifact.split.frozenAt;
  if (frozenAt === undefined) {
    throw freezeProofFailure(
      'artifact-integrity',
      `frozen split ${relPath} carries no split.frozenAt — the temporal-consistency check cannot run on a stampless artifact`,
      'A frozen artifact always carries its freeze instant; restore it from shared history.',
    );
  }
  // Git committer dates are SECOND-granular while frozenAt carries milliseconds —
  // a freeze committed within the same second must not false-positive. The row
  // fires only when frozenAt exceeds the committer date's whole second.
  const GIT_TIMESTAMP_GRANULARITY_MS = 1000;
  if (Date.parse(frozenAt) >= Date.parse(committerDate) + GIT_TIMESTAMP_GRANULARITY_MS) {
    throw freezeProofFailure(
      'temporal-consistency',
      `temporal regression: frozenAt ${frozenAt} postdates the introducing commit's committer date ${committerDate} (${introducing.slice(0, 12)}) — the stamp claims a freeze AFTER the commit that carries it. Topology remains the proof; this consistency check names clock skew or a doctored stamp (t2/t8)`,
      'Re-freeze via a new PR with an honestly-stamped instant; never edit the artifact in place.',
    );
  }

  return { introducingCommit: introducing, committerDate };
}

/**
 * Resolve + PROVE the freeze binding for a splitRef, in one home. Returns
 * `undefined` for a legacy free-text ref (no artifact exists to bind — the
 * pre-R1 adherence-class shape); for a content-addressed ref it resolves the
 * artifact (integrity-checked) AND runs the shared-history proof, so a binding
 * NEVER enters a consumer unproven regardless of which boundary constructs it
 * (authoring intake, cert-run resolve, or the labels deriver).
 */
export function resolveProvenFreezeBinding(args: {
  totemDir: string;
  repoRoot: string;
  splitRef: string;
  safeExec: SafeExecFn;
  sharedRef?: string;
}): FreezeBinding | undefined {
  if (!SPLIT_REF_RE.test(args.splitRef)) return undefined;
  const resolved = resolveFrozenSplitByRef(args.totemDir, args.repoRoot, args.splitRef);
  verifySharedFrozenSplit({
    repoRoot: args.repoRoot,
    resolved,
    safeExec: args.safeExec,
    ...(args.sharedRef !== undefined ? { sharedRef: args.sharedRef } : {}),
  });
  return { artifact: resolved.artifact };
}

/**
 * The ledger half of the (a) leg: every EFFECTIVE authoring-ledger entry must
 * have entered shared history STRICTLY LATER than the freeze artifact — by
 * ancestry, not timestamps (t3). Rows: `entry-not-shared` (the row is not in the
 * shared ref's history of the ledger file — uncommitted, dirty, or local-only) ·
 * `entry-not-after-freeze` (introduced in the same commit as, or not a
 * descendant of, the freeze's introducing commit).
 */
export function assertLedgerEntriesAfterFreeze(args: {
  repoRoot: string;
  /** Repo-relative '/'-separated path of the authoring-ledger NDJSON. */
  ledgerRelPath: string;
  /** The effective entries to anchor (each is matched by its canonical NDJSON line). */
  entries: readonly { ruleId: string; entry: unknown }[];
  freezeIntroducingCommit: string;
  safeExec: SafeExecFn;
  sharedRef?: string;
}): void {
  const { repoRoot, ledgerRelPath, entries, freezeIntroducingCommit, safeExec } = args;
  const sharedRef = args.sharedRef ?? DEFAULT_SHARED_REF;

  for (const { ruleId, entry } of entries) {
    const line = canonicalStringify(entry);
    const introducing = gitText(
      ['log', '--format=%H', '--reverse', `-S${line}`, sharedRef, '--', ledgerRelPath],
      repoRoot,
      safeExec,
      `log -S<entry ${ruleId}> ${sharedRef} -- ${ledgerRelPath}`,
    )
      .split('\n')
      .filter((l) => l.trim().length > 0)[0];
    if (introducing === undefined) {
      throw freezeProofFailure(
        'entry-not-shared',
        `authoring-ledger entry for '${ruleId}' is not in ${sharedRef}'s history of ${ledgerRelPath} — uncommitted, dirty, or local-only rows cannot anchor the freeze→author chronology`,
        'Land the authoring commit on the shared ref; the cert chain reads shared history only.',
      );
    }
    if (introducing === freezeIntroducingCommit) {
      throw freezeProofFailure(
        'entry-not-after-freeze',
        `authoring-ledger entry for '${ruleId}' entered shared history in the SAME commit as the freeze artifact (${introducing.slice(0, 12)}) — authoring must be strictly later than the freeze (t3)`,
        'Freeze first (one PR), author after (a later PR); never combine them in one commit.',
      );
    }
    try {
      safeExec('git', ['merge-base', '--is-ancestor', freezeIntroducingCommit, introducing], {
        cwd: repoRoot,
      });
    } catch (err) {
      // Non-zero exit = not-an-ancestor (or a git fault) — both honestly fail the row
      // (conservative: an unprovable ordering never passes).
      throw freezeProofFailure(
        'entry-not-after-freeze',
        `authoring-ledger entry for '${ruleId}' (introduced ${introducing.slice(0, 12)}) does not descend from the freeze artifact's introducing commit ${freezeIntroducingCommit.slice(0, 12)} — not strictly later by ancestry (t3; timestamps are not consulted)`,
        'The entry predates the freeze or lives on a divergent line; re-author under the frozen split.',
        err,
      );
    }
  }
}
