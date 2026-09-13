#!/usr/bin/env node
/**
 * Public-resolvability check for agent-instruction surfaces
 * (mmnto-ai/totem-strategy#619 design v1 § 3(b), the network half of the
 * class-5 acceptance test: every reference a committed public file carries
 * must resolve WITHOUT authentication).
 *
 * Usage:
 *   node tools/public-refs-resolve.mjs AGENTS.md CLAUDE.md GEMINI.md .claude/docs/*.md
 *
 * For each file it extracts exactly these shapes
 *   - absolute URLs (`https://…`),
 *   - repository-qualified issue/PR refs (`owner/repo#123`), probed as the
 *     public issue URL (GitHub redirects a PR number to its pull page),
 *   - repository-qualified commits (`owner/repo@sha`), probed as the commit URL,
 *   - repository-qualified paths (`owner/repo:path/to/file.ext`), probed on
 *     the default branch,
 *   - relative markdown links, inline (`[x](path)`) and reference-style
 *     (`[x]: path`, a path-shaped destination; footnotes and prose lines that
 *     merely look like definitions are skipped), checked on disk CASE-EXACTLY
 *     (github.com is case-sensitive where NTFS and macOS are not) and only
 *     inside the working directory (a link that escapes it fails),
 * and prints one row per reference with the observed status. Exit 0 when
 * every reference resolves, 1 when any does not, 2 on usage error.
 *
 * Not extracted, by design: a bare repository name with no `#`, `@` or `:`
 * (indistinguishable from an ordinary `dir/file` path), an anchor-only link
 * (`[x](#heading)`, a heading question, not a resolvability one), a qualified
 * path with no file extension, and a reference definition whose destination
 * has neither a slash nor a letter-led extension (`[docs]: subdir` — it reads
 * as prose, the price of skipping footnotes and prose-shaped definitions). The
 * sterility test's lexicon covers the bare private-repository name; this
 * script does not.
 *
 * Network: unauthenticated GETs only. No token is read from the environment or
 * sent — an authenticated probe would pass a private link the public reader
 * cannot follow, which is exactly the defect this script exists to catch.
 */

import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/public-refs-resolve.mjs <file> [file...]');
  process.exit(2);
}

const URL_RE = /https?:\/\/[^\s)<>"'`]+/g;
const QUALIFIED_ISSUE_RE = /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const QUALIFIED_COMMIT_RE = /\b([\w.-]+)\/([\w.-]+)@([0-9a-f]{7,40})\b/g;
const QUALIFIED_PATH_RE = /\b([\w.-]+)\/([\w.-]+):((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+)\b/g;
const MD_LINK_RE = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
const MD_REF_DEF_RE = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const REQUEST_TIMEOUT_MS = 15000;
const CONCURRENCY = 6;

/** Strip trailing punctuation a sentence leaves glued to a URL. */
function trimUrl(raw) {
  return raw.replace(/[.,;:!?)\]]+$/, '');
}

/** @type {Array<{ file: string, kind: string, ref: string, target: string }>} */
const refs = [];
const seen = new Set();
function add(file, kind, ref, target) {
  const key = JSON.stringify([file, target]);
  if (seen.has(key)) return;
  seen.add(key);
  refs.push({ file, kind, ref, target });
}

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const match of content.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    add(file, 'url', url, url);
  }
  for (const match of content.matchAll(QUALIFIED_ISSUE_RE)) {
    const [ref, owner, repo, n] = match;
    add(file, 'issue', ref, `https://github.com/${owner}/${repo}/issues/${n}`);
  }
  for (const match of content.matchAll(QUALIFIED_COMMIT_RE)) {
    const [ref, owner, repo, sha] = match;
    add(file, 'commit', ref, `https://github.com/${owner}/${repo}/commit/${sha}`);
  }
  for (const match of content.matchAll(QUALIFIED_PATH_RE)) {
    const [ref, owner, repo, p] = match;
    add(file, 'path', ref, `https://github.com/${owner}/${repo}/blob/HEAD/${p}`);
  }
  // A reference definition's destination may be wrapped in angle brackets and
  // may carry a fragment; a `#`-only destination is the `[//]: #` comment
  // idiom (or an anchor), neither a resolvability question. A footnote
  // definition (`[^1]: prose`) and a prose line that merely looks like a
  // definition (`[Note]: this sentence…`) are not links: only a label that is
  // not a footnote AND a destination shaped like a path (a `/` or a `.` in it)
  // counts.
  const refDefTargets = [...content.matchAll(MD_REF_DEF_RE)]
    .filter((m) => !m[0].trimStart().startsWith('[^'))
    .map((m) => m[1].replace(/^<(.*)>$/, '$1').replace(/#.*$/, ''))
    // Path-shaped: a slash somewhere, or a letter-led file extension at the
    // end (`x.md`); `1.0`, `e.g.` and a bare word are prose, and an
    // extensionless slash-less target (`subdir`) is a named limit.
    .filter((t) => t !== '' && (t.includes('/') || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(t)));
  const relativeTargets = [...[...content.matchAll(MD_LINK_RE)].map((m) => m[1]), ...refDefTargets];
  for (const target of relativeTargets) {
    if (SCHEME_RE.test(target)) continue; // absolute URLs are covered above; mailto: is not a public-resolvability question
    add(file, 'link', target, `file:${path.resolve(path.dirname(file), target)}`);
  }
}

/**
 * Case-exact existence, because github.com is case-sensitive while NTFS and a
 * default macOS volume are not: every path segment must match a directory
 * entry byte-for-byte. Mirrors the sterility test's `existsExact`.
 */
function existsExact(absPath) {
  const root = path.parse(absPath).root;
  const segments = path
    .relative(root, absPath)
    .split(/[\\/]+/)
    .filter((s) => s !== '');
  let cursor = root;
  for (const segment of segments) {
    let entries;
    try {
      entries = fs.readdirSync(cursor);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    cursor = path.join(cursor, segment);
  }
  return true;
}

async function probe(entry) {
  if (entry.target.startsWith('file:')) {
    const absPath = entry.target.slice('file:'.length);
    // A link that escapes the working directory is not something a public
    // reader can follow from here, whatever sits there on this disk — run the
    // script from the repository root so the working directory IS the repo.
    const relative = path.relative(process.cwd(), absPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { ...entry, ok: false, status: 'outside the working directory' };
    }
    const exists = existsExact(absPath);
    return { ...entry, ok: exists, status: exists ? 'exists' : 'missing' };
  }
  try {
    const response = await fetch(entry.target, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'totem-public-refs-resolve' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { ...entry, ok: response.status < 400, status: String(response.status) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...entry, ok: false, status: `error: ${message}` };
  }
}

const results = [];
for (let i = 0; i < refs.length; i += CONCURRENCY) {
  const batch = refs.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map(probe))));
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.file}  ${r.kind}  ${r.ref}  -> ${r.status}`);
}
console.log(
  `\n${results.length} reference(s) across ${files.length} file(s): ${results.length - failed} resolve, ${failed} do not.`,
);
// Set the exit code and let the loop drain: a hard `process.exit()` right after
// the fetches raced undici's closing handles into a libuv assertion (exit 127)
// on Windows Node 24, which turned a clean 8/8 run into a crash.
process.exitCode = failed === 0 ? 0 : 1;
