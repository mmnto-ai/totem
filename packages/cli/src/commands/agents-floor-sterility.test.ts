/**
 * The public AGENTS.md floor stays sterile (mmnto-ai/totem-strategy#619 —
 * the T0 floor / T1 overlay split; the sterility sensor of design v1 § 3).
 *
 * Three claims, each mechanical:
 *
 * 1. This repository's committed AGENTS.md carries the `totem init` managed
 *    span byte-identically — the "sterile floor IS the init scaffold" product
 *    test the issue names (design § 3(a), the managed-block == template check).
 * 2. Neither the template nor any public agent-instruction surface of this
 *    repository carries a private repository path, a deployment name, an
 *    operator fingerprint or a doctrine tag from the ENUMERATED lexicon below
 *    (design § 3(c) T1-creep lexicon — a deny-list, never class coverage), an
 *    unqualified issue reference, or a relative link that does not resolve
 *    case-exactly on disk (design § 3(b) offline half; class 5 acceptance).
 * 3. The one declared exception is the `totem:agent-bus` marker line
 *    (inventory ruling row 20; the move is mmnto-ai/totem#2866): no other line
 *    of the floor, and no line of the template, names an agent identifier.
 *
 * The network half of the acceptance test (every URL resolves unauthenticated)
 * is `tools/public-refs-resolve.mjs`, run by the floor's author before posting;
 * it needs the network, so it is not a test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENTS_FLOOR_BLOCK,
  AGENTS_FLOOR_END,
  AGENTS_FLOOR_START,
  BARE_REF_REGEX_SOURCE,
  renderAgentsFloorScaffold,
} from './init-templates.js';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/**
 * The public agent-instruction surfaces of this repository: the floor, the
 * per-tool redirects, the self-contained Junie twin, and the docs the floor
 * links. The Gemini styleguide and the distributed skills are deliberately NOT
 * here — the styleguide's doctrine links are the review bot's rationale and
 * the skills are managed text; both are the owed follow-up sweep, not this
 * sensor's claim.
 */
const PUBLIC_SURFACES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.junie/guidelines.md',
  '.claude/docs/architecture.md',
  '.claude/docs/contributing.md',
  '.claude/docs/agent-workflow.md',
] as const;

/**
 * An ENUMERATED lexicon, not class coverage: the private repositories and
 * doctrine paths that 404 publicly (class 5), the deployment names (class 2)
 * and the operator fingerprints (class 3) this cohort's surfaces have carried.
 * A new private name has to be added here to be caught; the network script
 * catches the resolvable-URL half regardless.
 */
const DENY_SUBSTRINGS = [
  'totem-strategy',
  'strategy#',
  'totem-playground',
  'liquid-city',
  'satur8d',
  'skynet',
  'arhgap',
  'solo-operator',
] as const;

/**
 * Doctrine tags a public reader cannot follow, and the internal review
 * vocabulary — hyphen or space or nothing between the word and the number, and
 * case-insensitive for ADR and Tenet (so `adr-105`, `ADR 105`, `tenet 20` and
 * `Tenet-16` all fire); the Proposal pattern keeps its case, see its comment.
 */
const DENY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'an ADR tag', re: /\badr[- ]?\d+/i },
  // `Prop 305` / `PROP 305` (the abbreviation is capitalized in doctrine prose)
  // or `proposal 213` in any case, an optional period after either — never a
  // lowercase `prop 1` in ordinary prose.
  { name: 'a Proposal tag', re: /\b(?:Prop|PROP|[Pp]roposal|PROPOSAL)\.?[- ]?\d+/ },
  { name: 'a Tenet tag', re: /\btenet[- ]?\d+/i },
  { name: 'internal review vocabulary', re: /\b(?:review-leg|cohort|falsification)\b/i },
];

/** The seat roster's shape: `<repo>-<vendor>`. */
const AGENT_ID = /\b(?:totem|strategy|status|lc)-(?:claude|gemini|agy|codex|kimi)\b/;
const AGENT_BUS_MARKER = 'totem:agent-bus';

/** Vendor names never appear in the template (the register rule: standards and layers, not vendor lists). */
const VENDOR_TOKENS = /\b(?:Claude|Gemini|Cursor|Copilot|Codex|Junie|Windsurf|Kimi)\b/;

const BARE_REF = new RegExp(BARE_REF_REGEX_SOURCE);
const MD_LINK = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;

/**
 * Case-exact existence: `fs.existsSync` answers case-insensitively on NTFS and
 * on a default macOS volume, while github.com does not, so a link that differs
 * from the tracked file only by case would pass here and 404 there. Each path
 * segment is matched against the directory listing byte-for-byte.
 */
function existsExact(absPath: string): boolean {
  const relative = path.relative(ROOT, absPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let cursor = ROOT;
  for (const segment of relative.split(/[\\/]+/).filter((s) => s !== '')) {
    let entries: string[];
    try {
      entries = fs.readdirSync(cursor);
      // totem-context: a missing or unreadable directory means the link does not resolve — the false answer is the finding
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    cursor = path.join(cursor, segment);
  }
  return true;
}

function expectSterile(label: string, content: string): void {
  for (const needle of DENY_SUBSTRINGS) {
    expect(content, `${label} carries "${needle}"`).not.toContain(needle);
  }
  for (const { name, re } of DENY_PATTERNS) {
    expect(content, `${label} carries ${name}`).not.toMatch(re);
  }
  expect(content, `${label} carries an unqualified issue reference`).not.toMatch(BARE_REF);
}

// ─── 1. The committed floor carries the managed span byte-identically ─

describe('this repository AGENTS.md carries the totem init floor span', () => {
  const agentsMd = readRoot('AGENTS.md');

  it('carries exactly one managed span, byte-identical to AGENTS_FLOOR_BLOCK', () => {
    const start = agentsMd.indexOf(AGENTS_FLOOR_START);
    const end = agentsMd.indexOf(AGENTS_FLOOR_END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(agentsMd.lastIndexOf(AGENTS_FLOOR_START)).toBe(start);
    expect(agentsMd.lastIndexOf(AGENTS_FLOOR_END)).toBe(end);
    expect(agentsMd.slice(start, end + AGENTS_FLOOR_END.length)).toBe(AGENTS_FLOOR_BLOCK);
  });
});

// ─── 2. Sterility: the template and every public surface ────────────

describe('the floor template is sterile', () => {
  it.each([
    ['AGENTS_FLOOR_BLOCK', AGENTS_FLOOR_BLOCK],
    ['the rendered scaffold', renderAgentsFloorScaffold('example')],
  ])(
    '%s carries no private path, deployment, operator, doctrine tag or bare reference',
    (label, content) => {
      expectSterile(label, content);
    },
  );

  it.each([
    ['AGENTS_FLOOR_BLOCK', AGENTS_FLOOR_BLOCK],
    ['the rendered scaffold', renderAgentsFloorScaffold('example')],
  ])('%s names no agent identifier and no agent vendor', (label, content) => {
    expect(content, `${label} names an agent identifier`).not.toMatch(AGENT_ID);
    expect(content, `${label} names a vendor`).not.toMatch(VENDOR_TOKENS);
  });

  it('the scaffold title carries the project name and the span exactly once', () => {
    const rendered = renderAgentsFloorScaffold('widgets');
    expect(rendered.startsWith('# widgets: Agent Instructions\n')).toBe(true);
    expect(rendered.indexOf(AGENTS_FLOOR_BLOCK)).toBe(rendered.lastIndexOf(AGENTS_FLOOR_BLOCK));
    expect(rendered.indexOf(AGENTS_FLOOR_BLOCK)).toBeGreaterThan(-1);
  });
});

describe('every public agent-instruction surface of this repository is sterile', () => {
  it.each(PUBLIC_SURFACES)(
    '%s carries no private path, deployment, operator, doctrine tag or bare reference',
    (rel) => {
      expectSterile(rel, readRoot(rel));
    },
  );

  it.each(PUBLIC_SURFACES)('%s: every relative link resolves to a file in the tree', (rel) => {
    const content = readRoot(rel);
    const dir = path.dirname(path.join(ROOT, rel));
    for (const match of content.matchAll(MD_LINK)) {
      const target = match[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // an absolute URL or mailto: — the network script's half
      expect(existsExact(path.resolve(dir, target)), `${rel} links ${target}`).toBe(true);
    }
  });
});

// ─── 3. The one declared exception ──────────────────────────────────

describe('agent identifiers in the floor', () => {
  const lines = readRoot('AGENTS.md').split(/\r?\n/);

  it('appear on the totem:agent-bus marker line and nowhere else', () => {
    const markerLines = lines.filter((line) => line.includes(AGENT_BUS_MARKER));
    expect(markerLines).toHaveLength(1);
    expect(markerLines[0]).toMatch(AGENT_ID);
    for (const line of lines) {
      if (line.includes(AGENT_BUS_MARKER)) continue;
      expect(line, `floor line names an agent identifier: ${line}`).not.toMatch(AGENT_ID);
    }
  });

  it.each(PUBLIC_SURFACES.filter((rel) => rel !== 'AGENTS.md'))(
    '%s names no agent identifier at all',
    (rel) => {
      expect(readRoot(rel)).not.toMatch(AGENT_ID);
    },
  );
});
