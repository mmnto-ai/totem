/**
 * Shell/POSIX baseline rules — curated from ShellCheck and the POSIX spec.
 * Protects shell scripts (including totem's own git hooks) from bash-only
 * constructs that break on dash, ash, or other POSIX-only shells.
 *
 * @see Proposal 210 Phase 1 (proactive language packs)
 * @see #1152 (proactive language packs ticket)
 */
import type { CompiledRule } from '@mmnto/totem';

export const COMPILED_SHELL_BASELINE: CompiledRule[] = [
  // ─── Errors (block CI) ─────────────────────────────
  {
    lessonHash: '39e1fa25de7eeb0e',
    lessonHeading: '[[ ]] bashism in sh scripts',
    pattern: '\\[\\[',
    message:
      'Double brackets [[ ]] are a bash extension. Use single brackets [ ] for POSIX sh compatibility.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'error',
    category: 'architecture',
  },
  {
    lessonHash: '0bfe91d15f8f0d30',
    lessonHeading: 'Array syntax in sh scripts',
    pattern: '\\w+=\\s*\\(',
    message:
      'Arrays are a bash extension and not available in POSIX sh. Use space-separated strings or positional parameters instead.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'error',
    category: 'architecture',
  },
  {
    lessonHash: '6d5da266b8ef7814',
    lessonHeading: 'Process substitution <(...) in sh',
    pattern: '<\\s*\\(',
    message:
      'Process substitution <() is a bash extension. Use temporary files or pipes for POSIX sh compatibility.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'error',
    category: 'architecture',
  },

  // ─── Warnings (report but don't fail) ──────────────
  {
    lessonHash: '85527afcf2757832',
    lessonHeading: 'echo -n / echo -e non-POSIX flags',
    pattern: '\\becho\\s+-[ne]+\\b',
    message:
      'echo -n and echo -e are not portable across shells. Use printf instead for POSIX compliance.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
  {
    lessonHash: '260c87a32ba95d9a',
    lessonHeading: '== in test expressions (POSIX uses =)',
    pattern: '\\[\\s+[^\\]]*\\s+==\\s+',
    message:
      'Use = instead of == in test expressions. == is a bash extension; POSIX only supports single =.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
  {
    lessonHash: 'f1a3640aa1cf826b',
    lessonHeading: 'function keyword (POSIX uses bare name)',
    pattern: '\\bfunction\\s+\\w+',
    message:
      "The 'function' keyword is a bash extension. Use 'name() {' syntax for POSIX sh compatibility.",
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
  {
    lessonHash: 'ab7278e18fe5b19b',
    lessonHeading: 'source instead of . (dot)',
    pattern: '\\bsource\\s+',
    message:
      "Use '. file' instead of 'source file'. The source command is a bash extension; the dot command is POSIX.",
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
  {
    lessonHash: '4325fe7f9e1c19cb',
    lessonHeading: 'readlink -f (not available on macOS)',
    pattern: '\\breadlink\\s+-f\\b',
    message:
      'readlink -f is not available on macOS. Use a portable alternative: dirname/basename combination, or install coreutils.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'architecture',
  },
  {
    lessonHash: '2370e5e71fb895d2',
    lessonHeading: 'Unquoted variable expansion in conditions',
    pattern: '\\[\\s+\\$\\{?\\w+\\}?\\s+',
    message:
      'Always quote variable expansions in test expressions: ["$var" = value]. Unquoted variables cause word splitting and glob expansion bugs.',
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
  {
    lessonHash: 'b3e70aaa8a28831d',
    lessonHeading: 'let arithmetic command (bash-only)',
    pattern: '\\blet\\s+\\w+',
    message:
      "The 'let' command is a bash extension. Use $(( )) arithmetic expansion for POSIX sh compatibility.",
    engine: 'regex',
    compiledAt: '2026-04-04T00:00:00.000Z',
    createdAt: '2026-04-04T00:00:00.000Z',
    fileGlobs: ['**/*.sh', '**/.husky/*'],
    severity: 'warning',
    category: 'style',
  },
];
