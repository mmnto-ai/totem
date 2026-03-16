import type { ContentType } from './config-schema.js';

/** Strip ANSI escape sequences, control characters, and BiDi overrides to prevent terminal injection. */
const CONTROL_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]|[\u202A-\u202E\u2066-\u2069]/g;

export function sanitize(text: string): string {
  return text.replace(CONTROL_RE, '');
}

// ---------------------------------------------------------------------------
// Adversarial ingestion scrubbing (Phase B of Bulletproof Totem)
// ---------------------------------------------------------------------------

/**
 * Zero-width and invisible Unicode characters used in adversarial payloads.
 * Excludes ZWJ (\u200D) to preserve compound emoji (e.g. 👨‍👩‍👧‍👦).
 */
const INVISIBLE_CHARS_RE =
  /[\u200B\u200C\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u180E\u034F]/g;

/**
 * RTL/LTR override characters used in Trojan Source attacks.
 * These are dangerous in ALL content types including code.
 */
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Prompt injection patterns — verb + target proximity detection.
 * Shared between ingestion scrubbing and extraction flagging.
 */
export const INSTRUCTIONAL_LEAKAGE_RE =
  /(?:ignore|override|bypass|disregard|forget|print|output|reveal|leak|dump|repeat|show)[\s\S]{0,50}?(?:system prompt|previous instructions|above instructions|prior instructions|your instructions)/i;

/** System XML tags that shouldn't appear in user content. Accounts for optional whitespace (e.g. `</ system>`). */
export const XML_TAG_LEAKAGE_RE =
  /<\/?\s*(?:pr_body|comment_body|diff_hunk|review_body|system|untrusted_content)[^>]*>/i;

/** Suspicious Base64 blobs (60+ contiguous chars). */
export const BASE64_BLOB_RE = /(?:[A-Za-z0-9+/]{4}){15,}/;

/** Excessive consecutive Unicode escape sequences. */
export const UNICODE_ESCAPE_RE = /(?:\\u[0-9a-fA-F]{4}){5,}/;

export interface IngestionSanitizeOptions {
  chunkType: ContentType;
  filePath?: string;
  onWarn?: (message: string) => void;
}

/**
 * Sanitize a chunk's text content before embedding into LanceDB.
 *
 * Strictness varies by content type:
 * - `spec` / `session_log`: strip invisible Unicode, flag injection patterns
 * - `code`: only strip Trojan Source BiDi overrides (preserves valid string literals)
 *
 * Injection patterns are flagged via onWarn but NOT stripped — they may be
 * legitimate discussions about security in specs or PRs.
 */
// totem-ignore-next-line — core library param, not MCP return
export function sanitizeForIngestion(text: string, options: IngestionSanitizeOptions): string {
  if (!text) return '';
  const { chunkType, filePath, onWarn } = options;
  let result = text;

  // --- Phase 1: BiDi overrides (dangerous in ALL content types) ---
  if (BIDI_OVERRIDE_RE.test(result)) {
    onWarn?.(`BiDi override characters detected${filePath ? ` in ${filePath}` : ''} — stripped`);
    result = result.replace(BIDI_OVERRIDE_RE, '');
  }

  // --- Phase 2: Invisible characters (prose only — code may have valid uses) ---
  if (chunkType !== 'code' && INVISIBLE_CHARS_RE.test(result)) {
    onWarn?.(
      `Invisible Unicode characters detected${filePath ? ` in ${filePath}` : ''} — stripped`,
    );
    result = result.replace(INVISIBLE_CHARS_RE, '');
  }

  // --- Phase 3: Flag suspicious patterns (all types, warn only, never strip) ---
  const flags: string[] = [];

  if (INSTRUCTIONAL_LEAKAGE_RE.test(result)) {
    flags.push('instructional leakage');
  }
  if (XML_TAG_LEAKAGE_RE.test(result)) {
    flags.push('system XML tags');
  }
  if (BASE64_BLOB_RE.test(result)) {
    flags.push('Base64 payload');
  }
  if (UNICODE_ESCAPE_RE.test(result)) {
    flags.push('excessive Unicode escapes');
  }

  if (flags.length > 0) {
    onWarn?.(`Suspicious content flagged${filePath ? ` in ${filePath}` : ''}: ${flags.join(', ')}`);
  }

  // --- Phase 4: Secret masking (DLP) — strip secrets before embedding ---
  result = maskSecrets(result);

  return result;
}

// ---------------------------------------------------------------------------
// DLP Secret Masking
// ---------------------------------------------------------------------------

/**
 * Common secret patterns. Each regex matches a full token.
 * Conservative — only matches high-confidence patterns to avoid false positives.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp; replacement?: string }> = [
  // API keys with known prefixes
  { name: 'API key', re: /\b(sk-[a-zA-Z0-9]{20,})\b/g },
  { name: 'API key', re: /\b(sk-proj-[a-zA-Z0-9_-]{20,})\b/g },
  { name: 'API key', re: /\b(AIza[a-zA-Z0-9_-]{30,})\b/g },
  { name: 'npm token', re: /\b(npm_[a-zA-Z0-9]{20,})\b/g },
  { name: 'GitHub token', re: /\b(gh[pousr]_[a-zA-Z0-9]{20,})\b/g },
  { name: 'AWS key', re: /\b(AKIA[A-Z0-9]{16})\b/g },
  // Generic high-entropy strings after common key assignments — replace only the value
  {
    name: 'secret assignment (quoted)',
    re: /((?:api[_-]?key|secret|token|password|credential)['"]?\s*[:=]\s*['"])([a-zA-Z0-9_\-/.+]{20,})(['"])/gi,
    replacement: '$1[REDACTED]$3',
  },
  {
    name: 'secret assignment (unquoted)',
    re: /((?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*)([a-zA-Z0-9_\-/.+]{20,})\b/gi,
    replacement: '$1[REDACTED]',
  },
];

/** Mask detected secrets with [REDACTED]. Returns the cleaned text. */
export function maskSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.re.lastIndex = 0;
    const replacement = pattern.replacement ?? '[REDACTED]';
    result = result.replace(pattern.re, replacement);
  }
  return result;
}
