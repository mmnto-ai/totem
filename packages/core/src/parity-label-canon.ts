/**
 * Pure derivations for the two ORIENTATION parity rows the network-read-only
 * family senses (mmnto-ai/totem#2791; the 472 charter's § 4b / § 4c requests,
 * mmnto-ai/totem-strategy:operations/472-issue-disposition-preregistration.md):
 *
 *   - `gh-issue-label-canon` — the label canon is PARSED from
 *     `mmnto-ai/totem:scripts/sync-labels.ps1` at run time (Tenet 20: derived,
 *     never mirrored) and a repo's live label list is judged against it.
 *   - `gh-project-vocabulary` — the canonical option sets are PARSED from the
 *     manifest row's own `expected-value-or-derivation` text, and a bound
 *     project's single-select fields are judged against them.
 *
 * Everything here is pure over text / parsed JSON: no I/O, no network, no
 * module-level state. The verdict LINES (status / message) are rendered by
 * `parity-detect.ts`'s network-posture dispatch, which owns the cannot-verify
 * ladder; this module returns the drift FACTS only. The semantics are aligned
 * with the strategy-local twin (`mmnto-ai/totem-strategy:tools/gh-parity-twins.cjs`,
 * rung 1 of mmnto-ai/totem-strategy#472) so the two readers agree on every
 * cohort repo: colour compares without `#` and case-insensitively, description
 * compares exactly (untrimmed), the namespace token keeps its trailing space,
 * option ORDER is information and never a fault, and a governed field that is
 * absent IS a fault (its option set is empty, which is not the canonical set).
 * One disclosed asymmetry: this module strips a leading `#` from the CANON's
 * colour too (the twin lower-cases both sides but strips `#` on the live side
 * only), so a `#`-prefixed hex in the script would still match here — identical
 * readings while the script writes bare hex, as every one of its eighteen calls
 * does today. Option NAMES are compared exactly on the live side; the canon's
 * authoring whitespace is trimmed (the prose grammar cannot avoid it, and a
 * quoted YAML member may carry it), so a padded live option name is a real
 * difference the board shows, never smoothed away.
 */

/** One canonical label as the script defines it (`gh label edit "<name>" --color "<hex>" --description "<text>"`). */
export interface CanonicalLabel {
  name: string;
  /** Lower-case hex without a leading `#` (the API's shape). */
  color: string;
  description: string;
}

/** One retirement the script performs (`Merge-Label "<old>" "<new>"`). */
export interface LabelMerge {
  from: string;
  to: string;
}

/** The parsed canon: the defined labels, the namespace tokens derived from their names, the retirements. */
export interface LabelCanon {
  labels: CanonicalLabel[];
  /** Derived from the canonical names, never hand-listed; the space is part of a colon token. */
  namespaces: string[];
  merges: LabelMerge[];
}

/** One live label as `GET /repos/{owner}/{repo}/labels` returns it (already Zod-narrowed by the caller). */
export interface LiveLabel {
  name: string;
  color?: string | null;
  description?: string | null;
}

/** A canonical label whose colour or description the live repo redefined. */
export interface LabelRedefinition {
  name: string;
  /** Present when the colour differs (expected / actual, both normalized). */
  color?: { expected: string; actual: string };
  /** True when the description differs from the canon's text. */
  description?: boolean;
}

/** A live label that occupies a canonical namespace without being in the canon. */
export interface NamespaceSquatter {
  name: string;
  namespace: string;
}

/** The § 4c drift facts for one repo. */
export interface LabelCanonDrift {
  /** Every fault class empty. */
  conforming: boolean;
  /** Canonical names absent from the live list. */
  missing: string[];
  /** Canonical names present with a different colour or description. */
  redefined: LabelRedefinition[];
  /** Live names inside a canonical namespace but outside the canon. */
  squatters: NamespaceSquatter[];
  /** Live names outside every canonical namespace — permitted, reported. */
  extra: string[];
  /** Retired names (a `Merge-Label` source) still present — reported, never a fault. */
  retiredPresent: string[];
}

/** The `gh label edit` calls that DEFINE the canon; only quoted arguments count. */
const LABEL_EDIT_RE =
  /gh\s+label\s+edit\s+"([^"]+)"\s+--color\s+"([^"]+)"\s+--description\s+"([^"]*)"/g;
/** The `Merge-Label` calls that RETIRE a name into a canonical one (positional or named parameters). */
const MERGE_LABEL_RE = /Merge-Label\s+(?:-OldName\s+)?"([^"]+)"\s+(?:-NewName\s+)?"([^"]+)"/g;

/** Plain code-unit order — a deterministic sort with no locale dependence (the twin's `byteOrder`). */
function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Normalize a colour to the API's shape: no leading `#`, lower-case. */
export function normalizeLabelColor(raw: string | null | undefined): string {
  return (raw ?? '').replace(/^#/, '').toLowerCase();
}

/**
 * Parse the label canon out of the script text. PURE. An empty `labels` array
 * means the text defined nothing — the CALLER refuses to judge against it
 * (never a conformance verdict from an empty canon).
 */
export function parseLabelCanon(scriptText: string): LabelCanon {
  const labels: CanonicalLabel[] = [];
  for (const match of scriptText.matchAll(LABEL_EDIT_RE)) {
    const name = match[1];
    const color = match[2];
    const description = match[3];
    if (name === undefined || color === undefined || description === undefined) continue;
    labels.push({ name, color: normalizeLabelColor(color), description });
  }
  const merges: LabelMerge[] = [];
  for (const match of scriptText.matchAll(MERGE_LABEL_RE)) {
    const from = match[1];
    const to = match[2];
    if (from === undefined || to === undefined) continue;
    merges.push({ from, to });
  }
  return { labels, namespaces: namespaceTokensOf(labels.map((l) => l.name)), merges };
}

/**
 * The namespace tokens the canonical names imply: the name through its first
 * `: ` (the space IS part of the token — `type:audit` does not squat on
 * `type: `), else through its first `-` (`tier-1` → `tier-`). A name with
 * neither contributes no token. Derived, so a new namespace in the script
 * becomes a sensed namespace here without a code change.
 */
export function namespaceTokensOf(names: readonly string[]): string[] {
  const tokens = new Set<string>();
  for (const name of names) {
    const colon = name.indexOf(': ');
    if (colon !== -1) {
      tokens.add(name.slice(0, colon + 2));
      continue;
    }
    const dash = name.indexOf('-');
    if (dash !== -1) tokens.add(name.slice(0, dash + 1));
  }
  return [...tokens].sort(codeUnitOrder);
}

/**
 * The § 4c predicate over one repo's live labels. PURE.
 *
 * Faults: a canonical name absent; a canonical name present with a different
 * colour or description; a live name inside a canonical namespace that is not
 * in the canon (the "never redefine a canonical namespace" half). Live names
 * outside every canonical namespace (`routine:*`, bare words) are permitted
 * additions, reported and never flagged; a retired name still present is
 * reported the same way. (`disposition:*` is canonical since the script grew
 * its six `edit` lines — mmnto-ai/totem#2792 — so a stray value there is a
 * squatter, not an addition.)
 */
export function labelCanonDrift(live: readonly LiveLabel[], canon: LabelCanon): LabelCanonDrift {
  const byName = new Map<string, LiveLabel>();
  for (const label of live) byName.set(label.name, label);

  const missing: string[] = [];
  const redefined: LabelRedefinition[] = [];
  for (const canonical of canon.labels) {
    const found = byName.get(canonical.name);
    if (found === undefined) {
      missing.push(canonical.name);
      continue;
    }
    const entry: LabelRedefinition = { name: canonical.name };
    const actualColor = normalizeLabelColor(found.color);
    if (actualColor !== canonical.color) {
      entry.color = { expected: canonical.color, actual: actualColor };
    }
    if ((found.description ?? '') !== canonical.description) {
      entry.description = true;
    }
    if (entry.color !== undefined || entry.description === true) redefined.push(entry);
  }

  const canonNames = new Set(canon.labels.map((l) => l.name));
  const retiredNames = new Set(canon.merges.map((m) => m.from));
  const squatters: NamespaceSquatter[] = [];
  const extra: string[] = [];
  const retiredPresent: string[] = [];
  for (const label of live) {
    if (canonNames.has(label.name)) continue;
    if (retiredNames.has(label.name)) {
      retiredPresent.push(label.name);
      continue;
    }
    const namespace = canon.namespaces.find((token) => label.name.startsWith(token));
    if (namespace !== undefined) squatters.push({ name: label.name, namespace });
    else extra.push(label.name);
  }

  return {
    conforming: missing.length === 0 && redefined.length === 0 && squatters.length === 0,
    missing,
    redefined,
    squatters,
    extra: extra.sort(codeUnitOrder),
    retiredPresent: retiredPresent.sort(codeUnitOrder),
  };
}

/**
 * Parse the canonical option sets out of the row's `expected-value-or-derivation`
 * text. The grammar is strict and small: clauses split on `;`, each clause
 * `Field = a | b | c`; a clause without `=` (e.g. "extra fields permitted") is
 * ignored; an empty field name or an empty option list drops the clause. The
 * Map preserves clause order. An EMPTY map means the row text yields no
 * governed field — the caller renders cannot-verify, never a hardcoded pass.
 */
export function parseExpectedOptionSets(text: string): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  for (const clause of text.split(';')) {
    const eq = clause.indexOf('=');
    if (eq === -1) continue;
    const field = clause.slice(0, eq).trim();
    const options = clause
      .slice(eq + 1)
      .split('|')
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (field.length === 0 || options.length === 0) continue;
    sets.set(field, options);
  }
  return sets;
}

/** One single-select field as the project's field config exposes it (already narrowed by the caller). */
export interface ProjectSingleSelectField {
  name: string;
  options: readonly { name: string }[];
}

/**
 * `{ Status: [...], Priority: [...] }` for every single-select field on the
 * project. Option names are kept RAW: the live side is what the board shows, and
 * the canon side is the one that carries authoring whitespace (trimmed there).
 */
export function optionSetsOfProjectFields(
  fields: readonly ProjectSingleSelectField[],
): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  for (const field of fields) {
    sets.set(
      field.name,
      field.options.map((option) => option.name),
    );
  }
  return sets;
}

/** One governed field's fault. */
export interface ProjectVocabularyFault {
  field: string;
  kind: 'field-missing' | 'option-set-differs';
  /** `option-set-differs` only: canonical options absent from the project. */
  missing: string[];
  /** `option-set-differs` only: project options outside the canonical set. */
  extra: string[];
}

/** The § 4b drift facts for one bound project. */
export interface ProjectVocabularyDrift {
  conforming: boolean;
  faults: ProjectVocabularyFault[];
  /** Governed fields whose SET equals the canon in a different order or multiplicity (a duplicated option) — information, never a fault. */
  orderDiffers: string[];
  /** Single-select fields beyond the governed ones — permitted additions (LC's `M`), reported. */
  added: string[];
}

/**
 * The § 4b predicate: every governed field (a key of `expected`) present on the
 * project with EXACTLY the canonical option set, order-insensitive. PURE.
 */
export function projectVocabularyDrift(
  actual: ReadonlyMap<string, readonly string[]>,
  expected: ReadonlyMap<string, readonly string[]>,
): ProjectVocabularyDrift {
  const faults: ProjectVocabularyFault[] = [];
  const orderDiffers: string[] = [];
  for (const [field, expectedOptions] of expected) {
    const actualOptions = actual.get(field);
    if (actualOptions === undefined) {
      faults.push({ field, kind: 'field-missing', missing: [...expectedOptions], extra: [] });
      continue;
    }
    const expectedSet = new Set(expectedOptions);
    const actualSet = new Set(actualOptions);
    const missing = expectedOptions.filter((option) => !actualSet.has(option));
    const extra = actualOptions.filter((option) => !expectedSet.has(option));
    if (missing.length > 0 || extra.length > 0) {
      faults.push({ field, kind: 'option-set-differs', missing, extra });
    } else if (
      // Equal SETS can still differ in length (a duplicated option name) or in
      // order; both are information, and neither needs a joined string to see
      // (pass 2 p2-F2 removed the NUL separator; pass 3 p3-F2 kept the length).
      actualOptions.length !== expectedOptions.length ||
      expectedOptions.some((option, index) => option !== actualOptions[index])
    ) {
      orderDiffers.push(field);
    }
  }
  const added = [...actual.keys()].filter((field) => !expected.has(field)).sort(codeUnitOrder);
  return { conforming: faults.length === 0, faults, orderDiffers, added };
}
