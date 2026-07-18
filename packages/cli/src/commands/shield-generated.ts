import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Imported from the CLI's own `utils` re-export barrel (NOT '@mmnto/totem'
// directly) so this command module avoids a static top-level import of the
// heavy core barrel at startup (mmnto-ai/totem#2339).
import { matchesGlob, sanitize, wrapXml } from '../utils.js';

/**
 * Generated-artifact exclusion for the review synthesis input (mmnto-ai/totem#2398).
 *
 * `totem review` used to send generated-artifact bytes (lockfiles,
 * `compiled-rules.json`, `dist/**`, `*.wasm`, regenerated dashboards) to the LLM
 * as part of the review diff. The only exclusion mechanism was `ignorePatterns`
 * — opt-in, empty by default, and a **silent drop**: an excluded file simply
 * vanished from the payload, losing the signal that it changed at all.
 *
 * This module classifies generated artifacts by default and replaces their
 * bytes with a per-file SUMMARY (path, change shape, size delta, semantic hash)
 * injected into the synthesis input. The reviewer keeps the "this regenerated"
 * signal without paying review-context tokens for bytes no reviewer should read.
 *
 * Cautionary sibling #2329: the injected summary is CLEARLY LABELLED as a
 * Totem-generated summarization artifact (a distinct XML tag + a preamble that
 * says "not diff content") so the model cannot mistake it for real diff content
 * the way secret-redaction's env-var rewriting was mistaken for a real read.
 *
 * Aligns with the Prop 297 taxonomy (GENERATED spans take regeneration-diff
 * treatment, never prose review — mmnto-ai/totem-strategy#639 operating spec).
 */

// ─── Default seeded globs ────────────────────────────────

/**
 * The default generated-artifact classification for the review payload. Seeded
 * globs covering the classes the issue names (lockfiles, `compiled-rules.json`,
 * `dist/**`, `*.wasm`) plus the conventional build-output + compiled-web set.
 *
 * These globs use `matchesGlob` semantics (see `@mmnto/totem` `matchesGlob`):
 * `**​/name` matches `name` at any depth, `**​/dir/**` matches a directory tree
 * at any depth, `*.ext` matches an extension anywhere.
 *
 * A false positive here strips a real-code file from LLM review — but it is
 * NEVER a silent drop: every excluded file is loudly named in the injected
 * summary (path + hash), and a repo un-marks a false positive Git-natively via
 * `.gitattributes` `linguist-generated=false` (honored below). Repos extend the
 * set the same way (`path/to/thing linguist-generated`).
 */
export const DEFAULT_GENERATED_ARTIFACT_GLOBS: readonly string[] = [
  // Dependency lockfiles — machine-regenerated, never meaningfully hand-authored.
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/npm-shrinkwrap.json',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/go.sum',
  '**/flake.lock',
  // Totem compiled artifacts (issue-named).
  '**/.totem/compiled-rules.json',
  '**/.totem/compile-manifest.json',
  // Conventional build-output directories.
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  // Compiled / minified / binary web + WASM artifacts (issue-named `*.wasm`).
  '**/*.wasm',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.tsbuildinfo',
];

// ─── .gitattributes linguist-generated ──────────────────

/** Cap on the `.gitattributes` bytes read — a defensive bound, real files are tiny. */
const MAX_GITATTRIBUTES_BYTES = 256 * 1024;

/**
 * Patterns parsed from a repo's `.gitattributes` `linguist-generated` markers:
 *   - `generated` — patterns marked `linguist-generated` or `linguist-generated=true`
 *     (ADD to the classification).
 *   - `notGenerated` — patterns marked `linguist-generated=false` (an explicit
 *     un-mark that OVERRIDES a default-glob match — the Git-native escape hatch).
 */
export interface GitattributesGeneratedPatterns {
  generated: string[];
  notGenerated: string[];
}

/**
 * Translate a `.gitattributes` path pattern into a `matchesGlob`-compatible glob.
 *
 * Full gitattributes/gitignore pattern fidelity is out of scope; this covers the
 * common forms the classification cares about:
 *   - a leading `/` (root-anchored) is stripped — `matchesGlob` treats a
 *     slash-bearing literal as repo-root-relative already;
 *   - a trailing `/` (directory) becomes `<dir>/**` so the tree is matched;
 *   - bare patterns (`*.lock`, `foo.map`) pass through — `matchesGlob` already
 *     matches those at any depth.
 */
export function gitattributesPatternToGlob(pattern: string): string {
  let p = pattern.trim();
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = `${p}**`;
  return p;
}

/**
 * Parse `.gitattributes` at the repo root for `linguist-generated` markers.
 * Returns empty pattern lists when the file is absent or unreadable (best-effort
 * enrichment — a missing `.gitattributes` is never an error). Comment lines
 * (`#…`) and macro lines (`[attr]…`) are ignored.
 */
export function readGitattributesGeneratedPatterns(cwd: string): GitattributesGeneratedPatterns {
  const generated: string[] = [];
  const notGenerated: string[] = [];
  const file = path.join(cwd, '.gitattributes');
  let raw: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_GITATTRIBUTES_BYTES) {
      return { generated, notGenerated };
    }
    raw = fs.readFileSync(file, 'utf-8');
    // totem-context: intentional cleanup — an absent / unreadable .gitattributes is honest-absent (the seeded default globs still apply); this best-effort enrichment read must never crash the review, so degrading to "no repo-declared patterns" is correct, not a swallowed error (mmnto-ai/totem#2398).
  } catch {
    return { generated, notGenerated };
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    // A gitattributes line is `<pattern> <attr> <attr> …`. Split on whitespace;
    // the first token is the pattern, the rest are attributes.
    const tokens = trimmed.split(/\s+/);
    const pattern = tokens[0];
    if (pattern === undefined || pattern.length === 0) continue;
    const attrs = tokens.slice(1);
    for (const attr of attrs) {
      if (attr === 'linguist-generated' || attr === 'linguist-generated=true') {
        generated.push(gitattributesPatternToGlob(pattern));
      } else if (attr === '-linguist-generated' || attr === 'linguist-generated=false') {
        // `-attr` and `attr=false` both UNSET the attribute in git's model.
        notGenerated.push(gitattributesPatternToGlob(pattern));
      }
    }
  }
  return { generated, notGenerated };
}

// ─── Classification ──────────────────────────────────────

export type GeneratedChangeShape = 'added' | 'deleted' | 'regenerated';

/**
 * A per-file summary of an excluded generated artifact. `addedLines` /
 * `removedLines` are the unified-diff insertion/deletion counts (the available
 * size-delta proxy, since the bytes themselves are excluded by design);
 * `binary` marks a file git reported as a binary change (no line counts).
 * `hash` is a semantic hash: sha256 (first 12 hex) over the file's own diff
 * segment — a stable fingerprint of exactly what was excluded.
 */
export interface GeneratedArtifactSummary {
  file: string;
  shape: GeneratedChangeShape;
  addedLines: number;
  removedLines: number;
  binary: boolean;
  hash: string;
}

export interface GeneratedArtifactClassification {
  /** Repo-relative paths classified as generated artifacts (bytes excluded). */
  artifactFiles: string[];
  /** Per-file summaries, in diff order. */
  summaries: GeneratedArtifactSummary[];
  /** The diff with every generated-artifact section removed (byte-identical to the input when none matched). */
  keptDiff: string;
  /** `changedFiles` minus the generated artifacts. */
  keptFiles: string[];
}

export interface ClassifyGeneratedArtifactsParams {
  diff: string;
  changedFiles: string[];
  /** Positive globs (defaults + `.gitattributes` generated). Defaults to {@link DEFAULT_GENERATED_ARTIFACT_GLOBS}. */
  generatedGlobs?: readonly string[];
  /** Un-mark globs (`.gitattributes` `linguist-generated=false`) — a match here is NEVER a generated artifact. */
  excludeGlobs?: readonly string[];
}

/**
 * A single file's section of a unified diff, with its destination path.
 * `file` is `null` for a leading preamble section (the text before the first
 * `diff --git`, normally empty) or a section whose header does not parse.
 */
interface DiffFileSection {
  file: string | null;
  section: string;
}

/**
 * Split a unified diff into per-file sections at `diff --git` boundaries and
 * extract each section's destination (`b/`) path. Mirrors the split + path
 * extraction that `filterDiffByPatterns` / `extractChangedFiles` use so the two
 * agree on file identity. Joining `section` values back reconstructs the input
 * exactly (the zero-width split consumes no characters).
 */
export function splitDiffIntoFileSections(diff: string): DiffFileSection[] {
  const rawSections = diff.split(/^(?=diff --git )/m);
  return rawSections
    .filter((section) => section.length > 0)
    .map((section) => {
      // A section with no newline at all (a truncated diff tail) must use the
      // WHOLE section as its first line — indexOf's -1 would otherwise slice
      // off the final character and break the $-anchored filename match (GCA
      // round on #2443).
      const newlineIdx = section.indexOf('\n');
      const firstLine = newlineIdx === -1 ? section : section.slice(0, newlineIdx);
      const quoted = firstLine.match(/^diff --git "a\/.*?" "b\/(.*?)"$/);
      const unquoted = firstLine.match(/^diff --git a\/\S+ b\/(.+)$/);
      const file = quoted?.[1] ?? unquoted?.[1] ?? null;
      return { file, section };
    });
}

/** Semantic hash of an excluded artifact's diff segment: sha256, first 12 hex chars. */
export function hashDiffSection(section: string): string {
  return crypto.createHash('sha256').update(section, 'utf-8').digest('hex').slice(0, 12);
}

/** Summarize one generated-artifact diff section (shape + size delta + hash). */
function summarizeSection(file: string, section: string): GeneratedArtifactSummary {
  const shape: GeneratedChangeShape = /^new file mode /m.test(section)
    ? 'added'
    : /^deleted file mode /m.test(section)
      ? 'deleted'
      : 'regenerated';
  const binary = /^Binary files /m.test(section) || /^GIT binary patch/m.test(section);

  let addedLines = 0;
  let removedLines = 0;
  if (!binary) {
    for (const line of section.split('\n')) {
      // Skip the `+++ `/`--- ` file-header lines (always a space or /dev/null
      // after the triple marker); a bare `+++`/`---` prefix check would also
      // swallow real hunk content like `++i;` → `+++i;` (GCA round on #2443).
      if (line.startsWith('+') && !line.startsWith('+++ ')) addedLines++;
      else if (line.startsWith('-') && !line.startsWith('--- ')) removedLines++;
    }
  }

  return { file, shape, addedLines, removedLines, binary, hash: hashDiffSection(section) };
}

/**
 * Classify the changed files into generated artifacts vs. kept files, remove the
 * artifact sections from the diff, and build a per-file summary of each excluded
 * artifact. A file is a generated artifact iff it matches ANY positive glob AND
 * matches NO un-mark (exclude) glob.
 *
 * When no artifact matches, `keptDiff === diff` and `keptFiles === changedFiles`
 * (order preserved) — the legacy review payload is byte-identical, so callers
 * can gate the new path on `summaries.length > 0`.
 */
export function classifyGeneratedArtifacts(
  params: ClassifyGeneratedArtifactsParams,
): GeneratedArtifactClassification {
  const generatedGlobs = params.generatedGlobs ?? DEFAULT_GENERATED_ARTIFACT_GLOBS;
  const excludeGlobs = params.excludeGlobs ?? [];

  const isGenerated = (file: string): boolean =>
    generatedGlobs.some((g) => matchesGlob(file, g)) &&
    !excludeGlobs.some((g) => matchesGlob(file, g));

  const artifactSet = new Set<string>();
  const summaries: GeneratedArtifactSummary[] = [];
  const keptSections: string[] = [];

  for (const { file, section } of splitDiffIntoFileSections(params.diff)) {
    if (file !== null && isGenerated(file)) {
      artifactSet.add(file);
      summaries.push(summarizeSection(file, section));
    } else {
      keptSections.push(section);
    }
  }

  // Derive kept files from the ORIGINAL changedFiles (preserves order + covers
  // any file the diff-section parse might miss), subtracting the classified set.
  const keptFiles = params.changedFiles.filter((f) => !artifactSet.has(f));

  return {
    artifactFiles: [...artifactSet],
    summaries,
    keptDiff: keptSections.join(''), // totem-ignore (#669) — joining diff sections, not text fragments
    keptFiles,
  };
}

// ─── Summary rendering ───────────────────────────────────

const SHAPE_LABEL: Record<GeneratedChangeShape, string> = {
  added: 'added',
  deleted: 'deleted',
  regenerated: 'regenerated',
};

/** One operator-visible / prompt line for an excluded artifact. Paths are sanitized. */
export function formatGeneratedArtifactLine(summary: GeneratedArtifactSummary): string {
  const delta = summary.binary ? 'binary' : `+${summary.addedLines}/-${summary.removedLines} lines`;
  return `- ${sanitize(summary.file)} — ${SHAPE_LABEL[summary.shape]}, ${delta}, hash ${summary.hash}`;
}

/**
 * Build the synthesis-input section for the excluded generated artifacts.
 * Returns `''` when there are no artifacts (so the caller injects nothing on the
 * legacy path). The body is wrapped in a distinct XML tag and the preamble
 * states plainly that these lines are a Totem-generated summary, NOT diff
 * content — the #2329 mislabel guard.
 */
export function buildGeneratedArtifactSection(summaries: GeneratedArtifactSummary[]): string {
  if (summaries.length === 0) return '';
  const lines = summaries.map(formatGeneratedArtifactLine).join('\n');
  const preamble =
    'The files below changed but their BYTES WERE EXCLUDED from this review because ' +
    'they are generated artifacts (lockfiles, compiled outputs, build products). ' +
    'This block is a TOTEM-GENERATED SUMMARY, not diff content — do NOT treat these ' +
    'lines as code under review, and do NOT emit findings about them. Their ' +
    'correctness is the job of deterministic regeneration gates (e.g. `totem lint`, ' +
    'lockfile-sync), not prose review. Each line is: path — change shape, size ' +
    'delta (unified-diff insert/delete counts), semantic hash (sha256/12 of the ' +
    "excluded file's diff segment).";
  return [
    '\n=== EXCLUDED GENERATED ARTIFACTS (TOTEM SUMMARY — NOT DIFF CONTENT) ===',
    preamble,
    wrapXml('generated_artifacts_summary', lines),
  ].join('\n');
}
