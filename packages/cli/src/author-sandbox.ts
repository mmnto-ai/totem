// ─── ADR-112 §5.4 R1 — the author sandbox (train-tree-as-of-cut, derived) ─────
//
// The authoring/test harness's ONLY sanctioned view of the lc tree: a detached
// git worktree at the frozen split's `cutBoundarySha` (the last train PR's merge
// commit). EVERYTHING here derives from the frozen artifact — the command
// surface accepts NO root or allowlist knobs, because the author cannot own the
// mechanism that constrains them (the §3 judgedBy≠author independence axiom
// applied to config; strategy Q1 ruling + codex sandbox note). A read outside
// the sandbox root fail-louds (t6) — detect, never widen.
//
// Honest Tenet-19 scoping (the two-class split the R1 fold names): the sandbox
// NARROWS what a compliant harness can see; it cannot make pre-freeze
// working-tree drafts visible to git. That residue stays adherence-class,
// recorded by the (c) non-inspection attestation.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type FrozenSplitArtifact, TotemError } from '@mmnto/totem';

type SafeExecFn = typeof import('@mmnto/totem').safeExec;

/** A prepared sandbox: the derived root + the guarded read surface. */
export interface AuthorSandbox {
  /** The worktree root — lc at the frozen split's cutBoundarySha. */
  root: string;
  cutBoundarySha: string;
  /** Read a file INSIDE the sandbox; any escape (absolute, `..`, symlink-free lexical check) fail-louds (t6). */
  readFile: (relPath: string) => string;
}

/**
 * Materialize the sandbox: `git worktree add --detach <root> <cutBoundarySha>`
 * off the lc clone. The root is DERIVED (tmpdir + the boundary sha) — no caller
 * influence. Fail-loud if the clone does not contain the boundary sha (a wrong
 * or shallow clone must never silently sandbox a different tree).
 */
export function prepareAuthorSandbox(args: {
  lcDir: string;
  artifact: FrozenSplitArtifact;
  safeExec: SafeExecFn;
}): AuthorSandbox {
  const { lcDir, artifact, safeExec } = args;
  const sha = artifact.cutBoundarySha;
  const root = path.join(os.tmpdir(), `totem-author-sandbox-${sha.slice(0, 12)}`);

  if (fs.existsSync(root)) {
    // A stale sandbox at the derived root is torn down and re-materialized —
    // never reused as-is (its content could have drifted from the boundary sha).
    removeAuthorSandbox({ lcDir, root, safeExec });
  }
  try {
    safeExec('git', ['-C', lcDir, 'worktree', 'add', '--detach', root, sha], {});
  } catch (err) {
    throw new TotemError(
      'GATE_INVALID',
      `author-sandbox: cannot materialize the train-tree worktree at ${sha.slice(0, 12)} from ${lcDir}`,
      'The lc clone must contain the frozen split cutBoundarySha (full, non-shallow history).',
      err,
    );
  }

  const readFile = (relPath: string): string => {
    const abs = path.resolve(root, relPath);
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new TotemError(
        'GATE_INVALID',
        `author-sandbox[escape]: read of "${relPath}" resolves outside the sandbox root — the authoring harness sees ONLY the train tree as of the cut (ADR-112 §5.4, t6)`,
        'Author against the sandboxed train tree; held-out code is embargoed until the cert run.',
      );
    }
    return fs.readFileSync(abs, 'utf-8');
  };

  return { root, cutBoundarySha: sha, readFile };
}

/** Tear the sandbox down (worktree remove + prune; rm fallback for a half-removed root). */
export function removeAuthorSandbox(args: {
  lcDir: string;
  root: string;
  safeExec: SafeExecFn;
}): void {
  const { lcDir, root, safeExec } = args;
  // Check-first (no fail-open catch): ask git whether the root is a LIVE worktree,
  // then take exactly one removal path — a live worktree is removed via git (a
  // failure there throws loudly), anything else (already-removed, bare leftover
  // dir) is a plain rm + registry prune.
  const worktrees = safeExec('git', ['-C', lcDir, 'worktree', 'list', '--porcelain'], {});
  const normalizedRoot = path.resolve(root);
  const isLive = worktrees
    .split('\n')
    .some(
      (line) =>
        line.startsWith('worktree ') &&
        path.resolve(line.slice('worktree '.length)) === normalizedRoot,
    );
  if (isLive) {
    safeExec('git', ['-C', lcDir, 'worktree', 'remove', '--force', root], {});
  } else {
    fs.rmSync(root, { recursive: true, force: true });
    safeExec('git', ['-C', lcDir, 'worktree', 'prune'], {});
  }
}
