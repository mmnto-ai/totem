// Is 83b86cd7's lookahead (?!\?) inert? The legacy pattern and the pattern with the lookahead
// removed are compared (1) by argument: the lookahead sits where `\s*:` must match next, and `?` is
// neither whitespace nor `:`, so every position the lookahead rejects is one `\s*:` rejects too;
// (2) by a battery of line shapes; (3) over every in-scope line of the pinned tree (both patterns
// per line, the runtime's semantics). Any disagreement is printed.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const WT = 'D:/Dev/worktrees/totem-totem-claude-gate5-b3';
const TREE = 'D:/Dev/worktrees/totem-totem-claude-gate5-tree';
const m = JSON.parse(readFileSync(`${WT}/operations-local/gate5/manifest-2263305c.json`, 'utf8'));
const row = m.rules.find((r) => r.lessonHash.startsWith('83b86cd7'));
const legacyPattern = row.legacy.pattern;
const LOOKAHEAD = '(?!\\?)';
if (!legacyPattern.includes(LOOKAHEAD)) throw new Error('lookahead not found');
const withoutPattern = legacyPattern.replace(LOOKAHEAD, '');
const legacy = new RegExp(legacyPattern);
const without = new RegExp(withoutPattern);
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
for (const f of files) {
  let text;
  try {
    text = readFileSync(path.join(TREE, f), 'utf8');
  } catch {
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
  `battery disagreements: ${disagree}; tree: ${files.length} files, ${lines} lines, legacy firings ${fires}, disagreements ${treeDisagree}`,
);
process.exit(disagree === 0 && treeDisagree === 0 ? 0 : 1);
