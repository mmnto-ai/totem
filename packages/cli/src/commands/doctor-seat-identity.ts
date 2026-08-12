/**
 * `totem doctor` — the seat-identity-binding SENSE (mmnto-ai/totem#2511).
 *
 * Tenet 9/13: this row senses, it never enforces. It carries `gateExempt: true`
 * and never emits `fail`, so no `--strict` tier can give it teeth — the
 * exemption is a property of the row (`doctor.ts` DiagnosticResult), not of the
 * tier a later change might widen.
 *
 * Three post-hoc contradictions are sensed per registered seat dir:
 *
 *   (a) `from-mismatch` — an outbox dispatch whose frontmatter `from:` names a
 *       DIFFERENT seat than the directory it sits in. The dir is the
 *       registration (the mmnto-ai/totem#2141 dirs-union invariant), so the two
 *       disagreeing is an identity contradiction on its face.
 *   (b) `writing-while-excluded` — a seat whose PARSED lifecycle marker says
 *       `suspended`/`retired` yet whose outbox carries filename-stamped writes
 *       newer than the marker's `since`: declared lifecycle contradicted by
 *       observed behaviour.
 *   (c) `env-names-excluded-seat` / `env-names-unknown-seat` — `TOTEM_SELF_AGENT`
 *       naming a non-active seat, or naming no seat directory in this repo.
 *
 * A corrupt marker degrades to `active` by core's contract
 * (`seat-lifecycle.ts` — fail open on visibility), so (b) is NEVER evaluated
 * against it: this sense refuses to build a finding on an unparsed marker.
 * The core warning (which names the marker file) is relayed instead, as its own
 * `unreadable-marker` row — a scan hole disclosed rather than a clean line that
 * hides it.
 *
 * THE HONEST LIMIT is stated in every verdict, pass included: a CONSISTENT fake
 * defeats all three arms, and that is precisely why write-time binding was
 * judged infeasible for v1 and this doctor tier is the chartered fallback.
 *
 * Core is dynamic-imported so `@mmnto/totem` stays off the CLI cold-start
 * graph, matching every other doctor check.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SeatStatus } from '@mmnto/totem';

import type { DiagnosticResult } from './doctor.js';

/** Row label, `padEnd(18)`-safe in the doctor render. */
export const SEAT_IDENTITY_CHECK_NAME = 'Seat Identity';

/**
 * Newest-N outbox files scanned per seat, by filename sort. Dispatch basenames
 * are stamp-prefixed (`YYYY-MM-DDTHHMMZ-`), so the lexical tail IS the newest
 * tail. A bound is required — cohort outboxes grow without limit and this row
 * runs on every `totem doctor` — and whenever it bites, the verdict SAYS so
 * (never a silently partial scan).
 */
export const OUTBOX_SCAN_LIMIT = 200;

/**
 * The verbatim limit clause. Exported so the test pins it against drift: the
 * whole justification for shipping a doctor-tier sense instead of write-time
 * binding rides on this sentence staying true and staying said.
 */
export const SEAT_IDENTITY_HONEST_LIMIT =
  'honest limit: a CONSISTENT fake — writing from the wrong seat dir with a matching forged `from:`, the agy shape — is NOT detectable post-hoc, which is why full write-time binding was judged infeasible for v1 and this doctor tier is the chartered fallback; this check does not discharge the 2026-06-18 seat-identity precondition.';

/**
 * Bytes read from the head of each dispatch. Sized to the mail reader's own
 * frontmatter search window (`mail.ts` MAX_HEADER_SEARCH_BYTES, 16 KiB, sized
 * ~4x the largest observed live header) so this sensor sees exactly the header
 * the mail reader sees — one wire, one reading.
 */
const HEAD_READ_BYTES = 16_384;

/** Example filenames carried per finding before the remainder is summarized. */
const MAX_EVIDENCE_FILES = 3;

/** Rendered cap for a token that came off the wire (a `from:` value, an env id). */
const MAX_TOKEN_CHARS = 120;

/** Errnos that PROVE an outbox is absent rather than unreadable. */
const OUTBOX_ABSENT_ERRNOS: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

const TOTEM_DIR = '.totem';
const ORCHESTRATION_DIR = 'orchestration';
const OUTBOX_DIR = 'outbox';

/** The frontmatter opener every ADR-098 dispatch starts with. */
const FRONTMATTER_OPENER = '---';

/**
 * Closing frontmatter delimiter — a `---` line after the opener (LF/CRLF/EOF),
 * tolerating trailing whitespace. Copied in shape from `mail.ts` deliberately:
 * a file the mail reader rejects as unparseable is not a dispatch whose `from:`
 * binds anything, so both readers must agree on where the header ends.
 */
const CLOSING_DELIMITER = /\r?\n---[ \t]*(?:\r?\n|$)/;

/** `from:` inside the delimited header only — a body line can never fabricate one. */
const FROM_FIELD = /^from:\s*(.+)$/im;

/** The stamped-dispatch basename prefix: `YYYY-MM-DDTHHMMZ-`. */
const STAMPED_BASENAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})Z-/;

/** The contradiction classes this row can report. */
export type SeatIdentityFindingClass =
  | 'from-mismatch'
  | 'writing-while-excluded'
  | 'env-names-excluded-seat'
  | 'env-names-unknown-seat'
  | 'unreadable-marker'
  | 'outbox-unreadable';

interface Finding {
  seat: string;
  cls: SeatIdentityFindingClass;
  evidence: string;
}

export interface SeatIdentitySeams {
  /**
   * Test seam — production reads `process.env`. Injected so the env arm is
   * exercisable without mutating real env state (the `resolveSelfAgents`
   * convention).
   */
  env?: Record<string, string | undefined>;
  /** Test seam — overrides {@link OUTBOX_SCAN_LIMIT} so truncation is testable. */
  outboxScanLimit?: number;
}

/** One-line, ANSI-stripped, length-capped rendering of an off-the-wire token. */
function capToken(value: string): string {
  return value.length > MAX_TOKEN_CHARS ? `${value.slice(0, MAX_TOKEN_CHARS)}…` : value;
}

/** Message text for an unknown throwable (checkEstate's shape). */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Errno of a throwable, when it carries one. */
function errnoOf(err: unknown): string | undefined {
  return err !== null && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

/**
 * Strip a single pair of matching surrounding quotes. `composeDispatch` leaves
 * a valid kebab agent-id unquoted (`yamlScalar` quotes only when the raw value
 * would mis-parse), but hand-authored dispatches quote freely, and an
 * unquote-blind compare would read every quoted `from:` as a mismatch.
 */
function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * The `from:` value declared in a dispatch's frontmatter, or `null` when the
 * file is not header-shaped or declares none. A missing `from:` is NOT a
 * finding: the mail reader falls back to the outbox dir name, which is the
 * binding this row is checking — absence agrees with the dir by construction.
 */
function frontmatterFrom(content: string): string | null {
  if (!content.startsWith(FRONTMATTER_OPENER)) return null;
  const window = content.slice(FRONTMATTER_OPENER.length);
  const close = CLOSING_DELIMITER.exec(window);
  if (close === null) return null;
  const match = FROM_FIELD.exec(window.slice(0, close.index));
  return match === null ? null : unquoteScalar(match[1]);
}

/**
 * The UTC instant encoded in a stamped basename, or `null` when the name
 * carries no stamp. Minute granularity is the wire's own resolution
 * (`compactStamp`), so a write in the SAME minute as a transition compares as
 * not-newer — the conservative direction for a sensor that must not invent
 * contradictions.
 */
function stampedInstantMs(basename: string): number | null {
  const m = STAMPED_BASENAME.exec(basename);
  if (m === null) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** A bounded outbox listing plus the total, so truncation is always disclosable. */
interface OutboxListing {
  /** Newest-N `.md` basenames, ascending. */
  files: string[];
  /** Every `.md` basename present, before the bound. */
  total: number;
  /** Set only when the directory exists but could not be read. */
  readFailure?: string;
}

function listOutbox(outboxDir: string, limit: number): OutboxListing {
  let entries: fs.Dirent[];
  // totem-context: intentional degradation — the catch IS the answer: ENOENT/ENOTDIR PROVE a seat has never written (the steady state of a fresh seat dir, silent by contract), and every other errno is a scan hole this row DISCLOSES as an outbox-unreadable finding rather than reporting a clean seat it never looked inside.
  try {
    entries = fs.readdirSync(outboxDir, { withFileTypes: true });
    // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    const code = errnoOf(err);
    if (code !== undefined && OUTBOX_ABSENT_ERRNOS.has(code)) {
      return { files: [], total: 0 };
    }
    return { files: [], total: 0, readFailure: messageOf(err) };
  }

  const all = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  return { files: all.length > limit ? all.slice(all.length - limit) : all, total: all.length };
}

/** Read at most `HEAD_READ_BYTES` from the head of a file. */
function readHead(filePath: string): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_READ_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

/** `N file(s): a, b, c (+M more)` — every count stated, nothing silently dropped. */
function evidenceList(items: string[]): string {
  const shown = items.slice(0, MAX_EVIDENCE_FILES);
  const more = items.length - shown.length;
  const listed = more > 0 ? `${shown.join(', ')} (+${more} more)` : shown.join(', ');
  return `${items.length} file(s): ${listed}`;
}

/**
 * Sense seat-identity binding across every registered seat dir. Report-only:
 * `gateExempt: true` on every arm, `fail` on none, and an unexpected throw
 * lands as a warn row rather than taking `totem doctor` down (Tenet 13).
 */
export async function checkSeatIdentity(
  cwd: string,
  seams: SeatIdentitySeams = {},
): Promise<DiagnosticResult> {
  const name = SEAT_IDENTITY_CHECK_NAME;
  const limit = seams.outboxScanLimit ?? OUTBOX_SCAN_LIMIT;
  const env = seams.env ?? process.env;

  // Sanitize-at-interpolation: `from:` values, env values, and errno text are
  // all off-process bytes, and this row's message reaches the terminal
  // unsanitized downstream. `sanitizeForTerminal` is core-owned and must not be
  // imported statically here, so it is captured after the dynamic import; until
  // then the fallback still FLATTENS (the line-forging vector) and only lacks
  // the ANSI strip — a pre-import failure carries loader text, not wire bytes.
  let sanitize: (text: string) => string = (text) => text;
  const render = (text: string): string =>
    sanitize(text)
      .replace(/[\t\n\r]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();

  // totem-context: a scan failure is reported as a warn row — the seat-identity sensor must never take `totem doctor` down with it (report-only, Tenet 13; the checkEstate precedent).
  try {
    const { deriveSeatStatuses, resolveTotemRepoRootSync, sanitizeForTerminal } =
      await import('@mmnto/totem');
    sanitize = sanitizeForTerminal;

    // The shared walk-start-is-not-the-root contract (`pollMail` / `eclGc` /
    // `eclCompact`, mmnto-ai/totem#2312): a doctor run from a subdirectory must
    // still resolve the real orchestration tree, or this row renders a
    // false-clean "seats sensed: 0".
    const repoRoot = resolveTotemRepoRootSync(undefined, cwd);
    const statuses: SeatStatus[] = deriveSeatStatuses(repoRoot);
    const bySeat = new Map<string, SeatStatus>(statuses.map((status) => [status.seat, status]));

    const findings: Finding[] = [];
    const truncations: string[] = [];

    for (const status of statuses) {
      // A degraded marker read is a HOLE in this sense, not a clean seat: core
      // fails open to `active`, so arm (b) cannot be evaluated here at all. Say
      // so, with core's own warning (it names the marker file — the one-step
      // recovery target).
      if (status.warning !== undefined) {
        findings.push({
          seat: status.seat,
          cls: 'unreadable-marker',
          evidence: render(status.warning),
        });
      }

      const outboxDir = path.join(repoRoot, TOTEM_DIR, ORCHESTRATION_DIR, status.seat, OUTBOX_DIR);
      const listing = listOutbox(outboxDir, limit);
      if (listing.readFailure !== undefined) {
        findings.push({
          seat: status.seat,
          cls: 'outbox-unreadable',
          evidence: render(listing.readFailure),
        });
        continue;
      }
      if (listing.total > listing.files.length) {
        truncations.push(
          `${status.seat}: newest ${listing.files.length} of ${listing.total} outbox file(s) scanned`,
        );
      }

      // Arm (b) arms ONLY on a successfully PARSED exclusion marker. A corrupt
      // marker reads as `default-active` and is deliberately skipped here: this
      // sense never builds a finding on an unparsed marker.
      const excluded =
        status.source === 'marker' && (status.state === 'suspended' || status.state === 'retired');
      const sinceMs =
        excluded && status.since !== undefined ? Date.parse(status.since) : Number.NaN;

      const mismatched: string[] = [];
      const postSince: string[] = [];
      const unreadable: string[] = [];

      for (const file of listing.files) {
        if (!Number.isNaN(sinceMs)) {
          const stamped = stampedInstantMs(file);
          if (stamped !== null && stamped > sinceMs) {
            postSince.push(render(file));
          }
        }

        let head: string;
        // totem-context: intentional degradation — a per-file read failure (mid-rename race, EACCES) is collected into an outbox-unreadable finding for this seat and the scan continues; dropping the file silently would let an unreadable dispatch read as a checked one.
        try {
          head = readHead(path.join(outboxDir, file));
          // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
        } catch (err) {
          unreadable.push(`${render(file)} (${render(messageOf(err))})`);
          continue;
        }

        const declared = frontmatterFrom(head);
        if (declared !== null && declared !== status.seat) {
          mismatched.push(`${render(file)} declares from: ${capToken(render(declared))}`);
        }
      }

      if (mismatched.length > 0) {
        findings.push({
          seat: status.seat,
          cls: 'from-mismatch',
          evidence: evidenceList(mismatched),
        });
      }
      if (postSince.length > 0) {
        findings.push({
          seat: status.seat,
          cls: 'writing-while-excluded',
          evidence: `${status.state} since ${render(status.since ?? 'unknown')} — ${evidenceList(postSince)} stamped after it`,
        });
      }
      if (unreadable.length > 0) {
        findings.push({
          seat: status.seat,
          cls: 'outbox-unreadable',
          evidence: evidenceList(unreadable),
        });
      }
    }

    // Arm (c). Same comma-split as `resolveSelfAgents`' env layer, and the same
    // parsed-marker-only rule as arm (b): a corrupt marker reads active and
    // earns no env finding.
    const envRaw = env['TOTEM_SELF_AGENT'];
    if (typeof envRaw === 'string' && envRaw.trim().length > 0) {
      for (const named of envRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)) {
        const status = bySeat.get(named);
        if (status === undefined) {
          findings.push({
            seat: capToken(render(named)),
            cls: 'env-names-unknown-seat',
            evidence: `TOTEM_SELF_AGENT names a seat with no directory under ${TOTEM_DIR}/${ORCHESTRATION_DIR}/ in this repo`,
          });
        } else if (status.source === 'marker' && status.state !== 'active') {
          findings.push({
            seat: status.seat,
            cls: 'env-names-excluded-seat',
            evidence: `TOTEM_SELF_AGENT names a ${status.state} seat (since ${render(status.since ?? 'unknown')})`,
          });
        }
      }
    }

    const parts = [`seats sensed: ${statuses.length}`];
    parts.push(
      findings.length === 0
        ? 'no identity contradictions sensed'
        : `${findings.length} finding(s): ${findings
            .map((f) => `${f.seat} [${f.cls}] ${f.evidence}`)
            .join(' | ')}`,
    );
    if (truncations.length > 0) {
      parts.push(`scan bounded at ${limit}/outbox — ${truncations.join('; ')}`);
    }
    parts.push(SEAT_IDENTITY_HONEST_LIMIT);

    return {
      name,
      status: findings.length === 0 ? 'pass' : 'warn',
      message: parts.join(' · '),
      ...(findings.length > 0
        ? {
            remediation:
              'Inspect the named files and `totem seat list` — this row senses only and never gates.',
          }
        : {}),
      gateExempt: true,
    };
    // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    return {
      name,
      status: 'warn',
      message: `Seat-identity scan failed: ${render(messageOf(err))} · ${SEAT_IDENTITY_HONEST_LIMIT}`,
      remediation: 'Check .totem/orchestration/ readability, then re-run `totem doctor`.',
      gateExempt: true,
    };
  }
}
