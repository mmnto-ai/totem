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
			// Violation's `line` is the matched TEXT).
			evs = append(evs, event{Kind: e.Kind, Line: e.Line})
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
		if r.Error != nil {
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
		if r.Error == nil {
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

func writeArtifact(dir, name string, v any) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", err
	}
	at := filepath.Join(dir, name)
	if err := os.WriteFile(at, append(b, '\n'), 0o644); err != nil {
		return "", err
	}
	return at, nil
}

// requiredSubset is the pair set the dispatch names explicitly: specimen-a and
// specimen-d-file. Everything else this probe evaluates is a superset, reported
// separately so the named rows are not lost in the aggregate.
func isRequired(specimen string) bool {
	return specimen == "a" || specimen == "d-file"
}

func run(root string) error {
	ctx := context.Background()
	ck := &checks{}
	selfTest(ck)

	records, err := loadLowering(root)
	if err != nil {
		return err
	}
	facts, err := loadFacts(root)
	if err != nil {
		return err
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
	defer cache.Close(ctx)

	for _, rec := range records {
		res, err := runSpecimen(ctx, root, cache, rec, facts)
		if err != nil {
			// A wazero incompatibility IS the finding this probe exists to catch,
			// so it is reported at the exact point it happened rather than papered
			// over with a fabricated verdict.
			return fmt.Errorf("specimen %s (%s): %w", rec.Specimen, rec.RuleID, err)
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
	if err := readJSON(filepath.Join(root, "artifacts", "shipped-verdicts.json"), &shippedDoc); err != nil {
		return err
	}
	var opaDoc struct {
		VerdictRows []regoRow `json:"verdictRows"`
		Host        struct {
			Crate   string `json:"crate"`
			Runtime string `json:"runtime"`
		} `json:"host"`
	}
	if err := readJSON(filepath.Join(root, "artifacts", "opa-verdicts.json"), &opaDoc); err != nil {
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

	ck.eq("shipped arm produced 24 verdict rows", len(shipped), 24)
	ck.eq("opa (wasmtime) arm produced 24 verdict rows", len(opa), 24)
	ck.eq("wazero arm produced 24 verdict rows", len(waz), 24)

	index := func(rows []normalRow) map[string]normalRow {
		m := map[string]normalRow{}
		for _, r := range rows {
			m[r.RuleID+"|"+r.FixtureID] = r
		}
		return m
	}
	S, O, W := index(shipped), index(opa), index(waz)
	ck.eq("the join key (ruleId, fixtureId) is unique on every arm",
		[]int{len(S), len(O), len(W)}, []int{24, 24, 24})

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
	ck.check("the corpus is DISCRIMINATING — the shipped arm both fires and stays silent, and at least one row is multi-violation",
		firedN > 0 && silentN > 0 && maxCount > 1,
		fmt.Sprintf("%d fired / %d silent / max matchCount %d", firedN, silentN, maxCount))

	// ── Compare ──
	keys := make([]string, 0, len(S))
	for k := range S {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var pairs []pairResult
	for _, k := range keys {
		pairs = append(pairs, comparePair(S[k], W[k]))
		pairs = append(pairs, comparePair(O[k], W[k]))
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
	ck.eq("every fixture exercised BOTH ABI paths", len(allPaths), 24)

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
	outDir := filepath.Join(root, "wazero-probe", "artifacts")
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
		if isRequired(p.Specimen) {
			requiredPairs = append(requiredPairs, p)
		}
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
			"requiredSubset":     "specimen-a (61dcb058bd1df15d) + specimen-d-file (0123456789abcdef_d_file) — the rows the dispatch names explicitly",
			"requiredSubsetRows": len(requiredPairs),
		},
		"summary": map[string]any{
			"shipped-vs-wazero": tallyOf(sVsW),
			"opa-vs-wazero":     tallyOf(oVsW),
			"requiredSubset":    tallyOf(requiredPairs),
		},
		"divergences": map[string]any{
			"unexplained": unexplained,
			"explained":   explained,
			"note": "Verbatim. Empty arrays mean no divergence was found, not that none was looked for — the detector " +
				"is exercised against 8 synthetic mutants in `checks` before any real row is compared.",
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
			"No claim is made about wazero's compiler backend on non-amd64 hosts — this ran on windows/amd64 only.",
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
	fmt.Printf("\n  %s\n  %s\n", verdictsAt, reportAt)

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
