import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ContentType,
  GroundingAnchor,
  LanceStore,
  SearchResult,
  TotemConfigError as TotemConfigErrorClass,
} from '@mmnto/totem';

import type { StandardIssue } from '../adapters/issue-adapter.js';
import {
  GROUNDING_ANCHOR_FREE_TEXT,
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_MIXED,
  GROUNDING_ANCHOR_RECORD,
  PROMPT_SOURCE_BUILTIN,
  PROMPT_SOURCE_OVERRIDE,
} from '../artifact-vocabulary.js';
import { SYSTEM_PROMPT } from './spec-templates.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Spec';
const QUERY_BODY_TRUNCATE = 500;
const MAX_INPUTS = 5;
/** Digest prefix rendered into the prompt's RECORD banner — identity, not the whole digest. */
const RECORD_SHA_PROMPT_PREFIX = 12;
/** Separator between several topics (and between the issue half and the topic half of a `mixed` ref). */
const ANCHOR_TOPIC_JOIN = ' | ';
/** Separator between several issue refs. */
const ANCHOR_ISSUE_JOIN = ', ';
/** Decimal places every relevance and floor is disclosed at (the MCP guard's shape). */
const RELEVANCE_DECIMALS = 3;
/** Where the floor comes from — named in every refusal (B1: the config-vs-default bit is NOT derivable after `TotemConfigSchema.parse`). */
const FLOOR_PLACE = 'searchRelevanceFloor in totem.config.ts (schema default 0.25 when unset)';
/** The two cures, named in every refusal and in the gate's BLOCKED line. */
const ANCHOR_CURES = "run 'totem spec <issue>' or 'totem spec --from <record>'";
export const MAX_LESSONS = 10;
export const MAX_LESSON_CHARS = 8_000;
const SPEC_SEARCH_POOL = 20;
const MAX_SPECS = 5;
const MAX_SESSIONS = 5;
const MAX_CODE_RESULTS = 3;

// ─── System prompt ──────────────────────────────────────

export { SPEC_SYSTEM_PROMPT } from './spec-templates.js';

// ─── Issue helpers ──────────────────────────────────────

// ─── LanceDB retrieval ─────────────────────────────────

export interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
  lessons: SearchResult[];
}

export async function retrieveContext(
  query: string,
  store: LanceStore,
  linkedStores?: LanceStore[],
): Promise<RetrievedContext> {
  const { log } = await import('../ui.js');
  const { partitionLessons } = await import('../utils.js');
  const search = (s: LanceStore, typeFilter: ContentType, maxResults: number) =>
    s.search({ query, typeFilter, maxResults });

  // Fetch from primary store
  const [allSpecs, sessions, code] = await Promise.all([
    search(store, 'spec', SPEC_SEARCH_POOL),
    search(store, 'session_log', MAX_SESSIONS),
    search(store, 'code', MAX_CODE_RESULTS),
  ]);

  // Fetch specs from linked stores (cross-totem knowledge)
  if (linkedStores && linkedStores.length > 0) {
    const linkedResults = await Promise.all(
      linkedStores.map((ls) =>
        search(ls, 'spec', MAX_SPECS).catch((err) => {
          // Network/connection failures → graceful degradation (return empty)
          // Config/parse errors → surface to user so they can fix their setup
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('FetchError')
          ) {
            return [] as SearchResult[];
          }
          log.warn(TAG, `Linked store query failed: ${msg}`);
          return [] as SearchResult[];
        }),
      ),
    );
    allSpecs.push(...linkedResults.flat());
    // Re-sort by score after merging
    allSpecs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // Partition: lessons come from lessons.md, everything else is a spec/ADR
  const { lessons, specs } = partitionLessons(allSpecs, MAX_LESSONS, MAX_SPECS);

  return { specs, sessions, code, lessons };
}

function buildSearchQuery(issue: StandardIssue): string {
  const labels = issue.labels.join(' ');
  const bodySnippet = issue.body.slice(0, QUERY_BODY_TRUNCATE);
  return `${issue.title} ${labels} ${bodySnippet}`.trim();
}

/** Text of the first markdown heading in `body`, or `''` when it carries none. */
function firstHeadingText(body: string): string {
  for (const line of body.split('\n')) {
    const match = line.match(/^#{1,6}[ \t]+(.+)$/);
    if (match) return match[1]!.trim();
  }
  return '';
}

/**
 * Retrieval query for a bound record (mmnto-ai/totem#2700) — the same shape
 * {@link buildSearchQuery} gives an issue: the record's own title (its first
 * markdown heading) plus the head of its body, so a record retrieves the same
 * way an issue does rather than through a hand-picked slug.
 */
export function buildRecordSearchQuery(record: SpecRecord): string {
  return `${firstHeadingText(record.body)} ${record.body.slice(0, QUERY_BODY_TRUNCATE)}`.trim();
}

const TEST_KEYWORD_RE =
  /\b(test(?:s|ing)?|verif(?:y|ies|ication)|example(?:s)?|fixture(?:s)?|hits|misses|rule-?tester)\b/i;
const TEST_EXPANSION = ' test testing infrastructure fixture verification testRule rule-tester';

/**
 * Expand a spec search query with test-infrastructure keywords when the
 * original query mentions testing concepts.  This helps the vector search
 * surface existing helpers like `rule-tester.ts`.
 */
export function expandSpecQuery(query: string): string {
  return TEST_KEYWORD_RE.test(query) ? query + TEST_EXPANSION : query;
}

// ─── Input types ────────────────────────────────────────

/**
 * A hand-authored design record bound with `--from` (mmnto-ai/totem#2700).
 * Read ONCE as a Buffer at command start: `sha256` and `body` come from that
 * same buffer, so the digest and the bytes rendered into the prompt agree by
 * construction. The record is never written back.
 */
export interface SpecRecord {
  /** Repo-relative path (forward slashes) — the anchor's `ref`; the gate reads the file at this path from the worktree top. */
  path: string;
  /** sha256 (hex) of the very bytes rendered into the prompt. */
  sha256: string;
  /** The record's text, decoded utf-8 from the same buffer the digest was taken over. */
  body: string;
}

export interface ParsedInput {
  issue: StandardIssue | null;
  freeText: string | null;
  /** The bound design record (mmnto-ai/totem#2700) — the third arm; `null` on the issue and topic arms. */
  record: SpecRecord | null;
  /**
   * The ISSUE input exactly as typed (`owner/repo#N` or a URL) — the anchor's
   * `ref` must round-trip what the operator wrote, and a fetched
   * {@link StandardIssue} carries only the number. Absent for a bare-number
   * input (the ref is then `#<number>`) and on the topic / record arms, whose
   * refs are the topic text and the record path.
   */
  issueRef?: string;
}

// ─── Prompt assembly ────────────────────────────────────

export async function assemblePrompt(
  inputs: ParsedInput[],
  context: RetrievedContext,
  systemPrompt: string,
): Promise<string> {
  const { formatLessonSection, formatResults, wrapXml } = await import('../utils.js');
  const sections: string[] = [systemPrompt];

  for (const { issue, freeText, record } of inputs) {
    if (issue) {
      const issueLabels = issue.labels.join(', ');
      sections.push(`\n=== ISSUE #${issue.number}: ${issue.title} ===`);
      sections.push(wrapXml('issue_title', issue.title));
      sections.push(`Labels: ${issueLabels || '(none)'}`);
      sections.push(`State: ${issue.state}`);
      if (issue.body) {
        sections.push('');
        sections.push(wrapXml('issue_body', issue.body));
      }
    } else if (record) {
      // The bound record enters the prompt VERBATIM, banner-identified by the
      // path the anchor records and the head of the digest the anchor binds —
      // so the prompt and `grounding.anchor` name the same bytes.
      sections.push(
        `\n=== RECORD ${record.path} (sha256 ${record.sha256.slice(0, RECORD_SHA_PROMPT_PREFIX)}) ===`,
      );
      sections.push(wrapXml('record_body', record.body));
    } else if (freeText) {
      sections.push('\n=== TOPIC ===');
      sections.push(wrapXml('topic_text', freeText));
    }
  }

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RELATED SPECS & ADRs');
  const sessionSection = formatResults(context.sessions, 'RELATED SESSION HISTORY');
  const codeSection = formatResults(context.code, 'RELATED CODE');

  if (specSection || sessionSection || codeSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
    if (codeSection) sections.push(codeSection);
  }

  // Lessons — full bodies, capped by total character budget
  const lessonSection = formatLessonSection(context.lessons, MAX_LESSON_CHARS);
  if (lessonSection) sections.push(lessonSection);

  // Prior art concierge (#1015): inject shared helper signatures
  const { formatSharedHelpers, getSharedHelpers } = await import('@mmnto/totem');
  const helperSection = formatSharedHelpers(getSharedHelpers());
  if (helperSection) {
    sections.push('\n' + helperSection);
  }

  return sections.join('\n');
}

// ─── Output routing (mmnto-ai/totem#1555) ──────────────

export interface SpecOptions {
  raw?: boolean;
  out?: string;
  stdout?: boolean;
  model?: string;
  fresh?: boolean;
  /** Path to a hand-authored design record to ground the run on (mmnto-ai/totem#2700). */
  from?: string;
}

/**
 * mmnto-ai/totem#1555: validate that --stdout and --out are not used together.
 * Run before any LLM call so a user-error surfaces in <50ms with no API cost.
 */
export function validateOutputOptions(
  options: Pick<SpecOptions, 'out' | 'stdout'>,
  TotemConfigErrorCtor: typeof TotemConfigErrorClass,
): void {
  if (options.stdout && options.out) {
    throw new TotemConfigErrorCtor(
      '--stdout and --out cannot be used together.',
      'Pick one: --out <path> writes to a specific file; --stdout writes to standard output.',
      'CONFIG_INVALID',
    );
  }
}

// ─── Invocation validation (mmnto-ai/totem#2700) ────────
//
// Every check below runs BEFORE the config is resolved, before the store
// connects and before any LLM call — a user error surfaces with no API cost
// and no artifact written.

/**
 * Refuse the two invocation shapes that carry no single grounded subject:
 * nothing at all (commander no longer refuses it — `spec [inputs...]` is
 * optional so `--from` is reachable, mmnto-ai/totem#2700 B2), and a record
 * bound alongside positional inputs (two subjects, one anchor).
 */
export function validateSpecInvocation(
  inputs: string[],
  options: Pick<SpecOptions, 'from'>,
  TotemConfigErrorCtor: typeof TotemConfigErrorClass,
): void {
  const hasRecord = options.from !== undefined;
  if (hasRecord && inputs.length > 0) {
    throw new TotemConfigErrorCtor(
      `--from <record> cannot be combined with positional inputs (${inputs.join(', ')}).`,
      'Pass one or the other: issue/topic inputs, or --from <record>.',
      'CONFIG_INVALID',
    );
  }
  if (!hasRecord && inputs.length === 0) {
    throw new TotemConfigErrorCtor(
      'No inputs. `totem spec` needs at least one issue/topic, or --from <record>.',
      'Usage: totem spec [inputs...] [--from <record>] — e.g. `totem spec 2700`, `totem spec "cache invalidation"`, or `totem spec --from .totem/specs/2700.md`.',
      'CONFIG_INVALID',
    );
  }
}

export interface SpecRecordDeps {
  resolveGitRoot: (cwd: string) => string | null;
}

/**
 * Whether a root-relative record path ESCAPES the repository — the containment
 * gate on `grounding.anchor.ref` (mmnto-ai/totem#2700).
 *
 * The published ref is resolved by the strict pre-commit reader from the
 * WORKTREE TOP, so a path that leaves the root names a file the gate would
 * read from outside the repo: `--from ../sibling/x.md` binds `../sibling/x.md`,
 * and a record on another drive binds an absolute path (`path.relative` returns
 * one when the two paths share no root). The hook carries the same refusal —
 * the artifact is hand-editable, so neither half may trust the other — but a
 * ref that escapes must never be MINTED either.
 *
 * Both `path` flavors are consulted because the caller normalizes to forward
 * slashes before asking: `D:/x.md` is not a repo-relative path on ANY platform,
 * so the answer must not depend on which one is running.
 *
 * Containment is decided by NORMALIZATION, not by inspecting the first segment:
 * `a/../../x.md` escapes the root even though its first segment does not say
 * so, while a mid-path `..` that stays inside (`a/../b.md`) is contained and
 * legal. `path.posix.normalize` is the cwd-free equivalent of the reader's
 * `resolve` + `relative` containment test, so both sides answer the same on the
 * same input — the predicate is compared by path SEGMENT throughout, which is
 * why a file named `..notes.md` inside the root stays legal.
 */
export function isRecordPathOutsideRoot(relativePath: string): boolean {
  if (path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) return true;
  const normalized = path.posix.normalize(relativePath);
  return normalized === '..' || normalized.startsWith('../');
}

export interface LoadedSpecRecord {
  record: SpecRecord;
  /** The record's resolved absolute path — the subject of the `--out` collision check. */
  absolutePath: string;
}

/**
 * Read and bind the `--from` record. ONE `readFileSync` produces both the
 * digest and the prompt bytes, so `grounding.anchor.sha256` provably names
 * what the model was shown. Every rejection names the path.
 */
export function loadSpecRecord(
  fromPath: string,
  cwd: string,
  deps: SpecRecordDeps,
  TotemConfigErrorCtor: typeof TotemConfigErrorClass,
): LoadedSpecRecord {
  const absolutePath = path.resolve(cwd, fromPath);

  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch (err) {
    throw new TotemConfigErrorCtor(
      `--from record not found: ${absolutePath}`,
      'Point --from at an existing design record (a markdown file you wrote).',
      'CONFIG_INVALID',
      err,
    );
  }
  if (!stats.isFile()) {
    throw new TotemConfigErrorCtor(
      `--from record is not a file: ${absolutePath}`,
      'Point --from at the record file itself, not a directory.',
      'CONFIG_INVALID',
    );
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (err) {
    throw new TotemConfigErrorCtor(
      `--from record is unreadable: ${absolutePath}`,
      'Check the file permissions and retry.',
      'CONFIG_INVALID',
      err,
    );
  }

  const body = buffer.toString('utf-8');
  if (body.trim().length === 0) {
    throw new TotemConfigErrorCtor(
      `--from record is empty: ${absolutePath}`,
      'Write the record before binding it — an empty record grounds nothing.',
      'CONFIG_INVALID',
    );
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  // Repo-relative with forward slashes: the strict pre-commit reader resolves
  // this ref from the worktree top, which is where git runs hooks.
  const root = deps.resolveGitRoot(cwd) ?? cwd;
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  if (isRecordPathOutsideRoot(relativePath)) {
    throw new TotemConfigErrorCtor(
      `--from record is outside the repository: ${absolutePath} (git root ${root}).`,
      'Point --from at a record inside this repo — the pre-commit gate resolves the bound ref from the worktree top.',
      'CONFIG_INVALID',
    );
  }

  return { record: { path: relativePath, sha256, body }, absolutePath };
}

/**
 * Whether two paths are the same FILE, not merely the same spelling.
 *
 * Three tests, cheapest first: the resolved spellings (which is all a
 * not-yet-created `--out` has), the two paths' real targets (a SYMLINK to the
 * record resolves to the record), and the filesystem's own identity —
 * `(dev, ino)` — which is the only thing that catches a HARDLINK, whose two
 * names are equally real and share no path relationship at all.
 *
 * Only the spelling test runs when either path is absent — `--out` usually does
 * not exist yet, and a path that names nothing cannot alias the record. Once
 * both exist the `fs` calls run UNGUARDED: a realpath or stat that fails on a
 * file we just saw is a real fault (a permission change, a vanished volume),
 * and swallowing it would silently downgrade this check to the spelling
 * comparison it exists to replace.
 */
function isSameFile(a: string, b: string): boolean {
  if (path.relative(a, b).length === 0) return true;
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  const realA = fs.realpathSync.native(a);
  const realB = fs.realpathSync.native(b);
  if (path.relative(realA, realB).length === 0) return true;
  const statA = fs.statSync(realA);
  const statB = fs.statSync(realB);
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

/**
 * `--out` may never resolve to the bound record: the tool BINDS a hand-authored
 * record, it never drafts over it. Identity is decided by {@link isSameFile},
 * so a symlink or a hardlink pointed at the record is refused with the same
 * words a literal path collision gets — a spelling comparison alone would let
 * either one through and clobber the record.
 */
export function assertOutDoesNotOverwriteRecord(
  out: string | undefined,
  recordAbsolutePath: string,
  cwd: string,
  TotemConfigErrorCtor: typeof TotemConfigErrorClass,
): void {
  if (out === undefined) return;
  if (!isSameFile(path.resolve(cwd, out), recordAbsolutePath)) return;
  throw new TotemConfigErrorCtor(
    `--out resolves to the --from record (${recordAbsolutePath}) — totem spec never drafts over the record.`,
    'Send the draft elsewhere: --out <another path>, or --stdout.',
    'CONFIG_INVALID',
  );
}

// ─── Anchor + floor (mmnto-ai/totem#2700) ───────────────

/** Highest C0 control code unit; everything at or below it is collapsed in an anchor ref. */
const ANCHOR_REF_C0_MAX = 0x1f;
/** DEL — first code unit of the DEL/C1 band the anchor ref collapses. */
const ANCHOR_REF_C1_MIN = 0x7f;
/** Last C1 control code unit (0x9f); U+0085 NEL sits inside this band. */
const ANCHOR_REF_C1_MAX = 0x9f;
/** What a collapsed control character is rendered as — the same substitute the hook's reader uses. */
const ANCHOR_REF_SUBSTITUTE = '?';

/**
 * Collapse control characters in a free-text topic to `?` before it becomes an
 * anchor `ref` (mmnto-ai/totem#2700).
 *
 * A topic is the ONE anchor ref the CLI builds out of raw argv, so it is the
 * one that can carry a tab or a newline the user typed. `GroundingAnchorSchema`
 * refuses such a ref outright — correctly, since the pre-commit hook echoes it
 * — but that refusal fires inside `saveRunArtifact`, under `runOrchestrator`'s
 * warn-and-continue catch: the draft would survive and only the ARTIFACT would
 * be lost, silently, for a ref the CLI itself produced. Collapsing at the mint
 * site keeps the artifact writable and the echo safe, and the substitution is
 * the same one the reader applies defensively to what it reads back.
 *
 * Only the TOPIC text is collapsed. An issue ref is a number or a URL and a
 * record ref must stay byte-exact — the hook RESOLVES it, so a rewritten record
 * path would name a file that is not the bound record.
 */
function sanitizeTopicRef(topic: string): string {
  let out = '';
  for (const character of topic) {
    const code = character.codePointAt(0) ?? 0;
    const control =
      code <= ANCHOR_REF_C0_MAX || (code >= ANCHOR_REF_C1_MIN && code <= ANCHOR_REF_C1_MAX);
    out += control ? ANCHOR_REF_SUBSTITUTE : character;
  }
  return out;
}

/** The anchor's `ref` for one issue arm: the input as typed, `#<n>` for a bare number. */
function issueAnchorRef(input: ParsedInput): string {
  const issue = input.issue;
  if (!issue) return '';
  const typed = input.issueRef;
  if (typed !== undefined && !/^\d+$/.test(typed)) return typed;
  return `#${issue.number}`;
}

/**
 * Classify what the run is ANCHORED on (mmnto-ai/totem#2700). A record wins
 * outright (it is the only kind carrying bytes); otherwise the kind is
 * `issue` when every input resolved to an issue, `free-text` when every input
 * is a topic, and the honest `mixed` when both are present — `mixed` proceeds
 * (an issue IS grounding) but is not gate evidence, because its free-text half
 * is the confabulation surface.
 *
 * The caller guarantees at least one parsed input ({@link
 * validateSpecInvocation}); the schema's non-empty `ref` refine is the
 * backstop if that ever stops holding. Topic text passes through {@link
 * sanitizeTopicRef} on the way into the ref, so a control character the user
 * typed cannot cost the run its artifact.
 */
export function resolveGroundingAnchor(parsed: ParsedInput[]): GroundingAnchor {
  const bound = parsed.find((input) => input.record !== null)?.record;
  if (bound) {
    return { kind: GROUNDING_ANCHOR_RECORD, ref: bound.path, sha256: bound.sha256 };
  }
  const issueRefs = parsed.filter((input) => input.issue !== null).map(issueAnchorRef);
  const topics = parsed
    .filter((input) => input.issue === null && input.freeText !== null)
    .map((input) => sanitizeTopicRef(input.freeText!));

  if (topics.length === 0) {
    return { kind: GROUNDING_ANCHOR_ISSUE, ref: issueRefs.join(ANCHOR_ISSUE_JOIN) };
  }
  if (issueRefs.length === 0) {
    return { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: topics.join(ANCHOR_TOPIC_JOIN) };
  }
  return {
    kind: GROUNDING_ANCHOR_MIXED,
    ref: `${issueRefs.join(ANCHOR_ISSUE_JOIN)}${ANCHOR_TOPIC_JOIN}${topics.join(ANCHOR_TOPIC_JOIN)}`,
  };
}

/** One below-floor candidate, disclosed as path + relevance only — never content. */
export interface WithheldCandidate {
  filePath: string;
  sourceRepo?: string;
  relevance: number;
}

export interface GroundingFloorVerdict {
  /** True when the run must be refused before any LLM call and before any artifact is minted. */
  refuse: boolean;
  /** Retrieved items across all four partitions. */
  hits: number;
  /** The highest relevance among signal-bearing items; `null` when nothing carried a vector leg. */
  bestRelevance: number | null;
  /** The below-floor signal-bearing candidates the refusal withheld — empty whenever the run proceeds. */
  withheld: WithheldCandidate[];
  /** Items with no relevance at all (FTS-only) — floor-EXEMPT, never withheld for a weak sibling's sake. */
  floorExempt: number;
}

/**
 * Judge the retrieval against the relevance floor, over ALL items across the
 * four partitions (mmnto-ai/totem#2700). Mirrors the MCP tool's semantics
 * (`packages/mcp/src/tools/search-knowledge.ts`): the floor fires only when a
 * real relevance signal exists, and judges only the hits that carry one —
 * keyword-only hits have no comparable relevance and are floor-EXEMPT, so a
 * mixed batch is never withheld because its vector-leg siblings scored weak.
 *
 * Zero items is this command's OWN rule, not an MCP mirror: nothing retrieved
 * means nothing grounds the run, so it refuses regardless of any floor.
 */
export function evaluateGroundingFloor(
  context: RetrievedContext,
  floor: number,
): GroundingFloorVerdict {
  const all = [...context.specs, ...context.sessions, ...context.code, ...context.lessons];
  if (all.length === 0) {
    return { refuse: true, hits: 0, bestRelevance: null, withheld: [], floorExempt: 0 };
  }

  const signal: WithheldCandidate[] = [];
  let floorExempt = 0;
  let bestRelevance: number | null = null;
  for (const hit of all) {
    const relevance = hit.relevance;
    // Finite or it is not a signal. The core bundle builder DROPS a non-finite
    // relevance from the item it writes, so a NaN/Infinity hit reaches the
    // artifact with no relevance at all — exactly an FTS-only hit's shape.
    // Counting it as signal here disagreed with that: it made `floorExempt`
    // zero and let a NaN be disclosed as a withheld `relevance NaN` candidate
    // beside a genuinely weak sibling.
    if (typeof relevance !== 'number' || !Number.isFinite(relevance)) {
      floorExempt += 1;
      continue;
    }
    signal.push({
      filePath: hit.filePath,
      ...(hit.sourceRepo !== undefined ? { sourceRepo: hit.sourceRepo } : {}),
      relevance,
    });
    if (bestRelevance === null || relevance > bestRelevance) bestRelevance = relevance;
  }

  const refuse =
    signal.length > 0 && bestRelevance !== null && bestRelevance < floor && floorExempt === 0;
  return {
    refuse,
    hits: all.length,
    bestRelevance,
    withheld: refuse ? signal : [],
    floorExempt,
  };
}

/**
 * The refusal's text: the topic(s) refused, the measurement (`0 hits` or the
 * best relevance), the floor's VALUE and its PLACE, and every withheld
 * candidate as `path — relevance` (linked hits prefixed with their store).
 * Exclusion is disclosed, never silently dropped.
 */
export function formatGroundingRefusal(
  topics: string,
  verdict: GroundingFloorVerdict,
  floor: number,
): { message: string; recoveryHint: string } {
  const lines = [`Refusing to draft an unanchored spec for topic(s): ${topics}.`];
  if (verdict.hits === 0) {
    lines.push('Retrieval returned 0 hits — nothing in the index grounds this run.');
  } else {
    const best = verdict.bestRelevance ?? 0;
    lines.push(
      `Retrieval returned ${verdict.hits} hits, but best relevance ${best.toFixed(RELEVANCE_DECIMALS)} is below the floor.`,
    );
  }
  lines.push(`floor ${floor.toFixed(RELEVANCE_DECIMALS)} — ${FLOOR_PLACE}`);
  if (verdict.withheld.length > 0) {
    lines.push('Withheld candidates (path + relevance only, no content):');
    for (const [index, candidate] of verdict.withheld.entries()) {
      const label = candidate.sourceRepo
        ? `[${candidate.sourceRepo}] ${candidate.filePath}`
        : candidate.filePath;
      lines.push(
        `${index + 1}. ${label} — relevance ${candidate.relevance.toFixed(RELEVANCE_DECIMALS)}`,
      );
    }
  }
  return {
    message: lines.join('\n'),
    recoveryHint: `To anchor the run, ${ANCHOR_CURES}. To inspect the retrieval without drafting, run 'totem spec --raw <topic>'.`,
  };
}

/**
 * Sanitize a free-form topic string for use as a filename stem. Replaces any
 * character outside `[a-zA-Z0-9_-]` with a single dash, collapses runs, and
 * trims leading/trailing dashes. Returns `''` for inputs that sanitize to
 * nothing — caller decides the fallback.
 */
export function sanitizeSpecFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface ResolveSpecPathDeps {
  resolveGitRoot: (cwd: string) => string | null;
  pathJoin: (...parts: string[]) => string;
}

/**
 * Derive the default spec output path under `<gitRoot>/.totem/specs/<stem>.md`.
 * Returns `null` for ambiguous cases (multi-input, empty topic) — the caller
 * falls back to stdout with a hint.
 */
export function resolveDefaultSpecPath(
  parsedInputs: ParsedInput[],
  cwd: string,
  deps: ResolveSpecPathDeps,
): string | null {
  if (parsedInputs.length !== 1) return null;
  const first = parsedInputs[0]!;
  // A bound record has no derived path by design (mmnto-ai/totem#2700): the
  // only path it could derive is the record's own, and the tool never drafts
  // over the record. The draft goes to stdout unless --out says otherwise.
  if (first.record) return null;
  let stem: string;
  if (first.issue) {
    stem = String(first.issue.number);
  } else if (first.freeText) {
    stem = sanitizeSpecFilename(first.freeText);
    if (!stem) return null;
  } else {
    return null;
  }
  const root = deps.resolveGitRoot(cwd) ?? cwd;
  return deps.pathJoin(root, '.totem', 'specs', `${stem}.md`);
}

// ─── Main command ───────────────────────────────────────

export async function specCommand(inputs: string[], options: SpecOptions): Promise<void> {
  const {
    createEmbedder,
    LanceStore: LanceStoreImpl,
    resolveGitRoot,
    sanitizeForTerminal,
    TotemConfigError,
    TotemError,
  } = await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const {
    applyCodeBlindGuard,
    getSystemPrompt,
    loadConfig,
    loadEnv,
    requireEmbedding,
    resolveConfigPath,
    runOrchestrator,
    writeOutput,
  } = await import('../utils.js');

  validateOutputOptions(options, TotemConfigError);

  const unique = [...new Set(inputs)];
  if (unique.length > MAX_INPUTS) {
    throw new TotemConfigError(
      `Too many inputs (${unique.length}). Maximum is ${MAX_INPUTS}.`,
      `Pass at most ${MAX_INPUTS} inputs at a time.`,
      'CONFIG_INVALID',
    );
  }

  const cwd = process.cwd();

  // ── Invocation + record binding (mmnto-ai/totem#2700) ──
  // Everything here runs before the config resolves, before the store connects
  // and before any LLM call: a bad invocation costs nothing and mints nothing.
  validateSpecInvocation(unique, options, TotemConfigError);
  const boundRecord =
    options.from !== undefined
      ? loadSpecRecord(options.from, cwd, { resolveGitRoot }, TotemConfigError)
      : null;
  if (boundRecord) {
    assertOutDoesNotOverwriteRecord(options.out, boundRecord.absolutePath, cwd, TotemConfigError);
  }

  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStoreImpl(path.join(cwd, config.lanceDir), embedder, {
    absolutePathRoot: cwd,
  });
  await store.connect();

  // Connect to linked indexes (cross-totem knowledge)
  const linkedStores: LanceStore[] = [];
  if (config.linkedIndexes && config.linkedIndexes.length > 0) {
    for (const linkedPath of config.linkedIndexes) {
      try {
        const resolvedPath = path.resolve(cwd, linkedPath);
        const linkedConfigPath = resolveConfigPath(resolvedPath);
        const linkedConfig = await loadConfig(linkedConfigPath);
        const linkedEmbedding = linkedConfig.embedding;
        if (!linkedEmbedding) continue; // Linked totem has no embedder — skip
        const linkedEmbedder = createEmbedder(linkedEmbedding);
        // Derive a link name for sourceContext — basename of the resolved
        // path with leading dot stripped, matching the MCP server's
        // `deriveLinkName` convention (mmnto/totem#1295).
        const linkName = path.basename(resolvedPath).replace(/^\./, '');
        const linkedStore = new LanceStoreImpl(
          path.join(resolvedPath, linkedConfig.lanceDir),
          linkedEmbedder,
          { sourceRepo: linkName, absolutePathRoot: resolvedPath },
        );
        await linkedStore.connect();
        linkedStores.push(linkedStore);
        log.dim(TAG, `Linked index: ${linkedPath}`);
      } catch (err) {
        log.warn(
          TAG,
          `Could not connect to linked index at ${linkedPath} — skipping. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Parse and fetch all inputs sequentially
  const { createIssueAdapter } = await import('../adapters/create-issue-adapter.js');
  const adapter = await createIssueAdapter(cwd, config);
  const parsed: ParsedInput[] = [];
  const queryParts: string[] = [];

  if (boundRecord) {
    // A record is a complete, single subject: no issue fetch, no topic.
    parsed.push({ issue: null, freeText: null, record: boundRecord.record });
    queryParts.push(buildRecordSearchQuery(boundRecord.record));
    log.info(TAG, `Record: ${boundRecord.record.path} (sha256 ${boundRecord.record.sha256})`);
  }

  for (const input of unique) {
    // Match GitHub, GitLab, or any URL ending in /issues/<number> or /-/issues/<number>
    const urlMatch = input.match(/^https?:\/\/[^/]+\/.*\/(?:-\/)?issues\/(\d+)/);
    // Support owner/repo#123 format for multi-repo disambiguation
    const hashIdx = input.indexOf('#');
    const isQualified =
      hashIdx > 0 && input.includes('/') && /^\d+$/.test(input.slice(hashIdx + 1));
    const qualifiedRepo = isQualified ? input.slice(0, hashIdx) : null;
    const qualifiedNum = isQualified ? parseInt(input.slice(hashIdx + 1), 10) : null;

    const issueNumber = /^\d+$/.test(input)
      ? parseInt(input, 10)
      : urlMatch
        ? parseInt(urlMatch[1]!, 10)
        : qualifiedNum;

    if (issueNumber) {
      // If qualified with owner/repo, create a repo-specific adapter
      let fetchAdapter = adapter;
      if (qualifiedRepo) {
        const { GitHubCliAdapter } = await import('../adapters/github-cli.js');
        fetchAdapter = new GitHubCliAdapter(cwd, qualifiedRepo);
      }
      log.info(TAG, `Fetching issue #${issueNumber}...`);
      const issue = fetchAdapter.fetchIssue(issueNumber);
      log.info(TAG, `Title: ${issue.title}`);
      // `issueRef` keeps the input AS TYPED so the anchor's ref round-trips
      // `owner/repo#N` and URL forms (a fetched issue carries only a number).
      parsed.push({ issue, freeText: null, record: null, issueRef: input });
      queryParts.push(buildSearchQuery(issue));
    } else {
      log.info(TAG, `Topic: ${input}`);
      parsed.push({ issue: null, freeText: input, record: null });
      queryParts.push(input);
    }
  }

  // Retrieve context from LanceDB
  const query = expandSpecQuery(queryParts.join(' '));
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(
    query,
    store,
    linkedStores.length > 0 ? linkedStores : undefined,
  );
  const totalResults =
    context.specs.length + context.sessions.length + context.code.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code, ${context.lessons.length} lessons`,
  );

  // ── Anchored-evidence gate (mmnto-ai/totem#2700) ──
  // The anchor is what the run is grounded ON. A run with NO issue and NO
  // record is the confabulation surface: it refuses when retrieval returned
  // nothing, or when every signal-bearing hit is below the floor and no
  // floor-exempt hit exists. `--raw` is EXEMPT — it makes no LLM call and
  // mints no artifact, so it is how a weak topic's retrieval is inspected.
  // The refusal returns BEFORE `runOrchestrator`, the only writer of a run
  // artifact, so "mints nothing" holds by control flow.
  const floor = config.searchRelevanceFloor;
  const anchor = resolveGroundingAnchor(parsed);
  if (anchor.kind === GROUNDING_ANCHOR_FREE_TEXT && !options.raw) {
    const verdict = evaluateGroundingFloor(context, floor);
    if (verdict.refuse) {
      const refusal = formatGroundingRefusal(anchor.ref, verdict, floor);
      throw new TotemError('GATE_INVALID', refusal.message, refusal.recoveryHint);
    }
  }
  if (anchor.kind === GROUNDING_ANCHOR_FREE_TEXT || anchor.kind === GROUNDING_ANCHOR_MIXED) {
    log.warn(
      TAG,
      `This run is NOT gate evidence: anchor kind "${anchor.kind}" (${anchor.ref}). To make it evidence, ${ANCHOR_CURES}.`,
    );
  }

  // Resolve system prompt (allow .totem/prompts/spec.md override)
  const systemPrompt = getSystemPrompt('spec', SYSTEM_PROMPT, cwd, config.totemDir);
  // Captured HERE, before the code-blind directive is folded in: the artifact
  // records which prompt drafted the output, and the strict evidence reader
  // chooses the TEMPLATE vs DOCUMENT shape on it (a draft written under a
  // custom prompt cannot be held to the built-in template's headings).
  const promptSource =
    systemPrompt === SYSTEM_PROMPT ? PROMPT_SOURCE_BUILTIN : PROMPT_SOURCE_OVERRIDE;

  // Code-blind grounding guard (mmnto-ai/totem#2106): 0 code retrieved → surface
  // an advisory banner + fold a suppression directive into the prompt; never
  // disables (strategy#474 interim ruling).
  const codeBlindGuard = applyCodeBlindGuard(context, systemPrompt);
  if (codeBlindGuard.banner) log.warn(TAG, codeBlindGuard.banner);

  // Assemble prompt
  const prompt = await assemblePrompt(parsed, context, codeBlindGuard.systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // Grounded run artifact (mmnto-ai/totem#2100): always-on for spec — every
  // run is a future eval fixture. Per-item provenance bundle (mmnto-ai/totem#2101): every
  // retrieved item enters classed similarity-only; hash + summary are DERIVED
  // from the bundle, so the attested hash is recomputable from the artifact
  // surface alone.
  const { ADMISSION_COMPLETION_ONLY, calculateDeterministicHash, summarizeProvenance } =
    await import('@mmnto/totem');
  const { buildRetrievalGroundingBundle } = await import('../utils.js');
  const groundingBundle = buildRetrievalGroundingBundle(context);
  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    // Anchor cache + artifacts at the config dir, not the invocation cwd —
    // without this, a `totem spec` from a subdirectory writes artifacts to
    // `<cwd>/.totem/` where the `totem artifact` verbs (which resolve from
    // the config path) can never find them (Greptile P1 on #2114).
    configRoot: path.dirname(configPath),
    totalResults,
    // Admission contract (mmnto-ai/totem#2102): the same value the slice-1
    // constant recorded, now caller-supplied — spec is factually completion-only.
    backendAdmissionClass: ADMISSION_COMPLETION_ONLY,
    runMetadata: { caller: 'spec', codeBlind: codeBlindGuard.codeBlind, promptSource },
    artifact: {
      groundingHash: calculateDeterministicHash(groundingBundle),
      provenanceSummary: summarizeProvenance(groundingBundle),
      bundle: groundingBundle,
      // What the run was anchored on, and the floor it was judged against
      // (mmnto-ai/totem#2700) — published, never inferred by a reader.
      anchor,
      floor,
    },
  });
  if (content == null) return;

  // Query-before-derive instrumentation (mmnto-ai/totem#2510): spec synthesis is
  // a derive-class action. Recorded here — after synthesis actually produced
  // content, before the write forks three ways (stdout / --out / derived path) —
  // so every successful synthesis is counted exactly once.
  //
  // This row is written whether or not a query preceded it. An uncorrelated
  // derive is the observation the metric exists to make, so it must land in the
  // denominator (#2510 falsifier 1: denominator gaming).
  {
    const { recordQbdDerive } = await import('./qbd-seam.js');
    const report = await recordQbdDerive(cwd, 'spec', (msg) => {
      log.warn(TAG, msg);
    });
    if (report.note !== undefined) log.dim(TAG, report.note);
  }

  if (options.stdout) {
    writeOutput(content);
    return;
  }
  if (options.out) {
    writeOutput(content, options.out);
    const safeOut = sanitizeForTerminal(options.out).replace(/[\n\t]+/g, ' ');
    log.success(TAG, `Written to ${safeOut}`);
    return;
  }
  const defaultPath = resolveDefaultSpecPath(parsed, cwd, {
    resolveGitRoot,
    pathJoin: path.join,
  });
  if (defaultPath) {
    writeOutput(content, defaultPath);
    const safeRelativePath = sanitizeForTerminal(path.relative(cwd, defaultPath)).replace(
      /[\n\t]+/g,
      ' ',
    );
    log.success(TAG, `Spec saved to ${safeRelativePath}`);
  } else {
    log.dim(
      TAG,
      boundRecord
        ? 'No derived path for a record — use --out <path> to keep the draft.'
        : 'No default save path — writing to stdout. Use --out <path> to save.',
    );
    writeOutput(content);
  }
}
