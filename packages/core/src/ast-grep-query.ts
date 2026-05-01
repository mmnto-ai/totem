import type { NapiConfig } from '@ast-grep/napi';
import { Lang, parse } from '@ast-grep/napi';

import { extensionToLanguage } from './ast-classifier.js';
import { rethrowAsParseError } from './errors.js';

// ─── Types ──────────────────────────────────────────

/** ast-grep pattern: either a simple string or a full NapiConfig rule object */
export type AstGrepRule = string | NapiConfig;

export interface AstGrepMatch {
  lineNumber: number;
  lineText: string;
}

// ─── Constants ──────────────────────────────────────

const AST_GREP_HINT =
  'Check the rule pattern syntax. If valid, the source file may contain syntax that crashes the parser.';

// ─── Language mapping ───────────────────────────────

/**
 * Map our `SupportedLanguage` string (e.g., `'typescript'`) to the
 * ast-grep `Lang` enum value (e.g., `Lang.TypeScript`). Built-in mappings
 * only — pack-contributed languages flow through as their SupportedLanguage
 * string, which `@ast-grep/napi` accepts as a `CustomLang` string per
 * its `NapiLang = Lang | (string & {})` type. Pack registration is
 * expected to also register a dynamic language with `@ast-grep/napi`'s
 * `registerDynamicLanguage()` API for the same string to flow end-to-end.
 */
function supportedLanguageToNapiLang(lang: string): Lang | string {
  switch (lang) {
    case 'typescript':
      return Lang.TypeScript;
    case 'tsx':
      return Lang.Tsx;
    case 'javascript':
      return Lang.JavaScript;
    default:
      // Pack-contributed language — pass the string through. Caller passes
      // it to `parse(napiLang, source)` which accepts CustomLang strings.
      return lang;
  }
}

/**
 * Map a file extension to the ast-grep dispatch language label. Registry-
 * backed via `extensionToLanguage` from ast-classifier.ts (mmnto-ai/totem#1653,
 * #1654) — built-in extensions map to napi `Lang` enum values; pack-
 * registered extensions map to their NapiLang custom string per
 * ADR-097 § 10.
 */
export function extensionToLang(ext: string): Lang | string | undefined {
  const supported = extensionToLanguage(ext);
  if (!supported) return undefined;
  return supportedLanguageToNapiLang(supported);
}

/** Trailing-extension capture (`/foo/bar.rs` → `rs`). */
const TRAILING_EXT_RE = /\.([a-zA-Z0-9]+)$/;

/**
 * Resolve the ast-grep Lang dispatch list for a rule's `fileGlobs`. Used by
 * the compile-time pattern validator (`validateAstGrepPattern`) to parse
 * the pattern under the rule's actual target grammar instead of always
 * defaulting to TSX (mmnto-ai/totem#1654).
 *
 * Returns the deduplicated list of registered Lang values mapped from each
 * positive glob's trailing extension. Negation globs are skipped (they
 * describe files the rule should NOT match). When no positive glob carries
 * a registered extension — including the unscoped-rule case where
 * `fileGlobs` is undefined or empty — falls back to `[Lang.Tsx]` to
 * preserve the legacy permissive-default behavior. Lang.Tsx remains the
 * "unscoped" parser because it is the broadest TS/JS superset and many
 * pre-1.16 rules ship without globs.
 */
export function resolveAstGrepLangs(fileGlobs?: readonly string[]): (Lang | string)[] {
  if (!fileGlobs || fileGlobs.length === 0) return [Lang.Tsx];

  const seen = new Set<string>();
  const langs: (Lang | string)[] = [];
  for (const glob of fileGlobs) {
    if (glob.startsWith('!')) continue;
    const match = glob.match(TRAILING_EXT_RE);
    if (!match) continue;
    const ext = `.${match[1]!.toLowerCase()}`;
    const lang = extensionToLang(ext);
    if (lang === undefined) continue;
    const key = String(lang);
    if (seen.has(key)) continue;
    seen.add(key);
    langs.push(lang);
  }

  return langs.length > 0 ? langs : [Lang.Tsx];
}

// ─── Core matching ──────────────────────────────────

/**
 * Per-rule failure sink. Invoked when `findAll` throws inside a batch. The
 * index is the position of the failing query in the original input array so
 * the caller can map the failure back to a `CompiledRule`. Introduced in
 * mmnto/totem#1408 to fulfil spike finding G-7: one malformed compound rule
 * must not blast-radius the whole file's ast-grep pass.
 */
export type OnRuleFailure = (index: number, err: Error) => void;

function executeQuery(
  root: import('@ast-grep/napi').SgRoot,
  rule: AstGrepRule,
  addedLineNumbers: number[],
  lines: string[],
): AstGrepMatch[] {
  if (addedLineNumbers.length === 0) return [];

  const addedSet = new Set(addedLineNumbers);

  try {
    // findAll accepts both string patterns and NapiConfig objects
    const matches = root.root().findAll(rule);
    const results: AstGrepMatch[] = [];

    for (const match of matches) {
      const startLine = match.range().start.line + 1;
      const endLine = match.range().end.line + 1;

      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        if (addedSet.has(lineNum)) {
          results.push({
            lineNumber: lineNum,
            lineText: lines[lineNum - 1] ?? '',
          });
          break;
        }
      }
    }

    return results;
  } catch (err) {
    rethrowAsParseError('ast-grep query failed', err, AST_GREP_HINT);
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Run an ast-grep pattern against file content, filtering to added lines.
 * Accepts either a string pattern or a NapiConfig rule object (compound rules).
 */
export function matchAstGrepPattern(
  content: string,
  ext: string,
  pattern: AstGrepRule,
  addedLineNumbers: number[],
): AstGrepMatch[] {
  const lang = extensionToLang(ext);
  if (!lang) return [];

  try {
    const root = parse(lang, content);
    return executeQuery(root, pattern, addedLineNumbers, content.split('\n'));
  } catch (err) {
    rethrowAsParseError('ast-grep parse failed', err, AST_GREP_HINT);
  }
}

/**
 * Parse a file once and run multiple ast-grep rules against it.
 * O(M + N) - file parsed exactly once regardless of rule count.
 * Returns results indexed by position in the input array.
 *
 * When `onRuleFailure` is passed, each per-rule `findAll` call runs inside
 * its own try/catch (spike finding G-7, mmnto/totem#1408): a malformed
 * compound rule emits a failure event, yields an empty result array for
 * that index, and the remaining rules continue to execute. Without the
 * sink, the legacy fail-closed behavior holds - the first per-rule failure
 * aborts the whole batch via `TotemParseError`.
 *
 * The parse-time failure (invalid source, unsupported language) still
 * escapes via `rethrowAsParseError` regardless of the sink, because a parse
 * error affects every query on the file and there is no way to produce
 * honest per-rule results from a broken tree.
 */
export function matchAstGrepPatternsBatch(
  content: string,
  ext: string,
  queries: Array<{ rule: AstGrepRule; addedLineNumbers: number[] }>,
  onRuleFailure?: OnRuleFailure,
): AstGrepMatch[][] {
  if (queries.length === 0) return [];

  const lang = extensionToLang(ext);
  if (!lang) {
    return queries.map(() => []);
  }

  const lines = content.split('\n');

  let root: import('@ast-grep/napi').SgRoot;
  try {
    root = parse(lang, content);
  } catch (err) {
    rethrowAsParseError('ast-grep batch parse failed', err, AST_GREP_HINT);
  }

  return queries.map(({ rule, addedLineNumbers }, index) => {
    if (!onRuleFailure) {
      // Legacy path: first failure aborts the whole batch.
      return executeQuery(root, rule, addedLineNumbers, lines);
    }
    try {
      return executeQuery(root, rule, addedLineNumbers, lines);
    } catch (err) {
      // Preserve the original thrown value in `cause` so downstream
      // error-chain walkers (rule 102) can surface the underlying
      // napi/runtime error without losing structure. Plain string
      // throws are wrapped but still chained.
      const wrapped = err instanceof Error ? err : new Error(String(err), { cause: err });
      onRuleFailure(index, wrapped);
      return [];
    }
  });
}
