import * as fs from 'node:fs';
import * as path from 'node:path';

import { extensionToLanguage } from './ast-classifier.js';
import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPatternsBatch } from './ast-grep-query.js';
import { matchAstQueriesBatch } from './ast-query.js';
import type {
  CompiledRule,
  DiffAddition,
  FailSoftAttestation,
  RuleEventCallback,
  Violation,
} from './compiler-schema.js';
import { extractAddedLines } from './diff-parser.js';
import { TotemParseError } from './errors.js';
import { detectStaleManifest, staleManifestError } from './stale-manifest.js';
import { fileMatchesGlobs, matchesGlob } from './sys/glob.js';

export { fileMatchesGlobs, matchesGlob };

/**
 * Detect whether a rule is a production-only Rust rule.
 * A rule is production-only Rust if it applies to `.rs` files and explicitly
 * excludes tests, or does not explicitly target tests.
 */
export function isProductionRustRule(rule: CompiledRule): boolean {
  if (!rule.fileGlobs || rule.fileGlobs.length === 0) return false;
  const hasRs = rule.fileGlobs.some(
    (g) => typeof g === 'string' && !g.startsWith('!') && g.endsWith('.rs'),
  );
  if (!hasRs) return false;
  // If it explicitly excludes test files/folders, it's production-only
  const excludesTests = rule.fileGlobs.some(
    (g) =>
      typeof g === 'string' && g.startsWith('!') && (g.includes('test') || g.includes('tests')),
  );
  if (excludesTests) return true;
  // Alternatively, if it does not explicitly include test files
  const includesTests = rule.fileGlobs.some(
    (g) =>
      typeof g === 'string' && !g.startsWith('!') && (g.includes('test') || g.includes('tests')),
  );
  return !includesTests;
}

/**
 * Consume a Rust block comment beginning at `start` (which MUST point at the
 * slash of an open-comment marker). Rust block comments NEST, so a naive
 * first-terminator scan (`indexOf` of the close marker) stops at the FIRST
 * close marker and leaves the unconsumed tail — a `}` in that tail corrupts
 * brace-depth tracking. This consumer increments depth on each nested open
 * marker and decrements on each close marker, ending when depth returns to 0
 * (the true comment end) or at EOF. Returns the index just past the final
 * close marker (or `content.length` on an unterminated comment).
 */
function skipRustBlockComment(content: string, start: number): number {
  let idx = start + 2; // past the two-char open-comment marker
  let depth = 1;
  while (idx < content.length) {
    if (content[idx] === '/' && content[idx + 1] === '*') {
      depth++;
      idx += 2;
      continue;
    }
    if (content[idx] === '*' && content[idx + 1] === '/') {
      depth--;
      idx += 2;
      if (depth === 0) return idx;
      continue;
    }
    idx++;
  }
  return content.length;
}

/**
 * Parses Rust content to find line ranges (spans) for inline `#[cfg(test)]` modules.
 * Returns an array of `{ startLine: number; endLine: number }` representing the spans.
 */
export function getRustTestSpans(content: string): { startLine: number; endLine: number }[] {
  const spans: { startLine: number; endLine: number }[] = [];

  // Regex to match #[cfg(test)] with any whitespace
  const CFG_TEST_RE = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/g;

  let match: RegExpExecArray | null;
  while ((match = CFG_TEST_RE.exec(content)) !== null) {
    const attributeIndex = match.index;
    const startLine = content.slice(0, attributeIndex).split('\n').length;

    // Scan forward from the end of the #[cfg(test)] attribute to find the mod block
    let idx = attributeIndex + match[0].length;
    let foundModBraceIdx = -1;

    while (idx < content.length) {
      const char = content[idx];

      // Skip whitespace
      if (/\s/.test(char)) {
        idx++;
        continue;
      }

      // Skip line comment
      if (char === '/' && content[idx + 1] === '/') {
        idx = content.indexOf('\n', idx);
        if (idx === -1) idx = content.length;
        continue;
      }

      // Skip block comment (Rust block comments NEST — see skipRustBlockComment)
      if (char === '/' && content[idx + 1] === '*') {
        idx = skipRustBlockComment(content, idx);
        continue;
      }

      // Skip other attributes like #[allow(...)]
      if (char === '#') {
        idx++;
        while (idx < content.length) {
          if (content[idx] === ']') {
            idx++;
            break;
          }
          idx++;
        }
        continue;
      }

      // Skip a visibility modifier — `#[cfg(test)] pub mod` / `pub(crate) mod`
      // are valid test modules and must still be spanned.
      if (content.slice(idx).startsWith('pub') && !/[A-Za-z0-9_]/.test(content[idx + 3] ?? '')) {
        idx += 3;
        while (idx < content.length && /\s/.test(content[idx]!)) idx++;
        if (content[idx] === '(') {
          const close = content.indexOf(')', idx);
          idx = close === -1 ? content.length : close + 1;
        }
        continue;
      }

      // Check for 'mod'
      if (content.slice(idx).startsWith('mod') && /\s/.test(content[idx + 3] ?? '')) {
        let braceIdx = idx + 3;
        let isInlineMod = false;

        while (braceIdx < content.length) {
          const bChar = content[braceIdx];
          // A `;` ends a non-inline `mod external;` declaration (no span);
          // a `{` opens an inline module body.
          if (bChar === ';') {
            break;
          }
          if (bChar === '{') {
            isInlineMod = true;
            break;
          }
          braceIdx++;
        }

        // Only the inline case records a brace to scan from. The former
        // `idx = braceIdx` / `idx = braceIdx + 1` / `idx++` assignments were
        // dead stores (CodeQL) — the unconditional `break` below exits the
        // scan loop and `idx` is never read afterward.
        if (isInlineMod) {
          foundModBraceIdx = braceIdx;
        }
        break;
      }

      // If we hit any other character, abort search for mod
      break;
    }

    if (foundModBraceIdx !== -1) {
      // Find matching closing curly brace
      let depth = 1;
      let braceScanIdx = foundModBraceIdx + 1;
      let endLine = startLine;

      while (braceScanIdx < content.length) {
        const char = content[braceScanIdx];

        // Skip line comment
        if (char === '/' && content[braceScanIdx + 1] === '/') {
          braceScanIdx = content.indexOf('\n', braceScanIdx);
          if (braceScanIdx === -1) braceScanIdx = content.length;
          continue;
        }

        // Skip block comment (Rust block comments NEST — see skipRustBlockComment)
        if (char === '/' && content[braceScanIdx + 1] === '*') {
          braceScanIdx = skipRustBlockComment(content, braceScanIdx);
          continue;
        }

        // Skip string literal. A quote terminates the string only when the run
        // of backslashes immediately before it is EVEN (each pair is an escaped
        // backslash); an ODD run means the quote itself is escaped. The naive
        // `content[i-1] !== '\\'` check mis-reads a string ending in an escaped
        // backslash (`"...\\"`) as unterminated, over-reading past the closing
        // quote and swallowing braces (over-exemption — real violations after
        // the module get suppressed).
        if (char === '"') {
          braceScanIdx++;
          while (braceScanIdx < content.length) {
            if (content[braceScanIdx] === '"') {
              let backslashes = 0;
              let b = braceScanIdx - 1;
              while (b >= 0 && content[b] === '\\') {
                backslashes++;
                b--;
              }
              if (backslashes % 2 === 0) {
                braceScanIdx++;
                break;
              }
            }
            braceScanIdx++;
          }
          continue;
        }

        // Skip raw string literal
        if (
          char === 'r' &&
          (content[braceScanIdx + 1] === '"' || content[braceScanIdx + 1] === '#')
        ) {
          let hashes = 0;
          let p = braceScanIdx + 1;
          while (p < content.length && content[p] === '#') {
            hashes++;
            p++;
          }
          if (content[p] === '"') {
            const expectedEnd = `"${'#'.repeat(hashes)}`;
            const endIdx = content.indexOf(expectedEnd, p + 1);
            if (endIdx === -1) {
              braceScanIdx = content.length;
            } else {
              braceScanIdx = endIdx + expectedEnd.length;
            }
            continue;
          }
        }

        // Char literal vs LIFETIME: a `'` opens a char literal only when it
        // closes within the char grammar (`'x'`, `'\n'`, `'\u{7FFF}'`).
        // Otherwise it is a lifetime (`'a`, `'static`) — consuming to the next
        // apostrophe would swallow braces and corrupt depth tracking, producing
        // an over-long span (over-EXEMPTION: real violations after the test
        // module suppressed — the unsafe direction for a lint gate).
        if (char === "'") {
          if (content[braceScanIdx + 1] === '\\') {
            // Escaped char literal — scan to its closing quote.
            braceScanIdx += 2;
            while (braceScanIdx < content.length && content[braceScanIdx] !== "'") {
              braceScanIdx++;
            }
            braceScanIdx++;
          } else if (content[braceScanIdx + 2] === "'") {
            // Plain char literal `'x'`.
            braceScanIdx += 3;
          } else {
            // Lifetime — consume only the tick; the identifier is ordinary code.
            braceScanIdx++;
          }
          continue;
        }

        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            endLine = content.slice(0, braceScanIdx).split('\n').length;
            break;
          }
        }

        braceScanIdx++;
      }

      spans.push({ startLine, endLine });
    }
  }

  return spans;
}

// ─── Inline suppression ─────────────────────────────

const SUPPRESS_MARKER = 'totem-ignore';
const SUPPRESS_NEXT_LINE_MARKER = 'totem-ignore-next-line';
const CONTEXT_MARKER = 'totem-context:';
const CONTEXT_RE = /totem-context:\s*(.+)/;
const LEGACY_CONTEXT_MARKER = 'shield-context:';
const LEGACY_CONTEXT_RE = /shield-context:\s*(.+)/;

/** Injectable logger for core library diagnostics. */
export interface CoreLogger {
  warn(message: string): void;
}

/**
 * Per-invocation execution context for the rule engine (mmnto/totem#1441).
 * Replaces module-level `coreLogger` + `shieldContextDeprecationWarned` state
 * so concurrent / federated rule evaluations cannot bleed logger configuration
 * or deprecation-warning latching across each other. Callers instantiate one
 * ctx per linting invocation; the engine threads it through every helper that
 * can reach the legacy `shield-context:` directive path.
 */
export interface RuleEngineContext {
  logger: CoreLogger;
  state: { hasWarnedShieldContext: boolean };
}

function warnShieldContextDeprecation(ctx: RuleEngineContext): void {
  if (!ctx.state.hasWarnedShieldContext) {
    ctx.state.hasWarnedShieldContext = true;
    ctx.logger.warn(
      '⚠ Deprecation: "// shield-context:" is deprecated. Use "// totem-context:" instead. (See ADR-071)',
    );
  }
}

/**
 * Check if a line should be suppressed via inline directives.
 * Supports three forms:
 * - Same-line: code(); // totem-ignore  (suppresses all rules on this line)
 * - Next-line: // totem-ignore-next-line on the preceding line (suppresses all rules on this line)
 * - Context: // totem-context: <reason> — semantic override that suppresses AND records justification
 *
 * Syntax-agnostic: works with any comment style (//, #, HTML comments, block comments).
 */
/** Check if a line contains a context directive (totem-context or legacy shield-context). */
function hasContextDirective(ctx: RuleEngineContext, l: string): boolean {
  if (l.includes(CONTEXT_MARKER)) return true;
  if (l.includes(LEGACY_CONTEXT_MARKER)) {
    warnShieldContextDeprecation(ctx);
    return true;
  }
  return false;
}

/** Extract justification from a context directive on a single line, or null if none. */
function matchContextDirective(ctx: RuleEngineContext, l: string): string | null {
  const primary = l.match(CONTEXT_RE);
  if (primary) return primary[1]!.trim();
  const legacy = l.match(LEGACY_CONTEXT_RE);
  if (legacy) {
    warnShieldContextDeprecation(ctx);
    return legacy[1]!.trim();
  }
  return null;
}

export function isSuppressed(
  ctx: RuleEngineContext,
  line: string,
  precedingLine: string | null,
): boolean {
  // Same-line: 'totem-ignore' substring also matches 'totem-ignore-next-line',
  // so directive lines themselves are inherently suppressed.
  if (line.includes(SUPPRESS_MARKER)) return true;

  // Same-line: totem-context: or shield-context: (legacy)
  if (hasContextDirective(ctx, line)) return true;

  // Next-line: preceding line contains the next-line directive
  if (precedingLine != null && precedingLine.includes(SUPPRESS_NEXT_LINE_MARKER)) return true;

  // Next-line: preceding line contains a context directive
  if (precedingLine != null && hasContextDirective(ctx, precedingLine)) return true;

  return false;
}

/**
 * Extract justification text from totem-context: directives.
 * Checks both the current line and the preceding line.
 * Returns empty string for plain totem-ignore (no justification).
 *
 * @param ctx - Per-invocation rule engine context. Required so that the legacy
 *   `shield-context:` deprecation path (reached via `matchContextDirective`)
 *   uses the caller's logger and per-ctx latch instead of module state.
 * @param line - The line being evaluated.
 * @param precedingLine - The line immediately before, or null at start of file.
 * @returns The justification text, or empty string if the line carries a plain
 *   `totem-ignore` or no directive at all.
 */
export function extractJustification(
  ctx: RuleEngineContext,
  line: string,
  precedingLine: string | null,
): string {
  // Check current line for context directive
  const sameLine = matchContextDirective(ctx, line);
  if (sameLine) return sameLine;

  // Check preceding line for context directive
  if (precedingLine) {
    const prevLine = matchContextDirective(ctx, precedingLine);
    if (prevLine) return prevLine;
  }

  // Plain totem-ignore has no justification
  return '';
}

// ─── Fail-soft attestation (Tenet-4 shape 2, mmnto-ai/totem#2214) ───
//
// The `lesson-fail-open-catch-ban` rule bans a `catch_clause` that swallows
// without re-throwing. Tenet 4 (design-tenets.md, strategy#702/#708) licenses
// ONE blanket-fail-soft shape: a declared IO/LLM/network boundary whose entire
// surface is operational, guarded by a loud systemic backstop. The structured
// `// totem-context: fail-soft backstop=<name>` attestation lets that legitimacy
// be RECOGNIZED rather than dodged via `.catch()` (a call_expression the rule
// never matches). Recognition is intentionally narrow — only a LEADING
// `fail-soft` token is the attestation, so the ~25 existing prose escapes
// ("best-effort cleanup, fail-soft") are unaffected (additive, non-breaking).

const FAIL_SOFT_LEAD_RE = /^fail-soft\b/;
const FAIL_SOFT_BACKSTOP_RE = /\bbackstop\s*=\s*([^\s,;]+)/;

/**
 * Parse a `// totem-context:` justification as a Tenet-4 shape-2 fail-soft
 * attestation. Returns null unless the justification LEADS with `fail-soft`.
 * A leading `fail-soft` with a non-empty `backstop=<name>` yields the named
 * backstop; a leading `fail-soft` with no/empty backstop yields
 * `{ backstop: null }` (malformed — callers surface a non-blocking WARN, never
 * block: the lint establishes token-PRESENCE only, loudness + accounting are
 * verified at review/ADR level — Tenet 13/19).
 */
export function parseFailSoftAttestation(justification: string): FailSoftAttestation | null {
  const trimmed = justification.trim();
  if (!FAIL_SOFT_LEAD_RE.test(trimmed)) return null;
  const match = FAIL_SOFT_BACKSTOP_RE.exec(trimmed);
  return { kind: 'fail-soft', backstop: match ? match[1]! : null };
}

/**
 * Engine-emitted diagnostic (NOT a compiled rule) for a fail-soft attestation
 * that names no backstop. Always surfaced so the grammar can't go decorative —
 * an author must pay the structural cost of naming a loud backstop, else the
 * suppression is the exact Tenet-4 drift ("without both, a blanket swallow is a
 * real hole"). WARN, not ERROR: blocking CI is the consumer's actuator (Tenet
 * 13), and the lint can't prove the backstop is loud/accounting-complete, so
 * ERROR would overclaim and invite `backstop=anything` cargo-culting (Tenet 19).
 *
 * It is constructed here and attached to a `Violation` directly — never loaded
 * from `compiled-rules.json`, so it never flows through `CompiledRuleSchema`
 * validation (GCA #2220); it is nonetheless schema-valid as written. `engine:
 * 'ast'` is a TIER-CLASSIFICATION token, NOT a matcher claim: run-compiled-rules
 * keys `severity: 'warning'` + a hard engine (`ast` / `ast-grep`) into a
 * non-blocking probationary advisory, never a frozen-lesson demotion. `ast` is
 * the schema-valid hard value (`ast-grep` would require a pattern). The warning
 * fires from BOTH the tree-sitter and ast-grep suppression paths via
 * `attestationWarning`, so its `engine` is path-agnostic by design — the stable
 * identity is the `totem/fail-soft-missing-backstop` lessonHash, not `engine`
 * (greptile #2220).
 */
const FAIL_SOFT_MISSING_BACKSTOP_RULE: CompiledRule = {
  lessonHash: 'totem/fail-soft-missing-backstop',
  lessonHeading: 'Fail-soft attestation missing backstop',
  pattern: '',
  message:
    'fail-soft attestation missing `backstop=<name>` — name your loud systemic ' +
    'backstop (the assertion that throws on whole-boundary failure, e.g. ' +
    'attempted>0 && succeeded===0 ⟹ throw). Its loudness and per-item accounting ' +
    'are verified at review/ADR level, not by this lint (Tenet 4, design-tenets.md).',
  engine: 'ast',
  severity: 'warning',
  // Static engine constant, NOT a corpus-compiled rule — this date is inert
  // (no freshness check or sort reads it; `violationToFinding` ignores it) and
  // is deliberately fixed, never `new Date()`, to stay deterministic (#2220 CR).
  compiledAt: '2026-06-21T00:00:00.000Z',
};

/**
 * Build the non-blocking warn Violation for a malformed fail-soft attestation
 * (a `fail-soft` claim that names no backstop), or null when the attestation is
 * absent or well-formed. Shared by the tree-sitter and ast-grep suppression
 * paths so both surface the WARN identically (mmnto-ai/totem#2214).
 */
function attestationWarning(
  attestation: FailSoftAttestation | null,
  file: string,
  match: { lineText: string; lineNumber: number },
): Violation | null {
  if (!attestation || attestation.backstop !== null) return null;
  return {
    rule: FAIL_SOFT_MISSING_BACKSTOP_RULE,
    file,
    line: match.lineText,
    lineNumber: match.lineNumber,
  };
}

/**
 * Resolve inline suppression for an AST (tree-sitter or ast-grep) match,
 * checking BOTH directive anchors.
 *
 * The inline-directive convention (mmnto-ai/totem#1889) attaches a
 * `// totem-ignore` / `// totem-context:` directive to the matched construct's
 * start line or the line immediately above it. But the reported match line is
 * the first *added* line within the node's range — under diff scope, where only
 * a changed body line is an addition, it drifts off the construct's start line,
 * so a directive on (or above) that start line is missed if we only check the
 * matched line (mmnto-ai/totem#2214). We check the matched (first-added) line
 * AND the construct's start-line anchor the match carries; a directive on
 * either suppresses, making diff-scoped lint behave like full-tree lint.
 */
function resolveAstMatchSuppression(
  ctx: RuleEngineContext,
  match: { startLineText: string; startPrecedingLineText: string | null },
  addition: DiffAddition | undefined,
): { suppressed: boolean; justification: string; attestation: FailSoftAttestation | null } {
  // Anchor 1 — the matched (first-added) line + its preceding line, from the diff.
  if (addition && isSuppressed(ctx, addition.line, addition.precedingLine)) {
    const justification = extractJustification(ctx, addition.line, addition.precedingLine);
    return {
      suppressed: true,
      justification,
      attestation: parseFailSoftAttestation(justification),
    };
  }
  // Anchor 2 — the construct's start line + the line above it (mmnto-ai/totem#2214).
  if (isSuppressed(ctx, match.startLineText, match.startPrecedingLineText)) {
    const justification = extractJustification(
      ctx,
      match.startLineText,
      match.startPrecedingLineText,
    );
    return {
      suppressed: true,
      justification,
      attestation: parseFailSoftAttestation(justification),
    };
  }
  return { suppressed: false, justification: '', attestation: null };
}

/**
 * Apply compiled regex-engine rules against pre-extracted diff additions.
 * Skips additions with non-code AST context (strings, comments, regex).
 *
 * @param ctx - Per-invocation rule engine context. Replaces the module-level
 *   logger / deprecation-warning latch that existed pre-#1441. Callers build
 *   one ctx per linting invocation: `{ logger, state: { hasWarnedShieldContext: false } }`.
 * @param rules - The full rule list. This function filters to regex-engine
 *   rules internally.
 * @param additions - The diff additions to evaluate.
 * @param onRuleEvent - Optional observability callback for metrics collection
 *   on trigger / suppress / failure events.
 * @param workingDirectory - Optional working directory for resolving files on disk
 *   when parsing spans.
 * @returns All regex-based violations found.
 */
export function applyRulesToAdditions(
  ctx: RuleEngineContext,
  rules: CompiledRule[],
  additions: DiffAddition[],
  onRuleEvent?: RuleEventCallback,
  workingDirectory?: string,
): Violation[] {
  if (additions.length === 0 || rules.length === 0) return [];

  const violations: Violation[] = [];

  // Only process regex-engine rules — AST rules have pattern: '' which would match everything
  const regexRules = rules.filter((r) => r.engine === 'regex' || !r.engine);

  const rustTestSpansCache = new Map<string, { startLine: number; endLine: number }[]>();
  const getRustSpansSync = (file: string, workDir: string) => {
    if (rustTestSpansCache.has(file)) return rustTestSpansCache.get(file)!;
    try {
      const fullPath = path.resolve(workDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const spans = getRustTestSpans(content);
      rustTestSpansCache.set(file, spans);
      return spans;
      // totem-context: span-read failure yields no spans → no exemption → the rule still FIRES; the exemption fails toward flagging, never toward suppression.
    } catch {
      rustTestSpansCache.set(file, []);
      return [];
    }
  };

  for (const rule of regexRules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern);
    } catch (err) {
      // Fail loud (mmnto/totem#1442): invalid regex in a compiled rule means
      // the compile-time validator was bypassed or the manifest was edited
      // by hand. Silently skipping would mark the diff "compliant" while a
      // load-bearing rule is mute. Throw so the operator sees exactly which
      // rule is broken and can fix or archive it. `TotemParseError` is the
      // correct class here — an uncompilable compiled rule is a parse/
      // compilation failure on the rule's source, not a generic check
      // failure (GCA catch on mmnto/totem#1454).
      throw new TotemParseError(
        `Rule ${rule.lessonHash} has an invalid regex pattern and cannot be evaluated.`,
        `Re-run 'totem lesson compile' to regenerate the rule, or archive it via 'totem doctor --pr' if the source lesson cannot produce a valid pattern. Pattern: ${JSON.stringify(rule.pattern)}`,
        err,
      );
    }

    for (const addition of additions) {
      // Skip if rule has fileGlobs and this file doesn't match
      if (rule.fileGlobs && rule.fileGlobs.length > 0) {
        if (!fileMatchesGlobs(addition.file, rule.fileGlobs)) continue;
      }

      // Skip if suppressed via inline directive
      if (isSuppressed(ctx, addition.line, addition.precedingLine)) {
        if (re.test(addition.line)) {
          onRuleEvent?.('suppress', rule.lessonHash, {
            file: addition.file,
            line: addition.lineNumber,
            justification: extractJustification(ctx, addition.line, addition.precedingLine),
            immutable: rule.immutable,
          });
        }
        continue;
      }

      if (re.test(addition.line)) {
        // Exempt matches inside inline Rust test modules for production-only Rust rules
        if (isProductionRustRule(rule)) {
          const spans = getRustSpansSync(addition.file, workingDirectory || process.cwd());
          const isExempt = spans.some(
            (s) => addition.lineNumber >= s.startLine && addition.lineNumber <= s.endLine,
          );
          if (isExempt) {
            // Emit a suppress event so metrics distinguish "matched but
            // test-span-exempt" from "never matched" (#2397 / greptile P2).
            onRuleEvent?.('suppress', rule.lessonHash, {
              file: addition.file,
              line: addition.lineNumber,
              justification: 'exempt: inline #[cfg(test)] module span (#2397)',
              immutable: rule.immutable,
            });
            continue;
          }
        }

        // Record context telemetry for ALL matches (code, string, comment, regex)
        onRuleEvent?.('trigger', rule.lessonHash, {
          file: addition.file,
          line: addition.lineNumber,
          astContext: addition.astContext,
        });

        // Only emit violations for code context (non-code matches are telemetry-only)
        if (!addition.astContext || addition.astContext === 'code') {
          violations.push({
            rule,
            file: addition.file,
            line: addition.line,
            lineNumber: addition.lineNumber,
          });
        }
      }
    }
  }

  return violations;
}

// ─── AST rule execution ─────────────────────────────

/**
 * Apply AST-engine compiled rules against pre-extracted diff additions.
 * Handles both Tree-sitter S-expression ('ast') and ast-grep ('ast-grep') engines.
 * Async because it reads files and runs Tree-sitter queries.
 * Handles fileGlobs filtering and suppression same as regex rules.
 *
 * @param ctx - Per-invocation rule engine context (see {@link RuleEngineContext}).
 * @param rules - The full rule list. This function filters to ast / ast-grep
 *   rules internally.
 * @param additions - The diff additions to evaluate.
 * @param workingDirectory - Absolute path used to resolve file reads. Callers
 *   must pass the repo root, not `process.cwd()` (#1304).
 * @param onRuleEvent - Optional observability callback for trigger / suppress
 *   / failure events.
 * @param onWarn - Optional AST-path warning sink ("AST query skipped",
 *   "Skipped file outside project", etc.). Follow-up #1552 tracks consolidating
 *   this into `ctx.logger.warn`.
 * @param readStrategy - Optional async reader for staged / virtual file
 *   content. When omitted, reads from disk.
 * @returns All AST-based violations found.
 */
export async function applyAstRulesToAdditions(
  ctx: RuleEngineContext,
  rules: CompiledRule[],
  additions: DiffAddition[],
  workingDirectory: string,
  onRuleEvent?: RuleEventCallback,
  onWarn?: (msg: string) => void,
  readStrategy?: (filePath: string) => Promise<string | null>,
): Promise<Violation[]> {
  const treeSitterRules = rules.filter((r) => r.engine === 'ast' && r.astQuery);
  // Widen to include compound rules (mmnto/totem#1408). A rule is runnable
  // when EITHER `astGrepPattern` (string) or `astGrepYamlRule` (NapiConfig
  // object) is populated. The mutual-exclusion superRefine on
  // CompiledRuleSchema guarantees these do not coexist, so the per-rule
  // dispatch below can safely use an if/else on presence alone.
  const astGrepRules = rules.filter(
    (r) => r.engine === 'ast-grep' && (r.astGrepPattern || r.astGrepYamlRule),
  );
  if ((treeSitterRules.length === 0 && astGrepRules.length === 0) || additions.length === 0) {
    return [];
  }

  // Group additions by file
  const byFile = new Map<string, DiffAddition[]>();
  for (const a of additions) {
    const existing = byFile.get(a.file);
    if (existing) {
      existing.push(a);
    } else {
      byFile.set(a.file, [a]);
    }
  }

  const violations: Violation[] = [];

  // Combined view of all AST rules consulted by the unmapped-extension
  // fail-loud guard below (mmnto-ai/totem#1653). Hoisted outside the
  // per-file loop so we don't re-allocate it on every iteration when
  // the registered-extension fast path doesn't need it.
  const allAstRules = [...treeSitterRules, ...astGrepRules];

  // Process each file once — batch all applicable queries per file
  for (const [file, fileAdditions] of byFile) {
    // Check language support. mmnto-ai/totem#1653: silent-skip on unmapped
    // extensions was the bug — rules scoped to `.rs` (or any unregistered
    // extension) silently never fired with no signal to the rule author.
    // Fail-loud surface is surgical: skip files only when NO rule's
    // `fileGlobs` matches them (no rule cares → silent skip is correct);
    // throw when a rule expected to run can't because the language isn't
    // registered. Pack registration via `loadInstalledPacks()` is the
    // mechanism for adding language support.
    const ext = path.extname(file);
    if (!extensionToLanguage(ext)) {
      const ruleExpectingThisFile = allAstRules.find(
        (r) => r.fileGlobs && r.fileGlobs.length > 0 && fileMatchesGlobs(file, r.fileGlobs),
      );
      if (ruleExpectingThisFile) {
        // mmnto-ai/totem#1811 (ADR-101): before re-throwing the raw
        // Tree-sitter language-miss error, check whether the user is
        // one `totem sync --packs-only` away from a working state.
        // The detector consults `.totem/installed-packs.json`'s
        // `cohort` field against the running engine; on staleness
        // (missing / pre-1.27.0 / minor bump) we surface a structured
        // `STALE_MANIFEST` nudge instead of the generic install hint.
        // Cohort-match falls through to the original parse error.
        const staleDetection = detectStaleManifest({ workingDirectory });
        if (staleDetection) {
          throw staleManifestError(staleDetection, {
            file,
            extension: ext,
            ruleHash: ruleExpectingThisFile.lessonHash,
          });
        }
        // `[Totem Error]` prefix is auto-prepended by the TotemError base
        // class constructor (`errors.ts:40`). The literal prefix is
        // intentionally NOT in the message argument here — duplicating it
        // would produce `[Totem Error] [Totem Error] AST rule ...` at
        // runtime. See `errors.ts` for the prefix contract.
        throw new TotemParseError(
          `AST rule '${ruleExpectingThisFile.lessonHash}' (${ruleExpectingThisFile.lessonHeading}) is scoped to '${file}' (extension '${ext}') but no Tree-sitter language is registered for that extension`,
          `Install the pack that provides '${ext}' support (e.g., \`@mmnto/pack-rust-architecture\` for '.rs'), or correct the rule's fileGlobs to exclude this extension.`,
        );
      }
      continue;
    }

    // Collect added line numbers (suppression is checked post-match so metrics fire)
    const addedLineNumbers: number[] = [];
    for (const addition of fileAdditions) {
      if (addition.astContext && addition.astContext !== 'code') continue;
      addedLineNumbers.push(addition.lineNumber);
    }
    if (addedLineNumbers.length === 0) continue;

    // ── Tree-sitter S-expression rules ────────────────
    if (treeSitterRules.length > 0) {
      const applicableTreeSitter = treeSitterRules.filter((rule) => {
        if (rule.fileGlobs && rule.fileGlobs.length > 0) {
          return fileMatchesGlobs(file, rule.fileGlobs);
        }
        return true;
      });

      if (applicableTreeSitter.length > 0) {
        // Path containment check — prevent traversal outside the project.
        // Uses path.relative() instead of startsWith() to avoid sibling-directory bypass
        // (e.g., /app-secrets bypassing a /app base).
        const normalizedBase = path.resolve(workingDirectory);
        const fullPath = path.join(normalizedBase, file);
        const relative = path.relative(normalizedBase, fullPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          onWarn?.(`Skipped file outside project: ${file}`);
          continue;
        }

        // Batch: parse file once, run all queries against the cached tree
        const queries = applicableTreeSitter.map((rule) => ({
          astQuery: rule.astQuery!,
          addedLineNumbers,
        }));

        const batchResults = await matchAstQueriesBatch(
          file,
          queries,
          workingDirectory,
          onWarn,
          readStrategy,
        );

        // Rust test-span exemption (#2397): resolve spans ONCE per file — not
        // per match — and only when some applicable rule is production-Rust.
        let treeSitterRustSpans: { startLine: number; endLine: number }[] = [];
        if (applicableTreeSitter.some(isProductionRustRule)) {
          let fileContent = '';
          try {
            fileContent = readStrategy
              ? ((await readStrategy(file)) ?? '')
              : await fs.promises.readFile(path.resolve(workingDirectory, file), 'utf-8');
            // totem-context: span-read failure yields no spans → no exemption → the rule still FIRES; the exemption fails toward flagging, never toward suppression.
          } catch {
            fileContent = '';
          }
          treeSitterRustSpans = getRustTestSpans(fileContent);
        }

        // Map results back to violations
        for (let i = 0; i < applicableTreeSitter.length; i++) {
          const rule = applicableTreeSitter[i]!;
          const matches = batchResults[i] ?? [];

          for (const match of matches) {
            // Exempt matches inside inline Rust test modules (#2397).
            if (
              isProductionRustRule(rule) &&
              treeSitterRustSpans.some(
                (s) => match.lineNumber >= s.startLine && match.lineNumber <= s.endLine,
              )
            ) {
              // Emit a suppress event so metrics distinguish "matched but
              // test-span-exempt" from "never matched" (#2397 / greptile P2).
              onRuleEvent?.('suppress', rule.lessonHash, {
                file,
                line: match.lineNumber,
                justification: 'exempt: inline #[cfg(test)] module span (#2397)',
                immutable: rule.immutable,
              });
              continue;
            }

            const addition = fileAdditions.find((a) => a.lineNumber === match.lineNumber);
            const { suppressed, justification, attestation } = resolveAstMatchSuppression(
              ctx,
              match,
              addition,
            );
            if (suppressed) {
              onRuleEvent?.('suppress', rule.lessonHash, {
                file,
                line: match.lineNumber,
                justification,
                ...(attestation ? { attestation } : {}),
                immutable: rule.immutable,
              });
              const warning = attestationWarning(attestation, file, match);
              if (warning) violations.push(warning);
              continue;
            }

            onRuleEvent?.('trigger', rule.lessonHash, {
              file,
              line: match.lineNumber,
            });
            violations.push({
              rule,
              file,
              line: match.lineText,
              lineNumber: match.lineNumber,
            });
          }
        }
      }
    }

    // ── ast-grep structural pattern rules ─────────────
    if (astGrepRules.length > 0) {
      const applicableAstGrep = astGrepRules.filter((rule) => {
        if (rule.fileGlobs && rule.fileGlobs.length > 0) {
          return fileMatchesGlobs(file, rule.fileGlobs);
        }
        return true;
      });

      if (applicableAstGrep.length > 0) {
        // Read file content once for all ast-grep rules on this file
        let content: string | null = null;
        try {
          const fullPath = path.resolve(workingDirectory, file);
          // Path containment check — prevent traversal outside the project
          const relative = path.relative(path.resolve(workingDirectory), fullPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            onWarn?.(`Skipped file outside project: ${file} (resolved to ${fullPath})`);
            continue;
          }
          if (readStrategy) {
            content = await readStrategy(file);
          } else {
            content = await fs.promises.readFile(fullPath, 'utf-8');
          }
        } catch (err: unknown) {
          // Explicitly propagate readStrategy errors. Disk reads fall back to null, but staged reads shouldn't.
          if (readStrategy) {
            throw err;
          }
          // Fall through — content stays null for standard file read failures
        }
        if (content) {
          // Batch: parse file once, run all patterns.
          // Each rule carries either astGrepPattern (string) or astGrepYamlRule
          // (NapiConfig object); the batch helper polymorphically dispatches on
          // type. Per-rule try/catch (mmnto/totem#1408 G-7) ensures one
          // malformed rule does not kill the whole file pass: failures flow
          // through the onRuleFailure sink, get mapped back to a lessonHash
          // via the query index, and surface as 'failure' RuleEvent entries.
          const queries = applicableAstGrep.map((rule) => ({
            rule: (rule.astGrepPattern ?? rule.astGrepYamlRule) as AstGrepRule,
            addedLineNumbers,
          }));
          const batchResults = matchAstGrepPatternsBatch(content, ext, queries, (index, err) => {
            const failedRule = applicableAstGrep[index];
            if (!failedRule) return;
            onRuleEvent?.('failure', failedRule.lessonHash, {
              file,
              line: 0,
              failureReason: err.message,
            });
          });

          // Rust test-span exemption (#2397): compute once per file, only when
          // some applicable rule is production-Rust (content is already in hand).
          const astGrepRustSpans = applicableAstGrep.some(isProductionRustRule)
            ? getRustTestSpans(content)
            : [];

          for (let i = 0; i < applicableAstGrep.length; i++) {
            const rule = applicableAstGrep[i]!;
            const matches = batchResults[i] ?? [];

            for (const match of matches) {
              // Exempt matches inside inline Rust test modules (#2397).
              if (
                isProductionRustRule(rule) &&
                astGrepRustSpans.some(
                  (s) => match.lineNumber >= s.startLine && match.lineNumber <= s.endLine,
                )
              ) {
                // Emit a suppress event so metrics distinguish "matched but
                // test-span-exempt" from "never matched" (#2397 / greptile P2).
                onRuleEvent?.('suppress', rule.lessonHash, {
                  file,
                  line: match.lineNumber,
                  justification: 'exempt: inline #[cfg(test)] module span (#2397)',
                  immutable: rule.immutable,
                });
                continue;
              }

              const addition = fileAdditions.find((a) => a.lineNumber === match.lineNumber);
              const { suppressed, justification, attestation } = resolveAstMatchSuppression(
                ctx,
                match,
                addition,
              );
              if (suppressed) {
                onRuleEvent?.('suppress', rule.lessonHash, {
                  file,
                  line: match.lineNumber,
                  justification,
                  ...(attestation ? { attestation } : {}),
                  immutable: rule.immutable,
                });
                const warning = attestationWarning(attestation, file, match);
                if (warning) violations.push(warning);
                continue;
              }

              onRuleEvent?.('trigger', rule.lessonHash, {
                file,
                line: match.lineNumber,
              });
              violations.push({
                rule,
                file,
                line: match.lineText,
                lineNumber: match.lineNumber,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

// ─── Convenience wrapper ────────────────────────────

/**
 * Apply **regex-engine** compiled rules against added lines from a diff.
 * This is a convenience wrapper that only handles 'regex' engine rules.
 * For 'ast' and 'ast-grep' rules, call `applyAstRulesToAdditions` separately.
 *
 * @param ctx - Per-invocation rule engine context (see {@link RuleEngineContext}).
 * @param rules - The full list of compiled rules. This function filters to regex rules.
 * @param diff - The unified diff string.
 * @param excludeFiles - File paths to skip (e.g., compiled-rules.json to avoid self-matches).
 * @returns All regex-based violations found.
 */
export function applyRules(
  ctx: RuleEngineContext,
  rules: CompiledRule[],
  diff: string,
  excludeFiles?: string[],
): Violation[] {
  let additions = extractAddedLines(diff);
  if (additions.length === 0 || rules.length === 0) return [];

  if (excludeFiles && excludeFiles.length > 0) {
    const excluded = new Set(excludeFiles);
    additions = additions.filter((a) => !excluded.has(a.file));
  }

  return applyRulesToAdditions(ctx, rules, additions);
}
