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
  const sections = content.split(/\n#{1,3}\s+/).filter((s) => s.trim());
  if (sections.length === 0) return [];

  // If no headings, treat the whole file as one instruction
  if (sections.length === 1) {
    const body = content.trim();
    if (!body) return [];
    return [
      {
        source: filePath,
        heading: 'cursorrules',
        body,
      },
    ];
  }

  // Each heading-delimited section becomes an instruction
  return sections
    .map((section, i) => {
      const lines = section.split('\n');
      const heading =
        i === 0 ? 'cursorrules (preamble)' : (lines[0]?.trim().slice(0, 60) ?? `rule-${i}`);
      const body = (i === 0 ? lines : lines.slice(1)).join('\n').trim();
      if (!body) return null;
      return { source: filePath, heading, body };
    })
    .filter((x): x is CursorInstruction => x !== null);
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
  if (fs.existsSync(cursorrules)) {
    const content = fs.readFileSync(cursorrules, 'utf-8');
    instructions.push(...parseCursorRulesFile('.cursorrules', content));
  }

  // Scan root .windsurfrules
  const windsurfrules = path.join(projectRoot, '.windsurfrules');
  if (fs.existsSync(windsurfrules)) {
    const content = fs.readFileSync(windsurfrules, 'utf-8');
    instructions.push(...parseCursorRulesFile('.windsurfrules', content));
  }

  return instructions;
}
