#!/usr/bin/env node
// Replay every Bash tool command recorded in the Claude Code session transcripts on
// THIS machine through two builds of the transport-shield gate and print each verdict
// that changes. This is the measurement for a change to packages/core/src/transport-shield.ts
// beside the committed benign corpus (transport-shield.fold.test.ts): thousands of real
// commands against the few dozen there. A change to the gate ships with its replay read.
//
//   node operations-local/transport-shield/replay-transcripts.mjs \
//     --old <path to a main checkout>/packages/core/dist/index.js \
//     --new <path to the branch checkout>/packages/core/dist/index.js \
//     [--platform win32] [--tool Bash] [--transcripts 400] [--min-bytes 0] [--show-changed]
//
// What it reads: every *.jsonl under <home>/.claude/projects (the Claude Code transcript
// store), newest first, up to --transcripts files of at least --min-bytes; from each, the
// `command` of every tool_use record whose tool is --tool. Transcripts of every seat on
// the machine are read. Nothing is written anywhere.
//
// What it prints: the verdict classes that did not change, and with --show-changed every
// command whose verdict changed (old -> new, the command's head). THAT OUTPUT CAN CARRY
// COHORT SPECIFICS — paths, seat names, private repositories, session ids — and goes to
// the terminal only; never paste it into a public surface (a PR body, an issue, a
// commit, a lesson) without rewriting it by mechanism.
//
// Reading the result: an intended change is a shape the fix targets (on mmnto-ai/totem#3098,
// the two munged trigger chains, allow -> deny); a fix is a verdict the old build got wrong
// (false rev:path warnings, warn -> allow); a disclosed change is one the changeset names
// (there, the program locator reading a reserved word before sed -i or node -e: twelve
// allow -> deny over the full store, true positives on inspection); anything else is a
// question for the change. The defaults read the whole store (the 24 newest large
// transcripts showed 3 changes on that branch; the full store 18, every one in a class
// above). Two limits: it compares the EVALUATOR's verdict (the first deny row, else the
// first warn), so a row change hidden under an earlier deny does not show — replay a
// single row by hand when a change touches one; and zero changes is NOT evidence for a
// rule that fires on shapes the transcripts never carry: name those shapes and probe
// them on their own.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(a.slice(2), 'true');
  else {
    args.set(a.slice(2), next);
    i += 1;
  }
}
const need = (k) => {
  const v = args.get(k);
  if (v === undefined || v === 'true') {
    console.error(`--${k} <path> is required (a built packages/core/dist/index.js)`);
    process.exit(2);
  }
  return v;
};
const oldDist = need('old');
const newDist = need('new');
const platform = args.get('platform') ?? 'win32';
const tool = args.get('tool') ?? 'Bash';
const maxFiles = Number(args.get('transcripts') ?? 400);
const minBytes = Number(args.get('min-bytes') ?? 0);
const showChanged = args.has('show-changed');

const OLD = (await import(pathToFileURL(oldDist).href)).transportShieldEvaluator;
const NEW = (await import(pathToFileURL(newDist).href)).transportShieldEvaluator;
if (typeof OLD !== 'function' || typeof NEW !== 'function') {
  console.error('both builds must export transportShieldEvaluator');
  process.exit(2);
}

const root = join(homedir(), '.claude', 'projects');
const files = [];
let dirs = [];
try {
  dirs = readdirSync(root);
} catch {
  console.error(`no transcript store at ${root}`);
  process.exit(2);
}
for (const dir of dirs) {
  const d = join(root, dir);
  let entries = [];
  try {
    entries = readdirSync(d).filter((f) => f.endsWith('.jsonl'));
  } catch {
    continue;
  }
  for (const f of entries) {
    const p = join(d, f);
    const st = statSync(p);
    if (st.size >= minBytes) files.push({ p, mtime: st.mtimeMs });
  }
}
files.sort((a, b) => b.mtime - a.mtime);
const picked = files.slice(0, maxFiles);

const commands = new Set();
for (const { p } of picked) {
  const text = readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') || !line.includes(`"${tool}"`)) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'tool_use' && c?.name === tool && typeof c?.input?.command === 'string') {
        commands.add(c.input.command);
      }
    }
  }
}

const verdict = (fn, command) => {
  try {
    const v = fn({ tool, command, platform }, process.cwd());
    return `${v.disposition}:${v.provenance.ref}`;
  } catch (e) {
    return `ERR:${String(e && e.message).slice(0, 40)}`;
  }
};
const classes = new Map();
const changed = [];
let same = 0;
for (const command of commands) {
  const o = verdict(OLD, command);
  const n = verdict(NEW, command);
  if (o === n) {
    same += 1;
    classes.set(o, (classes.get(o) ?? 0) + 1);
  } else changed.push({ o, n, command });
}
console.log(
  `transcripts read: ${picked.length} (of ${files.length} at or over ${minBytes} bytes); distinct ${tool} commands: ${commands.size}; platform ${platform}; unchanged verdicts: ${same}; changed: ${changed.length}`,
);
console.log('--- unchanged, by verdict:');
for (const [k, v] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
console.log(
  `--- changed verdicts, by class${showChanged ? ' (then each command)' : ' (pass --show-changed for each command)'}:`,
);
const byClass = new Map();
for (const { o, n } of changed) {
  const k = `${o} -> ${n}`;
  byClass.set(k, (byClass.get(k) ?? 0) + 1);
}
for (const [k, v] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
if (showChanged) {
  for (const { o, n, command } of changed) {
    console.log(`  ${o} -> ${n} | ${command.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
process.exit(changed.length === 0 ? 0 : 1);
