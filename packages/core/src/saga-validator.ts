// ─── Saga Validator ─────────────────────────────────────
// Deterministic post-update validator for totem docs.
// Catches LLM hallucinations (checkbox mutations, sentinel corruption,
// frontmatter deletion, excessive content loss) BEFORE writing to disk.
// See: #351, deep-research-architectural-frameworks-context-integrity.md

// ─── Types ──────────────────────────────────────────────

export type ViolationType =
  | 'checkbox_mutation'
  | 'sentinel_corruption'
  | 'frontmatter_deleted'
  | 'excessive_deletion';

export interface SagaViolation {
  type: ViolationType;
  message: string;
  /** 1-based line number in the updated content (when applicable) */
  line?: number;
}

// ─── Checkbox detection ─────────────────────────────────

interface CheckboxEntry {
  state: 'x' | ' ';
  text: string;
  line: number;
}

const CHECKBOX_RE = /^(\s*[-*])\s*\[([ xX])\]\s+(.+)/;

function extractCheckboxes(content: string): CheckboxEntry[] {
  const entries: CheckboxEntry[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = CHECKBOX_RE.exec(lines[i]!);
    if (match) {
      entries.push({
        state: match[2]!.toLowerCase() === 'x' ? 'x' : ' ',
        text: match[3]!.trim(),
        line: i + 1,
      });
    }
  }

  return entries;
}

/**
 * Normalize checkbox text for fuzzy matching.
 * Strips markdown formatting, collapses whitespace, lowercases.
 */
function normalizeCheckboxText(text: string): string {
  return text
    .replace(/\*\*|__|~~|`/g, '') // strip inline formatting
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function detectCheckboxMutations(original: string, updated: string): SagaViolation[] {
  const origCheckboxes = extractCheckboxes(original);
  const updatedCheckboxes = extractCheckboxes(updated);

  if (origCheckboxes.length === 0) return [];

  // Build a lookup from normalized text → state for the updated content
  const updatedMap = new Map<string, CheckboxEntry>();
  for (const cb of updatedCheckboxes) {
    updatedMap.set(normalizeCheckboxText(cb.text), cb);
  }

  const violations: SagaViolation[] = [];

  for (const orig of origCheckboxes) {
    const key = normalizeCheckboxText(orig.text);
    const match = updatedMap.get(key);
    if (match && match.state !== orig.state) {
      const direction = orig.state === 'x' ? 'unchecked' : 'checked';
      violations.push({
        type: 'checkbox_mutation',
        message: `Checkbox "${orig.text.slice(0, 60)}" was ${direction} (line ${match.line} in updated)`,
        line: match.line,
      });
    }
  }

  return violations;
}

// ─── Sentinel validation ────────────────────────────────

function detectSentinelCorruption(updated: string): SagaViolation[] {
  const violations: SagaViolation[] = [];
  const lines = updated.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Check for totem sentinels that are not properly closed
    if (line.includes('<!-- totem-') && !line.includes('-->')) {
      violations.push({
        type: 'sentinel_corruption',
        message: `Unclosed totem sentinel on line ${i + 1}`,
        line: i + 1,
      });
    }
  }

  return violations;
}

// ─── Frontmatter validation ─────────────────────────────

function detectFrontmatterDeletion(original: string, updated: string): SagaViolation[] {
  const hasFrontmatter = original.trimStart().startsWith('---');
  if (hasFrontmatter && !updated.trimStart().startsWith('---')) {
    return [
      {
        type: 'frontmatter_deleted',
        message: 'YAML frontmatter block was deleted by the update',
      },
    ];
  }
  return [];
}

// ─── Length validation ──────────────────────────────────

const DELETION_THRESHOLD = 0.5;

function detectExcessiveDeletion(original: string, updated: string): SagaViolation[] {
  // Only flag if original is non-trivial (> 100 chars)
  if (original.length < 100) return [];

  const ratio = updated.length / original.length;
  if (ratio < DELETION_THRESHOLD) {
    return [
      {
        type: 'excessive_deletion',
        message: `Updated content is ${Math.round(ratio * 100)}% of original length (threshold: ${Math.round(DELETION_THRESHOLD * 100)}%)`,
      },
    ];
  }
  return [];
}

// ─── Public API ─────────────────────────────────────────

/**
 * Validate an LLM-generated document update against the original.
 * Returns an array of violations. Empty array = update is safe to write.
 */
export function validateDocUpdate(original: string, updated: string): SagaViolation[] {
  return [
    ...detectCheckboxMutations(original, updated),
    ...detectSentinelCorruption(updated),
    ...detectFrontmatterDeletion(original, updated),
    ...detectExcessiveDeletion(original, updated),
  ];
}
