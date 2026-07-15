'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Git hooks installed by Totem (single source of truth). */
const HOOKS = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];

/**
 * RULE_COUNT — reads .totem/compiled-rules.json and returns the count.
 * Throws if the file doesn't exist (fail loud, never deploy stale docs).
 */
function RULE_COUNT() {
  const rulesPath = path.join(ROOT, '.totem', 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    throw new Error(
      '[Totem Error] RULE_COUNT transform failed: .totem/compiled-rules.json not found. Run `totem compile` first.',
    );
  }
  const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  if (!Array.isArray(data.rules)) {
    throw new Error(
      `[Totem Error] RULE_COUNT transform failed: ${rulesPath} has no rules array. File may be corrupt.`,
    );
  }
  const count = data.rules.length;
  return String(count);
}

/**
 * HOOK_LIST — returns the list of git hooks Totem installs.
 * Format: comma-separated inline list for prose.
 */
function HOOK_LIST() {
  return HOOKS.map((h) => '`' + h + '`').join(', ');
}

/**
 * CHMOD_HOOKS — returns the chmod command for all hooks in a fenced code block.
 */
function CHMOD_HOOKS() {
  return '```bash\n' + 'chmod +x ' + HOOKS.map((h) => '.git/hooks/' + h).join(' ') + '\n```';
}

/**
 * COMMAND_TABLE — reads CLI command registrations and generates a markdown table.
 * Parses packages/cli/src/index.ts for .command() and .description() calls.
 * Preserves registration order (functional grouping per Rule #57).
 */
function COMMAND_TABLE() {
  const indexPath = path.join(ROOT, 'packages', 'cli', 'src', 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      '[Totem Error] COMMAND_TABLE transform failed: packages/cli/src/index.ts not found.',
    );
  }
  const content = fs.readFileSync(indexPath, 'utf-8');

  const commands = [];

  // Match chained pattern: .command('name ...', { opts }?).description('desc')
  // Supports single/double quotes and same-line chaining (\s* — a deprecated
  // alias like `.command('shield', { hidden: true }).description(...)` chains
  // without whitespace). Commands registered with `hidden: true` are excluded:
  // Commander already hides them from --help, so the table derives the same.
  const chainedRe =
    /\.command\(\s*(['"])([^'"]+)\1(\s*,\s*\{[^}]*\})?\s*\)\s*\.description\(\s*(['"])([^'"]+)\4\s*\)/g;
  let match;
  while ((match = chainedRe.exec(content)) !== null) {
    if (match[3] && /hidden\s*:\s*true/.test(match[3])) continue;
    const name = match[2].split(' ')[0];
    const desc = match[5];
    commands.push({ name, desc });
  }

  if (commands.length === 0) {
    throw new Error('[Totem Error] COMMAND_TABLE transform failed: no commands found in index.ts.');
  }

  // Filter out hidden/legacy commands — preserve registration order (functional grouping)
  const hidden = new Set(['migrate-lessons', 'install-hooks', 'demo']);
  const visible = commands.filter((c) => !hidden.has(c.name));

  // Generate markdown table
  const header = '| Command | Description |\n| --- | --- |';
  const rows = visible.map((c) => '| `' + c.name + '` | ' + c.desc + ' |');
  return header + '\n' + rows.join('\n');
}

// ── A3 maturity surface (strategy#531 / strategy#639) ──────────────
// Deterministic transforms only: everything below derives from committed
// data and fails loud when a source or anchor stops resolving. No wall-clock
// in any render path — the CI drift gate diffs regenerated output against
// the committed page, so output must be a pure function of the tree.

const MATURITY_DATA = path.join(ROOT, 'docs', 'data', 'maturity.json');
const LINT_RECEIPT_DATA = path.join(ROOT, 'docs', 'data', 'lint-receipt.json');
const FREEZE_FILE = path.join(ROOT, '.totem', 'freeze.json');
const COMPILED_RULES = path.join(ROOT, '.totem', 'compiled-rules.json');

const MATURITY_STATUSES = { shipped: 'Shipped', partial: 'Partial', goal: 'Goal:' };
const ANCHOR_KINDS = new Set(['file', 'command', 'data']);

function readJson(filePath, transform) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[Totem Error] ${transform} transform failed: ${filePath} not found.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** Registered CLI command names, parsed from the same source COMMAND_TABLE uses. */
function registeredCommandNames() {
  const indexPath = path.join(ROOT, 'packages', 'cli', 'src', 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      '[Totem Error] maturity anchor check failed: packages/cli/src/index.ts not found.',
    );
  }
  const content = fs.readFileSync(indexPath, 'utf-8');
  const names = new Set();
  const re = /\.command\(\s*['"]([a-z][a-z-]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1]);
  return names;
}

/** Validates one anchor; throws with row context when it does not resolve. */
function assertAnchorResolves(anchor, rowId, commandNames) {
  const where = `row "${rowId}" anchor ${anchor.kind}:${anchor.ref}`;
  if (!ANCHOR_KINDS.has(anchor.kind)) {
    throw new Error(`[Totem Error] MATURITY_TABLE failed: ${where} has unknown kind.`);
  }
  if (anchor.kind === 'command') {
    if (!commandNames.has(anchor.ref)) {
      throw new Error(
        `[Totem Error] MATURITY_TABLE failed: ${where} is not a registered CLI command. ` +
          'Update the row (or honestly demote its status) — this failure IS the staleness sensor.',
      );
    }
    return;
  }
  const target = path.join(ROOT, anchor.ref);
  if (!fs.existsSync(target)) {
    throw new Error(
      `[Totem Error] MATURITY_TABLE failed: ${where} does not resolve in the tree. ` +
        'Update the row (or honestly demote its status) — this failure IS the staleness sensor.',
    );
  }
  if (anchor.kind === 'data') {
    JSON.parse(fs.readFileSync(target, 'utf-8')); // must parse; throws loudly if corrupt
  }
}

function loadMaturityData(dataPath) {
  const data = readJson(dataPath, 'MATURITY_TABLE');
  if (typeof data.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf)) {
    throw new Error(
      '[Totem Error] MATURITY_TABLE failed: maturity.json needs an asOf date (YYYY-MM-DD).',
    );
  }
  // Sanity only — a future-dated asOf is a fat-finger. (An OLD asOf is legal:
  // determinism means a stale date renders identically until a PR bumps it.)
  if (new Date(data.asOf).getTime() > Date.now() + 86_400_000) {
    throw new Error(`[Totem Error] MATURITY_TABLE failed: asOf ${data.asOf} is in the future.`);
  }
  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    throw new Error('[Totem Error] MATURITY_TABLE failed: maturity.json has no rows.');
  }
  const commandNames = registeredCommandNames();
  for (const row of data.rows) {
    for (const field of ['id', 'mechanism', 'status', 'note']) {
      if (typeof row[field] !== 'string' || row[field].length === 0) {
        throw new Error(
          `[Totem Error] MATURITY_TABLE failed: row "${row.id ?? '?'}" missing ${field}.`,
        );
      }
    }
    if (!(row.status in MATURITY_STATUSES)) {
      throw new Error(
        `[Totem Error] MATURITY_TABLE failed: row "${row.id}" has unknown status "${row.status}" ` +
          `(allowed: ${Object.keys(MATURITY_STATUSES).join(', ')}).`,
      );
    }
    if (typeof row.headline !== 'boolean') {
      throw new Error(
        `[Totem Error] MATURITY_TABLE failed: row "${row.id}" needs an explicit headline boolean.`,
      );
    }
    if (!Array.isArray(row.anchors) || row.anchors.length === 0) {
      throw new Error(`[Totem Error] MATURITY_TABLE failed: row "${row.id}" has no anchors.`);
    }
    for (const anchor of row.anchors) assertAnchorResolves(anchor, row.id, commandNames);
  }
  return data;
}

function renderMaturityTable(dataPath) {
  const data = loadMaturityData(dataPath);
  const header = '| Mechanism | Status | Notes |\n| --- | --- | --- |';
  const rows = data.rows.map(
    (r) => `| ${r.mechanism} | **${MATURITY_STATUSES[r.status]}** | ${r.note} |`,
  );
  return header + '\n' + rows.join('\n');
}

/**
 * MATURITY_TABLE — Shipped / Partial / Goal: rows from docs/data/maturity.json.
 * Every row's anchors are re-verified against the tree on each render; an
 * anchor that stops resolving fails the docs build instead of going stale.
 */
function MATURITY_TABLE() {
  return renderMaturityTable(MATURITY_DATA);
}

function renderRuleProvenance(rulesPath) {
  const data = readJson(rulesPath, 'RULE_PROVENANCE');
  if (!Array.isArray(data.rules) || data.rules.length === 0) {
    throw new Error(
      `[Totem Error] RULE_PROVENANCE transform failed: ${rulesPath} has no rules array.`,
    );
  }
  const total = data.rules.length;
  const lessons = new Set(data.rules.map((r) => r.lessonHash)).size;
  const engines = {};
  for (const r of data.rules)
    engines[r.engine ?? 'unknown'] = (engines[r.engine ?? 'unknown'] ?? 0) + 1;
  const engineSummary = Object.keys(engines)
    .sort()
    .map((e) => `${engines[e]} ${e}`)
    .join(' / ');
  const compiledDates = data.rules.map((r) => String(r.compiledAt).slice(0, 10)).sort();
  const nonCompilable = Array.isArray(data.nonCompilable) ? data.nonCompilable.length : 0;
  return (
    `**${total} compiled rules** stand between a banked mistake and its recurrence, and every one ` +
    `carries the content hash of the lesson it came from (\`lessonHash\`) — the chain from incident ` +
    `to enforcement is mechanical, not editorial. They compile from **${lessons} distinct lessons** ` +
    `(engines: ${engineSummary}; compiled between ${compiledDates[0]} and ${compiledDates[compiledDates.length - 1]}). ` +
    `${nonCompilable} lessons currently rest as non-compilable rather than being force-fitted into rules.`
  );
}

/** RULE_PROVENANCE — count + provenance chain, derived from .totem/compiled-rules.json. */
function RULE_PROVENANCE() {
  return renderRuleProvenance(COMPILED_RULES);
}

function renderDaysUnderFreeze(freezePath, maturityPath) {
  const freeze = readJson(freezePath, 'DAYS_UNDER_FREEZE');
  const entry = (freeze.frozen ?? []).find((f) => f.id === 'rule-compilation');
  if (!entry) {
    throw new Error(
      '[Totem Error] DAYS_UNDER_FREEZE transform failed: no rule-compilation entry in .totem/freeze.json. ' +
        'If the freeze lifted, retire this receipt deliberately in the same PR.',
    );
  }
  const { asOf } = loadMaturityData(maturityPath);
  const since = entry.since;
  const days = Math.floor((Date.parse(asOf) - Date.parse(since)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(
      `[Totem Error] DAYS_UNDER_FREEZE transform failed: asOf ${asOf} predates freeze since ${since}.`,
    );
  }
  return (
    `The legacy lesson→rule compiler has been parked under a standing freeze since **${since}** — ` +
    `**${days} days** as of this page's last data refresh (${asOf}). Rather than keep running a ` +
    `compiler we no longer trust, the rule corpus is enforced read-only until its replacement passes ` +
    `held-out validation. We hold our own line the way we ask your repo to hold its own.`
  );
}

/** DAYS_UNDER_FREEZE — derived from .totem/freeze.json + the committed asOf (no wall-clock). */
function DAYS_UNDER_FREEZE() {
  return renderDaysUnderFreeze(FREEZE_FILE, MATURITY_DATA);
}

function renderLintReceipt(receiptPath) {
  const r = readJson(receiptPath, 'LINT_RECEIPT');
  for (const field of [
    'baseSha',
    'headSha',
    'filesChanged',
    'rules',
    'errors',
    'warnings',
    'elapsedMs',
  ]) {
    if (r[field] === undefined) {
      throw new Error(`[Totem Error] LINT_RECEIPT transform failed: receipt missing ${field}.`);
    }
  }
  if (r.llmCalls !== 0 || r.apiKeysStripped !== true) {
    throw new Error(
      '[Totem Error] LINT_RECEIPT transform failed: receipt does not attest a zero-LLM, keys-stripped run — refusing to render the claim.',
    );
  }
  const range = `${r.baseSha.slice(0, 8)}..${r.headSha.slice(0, 8)}`;
  return (
    `A real merged diff of this repository (\`${range}\`, ${r.filesChanged} files) linted in ` +
    `**${r.elapsedMs} ms** with **zero LLM calls** — the run executed with every provider API key ` +
    `stripped from the environment, so there was nothing to silently call. ${r.rules} rules evaluated; ` +
    `${r.errors} errors, ${r.warnings} warnings. Environment: ${r.platform}, node ${r.node}, ` +
    `CLI ${r.cliVersion}, generated ${String(r.generatedAt).slice(0, 10)}. CI recomputes this receipt ` +
    `on every pull request — the counts must match; timing is environment-labeled, never gated.`
  );
}

/** LINT_RECEIPT — real-diff zero-LLM lint receipt from docs/data/lint-receipt.json. */
function LINT_RECEIPT() {
  return renderLintReceipt(LINT_RECEIPT_DATA);
}

module.exports = {
  RULE_COUNT,
  HOOK_LIST,
  CHMOD_HOOKS,
  COMMAND_TABLE,
  MATURITY_TABLE,
  RULE_PROVENANCE,
  DAYS_UNDER_FREEZE,
  LINT_RECEIPT,
  // internals exported for tests (render with an explicit source path)
  _renderMaturityTable: renderMaturityTable,
  _renderRuleProvenance: renderRuleProvenance,
  _renderDaysUnderFreeze: renderDaysUnderFreeze,
  _renderLintReceipt: renderLintReceipt,
  _loadMaturityData: loadMaturityData,
};
