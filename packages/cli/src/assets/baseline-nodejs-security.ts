/**
 * Node.js security baseline rules — compiled rules for common
 * security pitfalls in the Node.js ecosystem.
 *
 * These rules are ready for direct inclusion in compiled-rules.json
 * and enforce grep-level security checks without requiring an LLM.
 *
 * @see Proposal 210 Phase 1 (proactive language packs)
 * @see #1152 (proactive language packs ticket)
 */

import type { CompiledRule } from '@mmnto/totem';

export const COMPILED_NODEJS_BASELINE: CompiledRule[] = [
  // ─── 1. Shell injection via exec() ──────────────────
  {
    lessonHash: '976151615deaa19a',
    lessonHeading: 'child_process.exec() enables shell injection',
    pattern: String.raw`\bexecSync?\s*\(`,
    message:
      'Avoid child_process.exec() — it spawns a shell and is vulnerable to command injection. Use execFile() or spawn() without shell:true instead.',
    engine: 'regex',
    severity: 'warning',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*', '!**/*.spec.*', '!**/scripts/**'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 2. Shell injection via spawn() with shell:true ─
  {
    lessonHash: 'f8d586d04e81bd81',
    lessonHeading: 'spawn() with shell:true enables command injection',
    pattern: String.raw`spawn(?:Sync)?\s*\([^)]*\{[^}]*shell\s*:\s*true`,
    message:
      'Avoid spawn() with shell:true — it enables command injection. Pass arguments as an array without a shell.',
    engine: 'regex',
    severity: 'error',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 3. Insecure randomness ─────────────────────────
  {
    lessonHash: '5b86c1c96e1d7cec',
    lessonHeading: 'Math.random() is not cryptographically secure',
    pattern: String.raw`\bMath\.random\s*\(`,
    message:
      'Math.random() is not cryptographically secure. Use crypto.randomBytes(), crypto.randomUUID(), or crypto.getRandomValues() for security-sensitive operations.',
    engine: 'regex',
    severity: 'warning',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 4. Weak hash algorithms ────────────────────────
  {
    lessonHash: '78dc2e118185134f',
    lessonHeading: 'MD5 and SHA1 are cryptographically broken',
    pattern: String.raw`\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)`,
    message:
      'MD5 and SHA1 are cryptographically broken. Use SHA-256 or SHA-384 for integrity checks, and bcrypt/scrypt/argon2 for passwords.',
    engine: 'regex',
    severity: 'warning',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 5. XSS via HTML injection ──────────────────────
  {
    lessonHash: '277c4b6fbea22433',
    lessonHeading: 'innerHTML and dangerouslySetInnerHTML enable XSS',
    pattern: String.raw`\b(?:innerHTML|dangerouslySetInnerHTML)\b`,
    message:
      'Direct HTML injection via innerHTML or dangerouslySetInnerHTML is an XSS vector. Use textContent, DOM APIs, or a sanitization library.',
    engine: 'regex',
    severity: 'error',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '!**/*.test.*', '!**/*.spec.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 6. Hardcoded credentials ───────────────────────
  {
    lessonHash: '4a64a564963ff978',
    lessonHeading: 'Hardcoded credentials in source code',
    pattern: String.raw`(?:password|passwd)\s*[:=]\s*['"][^'"]{4,}['"]`,
    message:
      'Possible hardcoded password detected. Use environment variables, a secrets manager, or a .env file (gitignored) instead.',
    engine: 'regex',
    severity: 'error',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*', '!**/*.spec.*', '!**/*.example.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 7. Path traversal via user input ───────────────
  {
    lessonHash: '6a00515ef39ee4fa',
    lessonHeading: 'path.join() with user input enables directory traversal',
    pattern: String.raw`path\.join\s*\([^)]*(?:req\.|params\.|query\.|body\.)`,
    message:
      'Validate and sanitize user input before passing to path.join(). Unvalidated paths enable directory traversal attacks. Use path.resolve() and verify the result stays within the expected directory.',
    engine: 'regex',
    severity: 'warning',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },

  // ─── 8. Disabled TLS verification ──────────────────
  {
    lessonHash: '2bb718e79e91b11a',
    lessonHeading: 'Disabled TLS certificate verification',
    pattern: String.raw`NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false`,
    message:
      'Never disable TLS certificate verification in production. This enables man-in-the-middle attacks.',
    engine: 'regex',
    severity: 'error',
    category: 'security',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*'],
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
  },
];
