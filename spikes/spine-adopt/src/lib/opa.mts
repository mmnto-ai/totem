// ─── The pinned OPA binary, invoked ──────────────────────────────────────────
//
// Hoisted out of `src/build-wasm.mts` and `src/certify.mts`, which carried two
// byte-identical copies of it (spec `.totem/specs/seed20-apparatus-slice2.md` § S6).
// `src/t5-sweep.mts` is the third caller, and a third copy would have been the
// point at which the three could drift on buffer size or error handling without
// anything noticing.
//
// The status is returned, never thrown on: every caller here treats a non-zero OPA
// exit as DATA (a measurement about the toolchain, a blocked bundle, a refused
// build) rather than as a crash, and the ones that must fail loud say so at their
// own call site.

import { spawnSync } from 'node:child_process';

import { OPA_BIN } from './spike-env.mts';

export interface OpaResult {
  /** `null` when the process could not be started or was killed by a signal. */
  status: number | null;
  stdout: string;
  stderr: string;
}

export function opa(args: string[], cwd: string): OpaResult {
  const r = spawnSync(OPA_BIN, args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
