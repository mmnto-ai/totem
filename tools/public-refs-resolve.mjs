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
 * For each file it extracts
 *   - absolute URLs (`https://…`),
 *   - repository-qualified issue/PR refs (`owner/repo#123`), probed as the
 *     public issue URL (GitHub redirects a PR number to its pull page),
 *   - repository-qualified paths (`owner/repo:path/to/file.md`), probed on the
 *     default branch,
 *   - relative markdown links (`[x](path)`), checked on disk,
 * and prints one row per reference with the observed status. Exit 0 when
 * every reference resolves, 1 when any does not, 2 on usage error.
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
const QUALIFIED_PATH_RE = /\b([\w.-]+)\/([\w.-]+):((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+)\b/g;
const MD_LINK_RE = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
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
  for (const match of content.matchAll(QUALIFIED_PATH_RE)) {
    const [ref, owner, repo, p] = match;
    add(file, 'path', ref, `https://github.com/${owner}/${repo}/blob/HEAD/${p}`);
  }
  for (const match of content.matchAll(MD_LINK_RE)) {
    const target = match[1];
    if (SCHEME_RE.test(target)) continue; // absolute URLs are covered above; mailto: is not a public-resolvability question
    add(file, 'link', target, `file:${path.resolve(path.dirname(file), target)}`);
  }
}

async function probe(entry) {
  if (entry.target.startsWith('file:')) {
    const exists = fs.existsSync(entry.target.slice('file:'.length));
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
process.exit(failed === 0 ? 0 : 1);
