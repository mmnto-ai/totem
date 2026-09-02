#!/usr/bin/env node
/**
 * export-fixture.mjs — turn the retained `totem spec` run artifacts in the
 * resident checkout's artifact store into a committed, sha256-pinned dataset.
 *
 * Source (read-only):  D:/Dev/totem/.totem/artifacts/runs/*.json
 * Output:              <this script>/../  (artifacts.ndjson, grounding-items.ndjson, SHA256SUMS)
 *
 * The exporter is pure read + derive: it never writes to the source store and
 * never mutates git. Every byte it is about to write is secret-scanned first;
 * on any hit nothing is written and the process exits 1.
 *
 * Re-run:  node D:/Dev/worktrees/totem-totem-claude-r1193/.totem/fixtures/spec-runs-2026-09-02/scripts/export-fixture.mjs
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Configuration ───────────────────────────────────────

const RESIDENT = process.env.TOTEM_FIXTURE_RESIDENT ?? 'D:/Dev/totem';
const RUNS_DIR = path.posix.join(RESIDENT, '.totem/artifacts/runs');
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(SCRIPT_DIR, '..');
const CALLER = 'spec';

/** Body truncation used by `buildSearchQuery` (packages/cli/src/commands/spec.ts: QUERY_BODY_TRUNCATE). */
const QUERY_BODY_TRUNCATE = 500;

/** Verbatim from packages/cli/src/commands/spec.ts (lines 136-138). */
const TEST_KEYWORD_RE =
  /\b(test(?:s|ing)?|verif(?:y|ies|ication)|example(?:s)?|fixture(?:s)?|hits|misses|rule-?tester)\b/i;
const TEST_EXPANSION = ' test testing infrastructure fixture verification testRule rule-tester';

/** Verbatim from packages/cli/src/commands/spec.ts (expandSpecQuery, line 145). */
function expandSpecQuery(query) {
  return TEST_KEYWORD_RE.test(query) ? query + TEST_EXPANSION : query;
}

/** The four context-section marker lines, in prompt order. */
const SECTION_MARKERS = [
  ['knowledge', '=== TOTEM KNOWLEDGE ==='],
  ['specs', '=== RELATED SPECS & ADRs ==='],
  ['code', '=== RELATED CODE ==='],
  ['helpers', '=== SHARED HELPERS (use these instead of reimplementing) ==='],
];

/**
 * A delivered retrieval hit as `formatResults` (packages/cli/src/utils.ts:319)
 * renders it in non-condensed mode:
 *   `- **<label>** (<filePath>, score: <n.nnn>)`
 * followed by the snippet on continuation lines indented by two spaces (so an
 * unindented `- **` line is always a hit header, never snippet content).
 */
const HIT_RE = /^- \*\*(.+?)\*\* \((.+?), score: ([0-9.]+)\)$/;

/**
 * Anchor banner lines emitted by `assemblePrompt`
 * (packages/cli/src/commands/spec.ts:198-220).
 * NOTE: `[\s\S]` not `.` — one recorded issue title contains a literal CR,
 * which `.` does not match in JS.
 */
const ISSUE_BANNER_RE = /^=== ISSUE #(\d+): ([\s\S]*) ===$/;
const RECORD_BANNER_RE = /^=== RECORD ([\s\S]*) ===$/;
const TOPIC_BANNER = '=== TOPIC ===';

/** Secret patterns. Any hit aborts the export. */
const SECRET_PATTERNS = [
  ['google-api-key', /AIza[0-9A-Za-z_\-]{35}/g],
  ['anthropic-key', /sk-ant-[A-Za-z0-9_\-]{20,}/g],
  ['openai-key', /sk-[A-Za-z0-9]{32,}/g],
  ['github-pat-classic', /ghp_[A-Za-z0-9]{36}/g],
  ['github-pat-fine', /github_pat_[A-Za-z0-9_]{22,}/g],
  ['private-key-header', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['slack-token', /xox[abp]-[A-Za-z0-9\-]+/g],
  [
    'assigned-credential',
    /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi,
  ],
];

/** Placeholders emitted by `maskSecrets` (packages/core/src/sanitize.ts). */
const MASK_TOKENS = ['[REDACTED]', '[REDACTED_CUSTOM]'];

// ── Helpers ─────────────────────────────────────────────

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Text between the first `<tag>` line and the matching `</tag>` line, from `lines[from..to)`. */
function xmlBlock(lines, from, to, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let start = -1;
  for (let i = from; i < to; i++) {
    if (lines[i] === open) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < to; i++) {
    if (lines[i] === close) return lines.slice(start + 1, i).join('\n');
  }
  return null;
}

/** `git -C <resident> rev-list -1 --before=<iso> main` — approximate tree at run time. */
const commitCache = new Map();
function mainCommitBefore(iso) {
  if (commitCache.has(iso)) return commitCache.get(iso);
  let sha = null;
  try {
    sha =
      execFileSync('git', ['-C', RESIDENT, 'rev-list', '-1', `--before=${iso}`, 'main'], {
        encoding: 'utf8',
      }).trim() || null;
  } catch {
    sha = null;
  }
  commitCache.set(iso, sha);
  return sha;
}

// ── Prompt parsing ──────────────────────────────────────

/**
 * Split the masked prompt into the anchor zone (everything before the first
 * context marker) and the four context sections. Each section runs from its
 * marker line to the next marker line (or end of prompt).
 */
function splitPrompt(prompt) {
  const lines = prompt.split('\n');
  const starts = {};
  for (const [key, marker] of SECTION_MARKERS) starts[key] = lines.indexOf(marker);

  const missing = SECTION_MARKERS.filter(([k]) => starts[k] === -1).map(([k]) => k);
  const order = SECTION_MARKERS.map(([k]) => k);
  const present = order.filter((k) => starts[k] !== -1);
  const anchorEnd = present.length ? Math.min(...present.map((k) => starts[k])) : lines.length;

  const sections = {};
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    if (starts[key] === -1) {
      sections[key] = '';
      continue;
    }
    const later = order
      .slice(i + 1)
      .map((k) => starts[k])
      .filter((x) => x > starts[key]);
    const end = later.length ? Math.min(...later) : lines.length;
    sections[key] = lines
      .slice(starts[key] + 1, end)
      .join('\n')
      .trim();
  }
  return { lines, anchorLines: lines.slice(0, anchorEnd), sections, missingMarkers: missing };
}

/**
 * Parse every anchor block in the anchor zone, in prompt order (which is the
 * order `spec.ts` pushed the corresponding query parts).
 */
function parseAnchors(anchorLines, anomalies, id) {
  const banners = [];
  for (let i = 0; i < anchorLines.length; i++) {
    const line = anchorLines[i];
    if (!line.startsWith('=== ')) continue;
    const issue = ISSUE_BANNER_RE.exec(line);
    if (issue) {
      banners.push({ kind: 'issue', at: i, number: Number(issue[1]), bannerTitle: issue[2] });
      continue;
    }
    if (line === TOPIC_BANNER) {
      banners.push({ kind: 'topic', at: i });
      continue;
    }
    const record = RECORD_BANNER_RE.exec(line);
    if (record) banners.push({ kind: 'record', at: i, bannerRef: record[1] });
  }

  const anchors = [];
  for (let b = 0; b < banners.length; b++) {
    const start = banners[b].at;
    const end = b + 1 < banners.length ? banners[b + 1].at : anchorLines.length;
    const banner = banners[b];

    if (banner.kind === 'issue') {
      const title = xmlBlock(anchorLines, start, end, 'issue_title');
      const body = xmlBlock(anchorLines, start, end, 'issue_body');
      let labelsRaw = null;
      let state = null;
      for (let i = start; i < end; i++) {
        if (labelsRaw === null && anchorLines[i].startsWith('Labels: ')) {
          labelsRaw = anchorLines[i].slice('Labels: '.length);
        }
        if (state === null && anchorLines[i].startsWith('State: ')) {
          state = anchorLines[i].slice('State: '.length);
        }
      }
      if (title === null) anomalies.push({ id, kind: 'missing-issue_title', number: banner.number });
      if (body === null) anomalies.push({ id, kind: 'missing-issue_body', number: banner.number });
      if (labelsRaw === null) anomalies.push({ id, kind: 'missing-Labels', number: banner.number });
      if (state === null) anomalies.push({ id, kind: 'missing-State', number: banner.number });

      // `assemblePrompt` renders `issue.labels.join(', ')`, with '(none)' for
      // an empty label set; `buildSearchQuery` re-joins the array with ' '.
      const labels =
        labelsRaw === null || labelsRaw === '(none)' || labelsRaw === ''
          ? []
          : labelsRaw.split(', ');

      const titleText = (title ?? '').trim();
      const bodyMasked = (body ?? '').trim();
      anchors.push({
        kind: 'issue',
        ref: `#${banner.number}`,
        number: banner.number,
        title: titleText,
        labels,
        labelsRaw,
        state,
        bodyMasked,
        // buildSearchQuery(issue) — spec.ts:111-115
        queryPart: `${titleText} ${labels.join(' ')} ${bodyMasked.slice(0, QUERY_BODY_TRUNCATE)}`.trim(),
      });
      continue;
    }

    if (banner.kind === 'topic') {
      const text = xmlBlock(anchorLines, start, end, 'topic_text');
      if (text === null) anomalies.push({ id, kind: 'missing-topic_text' });
      const raw = text ?? '';
      if (raw !== raw.trim()) anomalies.push({ id, kind: 'topic-text-has-outer-whitespace' });
      anchors.push({ kind: 'topic', ref: raw.trim(), text: raw.trim(), queryPart: raw });
      continue;
    }

    // Record arm (mmnto-ai/totem#2700) — none present in this cohort; captured
    // so a future export does not silently drop it.
    const body = xmlBlock(anchorLines, start, end, 'record_body');
    anomalies.push({ id, kind: 'record-anchor', ref: banner.bannerRef });
    anchors.push({ kind: 'record', ref: banner.bannerRef, body: body ?? '', queryPart: '' });
  }
  return anchors;
}

function parseHits(sections) {
  const hits = [];
  for (const [section] of SECTION_MARKERS) {
    const text = sections[section];
    if (!text) continue;
    for (const line of text.split('\n')) {
      const m = HIT_RE.exec(line);
      if (m) {
        hits.push({ section, label: m[1], filePath: m[2], score: Number(m[3]) });
      }
    }
  }
  return hits;
}

// ── Export ──────────────────────────────────────────────

function main() {
  const anomalies = [];
  const files = fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json'))
    .map((d) => d.name);

  const selected = [];
  for (const name of files) {
    const raw = fs.readFileSync(path.posix.join(RUNS_DIR, name), 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      anomalies.push({ id: name, kind: 'unparseable-json' });
      continue;
    }
    if (json?.admission?.runMetadata?.caller !== CALLER) continue;
    selected.push({ id: path.basename(name, '.json'), json });
  }
  selected.sort((a, b) =>
    a.json.createdAt === b.json.createdAt
      ? a.id.localeCompare(b.id)
      : a.json.createdAt < b.json.createdAt
        ? -1
        : 1,
  );

  const KNOWN_ITEM_KEYS = new Set(['provenance', 'contentHash', 'sourceType', 'filePath']);
  const artifactRows = [];
  const itemRows = [];
  const stats = {
    kinds: { issue: 0, topic: 0, record: 0 },
    schemaVersion: {},
    model: {},
    hitsBySection: { knowledge: 0, specs: 0, code: 0, helpers: 0 },
    anchorCounts: {},
    itemExtraKeys: new Set(),
  };

  for (const { id, json } of selected) {
    const prompt = json?.inputBundle?.maskedPrompt ?? '';
    const { anchorLines, sections, missingMarkers } = splitPrompt(prompt);
    for (const m of missingMarkers) anomalies.push({ id, kind: 'missing-section-marker', marker: m });

    const anchors = parseAnchors(anchorLines, anomalies, id);
    if (anchors.length === 0) anomalies.push({ id, kind: 'no-anchor-found' });
    stats.anchorCounts[anchors.length] = (stats.anchorCounts[anchors.length] ?? 0) + 1;

    // Artifact kind = the FIRST anchor in prompt order. For the 51 single-anchor
    // artifacts this is the only anchor; for the 4 multi-anchor ones every
    // anchor is preserved in `anchors`.
    const primary = anchors[0] ?? null;
    const kind = primary?.kind ?? null;
    if (kind) stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;

    const firstIssue = anchors.find((a) => a.kind === 'issue') ?? null;
    const firstTopic = anchors.find((a) => a.kind === 'topic') ?? null;

    // spec.ts: `expandSpecQuery(queryParts.join(' '))` — one part per input, in
    // input order, which is the order the anchors appear in the prompt.
    const rawQuery = anchors.map((a) => a.queryPart).join(' ');

    const hits = parseHits(sections);
    for (const h of hits) stats.hitsBySection[h.section] += 1;

    stats.schemaVersion[json.schemaVersion] = (stats.schemaVersion[json.schemaVersion] ?? 0) + 1;
    const modelKey = json?.backend?.qualifiedModel ?? json?.backend?.model ?? '(unknown)';
    stats.model[modelKey] = (stats.model[modelKey] ?? 0) + 1;

    artifactRows.push({
      id,
      schemaVersion: json.schemaVersion,
      createdAt: json.createdAt,
      backend: json.backend,
      inputHash: json.inputHash,
      admission: json.admission,
      mainCommitAtRun: mainCommitBefore(json.createdAt),
      mainCommitAtRunIsApprox: true,
      anchor: primary ? { kind: primary.kind, ref: primary.ref } : null,
      anchorCount: anchors.length,
      anchors: anchors.map((a) =>
        a.kind === 'issue'
          ? { kind: 'issue', ref: a.ref, number: a.number, title: a.title, labels: a.labels, state: a.state }
          : a.kind === 'topic'
            ? { kind: 'topic', ref: a.ref }
            : { kind: a.kind, ref: a.ref },
      ),
      issue: firstIssue
        ? {
            number: firstIssue.number,
            title: firstIssue.title,
            labels: firstIssue.labels,
            state: firstIssue.state,
            bodyMasked: firstIssue.bodyMasked,
          }
        : null,
      topic: kind === 'topic' && firstTopic ? firstTopic.text : null,
      query: {
        raw: rawQuery,
        expanded: expandSpecQuery(rawQuery),
        source: 'rebuilt-from-maskedPrompt',
      },
      deliveredContext: {
        knowledge: sections.knowledge,
        specs: sections.specs,
        code: sections.code,
        helpers: sections.helpers,
      },
      deliveredHits: hits,
      output: { content: json?.output?.content ?? null, metrics: json?.output?.metrics ?? null },
      outputSha256: sha256(json?.output?.content ?? ''),
      promptSha256: sha256(prompt),
      grounding: {
        hash: json?.grounding?.hash ?? null,
        provenanceSummary: json?.grounding?.provenanceSummary ?? null,
        items: json?.grounding?.bundle?.items ?? [],
      },
    });

    const items = json?.grounding?.bundle?.items ?? [];
    items.forEach((item, index) => {
      const extra = {};
      for (const k of Object.keys(item)) {
        if (!KNOWN_ITEM_KEYS.has(k)) {
          extra[k] = item[k];
          stats.itemExtraKeys.add(k);
        }
      }
      itemRows.push({
        artifactId: id,
        index,
        provenance: item.provenance ?? null,
        contentHash: item.contentHash ?? null,
        sourceType: item.sourceType ?? null,
        filePath: item.filePath ?? null,
        ...extra,
      });
    });
  }

  // ── Serialize + secret-scan BEFORE writing anything ───

  const artifactLines = artifactRows.map((r) => JSON.stringify(r));
  const itemLines = itemRows.map((r) => JSON.stringify(r));

  const findings = [];
  const scan = (id, text) => {
    for (const [name, re] of SECRET_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(text)) findings.push({ id, pattern: name });
    }
  };
  artifactLines.forEach((line, i) => scan(artifactRows[i].id, line));
  itemLines.forEach((line, i) => scan(itemRows[i].artifactId, line));

  if (findings.length > 0) {
    console.error('SECRET SCAN FAILED — nothing written. Hits (values withheld):');
    for (const f of findings) console.error(`  artifact ${f.id}  pattern ${f.pattern}`);
    process.exit(1);
  }

  const artifactsText = artifactLines.join('\n') + '\n';
  const itemsText = itemLines.join('\n') + '\n';

  const maskCounts = {};
  for (const token of MASK_TOKENS) {
    maskCounts[token] = countOccurrences(artifactsText, token) + countOccurrences(itemsText, token);
  }

  const artifactsPath = path.join(OUT_DIR, 'artifacts.ndjson');
  const itemsPath = path.join(OUT_DIR, 'grounding-items.ndjson');
  fs.writeFileSync(artifactsPath, artifactsText, 'utf8');
  fs.writeFileSync(itemsPath, itemsText, 'utf8');

  // ── SHA256SUMS over the two datasets + every file under scripts/ ──

  const sumTargets = ['artifacts.ndjson', 'grounding-items.ndjson'];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const r = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, r);
      else if (entry.isFile()) sumTargets.push(r);
    }
  };
  walk(path.join(OUT_DIR, 'scripts'), 'scripts');

  const sumLines = sumTargets
    .sort((a, b) => a.localeCompare(b))
    .map((rel) => `${sha256(fs.readFileSync(path.join(OUT_DIR, rel), 'utf8'))}  ${rel}`);
  const sumsText = sumLines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, 'SHA256SUMS'), sumsText, 'utf8');

  // ── Report ────────────────────────────────────────────

  const dates = artifactRows.map((r) => r.createdAt);
  console.log(`source store        : ${RUNS_DIR}`);
  console.log(`json files scanned  : ${files.length}`);
  console.log(`caller === 'spec'   : ${artifactRows.length}`);
  console.log(`grounding-item rows : ${itemRows.length}`);
  console.log(`anchor kind (first) : ${JSON.stringify(stats.kinds)}`);
  console.log(`anchors per artifact: ${JSON.stringify(stats.anchorCounts)}`);
  console.log(`schemaVersion       : ${JSON.stringify(stats.schemaVersion)}`);
  console.log(`backend model       : ${JSON.stringify(stats.model)}`);
  console.log(`createdAt range     : ${dates[0]} .. ${dates[dates.length - 1]}`);
  console.log(`deliveredHits/sect  : ${JSON.stringify(stats.hitsBySection)}`);
  console.log(`deliveredHits total : ${Object.values(stats.hitsBySection).reduce((a, b) => a + b, 0)}`);
  console.log(`mask placeholders   : ${JSON.stringify(maskCounts)}`);
  console.log(`item extra keys     : ${JSON.stringify([...stats.itemExtraKeys])}`);
  console.log(`secret scan         : 0 hits over ${artifactsText.length + itemsText.length} bytes`);
  console.log(`artifacts.ndjson    : ${fs.statSync(artifactsPath).size} bytes`);
  console.log(`grounding-items     : ${fs.statSync(itemsPath).size} bytes`);
  console.log(`anomalies           : ${anomalies.length}`);
  for (const a of anomalies) console.log(`  ${JSON.stringify(a)}`);
  console.log('SHA256SUMS:');
  for (const line of sumLines) console.log(`  ${line}`);

  const sampleIssue = artifactRows.find((r) => r.anchor?.kind === 'issue');
  const sampleTopic = artifactRows.find((r) => r.anchor?.kind === 'topic');
  for (const [label, row] of [
    ['issue', sampleIssue],
    ['topic', sampleTopic],
  ]) {
    if (!row) continue;
    console.log(`sample ${label} (${row.id.slice(0, 12)}) query.raw[0:200]:`);
    console.log(`  ${JSON.stringify(row.query.raw.slice(0, 200))}`);
  }
}

main();
