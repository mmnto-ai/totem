#!/usr/bin/env node
// Is 83b86cd7's lookahead (?!\?) inert? The legacy pattern and the pattern with the lookahead
// removed are compared (1) by argument: the lookahead sits where `\s*:` must match next, and `?` is
// neither whitespace nor `:`, so every position the lookahead rejects is one `\s*:` rejects too;
// (2) by a battery of line shapes; (3) over every in-scope line of the pinned tree (both patterns
// per line, the runtime's semantics). Any disagreement is printed; exit 1 on any.
//
// Replayable from any clone: the manifest is the frozen copy beside this batch directory
// (operations-local/gate5/manifest-2263305c.json, resolved relative to this file, sha256-checked);
// the pinned tree is a REQUIRED argument. No clock, no network, no writes.
//
//   node operations-local/gate5/batch-3/inert-83b86cd7.mjs --tree <checkout at 5293614b>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(HERE, '..', 'manifest-2263305c.json');
const EXPECTED_SHA = '2263305cfbbe8b792d8884d8091a311676ba8ddedf75e852fa9ab434de950ca5';
const argv = process.argv.slice(2);
const i = argv.indexOf('--tree');
const TREE = i === -1 ? undefined : argv[i + 1];
if (!TREE) {
  console.error(
    '[Totem Error] inert-83b86cd7: usage: --tree <checkout at the pinned tree 5293614b>',
  );
  process.exit(2);
}
const manifestBytes = readFileSync(MANIFEST);
const sha = createHash('sha256').update(manifestBytes).digest('hex');
if (sha !== EXPECTED_SHA) {
  console.error(`[Totem Error] inert-83b86cd7: manifest sha256 ${sha} is not ${EXPECTED_SHA}`);
  process.exit(2);
}
const m = JSON.parse(manifestBytes.toString('utf8'));
const row = m.rules.find((r) => r.lessonHash.startsWith('83b86cd7'));
const legacyPattern = row.legacy.pattern;
const LOOKAHEAD = '(?!\\?)';
if (!legacyPattern.includes(LOOKAHEAD)) {
  console.error('[Totem Error] inert-83b86cd7: the lookahead is not in the legacy pattern');
  process.exit(2);
}
const withoutPattern = legacyPattern.replace(LOOKAHEAD, '');
const legacy = new RegExp(legacyPattern);
const without = new RegExp(withoutPattern);
const head = execFileSync('git', ['-C', TREE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
console.log('tree   :', TREE, '@', head);
console.log('legacy :', legacyPattern);
console.log('without:', withoutPattern);
const battery = [
  'interface ToolMeta { mcpServers: string[]; }',
  'interface ToolMeta { mcpServers?: string[]; }',
  'mcpServers : string[]',
  'mcpServers ?: string[]',
  'mcpServers ? : string[]',
  'mcp: 1',
  'mcp?: 1',
  'const x = cond ? mcpA : mcpB;',
  'mcpServers?:string',
  'mcp_a1?: number; mcpB: number',
  '{ mcpServers:string[] }',
  'mcpServers: string[] // optional?',
];
let disagree = 0;
for (const line of battery) {
  const a = legacy.test(line);
  const b = without.test(line);
  if (a !== b) disagree += 1;
  console.log(
    `${a === b ? 'same ' : 'DIFF '} legacy=${a ? 'FIRES' : 'silent'} without=${b ? 'FIRES' : 'silent'}  ${line}`,
  );
}
// The pinned tree, in scope: **/*.ts, **/*.tsx minus **/*.test.ts (per line).
const files = execFileSync('git', ['-C', TREE, 'ls-files', '-z', '--', '*.ts', '*.tsx'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter((f) => f.length > 0 && !f.endsWith('.test.ts'));
let lines = 0;
let fires = 0;
let treeDisagree = 0;
let unreadable = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(path.join(TREE, f), 'utf8');
  } catch {
    unreadable += 1;
    continue;
  }
  for (const line of text.split('\n')) {
    lines += 1;
    const a = legacy.test(line);
    const b = without.test(line);
    if (a) fires += 1;
    if (a !== b) {
      treeDisagree += 1;
      console.log(`TREE DIFF ${f}: legacy=${a} without=${b}: ${line.trim().slice(0, 120)}`);
    }
  }
}
console.log(
  `battery disagreements: ${disagree}; tree: ${files.length} files (${unreadable} unreadable), ${lines} lines, legacy firings ${fires}, disagreements ${treeDisagree}`,
);
process.exit(disagree === 0 && treeDisagree === 0 ? 0 : 1);
