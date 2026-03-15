import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isCancel, multiselect } from '@clack/prompts';

import { sanitize } from '@mmnto/totem';

import { ghExec } from '../adapters/gh-utils.js';
import type { StandardIssueListItem } from '../adapters/issue-adapter.js';
import { log } from '../ui.js';
import {
  getSystemPrompt,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Audit';
const GH_ISSUE_LIMIT = 100;
/** Max size for strategic context to avoid exceeding LLM context window (~100KB ≈ 25k tokens). */
export const MAX_STRATEGIC_CONTEXT_CHARS = 100_000;

/** Actions the LLM can propose for each issue. */
const VALID_ACTIONS = ['KEEP', 'CLOSE', 'REPRIORITIZE', 'MERGE'] as const;
type AuditAction = (typeof VALID_ACTIONS)[number];

// ─── Types ──────────────────────────────────────────────

export interface AuditProposal {
  number: number;
  title: string;
  action: AuditAction;
  newTier?: string;
  mergeInto?: number;
  rationale: string;
}

export interface AuditOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  context?: string;
}

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Audit System Prompt — Strategic Backlog Audit

## Identity & Role
You are a ruthless Product Manager auditing an open issue backlog against the project's strategic direction. Your job is to propose which issues to KEEP, CLOSE, REPRIORITIZE, or MERGE. A focused backlog (15-20 issues) is healthier than a sprawling one.

## Core Rules
- **Bias toward closing.** If an issue is obsolete, duplicated, vague, or misaligned with the current strategy, propose CLOSE.
- **One-sentence rationale per row.** Every proposal must have a clear, concise reason.
- **No new issues.** You only audit what exists. Do not propose creating new work.
- **Respect tier labels.** tier-1 = current sprint, tier-2 = next cycle, tier-3 = backlog/future.
- **MERGE means consolidate.** When two issues overlap significantly, propose merging the smaller into the larger (specify mergeInto number).

## Output Format
Respond with ONLY a JSON array inside <audit_proposals> tags. No preamble, no closing remarks.

Each element:
{
  "number": <issue number>,
  "title": "<issue title>",
  "action": "KEEP" | "CLOSE" | "REPRIORITIZE" | "MERGE",
  "newTier": "<tier-1|tier-2|tier-3>" (only if REPRIORITIZE),
  "mergeInto": <issue number> (only if MERGE),
  "rationale": "<one sentence>"
}

Example:
<audit_proposals>
[
  { "number": 42, "title": "Add widget support", "action": "KEEP", "rationale": "Aligns with Phase 3 roadmap goals." },
  { "number": 99, "title": "Legacy auth cleanup", "action": "CLOSE", "rationale": "Superseded by #150 (new auth system)." },
  { "number": 55, "title": "Perf optimization", "action": "REPRIORITIZE", "newTier": "tier-3", "rationale": "No user-facing impact yet; defer to post-1.0." },
  { "number": 88, "title": "Widget colors", "action": "MERGE", "mergeInto": 42, "rationale": "Subset of #42 scope." }
]
</audit_proposals>
`;

// ─── Strategic context loading ──────────────────────────

export function loadStrategicDocs(cwd: string): string {
  const strategyDir = path.join(cwd, '.strategy');
  const docPaths = [path.join(cwd, 'docs', 'roadmap.md'), path.join(cwd, 'docs', 'active_work.md')];

  const sections: string[] = [];

  // Load root-level .strategy/*.md files (skip subdirs)
  if (fs.existsSync(strategyDir)) {
    const entries = fs.readdirSync(strategyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = fs.readFileSync(path.join(strategyDir, entry.name), 'utf-8');
        sections.push(`### ${entry.name}\n${content}`);
      }
    }
  }

  // Load roadmap and active_work
  for (const docPath of docPaths) {
    if (fs.existsSync(docPath)) {
      const content = fs.readFileSync(docPath, 'utf-8');
      const name = path.basename(docPath);
      sections.push(`### ${name}\n${content}`);
    }
  }

  const combined = sections.join('\n\n---\n\n');
  if (combined.length > MAX_STRATEGIC_CONTEXT_CHARS) {
    log.warn(
      TAG,
      `Strategic context truncated from ${(combined.length / 1024).toFixed(0)}KB to ${(MAX_STRATEGIC_CONTEXT_CHARS / 1024).toFixed(0)}KB to stay within LLM limits.`,
    );
    return combined.slice(0, MAX_STRATEGIC_CONTEXT_CHARS);
  }
  return combined;
}

// ─── Response parsing ───────────────────────────────────

export function parseAuditResponse(content: string): AuditProposal[] {
  const match = content.match(/<audit_proposals>([\s\S]*?)<\/audit_proposals>/);
  if (!match) {
    throw new Error(
      '[Totem Error] LLM response missing <audit_proposals> wrapper. Re-run or check prompt.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    throw new Error('[Totem Error] Failed to parse audit proposals as JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('[Totem Error] Audit proposals must be a JSON array.');
  }

  const VALID_TIERS = ['tier-1', 'tier-2', 'tier-3'];

  return (parsed as Record<string, unknown>[]).map((item, i) => {
    if (typeof item.number !== 'number') {
      throw new Error(`[Totem Error] Invalid or missing "number" for proposal ${i}.`);
    }
    const action = String(item.action ?? '').toUpperCase() as AuditAction;
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(
        `[Totem Error] Invalid action "${item.action}" for proposal ${i}. Must be one of: ${VALID_ACTIONS.join(', ')}`,
      );
    }
    if (action === 'MERGE' && typeof item.mergeInto !== 'number') {
      throw new Error(`[Totem Error] Invalid or missing "mergeInto" for MERGE proposal ${i}.`);
    }
    if (
      action === 'REPRIORITIZE' &&
      (typeof item.newTier !== 'string' || !VALID_TIERS.includes(item.newTier))
    ) {
      throw new Error(
        `[Totem Error] Invalid "newTier" for REPRIORITIZE proposal ${i}. Must be one of: ${VALID_TIERS.join(', ')}.`,
      );
    }
    return {
      number: item.number,
      title: String(item.title ?? ''),
      action,
      newTier: item.newTier as string | undefined,
      mergeInto: item.mergeInto as number | undefined,
      rationale: String(item.rationale ?? ''),
    };
  });
}

// ─── Proposal display ───────────────────────────────────

const ACTION_LABELS: Record<AuditAction, string> = {
  KEEP: 'KEEP',
  CLOSE: 'CLOSE',
  REPRIORITIZE: 'REPRI',
  MERGE: 'MERGE',
};

export function formatProposalTable(proposals: AuditProposal[]): string {
  const rows = proposals.map((p) => {
    let detail = '';
    if (p.action === 'REPRIORITIZE' && p.newTier) detail = ` → ${p.newTier}`;
    if (p.action === 'MERGE' && p.mergeInto) detail = ` → #${p.mergeInto}`;
    return `| #${p.number} | ${sanitize(p.title)} | ${ACTION_LABELS[p.action]}${detail} | ${sanitize(p.rationale)} |`;
  });

  return ['| Issue | Title | Action | Rationale |', '|---|---|---|---|', ...rows].join('\n');
}

// ─── Interactive approval ───────────────────────────────

/** Filter proposals to only actionable ones (not KEEP). */
function getActionableProposals(proposals: AuditProposal[]): AuditProposal[] {
  return proposals.filter((p) => p.action !== 'KEEP');
}

export async function selectProposals(
  proposals: AuditProposal[],
  opts: { yes?: boolean; isTTY?: boolean },
): Promise<AuditProposal[]> {
  const actionable = getActionableProposals(proposals);

  if (actionable.length === 0) {
    log.info(TAG, 'No actionable proposals (all KEEP). Nothing to execute.');
    return [];
  }

  if (opts.yes) {
    return actionable;
  }

  if (!opts.isTTY) {
    throw new Error(
      '[Totem Error] Refusing to modify issues in non-interactive mode. Use --yes to bypass confirmation.',
    );
  }

  const result = await multiselect({
    message: `Select proposals to execute (${actionable.length} actionable):`,
    options: actionable.map((p, i) => {
      let label = `#${p.number} — ${ACTION_LABELS[p.action]}`;
      if (p.action === 'REPRIORITIZE' && p.newTier) label += ` → ${p.newTier}`;
      if (p.action === 'MERGE' && p.mergeInto) label += ` → #${p.mergeInto}`;
      return {
        value: i,
        label,
        hint: sanitize(p.rationale),
      };
    }),
    initialValues: actionable.map((_, i) => i),
    required: false,
  });

  if (isCancel(result)) {
    log.warn(TAG, 'Cancelled. No changes made.');
    return [];
  }

  return (result as number[]).map((i) => actionable[i]!);
}

// ─── Execution ──────────────────────────────────────────

/**
 * Post a comment on an issue using --body-file to avoid shell injection.
 * LLM-generated rationale text could contain shell metacharacters; writing
 * to a temp file and using --body-file sidesteps this entirely.
 */
function ghComment(issueNumber: number, body: string, cwd: string): void {
  const tmpFile = path.join(os.tmpdir(), `totem-audit-comment-${crypto.randomUUID()}.md`); // totem-ignore — ephemeral temp file, deleted in finally block
  try {
    fs.writeFileSync(tmpFile, body, 'utf-8');
    ghExec(['issue', 'comment', String(issueNumber), '--body-file', tmpFile], cwd);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Validate that all MERGE targets reference issues that exist in the backlog.
 */
export function validateMergeTargets(
  proposals: AuditProposal[],
  issueNumbers: Set<number>,
): string[] {
  const errors: string[] = [];
  for (const p of proposals) {
    if (p.action === 'MERGE' && p.mergeInto && !issueNumbers.has(p.mergeInto)) {
      errors.push(`#${p.number} proposes MERGE into #${p.mergeInto} which is not in the backlog`);
    }
  }
  return errors;
}

export interface ExecutionResult {
  succeeded: number;
  failed: number;
  errors: string[];
}

export function executeProposals(proposals: AuditProposal[], cwd: string): ExecutionResult {
  const result: ExecutionResult = { succeeded: 0, failed: 0, errors: [] };

  for (const p of proposals) {
    try {
      switch (p.action) {
        case 'CLOSE': {
          ghComment(p.number, `Closed via \`totem audit\` — ${p.rationale}`, cwd);
          ghExec(['issue', 'close', String(p.number)], cwd);
          log.success(TAG, `Closed #${p.number}`);
          result.succeeded++;
          break;
        }
        case 'REPRIORITIZE': {
          if (!p.newTier) {
            const msg = `REPRIORITIZE proposal for #${p.number} missing newTier`;
            log.warn(TAG, msg);
            result.failed++;
            result.errors.push(msg);
            break;
          }
          const removals = ['tier-1', 'tier-2', 'tier-3']
            .filter((t) => t !== p.newTier)
            .flatMap((t) => ['--remove-label', t]);
          ghExec(['issue', 'edit', String(p.number), '--add-label', p.newTier, ...removals], cwd);
          ghComment(
            p.number,
            `Reprioritized to ${p.newTier} via \`totem audit\` — ${p.rationale}`,
            cwd,
          );
          log.success(TAG, `Reprioritized #${p.number} → ${p.newTier}`);
          result.succeeded++;
          break;
        }
        case 'MERGE': {
          if (!p.mergeInto) {
            const msg = `MERGE proposal for #${p.number} missing mergeInto`;
            log.warn(TAG, msg);
            result.failed++;
            result.errors.push(msg);
            break;
          }
          ghComment(
            p.number,
            `Merged into #${p.mergeInto} via \`totem audit\` — ${p.rationale}`,
            cwd,
          );
          ghExec(['issue', 'close', String(p.number), '--reason', 'not planned'], cwd);
          ghComment(p.mergeInto, `#${p.number} merged into this issue via \`totem audit\`.`, cwd);
          log.success(TAG, `Merged #${p.number} → #${p.mergeInto}`);
          result.succeeded++;
          break;
        }
        case 'KEEP':
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Totem Error', `Failed to execute proposal for #${p.number}: ${sanitize(msg)}`); // totem-ignore — sanitize wraps error
      result.failed++;
      result.errors.push(`#${p.number}: ${msg}`);
    }
  }

  return result;
}

// ─── Prompt assembly ────────────────────────────────────

export function formatIssueInventory(issues: StandardIssueListItem[]): string {
  const rows = issues.map((i) => {
    const labels = i.labels.join(', ') || '(none)';
    const updated = i.updatedAt.slice(0, 10);
    return `| #${i.number} | ${i.title} | ${labels} | ${updated} |`;
  });

  return ['| Issue | Title | Labels | Updated |', '|---|---|---|---|', ...rows].join('\n');
}

function assemblePrompt(
  issues: StandardIssueListItem[],
  strategicContext: string,
  systemPrompt: string,
  userContext?: string,
): string {
  const sections: string[] = [systemPrompt];

  // Issue inventory
  sections.push('=== OPEN ISSUES ===');
  sections.push(`Total: ${issues.length} open issues\n`);
  sections.push(wrapXml('issue_list', formatIssueInventory(issues)));

  // Strategic context
  if (strategicContext) {
    sections.push('\n=== STRATEGIC CONTEXT ===');
    sections.push(wrapXml('strategic_docs', strategicContext));
  }

  // User-supplied context (--context flag)
  if (userContext) {
    sections.push('\n=== AUDIT LENS ===');
    sections.push(
      'The user has provided the following strategic lens for this audit. Weight your proposals accordingly:',
    );
    sections.push(wrapXml('user_context', userContext));
  }

  return sections.join('\n');
}

// ─── Main command ───────────────────────────────────────

export async function auditCommand(options: AuditOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Fetch open issues
  log.info(TAG, 'Fetching open issues...');
  const { createIssueAdapter } = await import('../adapters/create-issue-adapter.js');
  const adapter = await createIssueAdapter(cwd, config);
  const issues = adapter.fetchOpenIssues(GH_ISSUE_LIMIT);

  if (issues.length === 0) {
    log.warn(TAG, 'No open issues found. Nothing to audit.');
    return;
  }

  log.info(TAG, `Found ${issues.length} open issues.`);

  // Load strategic context
  log.info(TAG, 'Loading strategic context...');
  const strategicContext = loadStrategicDocs(cwd);
  log.dim(TAG, `Strategic context: ${(strategicContext.length / 1024).toFixed(0)}KB`);

  // Resolve system prompt (allow .totem/prompts/audit.md override)
  const systemPrompt = getSystemPrompt('audit', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(issues, strategicContext, systemPrompt, options.context);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    totalResults: issues.length,
  });

  if (content == null) return;

  // --raw or --out without interactive: just write and exit
  if (options.out && !options.dryRun) {
    writeOutput(content, options.out);
    log.success(TAG, `Written to ${options.out}`);
  }

  // Parse proposals
  let proposals: AuditProposal[];
  try {
    proposals = parseAuditResponse(content);
  } catch (err) {
    // If parsing fails, output raw content so user can see what the LLM produced
    writeOutput(content);
    throw err;
  }

  log.info(TAG, `${proposals.length} proposals parsed.`);

  // Display table
  const table = formatProposalTable(proposals);
  writeOutput(`\n${table}\n`);

  const actionable = getActionableProposals(proposals);
  const closes = proposals.filter((p) => p.action === 'CLOSE').length;
  const repris = proposals.filter((p) => p.action === 'REPRIORITIZE').length;
  const merges = proposals.filter((p) => p.action === 'MERGE').length;
  const keeps = proposals.filter((p) => p.action === 'KEEP').length;

  log.info(TAG, `Summary: ${keeps} KEEP, ${closes} CLOSE, ${repris} REPRIORITIZE, ${merges} MERGE`);

  // Dry-run: stop here
  if (options.dryRun) {
    log.info(TAG, 'Dry run — no changes made.');
    return;
  }

  if (actionable.length === 0) {
    log.info(TAG, 'No actionable proposals. Backlog looks healthy.');
    return;
  }

  // Interactive approval
  let selected = await selectProposals(proposals, {
    yes: options.yes,
    isTTY: !!process.stdin.isTTY,
  });

  if (selected.length === 0) {
    log.info(TAG, 'No proposals selected. No changes made.');
    return;
  }

  // Validate merge targets — filter out invalid ones
  const issueNumbers = new Set(issues.map((i) => i.number));
  const mergeErrors = validateMergeTargets(selected, issueNumbers);
  if (mergeErrors.length > 0) {
    for (const err of mergeErrors) {
      log.warn(TAG, `Invalid merge target: ${err}`); // totem-ignore — err is our own validation string, not an Error object
    }
    selected = selected.filter(
      (p) => !(p.action === 'MERGE' && p.mergeInto && !issueNumbers.has(p.mergeInto)),
    );
    if (selected.length === 0) {
      log.info(TAG, 'No valid proposals remaining after filtering. No changes made.');
      return;
    }
  }

  // Execute
  log.info(TAG, `Executing ${selected.length} proposal(s)...`);
  const result = executeProposals(selected, cwd);
  if (result.failed > 0) {
    log.warn(TAG, `${result.failed} proposal(s) failed. See errors above.`); // totem-ignore — result is our own counter
  }
  log.success(TAG, `Done — ${result.succeeded} issue(s) updated.`); // totem-ignore — result is our own counter
}
