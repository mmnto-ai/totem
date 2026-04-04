/**
 * TypeScript baseline rules — Proposal 210 Phase 1.
 * Curated lint rules for TypeScript/JavaScript ecosystems.
 *
 * @see Proposal 210 (proactive language packs)
 * @see #1152 (proactive language packs milestone ticket)
 */

import type { CompiledRule } from '@mmnto/totem';

export const NEW_TYPESCRIPT_RULES: CompiledRule[] = [
  // ─── 1. @ts-ignore without justification ─────────────
  {
    lessonHash: '4e34363c19762ef4',
    lessonHeading: '@ts-ignore without justification',
    pattern: '@ts-ignore(?!\\s)|@ts-ignore\\s*$',
    message:
      'Use @ts-expect-error with a description instead of @ts-ignore. @ts-expect-error will fail when the error is fixed, preventing stale suppressions.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '!**/*.test.ts', '!**/*.spec.ts'],
    severity: 'warning',
    category: 'style',
  },

  // ─── 2. Bare `any` type annotation ───────────────────
  {
    lessonHash: '3ebe7f36159a80c4',
    lessonHeading: 'Bare any type annotation',
    pattern: ':\\s*any\\b',
    message:
      'Avoid using `any`. Use `unknown` for truly unknown types, or define a proper interface.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '!**/*.test.ts', '!**/*.spec.ts'],
    severity: 'warning',
    category: 'style',
  },

  // ─── 3. Non-null assertion operator ──────────────────
  {
    lessonHash: 'bdbc80c10f6253c1',
    lessonHeading: 'Non-null assertion operator',
    pattern: '\\w+!\\.',
    message: 'Avoid non-null assertions (`!`). Use optional chaining (`?.`) or proper null checks.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '!**/*.test.ts', '!**/*.spec.ts'],
    severity: 'warning',
    category: 'style',
  },

  // ─── 4. `var` declarations ───────────────────────────
  {
    lessonHash: '058618b27bee5d3f',
    lessonHeading: 'var declarations',
    pattern: '\\bvar\\s+\\w+',
    message:
      'Use `const` or `let` instead of `var`. `var` has function-level scoping which causes subtle bugs.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '!**/*.test.*'],
    severity: 'warning',
    category: 'style',
  },

  // ─── 5. `console.log` in production code ─────────────
  {
    lessonHash: '890c30f316b3bfff',
    lessonHeading: 'console.log in production code',
    pattern: '\\bconsole\\.(log|debug|info)\\s*\\(',
    message: 'Remove console.log/debug/info from production code. Use a structured logger instead.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/src/**/*.ts', '**/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    severity: 'warning',
    category: 'style',
  },

  // Empty catch blocks: covered by existing COMPILED_BASELINE_RULES (guardrail-empty-catch)

  // ─── 6. `eval()` usage ──────────────────────────────
  {
    lessonHash: '103db6b09cdbd21a',
    lessonHeading: 'eval() usage',
    pattern: '\\beval\\s*\\(',
    message:
      'Never use eval(). It executes arbitrary code and is a critical security vulnerability. Use JSON.parse(), Function constructor, or structured alternatives.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    severity: 'error',
    category: 'security',
  },

  // ─── 8. `JSON.parse` error handling ─────────────────
  {
    lessonHash: '93f0fb40147c3307',
    lessonHeading: 'Ensure JSON.parse is wrapped in error handling',
    pattern: '\\bJSON\\.parse\\s*\\(',
    message:
      'Wrap JSON.parse() in try-catch at system boundaries. Unhandled parse errors crash the process.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.js', '!**/*.test.*', '!**/*.spec.*'],
    severity: 'warning',
    category: 'style',
  },

  // ─── 9. `process.exit()` in library code ────────────
  {
    lessonHash: '1e37fb53ec20622d',
    lessonHeading: 'process.exit() in library code',
    pattern: '\\bprocess\\.exit\\s*\\(',
    message:
      'Avoid process.exit() in library code. Throw an error instead and let the CLI entry point decide how to exit.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/src/**/*.ts', '!**/cli/**', '!**/commands/**', '!**/bin/**', '!**/*.test.*'],
    severity: 'warning',
    category: 'architecture',
  },

  // ─── 10. Hardcoded API key patterns ─────────────────
  {
    lessonHash: '052527fee28122db',
    lessonHeading: 'Hardcoded API key patterns',
    pattern:
      '(?:api[_-]?key|apiKey|secret|token|password|passwd)\\s*[:=]\\s*[\'"][A-Za-z0-9+/=_-]{16,}[\'"]',
    message:
      'Possible hardcoded credential detected. Use environment variables or a secrets manager instead.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '!**/*.test.*', '!**/*.spec.*'],
    severity: 'error',
    category: 'security',
  },
];
