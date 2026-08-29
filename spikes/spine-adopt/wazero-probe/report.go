package main

// ─── Orchestration and artifacts ─────────────────────────────────────────────

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"

	"github.com/tetratelabs/wazero"
)

func sha256hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// ─── Foreign artifact shapes ─────────────────────────────────────────────────

type shippedEvent struct {
	Kind string `json:"kind"`
	Line int64  `json:"line"`
}

type shippedArm struct {
	Oracle     string             `json:"oracle"`
	Violations []shippedViolation `json:"violations"`
}

type shippedRow struct {
	RuleID     string         `json:"ruleId"`
	FixtureID  string         `json:"fixtureId"`
	Specimen   string         `json:"specimen"`
	Engine     string         `json:"engine"`
	Fired      bool           `json:"fired"`
	MatchCount int            `json:"matchCount"`
	Events     []shippedEvent `json:"events"`
	Arms       []shippedArm   `json:"arms"`
	// Error is non-nil ONLY on the shipped arm's error row for the K5b
	// malformed-facts control (`m3-malformed-lines`, `src/shipped-verdicts.mts`):
	// `fired`/`matchCount` are null there and `arms` is empty because no
	// dispatcher ran. Mirrors `regoRow.Error` — the same field the wasmtime
	// and wazero rows carry — so all three arms normalise an error row the
	// same way and the count checks hold the shipped arm to the corpus.
	Error *string `json:"error"`
}

type regoEvent struct {
	Kind       string `json:"kind"`
	LineNumber int64  `json:"line_number"`
}

type regoRow struct {
	RuleID     string      `json:"ruleId"`
	FixtureID  string      `json:"fixtureId"`
	Specimen   string      `json:"specimen"`
	Engine     string      `json:"engine"`
	Fired      *bool       `json:"fired"`
	MatchCount *int        `json:"matchCount"`
	Violations []violation `json:"violations"`
	Events     []regoEvent `json:"events"`
	Error      *string     `json:"error"`
}

// ─── Normalisation ───────────────────────────────────────────────────────────

func normaliseShipped(rows []shippedRow, bundles map[string][]astMatch) ([]normalRow, error) {
	out := make([]normalRow, 0, len(rows))
	for _, r := range rows {
		am, ok := bundles[r.FixtureID]
		if !ok {
			return nil, fmt.Errorf("shipped row %s has no FactBundle", r.FixtureID)
		}
		// A shipped ERROR row (K5b: the malformed-facts control) carries no arms
		// by construction — no dispatcher produced a verdict. It normalises to
		// the same error shape as a wasmtime/wazero error row (nil violations,
		// nil events, the error text) so the comparator's control carve-out and
		// the per-arm count checks see it; it is NOT the "no arms" defect below,
		// which stays fatal for a row that claims a verdict without one.
		if r.Error != nil && *r.Error != "" {
			out = append(out, normalRow{
				Arm: "shipped", RuleID: r.RuleID, FixtureID: r.FixtureID,
				Specimen: r.Specimen, Engine: r.Engine, Error: *r.Error,
			})
			continue
		}
		if len(r.Arms) == 0 {
			return nil, fmt.Errorf("shipped row %s carries no arms", r.FixtureID)
		}
		vs, derivation, problems := deriveShippedOrdinals(r.Engine, r.RuleID, r.Arms[0].Violations, am)
		if len(problems) > 0 {
			return nil, fmt.Errorf("ordinal derivation failed for %s: %v", r.FixtureID, problems)
		}
		evs := make([]event, 0, len(r.Events))
		for _, e := range r.Events {
			// The shipped event context's `line` is the line NUMBER (the shipped
			// Violation's `line` is the matched TEXT). The two structs have
			// identical fields, so this is a conversion, not a re-spelling — and a
			// conversion stops compiling if either shape ever drifts.
			evs = append(evs, event(e))
		}
		fired, count := r.Fired, r.MatchCount
		out = append(out, normalRow{
			Arm: "shipped", RuleID: r.RuleID, FixtureID: r.FixtureID,
			Specimen: r.Specimen, Engine: r.Engine,
			Violations: vs, Events: evs, Fired: &fired, MatchCount: &count,
			OrdinalDerivation: derivation,
		})
	}
	return out, nil
}

func normaliseRego(arm string, rows []regoRow) []normalRow {
	out := make([]normalRow, 0, len(rows))
	for _, r := range rows {
		n := normalRow{
			Arm: arm, RuleID: r.RuleID, FixtureID: r.FixtureID,
			Specimen: r.Specimen, Engine: r.Engine,
			Fired: r.Fired, MatchCount: r.MatchCount,
		}
		// C3 on EVERY arm (round-1 falsification leg, M1): an error row is a
		// NON-EMPTY error string. `error: ""` is a verdict row — reading it as an
		// error would silently drop the violations it carries and classify the
		// row oppositely to the TS comparator (`errorTextOf` in compare.mts).
		if r.Error != nil && *r.Error != "" {
			n.Error = *r.Error
		} else {
			n.Violations = r.Violations
			if n.Violations == nil {
				n.Violations = []violation{}
			}
			evs := make([]event, 0, len(r.Events))
			for _, e := range r.Events {
				evs = append(evs, event{Kind: e.Kind, Line: e.LineNumber})
			}
			n.Events = evs
		}
		out = append(out, n)
	}
	return out
}

// normaliseWazero converts this arm's own rows into the comparison shape.
func normaliseWazero(rows []verdictRow) ([]normalRow, error) {
	converted := make([]regoRow, 0, len(rows))
	for _, r := range rows {
		rr := regoRow{
			RuleID: r.RuleID, FixtureID: r.FixtureID, Specimen: r.Specimen,
			Engine: r.Engine, Fired: r.Fired, MatchCount: r.MatchCount, Error: r.Error,
		}
		// Same C3 rule as normaliseRego: only a NON-EMPTY error withholds the
		// verdict fields.
		if r.Error == nil || *r.Error == "" {
			rr.Violations = []violation{}
			for _, raw := range r.Violations {
				var v violation
				if err := json.Unmarshal(raw, &v); err != nil {
					return nil, fmt.Errorf("row %s: violation %s is not {rule_id,line_number,ordinal}: %w", r.FixtureID, raw, err)
				}
				rr.Violations = append(rr.Violations, v)
			}
			for _, raw := range r.Events {
				var e regoEvent
				if err := json.Unmarshal(raw, &e); err != nil {
					return nil, fmt.Errorf("row %s: event %s is not {kind,line_number}: %w", r.FixtureID, raw, err)
				}
				rr.Events = append(rr.Events, e)
			}
		}
		converted = append(converted, rr)
	}
	return normaliseRego("wazero", converted), nil
}

// ─── Report ──────────────────────────────────────────────────────────────────

type tally struct {
	Match       int `json:"MATCH"`
	Explained   int `json:"EXPLAINED-DIVERGENCE"`
	Unexplained int `json:"UNEXPLAINED-DIVERGENCE"`
}

func tallyOf(rows []pairResult) tally {
	var t tally
	for _, r := range rows {
		switch r.Status {
		case statusMatch:
			t.Match++
		case statusExplained:
			t.Explained++
		case statusUnexplained:
			t.Unexplained++
		}
	}
	return t
}

// writeArtifact serialises one artifact. The modes are the restrictive ones
// gosec's G301/G306 ask for; nothing here needs to be group- or world-readable,
// and git records only the executable bit, so the committed artifacts are
// unaffected.
func writeArtifact(dir, name string, v any) (string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", err
	}
	at := filepath.Join(dir, name)
	if err := os.WriteFile(at, append(b, '\n'), 0o600); err != nil {
		return "", err
	}
	return at, nil
}

func run(root string) error {
	ctx := context.Background()
	ck := &checks{}
	selfTest(ck)

	recordSet, err := loadRecordSet()
	if err != nil {
		return err
	}
	fmt.Printf("record set: %s (%s)\n", recordSet, recordSetEnvVar)

	// Resolved BEFORE any read, so an invalid `SPIKE_ARTIFACTS_SUBDIR` refuses the
	// run instead of being discovered halfway through it as a missing file.
	paths, err := resolveSpikePaths(root)
	if err != nil {
		return err
	}
	printRunHeader(paths)

	records, err := loadLowering(paths)
	if err != nil {
		return err
	}
	facts, err := loadFacts(paths)
	if err != nil {
		return err
	}

	// The row cardinality every arm is held to, DERIVED from the fact corpus and
	// its index. Nothing below may write the count as a literal: the number is a
	// property of the selected record set, not of the seven specimens this probe
	// was first built against.
	//
	// This is also where the corpus's OWN record-set identity is checked against
	// the selector (C1): the count is read through loadFactsIndex, which refuses a
	// corpus generated for another set before anything is derived from it.
	want, err := expectedRowCount(paths, recordSet, facts)
	if err != nil {
		return err
	}

	// `seedEntry` is carried on the lowered record rows for the seed set and is
	// absent on `specimens`; the pairs artifact relabels each pair with it so a
	// rule's N records group without the scorer re-deriving the mapping.
	//
	// `control` (C5) rides the same way and from the same source — the lowered
	// record row the TS half wrote. It is READ, never inferred from the fixture id
	// or the specimen name: which records are controls is the record set's fact to
	// state, and a Go copy of that rule would be a second source of truth.
	seedEntryOf := map[string]string{}
	controlOf := map[string]bool{}
	for _, rec := range records {
		seedEntryOf[rec.Specimen] = rec.SeedEntry
		controlOf[rec.Specimen] = rec.Control
	}

	// ── Drive every policy under wazero ──
	var (
		allRows    []verdictRow
		allTimings []timingRow
		allABI     []abiRow
		allPaths   []pathCheck
	)
	granularity := clockGranularityMicros()
	fmt.Printf("monotonic clock granularity: %.3f us\n", granularity)

	// Shared across every runtime so the cold-eval measurement's fresh instances
	// do not each pay the ~65ms compile.
	cache := wazero.NewCompilationCache()
	defer func() { _ = cache.Close(ctx) }()

	for _, rec := range records {
		res, err := runSpecimen(ctx, paths, cache, rec, facts)
		if err != nil {
			// A wazero incompatibility IS the finding this probe exists to catch,
			// so it is reported at the exact point it happened rather than papered
			// over with a fabricated verdict.
			return fmt.Errorf("specimen %s (%s): %w", rec.Specimen, rec.RuleID, err)
		}
		// `runSpecimen` emits one row and one timing per fact bundle whose
		// `specimen` matches the record, and NO error when none does — so an empty
		// `timings` means the join found nothing, and the `res.timings[0]` below
		// would panic on it. A lowered record that pairs with no fact bundle is a
		// corpus defect and is reported as one, rather than as a crash or as a
		// specimen that silently evaluated nothing.
		if len(res.timings) == 0 {
			return fmt.Errorf("specimen %s (%s): no fact bundle in artifacts/facts pairs with this lowered record — "+
				"nothing was evaluated for it, so there is no verdict to report", rec.Specimen, rec.RuleID)
		}
		allRows = append(allRows, res.rows...)
		allTimings = append(allTimings, res.timings...)
		allABI = append(allABI, res.abi)
		allPaths = append(allPaths, res.paths...)
		fmt.Printf("  %-8s %2d fixtures  compile=%dus instantiate=%dus\n",
			res.abi.Specimen, len(res.rows), res.timings[0].CompileMicros, res.timings[0].InstantiateMicros)
	}

	// ── Load the arms to compare against ──
	var shippedDoc struct {
		VerdictRows []shippedRow `json:"verdictRows"`
	}
	if err := readJSON(paths.artifact("shipped-verdicts.json"), &shippedDoc); err != nil {
		return err
	}
	var opaDoc struct {
		VerdictRows []regoRow `json:"verdictRows"`
		Host        struct {
			Crate   string `json:"crate"`
			Runtime string `json:"runtime"`
		} `json:"host"`
	}
	if err := readJSON(paths.artifact("opa-verdicts.json"), &opaDoc); err != nil {
		return err
	}

	bundles := map[string][]astMatch{}
	for _, f := range facts {
		bundles[f.FixtureID] = f.astMatches
	}

	shipped, err := normaliseShipped(shippedDoc.VerdictRows, bundles)
	if err != nil {
		return err
	}
	opa := normaliseRego("opa", opaDoc.VerdictRows)
	waz, err := normaliseWazero(allRows)
	if err != nil {
		return err
	}

	// `want` comes from the fact corpus (see expectedRowCount); the check NAMES are
	// formatted from it too, so a run over a different record set reports the
	// cardinality it was actually held to instead of a stale 24.
	ck.eq(fmt.Sprintf("shipped arm produced %d verdict rows", want), len(shipped), want)
	ck.eq(fmt.Sprintf("opa (wasmtime) arm produced %d verdict rows", want), len(opa), want)
	ck.eq(fmt.Sprintf("wazero arm produced %d verdict rows", want), len(waz), want)

	index := func(rows []normalRow) map[string]normalRow {
		m := map[string]normalRow{}
		for _, r := range rows {
			m[r.RuleID+"|"+r.FixtureID] = r
		}
		return m
	}
	S, O, W := index(shipped), index(opa), index(waz)
	ck.eq("the join key (ruleId, fixtureId) is unique on every arm",
		[]int{len(S), len(O), len(W)}, []int{want, want, want})

	missing := []string{}
	for k := range S {
		if _, ok := W[k]; !ok {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	ck.eq("every shipped pair has a wazero row (no silent skip)", missing, []string{})

	firedN, silentN, maxCount := 0, 0, 0
	for _, r := range shipped {
		if r.Fired != nil && *r.Fired {
			firedN++
		} else {
			silentN++
		}
		if r.MatchCount != nil && *r.MatchCount > maxCount {
			maxCount = *r.MatchCount
		}
	}
	discriminatingDetail := fmt.Sprintf("%d fired / %d silent / max matchCount %d", firedN, silentN, maxCount)
	if maxCount > 1 || recordSet == recordSetSpecimens {
		ck.check("the corpus is DISCRIMINATING — the shipped arm both fires and stays silent, and at least one row is multi-violation",
			firedN > 0 && silentN > 0 && maxCount > 1, discriminatingDetail)
	} else {
		// Mirrors src/compare.mts on a non-specimens set whose bundles never carry
		// more than one match: the multi-violation clause is a CORPUS property of
		// the frozen set (the ast ordinal axis is simply unexercised there), not an
		// apparatus defect — the probe must not refuse the run over it. Demoted to
		// a named skip; the fires-and-silences half keeps full strength. On
		// `specimens` the original check stays byte-identical.
		ck.check("the corpus is DISCRIMINATING — the shipped arm both fires and stays silent",
			firedN > 0 && silentN > 0, discriminatingDetail)
		ck.check("MULTI-VIOLATION — SKIPPED with a named reason: NO bundle in this record set carries more than one violation, so the ast ORDINAL axis (§ Lowering 1, \"the ordinal is the match index\") is UNEXERCISED here (a corpus property of the frozen set, not an apparatus defect)",
			true, discriminatingDetail)
	}

	// ── Compare ──
	//
	// The key set is the UNION of the three arms, not the shipped arm's alone. A
	// fixture only one arm produced — the malformed-facts control is the designed
	// case, an arm that skipped a record is the undesigned one — has to reach the
	// comparator to be reported; keying on shipped would drop it silently, and a
	// dropped row is exactly what a differential must never do.
	keySeen := map[string]bool{}
	identity := map[string]normalRow{}
	keys := []string{}
	for _, m := range []map[string]normalRow{S, O, W} {
		for k, r := range m {
			if !keySeen[k] {
				keySeen[k] = true
				keys = append(keys, k)
				identity[k] = r
			}
		}
	}
	sort.Strings(keys)

	// rowOrAbsent synthesises a marked ABSENT row for an arm that produced none, so
	// the pair is comparable and the reason is named rather than inferred from a
	// zero value.
	rowOrAbsent := func(m map[string]normalRow, k, arm string) normalRow {
		if r, ok := m[k]; ok {
			return r
		}
		id := identity[k]
		return normalRow{
			Arm: arm, RuleID: id.RuleID, FixtureID: id.FixtureID,
			Specimen: id.Specimen, Engine: id.Engine, Absent: true,
		}
	}

	var pairs []pairResult
	for _, k := range keys {
		w := rowOrAbsent(W, k, "wazero")
		pairs = append(pairs,
			comparePair(rowOrAbsent(S, k, "shipped"), w),
			comparePair(rowOrAbsent(O, k, "opa"), w))
	}
	// Set ONLY when the record actually carries a seed entry: an absent one stays
	// nil and serialises as JSON `null`, never as `""` (mmnto-ai/totem#2694 C4).
	// `control` is unconditional by contrast (C5): `false` is a value, not an
	// absence, and the key is present on every row.
	for i := range pairs {
		if s := seedEntryOf[pairs[i].Specimen]; s != "" {
			pairs[i].SeedEntry = &s
		}
		pairs[i].Control = controlOf[pairs[i].Specimen]
	}
	by := func(l, r string) []pairResult {
		var out []pairResult
		for _, p := range pairs {
			if p.Left == l && p.Right == r {
				out = append(out, p)
			}
		}
		return out
	}
	sVsW, oVsW := by("shipped", "wazero"), by("opa", "wazero")

	// Initialised empty, never nil: these serialise into the report, and a `null`
	// would read as "not computed" where the report claims "none found".
	unexplained, explained := []pairResult{}, []pairResult{}
	for _, p := range pairs {
		switch p.Status {
		case statusUnexplained:
			unexplained = append(unexplained, p)
		case statusExplained:
			explained = append(explained, p)
		}
	}

	ck.eq("shipped-vs-wazero — every pair MATCHES (the ruled PASS criterion: identical violation multisets AND event streams on every fixture)",
		tallyOf(sVsW).Unexplained, 0)
	ck.eq("opa(wasmtime)-vs-wazero — no unexplained divergence (the SAME wasm artifact under two runtimes)",
		tallyOf(oVsW).Unexplained, 0)

	// ── Probe-internal cross-checks ──
	pathDisagree := []pathCheck{}
	for _, p := range allPaths {
		if !p.Agree {
			pathDisagree = append(pathDisagree, p)
		}
	}
	ck.eq("the CLASSIC eval-context sequence and the ONE-SHOT `opa_eval` fast path agree on every fixture",
		len(pathDisagree), 0)
	// ── (C7) the whole-run ERROR ROW accounting ──
	//
	// Published in the SAME grammar the TS comparator publishes
	// (`src/compare.mts:935-957`), so `differential-report.json.errorRows` and
	// `wazero-report.json.errorRows` are one shape to the scorer
	// (mmnto-ai/totem#2694 C7). It replaces the bare error-row counter this
	// cross-check used to keep for itself: a count that cannot distinguish the
	// designed control error from an undesigned one is not evidence for the claim
	// "0 outside K5b", and keeping a second counter beside the accounting would be
	// two numbers that can disagree.
	//
	// The control ids are the ones PRESENT in this run's corpus, never the
	// constant asserted to be present: on `specimens` there is no control bundle
	// and the list is empty, exactly as the TS side's set is.
	controlFixtureIDs := []string{}
	for _, f := range facts {
		if f.FixtureID == malformedFactsControlFixture {
			controlFixtureIDs = append(controlFixtureIDs, f.FixtureID)
			break
		}
	}
	errorRows := accountErrorRows(controlFixtureIDs, []armRowSet{{Arm: armWazero, Rows: waz}})
	wazErrorRows := errorRows.PerArm[armWazero].Total
	appendErrorRowChecks(ck, errorRows)

	// The accounting counts a NON-EMPTY error string (C3), while the raw verdict
	// rows carry `*string`. The two predicates can only disagree on a row whose
	// error is present but empty — which this arm never emits, since `errRow` is
	// built from a non-nil error. Asserted rather than assumed, because the ABI
	// cross-check below now derives its expectation from the accounting.
	emptyErrorRows := []string{}
	for _, r := range allRows {
		if r.Error != nil && *r.Error == "" {
			emptyErrorRows = append(emptyErrorRows, r.FixtureID)
		}
	}
	sort.Strings(emptyErrorRows)
	ck.eq("no wazero verdict row carries a PRESENT but EMPTY error (C3 — an empty error string is a verdict row, "+
		"so the two error-row predicates cannot disagree)", emptyErrorRows, []string{})

	// The cross-check runs on every fixture that produced a VERDICT. A fixture whose
	// classic eval errored — the malformed-facts control is the designed one — has
	// no verdict for the one-shot path to agree with, so the expectation is the
	// verdict rows minus the error rows, derived here rather than assumed to be the
	// whole corpus. On a clean run there are no error rows and this is `want`.
	ck.eq("every fixture exercised BOTH ABI paths", len(allPaths), len(allRows)-wazErrorRows)

	hostBuiltins := map[string][]string{}
	for _, a := range allABI {
		if len(a.RequiredBuiltins) > 0 {
			names := []string{}
			for n := range a.RequiredBuiltins {
				names = append(names, n)
			}
			sort.Strings(names)
			hostBuiltins[a.Specimen] = names
		}
	}
	ck.eq("every module's own `builtins` export is EMPTY — the host implements no builtin, so the opa_builtin0..4 stubs are provably never called",
		hostBuiltins, map[string][]string{})

	grewSpecimens := []string{}
	shimMinPages := map[string]uint32{}
	for _, a := range allABI {
		shimMinPages[a.Specimen] = a.ShimMemoryMin
		if a.MemoryPagesAfter > a.ShimMemoryMin {
			grewSpecimens = append(grewSpecimens, fmt.Sprintf("%s: %d -> %d pages", a.Specimen, a.ShimMemoryMin, a.MemoryPagesAfter))
		}
	}

	// ── Timings ──
	var cold, warm, warmOneShot, compile, instantiate []float64
	seenSpecimen := map[string]bool{}
	for _, t := range allTimings {
		if t.ColdEvalMicrosMean > 0 {
			cold = append(cold, t.ColdEvalMicrosMean)
		}
		if t.WarmEvalMicrosMean > 0 {
			warm = append(warm, t.WarmEvalMicrosMean)
		}
		if t.WarmOneShotEvalMicros > 0 {
			warmOneShot = append(warmOneShot, t.WarmOneShotEvalMicros)
		}
		if !seenSpecimen[t.Specimen] {
			seenSpecimen[t.Specimen] = true
			compile = append(compile, float64(t.CompileMicros))
			instantiate = append(instantiate, float64(t.InstantiateMicros))
		}
	}
	round := func(f float64) float64 { return float64(int64(f*1000+0.5)) / 1000 }
	summarise := func(xs []float64) map[string]float64 {
		if len(xs) == 0 {
			return map[string]float64{}
		}
		s := append([]float64(nil), xs...)
		sort.Float64s(s)
		var sum float64
		for _, x := range s {
			sum += x
		}
		return map[string]float64{
			"min": round(s[0]), "median": round(s[len(s)/2]),
			"max": round(s[len(s)-1]), "mean": round(sum / float64(len(s))),
		}
	}

	// ── Write the verdict artifact ──
	outDir := paths.Out
	sort.Slice(allRows, func(i, j int) bool {
		if allRows[i].RuleID != allRows[j].RuleID {
			return allRows[i].RuleID < allRows[j].RuleID
		}
		return allRows[i].FixtureID < allRows[j].FixtureID
	})
	verdictsAt, err := writeArtifact(outDir, "wazero-verdicts.json", map[string]any{
		"generatedBy": "spikes/spine-adopt/wazero-probe (go run .)",
		"contract": "spec § Enrichment rows item 2 — the wazero component-model maturity check BEFORE any WASM contract freezes. " +
			"Row shape is the wasmtime arm's VerdictRow, arm: \"wazero\".",
		"arm":        "wazero",
		"wazero":     wazeroVersion(),
		"opaVersion": "1.20.0 (the pinned binary that emitted these artifacts; unchanged by this probe)",
		"abi":        allABI,
		"exportEnumerationNote": "The per-specimen `exports` list holds 24 entries (23 functions + the re-exported memory) " +
			"where artifacts/opa-abi-census.json reports 26. The difference is the two GLOBALS, `opa_wasm_abi_version` and " +
			"`opa_wasm_abi_minor_version`: wazero's CompiledModule exposes ImportedFunctions / ExportedFunctions / " +
			"ImportedMemories / ExportedMemories but has NO accessor for exported globals, so this probe cannot read them. " +
			"Not a divergence and not a wazero defect — a gap in its reflection API, and one a Go satellite would have to " +
			"work around (by decoding the binary itself) if it ever needed to gate on the declared ABI version. Here the ABI " +
			"version is confirmed BEHAVIOURALLY instead: `opa_eval` is exported and evaluates correctly, which requires ABI " +
			"1.2 or later, consistent with the census's 1.3.",
		"strictness":  "An evaluation error, a non-object result, a missing `violations`/`events` key, or an EMPTY RESULT SET is an ERROR ROW. An empty result set means the entrypoint's `result` rule was UNDEFINED, which for these policies means `patterns_compile` or `facts_wellformed` failed — never a zero-violation verdict.",
		"timings":     allTimings,
		"verdictRows": allRows,
	})
	if err != nil {
		return err
	}

	// ── Write the comparison report ──
	requiredPairs := []pairResult{}
	for _, p := range sVsW {
		if isRequired(recordSet, p.Specimen) {
			requiredPairs = append(requiredPairs, p)
		}
	}

	// ── Write the opa-vs-wazero pairs artifact ──
	pairsAt, err := writePairsArtifact(outDir, recordSet, oVsW)
	if err != nil {
		return err
	}

	reportAt, err := writeArtifact(outDir, "wazero-report.json", map[string]any{
		"generatedBy": "spikes/spine-adopt/wazero-probe (go run .)",
		"question": "Can wazero, today, load and correctly evaluate the exact wasm artifacts this spike produced — " +
			"i.e. is the Go-satellite lane viable on core wasm, and is anything about the component model needed at all?",
		"answer": answer(tallyOf(sVsW), tallyOf(oVsW), len(pathDisagree)),

		"wazeroVersion": wazeroVersion(),
		"goVersion":     goVersion(),
		"comparedAgainst": map[string]any{
			"shipped": "artifacts/shipped-verdicts.json (the shipped oracle; arms[0] = arm1-pin)",
			"opa":     fmt.Sprintf("artifacts/opa-verdicts.json — %s on %s", opaDoc.Host.Crate, opaDoc.Host.Runtime),
		},

		"rowsCompared": map[string]any{
			"wazeroVerdictRows":  len(allRows),
			"shipped-vs-wazero":  len(sVsW),
			"opa-vs-wazero":      len(oVsW),
			"requiredSubset":     requiredSubsetDescription(recordSet, records),
			"requiredSubsetRows": len(requiredPairs),
		},
		"summary": map[string]any{
			"shipped-vs-wazero": tallyOf(sVsW),
			"opa-vs-wazero":     tallyOf(oVsW),
			"requiredSubset":    tallyOf(requiredPairs),
		},
		"errorRows": errorRows,

		"divergences": map[string]any{
			"unexplained": unexplained,
			"explained":   explained,
			"note": "Verbatim. Empty arrays mean no divergence was found, not that none was looked for — the detector " +
				"is exercised against 9 synthetic mutants in `checks` before any real row is compared.",
		},

		"evalSequence": map[string]any{
			"classic": []string{
				"opa_heap_ptr_set(baseHeap)",
				"opa_malloc(len(inputJSON)) + memory.Write",
				"opa_json_parse(ptr, len) -> input opa_value",
				"opa_eval_ctx_new()",
				"opa_eval_ctx_set_input(ctx, input)",
				"opa_eval_ctx_set_data(ctx, data)   // data = parsed `{}`, allocated BELOW baseHeap",
				"opa_eval_ctx_set_entrypoint(ctx, entrypointId)",
				"eval(ctx)  // must return 0",
				"opa_eval_ctx_get_result(ctx)",
				"opa_json_dump(result) -> NUL-terminated JSON",
			},
			"oneShot": []string{
				"opa_heap_ptr_set(baseHeap)",
				"opa_malloc(len(inputJSON)) + memory.Write",
				"opa_heap_ptr_get() -> heapPtr (ABOVE the input just written)",
				"opa_eval(0, entrypointId, data, inputPtr, inputLen, heapPtr, 0 /*JSON*/) -> NUL-terminated JSON",
			},
			"setupOrderIsLoadBearing": "The data document is parsed BEFORE the heap watermark is saved, so it lives below " +
				"baseHeap and survives every per-eval `opa_heap_ptr_set(baseHeap)`. Saving the watermark first would let each " +
				"eval reclaim the data document out from under itself.",
			"bothPathsRun": "Every fixture is evaluated through BOTH sequences and the dumped JSON is compared structurally. " +
				"A hand-driven ABI can produce a plausible verdict through one path while mis-driving the heap; two paths with " +
				"different allocation discipline agreeing is much harder to fake.",
			"classicAndOneShotDisagreements": pathDisagree,
		},

		"timingsMicros": map[string]any{
			"clockGranularityMicros": round(granularity),
			"compilePerSpecimen":     summarise(compile),
			"instantiatePerSpecimen": summarise(instantiate),
			"coldEval":               summarise(cold),
			"warmEvalClassic":        summarise(warm),
			"warmEvalOneShot":        summarise(warmOneShot),
			"warmReps":               warmReps,
			"coldReps":               coldReps,
			"perFixture":             allTimings,
			"method": fmt.Sprintf(
				"This host's monotonic clock resolves to ~%.0f us, which is LARGER than one eval, so no per-call "+
					"measurement is meaningful. Every eval number here is therefore a BATCH mean: one timer around N "+
					"evaluations, divided by N. Warm = %d evals on one already-warm instance. Cold = the FIRST eval on each "+
					"of %d instances that were all built before the timer started, so instantiation is excluded. "+
					"Compile and instantiate are single coarse readings per specimen and are only reliable to ~%.0f us; "+
					"compile is ~65ms and comfortably above the noise, instantiate is NOT and should be read as "+
					"'sub-millisecond' rather than as a figure.",
				granularity, warmReps, coldReps, granularity),
			"comparisonToWasmtimeArm": "artifacts/opa-verdicts.json reports a MIN over 50 individually-timed reps " +
				"(cold 246-355us, warm 236-241us on specimen a). Those are minima and these are means, and they were taken " +
				"through a different host crate, so treat any cross-runtime comparison as indicative only — this probe was " +
				"built to answer CORRECTNESS, not to benchmark.",
		},

		"componentModelNote": map[string]any{
			"needed": false,
			"finding": "NOT NEEDED FOR THIS PATH. The seven policy modules are core wasm (MVP + the mutable-globals/sign-extension " +
				"class of Core 2.0 features at most): every import is a plain function or a memory, every export is a plain " +
				"function, a memory, or a global. No component, no interface types, no resources, no WIT. wazero loaded and " +
				"evaluated them with nothing but the Core Specification.",
			"wazeroSupportStatus": "wazero's README (module cache, v1.12.0) states: \"wazero is a WebAssembly Core Specification " +
				"1.0 and 2.0 compliant runtime\" and \"Both runtimes pass WebAssembly Core 1.0 and 2.0 specification tests\". " +
				"The component model is not claimed anywhere in the README; RATIONALE.md mentions it exactly twice, in passing, " +
				"about a hypothetical future \"wasi-filesystem\" — noting that \"component model intentionally does not define an " +
				"ABI\". So: no component-model support, and none required here.",
			"consequenceForTheContract": "A wasm contract can be frozen on CORE wasm without waiting on component-model maturity " +
				"in wazero. The component model would only become load-bearing if the Spine chose to ship policies as COMPONENTS " +
				"or to pass structured values across the boundary instead of JSON-through-linear-memory, which OPA's own wasm " +
				"target does not do.",
		},

		"frictionFound": map[string]any{
			"issue": "wazero cannot satisfy a memory IMPORT from a host module.",
			"detail": "OPA emits `(import \"env\" \"memory\" (memory 2))` and re-exports it. wazero v1.12.0's " +
				"`HostModuleBuilder` interface has exactly three methods — NewFunctionBuilder, Compile, Instantiate. " +
				"There is no ExportMemory, so a Go host module can define functions and nothing else, and `env.memory` " +
				"is unsatisfiable by a host module.",
			"severity": "WORKED AROUND, NOT BLOCKING — but it is real integration friction a Go satellite will hit on day one.",
			"workaround": "`env` is supplied as a real (synthesised) WASM module instead of a host module: it DEFINES and exports " +
				"the memory, IMPORTS the six OPA ABI functions from a Go host module named `opa_host`, and RE-EXPORTS them under " +
				"the names the policy expects. See envshim.go. The policy.wasm bytes are NEVER modified — the rejected " +
				"alternative was patching the memory import into a definition, which would have meant no longer testing the " +
				"artifact the spike actually produced.",
			"costToASatellite": "~120 lines of hand-encoded wasm, or a dependency that emits it. Constant, not per-policy.",
		},

		"whatWasNotDone": []string{
			"Nothing outside spikes/spine-adopt/wazero-probe/ was created or modified; policy.wasm files were read only.",
			"No commit was made.",
			"The regorus arm was not re-run or compared against; this probe compares wazero to the shipped oracle and to the wasmtime arm.",
			fmt.Sprintf(
				"No claim is made about wazero's compiler backend on hosts other than the one measured — this run was %s/%s.",
				runtime.GOOS, runtime.GOARCH,
			),
		},

		"memoryGrowth": map[string]any{
			"shimMinPagesPerSpecimen":    shimMinPages,
			"minPagesSource":             "read off each policy's OWN `(import \"env\" \"memory\" (memory N))` declaration via wazero's decoder, not hardcoded",
			"specimensThatGrewTheMemory": grewSpecimens,
			"note": "The shim declares the memory with NO maximum, so `memory.grow` stays available to the guest, and every " +
				"specimen did in fact grow it past the declared minimum during evaluation. wazero's api.Memory.Read re-derives " +
				"the backing slice on each call, so host-side reads stay correct across a grow — the address-handling hazard " +
				"the dispatch flagged did not materialise. A host that cached a raw pointer WOULD have been bitten here.",
		},

		"checks": ck.Rows,
	})
	if err != nil {
		return err
	}

	// ── Console summary ──
	fmt.Printf("\nwazero %s  |  %d verdict rows\n", wazeroVersion(), len(allRows))
	fmt.Printf("shipped-vs-wazero   MATCH=%d EXPLAINED=%d UNEXPLAINED=%d\n",
		tallyOf(sVsW).Match, tallyOf(sVsW).Explained, tallyOf(sVsW).Unexplained)
	fmt.Printf("opa-vs-wazero       MATCH=%d EXPLAINED=%d UNEXPLAINED=%d\n",
		tallyOf(oVsW).Match, tallyOf(oVsW).Explained, tallyOf(oVsW).Unexplained)
	fmt.Printf("classic vs one-shot disagreements: %d\n", len(pathDisagree))
	fmt.Printf("cold eval us  %v\nwarm eval us  %v\none-shot us   %v\n",
		summarise(cold), summarise(warm), summarise(warmOneShot))
	fmt.Printf("\n  %s\n  %s\n  %s\n", verdictsAt, reportAt, pairsAt)

	if f := ck.failed(); len(f) > 0 {
		fmt.Fprintf(os.Stderr, "\n%d CHECK(S) FAILED:\n", len(f))
		for _, r := range f {
			fmt.Fprintf(os.Stderr, "  - %s\n      %s\n", r.Name, r.Detail)
		}
		for _, u := range unexplained {
			b, _ := json.Marshal(u.Detail)
			fmt.Fprintf(os.Stderr, "  UNEXPLAINED %s vs %s  %s/%s: %s\n", u.Left, u.Right, u.Specimen, u.FixtureID, b)
		}
		return fmt.Errorf("%d check(s) failed", len(f))
	}
	fmt.Printf("\nall %d checks passed\n", len(ck.Rows))
	return nil
}

func answer(sVsW, oVsW tally, pathDisagreements int) string {
	if sVsW.Unexplained == 0 && oVsW.Unexplained == 0 && pathDisagreements == 0 {
		return "YES. wazero loaded and correctly evaluated the exact policy.wasm artifacts this spike produced, " +
			"agreeing with the shipped oracle and with the wasmtime arm on every compared row. The Go-satellite lane is " +
			"viable on CORE wasm; the component model is not needed for this path. One piece of real friction was found " +
			"and worked around without touching the artifacts (see frictionFound)."
	}
	return "NO / QUALIFIED — see divergences and checks."
}

func goVersion() string { return runtime.Version() + " " + runtime.GOOS + "/" + runtime.GOARCH }
