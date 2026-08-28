// The matched task set for the serena pilot.
//
// Each task carries:
//   - `question`     : the retrieval question, as an agent would pose it
//   - `groundTruth`  : file paths (repo-relative, forward slash) that MUST appear
//                      in an arm's output for that arm to be scored correct.
//                      Derived with exhaustive ripgrep BEFORE either arm ran and
//                      hand-checked to separate definitions from genuine uses.
//   - `decoys`       : files that a naive whole-word text search reports but that
//                      contain NO reference of the kind the task asks for -- in
//                      almost every case because the only occurrence sits inside
//                      a `//` or `/* */` comment. Surfacing a decoy is a FALSE
//                      POSITIVE, and is scored per arm.
//
// GROUND-TRUTH REVISION (recorded deliberately, because it happened after a
// first scoring pass): the initial ground truth was derived with `rg -w`, which
// cannot tell a code reference from the symbol's name appearing in prose. Four
// entries were occurrences inside comments only, verified by reading the cited
// lines (T4 compile-smoke-gate.test.ts:518,681; T5 facts.mts:6;
// T7 compile-smoke-gate.ts:236 and compile-smoke-gate.test.ts:602). They were
// removed under a single rule applied uniformly to every task -- "a mention
// inside a comment is not a reference" -- and re-listed as decoys. The revision
// removes serena misses AND introduces baseline false positives, so it is
// stated here rather than quietly applied.
//   - `mustContain`  : optional extra literals (e.g. a definition line number)
//   - `serena`       : async (client) => call records; the minimal natural tool
//                      sequence an agent would issue against serena v1.7.0
//   - `baseline`     : ripgrep argv sequence (pattern -> narrow)
//   - `baselineStopOnFirstNonEmpty`
//                    : true for "find the definition" style questions, where a
//                      real agent stops as soon as a definition-shaped pattern
//                      hits. False for enumeration questions, where completeness
//                      is the point and the agent runs the whole sequence.
//
// Fairness notes:
//   - The baseline is deliberately given the GENEROUS sequence: a `-l` file-spread
//     pass followed by a narrowed `-n` pass, rather than one broad noisy `-n`
//     dump. Making the baseline cheap is what makes a serena win credible.
//   - Both arms see the same exclusion set: dist/ and node_modules/ are
//     gitignored, ripgrep honours .gitignore by default and serena is configured
//     with ignore_all_files_in_gitignore: true.

const TS_GLOBS = ['-g', '*.ts', '-g', '*.tsx', '-g', '*.mts', '-g', '*.cts', '-g', '!**/dist/**'];

/** Locate a symbol's defining file, then enumerate its referencing symbols. */
function symbolThenReferences(symbol) {
  return async (client) => {
    const calls = [];
    const found = await client.callTool('find_symbol', {
      name_path_pattern: symbol,
      relative_path: '',
    });
    calls.push(found);

    // An agent reads the defining file out of the first result and feeds it to
    // the reference search -- exactly what the chained call below does.
    // Pick the DEFINING file, not merely the first hit. find_symbol matches
    // nested name paths too, so a local alias such as
    //   "runCompiledRules/applyRulesToAdditionsBounded" (kind: Constant)
    // can sort ahead of the real top-level definition. Prefer an exact,
    // un-nested name_path of a definition-ish kind, in a non-test file.
    let defPath = null;
    try {
      const parsed = JSON.parse(found.text);
      const hits = Array.isArray(parsed) ? parsed : [];
      const DEF_KINDS = [
        'Function',
        'Interface',
        'Class',
        'Constant',
        'Method',
        'Variable',
        'Enum',
      ];
      const exact = hits.filter((h) => h.name_path === symbol);
      const defish = exact.filter((h) => DEF_KINDS.includes(h.kind));
      const pool = defish.length ? defish : exact.length ? exact : hits;
      const nonTest = pool.filter((h) => !/\.test\.[cm]?tsx?$/.test(h.relative_path ?? ''));
      defPath = (nonTest[0] ?? pool[0])?.relative_path ?? null;
    } catch {
      defPath = null;
    }

    if (defPath) {
      calls.push(
        await client.callTool('find_referencing_symbols', {
          name_path: symbol,
          relative_path: defPath,
        }),
      );
    }
    return calls;
  };
}

export const TASKS = [
  {
    id: 'T1',
    kind: 'definition',
    question: 'Where is `compileRuleRecord` defined (file + line)?',
    groundTruth: ['packages/core/src/spine/record-lower.ts'],
    // serena reports 0-based body_location.start_line (350) for the 1-based
    // source line 351; either token is accepted as identifying the site.
    mustContainAny: ['350', '351'],
    serena: async (client) => [
      await client.callTool('find_symbol', {
        name_path_pattern: 'compileRuleRecord',
        relative_path: '',
      }),
    ],
    baseline: [
      ['-n', 'export function compileRuleRecord', ...TS_GLOBS],
      ['-n', '-w', 'compileRuleRecord', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: true,
  },

  {
    id: 'T2',
    kind: 'references',
    question: 'Every call site of `runSmokeGate` across packages (src only, exclude dist).',
    groundTruth: [
      'packages/core/src/compile-smoke-gate.test.ts',
      'packages/core/src/compile-lesson.ts',
      'packages/cli/src/commands/rule.ts',
      'packages/core/src/spine/preimage-differential.ts',
    ],
    decoys: [{ file: 'packages/core/src/index.ts', reason: 're-export only, not a call site' }],
    serena: symbolThenReferences('runSmokeGate'),
    baseline: [
      ['-l', '-w', 'runSmokeGate', ...TS_GLOBS],
      ['-n', 'runSmokeGate\\(', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },

  {
    id: 'T3',
    kind: 'references',
    question: 'Every caller of `applyRulesToAdditionsBounded` (cross-package).',
    groundTruth: [
      'spikes/spine-adopt/src/shipped-verdicts.mts',
      'packages/core/src/compile-smoke-gate.test.ts',
      'packages/core/src/regex-safety/apply-rules-bounded.test.ts',
      'packages/core/src/rule-engine.test.ts',
      'packages/cli/src/commands/run-compiled-rules.ts',
      'packages/core/src/spine/record-runtime.test.ts',
    ],
    decoys: [
      { file: 'packages/core/src/rule-engine.ts', reason: 'import/re-export, not a caller' },
    ],
    serena: symbolThenReferences('applyRulesToAdditionsBounded'),
    baseline: [
      ['-l', '-w', 'applyRulesToAdditionsBounded', ...TS_GLOBS],
      ['-n', 'applyRulesToAdditionsBounded\\(', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },

  {
    id: 'T4',
    kind: 'blast-radius',
    question:
      'Rename blast radius: every reference to `requiresSuppressesMatch` (defs, calls, tests, re-exports).',
    groundTruth: [
      'packages/core/src/spine/record-runtime.ts',
      'packages/core/src/spine/record-runtime.test.ts',
      'packages/core/src/compile-smoke-gate.ts',
      'packages/core/src/index.ts',
      'packages/core/src/regex-safety/apply-rules-bounded.ts',
      'packages/core/src/rule-engine.ts',
    ],
    decoys: [
      {
        file: 'packages/core/src/compile-smoke-gate.test.ts',
        reason: 'comment-only mentions at lines 518 and 681; no code reference',
      },
    ],
    serena: symbolThenReferences('requiresSuppressesMatch'),
    baseline: [
      ['-l', '-w', 'requiresSuppressesMatch', ...TS_GLOBS],
      ['-n', '-w', 'requiresSuppressesMatch', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },

  {
    id: 'T5',
    kind: 'type-usage',
    question: 'Definition of interface `AstGrepMatch` plus every file referencing the type.',
    groundTruth: [
      'packages/core/src/ast-grep-query.ts',
      'packages/core/src/compile-smoke-gate.ts',
      'packages/core/src/index.ts',
    ],
    decoys: [
      {
        file: 'spikes/spine-adopt/src/facts.mts',
        reason: 'comment-only mention at line 6; no code reference to the type',
      },
    ],
    serena: symbolThenReferences('AstGrepMatch'),
    baseline: [
      ['-l', '-w', 'AstGrepMatch', ...TS_GLOBS],
      ['-n', '-w', 'AstGrepMatch', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },

  {
    id: 'T6',
    kind: 'module-consumers',
    question: 'Every file importing from `record-runtime` (any import path form).',
    groundTruth: [
      'packages/core/src/compile-smoke-gate.ts',
      'packages/core/src/index.ts',
      'packages/core/src/regex-safety/apply-rules-bounded.ts',
      'packages/core/src/rule-engine.ts',
      'packages/core/src/stage4-verifier.ts',
      'packages/core/src/spine/record-lower.test.ts',
      'packages/core/src/spine/record-runtime.test.ts',
      'packages/core/src/spine/windtunnel-firing.ts',
    ],
    decoys: [
      { file: 'packages/core/src/compiler-schema.ts', reason: 'comment-only mention at line 713' },
      { file: 'packages/core/src/regex-validation.ts', reason: 'comment-only mention at line 8' },
      {
        file: 'packages/core/src/sys/glob.ts',
        reason: 'comment-only mentions at lines 47 and 377',
      },
    ],
    // Module-level, not symbol-level: serena v1.7.0 has no "who imports this
    // module" verb, so the natural sequence falls back to its text search.
    serena: async (client) => [
      await client.callTool('search_for_pattern', {
        substring_pattern: "from '[^']*record-runtime",
        restrict_search_to_code_files: true,
        multiline: false,
      }),
    ],
    baseline: [
      ['-l', 'record-runtime', ...TS_GLOBS],
      ['-n', "from '[^']*record-runtime", ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },

  {
    id: 'T7',
    kind: 'symbol-and-uses',
    question: 'Definition of `RECORD_COMPILED_HOME_KEYS` plus all its uses.',
    groundTruth: [
      'packages/core/src/spine/record-runtime.ts',
      'packages/core/src/index.ts',
      'packages/core/src/spine/record-lower.test.ts',
    ],
    decoys: [
      {
        file: 'packages/core/src/compile-smoke-gate.ts',
        reason: 'comment-only mention at line 236; no code reference',
      },
      {
        file: 'packages/core/src/compile-smoke-gate.test.ts',
        reason: 'comment-only mention at line 602; no code reference',
      },
    ],
    serena: symbolThenReferences('RECORD_COMPILED_HOME_KEYS'),
    baseline: [
      ['-l', '-w', 'RECORD_COMPILED_HOME_KEYS', ...TS_GLOBS],
      ['-n', '-w', 'RECORD_COMPILED_HOME_KEYS', ...TS_GLOBS],
    ],
    baselineStopOnFirstNonEmpty: false,
  },
];
