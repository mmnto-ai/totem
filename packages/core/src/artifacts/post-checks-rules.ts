/**
 * The default deterministic post-check rule set (mmnto-ai/totem#2103, strategy#474
 * slice 4). Each rule is zero-LLM and returns a verdict at its STATIC tier; the
 * aggregator ({@link evaluatePostChecks}) owns rejection. Rule decomposition
 * follows the cohort pre-build round (codex): the OutputContract's three knobs
 * (`schema` / `citationsRequired` / `verifyFallback`) are distinct
 * responsibilities, not one rule.
 *
 * Helpers (containment, citation extraction, line-range) are exported for
 * direct unit testing — they are the load-bearing edge-case surface (agy).
 */

// `node:fs` is a STATIC import by design (CR #2177 review #3, declined): @mmnto/totem
// (core) is a Node package — native LanceDB + tree-sitter bindings — never an
// edge/Deno/browser target, so the module-load portability concern does not apply.
// The `readFile` seam exists for test injection, not runtime portability.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  type CheckResult,
  type PostCheckContext,
  type PostCheckRule,
  resolveCaller,
} from './post-checks.js';
import { PROVENANCE_CLASSES } from './schema.js';

const KNOWN_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|go|py|rs|java|c|cpp|h)$/i;
const CANONICAL_PROVENANCE: ReadonlySet<string> = new Set(PROVENANCE_CLASSES);

/** Default file read: returns the text, or `undefined` if the path does not resolve (honest-absent). */
function defaultReadFile(absPath: string): string | undefined {
  try {
    return readFileSync(absPath, 'utf8');
    // totem-context: honest-absent — undefined means "not found", consumed as a citation fail.
  } catch {
    return undefined;
  }
}

function readFileVia(ctx: PostCheckContext, absPath: string): string | undefined {
  return (ctx.readFile ?? defaultReadFile)(absPath);
}

/**
 * Is `citedPath` a relative path nested inside `configRoot`? Rejects absolute
 * paths and Windows drive-letters up front, normalizes separators BEFORE
 * resolving (win32: `src\..\..\etc/passwd` must not slip), then requires the
 * resolved path to stay under the root (agy review on mmnto-ai/totem#2103).
 */
export function isContained(configRoot: string, citedPath: string): boolean {
  if (path.isAbsolute(citedPath) || /^[a-zA-Z]:/.test(citedPath)) return false;
  // Normalize separators BEFORE resolving: on POSIX `\` is a literal filename
  // char, so `src\..\..\etc/passwd` would NOT get its `..` collapsed by
  // path.resolve and would escape the root undetected. Forward-slashing first
  // makes traversal detection identical on win32 and POSIX.
  const normalizedCited = citedPath.replace(/\\/g, '/');
  const root = path.resolve(configRoot);
  // path.join (NOT path.resolve) so a normalized-absolute segment can't reset the
  // base out of root (GCA review — absolute-path injection); then path.relative +
  // a FIRST-SEGMENT check (not startsWith, which would false-reject a `..foo` file)
  // and a cross-drive guard. No hardcoded separator → a filesystem-root config
  // never double-slashes into a false fail.
  const rel = path.relative(root, path.join(root, normalizedCited));
  return rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

/** A parsed citation token: the path plus an optional 1-indexed line or line range. */
export interface Citation {
  raw: string;
  filePath: string;
  line?: number;
  endLine?: number;
}

/**
 * Conservatively extract `path` / `path:line` / `path:start-end` citations from
 * backticked spans in `content`. Strips fenced code blocks first (their sample
 * paths / command logs would false-fail), and ignores backticked tokens that
 * carry neither a path separator nor a known extension — so `` `main` `` /
 * `` `pnpm test` `` are not treated as citations (agy review on mmnto-ai/totem#2103).
 */
export function extractCitations(content: string): Citation[] {
  const withoutFences = content.replace(/```[\s\S]*?```/g, '');
  const citations: Citation[] = [];
  for (const match of withoutFences.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    const parsed = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(token);
    if (parsed === null) continue;
    const filePath = parsed[1].replace(/\\/g, '/');
    // Skip URLs (CR review): a `https://…/x.ts` token has a separator + extension,
    // would fail containment, and would false-fail a spec that links external docs.
    if (/^https?:\/\//.test(filePath)) continue;
    if (!filePath.includes('/') && !KNOWN_EXTENSION.test(filePath)) {
      continue;
    }
    const citation: Citation = { raw: token, filePath };
    if (parsed[2] !== undefined) citation.line = Number(parsed[2]);
    if (parsed[3] !== undefined) citation.endLine = Number(parsed[3]);
    citations.push(citation);
  }
  return citations;
}

/**
 * Is a citation's line reference valid against a file of `totalLines` lines?
 * Path-only citations (no line) always pass the line check. 1-indexed; a range
 * requires `0 < start <= end <= totalLines` (agy boundary matrix).
 */
export function lineRefValid(totalLines: number, line?: number, endLine?: number): boolean {
  if (line === undefined) return true;
  if (!Number.isInteger(line) || line <= 0 || line > totalLines) return false;
  if (endLine !== undefined) {
    if (!Number.isInteger(endLine) || endLine < line || endLine > totalLines) return false;
  }
  return true;
}

function countLines(text: string): number {
  return text.split('\n').length;
}

// ── Rules ──────────────────────────────────────────────────────────────────

/**
 * Structured-output contract (decidable, all callers). Absent `schema` ⇒
 * abstain (prose output is never treated as malformed JSON). Present ⇒
 * `output.content` must parse as JSON; non-JSON is a decidable fail. NOTE: deep
 * JSON-Schema shape validation is a follow-on — core carries no validator
 * dependency this slice, so the gate is parse-only (codex review: "non-JSON is
 * a decidable fail").
 */
export const structuredOutputRule: PostCheckRule = {
  name: 'structured-output',
  tier: 'decidable',
  appliesTo: () => true,
  evaluate: (a): CheckResult => {
    if (a.admission?.outputContract?.schema === undefined) {
      return { verdict: 'abstain', message: 'no outputContract.schema declared' };
    }
    try {
      JSON.parse(a.output.content);
      return { verdict: 'pass', message: 'output parses as JSON (shape-validation deferred)' };
      // totem-context: fail-loud — a parse failure becomes a decidable 'fail' verdict, not a silent pass.
    } catch {
      return {
        verdict: 'fail',
        message: 'outputContract.schema declared but output.content is not valid JSON',
      };
    }
  },
};

/**
 * Citation resolution (decidable). Gates only when the caller declared
 * `citationsRequired`. For each cited path: must be in-root, the file must
 * exist, and any line reference must be in range. For a `review` run, a citation
 * outside the delivered grounding bundle is also a fail (review cites what it was
 * given). Claim *support* (does the cited text back the claim) stays sensor-only
 * — out of scope here (ADR-109).
 *
 * Intentional overlap (CR #2177 review): on a `spec` run with `citationsRequired`,
 * an unresolved path is ALSO flagged by spec-verify — both correctly fail it, so the
 * report can carry two decidable findings for one path. The rules are independent by
 * design (different escapes: spec-verify owns the `VERIFY:` fallback, this owns
 * line-range + bundle membership); de-duplicating overlapping decidable fails belongs
 * at the live-wiring / aggregation layer (#2104), not by coupling rules in this slice.
 */
export const citationResolvesRule: PostCheckRule = {
  name: 'citation-resolves',
  tier: 'decidable',
  appliesTo: () => true,
  evaluate: (a, ctx): CheckResult => {
    if (a.admission?.outputContract?.citationsRequired !== true) {
      return { verdict: 'abstain', message: 'citations not required by outputContract' };
    }
    const citations = extractCitations(a.output.content);
    if (citations.length === 0) {
      return { verdict: 'abstain', message: 'no resolvable path citations in output' };
    }
    const bundlePaths =
      resolveCaller(a) === 'review' && a.grounding.bundle !== undefined
        ? // normalize separators (GCA review): bundle filePaths may be win32 backslash,
          // cited filePaths are forward-slashed, so compare on a common separator.
          new Set(a.grounding.bundle.items.map((i) => i.filePath.replace(/\\/g, '/')))
        : undefined;
    const failures: string[] = [];
    for (const c of citations) {
      if (!isContained(ctx.configRoot, c.filePath)) {
        failures.push(`${c.raw} (escapes repo root)`);
        continue;
      }
      const text = readFileVia(ctx, path.resolve(ctx.configRoot, c.filePath));
      if (text === undefined) {
        failures.push(`${c.raw} (file not found)`);
        continue;
      }
      if (!lineRefValid(countLines(text), c.line, c.endLine)) {
        failures.push(`${c.raw} (line out of range)`);
        continue;
      }
      if (bundlePaths !== undefined && !bundlePaths.has(c.filePath)) {
        failures.push(`${c.raw} (not in delivered grounding bundle)`);
      }
    }
    if (failures.length === 0) {
      return { verdict: 'pass', message: `all ${citations.length} citations resolve` };
    }
    return {
      verdict: 'fail',
      message: `unresolvable citation(s): ${failures.join('; ')}`,
      context: { failures },
    };
  },
};

/**
 * Spec VERIFY requirement (decidable, caller `spec`). A spec that references a
 * path which does not resolve on disk must mark it with `VERIFY:` — otherwise it
 * is a fabricated path (the mmnto-ai/totem#2090/#2091 class). `VERIFY:` is accepted
 * as the escape UNLESS the caller set `outputContract.verifyFallback === false`
 * (the verify-fallback knob, folded here where `VERIFY:` is actually consumed —
 * codex review).
 */
export const specVerifyRule: PostCheckRule = {
  name: 'spec-verify',
  tier: 'decidable',
  appliesTo: (a) => resolveCaller(a) === 'spec',
  evaluate: (a, ctx): CheckResult => {
    const content = a.output.content;
    const citations = extractCitations(content);
    if (citations.length === 0) {
      return { verdict: 'abstain', message: 'no path citations in spec output' };
    }
    const unresolved = citations.filter((c) => {
      if (!isContained(ctx.configRoot, c.filePath)) return true;
      return readFileVia(ctx, path.resolve(ctx.configRoot, c.filePath)) === undefined;
    });
    if (unresolved.length === 0) {
      return { verdict: 'pass', message: `all ${citations.length} cited paths resolve` };
    }
    const verifyAllowed = a.admission?.outputContract?.verifyFallback !== false;
    // Strip fences before the marker search too (Greptile review) — a VERIFY: that
    // exists only inside a code block (which extractCitations already strips) must
    // not excuse unresolved paths the citation pass never saw.
    const hasVerifyMarker = /\bVERIFY:/.test(content.replace(/```[\s\S]*?```/g, ''));
    if (verifyAllowed && hasVerifyMarker) {
      return {
        verdict: 'pass',
        message: `${unresolved.length} unresolved path(s) but VERIFY: present`,
      };
    }
    const paths = unresolved.map((c) => c.filePath);
    return {
      verdict: 'fail',
      message: hasVerifyMarker
        ? `unresolved path(s) and verifyFallback is disabled: ${paths.join(', ')}`
        : `unresolved cited path(s) without VERIFY:: ${paths.join(', ')}`,
      context: { unresolved: paths },
    };
  },
};

/**
 * Override-memory reappearance (decidable, caller `review`). A finding the
 * operator dispositioned (rejected) must not reappear in a later review. The
 * anchored-span key format lives in the store (mmnto-ai/totem#2105); this rule only
 * asks the injected {@link OverrideSet} whether any reappears. Absent store ⇒
 * abstain (the rule no-ops until #2105 wires a store).
 */
export const overrideReappearanceRule: PostCheckRule = {
  name: 'override-reappearance',
  tier: 'decidable',
  appliesTo: (a) => resolveCaller(a) === 'review',
  evaluate: (a, ctx): CheckResult => {
    if (ctx.overrideMemory === undefined) {
      return { verdict: 'abstain', message: 'no override memory supplied (store lands in #2105)' };
    }
    const reappeared = ctx.overrideMemory.reappearsIn(a.output.content);
    if (reappeared.length === 0) {
      return { verdict: 'pass', message: 'no dispositioned overrides reappeared' };
    }
    return {
      verdict: 'fail',
      message: `dispositioned override(s) reappeared: ${reappeared.join(', ')}`,
      context: { reappeared: [...reappeared] },
    };
  },
};

/**
 * Provenance fail-safe-down sensor (SENSOR, all grounded runs; mmnto-ai/totem#2101
 * F2 rider, enforcement test rides #2103). A grounding item whose `provenance`
 * is not a canonical class is surfaced as NOT-upgraded (lowest trust). SENSOR
 * tier: it is telemetry and can NEVER gate — an invented class must not confer,
 * nor deny, trust by gating.
 */
export const provenanceSensorRule: PostCheckRule = {
  name: 'provenance-fail-safe-down',
  tier: 'sensor',
  appliesTo: (a) => a.grounding.bundle !== undefined,
  evaluate: (a): CheckResult => {
    const items = a.grounding.bundle?.items ?? [];
    const unknown = [
      ...new Set(items.map((i) => i.provenance).filter((p) => !CANONICAL_PROVENANCE.has(p))),
    ];
    if (unknown.length === 0) {
      return { verdict: 'pass', message: 'all provenance classes canonical' };
    }
    return {
      verdict: 'fail',
      message: `non-canonical provenance treated as not-upgraded: ${unknown.join(', ')}`,
      context: { unknown },
    };
  },
};

/** The default rule set, in execution order. */
export const DEFAULT_RULES: readonly PostCheckRule[] = [
  structuredOutputRule,
  citationResolvesRule,
  specVerifyRule,
  overrideReappearanceRule,
  provenanceSensorRule,
];
