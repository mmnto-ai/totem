import * as path from 'node:path';

export type FileClass = 'CODE' | 'NON_CODE';

export interface ClassificationResult {
  codeFiles: string[];
  nonCodeFiles: string[];
  allNonCode: boolean;
  allCode: boolean;
}

// ─── Extension sets (O(1) lookup) ────────────────────

const CODE_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.scala',
  '.c',
  '.cpp',
  '.cc',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.lua',
  '.r',
  '.sql',
  '.zig',
  '.nim',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.ml',
  '.vue',
  '.svelte',
]);

const NON_CODE_EXTENSIONS = new Set<string>([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.xml',
  '.css',
  '.scss',
  '.less',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.lock',
  '.lockb',
  '.map',
  '.tsbuildinfo',
]);

// ─── Known filename sets (O(1) lookup) ──────────────

const CODE_FILENAMES = new Set<string>([
  'Dockerfile',
  'Makefile',
  'Rakefile',
  'Gemfile',
  'Justfile',
]);

const NON_CODE_FILENAMES = new Set<string>([
  'LICENSE',
  'CHANGELOG',
  'CHANGELOG.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.prettierrc',
  '.eslintignore',
]);

// ─── Compound extension check ───────────────────────

/**
 * Check for compound extensions like `.d.ts.map` that path.extname
 * won't catch (it only returns `.map`).
 */
function hasCompoundNonCodeExtension(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.endsWith('.d.ts.map');
}

// ─── Public API ─────────────────────────────────────

export function classifyFile(filePath: string): FileClass {
  const basename = path.basename(filePath);

  // 1. Check known filenames first (exact match on basename)
  if (NON_CODE_FILENAMES.has(basename)) return 'NON_CODE';
  if (CODE_FILENAMES.has(basename)) return 'CODE';

  // 2. Check compound extensions before simple extname
  if (hasCompoundNonCodeExtension(filePath)) return 'NON_CODE';

  // 3. Check simple extension
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '') {
    // No extension, not a known filename → fail-closed to CODE
    return 'CODE';
  }

  if (NON_CODE_EXTENSIONS.has(ext)) return 'NON_CODE';
  if (CODE_EXTENSIONS.has(ext)) return 'CODE';

  // 4. Unknown extension → fail-closed to CODE
  return 'CODE';
}

export function classifyChangedFiles(changedFiles: string[]): ClassificationResult {
  const codeFiles: string[] = [];
  const nonCodeFiles: string[] = [];

  for (const file of changedFiles) {
    if (classifyFile(file) === 'CODE') {
      codeFiles.push(file);
    } else {
      nonCodeFiles.push(file);
    }
  }

  const allNonCode = codeFiles.length === 0;
  const allCode = nonCodeFiles.length === 0 && changedFiles.length > 0;

  return { codeFiles, nonCodeFiles, allNonCode, allCode };
}
