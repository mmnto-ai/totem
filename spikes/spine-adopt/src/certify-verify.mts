// ─── The certification invariants, as executable checks ──────────────────────
//
// `src/certify.mts` is the ACTUATOR: it evaluates, classifies, and publishes.
// This file is the JUDGE: it re-reads what the actuator left on disk and asserts
// the spec's "Invariants to lock" against it, from independent evidence wherever
// independent evidence exists.
//
// Spec `.totem/specs/spine-spike.md` § Actuator slice, "Invariants to lock":
//
//   every lowered record's bundle certifies PASS with chains byte-identical to the
//   pre-slice chains EXCEPT the added manifest field (the extension is additive;
//   record/rego/wasm hashes unchanged); both negative fixtures BLOCK with typed
//   reasons on both platforms; every host's failure rule proven by fixture, not
//   assumed; the certifier refuses a schema-invalid sentinel.
//
// "Byte-identical EXCEPT the added field" is checked as a genuine BYTE claim, not
// a structural paraphrase: the published chain must literally begin with the
// committed chain's bytes up to its closing brace. That is only possible because
// `publishChain` appends — a re-ordering serializer would fail here, loudly.
//
// The referent chains are read with `git show HEAD:<referent dir>/…` — the dir
// selected per run below (A12): the re-homed specimens baseline, the committed
// control build, or the top-level chains — so the comparison is against the
// COMMITTED artifact rather than against whatever the working tree happens to
// hold after this run overwrote it.
//
// TEMPORAL VALIDITY — INV 2 is BIDIRECTIONAL, and has to be. Read one way only,
// the additive-extension check self-invalidates the moment this slice commits:
// the baseline moves, the committed chain already carries the added keys, and
// every "the published chain is the committed chain PLUS five keys" assertion
// inverts into a failure. So the mode is chosen per chain from the EVIDENCE:
//
//   * the committed chain does NOT carry `manifestSha256` — a PRE-SLICE baseline.
//     Mode `pre-commit`: the byte-prefix claim plus "the added keys are exactly
//     the extension's". This is the additive-extension proof.
//   * the committed chain DOES carry `manifestSha256` — the slice is committed and
//     the baseline is now post-slice. Mode `drift-detection`: current and
//     committed must be BYTE-EQUAL. Certification is deterministic, so a
//     re-certification that changed a published byte is drift, and that is the
//     claim worth holding once the extension itself is history.
//
// Both modes are asserted on every run: the live one against `git show HEAD:`, and
// the other one against constructed inputs in the self-test below, so neither
// branch can rot unobserved while the repository sits on one side of the commit.
//
// Run: node --experimental-strip-types src/certify-verify.mts   (after src/certify.mts)

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { activeRecordSet, loadRecordSet } from './lib/record-sets.mts';
import {
  ARTIFACTS_DIR,
  ARTIFACTS_SUBDIR,
  CHAINS_DIR,
  Checks,
  readRunManifest,
  REGO_BUILD_DIR,
  REPO_ROOT,
  SPIKE_ROOT,
  writeArtifact,
} from './lib/spike-env.mts';
import { canonicalJson, censusWasm, entrypointManifest, sha256 } from './lib/wasm-census.mts';

/** The exact key set `src/certify.mts` appends. Anything else is a contract drift. */
const EXPECTED_ADDED_KEYS = [
  'certification',
  'certified',
  'entrypointManifest',
  'manifestSha256',
  'publishedBy',
] as const;

/**
 * Read a path out of the HEAD commit. `spawnSync` with an argv array — no shell —
 * so the `:` in the git ref is never touched by a path translator.
 */
function gitShow(repoRelPath: string): string | null {
  const r = spawnSync('git', ['show', `HEAD:${repoRelPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout;
}

/**
 * The marker that says a committed chain is already POST-slice. `manifestSha256`
 * is the extension's load-bearing key (the fourth member of the bound set), so its
 * presence is the same evidence the added-key check uses, read one step earlier.
 */
const POST_SLICE_MARKER = 'manifestSha256';

type ChainMode = 'pre-commit' | 'drift-detection';

interface CheckRow {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * INV 2's per-chain comparison, both directions, as a pure function of the two
 * texts — so the mode that is NOT live in this repository state can still be
 * exercised, on constructed inputs, by the self-test at the bottom of the run.
 */
function compareChainAgainstCommitted(
  name: string,
  currentText: string,
  committedText: string,
): { mode: ChainMode; rows: CheckRow[]; preservedBytes: number } {
  const rows: CheckRow[] = [];
  const committed = JSON.parse(committedText) as Record<string, unknown>;
  const current = JSON.parse(currentText) as Record<string, unknown>;
  const mode: ChainMode = POST_SLICE_MARKER in committed ? 'drift-detection' : 'pre-commit';

  let preservedBytes = 0;
  if (mode === 'drift-detection') {
    // The slice is committed: the baseline already carries the extension, so the
    // claim is EQUALITY. Certification is deterministic — no timestamps, no run
    // ids — so any difference is drift in the certifier or in its inputs.
    const identical = currentText === committedText;
    preservedBytes = identical ? committedText.length : firstDiff(committedText, currentText);
    rows.push({
      name: `INV 2 — ${name}: [drift-detection] the committed chain already carries \`${POST_SLICE_MARKER}\`, so the published chain must be BYTE-EQUAL to it`,
      ok: identical,
      detail: identical
        ? `${committedText.length} bytes identical`
        : `DRIFT at byte ${preservedBytes} — committed ${JSON.stringify(committedText.slice(Math.max(0, preservedBytes - 40), preservedBytes + 40))} vs published ${JSON.stringify(currentText.slice(Math.max(0, preservedBytes - 40), preservedBytes + 40))}`,
    });
    const changed = Object.keys(committed).filter(
      (k) => JSON.stringify(committed[k]) !== JSON.stringify(current[k]),
    );
    const added = Object.keys(current)
      .filter((k) => !(k in committed))
      .sort();
    const removed = Object.keys(committed)
      .filter((k) => !(k in current))
      .sort();
    rows.push({
      name: `INV 2 — ${name}: [drift-detection] no key CHANGED, none was ADDED, none was REMOVED`,
      ok: changed.length === 0 && added.length === 0 && removed.length === 0,
      detail: `changed=${JSON.stringify(changed)} added=${JSON.stringify(added)} removed=${JSON.stringify(removed)}`,
    });
  } else {
    // Pre-slice baseline: the additive-extension proof.
    //
    // (a) the BYTE claim: the published file literally begins with the committed
    //     file's bytes, up to its closing brace.
    const closes = committedText.endsWith('\n}\n');
    const stem = closes ? committedText.slice(0, committedText.length - 3) : committedText;
    const bytePrefixOk = closes && currentText.startsWith(`${stem},`);
    preservedBytes = stem.length;
    rows.push({
      name: `INV 2 — ${name}: [pre-commit] the published chain is BYTE-IDENTICAL to the committed one for its first ${stem.length} bytes (the extension is appended, never interleaved)`,
      ok: bytePrefixOk,
      detail: bytePrefixOk
        ? `${stem.length}/${currentText.length} bytes carried through verbatim`
        : `divergence at byte ${firstDiff(stem, currentText)} — committed ${JSON.stringify(stem.slice(Math.max(0, firstDiff(stem, currentText) - 40), firstDiff(stem, currentText) + 40))}`,
    });

    // (b) the STRUCTURAL claim: every pre-slice key survives with an identical
    //     value, and the added keys are exactly the five the extension defines.
    const changed = Object.keys(committed).filter(
      (k) => JSON.stringify(committed[k]) !== JSON.stringify(current[k]),
    );
    rows.push({
      name: `INV 2 — ${name}: [pre-commit] no pre-slice key CHANGED value`,
      ok: changed.length === 0,
      detail: JSON.stringify(changed),
    });
    const added = Object.keys(current)
      .filter((k) => !(k in committed))
      .sort();
    const expected = [...EXPECTED_ADDED_KEYS];
    const addedOk = JSON.stringify(added) === JSON.stringify(expected);
    rows.push({
      name: `INV 2 — ${name}: [pre-commit] the added keys are EXACTLY the extension's`,
      ok: addedOk,
      detail: addedOk
        ? JSON.stringify(added)
        : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(added)}`,
    });
  }

  // (c) the named hashes, called out one by one because the ruled text does. They
  //     are unchanged in BOTH modes — appended keys in one, nothing at all in the
  //     other — so the check is shared rather than duplicated per branch.
  for (const k of ['recordSha256', 'regoSha256', 'wasmSha256']) {
    const same = JSON.stringify(current[k]) === JSON.stringify(committed[k]);
    rows.push({
      name: `INV 2 — ${name}: \`${k}\` is unchanged`,
      ok: same,
      detail: same
        ? String(current[k]).slice(0, 16)
        : `expected ${JSON.stringify(committed[k])}, got ${JSON.stringify(current[k])}`,
    });
  }
  rows.push({
    name: `INV 2 — ${name}: \`certified\` is true`,
    ok: current.certified === true,
    detail: JSON.stringify(current.certified),
  });

  return { mode, rows, preservedBytes };
}

interface Report {
  certifications: {
    id: string;
    kind: string;
    package: string;
    status: string;
    reason: string | null;
    detail: string;
    evaluated: boolean;
    manifestSha256: string | null;
    entrypointAssertion: { ok: boolean; detail: string } | null;
    classifications: { entrypoint: string; status: string; reason: string | null }[];
    chainWritten: string | null;
    blockedArtifact: string | null;
  }[];
  sentinel: {
    malformedControl: {
      schemaErrors: string[];
      refusedBeforeAnyEval: boolean;
      hostInvocationsDuringRefusal: number;
      row: { status: string; reason: string | null; evaluated: boolean };
    };
  };
  blockedClasses: { resultClasses: string[]; observedThisRun: string[] };
  allHostsFailureRule: {
    requiredFixtures: string[];
    rows: {
      fixture: string;
      required: boolean;
      hosts: {
        host: string;
        errored: boolean;
        cleanZero: boolean;
        kind: string;
        detail: string;
        hostError: string | null;
        hostErrorSource: string;
      }[];
    }[];
  };
  fixtures: { id: string; kind: string; corpusRule: string | null }[];
}

function main(): void {
  const checks = new Checks();
  const reportAt = path.join(ARTIFACTS_DIR, 'certification-report.json');
  if (!fs.existsSync(reportAt)) {
    throw new Error(
      `${reportAt} is missing — run \`node --experimental-strip-types src/certify.mts\` first.`,
    );
  }
  const report = JSON.parse(fs.readFileSync(reportAt, 'utf-8')) as Report;

  // ── INVARIANT 1: every lowered record's bundle certifies PASS ──
  //
  // The count is DERIVED from the run manifest's record list minus the lowering's
  // typed reject rows, which is a reading independent of the report being checked.
  const recordSet = activeRecordSet();
  const manifest = readRunManifest();
  const lowering = JSON.parse(
    fs.readFileSync(path.join(ARTIFACTS_DIR, 'lowering-rejects.json'), 'utf-8'),
  ) as { rejects?: { stage?: string }[] };
  // (C5) `records[]` + `controlRecords[]` — the manifest splits the scored corpus
  // from the K-controls, and a control record certifies exactly like a scored one.
  const expectedSpecimenBundles =
    (manifest.records as unknown[]).length +
    ((manifest.controlRecords as unknown[]) ?? []).length -
    (lowering.rejects ?? []).filter((r) => typeof r.stage === 'string').length;
  const specimens = report.certifications.filter((c) => c.kind === 'specimen');
  checks.eq(
    `INV 1 — the report carries all ${expectedSpecimenBundles} specimen bundles`,
    specimens.length,
    expectedSpecimenBundles,
  );
  checks.eq(
    'INV 1 — every specimen bundle certifies PASS',
    specimens.filter((s) => s.status !== 'PASS').map((s) => `${s.id}:${s.reason}`),
    [],
  );
  checks.eq(
    'INV 1 — and every specimen was actually EVALUATED (a PASS that skipped the eval would be vacuous)',
    specimens.filter((s) => !s.evaluated || s.classifications.length === 0).map((s) => s.id),
    [],
  );

  // ── INVARIANT 2: chain preservation vs the COMMITTED referent chains ──
  const chainFiles = fs
    .readdirSync(CHAINS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  // (A12, mmnto-ai/totem#2704 — the E24 slice) The committed referent is KEYED ON
  // WHAT HEAD ACTUALLY COMMITS, not assumed to be the seven-specimen baseline
  // forever. The first run of record committed the seed-20 run's own artifacts (the
  // scorer's three-commit binding rewrites the top-level tree), and this check —
  // reading `HEAD:…artifacts/chains/` as the specimens baseline unconditionally —
  // failed every later `specimens` and `control` run AT the run pin: both Linux
  // legs red, and a seam unable to re-execute at the commit containing its own
  // evidence. The committed run manifest says what HEAD's artifact tree IS, and the
  // referent follows it:
  //   - committed `recordSet: 'specimens'` (the pre-run baseline): the original
  //     behavior, byte for byte — `specimens` compares the whole set, `control`
  //     its one chain, both against `HEAD:…artifacts/chains/`.
  //   - committed `recordSet: 'seed20'` (a committed run of record): a `control`
  //     run's referent is the run's own committed control build,
  //     `HEAD:…artifacts/k3-control/chains/` — byte-equal while the producer and
  //     the record bytes are unchanged (chains carry no run identity; a
  //     charter-sanctioned K3 re-pin re-captures its targets first, § 5 K3); a
  //     `specimens` run reads the re-homed baseline under `artifacts/specimens/`
  //     (below), and only SKIPS, by name, where that home is not committed; and
  //     (A13.1, charter v1.4 § 7 E25 — EXTEND) a `seed20` run's referent is the
  //     committed run of record itself, `HEAD:…artifacts/chains/`: the 21 chains
  //     carry no run identity, so — while the chain-producing source (the
  //     lowerer, the certifier, the record bytes, the pinned toolchain) is
  //     unchanged, which is exactly what this sensor measures — a re-execution
  //     at any commit whose committed manifest records `recordSet: 'seed20'`
  //     regenerates the same bytes, and committed-vs-published byte-equality is
  //     a LIVE certifier-drift sensor on the arm the E23 replay itself takes:
  //     the TOP-LEVEL arm. A `seed20` run publishing under a named
  //     `SPIKE_ARTIFACTS_SUBDIR` (a § S8 K-control arm — K4's swap) is not that
  //     arm and is SKIPPED by name; its chains are that control's to compare.
  //     The cost is the ruling's intended behaviour: a charter-sanctioned K3
  //     re-pin changes the run of record, so it REFUSES at this seam until the
  //     run of record is re-cut — the same class `control` already carries under
  //     A12 — rather than measuring drift on every arm but the one that matters.
  //   - ABSENT committed manifest (pre-manifest history): treated as the
  //     specimens-baseline era. Absence is established by `ls-tree` — a no-match
  //     pathspec exits 0 with empty stdout — NEVER by a failed `git show`: `gitShow`
  //     returns `null` on every non-zero status, which cannot tell "path absent"
  //     from "repository/HEAD broken", and a git fault collapsed into the absence
  //     fallback would select a referent or publish a named skip (bot round on
  //     mmnto-ai/totem#2710, Greptile's residual). A committed manifest that exists
  //     but does not PARSE is a third thing — the authoritative artifact is
  //     malformed — and THROWS with the cause.
  //
  // (bot round on mmnto-ai/totem#2710) Every HEAD listing this block relies on checks
  // git's exit status: a pathspec that matches nothing exits 0 with empty stdout
  // (the honest "not committed"), so a NON-ZERO status is a real git fault, and
  // reading empty stdout as "not committed" there would turn a broken lookup into a
  // named skip with `ok: true`.
  const lsTreeAtHead = (repoRelPath: string): string[] => {
    const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', repoRelPath], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    if (r.status !== 0) {
      throw new Error(
        `[Totem Error] \`git ls-tree -r --name-only HEAD -- ${repoRelPath}\` exited ${String(r.status)} in ${REPO_ROOT}: ${(r.stderr ?? '').trim()} — the committed referent cannot be established, so INV 2 must not skip`,
      );
    }
    return (r.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => path.posix.basename(l))
      .sort();
  };
  const COMMITTED_MANIFEST = 'spikes/spine-adopt/artifacts/manifest.json';
  const committedManifestPresent = lsTreeAtHead(COMMITTED_MANIFEST).length > 0;
  const committedManifestText = committedManifestPresent ? gitShow(COMMITTED_MANIFEST) : null;
  if (committedManifestPresent && committedManifestText === null) {
    throw new Error(
      `[Totem Error] \`git show HEAD:${COMMITTED_MANIFEST}\` failed although \`ls-tree\` lists the path at HEAD — a repository fault, not an absent manifest; INV 2 cannot select its committed referent`,
    );
  }
  let committedRecordSet: string | null = null;
  if (committedManifestText !== null) {
    try {
      const parsed = JSON.parse(committedManifestText) as { recordSet?: unknown };
      committedRecordSet = typeof parsed.recordSet === 'string' ? parsed.recordSet : null;
    } catch (err) {
      throw new Error(
        '[Totem Error] the committed `spikes/spine-adopt/artifacts/manifest.json` at HEAD is not valid JSON — INV 2 cannot select its committed referent from a malformed authoritative artifact',
        { cause: err },
      );
    }
  }
  const committedIsRunOfRecord = committedRecordSet === 'seed20';
  // (A12 cure, the F2 fold) The SPECIMENS BASELINE THAT SURVIVES a committed run
  // of record — A12's option (i): the seven pre-slice chains re-homed byte-exactly
  // (from `69b85544`, the last commit whose top-level tree was the baseline) under
  // a tree no run rewrites. When it is committed at HEAD, the specimens leg keeps
  // FULL drift-detection at every commit — including run pins — instead of
  // skipping.
  const SPECIMENS_HOME = 'spikes/spine-adopt/artifacts/specimens/chains';
  const specimensHomeCommitted = lsTreeAtHead(SPECIMENS_HOME).length > 0;
  const committedChainsDir =
    manifest.recordSet === 'control' && committedIsRunOfRecord
      ? 'spikes/spine-adopt/artifacts/k3-control/chains'
      : manifest.recordSet === 'specimens' && specimensHomeCommitted
        ? SPECIMENS_HOME
        : 'spikes/spine-adopt/artifacts/chains';
  const committedNames = lsTreeAtHead(committedChainsDir);
  // The committed referent is chosen above (A12): the re-homed specimens baseline
  // for a `specimens` run, the committed control build for a `control` run over a
  // committed run of record, the top-level chains otherwise. Where no referent
  // applies the committed-vs-published half of INV 2 is SKIPPED with a named
  // reason, and the per-chain claims that do not need a committed referent —
  // (d) the manifest re-derivation, (e) the five-member binding, (f) the guarded
  // result path — still run on every published chain.
  //
  // (T13, mmnto-ai/totem#2694) The gate is keyed on the MANIFEST's record set, not
  // on the environment. `SPIKE_RECORD_SET` describes the process; the manifest
  // describes the run that was DECLARED at step 0. (The chains themselves trace to
  // the environment too — `src/lower.mts` selects the set via `activeRecordSet()`,
  // and `certify.mts` never reads the manifest's set — so what actually keeps
  // "chains on disk" and "gate" in the same run is the AGREEMENT check below, not
  // the manifest alone; round-1 falsification leg, m6.) Keying the gate on the
  // environment let `SPIKE_RECORD_SET=seed20` skip the committed-vs-published half
  // over a `artifacts/chains/` still holding specimen certificates — the invariant
  // silently not run, and nothing contradicting it. The two must agree, and a
  // disagreement is a FAILED check, never a skip.
  const manifestRecordSet = manifest.recordSet;
  checks.check(
    "INV 2 — the manifest's record set and `SPIKE_RECORD_SET` AGREE (the artifacts on disk and this process are the same run)",
    manifestRecordSet === recordSet,
    `manifest.recordSet=${JSON.stringify(manifestRecordSet)}, activeRecordSet()=${JSON.stringify(recordSet)}` +
      (manifestRecordSet === recordSet
        ? ''
        : ' — re-run `npm run all` for this record set before certifying'),
  );
  // (§ S5, as re-keyed by A12 above and extended by A13.1) The comparison has a
  // referent for `specimens` — the whole committed set, when HEAD's committed
  // baseline IS the specimens set — for `control`, where it is ONE chain: against
  // the specimens baseline, the committed specimen chain (a control-only rebuild
  // of a committed specimen record IS K3 arm B); against a committed run of
  // record, the run's own committed `k3-control/` build — and (A13.1) for
  // `seed20` ON THE TOP-LEVEL ARM, where it is the whole committed run of record
  // when HEAD's committed baseline IS a seed run: the top-level chains, byte for
  // byte. Two things narrow the ruled clause (`committedChainsApply = true when
  // committedRecordSet === 'seed20'`), both disclosed: the MANIFEST's set must be
  // `seed20` too (a `specimens` run over a committed seed baseline would otherwise
  // compare specimen chains against seed chains), and `SPIKE_ARTIFACTS_SUBDIR`
  // must be unset — a `seed20` run under a named subdir is a § S8 K-control arm
  // (K4's swap), not the arm the E23 replay takes. A `seed20` run over the
  // specimens-baseline era (or an absent committed manifest) has no referent, and
  // a `specimens` run over a committed run of record has none either unless the
  // re-homed baseline is committed.
  const committedChainsApply =
    manifestRecordSet === 'control'
      ? true
      : manifestRecordSet === 'specimens'
        ? specimensHomeCommitted || committedRecordSet === 'specimens'
        : manifestRecordSet === 'seed20'
          ? committedIsRunOfRecord && ARTIFACTS_SUBDIR === null
          : false;
  if (manifestRecordSet === 'specimens' && !committedChainsApply) {
    // Reachable only before the re-homed baseline is committed AND when the
    // top-level committed baseline is not the specimens set (a committed run of
    // record, or an unknown/future committed set — named below either way, never
    // compared against the wrong referent).
    checks.check(
      `INV 2 — SKIPPED with the named reason \`no-specimens-referent-at-HEAD\`: \`${SPECIMENS_HOME}\` is not committed and \`artifacts/manifest.json\` at HEAD records \`recordSet: ${JSON.stringify(committedRecordSet)}\`, so the ${chainFiles.length} published specimen chain(s) have no committed referent (A12, mmnto-ai/totem#2704); the per-chain claims that need none still run`,
      true,
      `published: ${chainFiles.length}; committed at HEAD under \`${committedChainsDir}\`: ${committedNames.length}`,
    );
  } else if (manifestRecordSet === 'specimens') {
    checks.eq(
      `INV 2 — the published chain set is exactly the committed specimens baseline (referent: \`${committedChainsDir}\`)`,
      chainFiles,
      committedNames,
    );
  } else if (manifestRecordSet === 'control') {
    const expected = loadRecordSet('control').map((r) => `r${r.ruleId}.json`);
    checks.eq(
      `INV 2 (K3 arm B) — the control-only run published exactly the ${expected.length} chain(s) its record set names, and each has a committed counterpart at HEAD (referent: \`${committedChainsDir}\`)`,
      {
        published: chainFiles,
        missingFromCommitted: expected.filter((n) => !committedNames.includes(n)),
      },
      { published: expected, missingFromCommitted: [] },
    );
  } else if (manifestRecordSet === 'seed20' && committedChainsApply) {
    // (A13.1) The committed run of record IS the referent: the published seed-20
    // chain set must be exactly the committed top-level set, and each chain is
    // then held BYTE-EQUAL in the per-chain loop below (`drift-detection`, the
    // committed chains carry `manifestSha256`). A mismatch here is a FAILED check
    // — a re-pin or a certifier delta — never a skip, and the seam stops here
    // (`certify` = `certify.mts && certify-verify.mts`; nothing after it runs).
    // The escape is the charter's E6 loop, not a flag: `certify.mts` has already
    // published the new chains beside this refusal, so the owner commits them as
    // a NEW run of record (the artifacts-only commit over the pin) and re-runs
    // the seam at that commit, where this check reads its own bytes back. Same
    // path `control` takes under A12; there is deliberately no dev seam here.
    checks.eq(
      `INV 2 (A13.1) — the published seed-20 chain set is exactly the committed run of record's chain set at HEAD (referent: \`${committedChainsDir}\`, the committed \`recordSet: ${JSON.stringify(committedRecordSet)}\` baseline; every chain is held byte-equal below)`,
      chainFiles,
      committedNames,
    );
  } else if (manifestRecordSet === 'seed20' && ARTIFACTS_SUBDIR !== null) {
    // (A13.1's scope) A `seed20` run publishing under a named subdir is a § S8
    // K-control arm (K4's swap, or another named set): not the arm the E23 replay
    // takes, and its chains are that control's to compare. The top-level committed
    // chains are named, never compared against a sub-arm's published set.
    checks.check(
      `INV 2 — SKIPPED with the named reason \`seed20-under-named-subdir\`: this run publishes its ${chainFiles.length} chain(s) under \`artifacts/${ARTIFACTS_SUBDIR}/\` (a § S8 K-control arm), not the top-level arm the E23 replay takes, so the committed-vs-published half (A13.1, mmnto-ai/totem#2704) is not run on this arm — \`${committedChainsDir}\` at HEAD holds ${committedNames.length} chain(s) from the committed \`${String(committedRecordSet)}\` baseline; the per-chain claims that need no referent still run`,
      true,
      `published under: ${CHAINS_DIR}; committed at HEAD under \`${committedChainsDir}\`: ${committedNames.length}`,
    );
  } else {
    // A `seed20` run whose committed baseline is NOT a seed run: the specimens
    // era, or an absent committed manifest. The top-level chains at HEAD are then
    // a different record set's, never a referent for these — named, not compared.
    checks.check(
      `INV 2 — SKIPPED with the named reason \`no-seed20-referent-at-HEAD\`: the ${chainFiles.length} published chain(s) belong to record set \`${String(manifestRecordSet)}\` (the manifest's) but ${
        committedManifestPresent
          ? `\`artifacts/manifest.json\` at HEAD records \`recordSet: ${JSON.stringify(committedRecordSet)}\``
          : '`artifacts/manifest.json` is ABSENT at HEAD (pre-manifest history)'
      }, so \`${committedChainsDir}\` at HEAD (${committedNames.length} chain(s)) is not a committed run of record and the committed-vs-published half is not run on this arm (A13.1 applies only over a committed seed run; mmnto-ai/totem#2704); the per-chain claims that need no referent still run`,
      true,
      `published: ${chainFiles.length}; committed at HEAD: ${committedNames.length}`,
    );
  }

  const preservation: Record<string, unknown>[] = [];
  const modesRun: Record<string, ChainMode> = {};
  for (const name of chainFiles) {
    const currentText = fs.readFileSync(path.join(CHAINS_DIR, name), 'utf-8');
    const committedText = committedChainsApply ? gitShow(`${committedChainsDir}/${name}`) : null;
    if (committedChainsApply && committedText === null) {
      checks.check(`INV 2 — ${name}: a committed chain exists at HEAD`, false, 'git show failed');
      continue;
    }

    // (a)+(b)+(c): the bidirectional comparison. The mode is chosen from the
    // COMMITTED file's own shape, so this check survives its own commit.
    const cmp =
      committedText === null
        ? null
        : compareChainAgainstCommitted(name, currentText, committedText);
    if (cmp) {
      modesRun[name] = cmp.mode;
      for (const r of cmp.rows) checks.check(r.name, r.ok, r.detail);
    }

    const committed = (committedText === null ? {} : JSON.parse(committedText)) as Record<
      string,
      unknown
    >;
    const current = JSON.parse(currentText) as Record<string, unknown>;
    // (T18, mmnto-ai/totem#2694) With no committed referent these are NOT empty and
    // "every key added", they are UNKNOWABLE — `{}` is a stand-in, not a chain. They
    // report `null`, exactly as `mode`, `allModeChecksPassed` and `preservedBytes`
    // already do on the same branch, so a reader cannot mistake "nothing to compare
    // against" for "nothing changed".
    const changed =
      committedText === null
        ? null
        : Object.keys(committed).filter(
            (k) => JSON.stringify(committed[k]) !== JSON.stringify(current[k]),
          );
    const added =
      committedText === null
        ? null
        : Object.keys(current)
            .filter((k) => !(k in committed))
            .sort();

    // (d) the manifest hash, RE-DERIVED here from the module rather than trusted
    //     from the report — an independent second reading of the same artifact.
    const suffix = name.replace(/\.json$/, '');
    const wasmPath = path.join(REGO_BUILD_DIR, suffix, 'policy.wasm');
    const manifest = entrypointManifest(censusWasm(fs.readFileSync(wasmPath)));
    const rederived = sha256(canonicalJson(manifest));
    checks.eq(
      `INV 2 — ${name}: \`manifestSha256\` re-derives from the module ({entrypoints[], imports[], builtins{}}, canonical JSON)`,
      current.manifestSha256,
      rederived,
    );

    // (e) the bound set the ruled text names: source · IR · guarded policy ·
    //     entrypoint/import manifest · final Wasm.
    const composition = current.regoComposition as { components: Record<string, string> };
    const guardedPolicyDigest = composition?.components?.['policy.rego'];
    const bound = {
      source: current.recordSha256,
      ir: current.regoSha256,
      guardedPolicy: guardedPolicyDigest,
      entrypointManifest: current.manifestSha256,
      finalWasm: current.wasmSha256,
    };
    checks.check(
      `INV 2 — ${name}: the chain binds all FIVE members (source · IR · guarded policy · entrypoint/import manifest · final Wasm), each a sha256`,
      Object.values(bound).every((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)),
      JSON.stringify(
        Object.fromEntries(Object.entries(bound).map(([k, v]) => [k, String(v).slice(0, 12)])),
      ),
    );

    // (f) "the guard lives in the only exported result path" — asserted against
    //     the policy SOURCE whose digest the chain binds, not against intent.
    const regoPath = path.join(REGO_BUILD_DIR, suffix, 'policy.rego');
    const regoText = fs.readFileSync(regoPath, 'utf-8');
    checks.eq(
      `INV 2 — ${name}: the bound guarded-policy digest is the sha256 of the policy on disk`,
      sha256(fs.readFileSync(regoPath)),
      guardedPolicyDigest,
    );
    const guardBlock =
      /result := \{"violations": violations, "events": events\} if \{\n\tpatterns_compile\n\tfacts_wellformed\n\}/.test(
        regoText,
      );
    const resultRuleCount = (regoText.match(/^result :=/gm) ?? []).length;
    checks.check(
      `INV 2 — ${name}: the ONLY exported result path is the guarded one (one \`result :=\` rule, gated on patterns_compile + facts_wellformed)`,
      guardBlock && resultRuleCount === 1,
      `${resultRuleCount} \`result :=\` rule(s), guard block ${guardBlock ? 'present' : 'ABSENT'}`,
    );

    preservation.push({
      chain: name,
      mode: cmp?.mode ?? null,
      modeReason:
        cmp === null
          ? `no committed referent for this run — \`artifacts/manifest.json\` at HEAD records \`recordSet: ${JSON.stringify(committedRecordSet)}\` and the selected referent dir \`${committedChainsDir}\` does not apply on \`${String(manifestRecordSet)}\`, so the committed-vs-published half of INV 2 is skipped for this chain`
          : cmp.mode === 'drift-detection'
            ? `the committed chain carries \`${POST_SLICE_MARKER}\` — the slice is committed, so the claim is byte-EQUALITY`
            : `the committed chain has no \`${POST_SLICE_MARKER}\` — a pre-slice baseline, so the claim is the additive extension`,
      allModeChecksPassed: cmp === null ? null : cmp.rows.every((r) => r.ok),
      preservedBytes: cmp?.preservedBytes ?? null,
      publishedBytes: currentText.length,
      changedKeys: changed,
      addedKeys: added,
      recordSha256: current.recordSha256,
      regoSha256: current.regoSha256,
      wasmSha256: current.wasmSha256,
      manifestSha256: current.manifestSha256,
      manifestSha256RederivedFromModule: rederived,
    });
  }

  // ── INVARIANT 2 (self-test): BOTH modes proven, on constructed inputs ──
  //
  // Exactly one mode can be live in any given repository state, so the other one
  // is exercised here rather than left to be discovered by the commit that
  // switches them over. The inputs are constructed from a real published chain;
  // the function under test is the same one the loop above ran.
  const probeChain = chainFiles[0];
  const selfTest: Record<string, unknown>[] = [];
  if (probeChain === undefined) {
    checks.check(
      'INV 2 self-test — a published chain exists to drive the self-test',
      false,
      'no chains on disk',
    );
  } else {
    const text = fs.readFileSync(path.join(CHAINS_DIR, probeChain), 'utf-8');

    // (1) POST-COMMIT SIMULATION — the CURRENT file handed back as the committed
    //     one, which is exactly what `git show HEAD:` will return once this slice
    //     is committed. Must select equality mode, and must PASS it.
    const eq = compareChainAgainstCommitted(probeChain, text, text);
    checks.eq(
      'INV 2 self-test — a committed chain that ALREADY carries the extension selects `drift-detection`',
      eq.mode,
      'drift-detection',
    );
    checks.check(
      'INV 2 self-test — and the published chain PASSES equality mode against it (so the invariant survives its own commit)',
      eq.rows.every((r) => r.ok),
      `${eq.rows.filter((r) => r.ok).length}/${eq.rows.length} checks pass; ${eq.rows.find((r) => !r.ok)?.name ?? 'none failing'}`,
    );

    // (2) …and equality mode has TEETH. A whitespace-only difference leaves every
    //     structural claim true and must still fail the BYTE claim — otherwise
    //     "drift detection" would only be re-checking the structure.
    const drift = compareChainAgainstCommitted(probeChain, text, text.replace(/\n$/, ' \n'));
    const teeth =
      drift.mode === 'drift-detection' &&
      drift.rows[0]?.ok === false &&
      drift.rows.slice(1).every((r) => r.ok);
    checks.check(
      'INV 2 self-test — equality mode has TEETH: a one-byte whitespace difference FAILS it while every structural key still matches',
      teeth,
      `byteClaim=${drift.rows[0]?.ok === false ? 'FAILED (correct)' : 'passed (WRONG)'}, structuralClaims=${drift.rows.slice(1).every((r) => r.ok) ? 'all passed' : 'a structural claim also failed'}`,
    );

    // (3) PRE-COMMIT MODE, kept alive after the commit: a synthetic pre-slice
    //     baseline built by removing the five added keys from the published
    //     chain. Serialised the same way `publishChain` serialises, so the byte
    //     prefix is a real byte prefix, not a re-format.
    const cur = JSON.parse(text) as Record<string, unknown>;
    const preSlice = Object.fromEntries(
      Object.entries(cur).filter(([k]) => !(EXPECTED_ADDED_KEYS as readonly string[]).includes(k)),
    );
    const pre = compareChainAgainstCommitted(
      probeChain,
      text,
      `${JSON.stringify(preSlice, null, 2)}\n`,
    );
    checks.eq(
      'INV 2 self-test — a committed chain WITHOUT the extension selects `pre-commit`',
      pre.mode,
      'pre-commit',
    );
    checks.check(
      'INV 2 self-test — and the additive-extension proof PASSES against it (byte prefix + exactly the five added keys)',
      pre.rows.every((r) => r.ok),
      `${pre.rows.filter((r) => r.ok).length}/${pre.rows.length} checks pass; ${pre.rows.find((r) => !r.ok)?.name ?? 'none failing'}`,
    );

    selfTest.push(
      {
        case: 'post-commit simulation (current file as the committed input)',
        chain: probeChain,
        mode: eq.mode,
        passed: eq.rows.every((r) => r.ok),
        rows: eq.rows,
      },
      {
        case: 'equality-mode falsifier (a whitespace-only difference)',
        chain: probeChain,
        mode: drift.mode,
        expected: 'the BYTE claim fails, every structural claim still passes',
        behavedAsExpected: teeth,
        rows: drift.rows,
      },
      {
        case: 'pre-commit mode against a synthetic pre-slice baseline (the five added keys removed)',
        chain: probeChain,
        mode: pre.mode,
        passed: pre.rows.every((r) => r.ok),
        rows: pre.rows,
      },
    );
  }

  // ── INVARIANT 3: both negative fixtures BLOCK with typed reasons ──
  const negatives = report.certifications.filter((c) => c.kind === 'negative-fixture');
  checks.eq('INV 3 — both negative conformance fixtures are present', negatives.length, 2);
  for (const n of negatives) {
    checks.eq(`INV 3 — ${n.id} is BLOCKED`, n.status, 'BLOCKED');
    checks.check(
      `INV 3 — ${n.id} carries one of the five TYPED reasons`,
      report.blockedClasses.resultClasses.includes(n.reason ?? ''),
      `${n.reason} — ${n.detail}`,
    );
    checks.eq(
      `INV 3 — ${n.id} has NO chain and DOES have a blocked artifact`,
      [n.chainWritten, n.blockedArtifact !== null],
      [null, true],
    );
  }
  checks.eq(
    'INV 3 — each negative fixture is traceable to the corpus rule it transcribes',
    report.fixtures
      .filter((f) => f.kind === 'negative-fixture')
      .map((f) => f.corpusRule)
      .sort(),
    ['80192e6ac2a1dd3c', 'e64911592b774cc6'],
  );

  // ── INVARIANT 4: the malformed-sentinel control is refused, before any eval ──
  const mc = report.sentinel.malformedControl;
  checks.eq('INV 4 — the schema-invalid sentinel is REFUSED', mc.row.status, 'BLOCKED');
  checks.eq(
    'INV 4 — with the pre-eval reason `schema-invalid-sentinel`',
    mc.row.reason,
    'schema-invalid-sentinel',
  );
  checks.check(
    'INV 4 — refused BEFORE any eval: zero host invocations, and the bundle was never evaluated',
    mc.refusedBeforeAnyEval && mc.hostInvocationsDuringRefusal === 0 && mc.row.evaluated === false,
    `hostInvocations=${mc.hostInvocationsDuringRefusal}, evaluated=${mc.row.evaluated}`,
  );
  checks.check(
    'INV 4 — the refusal names MULTIPLE independent schema violations (not one lucky check)',
    mc.schemaErrors.length >= 5,
    `${mc.schemaErrors.length}: ${mc.schemaErrors.join(' | ')}`,
  );

  // ── INVARIANT 5: the only-entrypoint assertion FIRES, on a bundle that would
  //    otherwise have passed ──
  const twoEp = report.certifications.find((c) => c.kind === 'entrypoint-control');
  checks.check(
    'INV 5 — the two-entrypoint control is present',
    twoEp !== undefined,
    twoEp?.id ?? '(absent)',
  );
  if (twoEp) {
    checks.eq(
      'INV 5 — it is BLOCKED by the entrypoint-set assertion',
      twoEp.reason,
      'entrypoint-set-not-single-result',
    );
    checks.eq('INV 5 — the assertion itself reports NOT-ok', twoEp.entrypointAssertion?.ok, false);
    checks.eq(
      'INV 5 — it declares TWO entrypoints, both EVALUATED',
      twoEp.classifications.length,
      2,
    );
    checks.check(
      'INV 5 — and BOTH classify PASS, so the assertion has TEETH: nothing else blocked this bundle',
      twoEp.classifications.every((c) => c.status === 'PASS'),
      twoEp.classifications.map((c) => `${c.entrypoint.split('/').pop()}=${c.status}`).join(', '),
    );
    checks.eq('INV 5 — and it earned NO chain', twoEp.chainWritten, null);
  }
  checks.eq(
    'INV 5 — every CERTIFIED bundle passed the same assertion',
    specimens.filter((s) => s.entrypointAssertion?.ok !== true).map((s) => s.id),
    [],
  );

  // ── INVARIANT 6: every host's failure rule PROVEN by fixture ──
  //
  // "Proven by fixture, not assumed" is a claim about where the error came from.
  // A boolean the certifier computed would satisfy a weaker reading of it, so the
  // row must carry the HOST's own error string — text that cannot exist unless
  // that host's own failure rule ran and raised it — together with the function
  // that produced it.
  for (const row of report.allHostsFailureRule.rows.filter((r) => r.required)) {
    checks.eq(`INV 6 — ${row.fixture} was asked of all THREE hosts`, row.hosts.length, 3);
    checks.eq(
      `INV 6 — ${row.fixture}: every host produced an ERROR row`,
      row.hosts.filter((h) => !h.errored).map((h) => h.host),
      [],
    );
    checks.eq(
      `INV 6 — ${row.fixture}: every error row is HOST-ORIGINATED — a non-empty error string from the host's own failure rule`,
      row.hosts
        .filter((h) => typeof h.hostError !== 'string' || h.hostError.trim().length === 0)
        .map((h) => h.host),
      [],
    );
    checks.eq(
      `INV 6 — ${row.fixture}: each host names the function that raised it`,
      row.hosts.filter((h) => (h.hostErrorSource ?? '').trim().length === 0).map((h) => h.host),
      [],
    );
    checks.check(
      `INV 6 — ${row.fixture}: the three error strings are DISTINCT texts, so no two hosts are being reported from one reading`,
      new Set(row.hosts.map((h) => (h.hostError ?? '').trim())).size === row.hosts.length,
      row.hosts.map((h) => `${h.host}: ${(h.hostError ?? '').slice(0, 60)}`).join(' | '),
    );
    checks.eq(
      `INV 6 — ${row.fixture}: no host returned a clean zero`,
      row.hosts.filter((h) => h.cleanZero).map((h) => h.host),
      [],
    );
  }
  checks.eq(
    'INV 6 — the hosts asked are exactly wasmtime, regorus and wazero',
    (report.allHostsFailureRule.rows[0]?.hosts ?? []).map((h) => h.host).sort(),
    ['regorus', 'wasmtime (rust-opa-wasm)', 'wazero'],
  );

  // ── INVARIANT 7: the five typed classes are all reachable ──
  checks.eq(
    'INV 7 — all five typed blocked classes were OBSERVED, so the classifier is not single-valued',
    report.blockedClasses.observedThisRun.slice().sort(),
    report.blockedClasses.resultClasses.slice().sort(),
  );

  // ── INVARIANT 8: "chains are emitted ONLY here now" — a source-level check ──
  //
  // The publication gate is only real if no other step can write a certificate.
  // Every sibling module — `src/*.mts` AND `src/lib/*.mts`, since a helper is as
  // capable of writing a file as a step is — is scanned for a WRITE into
  // `artifacts/chains/`.
  //
  // A write, specifically. `src/build-wasm.mts` REMOVES the directory (a rebuild
  // invalidates every certificate on disk), and deleting a stale certificate is
  // the opposite of publishing one: the scan pairs a chains-path expression with
  // a write VERB in the same statement, so `rmSync` does not read as publication.
  //
  // HONEST SCOPE: this scan reads TypeScript sources only. The Rust host, the Go
  // probe, the npm scripts and the CI workflow are outside it — none of them
  // writes `artifacts/chains/` today, but this check is not what establishes that.
  const CHAINS_PATH_RE =
    /(?:['"`]chains[/\\])|(?:\bjoin\(\s*[^;\n]*?['"`]chains['"`])|(?:\bCHAINS_DIR\b)/;
  const WRITE_VERB_RE =
    /\b(?:writeFileSync|writeFile|appendFileSync|createWriteStream|copyFileSync|cpSync|renameSync|writeArtifact|outputFileSync)\b/;

  /** Statement-level scan: comment lines dropped, then split on `;`. */
  const chainWriteHits = (text: string): string[] => {
    const code = text
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      })
      .join('\n');
    return code
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => CHAINS_PATH_RE.test(s) && WRITE_VERB_RE.test(s))
      .map((s) => s.slice(0, 160));
  };

  const scanned: { rel: string; abs: string }[] = [];
  for (const [dir, rel] of [
    [path.join(SPIKE_ROOT, 'src'), 'src/'],
    [path.join(SPIKE_ROOT, 'src', 'lib'), 'src/lib/'],
  ] as const) {
    for (const f of fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.mts'))
      .sort()) {
      if (rel === 'src/' && (f === 'certify.mts' || f === 'certify-verify.mts')) continue;
      scanned.push({ rel: `${rel}${f}`, abs: path.join(dir, f) });
    }
  }
  const otherWriters = scanned
    .map((s) => ({ file: s.rel, hits: chainWriteHits(fs.readFileSync(s.abs, 'utf-8')) }))
    .filter((s) => s.hits.length > 0)
    .map((s) => `${s.file}: ${s.hits[0]}`);
  checks.eq(
    `INV 8 — \`src/certify.mts\` is the ONLY TypeScript module that writes \`artifacts/chains/\` (publication is genuinely gated). ${scanned.length} sibling module(s) scanned: ${scanned.map((s) => s.rel).join(', ')} — TypeScript sources only; the Rust host, the Go probe and CI are outside this scan`,
    otherWriters,
    [],
  );
  checks.check(
    'INV 8 — the scan is not vacuous: the same patterns DO fire on a constructed writer',
    chainWriteHits("fs.writeFileSync(path.join(ARTIFACTS_DIR, 'chains', 'x.json'), text, 'utf-8');")
      .length === 1 &&
      chainWriteHits('writeArtifact(\n  path.join(CHAINS_DIR, name),\n  chain,\n);').length === 1 &&
      chainWriteHits("fs.rmSync(path.join(ARTIFACTS_DIR, 'chains'), { recursive: true });")
        .length === 0,
    "a `join(…, 'chains', …)` write and a multi-line `CHAINS_DIR` write are both caught; an `rmSync` of the same path is not",
  );

  writeArtifact('certification-invariants.json', {
    generatedBy: 'spikes/spine-adopt/src/certify-verify.mts',
    contract:
      'spec `.totem/specs/spine-spike.md` § Actuator slice, "Invariants to lock" — asserted against what src/certify.mts left on disk, with the pre-slice chains read from `git show HEAD:`.',
    chainPreservation: {
      method:
        "BIDIRECTIONAL, chosen per chain from the COMMITTED file's own shape, so the invariant survives its own commit. `pre-commit` (the committed chain carries no `manifestSha256`): two independent claims — (a) a BYTE claim, the published file starts with the committed file's bytes up to its closing brace, so the extension is appended and nothing was re-serialised; (b) a STRUCTURAL claim, every pre-slice key holds an identical value and the added key set is exactly the extension's. `drift-detection` (the committed chain already carries `manifestSha256`): the published chain must be BYTE-EQUAL to it, and no key may be added, changed or removed — certification is deterministic, so any difference is drift. In both modes the named hashes are checked unchanged and the manifest hash is RE-DERIVED from the module.",
      modeMarker: `the presence of \`${POST_SLICE_MARKER}\` in the committed chain`,
      preSliceSource: `git show HEAD:${committedChainsDir}/<name>.json`,
      expectedAddedKeys: EXPECTED_ADDED_KEYS,
      modesRun,
      rows: preservation,
      selfTest: {
        why: 'Only one mode can be live in a given repository state. The other is exercised here on constructed inputs — including a falsifier for the equality claim — so neither branch can rot unobserved while the repository sits on one side of the commit.',
        cases: selfTest,
      },
    },
    checks: checks.rows,
  });

  checks.finish('certify-verify');
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return n;
}

main();
