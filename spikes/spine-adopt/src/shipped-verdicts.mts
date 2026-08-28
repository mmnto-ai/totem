// ─── The reference harness: shipped-runtime verdicts through the REAL dispatchers ──
//
// Spec § Scope: "a TS reference harness producing shipped-runtime verdicts through
// the REAL dispatchers (`apply-rules-bounded` / `applyAstRulesToAdditions` after
// `compileRuleRecord`)".
//
// § Differential units binds the shaping:
//   - each fixture block is ONE whole-file source served via `readStrategy`;
//   - every line is an addition with `precedingLine = lines[i-1]`;
//   - a VERDICT is the violation MULTISET keyed `(ruleId, lineNumber)` for a
//     `(rule, fixture)` pair — never a count of fixture lines;
//   - `matchCount` is the SHIPPED violation count for that pair (engine-asymmetric:
//     regex at most one per added line, ast-grep one per match);
//   - `fired` derives from violations, never from trigger events.
//
// § Oracle arms binds the dispatchers, and § Invariants binds the four floors
// asserted at the bottom of this file.
//
// SPIKE SIMPLIFICATION, disclosed per § Differential units: every addition is fed
// UNCLASSIFIED (`astContext` absent ⇒ treated as `code`), a configuration shipped
// lint never runs. `astContext: 'comment'` would gate emission after triggering.
//
// Run: node --experimental-strip-types src/shipped-verdicts.mts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { astQueryOf, compileSpecimen, loadCore, type CompiledSpecimen } from './lib/records.mts';
import { ARTIFACTS_DIR, Checks, FACTS_DIR, REPO_ROOT, writeArtifact } from './lib/spike-env.mts';
import { PINNED_NOW, PINNED_RULE_ID, SPECIMENS } from './lib/specimens.mts';

/** § Oracle arms: "an explicit generous timeoutMs" — the 250 ms default converts jitter into silent verdicts. */
const TIMEOUT_MS = 5000;

interface CapturedEvent {
  kind: string;
  ruleId: string;
  file: string | null;
  line: number | null;
  justification: string | null;
}

interface ViolationKey {
  ruleId: string;
  lineNumber: number;
}

interface ArmResult {
  oracle: 'arm1-pin' | 'arm2-lint';
  dispatcher: string;
  violations: ViolationKey[];
  violationLines: string[];
  events: CapturedEvent[];
  timeoutOutcomes: unknown[] | null;
}

interface VerdictRow {
  ruleId: string;
  fixtureId: string;
  arm: 'shipped';
  fired: boolean;
  matchCount: number;
  events: CapturedEvent[];
  /* spike-local detail beside the § Data model deltas shape */
  specimen: string;
  engine: string;
  file: string;
  fileTextState: 'null' | 'empty' | 'content';
  lineCount: number;
  arms: ArmResult[];
  armsCoincide: boolean;
  armsAgree: boolean;
}

function ctx(): any {
  return { logger: { warn: () => {} }, state: { hasWarnedShieldContext: false } };
}

/** § Differential units: every line an addition, `precedingLine = lines[i-1]`. */
function additionsOf(file: string, lines: readonly string[]): any[] {
  return lines.map((line, i) => ({
    file,
    line,
    lineNumber: i + 1,
    precedingLine: i > 0 ? lines[i - 1]! : null,
  }));
}

function collector(): { events: CapturedEvent[]; onRuleEvent: (...a: any[]) => void } {
  const events: CapturedEvent[] = [];
  return {
    events,
    onRuleEvent: (kind: string, ruleId: string, details?: any) =>
      events.push({
        kind,
        ruleId,
        file: details?.file ?? null,
        line: typeof details?.line === 'number' ? details.line : null,
        justification: details?.justification ?? null,
      }),
  };
}

/** The verdict: the violation MULTISET keyed `(ruleId, lineNumber)`, order-normalised. */
function multiset(violations: any[]): ViolationKey[] {
  return violations
    .map((v) => ({ ruleId: v.rule.lessonHash as string, lineNumber: v.lineNumber as number }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.lineNumber - b.lineNumber);
}

function eventKey(e: CapturedEvent): string {
  return `${e.kind}|${e.ruleId}|${e.file}|${e.line}|${e.justification}`;
}

function sameEvents(a: CapturedEvent[], b: CapturedEvent[]): boolean {
  const ka = a.map(eventKey).sort();
  const kb = b.map(eventKey).sort();
  return JSON.stringify(ka) === JSON.stringify(kb);
}

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCore();
  const evaluator = new core.RegexEvaluator({ timeoutMs: TIMEOUT_MS, softWarningMs: 1000 });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-spike-'));

  try {
    const compiled = new Map<string, CompiledSpecimen>();
    for (const s of SPECIMENS) compiled.set(s.id, compileSpecimen(core, s));

    // ── the differential sweep, over every fact bundle facts.mts produced ──
    const factFiles = fs
      .readdirSync(FACTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    checks.check(
      'fact bundles are present (run `src/facts.mts` first)',
      factFiles.length > 0,
      `${factFiles.length} bundles`,
    );

    const rows: VerdictRow[] = [];

    for (const fname of factFiles) {
      const rec = JSON.parse(fs.readFileSync(path.join(FACTS_DIR, fname), 'utf-8'));
      // The producer of FACTS_DIR (`src/facts.mts`) and this consumer are not
      // verified to agree on the specimen set. A stale bundle left by an earlier
      // run, or a renamed specimen, would make `compiled.get` return undefined
      // and blow up several lines later with a `TypeError` naming neither the
      // file nor the specimen. Assert the CONTRACT, not the type.
      const cs = compiled.get(rec.specimen);
      if (!cs) {
        throw new Error(
          `${fname} names specimen '${rec.specimen}', which is not in SPECIMENS — stale fact bundle? Re-run src/facts.mts.`,
        );
      }
      const bundle = rec.factBundle as { file: string; fileText: string | null; lines: string[] };
      const additions = additionsOf(bundle.file, bundle.lines);

      // ONE whole-file source, served through the dispatcher's read seam. The
      // async and sync seams get the SAME bytes, so an arm divergence can never be
      // an artefact of two different files.
      const readStrategy = async (p: string) => (p === bundle.file ? bundle.fileText : null);
      const readFileTextSync = (p: string) => (p === bundle.file ? bundle.fileText : null);

      const arms: ArmResult[] = [];
      if (cs.engine === 'regex') {
        const a1 = collector();
        const v1 = core.applyRulesToAdditions(
          ctx(),
          [cs.rule],
          additions,
          a1.onRuleEvent,
          workRoot,
          readFileTextSync,
        );
        arms.push({
          oracle: 'arm1-pin',
          dispatcher: 'applyRulesToAdditions',
          violations: multiset(v1),
          violationLines: v1.map((v: any) => v.line),
          events: a1.events,
          timeoutOutcomes: null,
        });

        const a2 = collector();
        const r2 = await core.applyRulesToAdditionsBounded(
          ctx(),
          [cs.rule],
          additions,
          { evaluator, timeoutMode: 'strict', repoRoot: workRoot, readStrategy },
          a2.onRuleEvent,
        );
        arms.push({
          oracle: 'arm2-lint',
          dispatcher: 'applyRulesToAdditionsBounded',
          violations: multiset(r2.violations),
          violationLines: r2.violations.map((v: any) => v.line),
          events: a2.events,
          timeoutOutcomes: r2.timeoutOutcomes,
        });
        checks.eq(
          `${rec.fixtureId} — bounded arm recorded NO timeout outcome (timeoutMs=${TIMEOUT_MS})`,
          r2.timeoutOutcomes.length,
          0,
        );
      } else {
        // ONE shipped ast dispatcher exists. It is BOTH the oracle that produced
        // the pins at record-runtime.test.ts:397-433 and the path `totem lint`
        // runs, so the two arms COINCIDE here rather than agreeing. Recorded as
        // such — a single call reported twice would be a manufactured agreement.
        const a = collector();
        const warnings: string[] = [];
        const v = await core.applyAstRulesToAdditions(
          ctx(),
          [cs.rule],
          additions,
          workRoot,
          a.onRuleEvent,
          (m: string) => warnings.push(m),
          readStrategy,
        );
        arms.push({
          oracle: 'arm1-pin',
          dispatcher: 'applyAstRulesToAdditions',
          violations: multiset(v),
          violationLines: v.map((x: any) => x.line),
          events: a.events,
          timeoutOutcomes: null,
        });
        checks.check(
          `${rec.fixtureId} — ast dispatcher emitted no warnings`,
          warnings.length === 0,
          warnings.join('; ') || 'clean',
        );

        // The engine filter, MEASURED rather than assumed: the sync regex
        // dispatcher is not a second ast arm — it drops ast rules by design.
        const probe = collector();
        const filtered = core.applyRulesToAdditions(
          ctx(),
          [cs.rule],
          additions,
          probe.onRuleEvent,
          workRoot,
        );
        checks.check(
          `${rec.fixtureId} — applyRulesToAdditions filters this ast rule out entirely (not a second ast arm)`,
          filtered.length === 0 && probe.events.length === 0,
          `${filtered.length} violations, ${probe.events.length} events`,
        );
      }

      const armsCoincide = arms.length === 1;
      const armsAgree =
        armsCoincide ||
        (JSON.stringify(arms[0]!.violations) === JSON.stringify(arms[1]!.violations) &&
          sameEvents(arms[0]!.events, arms[1]!.events));
      if (!armsCoincide) {
        checks.check(
          `${rec.fixtureId} — the two dispatcher arms agree (violations AND event streams)`,
          armsAgree,
          `arm1=${JSON.stringify(arms[0]!.violations)} events=${arms[0]!.events.map((e) => e.kind).join(',') || '-'} | arm2=${JSON.stringify(arms[1]!.violations)} events=${arms[1]!.events.map((e) => e.kind).join(',') || '-'}`,
        );
      }

      // `fired` derives from VIOLATIONS, never from trigger events (§ Differential units).
      const primary = arms[0]!;
      rows.push({
        ruleId: cs.rule.lessonHash,
        fixtureId: rec.fixtureId,
        arm: 'shipped',
        fired: primary.violations.length > 0,
        matchCount: primary.violations.length,
        events: primary.events,
        specimen: rec.specimen,
        engine: cs.engine,
        file: bundle.file,
        fileTextState:
          bundle.fileText === null ? 'null' : bundle.fileText === '' ? 'empty' : 'content',
        lineCount: bundle.lines.length,
        arms,
        armsCoincide,
        armsAgree,
      });
    }

    // A verdict is never a line count — asserted, not just written in a comment.
    const anyDivergence = rows.some((r) => r.matchCount !== r.lineCount);
    checks.check(
      'a VERDICT is the violation multiset, NOT a count of fixture lines (at least one row proves they differ)',
      anyDivergence,
      `${rows.filter((r) => r.matchCount !== r.lineCount).length} of ${rows.length} rows have matchCount !== lineCount`,
    );

    // The engine asymmetry § Differential units names, measured on real rows.
    const regexRows = rows.filter((r) => r.engine === 'regex');
    checks.check(
      'ENGINE ASYMMETRY — the regex path emits AT MOST ONE violation per added line (worker.ts:53-62)',
      regexRows.every((r) => {
        const perLine = new Map<number, number>();
        for (const v of r.arms[0]!.violations)
          perLine.set(v.lineNumber, (perLine.get(v.lineNumber) ?? 0) + 1);
        return [...perLine.values()].every((n) => n <= 1);
      }),
      `${regexRows.length} regex rows`,
    );
    const astMultiHit = rows.find((r) => r.engine === 'ast-grep' && r.matchCount > 1);
    checks.check(
      'ENGINE ASYMMETRY — the ast-grep path emits ONE violation PER MATCH (rule-engine.ts:1074)',
      Boolean(astMultiHit),
      astMultiHit
        ? `${astMultiHit.fixtureId}: ${astMultiHit.matchCount} violations`
        : 'no multi-match ast row found',
    );

    // ── § Invariants floor (i): specimens d/e reproduce the ALREADY-PINNED verdicts ──
    //
    // Replayed as the pinned tests write them — same rule ids, same additions,
    // same dispatchers, and for the file arm the same REAL temp worktree (no
    // injected reader), because that is what `record-runtime.test.ts:336-395` does.
    const pins: { pin: string; ok: boolean; detail: string }[] = [];
    function pin(name: string, ok: boolean, detail: string): void {
      pins.push({ pin: name, ok, detail });
      checks.check(`PIN — ${name}`, ok, detail);
    }

    const dLine = compiled.get('d-line')!.rule;
    const add = (file: string, line: string, lineNumber = 1) => ({
      file,
      line,
      lineNumber,
      precedingLine: null,
    });

    const pinBad = core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('scripts/x.sh', 'git log --oneline')],
    );
    pin(
      'd-line (test:289-304) FIRES on its own `bad` example, lessonHash === the pinned RULE_ID',
      pinBad.length === 1 && pinBad[0].rule.lessonHash === PINNED_RULE_ID,
      `${pinBad.length} violation(s), hash=${pinBad[0]?.rule.lessonHash}`,
    );
    const pinGood = core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('scripts/x.sh', 'LC_ALL=C git log --oneline')],
    );
    pin(
      'd-line (test:298-303) stays SILENT on its own `good` example',
      pinGood.length === 0,
      `${pinGood.length} violation(s)`,
    );

    const evGood: string[] = [];
    core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('scripts/x.sh', 'LC_ALL=C git log --oneline')],
      (k: string) => evGood.push(k),
    );
    const evBad: string[] = [];
    core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('scripts/x.sh', 'git log --oneline')],
      (k: string) => evBad.push(k),
    );
    pin(
      'd-line (test:306-324) required-context-present emits NO event; firing emits exactly [trigger]',
      JSON.stringify(evGood) === '[]' && JSON.stringify(evBad) === '["trigger"]',
      `good=${JSON.stringify(evGood)} bad=${JSON.stringify(evBad)}`,
    );
    const pinTs = core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('scripts/x.ts', 'git log --oneline')],
    );
    const pinCjs = core.applyRulesToAdditions(
      ctx(),
      [dLine],
      [add('deep/nest/x.cjs', 'git log --oneline')],
    );
    pin(
      'd-line (test:326-333) record dialect at dispatch — `**/*.sh`/`**/*.cjs` match, `.ts` does not',
      pinTs.length === 0 && pinCjs.length === 1,
      `.ts=${pinTs.length} .cjs=${pinCjs.length}`,
    );

    // d-file: the pinned block builds a REAL worktree and passes NO reader.
    const dFile = compiled.get('d-file')!.rule;
    const pinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-p310-'));
    // try/finally: any throw between mkdtemp and rmSync would otherwise ORPHAN
    // the temp worktree, and a failing run is exactly when that happens.
    try {
      fs.mkdirSync(path.join(pinDir, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(pinDir, 'scripts', 'pinned.sh'),
        ['export LC_ALL=C', 'git log --oneline'].join('\n'),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(pinDir, 'scripts', 'unpinned.sh'),
        ['git log --oneline'].join('\n'),
        'utf-8',
      );

      const pinSatisfied = core.applyRulesToAdditions(
        ctx(),
        [dFile],
        [add('scripts/pinned.sh', 'git log --oneline', 2)],
        undefined,
        pinDir,
      );
      pin(
        'd-file (test:363-372) silent when the requirement is satisfied ELSEWHERE in the file',
        pinSatisfied.length === 0,
        `${pinSatisfied.length} violation(s)`,
      );
      const pinUnsatisfied = core.applyRulesToAdditions(
        ctx(),
        [dFile],
        [add('scripts/unpinned.sh', 'git log --oneline')],
        undefined,
        pinDir,
      );
      pin(
        'd-file (test:374-383) FIRES when the file never satisfies the requirement',
        pinUnsatisfied.length === 1,
        `${pinUnsatisfied.length} violation(s)`,
      );
      const pinAbsent = core.applyRulesToAdditions(
        ctx(),
        [dFile],
        [add('scripts/absent.sh', 'git log --oneline')],
        undefined,
        pinDir,
      );
      pin(
        'd-file (test:385-394) FIRES when the file cannot be read at all (fails toward flagging)',
        pinAbsent.length === 1,
        `${pinAbsent.length} violation(s)`,
      );
    } finally {
      fs.rmSync(pinDir, { recursive: true, force: true });
    }

    // e: the ast pins, replayed with the pinned `run()` helper's exact shape.
    const eRule = compiled.get('e')!.rule;
    const eExamples = compiled.get('e')!.record.examples as { bad: string; good: string }[];
    const runE = async (file: string, source: string) =>
      core.applyAstRulesToAdditions(
        ctx(),
        [eRule],
        [add(file, source)],
        os.tmpdir(),
        undefined,
        undefined,
        async () => source,
      );
    const eBad = await runE('packages/core/src/a.ts', eExamples[0]!.bad);
    pin(
      'e (test:415-420) FIRES on its own `bad` example; hash === RULE_ID; message names the ban',
      eBad.length === 1 &&
        eBad[0].rule.lessonHash === PINNED_RULE_ID &&
        String(eBad[0].rule.message).includes('fail-open catch is banned'),
      `${eBad.length} violation(s), hash=${eBad[0]?.rule.lessonHash}`,
    );
    const eGood = await runE('packages/core/src/a.ts', eExamples[0]!.good);
    pin(
      'e (test:422-424) stays SILENT on its own `good` example',
      eGood.length === 0,
      `${eGood.length}`,
    );
    const eExcluded = await runE('packages/core/src/a.test.ts', eExamples[0]!.bad);
    pin(
      'e (test:426-428) honours `excludeGlobs` at dispatch — the same bad source in a test file is out of scope',
      eExcluded.length === 0,
      `${eExcluded.length}`,
    );
    const eOutside = await runE('scripts/a.ts', eExamples[0]!.bad);
    pin(
      'e (test:430-432) honours the positive glob — the same bad source outside `packages/` is out of scope',
      eOutside.length === 0,
      `${eOutside.length}`,
    );

    // ── § Invariants floor (iii): requires-satisfied ⇒ no violation AND no suppress event ──
    //
    // On BOTH regex arms, and contrasted against a real `// totem-ignore`
    // suppression so "silence" and "suppression" are shown to be distinguishable
    // at the dispatcher seam rather than asserted to be.
    const satisfiedAdds = additionsOf('scripts/x.sh', ['LC_ALL=C git log --oneline']);
    const s1 = collector();
    const sv1 = core.applyRulesToAdditions(ctx(), [dLine], satisfiedAdds, s1.onRuleEvent, workRoot);
    const s2 = collector();
    const sr2 = await core.applyRulesToAdditionsBounded(
      ctx(),
      [dLine],
      satisfiedAdds,
      { evaluator, timeoutMode: 'strict', repoRoot: workRoot },
      s2.onRuleEvent,
    );
    checks.check(
      'REQUIRES-SATISFIED ⇒ no violation AND no event of ANY kind, on the sync arm',
      sv1.length === 0 && s1.events.length === 0,
      `${sv1.length} violations, events=${JSON.stringify(s1.events.map((e) => e.kind))}`,
    );
    checks.check(
      'REQUIRES-SATISFIED ⇒ no violation AND no event of ANY kind, on the bounded arm',
      sr2.violations.length === 0 && s2.events.length === 0,
      `${sr2.violations.length} violations, events=${JSON.stringify(s2.events.map((e) => e.kind))}`,
    );

    // The contrast: a PLAIN `// totem-ignore` (never `totem-context:` — the
    // fail-soft attestation machinery at rule-engine.ts:498-510 injects an extra
    // engine Violation, which would contaminate the multiset).
    const ignoredAdds = additionsOf('scripts/x.sh', ['git log --oneline // totem-ignore']);
    const i1 = collector();
    const iv1 = core.applyRulesToAdditions(ctx(), [dLine], ignoredAdds, i1.onRuleEvent, workRoot);
    checks.check(
      'CONTRAST — a plain `// totem-ignore` also yields no violation, but DOES emit a `suppress` event',
      iv1.length === 0 && i1.events.some((e) => e.kind === 'suppress'),
      `${iv1.length} violations, events=${JSON.stringify(i1.events.map((e) => e.kind))}`,
    );
    checks.check(
      'CONTRAST — requires-silence and totem-ignore-suppression are therefore DISTINGUISHABLE at the seam',
      s1.events.length === 0 && i1.events.some((e) => e.kind === 'suppress'),
      `requires-satisfied events=${JSON.stringify(s1.events.map((e) => e.kind))} vs ignore events=${JSON.stringify(i1.events.map((e) => e.kind))}`,
    );

    // The same contrast on the ast arm, using specimen (e) — the spec's synthetic
    // suppression arm for the exception specimen.
    const eIgnoreSource = `${eExamples[0]!.bad} // totem-ignore`;
    const ei = collector();
    const eIgnored = await core.applyAstRulesToAdditions(
      ctx(),
      [eRule],
      additionsOf('packages/core/src/a.ts', [eIgnoreSource]),
      os.tmpdir(),
      ei.onRuleEvent,
      undefined,
      async () => eIgnoreSource,
    );
    checks.check(
      'CONTRAST (ast arm) — plain `// totem-ignore` on the matched construct suppresses and emits `suppress`',
      eIgnored.length === 0 && ei.events.some((e) => e.kind === 'suppress'),
      `${eIgnored.length} violations, events=${JSON.stringify(ei.events.map((e) => e.kind))}`,
    );

    // ── § Invariants floor (iv): the null / empty split ──
    //
    // HAND-CONSTRUCTED per the spec: the pinned requirement `LC_ALL=C` does not
    // match `''`, so it cannot expose the split on its own. Two extra records are
    // lowered whose `requires.pattern` DOES match the empty string (`a*`, `^$`).
    // Everything else — target, scope, severity — is held fixed, so the only
    // moving part is whether the requirement matches `''`.
    const dFileYaml = compiled.get('d-file')!.yamlText;
    function withRequires(pattern: string): any {
      // A FUNCTION replacer, never a string one: `$'` / `$&` / `` $` `` are
      // substitution directives in a string replacement, so a requirement like
      // `^$` would silently splice the rest of the document in. (Measured: it did.)
      const yaml = dFileYaml.replace(/^  pattern: 'LC_ALL=C'$/m, () => `  pattern: '${pattern}'`);
      if (yaml === dFileYaml)
        throw new Error(`requires-pattern substitution missed for ${pattern}`);
      const outcome = core.compileRuleRecord(
        core.parseRuleRecord(
          yaml,
          `spikes/spine-adopt/records/CONTROL-requires-${pattern}.rule.yaml`,
        ),
        { ruleId: PINNED_RULE_ID, now: PINNED_NOW },
      );
      if (outcome.kind !== 'compiled')
        throw new Error(`control requires:'${pattern}' did not lower: ${outcome.reason}`);
      return outcome.rule;
    }

    const splitAdds = additionsOf('scripts/probe.sh', ['git log --oneline']);
    async function verdictFor(
      rule: any,
      fileText: string | null,
    ): Promise<{ sync: number; bounded: number }> {
      const read = (p: string) => (p === 'scripts/probe.sh' ? fileText : null);
      const sync = core.applyRulesToAdditions(ctx(), [rule], splitAdds, undefined, workRoot, read);
      const bounded = await core.applyRulesToAdditionsBounded(
        ctx(),
        [rule],
        splitAdds,
        {
          evaluator,
          timeoutMode: 'strict',
          repoRoot: workRoot,
          readStrategy: async (p: string) => read(p),
        },
        undefined,
      );
      return { sync: sync.length, bounded: bounded.violations.length };
    }

    const splitMatrix: Record<string, Record<string, { sync: number; bounded: number }>> = {};
    const controls: { label: string; rule: any; matchesEmpty: boolean }[] = [
      { label: "LC_ALL=C (pinned — does NOT match '')", rule: dFile, matchesEmpty: false },
      { label: "a* (matches '')", rule: withRequires('a*'), matchesEmpty: true },
      { label: "^$ (matches '')", rule: withRequires('^$'), matchesEmpty: true },
    ];
    for (const c of controls) {
      checks.eq(
        `CONTROL requires:'${c.label}' — the JS matcher's own verdict on the empty string`,
        new RegExp(c.rule.requires.pattern).test(''),
        c.matchesEmpty,
      );
      splitMatrix[c.label] = {
        null: await verdictFor(c.rule, null),
        empty: await verdictFor(c.rule, ''),
        content: await verdictFor(c.rule, 'export LC_ALL=C\ngit log --oneline'),
      };
    }

    for (const c of controls) {
      const m = splitMatrix[c.label]!;
      checks.check(
        `NULL ARM — requires:'${c.label}' with fileText:null FIRES on both arms (fail toward flagging)`,
        m.null!.sync === 1 && m.null!.bounded === 1,
        `sync=${m.null!.sync} bounded=${m.null!.bounded}`,
      );
      checks.check(
        `EMPTY ARM — requires:'${c.label}' with fileText:'' ${c.matchesEmpty ? 'is SATISFIED (silent)' : 'is UNMET (fires)'} on both arms`,
        c.matchesEmpty
          ? m.empty!.sync === 0 && m.empty!.bounded === 0
          : m.empty!.sync === 1 && m.empty!.bounded === 1,
        `sync=${m.empty!.sync} bounded=${m.empty!.bounded}`,
      );
    }
    checks.check(
      "M3 SPLIT — null and '' DIVERGE on a ''-matching requirement, and AGREE on one that does not",
      splitMatrix["a* (matches '')"]!.null!.sync !== splitMatrix["a* (matches '')"]!.empty!.sync &&
        splitMatrix["^$ (matches '')"]!.null!.sync !==
          splitMatrix["^$ (matches '')"]!.empty!.sync &&
        splitMatrix["LC_ALL=C (pinned — does NOT match '')"]!.null!.sync ===
          splitMatrix["LC_ALL=C (pinned — does NOT match '')"]!.empty!.sync,
      JSON.stringify(splitMatrix),
    );

    // ── artifact ──
    const out = writeArtifact('shipped-verdicts.json', {
      generatedBy: 'spikes/spine-adopt/src/shipped-verdicts.mts',
      spec: '.totem/specs/spine-spike.md § Differential units + § Oracle arms + § Invariants',
      timeoutMs: TIMEOUT_MS,
      spikeSimplification:
        'Every addition is fed UNCLASSIFIED (astContext absent ⇒ code). Shipped lint never runs this configuration; `astContext: "comment"` gates emission after triggering (apply-rules-bounded.ts:249).',
      armModel: {
        regex: {
          'arm1-pin':
            'applyRulesToAdditions — the sync dispatcher that produced the pins at record-runtime.test.ts:286-395',
          'arm2-lint': 'applyRulesToAdditionsBounded — what `totem lint` runs',
          agreementAsserted: true,
        },
        'ast-grep': {
          'arm1-pin':
            'applyAstRulesToAdditions — the dispatcher that produced the pins at record-runtime.test.ts:397-433',
          'arm2-lint':
            'applyAstRulesToAdditions — the SAME function; `totem lint` has no second ast dispatcher',
          agreementAsserted: false,
          note: 'The arms COINCIDE for ast rules. Recorded rather than manufactured: calling one function twice and reporting agreement would be a vacuous check. The engine filter is measured instead — applyRulesToAdditions drops ast rules entirely, so it is not a second ast arm. FLAGGED for the dispatching seat: § Oracle arms says "both arms run on all specimens", which has no two-dispatcher reading on the ast side.',
        },
      },
      verdictRows: rows,
      pinReproduction: pins,
      nullEmptySplit: splitMatrix,
      checks: checks.rows,
    });

    console.log(`\n${rows.length} verdict rows -> ${out}`);
    console.log(`artifacts: ${ARTIFACTS_DIR}`);
    console.log(`repo root: ${REPO_ROOT}`);
    checks.finish('shipped-verdicts');
  } finally {
    // `dispose()` is nested in its own try/finally: a rejection from it would
    // otherwise skip the rmSync below and orphan the temp worktree.
    try {
      await evaluator.dispose();
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  }
}

await main();
