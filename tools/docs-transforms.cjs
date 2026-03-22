'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * RULE_COUNT — reads .totem/compiled-rules.json and returns the count.
 * Throws if the file doesn't exist (fail loud, never deploy stale docs).
 */
function RULE_COUNT() {
  const rulesPath = path.join(ROOT, '.totem', 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    throw new Error(
      'RULE_COUNT transform failed: .totem/compiled-rules.json not found. Run `totem compile` first.',
    );
  }
  const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  const count = Array.isArray(data.rules) ? data.rules.length : 0;
  return String(count);
}

/**
 * HOOK_LIST — returns the list of git hooks Totem installs.
 * Format: comma-separated inline list for prose, e.g. "`pre-commit`, `pre-push`, `post-merge`, `post-checkout`"
 */
function HOOK_LIST() {
  const hooks = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];
  return hooks.map((h) => '`' + h + '`').join(', ');
}

/**
 * CHMOD_HOOKS — returns the chmod command for all hooks in a fenced code block.
 */
function CHMOD_HOOKS() {
  const hooks = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];
  return '```bash\n' + 'chmod +x ' + hooks.map((h) => '.git/hooks/' + h).join(' ') + '\n```';
}

/**
 * COMMAND_TABLE — reads CLI command registrations and generates a markdown table.
 * Parses packages/cli/src/index.ts for .command() and .description() calls.
 */
function COMMAND_TABLE() {
  const indexPath = path.join(ROOT, 'packages', 'cli', 'src', 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error('COMMAND_TABLE transform failed: packages/cli/src/index.ts not found.');
  }
  const content = fs.readFileSync(indexPath, 'utf-8');

  const commands = [];

  // Match chained pattern: .command('name ...').description('desc')
  // Use a regex that captures both in sequence, allowing for options/flags in between
  const chainedRe =
    /\.command\(\s*'([^']+)'(?:\s*,\s*\{[^}]*\})?\s*\)\s*\n\s*\.description\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = chainedRe.exec(content)) !== null) {
    const name = match[1].split(' ')[0];
    const desc = match[2];
    commands.push({ name, desc });
  }

  if (commands.length === 0) {
    throw new Error('COMMAND_TABLE transform failed: no commands found in index.ts.');
  }

  // Filter out hidden/legacy commands that users shouldn't see in the table
  const hidden = new Set(['migrate-lessons', 'install-hooks', 'demo']);
  const visible = commands.filter((c) => !hidden.has(c.name));

  // Sort alphabetically
  visible.sort((a, b) => a.name.localeCompare(b.name));

  // Generate markdown table
  const header = '| Command | Description |\n| --- | --- |';
  const rows = visible.map((c) => '| `' + c.name + '` | ' + c.desc + ' |');
  return header + '\n' + rows.join('\n');
}

module.exports = { RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE };
