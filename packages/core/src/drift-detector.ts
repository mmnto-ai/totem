import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ─────────────────────────────────────────────

export interface ParsedLesson {
  /** Heading text after "## Lesson — " */
  heading: string;
  /** Extracted tags from the **Tags:** line */
  tags: string[];
  /** The lesson body text (after heading + tags line) */
  body: string;
  /** The full raw text of this lesson section (heading through end) */
  raw: string;
  /** 0-based index in the parsed lessons array */
  index: number;
}

export interface DriftResult {
  /** The parsed lesson that has orphaned references */
  lesson: ParsedLesson;
  /** File paths referenced in the lesson that no longer exist */
  orphanedRefs: string[];
}

// ─── Constants ─────────────────────────────────────────

/** File extensions considered valid for drift detection */
const FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yaml',
  '.yml',
  '.toml',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.vue',
  '.svelte',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.sql',
  '.graphql',
  '.gql',
  '.sh',
  '.bash',
  '.zsh',
  '.env',
  '.lock',
  '.config',
]);

// ─── Lesson parser ─────────────────────────────────────

const LESSON_HEADING_RE = /^## Lesson — /m;

/**
 * Parse a lessons.md file into individual lesson entries.
 * Splits on `## Lesson —` headings and extracts tags + body.
 */
export function parseLessonsFile(content: string): ParsedLesson[] {
  const lessons: ParsedLesson[] = [];

  // Split on lesson headings, keeping the delimiter
  const parts = content.split(LESSON_HEADING_RE);

  // parts[0] is the file header (before the first lesson)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const lines = part.split('\n');

    // First line is the heading (rest of the ## Lesson — line)
    const heading = (lines[0] ?? '').trim();

    // Find tags line: **Tags:** ...
    let tags: string[] = [];
    let bodyStartIdx = 1;
    for (let j = 1; j < lines.length; j++) {
      const line = lines[j]!.trim();
      if (!line) continue; // skip blank lines between heading and tags
      if (line.startsWith('**Tags:**')) {
        tags = line
          .replace('**Tags:**', '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        bodyStartIdx = j + 1;
        break;
      }
      // If we hit non-empty, non-tags content, no tags line exists
      bodyStartIdx = j;
      break;
    }

    const body = lines.slice(bodyStartIdx).join('\n').trim();
    const raw = `## Lesson — ${part}`;

    lessons.push({ heading, tags, body, raw, index: i - 1 });
  }

  return lessons;
}

// ─── File reference extraction ─────────────────────────

/**
 * Extract file path references from a lesson body.
 * Looks for backtick-wrapped content that looks like a real file path.
 */
export function extractFileReferences(body: string): string[] {
  const refs = new Set<string>();

  // Split by code fences and only process content outside them (even-indexed parts)
  const segments = body.split('```');

  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!;
    const inlineCodeRe = /(?<!`)`([^`\n]+)`(?!`)/g;
    let match: RegExpExecArray | null;

    while ((match = inlineCodeRe.exec(segment)) !== null) {
      const candidate = match[1]!.trim();

      // Must contain a forward slash (path separator)
      if (!candidate.includes('/')) continue;

      // Exclude URLs
      if (candidate.startsWith('http://') || candidate.startsWith('https://')) continue;

      // Exclude glob patterns
      if (candidate.includes('*') || candidate.includes('?')) continue;

      // Exclude npm package names (@scope/name)
      if (candidate.startsWith('@') && !candidate.startsWith('.')) continue;

      // Exclude shell commands with flags
      if (candidate.includes(' -') || candidate.includes(' --')) continue;

      // Must have a recognized file extension
      const ext = path.extname(candidate).toLowerCase();
      if (!ext || !FILE_EXTENSIONS.has(ext)) continue;

      // Normalize path separators
      refs.add(candidate.replace(/\\/g, '/'));
    }
  }

  return [...refs];
}

// ─── Drift detection ──────────────────────────────────

/**
 * Check parsed lessons for file references that no longer exist on disk.
 * Returns only lessons that have at least one orphaned reference.
 */
export function detectDrift(lessons: ParsedLesson[], projectRoot: string): DriftResult[] {
  const results: DriftResult[] = [];
  const resolvedRoot = path.resolve(projectRoot) + path.sep;

  for (const lesson of lessons) {
    const refs = extractFileReferences(lesson.body);
    if (refs.length === 0) continue;

    const orphaned = refs.filter((ref) => {
      const absPath = path.resolve(projectRoot, ref);
      // Path containment: skip refs that escape the project root
      if (!absPath.startsWith(resolvedRoot)) return false;
      return !fs.existsSync(absPath);
    });

    if (orphaned.length > 0) {
      results.push({ lesson, orphanedRefs: orphaned });
    }
  }

  return results;
}

// ─── Lesson file rewriting ────────────────────────────

/**
 * Rewrite lessons.md content, removing lessons at the specified indices.
 * Returns the new file content.
 */
export function rewriteLessonsFile(content: string, indicesToRemove: Set<number>): string {
  if (indicesToRemove.size === 0) return content;

  // Split on lesson headings to preserve the file header
  const parts = content.split(LESSON_HEADING_RE);
  const header = parts[0]!; // Everything before the first lesson

  // Reconstruct: header + kept lessons
  const kept: string[] = [header];
  for (let i = 1; i < parts.length; i++) {
    if (!indicesToRemove.has(i - 1)) {
      kept.push(`## Lesson — ${parts[i]!}`);
    }
  }

  // Join, clean up excessive blank lines, and ensure single trailing newline
  let result = kept.join('');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trimEnd() + '\n';

  return result;
}
