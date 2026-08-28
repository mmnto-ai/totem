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

import { classify, scanPattern, type ExpressibilityClass } from './lib/expressibility.mts';
import { compileSpecimen, loadCore, type CompiledSpecimen } from './lib/records.mts';
import { Checks, SPIKE_ROOT, writeArtifact } from './lib/spike-env.mts';
import { SPECIMENS, type Specimen } from './lib/specimens.mts';

export const REGO_DIR = path.join(SPIKE_ROOT, 'rego');
export const REGO_BUILD_DIR = path.join(REGO_DIR, 'build');
export const LOWERING_MD = path.join(REGO_DIR, 'LOWERING.md');

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

export interface PatternVerdict {
  role: string;
  pattern: string;
  class: ExpressibilityClass;
  lowered: boolean;
  /** The Rego source literal, or null on a REJECT. */
  literal: string | null;
  reason: string | null;
}

/**
 * § Lowering 4 + § Lowering 3 in one place. `re2-clean` and `word-boundary` lower
 * to a JSON-escaped DOUBLE-QUOTED literal (`JSON.stringify`, the contract's named
 * `json.Marshal`-equivalent); `lookaround` and `backreference` are compile-loud
 * REJECT rows and produce no literal at all.
 *
 * The double-quoted form is what makes the 17 backtick-bearing corpus patterns
 * representable — a Rego RAW string has no escape mechanism — and `JSON.stringify`
 * re-escapes every backslash, so `\b` reaches RE2 as a word boundary instead of
 * the U+0008 the census measured a verbatim emission to produce.
 */
export function lowerPattern(role: string, pattern: string): PatternVerdict {
  const cls = classify(scanPattern(pattern));
  if (cls === 'lookaround' || cls === 'backreference') {
    return {
      role,
      pattern,
      class: cls,
      lowered: false,
      literal: null,
      reason:
        cls === 'lookaround'
          ? 'RE2 rejects lookaround AT COMPILE ("invalid or unsupported Perl syntax: `(?!`" / "invalid named capture"); § Lowering 4 forbids an approximation.'
          : 'RE2 rejects backreferences AT COMPILE ("invalid escape sequence: `\\1`"); § Lowering 4 forbids an approximation.',
    };
  }
  return { role, pattern, class: cls, lowered: true, literal: JSON.stringify(pattern), reason: null };
}

// ─── § Lowering 1 — the package name ─────────────────────────────────────────

/**
 * (N1) `r<ruleId>` where the id is unique among the lowered records; a
 * `_<specimen>` suffix where it is not. Three records share `0123456789abcdef`.
 */
export function packageSuffix(ruleId: string, specimenId: string, shared: boolean): string {
  return shared ? `r${ruleId}_${specimenId.replace(/-/g, '_')}` : `r${ruleId}`;
}

// ─── The emitter ─────────────────────────────────────────────────────────────

interface LoweredRecord {
  specimen: string;
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
  L.push(`\tcount([1 | some m in input.astMatches; ast_match_wellformed(m)]) == count(input.astMatches)`);
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

  const requiresGuard = requires && req?.literal ? [`\tnot requirement_met(${isRegex ? 'i' : 'j'})`] : [];

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
 */
function probePaths(s: Specimen): string[] {
  const base = [
    s.inlineFilePath,
    'scripts/deploy.sh',
    'deploy.sh',
    'a/b/c/deploy.sh',
    'scripts/audit.ts',
    'audit.ts',
    'packages/core/src/a.ts',
    'packages/core/src/a.test.ts',
    'packages/core/src/a.spec.ts',
    'packages/src/example.ts',
    'src/example.sh',
    'scripts/x.sh',
    'deep/nest/x.cjs',
    'scripts/x.ts',
    '.claude/agents/foo.md',
    '.claude/x',
    '.totem/lessons.md',
    '.totem/lessons/lesson-cd27a5b0.md',
    '.totem/tests/test-x.md',
    'packages/cli/src/orchestrators/shell-orchestrator.ts',
    'packages\\core\\src\\a.ts',
    'notes.md',
    'README',
  ];
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

  // (N1) which rule ids collide across the 7 records.
  const idCounts = new Map<string, number>();
  for (const s of SPECIMENS) idCounts.set(s.ruleId, (idCounts.get(s.ruleId) ?? 0) + 1);
  const sharedIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  checks.eq(
    'CONTRACT NOTE (N1) — `r<ruleId>` is not unique: the pinned exemplar id is shared',
    sharedIds,
    ['0123456789abcdef'],
  );

  fs.rmSync(REGO_BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(REGO_BUILD_DIR, { recursive: true });

  const lowered: LoweredRecord[] = [];

  for (const s of SPECIMENS) {
    const cs = compileSpecimen(core, s);
    const rule = cs.rule as Record<string, any>;
    const shared = (idCounts.get(s.ruleId) ?? 0) > 1;
    const pkgSuffix = packageSuffix(rule.lessonHash, s.id, shared);
    const packageName = `totem.spike.${pkgSuffix}`;
    const dir = path.join(REGO_BUILD_DIR, pkgSuffix);

    // ── § Lowering 4 — the regex engine gate, on every pattern the record carries ──
    const patterns: PatternVerdict[] = [];
    if (cs.engine === 'regex') {
      patterns.push(lowerPattern('target', String(rule.pattern)));
    } else {
      checks.eq(
        `${s.id} — ast-grep record carries an EMPTY \`pattern\` (tree matching is a FACT, not a regex)`,
        rule.pattern,
        '',
      );
    }
    if (rule.requires) patterns.push(lowerPattern('requires', String(rule.requires.pattern)));

    const rejected = patterns.filter((p) => !p.lowered);
    checks.check(
      `${s.id} — every pattern lowers (§ Lowering 4 gate)`,
      rejected.length === 0,
      rejected.length === 0
        ? patterns.map((p) => `${p.role}:${p.class}`).join(', ') || '(no regex patterns)'
        : rejected.map((p) => `${p.role} REJECTED (${p.class})`).join('; '),
    );
    if (rejected.length > 0) {
      throw new Error(
        `specimen ${s.id} carries an RE2-inexpressible pattern; the spec says all five specimens lower.`,
      );
    }

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
      for (const row of globTable) {
        const mine = new RegExp(row.regex).test(norm);
        // `matchesRecordGlob` is not on the dist barrel; `recordScopeMatchesFile`
        // with ONE positive glob and no excludes is exactly it
        // (`record-runtime.ts:208-211`) and IS exported.
        const shipped = core.recordScopeMatchesFile(p, [row.glob], undefined) as boolean;
        perGlob.push({ glob: row.glob, path: p, mine, shipped });
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
        : globDrift.map((d) => `${d.glob} vs ${d.path}: mine=${d.mine} shipped=${d.shipped}`).join('; '),
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

    // § Lowering 3, asserted on the BYTES that were written rather than on intent.
    // Comment lines are excluded — the emitted prose quotes Rego and regex syntax
    // in backticks, and only CODE can carry a raw-string literal. Every generated
    // comment is a whole line beginning `#`, so the split is exact.
    const emitted = fs.readFileSync(rec.regoPath, 'utf-8');
    const codeLines = emitted.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    checks.check(
      `${s.id} — no RAW (backtick) string literal in the emitted policy CODE (§ Lowering 3)`,
      !codeLines.join('\n').includes('`'),
      `${codeLines.length} code lines / ${emitted.length} bytes`,
    );
    if (cs.engine === 'regex') {
      const p = patterns.find((x) => x.role === 'target')!;
      checks.check(
        `${s.id} — the target pattern is present as a JSON-ESCAPED literal, never verbatim (§ Lowering 3)`,
        emitted.includes(p.literal!) && (!p.pattern.includes('\\') || p.literal !== `"${p.pattern}"`),
        `${p.literal!.slice(0, 60)}…`,
      );
    }

    lowered.push(rec);
  }

  checks.eq('7 records lowered, one policy package each (§ Lowering 1)', lowered.length, 7);
  checks.eq(
    'package names are UNIQUE (the N1 collision is resolved, not papered over)',
    new Set(lowered.map((l) => l.packageName)).size,
    7,
  );

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
    'the build tree holds EXACTLY the 7 lowered packages',
    builtDirs,
    lowered.map((l) => l.pkgSuffix).sort(),
  );
  for (const l of lowered) {
    checks.check(
      `${l.specimen} — policy.rego + globs.json both written`,
      fs.existsSync(l.regoPath) && fs.existsSync(l.globsPath),
      path.relative(SPIKE_ROOT, l.dir).split(path.sep).join('/'),
    );
  }

  const out = writeArtifact('lowering-rejects.json', {
    generatedBy: 'spikes/spine-adopt/src/lower.mts',
    contract: 'spikes/spine-adopt/rego/LOWERING.md',
    factSchemaLine: schemaLine,
    contractNotes: [
      {
        id: 'N1',
        clause: '§ Lowering 1 — "One package per record … `totem.spike.r<ruleId>`"',
        finding:
          '`r<ruleId>` is NOT unique across the 7 records: d-line, d-file and e all carry the pinned exemplar id 0123456789abcdef. "One package per record" and "r<ruleId>" cannot both hold.',
        resolution:
          'The SEMANTIC half (one policy per record) is unambiguous in both the spec and LOWERING.md, so the naming gives: a colliding id takes a `_<specimen>` suffix; a unique id stays exactly on-contract. FLAGGED for the dispatching seat — this is a naming decision, reversible in one place (`packageSuffix`).',
        affected: SPECIMENS.filter((s) => sharedIds.includes(s.ruleId)).map((s) => s.id),
      },
      {
        id: 'N2',
        clause: '§ Lowering 6 vs § Lowering 7',
        finding:
          'The contract does not order the suppression check against the requires check. A match that is BOTH suppressed and requires-satisfied could emit `suppress` or emit nothing.',
        resolution:
          'MEASURED in the shipped source: all three dispatchers check `requires` FIRST and `continue` before any `onRuleEvent` call — rule-engine.ts:689 (sync regex) before :701, apply-rules-bounded.ts:207 (bounded regex) before :233, rule-engine.ts:1081 (ast-grep) before :1109. The lowering follows the shipped order, so a requires-satisfied match is silent even when the line carries a marker. Unreachable on all 24 fact bundles (none carries a suppression marker), so it changes no differential row.',
        affected: [],
      },
      {
        id: 'N4',
        clause: '§ Lowering 7 — "or preceding-line `totem-ignore-next-line`/`totem-context:`"',
        finding:
          "The contract's PRECEDING-line marker set is one marker short of the shipped runtime. `isSuppressed` (rule-engine.ts:384-388) routes the preceding line through `hasContextDirective` (:349-356), which accepts `shield-context:` as well as `totem-context:`. The same-line set in the contract is exact (rule-engine.ts:377-381); only the preceding anchor diverges.",
        resolution:
          'Built to the CONTRACT verbatim — the lowered policies do NOT treat a preceding-line `shield-context:` as suppressing. Widening it to match the runtime would reproduce a semantic LOWERING.md does not state. Unreachable on all 24 fact bundles. FLAGGED for the dispatching seat: this is a one-word amendment to § Lowering 7 if fidelity is wanted.',
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
    rejects,
    lowered: lowered.map((l) => ({
      specimen: l.specimen,
      ruleId: l.ruleId,
      package: l.packageName,
      entrypoint: l.entrypoint,
      engine: l.engine,
      dir: path.relative(SPIKE_ROOT, l.dir).split(path.sep).join('/'),
      patterns: l.patterns,
      globCount: l.globTable.length,
    })),
    checks: checks.rows,
  });

  console.log(`\n${lowered.length} policies -> ${path.relative(SPIKE_ROOT, REGO_BUILD_DIR)}`);
  console.log(`${rejects.length} reject rows -> ${out}`);
  checks.finish('lower');
}

await main();
