import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A parsed instruction from a .mdc or .cursorrules file.
 * Maps to the same shape as a Totem lesson for compilation.
 */
export interface CursorInstruction {
  /** Source file path (relative) */
  source: string;
  /** Heading derived from filename or frontmatter description */
  heading: string;
  /** The instruction body text */
  body: string;
  /** Optional file globs from frontmatter (maps to fileGlobs on compiled rules) */
  globs?: string[];
}

/**
 * Parse a single .mdc file. Cursor's .mdc format:
 * - Optional YAML frontmatter between `---` delimiters
 * - Frontmatter fields: description, globs, alwaysApply
 * - Body is markdown instruction text
 */
function parseMdcFile(filePath: string, content: string): CursorInstruction | null {
  const lines = content.split('\n');
  let body: string;
  let description: string | undefined;
  let globs: string[] | undefined;

  // Check for YAML frontmatter
  if (lines[0]?.trim() === '---') {
    const endIdx = lines.indexOf('---', 1);
    if (endIdx > 0) {
      // Parse simple frontmatter (key: value pairs)
      for (let i = 1; i < endIdx; i++) {
        const line = lines[i]!.trim();
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (key === 'description') {
          description = value;
        } else if (key === 'glob' || key === 'globs') {
          globs = value
            .split(',')
            .map((g) => g.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        }
      }
      body = lines
        .slice(endIdx + 1)
        .join('\n')
        .trim();
    } else {
      body = content.trim();
    }
  } else {
    body = content.trim();
  }

  if (!body) return null;

  // Derive heading from description or filename
  const basename = path.basename(filePath, path.extname(filePath));
  const heading = description ?? basename.replace(/[-_]/g, ' ');

  return {
    source: filePath,
    heading: heading.slice(0, 60),
    body,
    ...(globs && globs.length > 0 ? { globs } : {}),
  };
}

/**
 * Parse a plain .cursorrules file. Each non-empty section
 * (separated by blank lines or markdown headings) becomes an instruction.
 */
function parseCursorRulesFile(filePath: string, content: string): CursorInstruction[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Split into sections by markdown headings, preserving heading text
  const HEADING_RE = /^(#{1,3})\s+(.+)$/gm;
  const instructions: CursorInstruction[] = [];

  // Collect all heading positions
  const headings: Array<{ heading: string; idx: number }> = [];
  let m: RegExpExecArray | null;
  // totem-ignore-next-line
  while ((m = HEADING_RE.exec(trimmed)) !== null) {
    headings.push({ heading: m[2]!.trim(), idx: m.index });
  }

  if (headings.length === 0) {
    // No headings — whole file is one instruction
    return [{ source: filePath, heading: 'cursorrules', body: trimmed }];
  }

  // Text before first heading = preamble
  if (headings[0]!.idx > 0) {
    const preamble = trimmed.slice(0, headings[0]!.idx).trim();
    if (preamble) {
      instructions.push({ source: filePath, heading: 'cursorrules (preamble)', body: preamble });
    }
  }

  // Each heading starts a section that runs until the next heading
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i]!;
    const end = i + 1 < headings.length ? headings[i + 1]!.idx : trimmed.length;
    // Body starts after the heading line
    const headingLineEnd = trimmed.indexOf('\n', start.idx);
    const bodyStart = headingLineEnd === -1 ? trimmed.length : headingLineEnd + 1;
    const body = trimmed.slice(bodyStart, end).trim();
    if (body) {
      instructions.push({
        source: filePath,
        heading: start.heading.slice(0, 60),
        body,
      });
    }
  }

  return instructions;
}

/**
 * Scan a project directory for Cursor instruction files and parse them.
 * Looks for:
 * - .cursor/rules/*.mdc
 * - .cursorrules (root)
 * - .windsurfrules (root)
 */
/** Max file size to read (1MB) — prevents OOM on accidentally large files. */
const MAX_FILE_SIZE = 1024 * 1024;

export function scanCursorInstructions(projectRoot: string): CursorInstruction[] {
  const instructions: CursorInstruction[] = [];

  // Scan .cursor/rules/*.mdc
  const mdcDir = path.join(projectRoot, '.cursor', 'rules');
  if (fs.existsSync(mdcDir)) {
    const files = fs.readdirSync(mdcDir).filter((f) => f.endsWith('.mdc'));
    for (const file of files) {
      const fullPath = path.join(mdcDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
      const parsed = parseMdcFile(relativePath, content);
      if (parsed) instructions.push(parsed);
    }
  }

  // Scan root .cursorrules
  const cursorrules = path.join(projectRoot, '.cursorrules');
  if (fs.existsSync(cursorrules) && fs.statSync(cursorrules).size <= MAX_FILE_SIZE) {
    const content = fs.readFileSync(cursorrules, 'utf-8');
    instructions.push(...parseCursorRulesFile('.cursorrules', content));
  }

  // Scan root .windsurfrules
  const windsurfrules = path.join(projectRoot, '.windsurfrules');
  if (fs.existsSync(windsurfrules) && fs.statSync(windsurfrules).size <= MAX_FILE_SIZE) {
    const content = fs.readFileSync(windsurfrules, 'utf-8');
    instructions.push(...parseCursorRulesFile('.windsurfrules', content));
  }

  return instructions;
}
