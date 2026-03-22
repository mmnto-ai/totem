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

  // Match chained pattern: .command('name ...').description('desc')
  // Supports single/double quotes, handles whitespace between chained calls
  const chainedRe =
    /\.command\(\s*(['"])([^'"]+)\1(?:\s*,\s*\{[^}]*\})?\s*\)\s+\.description\(\s*(['"])([^'"]+)\3\s*\)/g;
  let match;
  while ((match = chainedRe.exec(content)) !== null) {
    const name = match[2].split(' ')[0];
    const desc = match[4];
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

module.exports = { RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE };
