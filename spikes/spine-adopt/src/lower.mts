// ─── The disposable record→Rego lowerer ──────────────────────────────────────
//
// Binding contract: `spikes/spine-adopt/rego/LOWERING.md`, in full. Every numbered
// rule below cites the clause it discharges.
//
//   § Lowering 1  one package per record, `totem.spike.r<ruleId>`,
//                 `result = {violations, events}`
//   § Lowering 2  strict always — the host must surface builtin errors as errors
//   § Lowering 3  patterns are JSON-escaped double-quoted literals, never raw
//                 strings, never verbatim
//   § Lowering 4  regex engine gate — only `re2-clean` / `word-boundary` lower;
//                 `lookaround` / `backreference` are REJECT rows
//   § Lowering 5  globs lower to anchored regexes at LOWERING time (TS side),
//                 § Design 7 profile, table emitted beside the policy
//   § Lowering 6  `requires:` scope line/file, `fileText == null` ⇒ UNMET ⇒ fire
//   § Lowering 7  suppression markers, regex anchor pair + ast dual anchor
//   § Lowering 8  severity/message are compile-time constants
//
// Two things the contract does not settle, both FLAGGED for the dispatching seat
// rather than silently decided (see `contractNotes` in the artifact):
//
//   (N1) `r<ruleId>` is NOT unique across the 7 records — `d-line`, `d-file` and
//        `e` all carry the pinned id `0123456789abcdef`. "One package per record"
//        (§ Lowering 1) and `r<ruleId>` cannot both hold. The semantic half —
//        one policy per RECORD — is unambiguous in both the spec and LOWERING.md,
//        so it is the naming that gives: a colliding id takes a `_<specimen>`
//        suffix, a unique one is left exactly on-contract.
//   (N2) § Lowering 7 does not order suppression against § Lowering 6's requires
//        check. The shipped runtime orders them REQUIRES-FIRST on all three
//        dispatchers (measured), so this lowering does too.
//   (N4) § Lowering 7's preceding-line marker set omits `shield-context:`, which
//        the shipped `isSuppressed` accepts on that anchor. Built to the CONTRACT,
//        with the measured gap recorded.
//
// Run: node --experimental-strip-types src/lower.mts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { classify, scanPattern } from './lib/expressibility.mts';
import { lowerPattern, type PatternVerdict } from './lib/lowering-gate.mts';
import {
  activeRecordSet,
  DECLARED_TWINNED_IDS,
  loadRecordSet,
  measuredSharedIds,
  sharedIdCheckName,
  sharedProbePaths,
  type RecordRow,
} from './lib/record-sets.mts';
import { intakeRecordSet, loadCore, type CompiledSpecimen } from './lib/records.mts';
import { ARTIFACTS_DIR, Checks, SPIKE_ROOT, writeArtifact } from './lib/spike-env.mts';

export { lowerPattern, type PatternVerdict };

export const REGO_DIR = path.join(SPIKE_ROOT, 'rego');
export const REGO_BUILD_DIR = path.join(REGO_DIR, 'build');
export const LOWERING_MD = path.join(REGO_DIR, 'LOWERING.md');
/**
 * G7 — the PUBLISHED lowering. `rego/build/` stays a gitignored build tree; the
 * policy and its glob table are copied here so T3 can audit the lowering from the
 * repository at the pin without rebuilding it.
 * `<pkg>` is the package SUFFIX (`totem.spike.` stripped) — the same key the build
 * tree and `artifacts/chains/<pkg>.json` already use.
 */
export const LOWERED_PUBLISH_DIR = path.join(ARTIFACTS_DIR, 'lowered');

// ─── § Lowering 7 — the suppression marker sets, verbatim from the contract ──

/**
 * "same-line `totem-ignore`/`totem-context:`/`shield-context:` substring".
 * Matches `rule-engine.ts:377-381` exactly. Pure substring containment, no
 * comment-syntax awareness and no word boundary — `totem-ignore` inside a string
 * literal suppresses. `totem-ignore` is a prefix of `totem-ignore-next-line`, so
 * a directive line suppresses itself.
 */
export const SAME_LINE_MARKERS = ['totem-ignore', 'totem-context:', 'shield-context:'] as const;
/**
 * "or preceding-line `totem-ignore-next-line`/`totem-context:`".
 *
 * (N4) The CONTRACT's set, emitted verbatim. The shipped `isSuppressed`
 * (`rule-engine.ts:384-388` → `hasContextDirective`, `:349-356`) also accepts
 * `shield-context:` on this anchor, so the contract's list is one marker short of
 * the runtime. Recorded as a contract note rather than silently widened — a
 * lowerer that "helpfully" adds the third marker would be reproducing a semantic
 * its own contract does not state.
 */
export const PRECEDING_LINE_MARKERS = ['totem-ignore-next-line', 'totem-context:'] as const;

// ─── The FactBundle schema line, DERIVED from the contract, never retyped ────

/**
 * The `## Input contract (= FactBundle, verbatim)` line, lifted out of
 * LOWERING.md itself and whitespace-normalised. It is one of the three inputs to
 * the chain's IR hash (`sha256(lowered .rego + fact schema)`, § Lowering 1), so
 * retyping it here would let the hashed schema drift from the contract that
 * defines it.
 */
export function factSchemaLine(): string {
  const md = fs.readFileSync(LOWERING_MD, 'utf-8');
  const heading = '## Input contract (= FactBundle, verbatim)';
  const at = md.indexOf(heading);
  if (at < 0) throw new Error(`LOWERING.md is missing the heading ${JSON.stringify(heading)}`);
  const open = md.indexOf('`', at + heading.length);
  const close = md.indexOf('`', open + 1);
  if (open < 0 || close < 0) {
    throw new Error('LOWERING.md § Input contract carries no backticked schema span');
  }
  const raw = md.slice(open + 1, close);
  if (!raw.startsWith('input = {')) {
    throw new Error(`LOWERING.md § Input contract span is not the schema: ${JSON.stringify(raw)}`);
  }
  return raw.replace(/\s+/g, ' ').trim();
}

// ─── § Lowering 5 — the § Design 7 glob dialect, lowered to an anchored regex ─

/**
 * `escapeRegexLiteral` from `packages/core/src/sys/glob.ts:137-139`, character
 * class for character class. Reproduced rather than imported because the lowerer
 * must emit REGEX SOURCE, and the shipped module only exposes a boolean matcher.
 * Parity with the real matcher is not assumed — it is asserted by scope probes
 * against `matchesRecordGlob` / `ruleAppliesToFile` (§ Lowering 5).
 */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `compileGlob(glob, RECORD_DIALECT_PROFILE)` from `sys/glob.ts:315-351`, with the
 * profile's five option values inlined (`sys/glob.ts:128-135`):
 *
 *   normalizePatternSeparators: false  ⇒ the pattern is used as authored
 *   barePatternMatchesBasename: false  ⇒ NO basename prefix — `*.ts` is root-level
 *   optionalSyntax: (empty)            ⇒ `?` and `{}` are LITERALS, not syntax
 *   starActivation: 'all'              ⇒ every `*` is a wildcard
 *   crossSegmentWildcard: '.*'         ⇒ a trailing `**` spans separators
 *
 * `**\/` compiles to the shared `globstar-segments` token `(?:[^/]+/)*`, a bare
 * `*` to `[^/]*`. The `never` token (`(?!)`) is unreachable under this profile —
 * it comes only from `collectRuleEngineStarIndexes`, which `starActivation: 'all'`
 * never calls — which matters because `(?!)` is a lookahead and RE2 would reject
 * it at compile. `assertRe2SafeGlobSource` proves the unreachability per glob
 * rather than trusting the reading.
 */
export function globToRegexSource(glob: string): string {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:[^/]+/)*'; // 'globstar-segments'
          i += 3;
          continue;
        }
        source += '.*'; // 'globstar' → crossSegmentWildcard
        i += 2;
        continue;
      }
      source += '[^/]*'; // 'star'
      i += 1;
      continue;
    }
    // `?` and `{` fall through to 'literal': the record dialect's optionalSyntax
    // set is EMPTY, so neither is glob syntax here.
    source += escapeRegexLiteral(ch);
    i += 1;
  }
  return `^${source}$`;
}

/** § Lowering 4's gate applied to a lowered GLOB: a lookaround here would be an RE2 reject. */
function assertRe2SafeGlobSource(glob: string, source: string): void {
  const cls = classify(scanPattern(source));
  if (cls === 'lookaround' || cls === 'backreference') {
    throw new Error(
      `glob ${JSON.stringify(glob)} lowered to an RE2-INEXPRESSIBLE source (${cls}): ${JSON.stringify(source)}`,
    );
  }
}

/** `matchGlob`'s path side (`sys/glob.ts:353-354`): host separators normalised, case-SENSITIVE. */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

// ─── § Lowering 4 — the regex engine gate ────────────────────────────────────
//
// `lowerPattern` and `PatternVerdict` now live in `src/lib/lowering-gate.mts`
// (re-exported above, unchanged): `src/facts.mts` and `src/verify-records.mts` run
// BEFORE this module and need the same verdict to skip a rejected record, and
// importing this file for it would re-run the whole lowering as an import side
// effect.

// ─── § Lowering 3 — raw-string SYNTAX, not the backtick byte (G6) ────────────

/**
 * Remove every DOUBLE-QUOTED Rego string literal from a line of emitted code,
 * honouring `\"` (and every other backslash escape) inside them.
 *
 * The § Lowering 3 self-assert used to search the code for a backtick BYTE. That
 * over-fires: a record whose pattern legitimately contains a backtick — inside a
 * character class, say — lowers to a JSON-escaped DOUBLE-QUOTED literal that
 * carries the backtick as DATA, which is exactly what the contract asks for. What
 * must never appear is a RAW string literal, and a raw literal is a backtick
 * OUTSIDE any double-quoted span. Stripping the quoted spans first makes the
 * assert test the syntax the clause is about.
 */
export function stripRegoStringLiterals(line: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < line.length) {
    const ch = line[i]!;
    if (inString) {
      if (ch === '\\') {
        i += 2; // the escape and whatever it escapes, `\"` included
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// ─── § Lowering 1 — the package name ─────────────────────────────────────────

/**
 * (N1) `r<ruleId>` where the id is unique among the lowered records; a
 * `_<discriminator>` suffix where it is not.
 *
 * The discriminator is the record row's `packageDiscriminator`: the specimen id on
 * the specimens set (three records share the pinned id `0123456789abcdef`), the
 * record's declared LANGUAGE on the seed set — the charter fixes
 * `totem.spike.r<lessonHash>_<language>` for BOTH records of a twinned rule.
 */
export function packageSuffix(ruleId: string, discriminator: string, shared: boolean): string {
  return shared ? `r${ruleId}_${discriminator.replace(/-/g, '_')}` : `r${ruleId}`;
}

// ─── The emitter ─────────────────────────────────────────────────────────────

interface LoweredRecord {
  specimen: string;
  /** G4 — the seed entry beside the specimen, so a rule's N records group. */
  seedEntry: string | null;
  ruleId: string;
  pkgSuffix: string;
  packageName: string;
  entrypoint: string;
  engine: string;
  dir: string;
  regoPath: string;
  globsPath: string;
  patterns: PatternVerdict[];
  globTable: GlobRow[];
}

interface GlobRow {
  kind: 'fileGlobs' | 'excludeGlobs';
  glob: string;
  regex: string;
}

function q(s: string): string {
  return JSON.stringify(s);
}

/** A Rego array literal of JSON-escaped strings, one per line for a readable diff. */
function regoStringArray(values: readonly string[], indent = '\t'): string {
  if (values.length === 0) return '[]';
  return `[\n${values.map((v) => `${indent}${q(v)},`).join('\n')}\n]`;
}

function emitPolicy(cs: CompiledSpecimen, lowered: LoweredRecord): string {
  const rule = cs.rule as Record<string, any>;
  const isRegex = cs.engine === 'regex';
  const requires = rule.requires as { pattern: string; scope: 'line' | 'file' } | undefined;
  const positives = lowered.globTable.filter((g) => g.kind === 'fileGlobs').map((g) => g.regex);
  const excludes = lowered.globTable.filter((g) => g.kind === 'excludeGlobs').map((g) => g.regex);
  const target = lowered.patterns.find((p) => p.role === 'target');
  const req = lowered.patterns.find((p) => p.role === 'requires');

  // Every regex literal this policy will hand to `regex.match`, so the
  // compile-probe below can exercise all of them.
  const allLiterals = [
    ...positives.map((r) => q(r)),
    ...excludes.map((r) => q(r)),
    ...(isRegex && target?.literal ? [target.literal] : []),
    ...(req?.literal ? [req.literal] : []),
  ];

  const L: string[] = [];
  L.push(`# GENERATED by spikes/spine-adopt/src/lower.mts — do not hand-edit.`);
  L.push(`#`);
  L.push(`# Record:    ${path.basename(cs.specimen.recordFile)} (specimen ${cs.specimen.id})`);
  L.push(`# Rule id:   ${rule.lessonHash}`);
  L.push(`# Engine:    ${cs.engine}`);
  L.push(`# Contract:  spikes/spine-adopt/rego/LOWERING.md`);
  L.push(`#`);
  L.push(`# § Lowering 8 — severity/message are compile-time constants, emitted for the`);
  L.push(`# report and deliberately NOT part of the verdict comparison.`);
  L.push(``);
  L.push(`package ${lowered.packageName}`);
  L.push(``);
  L.push(`rule_id := ${q(rule.lessonHash)}`);
  L.push(``);
  L.push(`severity := ${q(rule.severity)}`);
  L.push(``);
  L.push(`# ─── § Lowering 5 — scope: the § Design 7 two-array rule ───────────────────`);
  L.push(`#`);
  L.push(`# Globs were lowered to ANCHORED regexes on the TS side; the path is`);
  L.push(`# separator-normalised here exactly as \`matchGlob\` does (sys/glob.ts:354),`);
  L.push(`# and matching is case-SENSITIVE (no \`i\` anywhere in the shipped profile).`);
  L.push(``);
  L.push(`normalized_file := replace(input.file, ${q('\\')}, ${q('/')})`);
  L.push(``);
  L.push(`positive_globs := ${regoStringArray(positives)}`);
  L.push(``);
  L.push(`exclude_globs := ${regoStringArray(excludes)}`);
  L.push(``);
  L.push(`positive_match if {`);
  L.push(`\tsome g in positive_globs`);
  L.push(`\tregex.match(g, normalized_file)`);
  L.push(`}`);
  L.push(``);
  L.push(`exclude_match if {`);
  L.push(`\tsome g in exclude_globs`);
  L.push(`\tregex.match(g, normalized_file)`);
  L.push(`}`);
  L.push(``);
  L.push(`# An EMPTY positives list matches NOTHING (the record profile's direction,`);
  L.push(`# the opposite of legacy \`fileMatchesGlobs\`) — \`positive_match\` simply has`);
  L.push(`# no binding to succeed on.`);
  L.push(`in_scope if {`);
  L.push(`\tpositive_match`);
  L.push(`\tnot exclude_match`);
  L.push(`}`);
  L.push(``);

  L.push(`# ─── § Lowering 2 — strictness, made structural ────────────────────────────`);
  L.push(`#`);
  L.push(`# MEASURED, not assumed: an OPA WASM module has no \`--strict-builtin-errors\``);
  L.push(`# equivalent. A \`regex.match\` compile failure inside a PARTIAL rule body`);
  L.push(`# simply yields no member, so an inexpressible pattern would degrade to an`);
  L.push(`# empty \`violations\` set — the fail-open § Lowering 2 calls`);
  L.push(`# spike-invalidating. Every emitted pattern is therefore exercised in the`);
  L.push(`# COMPLETE rule's body below: a compile failure makes \`result\` UNDEFINED, the`);
  L.push(`# entrypoint returns an empty result SET, and the host raises an error row.`);
  L.push(`# \`is_boolean\` is what keeps a legitimate non-match from failing the probe.`);
  L.push(`patterns_compile if {`);
  for (const lit of allLiterals) L.push(`\tis_boolean(regex.match(${lit}, ""))`);
  if (allLiterals.length === 0) L.push(`\ttrue`);
  L.push(`}`);
  L.push(``);
  L.push(`# The FactBundle's own shape, asserted rather than assumed: a malformed bundle`);
  L.push(`# must be an error row too, never a silent zero-violation verdict.`);
  L.push(`facts_wellformed if {`);
  L.push(`\tis_string(input.file)`);
  L.push(`\tis_array(input.lines)`);
  L.push(`\tis_array(input.astMatches)`);
  L.push(`\tcount([1 | some l in input.lines; is_string(l)]) == count(input.lines)`);
  L.push(
    `\tcount([1 | some m in input.astMatches; ast_match_wellformed(m)]) == count(input.astMatches)`,
  );
  L.push(`}`);
  L.push(``);
  L.push(`ast_match_wellformed(m) if {`);
  L.push(`\tis_number(m.lineNumber)`);
  L.push(`\tis_string(m.lineText)`);
  L.push(`\tis_string(m.startLineText)`);
  L.push(`}`);
  L.push(``);

  L.push(`# ─── § Lowering 7 — suppression ────────────────────────────────────────────`);
  L.push(``);
  L.push(`same_line_markers := ${regoStringArray(SAME_LINE_MARKERS)}`);
  L.push(``);
  L.push(`preceding_line_markers := ${regoStringArray(PRECEDING_LINE_MARKERS)}`);
  L.push(``);

  if (isRegex) {
    L.push(`# The regex arm anchors on the matched line and its preceding line.`);
    L.push(`suppressed(i) if {`);
    L.push(`\tsome m in same_line_markers`);
    L.push(`\tcontains(input.lines[i], m)`);
    L.push(`}`);
    L.push(``);
    L.push(`suppressed(i) if {`);
    L.push(`\ti > 0`);
    L.push(`\tsome m in preceding_line_markers`);
    L.push(`\tcontains(input.lines[i - 1], m)`);
    L.push(`}`);
    L.push(``);
  } else {
    L.push(`# The ast arm carries the DUAL anchor: the reported line and its preceding`);
    L.push(`# line, PLUS the match's own \`startLineText\`/\`startPrecedingLineText\`.`);
    L.push(`suppressed(j) if {`);
    L.push(`\tsome m in same_line_markers`);
    L.push(`\tcontains(input.astMatches[j].lineText, m)`);
    L.push(`}`);
    L.push(``);
    L.push(`suppressed(j) if {`);
    L.push(`\tsome m in same_line_markers`);
    L.push(`\tcontains(input.astMatches[j].startLineText, m)`);
    L.push(`}`);
    L.push(``);
    L.push(`suppressed(j) if {`);
    L.push(`\tln := input.astMatches[j].lineNumber`);
    L.push(`\tln > 1`);
    L.push(`\tsome m in preceding_line_markers`);
    L.push(`\tcontains(input.lines[ln - 2], m)`);
    L.push(`}`);
    L.push(``);
    L.push(`suppressed(j) if {`);
    L.push(`\ts := input.astMatches[j].startPrecedingLineText`);
    L.push(`\tis_string(s)`);
    L.push(`\tsome m in preceding_line_markers`);
    L.push(`\tcontains(s, m)`);
    L.push(`}`);
    L.push(``);
  }

  if (requires && req?.literal) {
    L.push(`# ─── § Lowering 6 — the \`requires:\` two-pass ───────────────────────────────`);
    L.push(`#`);
    L.push(`# TRUE means the required context is PRESENT, i.e. the rule stays SILENT:`);
    L.push(`# no violation AND no event of any kind (silence, never suppression).`);
    L.push(`# scope: ${requires.scope}`);
    if (requires.scope === 'line') {
      L.push(`requirement_met(i) if {`);
      L.push(`\tregex.match(${req.literal}, input.lines[i])`);
      L.push(`}`);
    } else {
      L.push(`#`);
      L.push(`# \`fileText == null\` ⇒ requirement UNMET ⇒ FIRE. Written as an explicit`);
      L.push(`# guard, never as a default: an absent/unreadable file must fail TOWARD`);
      L.push(`# flagging. \`''\` is a readable empty file and matches only ''-matching`);
      L.push(`# requirements — the M3 split, preserved because the guard tests \`null\``);
      L.push(`# rather than truthiness.`);
      L.push(`requirement_met(_) if {`);
      L.push(`\tinput.fileText != null`);
      L.push(`\tregex.match(${req.literal}, input.fileText)`);
      L.push(`}`);
    }
    L.push(``);
  }

  // The guard's ARGUMENT is arm-specific. The regex arm's `i` is already an
  // `input.lines` index. The ast arm's `j` is an `input.astMatches` ORDINAL,
  // but `requirement_met` on `scope: line` indexes `input.lines` — so passing
  // `j` would check whichever line happens to sit at the match's ordinal. The
  // match's own reported line is the right index (`lineNumber` is 1-based,
  // `input.lines` is 0-based); `m` is in scope in every ast rule body below.
  //
  // This combination is GRAMMAR-UNREACHABLE for a valid record: the shipped
  // `compileRuleRecord` rejects `requires.scope: line` on an `ast-grep` target
  // (`packages/core/src/spine/record-lower.ts:397`, Prop 310 § Design 8), so no
  // conforming record reaches it. Corrected anyway — this lowerer is a
  // REFERENCE IMPLEMENTATION of the contract, and its correctness is read off
  // the Rego it emits, not off the records that happen to exist today.
  const requiresArg = isRegex ? 'i' : requires?.scope === 'line' ? 'm.lineNumber - 1' : 'j';
  const requiresGuard = requires && req?.literal ? [`\tnot requirement_met(${requiresArg})`] : [];

  L.push(`# ─── § Lowering 1 — the output contract ────────────────────────────────────`);
  L.push(``);
  if (isRegex) {
    L.push(`# § Lowering 1: regex ordinal is ALWAYS 0 — the shipped regex path emits at`);
    L.push(`# most one violation per added line (worker.ts:53-62).`);
    L.push(`target_hit(i) if {`);
    L.push(`\tregex.match(${target!.literal}, input.lines[i])`);
    L.push(`}`);
    L.push(``);
    L.push(`violations contains v if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome i, _ in input.lines`);
    L.push(`\ttarget_hit(i)`);
    L.push(`\tnot suppressed(i)`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\tv := {"rule_id": rule_id, "line_number": i + 1, "ordinal": 0}`);
    L.push(`}`);
    L.push(``);
    L.push(`events contains e if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome i, _ in input.lines`);
    L.push(`\ttarget_hit(i)`);
    L.push(`\tnot suppressed(i)`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\te := {"kind": "trigger", "line_number": i + 1, "ordinal": 0}`);
    L.push(`}`);
    L.push(``);
    L.push(`# (N2) REQUIRES IS CHECKED FIRST, then suppression — the shipped order on all`);
    L.push(`# three dispatchers (rule-engine.ts:689 before :701; apply-rules-bounded.ts:207`);
    L.push(`# before :233). A requires-SATISFIED match is therefore silent even when the`);
    L.push(`# line also carries a suppression marker: no violation and no event of any`);
    L.push(`# kind. LOWERING.md does not order the two, so the shipped order is followed.`);
    L.push(`events contains e if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome i, _ in input.lines`);
    L.push(`\ttarget_hit(i)`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\tsuppressed(i)`);
    L.push(`\te := {"kind": "suppress", "line_number": i + 1, "ordinal": 0}`);
    L.push(`}`);
  } else {
    L.push(`# § Lowering 1: ast-grep ordinal is the MATCH INDEX — the shipped ast path`);
    L.push(`# emits one violation per MATCH (rule-engine.ts:1074), so two matches on one`);
    L.push(`# line are two violations and the ordinal is what keeps both in the set.`);
    L.push(`#`);
    L.push(`# Tree matching stays ENGINE-NATIVE: \`input.astMatches\` is received as FACTS`);
    L.push(`# (LOWERING.md § Ownership boundary). Rego owns everything downstream of the`);
    L.push(`# match — scope, suppression, requires, emission — and nothing upstream.`);
    L.push(`violations contains v if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome j, m in input.astMatches`);
    L.push(`\tnot suppressed(j)`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\tv := {"rule_id": rule_id, "line_number": m.lineNumber, "ordinal": j}`);
    L.push(`}`);
    L.push(``);
    L.push(`events contains e if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome j, m in input.astMatches`);
    L.push(`\tnot suppressed(j)`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\te := {"kind": "trigger", "line_number": m.lineNumber, "ordinal": j}`);
    L.push(`}`);
    L.push(``);
    L.push(`# (N2) requires-first, then suppression — the shipped ast order`);
    L.push(`# (rule-engine.ts:1081 before :1109).`);
    L.push(`events contains e if {`);
    L.push(`\tin_scope`);
    L.push(`\tsome j, m in input.astMatches`);
    for (const g of requiresGuard) L.push(g);
    L.push(`\tsuppressed(j)`);
    L.push(`\te := {"kind": "suppress", "line_number": m.lineNumber, "ordinal": j}`);
    L.push(`}`);
  }
  L.push(``);
  L.push(`# The entrypoint. A COMPLETE rule guarded on the two structural probes, so`);
  L.push(`# any builtin error or malformed bundle leaves it UNDEFINED and the host sees`);
  L.push(`# an empty result SET — which it must raise as an error, never read as a`);
  L.push(`# zero-violation verdict (§ Lowering 2, and the Host contract's strictness).`);
  L.push(`result := {"violations": violations, "events": events} if {`);
  L.push(`\tpatterns_compile`);
  L.push(`\tfacts_wellformed`);
  L.push(`}`);
  L.push(``);
  return L.join('\n');
}

// ─── Scope probes (§ Lowering 5's fidelity assertion) ────────────────────────

/**
 * Paths chosen to exercise the profile's edges, not just the happy path: root vs
 * nested (`barePatternMatchesBasename: false`), an excluded extension, a
 * `.claude/**\/*` subtree, a Windows-separator spelling, and a path that matches a
 * positive AND an exclude (the two-array rule's whole point).
 *
 * The shared list is per RECORD SET (`src/lib/record-sets.mts`): the specimens list
 * is frozen because it is serialised into each `globs.json`, whose sha256 is a
 * component of the chain's `regoSha256`; the seed set appends its own probes so
 * every seed glob has a matching and a non-matching path (G2).
 */
function probePaths(s: RecordRow): string[] {
  const base = [s.inlineFilePath, ...sharedProbePaths(activeRecordSet())];
  if (s.fixture) base.push(s.fixture.file);
  return [...new Set(base)];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCore();

  const schemaLine = factSchemaLine();
  checks.check(
    'FactBundle schema line lifted VERBATIM from LOWERING.md § Input contract (never retyped)',
    schemaLine.startsWith('input = { file, fileText: string|null, lines: [string], astMatches:'),
    schemaLine,
  );

  // (N1) which rule ids collide across the loaded records — MEASURED against the
  // set's own declaration, so neither side is derived from the other.
  const recordSet = activeRecordSet();
  const loadedRows = loadRecordSet(recordSet);
  const sharedIds = measuredSharedIds(loadedRows);
  checks.eq(sharedIdCheckName(recordSet), sharedIds, [...DECLARED_TWINNED_IDS[recordSet]]);

  // (G6) the § Lowering 3 assert reads raw-string SYNTAX. Proven BOTH ways on
  // synthetic lines before any policy is tested with it — an assert that could not
  // fire, or that fired on quoted data, would say nothing about the emitted code.
  const rawControl = 'x := `raw`';
  const quotedBacktickControl = 'x := "a`b"';
  const escapedQuoteControl = 'x := "a\\"`b"';
  checks.check(
    'CONTROL (§ Lowering 3) — the backtick assert tests raw-string SYNTAX: a genuine RAW literal is flagged, a backtick INSIDE a double-quoted literal is not, and `\\"` does not end the literal early',
    stripRegoStringLiterals(rawControl).includes('`') &&
      !stripRegoStringLiterals(quotedBacktickControl).includes('`') &&
      !stripRegoStringLiterals(escapedQuoteControl).includes('`'),
    `raw=${JSON.stringify(stripRegoStringLiterals(rawControl))} quoted=${JSON.stringify(stripRegoStringLiterals(quotedBacktickControl))} escaped=${JSON.stringify(stripRegoStringLiterals(escapedQuoteControl))}`,
  );

  // (G3) intake: parse + shipped-compile + the § Lowering 4 gate, ONCE. On the
  // specimens set a rejection still throws; on the seed set it is a reject ROW and
  // the run continues without that record — no policy, no bundle, no chain.
  const intake = intakeRecordSet(core);
  const recordRejects = intake.rejects;

  fs.rmSync(REGO_BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(REGO_BUILD_DIR, { recursive: true });
  // G7's publication surface is rebuilt from scratch, so what is on disk after a
  // run is exactly what this run lowered.
  fs.rmSync(LOWERED_PUBLISH_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOWERED_PUBLISH_DIR, { recursive: true });

  const lowered: LoweredRecord[] = [];

  for (const row of intake.rows) {
    const s = row.specimen;
    const rule = (row.compiled?.rule ?? {}) as Record<string, any>;

    if (row.compiled && row.compiled.engine !== 'regex') {
      checks.eq(
        `${s.id} — ast-grep record carries an EMPTY \`pattern\` (tree matching is a FACT, not a regex)`,
        rule.pattern,
        '',
      );
    }
    if (row.compiled) {
      const refused = row.patterns.filter((p) => !p.lowered);
      if (refused.length === 0) {
        checks.check(
          `${s.id} — every pattern lowers (§ Lowering 4 gate)`,
          true,
          row.patterns.map((p) => `${p.role}:${p.class}`).join(', ') || '(no regex patterns)',
        );
      } else {
        // (§ G3) A § Lowering 4 refusal is a SCORED ROW, not a failed check —
        // apparatus health is not a record verdict. The typed row is already in
        // `intake.rejects`; this line only makes it visible in `checks[]`.
        // On the `specimens` set the intake THROWS before reaching here, so the
        // old fail-loud behaviour on that set is untouched.
        checks.check(
          `${s.id} — REJECT ROW (target-lowering): a pattern is RE2-inexpressible, so no policy is emitted (§ Lowering 4)`,
          true,
          refused.map((p) => `${p.role} REJECTED (${p.class})`).join('; '),
        );
      }
    }
    // A REJECT ROW is not a failed check (apparatus health ≠ record verdict): the
    // row was already recorded by the intake, and the record is simply not lowered.
    if (row.status === 'rejected' || !row.compiled) continue;

    const cs = row.compiled;
    const patterns = row.patterns;
    const shared = DECLARED_TWINNED_IDS[recordSet].includes(rule.lessonHash as string);
    const pkgSuffix = packageSuffix(rule.lessonHash, s.packageDiscriminator, shared);
    const packageName = `totem.spike.${pkgSuffix}`;
    const dir = path.join(REGO_BUILD_DIR, pkgSuffix);

    // ── § Lowering 5 — globs → anchored regexes ──
    const globTable: GlobRow[] = [];
    for (const g of (rule.fileGlobs ?? []) as string[]) {
      const regex = globToRegexSource(g);
      assertRe2SafeGlobSource(g, regex);
      globTable.push({ kind: 'fileGlobs', glob: g, regex });
    }
    for (const g of (rule.excludeGlobs ?? []) as string[]) {
      const regex = globToRegexSource(g);
      assertRe2SafeGlobSource(g, regex);
      globTable.push({ kind: 'excludeGlobs', glob: g, regex });
    }

    const rec: LoweredRecord = {
      specimen: s.id,
      seedEntry: s.seedEntry,
      ruleId: rule.lessonHash,
      pkgSuffix,
      packageName,
      entrypoint: `totem/spike/${pkgSuffix}/result`,
      engine: cs.engine,
      dir,
      regoPath: path.join(dir, 'policy.rego'),
      globsPath: path.join(dir, 'globs.json'),
      patterns,
      globTable,
    };

    // ── § Lowering 5's fidelity assertion — scope-probe parity, per glob AND
    //    on the whole two-array predicate, against the SHIPPED matchers ──
    const perGlob: { glob: string; path: string; mine: boolean; shipped: boolean }[] = [];
    const scopeProbes: { path: string; mine: boolean; shipped: boolean }[] = [];
    for (const p of probePaths(s)) {
      const norm = normalizePath(p);
      for (const gr of globTable) {
        const mine = new RegExp(gr.regex).test(norm);
        // `matchesRecordGlob` is not on the dist barrel; `recordScopeMatchesFile`
        // with ONE positive glob and no excludes is exactly it
        // (`record-runtime.ts:208-211`) and IS exported.
        const shipped = core.recordScopeMatchesFile(p, [gr.glob], undefined) as boolean;
        perGlob.push({ glob: gr.glob, path: p, mine, shipped });
      }
      const positive = globTable
        .filter((r) => r.kind === 'fileGlobs')
        .some((r) => new RegExp(r.regex).test(norm));
      const excluded = globTable
        .filter((r) => r.kind === 'excludeGlobs')
        .some((r) => new RegExp(r.regex).test(norm));
      scopeProbes.push({
        path: p,
        mine: positive && !excluded,
        shipped: core.ruleAppliesToFile(cs.rule, p) as boolean,
      });
    }
    const globDrift = perGlob.filter((r) => r.mine !== r.shipped);
    checks.check(
      `${s.id} — per-glob parity with \`matchesRecordGlob\` over ${probePaths(s).length} probe paths`,
      globDrift.length === 0,
      globDrift.length === 0
        ? `${perGlob.length} (glob × path) probes agree`
        : globDrift
            .map((d) => `${d.glob} vs ${d.path}: mine=${d.mine} shipped=${d.shipped}`)
            .join('; '),
    );
    const scopeDrift = scopeProbes.filter((r) => r.mine !== r.shipped);
    checks.check(
      `${s.id} — two-array scope parity with \`ruleAppliesToFile\` (§ Design 7 positiveMatch && !excludeMatch)`,
      scopeDrift.length === 0,
      scopeDrift.length === 0
        ? `${scopeProbes.length} paths agree (${scopeProbes.filter((p) => p.mine).length} in scope)`
        : scopeDrift.map((d) => `${d.path}: mine=${d.mine} shipped=${d.shipped}`).join('; '),
    );
    // A vacuously-true parity check (everything out of scope) would prove nothing.
    checks.check(
      `${s.id} — the probe set is DISCRIMINATING (at least one path in scope and one out)`,
      scopeProbes.some((p) => p.shipped) && scopeProbes.some((p) => !p.shipped),
      `${scopeProbes.filter((p) => p.shipped).length} in / ${scopeProbes.filter((p) => !p.shipped).length} out`,
    );
    // (G2) The seed set additionally requires PER-GLOB discrimination: a glob no
    // probe path matches is a glob whose lowering nothing checked. Asserted only on
    // the seed set — the specimens probe list is frozen (it is a chain component),
    // so adding this row there would move committed evidence for no new coverage.
    if (recordSet === 'seed20') {
      const perGlobCoverage = globTable.map((gr) => {
        const re = new RegExp(gr.regex);
        const matching = scopeProbes.filter((p) => re.test(normalizePath(p.path))).length;
        return { glob: gr.glob, matching, nonMatching: scopeProbes.length - matching };
      });
      const blind = perGlobCoverage.filter((c) => c.matching === 0 || c.nonMatching === 0);
      checks.check(
        `${s.id} — every glob is DISCRIMINATING over the shared probe set (≥1 matching AND ≥1 non-matching path)`,
        blind.length === 0,
        blind.length === 0
          ? perGlobCoverage.map((c) => `${c.glob}:${c.matching}/${c.nonMatching}`).join(', ')
          : blind
              .map((c) => `${c.glob}: ${c.matching} matching, ${c.nonMatching} non-matching`)
              .join('; '),
      );
    }

    // ── emit ──
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(rec.regoPath, emitPolicy(cs, rec), 'utf-8');
    fs.writeFileSync(
      rec.globsPath,
      `${JSON.stringify(
        {
          generatedBy: 'spikes/spine-adopt/src/lower.mts',
          contract: 'spikes/spine-adopt/rego/LOWERING.md § Lowering 5',
          profile:
            '§ Design 7 record dialect — packages/core/src/sys/glob.ts RECORD_DIALECT_PROFILE (barePatternMatchesBasename:false, starActivation:all, optionalSyntax:{}, crossSegmentWildcard:".*", normalizePatternSeparators:false, case-SENSITIVE)',
          ruleId: rec.ruleId,
          specimen: rec.specimen,
          package: rec.packageName,
          table: globTable,
          scopeProbes,
          perGlobProbes: perGlob,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );

    // ── G7 — PUBLISH the lowering beside the artifacts ──
    //
    // A copy of the bytes that were just written, never a re-emission: publishing a
    // second rendering would let the audited policy drift from the one whose sha256
    // the chain binds.
    const publishDir = path.join(LOWERED_PUBLISH_DIR, pkgSuffix);
    fs.mkdirSync(publishDir, { recursive: true });
    fs.copyFileSync(rec.regoPath, path.join(publishDir, 'policy.rego'));
    fs.copyFileSync(rec.globsPath, path.join(publishDir, 'globs.json'));

    // § Lowering 3, asserted on the BYTES that were written rather than on intent.
    // Comment lines are excluded — the emitted prose quotes Rego and regex syntax
    // in backticks, and only CODE can carry a raw-string literal. Every generated
    // comment is a whole line beginning `#`, so the split is exact.
    //
    // (G6) Within the code lines the test is on SYNTAX: double-quoted string
    // literals are stripped first, so a backtick carried as DATA inside a pattern
    // literal — `5da43ea6` has one, inside a character class — is not mistaken for a
    // RAW string literal, which is the only thing § Lowering 3 forbids.
    const emitted = fs.readFileSync(rec.regoPath, 'utf-8');
    const codeLines = emitted.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const codeOutsideStringLiterals = codeLines.map(stripRegoStringLiterals).join('\n');
    checks.check(
      `${s.id} — no RAW (backtick) string literal in the emitted policy CODE (§ Lowering 3)`,
      !codeOutsideStringLiterals.includes('`'),
      `${codeLines.length} code lines / ${emitted.length} bytes`,
    );
    if (cs.engine === 'regex') {
      const p = patterns.find((x) => x.role === 'target')!;
      checks.check(
        `${s.id} — the target pattern is present as a JSON-ESCAPED literal, never verbatim (§ Lowering 3)`,
        emitted.includes(p.literal!) &&
          (!p.pattern.includes('\\') || p.literal !== `"${p.pattern}"`),
        `${p.literal!.slice(0, 60)}…`,
      );
    }

    lowered.push(rec);
  }

  // The cardinality is DERIVED from the loaded set minus its reject rows, never a
  // literal: a set of any size holds the same invariant, and a stale literal would
  // name itself rather than the record that went missing.
  const expectedLowered = loadedRows.length - recordRejects.length;
  checks.eq(
    `${expectedLowered} records lowered, one policy package each (§ Lowering 1)`,
    lowered.length,
    expectedLowered,
  );
  checks.eq(
    'package names are UNIQUE (the N1 collision is resolved, not papered over)',
    new Set(lowered.map((l) => l.packageName)).size,
    expectedLowered,
  );
  if (recordRejects.length > 0) {
    // A reject row is DATA the scorer reads, not a failed check — apparatus health
    // is not a record verdict (§ G3). Recorded as an always-true row so the run's
    // reject set is visible in `checks[]` without reddening the apparatus.
    checks.check(
      `REJECT ROWS — ${recordRejects.length} record(s) did not lower; the run continued and emitted no bundle or chain for them`,
      true,
      recordRejects
        .map((r) => `${r.recordId} [${r.stage}${r.class ? `/${r.class}` : ''}]`)
        .join('; '),
    );
  }

  // ── § Lowering 4's reject path, EXERCISED on the two evidence-row patterns ──
  //
  // Read from the corpora rather than retyped, so a REJECT row can never be an
  // artefact of a mistyped pattern (spec § Expressibility evidence rows).
  const census = JSON.parse(
    fs.readFileSync(path.join(SPIKE_ROOT, 'artifacts', 'expressibility-census.json'), 'utf-8'),
  ) as { rules: { ruleHash: string; corpus: string; class: string; pattern: string }[] };

  const evidenceIds = ['bddfbd2ec1c75eaf', '80192e6ac2a1dd3c'] as const;
  const rejects = evidenceIds.map((id) => {
    const row = census.rules.find((r) => r.ruleHash === id);
    if (!row) throw new Error(`evidence-row pattern ${id} is not in the census artifact`);
    const verdict = lowerPattern(`evidence-row:${id}`, row.pattern);
    return {
      ruleHash: id,
      corpus: row.corpus,
      censusClass: row.class,
      pattern: row.pattern,
      verdict,
      policyEmitted: false,
      policyPath: null,
    };
  });

  for (const r of rejects) {
    checks.check(
      `REJECT ROW — ${r.ruleHash} (${r.censusClass}) is REJECTED by the lowerer, never approximated`,
      r.verdict.lowered === false && r.verdict.literal === null,
      r.verdict.reason ?? `LOWERED (class=${r.verdict.class}) — the gate did not fire`,
    );
    checks.eq(
      `REJECT ROW — ${r.ruleHash}: the lowerer's class agrees with the census`,
      r.verdict.class,
      r.censusClass,
    );
  }
  checks.check(
    'REJECT ROW — the lookbehind row is classed `lookaround` and the backreference row `backreference`',
    rejects[0]!.verdict.class === 'lookaround' && rejects[1]!.verdict.class === 'backreference',
    `${rejects[0]!.verdict.class} / ${rejects[1]!.verdict.class}`,
  );

  // "…never policy files": asserted against the BUILD TREE, not against intent.
  const builtDirs = fs.readdirSync(REGO_BUILD_DIR).sort();
  checks.eq(
    'REJECT ROW — no policy directory was written for either rejected pattern',
    builtDirs.filter((d) => evidenceIds.some((id) => d.includes(id))),
    [],
  );
  checks.eq(
    `the build tree holds EXACTLY the ${lowered.length} lowered packages`,
    builtDirs,
    lowered.map((l) => l.pkgSuffix).sort(),
  );
  // (G7) and the PUBLISHED tree holds exactly the same set, so an audit reading
  // `artifacts/lowered/` is reading the run's whole lowering, not a subset of it.
  checks.eq(
    `the published tree \`artifacts/lowered/\` holds EXACTLY the same ${lowered.length} packages`,
    fs.readdirSync(LOWERED_PUBLISH_DIR).sort(),
    lowered.map((l) => l.pkgSuffix).sort(),
  );
  checks.eq(
    '(G7) every published policy.rego is BYTE-IDENTICAL to the one whose sha256 the chain binds',
    lowered
      .filter(
        (l) =>
          fs.readFileSync(path.join(LOWERED_PUBLISH_DIR, l.pkgSuffix, 'policy.rego'), 'utf-8') !==
          fs.readFileSync(l.regoPath, 'utf-8'),
      )
      .map((l) => l.pkgSuffix),
    [],
  );
  for (const l of lowered) {
    checks.check(
      `${l.specimen} — policy.rego + globs.json both written`,
      fs.existsSync(l.regoPath) && fs.existsSync(l.globsPath),
      path.relative(SPIKE_ROOT, l.dir).split(path.sep).join('/'),
    );
  }

  // (N2)/(N4) reachability, MEASURED against the run's own fact bundles rather than
  // asserted from a remembered count. Both notes claim the ordering/marker gap is
  // unreachable; that claim is only worth the measurement behind it, and the number
  // of bundles is a property of the record set, not a constant.
  const factsDir = path.join(SPIKE_ROOT, 'artifacts', 'facts');
  const factBundleFiles = fs.existsSync(factsDir)
    ? fs.readdirSync(factsDir).filter((f) => f.endsWith('.json'))
    : [];
  const markerBearing = factBundleFiles.filter((f) => {
    const rec = JSON.parse(fs.readFileSync(path.join(factsDir, f), 'utf-8')) as {
      factBundle: { lines: unknown[] };
    };
    return rec.factBundle.lines.some(
      (l) =>
        typeof l === 'string' &&
        [...SAME_LINE_MARKERS, ...PRECEDING_LINE_MARKERS].some((m) => l.includes(m)),
    );
  });
  const reachability =
    markerBearing.length === 0
      ? `Unreachable on all ${factBundleFiles.length} fact bundles (none carries a suppression marker)`
      : `Reachable: ${markerBearing.length} of ${factBundleFiles.length} fact bundles carry a suppression marker (${markerBearing.join(', ')})`;

  const out = writeArtifact('lowering-rejects.json', {
    generatedBy: 'spikes/spine-adopt/src/lower.mts',
    contract: 'spikes/spine-adopt/rego/LOWERING.md',
    factSchemaLine: schemaLine,
    contractNotes: [
      {
        id: 'N1',
        clause: '§ Lowering 1 — "One package per record … `totem.spike.r<ruleId>`"',
        finding:
          recordSet === 'seed20'
            ? '`r<ruleId>` is NOT unique across the 22 seed records: `6b1890e2` and `71935fe9` each carry TWO records (a `language: typescript` original and a `language: javascript` twin) under ONE `curation.sourceLesson`, so both records of each twinned rule compile under the same lessonHash. "One package per record" and "r<ruleId>" cannot both hold.'
            : '`r<ruleId>` is NOT unique across the 7 records: d-line, d-file and e all carry the pinned exemplar id 0123456789abcdef. "One package per record" and "r<ruleId>" cannot both hold.',
        resolution:
          recordSet === 'seed20'
            ? 'The SEMANTIC half (one policy per record) is unambiguous in both the spec and LOWERING.md, so the naming gives. The CHARTER fixes the seed form: `totem.spike.r<lessonHash>_<language>` for BOTH records of a twinned rule, `totem.spike.r<lessonHash>` for a single-record rule. The discriminator is the record`s declared `target.language`, and the twinned ids are DECLARED by the record set (`src/lib/record-sets.mts` DECLARED_TWINNED_IDS) rather than inferred from which records happened to lower — a twin that failed to lower must not silently un-suffix its surviving sibling.'
            : 'The SEMANTIC half (one policy per record) is unambiguous in both the spec and LOWERING.md, so the naming gives: a colliding id takes a `_<specimen>` suffix; a unique id stays exactly on-contract. FLAGGED for the dispatching seat — this is a naming decision, reversible in one place (`packageSuffix`).',
        affected: loadedRows.filter((s) => sharedIds.includes(s.ruleId)).map((s) => s.id),
      },
      {
        id: 'N2',
        clause: '§ Lowering 6 vs § Lowering 7',
        finding:
          'The contract does not order the suppression check against the requires check. A match that is BOTH suppressed and requires-satisfied could emit `suppress` or emit nothing.',
        resolution: `MEASURED in the shipped source: all three dispatchers check \`requires\` FIRST and \`continue\` before any \`onRuleEvent\` call — rule-engine.ts:689 (sync regex) before :701, apply-rules-bounded.ts:207 (bounded regex) before :233, rule-engine.ts:1081 (ast-grep) before :1109. The lowering follows the shipped order, so a requires-satisfied match is silent even when the line carries a marker. ${reachability}, so it changes no differential row.`,
        affected: [],
      },
      {
        id: 'N4',
        clause: '§ Lowering 7 — "or preceding-line `totem-ignore-next-line`/`totem-context:`"',
        finding:
          "The contract's PRECEDING-line marker set is one marker short of the shipped runtime. `isSuppressed` (rule-engine.ts:384-388) routes the preceding line through `hasContextDirective` (:349-356), which accepts `shield-context:` as well as `totem-context:`. The same-line set in the contract is exact (rule-engine.ts:377-381); only the preceding anchor diverges.",
        resolution: `Built to the CONTRACT verbatim — the lowered policies do NOT treat a preceding-line \`shield-context:\` as suppressing. Widening it to match the runtime would reproduce a semantic LOWERING.md does not state. ${reachability}. FLAGGED for the dispatching seat: this is a one-word amendment to § Lowering 7 if fidelity is wanted.`,
        affected: [],
      },
      {
        id: 'N3',
        clause: '§ Lowering 2 — "Strict always … the host must surface builtin errors as errors"',
        finding:
          'MEASURED: an OPA WASM module has no `--strict-builtin-errors` equivalent. `opa build -t wasm` accepts a lookahead pattern (exit 0, a 328 KB module); the failure surfaces only at EVAL, as an UNDEFINED rule — the entrypoint returns `[]` with no trap and no `opa_abort`.',
        resolution:
          'Strictness is made STRUCTURAL in the lowering instead: every emitted pattern is exercised by `patterns_compile` inside the COMPLETE `result` rule, so a compile failure leaves `result` undefined and the host reads an empty result SET as an ERROR ROW. Recorded as a first-order ABI finding, not worked around silently.',
        affected: [],
      },
    ],
    // The two census EVIDENCE rejects keep their shape and their position (§ G3);
    // the per-record reject rows are appended, typed by the STAGE that refused them.
    rejects: [...rejects, ...recordRejects],
    lowered: lowered.map((l) => ({
      specimen: l.specimen,
      seedEntry: l.seedEntry,
      ruleId: l.ruleId,
      package: l.packageName,
      entrypoint: l.entrypoint,
      engine: l.engine,
      dir: path.relative(SPIKE_ROOT, l.dir).split(path.sep).join('/'),
      published: `artifacts/lowered/${l.pkgSuffix}`,
      patterns: l.patterns,
      globCount: l.globTable.length,
    })),
    checks: checks.rows,
  });

  console.log(`\n${lowered.length} policies -> ${path.relative(SPIKE_ROOT, REGO_BUILD_DIR)}`);
  console.log(`${lowered.length} policies published -> artifacts/lowered/`);
  console.log(
    `${rejects.length + recordRejects.length} reject rows (${rejects.length} census evidence, ${recordRejects.length} record) -> ${out}`,
  );
  checks.finish('lower');
}

await main();
