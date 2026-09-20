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

/**
 * Strict YYYY-MM-DD validation via UTC round-trip: impossible calendar dates
 * (e.g. 2026-02-31, which Date.parse silently normalizes) reject. Deliberately
 * no wall-clock comparison — determinism means the same committed tree renders
 * identically on any day, including a stale or mistyped date (the drift gate
 * stays idempotent; a wrong date is a human-review matter, not a clock matter).
 */
function assertUtcDate(value, label) {
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const roundTrip = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      .toISOString()
      .slice(0, 10);
    if (roundTrip === value) return;
  }
  throw new Error(`[Totem Error] ${label} is not a valid YYYY-MM-DD date: ${value}`);
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
  assertUtcDate(data.asOf, 'MATURITY_TABLE failed: maturity.json asOf');
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
  // Every field this receipt claims must exist before the claim renders —
  // a malformed entry must fail the build, not render "undefined".
  data.rules.forEach((r, i) => {
    if (typeof r.lessonHash !== 'string' || r.lessonHash.length === 0) {
      throw new Error(
        `[Totem Error] RULE_PROVENANCE transform failed: rule[${i}] has no lessonHash — the provenance-chain claim cannot render.`,
      );
    }
    if (typeof r.compiledAt !== 'string' || Number.isNaN(Date.parse(r.compiledAt))) {
      throw new Error(
        `[Totem Error] RULE_PROVENANCE transform failed: rule[${i}] (${r.lessonHash}) has no valid compiledAt.`,
      );
    }
  });
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
  assertUtcDate(since, 'DAYS_UNDER_FREEZE failed: freeze.json since');
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

// ── Inline figures ───────────────────────────────────────────────────────
// Short fragments meant to sit INSIDE a sentence between inline markers
// (`… (<!-- docs RULE_PROVENANCE_RATIO -->485 of 485<!-- /docs -->) …`), so a
// hand-written page can state a figure the maturity page already derives
// without hand-typing it. Each is a pure function of the same committed data
// the block transforms above read, fails loud on a malformed source, and
// carries no wall-clock. (Two hand-typed copies of the non-archived count
// had already rotted before these existed: `docs/manual/why-totem.md` and
// `docs/wiki/cloud-compilation.md` said 394 where the artifact held 392.)

function loadRules(rulesPath, label) {
  const data = readJson(rulesPath, label);
  if (!Array.isArray(data.rules) || data.rules.length === 0) {
    throw new Error(`[Totem Error] ${label} transform failed: ${rulesPath} has no rules array.`);
  }
  return data;
}

/** `<hashed> of <total>` — rules carrying a lessonHash over all compiled rules. */
function renderRuleProvenanceRatio(rulesPath) {
  const data = loadRules(rulesPath, 'RULE_PROVENANCE_RATIO');
  const hashed = data.rules.filter(
    (r) => typeof r.lessonHash === 'string' && r.lessonHash.length > 0,
  ).length;
  return `${hashed} of ${data.rules.length}`;
}

/** RULE_PROVENANCE_RATIO — e.g. `485 of 485`, from .totem/compiled-rules.json. */
function RULE_PROVENANCE_RATIO() {
  return renderRuleProvenanceRatio(COMPILED_RULES);
}

/** Rules whose status is not `archived` — the count the linter still runs. */
function renderNonArchivedRuleCount(rulesPath) {
  const data = loadRules(rulesPath, 'NON_ARCHIVED_RULE_COUNT');
  return String(data.rules.filter((r) => r.status !== 'archived').length);
}

/** NON_ARCHIVED_RULE_COUNT — e.g. `392`, from .totem/compiled-rules.json. */
function NON_ARCHIVED_RULE_COUNT() {
  return renderNonArchivedRuleCount(COMPILED_RULES);
}

/**
 * `about N,NNN` — the lesson records the maturity page's provenance receipt
 * counts (distinct compiled lessons + the non-compilable rest), rounded to the
 * nearest hundred so prose does not churn on every banked lesson.
 */
function renderLessonRecordCount(rulesPath) {
  const data = loadRules(rulesPath, 'LESSON_RECORD_COUNT');
  const distinct = new Set(data.rules.map((r) => r.lessonHash)).size;
  const nonCompilable = Array.isArray(data.nonCompilable) ? data.nonCompilable.length : 0;
  const total = distinct + nonCompilable;
  if (total <= 0) {
    throw new Error(
      `[Totem Error] LESSON_RECORD_COUNT transform failed: ${rulesPath} counts no lesson records.`,
    );
  }
  const rounded = Math.round(total / 100) * 100;
  return `about ${rounded.toLocaleString('en-US')}`;
}

/** LESSON_RECORD_COUNT — e.g. `about 1,600`, from .totem/compiled-rules.json. */
function LESSON_RECORD_COUNT() {
  return renderLessonRecordCount(COMPILED_RULES);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `<Month> <YYYY>` of the rule-compilation freeze's `since`, read in UTC. */
function renderFreezeSinceMonth(freezePath) {
  const freeze = readJson(freezePath, 'FREEZE_SINCE_MONTH');
  const entry = (freeze.frozen ?? []).find((f) => f.id === 'rule-compilation');
  if (!entry) {
    throw new Error(
      '[Totem Error] FREEZE_SINCE_MONTH transform failed: no rule-compilation entry in .totem/freeze.json. ' +
        'If the freeze lifted, retire this figure deliberately in the same PR.',
    );
  }
  assertUtcDate(entry.since, 'FREEZE_SINCE_MONTH failed: freeze.json since');
  const d = new Date(entry.since);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** FREEZE_SINCE_MONTH — e.g. `May 2026`, from .totem/freeze.json. */
function FREEZE_SINCE_MONTH() {
  return renderFreezeSinceMonth(FREEZE_FILE);
}

function renderLintReceipt(receiptPath) {
  const r = readJson(receiptPath, 'LINT_RECEIPT');
  // Every rendered field is required — including the environment labels; a
  // hand-edited receipt must fail here, not render "undefined" into the page.
  for (const field of [
    'baseSha',
    'headSha',
    'filesChanged',
    'rules',
    'errors',
    'warnings',
    'elapsedMs',
    'platform',
    'node',
    'cliVersion',
    'generatedAt',
  ]) {
    if (r[field] === undefined || r[field] === null || r[field] === '') {
      throw new Error(`[Totem Error] LINT_RECEIPT transform failed: receipt missing ${field}.`);
    }
  }
  if (Number.isNaN(Date.parse(r.generatedAt))) {
    throw new Error(
      `[Totem Error] LINT_RECEIPT transform failed: generatedAt is not a valid timestamp: ${r.generatedAt}`,
    );
  }
  if (r.llmCalls !== 0 || r.apiKeysStripped !== true) {
    throw new Error(
      '[Totem Error] LINT_RECEIPT transform failed: receipt does not attest a zero-LLM, keys-stripped run — refusing to render the claim.',
    );
  }
  const range = `${r.baseSha.slice(0, 8)}..${r.headSha.slice(0, 8)}`;
  // ADR-115 §2 envelope: a downgraded validation posture must be visible on the
  // rendered surface, not only inside the receipt JSON. Pure function of the
  // receipt fields — absent fields (pre-posture receipts) render nothing.
  // Posture fields fail loud like every other rendered field: an unknown mode
  // must not silently hide the posture, and a lenient receipt without the
  // guard boolean must not interpolate `undefined` into the page.
  if (r.astParseMode !== undefined && r.astParseMode !== 'strict' && r.astParseMode !== 'lenient') {
    throw new Error(
      `[Totem Error] LINT_RECEIPT transform failed: invalid astParseMode: ${String(r.astParseMode)}`,
    );
  }
  if (r.astParseMode === 'lenient' && typeof r.targetMismatchGuardWarning !== 'boolean') {
    throw new Error(
      '[Totem Error] LINT_RECEIPT transform failed: lenient receipt missing boolean targetMismatchGuardWarning.',
    );
  }
  const posture =
    r.astParseMode === 'lenient'
      ? ` The replay runs with \`--ast-parse-mode lenient\` — the pinned corpus predates the ` +
        `current target-mismatch load guard — and the receipt records that posture ` +
        `(\`astParseMode\`) plus whether the guard fired (\`targetMismatchGuardWarning: ` +
        `${r.targetMismatchGuardWarning}\`).`
      : '';
  return (
    `A real merged diff of this repository (\`${range}\`, ${r.filesChanged} files) linted in ` +
    `**${r.elapsedMs} ms** with **zero LLM calls** — the run executed with every provider API key ` +
    `stripped from the environment, so there was nothing to silently call. ${r.rules} rules evaluated; ` +
    `${r.errors} errors, ${r.warnings} warnings. Environment: ${r.platform}, node ${r.node}, ` +
    `CLI ${r.cliVersion}, generated ${String(r.generatedAt).slice(0, 10)}. CI recomputes this receipt ` +
    `on every pull request — the counts must match; timing is environment-labeled, never gated.` +
    posture
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
  RULE_PROVENANCE_RATIO,
  NON_ARCHIVED_RULE_COUNT,
  LESSON_RECORD_COUNT,
  FREEZE_SINCE_MONTH,
  // internals exported for tests (render with an explicit source path)
  _renderMaturityTable: renderMaturityTable,
  _renderRuleProvenance: renderRuleProvenance,
  _renderDaysUnderFreeze: renderDaysUnderFreeze,
  _renderLintReceipt: renderLintReceipt,
  _loadMaturityData: loadMaturityData,
  _renderRuleProvenanceRatio: renderRuleProvenanceRatio,
  _renderNonArchivedRuleCount: renderNonArchivedRuleCount,
  _renderLessonRecordCount: renderLessonRecordCount,
  _renderFreezeSinceMonth: renderFreezeSinceMonth,
};
