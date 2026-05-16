import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { extractAddedLines } from './diff-parser.js';

// ─── Schemas ────────────────────────────────────────

export const ToolIntegrationConfigSchema = z.record(z.string(), z.array(z.string()).nonempty());

export const BadgeVerificationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type ToolIntegrationConfig = z.infer<typeof ToolIntegrationConfigSchema>;
export type BadgeVerificationResult = z.infer<typeof BadgeVerificationResultSchema>;

// ─── Default integration matrix (mmnto-ai/totem#1924) ───

export const DEFAULT_TOOL_INTEGRATIONS: ToolIntegrationConfig = {
  claude: ['.claude/', 'CLAUDE.md'],
  gemini: ['.gemini/', 'GEMINI.md'],
  cursor: ['.cursor/', '.cursorrules'],
  windsurf: ['.windsurfrules', '.windsurf/'],
  copilot: ['.github/copilot-instructions.md'],
};

// ─── Badge extraction ───────────────────────────────

export interface ExtractedBadge {
  rawUrl: string;
  altText: string;
  label: string;
  message: string;
  linkTarget?: string;
  file: string;
  lineNumber: number;
}

const BADGE_IMAGE_RE = /!\[([^\]]*)\]\((https:\/\/img\.shields\.io\/badge\/[^)\s"]+)\)/g;
const WRAP_TAIL_RE = /^\]\(([^)\s"]+)\)/;

/**
 * Extract shields.io badges from added (`+`) lines of a unified diff,
 * filtered to `README.md` only. Stateless — recomputes from diff each
 * invocation (ADR-083: no SHA-stamped flag files).
 */
export function extractBadgesFromDiff(diff: string): ExtractedBadge[] {
  if (!diff) return [];
  const additions = extractAddedLines(diff);
  const badges: ExtractedBadge[] = [];

  for (const addition of additions) {
    if (addition.file !== 'README.md') continue;
    const line = addition.line;
    for (const match of line.matchAll(BADGE_IMAGE_RE)) {
      const altText = match[1] ?? '';
      const url = match[2] ?? '';
      const start = match.index ?? 0;
      const end = start + match[0].length;

      let linkTarget: string | undefined;
      // Wrapped form `[![alt](url)](target)`: precede by `[`, follow with `](target)`
      if (line[start - 1] === '[') {
        const after = line.slice(end);
        const wrap = WRAP_TAIL_RE.exec(after);
        if (wrap) {
          linkTarget = wrap[1];
        }
      }

      const { label, message } = decodeBadgeUrl(url);
      badges.push({
        rawUrl: url,
        altText,
        label,
        message,
        linkTarget,
        file: addition.file,
        lineNumber: addition.lineNumber,
      });
    }
  }

  return badges;
}

// ─── Tool-claim verification ────────────────────────

/**
 * Predicate used by `verifyToolClaims` to determine whether a tool-integration
 * file/directory exists at the given absolute path. Injectable for tests;
 * production callers pass `fs.existsSync` (the default).
 */
export type PathExistsPredicate = (absolutePath: string) => boolean;

/**
 * For each badge, check whether any tool name from `config` appears in the
 * decoded label or message (case-insensitive, word-boundary match). For every
 * matched tool, require that at least one of its configured paths exists in
 * `repoRoot`. Missing tools become errors.
 *
 * Falsifying metric: existence of at least one config-listed path satisfies
 * the badge's tool-integration claim.
 */
export function verifyToolClaims(
  badges: ExtractedBadge[],
  config: ToolIntegrationConfig,
  repoRoot: string,
  exists: PathExistsPredicate = fs.existsSync,
): string[] {
  const errors: string[] = [];
  const reported = new Set<string>();
  const toolKeys = Object.keys(config);

  for (const badge of badges) {
    const haystack = `${badge.label} ${badge.message}`.toLowerCase();
    for (const tool of toolKeys) {
      const key = tool.toLowerCase();
      const wordBoundary = new RegExp(`\\b${escapeRegExp(key)}\\b`);
      if (!wordBoundary.test(haystack)) continue;

      const candidatePaths = config[tool] ?? [];
      const anyExists = candidatePaths.some((rel) => exists(path.join(repoRoot, rel)));
      if (anyExists) continue;

      const dedupKey = `${badge.rawUrl}|${key}`;
      if (reported.has(dedupKey)) continue;
      reported.add(dedupKey);

      const expected = candidatePaths.join(', ');
      errors.push(
        `Badge at README.md:${badge.lineNumber} claims integration with "${tool}" but none of the expected paths exist in the repo: ${expected}`,
      );
    }
  }

  return errors;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Self-reference link verification ───────────────

/**
 * Standard-claim labels — badges that assert compliance with an external
 * spec/license. When these claims appear, the badge's link target must point
 * at the canonical upstream, not at internal repo paths (the "circular claim"
 * trap from mmnto-ai/totem#1925 R2).
 */
const STANDARD_CLAIM_LABELS = new Set([
  'agents.md',
  'mit',
  'apache 2.0',
  'apache-2.0',
  'apache2.0',
  'bsd',
  'bsd-2-clause',
  'bsd-3-clause',
  'gpl',
  'gpl-3.0',
  'mpl',
  'mpl-2.0',
]);

const INTERNAL_TARGET_PATTERNS = [
  /^\.\//, // relative path starting with `./`
  /^\.\.\//, // relative path starting with `../`
  /\bmmnto-ai\//i,
  /\bmmnto\//i,
];

function isInternalLinkTarget(target: string): boolean {
  return INTERNAL_TARGET_PATTERNS.some((re) => re.test(target));
}

/**
 * Flag standard-claim badges (AGENTS.md, MIT, Apache 2.0, etc.) whose link
 * target points at internal repo paths instead of the canonical upstream
 * standard. This is the failure class from mmnto-ai/totem#1925 R2.
 *
 * Standard claims are recognized in EITHER the label or the message position
 * to catch both `[![AGENTS.md](.../AGENTS.md-compliant-...)](./AGENTS.md)` and
 * `[![Tool-agnostic](.../Tool--agnostic-AGENTS.md-...)](./AGENTS.md)`.
 */
export function verifySelfReferenceLinks(badges: ExtractedBadge[]): string[] {
  const errors: string[] = [];
  for (const badge of badges) {
    if (!badge.linkTarget) continue;
    const claim = findStandardClaim(badge);
    if (!claim) continue;
    if (!isInternalLinkTarget(badge.linkTarget)) continue;
    errors.push(
      `Badge at README.md:${badge.lineNumber} claims "${claim}" but links to internal path "${badge.linkTarget}". Standard-claim badges must link to the canonical upstream (e.g., https://agents.md/, https://opensource.org/licenses/MIT).`,
    );
  }
  return errors;
}

function findStandardClaim(badge: ExtractedBadge): string | null {
  for (const field of [badge.label, badge.message]) {
    const key = field.toLowerCase().trim();
    if (STANDARD_CLAIM_LABELS.has(key)) return field;
  }
  return null;
}

// ─── shields.io URL decoding ────────────────────────

function decodeBadgeUrl(url: string): { label: string; message: string } {
  const m = url.match(/\/badge\/(.+)$/);
  if (!m) return { label: '', message: '' };
  let path = m[1] ?? '';
  const queryIdx = path.indexOf('?');
  if (queryIdx >= 0) path = path.slice(0, queryIdx);
  path = path.replace(/\.svg$/, '');

  // Split on unescaped single dashes; `--` is the shields.io escape for literal `-`.
  const parts = path.split(/(?<!-)-(?!-)/);
  return {
    label: decodeShieldsText(parts[0] ?? ''),
    message: decodeShieldsText(parts[1] ?? ''),
  };
}

/**
 * Decode shields.io path-segment encoding per the static-badge spec:
 *   `--` → `-`, `__` → `_`, `_` → ` `, plus standard percent-encoding.
 *
 * Single-pass replace with alternation order (`--` and `__` listed before `_`)
 * matches longer sequences first at each position, so `key__value` decodes to
 * `key_value` rather than `key  value`.
 */
function decodeShieldsText(s: string): string {
  let out: string;
  try {
    out = decodeURIComponent(s); // totem-context: intentional cleanup — next-line catch swallows malformed % escapes (e.g., a stray `%` in a badge URL) so verifyToolClaims can still match the raw segment instead of crashing the whole hook.
  } catch {
    out = s;
  }
  return out.replace(/--|__|_/g, (m) => {
    if (m === '--') return '-';
    if (m === '__') return '_';
    return ' ';
  });
}
