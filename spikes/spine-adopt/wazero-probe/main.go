// Command wazero-probe answers one question empirically: can wazero — the pure-Go
// wasm runtime a Go satellite would have to use — load and CORRECTLY EVALUATE the
// exact `policy.wasm` artifacts this spike already produced?
//
// It is a maturity check taken BEFORE any wasm contract freezes. The Go-satellite
// lane is only viable if the answer is yes on core wasm, so the probe also records
// whether anything here needed the component model.
//
// Nothing under `policy.wasm` is modified. The probe drives the OPA wasm ABI by
// hand (there is no OPA SDK for wazero), runs BOTH the classic eval-context
// sequence and the ABI 1.2+ one-shot `opa_eval` path, cross-checks them against
// each other, and then compares the resulting verdicts against the shipped
// oracle and against the wasmtime arm using `src/compare.mts`'s own semantics.
//
// Run: go run . [-spike-root ..]
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

const (
	// warmReps is the batch size for a warm eval measurement. Larger than the
	// wasmtime arm's 50 because the batch total has to clear this host's ~500us
	// clock granularity by a wide margin.
	warmReps = 200
	// coldReps is how many FRESH instances are built (and pre-built, so the timer
	// covers evaluation only) to measure a first-eval-on-a-new-instance cost.
	coldReps = 25
)

// clockGranularityMicros measures the smallest non-zero interval this host's
// monotonic clock can report, so the timing section can be read with the right
// scepticism instead of being taken at face value.
func clockGranularityMicros() float64 {
	best := time.Duration(1<<62 - 1)
	for i := 0; i < 1000; i++ {
		t := time.Now()
		var d time.Duration
		for d == 0 {
			d = time.Since(t)
		}
		if d < best {
			best = d
		}
	}
	return float64(best.Nanoseconds()) / 1000.0
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

// loweredRecord is one row of `artifacts/lowering-rejects.json.lowered[]`.
//
// Every naming field here is READ from that artifact, never re-derived: the
// package/entrypoint suffix rule is the TS lowering's to state (the twinned seed
// rules take a `_<language>` suffix while single-record rules do not), and a Go
// copy of that rule would be a second source of truth that drifts silently.
//
// The artifact carries additive fields this arm does not model (`seedEntry` is
// modelled; `manifestSha256`, `patterns`, `globCount` are not). encoding/json
// ignores unknown fields by default and this struct deliberately keeps it that
// way — no DisallowUnknownFields — so a later additive field cannot break the
// Go arm.
type loweredRecord struct {
	Specimen   string `json:"specimen"`
	SeedEntry  string `json:"seedEntry"`
	RuleID     string `json:"ruleId"`
	Package    string `json:"package"`
	Entrypoint string `json:"entrypoint"`
	Engine     string `json:"engine"`
	Dir        string `json:"dir"`
}

type astMatch struct {
	LineNumber int64 `json:"lineNumber"`
}

type factFile struct {
	FileName   string          `json:"-"`
	FixtureID  string          `json:"fixtureId"`
	Specimen   string          `json:"specimen"`
	RuleID     string          `json:"ruleId"`
	Engine     string          `json:"engine"`
	FactBundle json.RawMessage `json:"factBundle"`

	astMatches []astMatch
}

func readJSON(path string, into any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		return fmt.Errorf("parsing %s: %w", path, err)
	}
	return nil
}

func loadLowering(root string) ([]loweredRecord, error) {
	var doc struct {
		Lowered []loweredRecord `json:"lowered"`
	}
	at := filepath.Join(root, "artifacts", "lowering-rejects.json")
	if err := readJSON(at, &doc); err != nil {
		return nil, err
	}
	if len(doc.Lowered) == 0 {
		return nil, fmt.Errorf("%s lowered no records — run `npm run lower` first", at)
	}
	return doc.Lowered, nil
}

func loadFacts(root string) ([]factFile, error) {
	dir := filepath.Join(root, "artifacts", "facts")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	var out []factFile
	for _, n := range names {
		var f factFile
		if err := readJSON(filepath.Join(dir, n), &f); err != nil {
			return nil, err
		}
		f.FileName = n
		var bundle struct {
			AstMatches []astMatch `json:"astMatches"`
		}
		if err := json.Unmarshal(f.FactBundle, &bundle); err != nil {
			return nil, fmt.Errorf("parsing factBundle of %s: %w", n, err)
		}
		f.astMatches = bundle.AstMatches
		out = append(out, f)
	}
	return out, nil
}

// joinsTo is the join PREDICATE: a fact bundle belongs to a lowered record when
// the PAIR (ruleId, specimen) agrees — never ruleId alone.
//
// A ruleId-only join is unsound in BOTH record sets. On `specimens` three records
// share the pinned exemplar id `0123456789abcdef`, so it would fan one fixture
// across d-line, d-file and e. On `seed20` the two TWINNED rules carry a single
// lessonHash across two records that differ only in `specimen` (the `-js` sibling)
// and in the `_<language>` package suffix, so it would fan each twin's fixtures
// across both languages and score the JavaScript record against the TypeScript
// record's bundles.
func joinsTo(rec loweredRecord, f factFile) bool {
	return f.RuleID == rec.RuleID && f.Specimen == rec.Specimen
}

// joinIsSound re-checks a joined pair against the bundle's OWN declared identity,
// so a corpus whose filenames and field values disagree is caught rather than
// scored.
//
// The filename prefix is built from the BUNDLE's declared (ruleId, specimen)
// rather than the record's, and the specimen is compared EXACTLY. Building it
// from the record and testing only `strings.HasPrefix` is unsound on a twinned
// rule: `6b1890e2…-empty-string-in-whitelist-` is a prefix of
// `6b1890e2…-empty-string-in-whitelist-js-inline-bad.json`, so the TypeScript
// record's guard would wave through the JavaScript record's bundle. The exact
// specimen comparison is what makes the key the pair.
func joinIsSound(rec loweredRecord, f factFile) error {
	if f.RuleID != rec.RuleID {
		return fmt.Errorf("join defect: bundle %s claims ruleId %s but record %s carries %s",
			f.FileName, f.RuleID, rec.Specimen, rec.RuleID)
	}
	if f.Specimen != rec.Specimen {
		return fmt.Errorf("join defect: bundle %s claims specimen %s but was joined to record %s (ruleId %s) — "+
			"the join key is the PAIR (ruleId, specimen), and these records share a ruleId",
			f.FileName, f.Specimen, rec.Specimen, rec.RuleID)
	}
	if f.Engine != rec.Engine {
		return fmt.Errorf("join defect: bundle %s claims engine %s but record %s lowered as %s",
			f.FileName, f.Engine, rec.Specimen, rec.Engine)
	}
	if want := f.RuleID + "-" + f.Specimen + "-"; !strings.HasPrefix(f.FileName, want) {
		return fmt.Errorf("join defect: bundle %s does not carry the `%s` filename prefix its own ruleId/specimen fields declare",
			f.FileName, want)
	}
	return nil
}

// expectedRowCount DERIVES the per-arm verdict-row cardinality from the run's own
// inputs. It is never a literal: the seven-specimen set has 24 bundles and the
// seed20 set has a different number, and a hardcoded count would either fail the
// trial set outright or, worse, pass it while a whole record's rows were missing.
//
// The index and the directory are cross-checked against each other, because the
// number is only worth what its source is worth: an index that disagrees with the
// corpus it indexes cannot ground a cardinality assertion, so that disagreement
// stops the run rather than picking a winner.
func expectedRowCount(root string, facts []factFile) (int, error) {
	var idx struct {
		BundleCount int `json:"bundleCount"`
	}
	at := filepath.Join(root, "artifacts", "facts-index.json")
	if err := readJSON(at, &idx); err != nil {
		return 0, err
	}
	if idx.BundleCount != len(facts) {
		return 0, fmt.Errorf("%s declares bundleCount %d but artifacts/facts holds %d bundle files — "+
			"the fact corpus and its own index disagree, so no row cardinality can be derived from them",
			at, idx.BundleCount, len(facts))
	}
	if idx.BundleCount == 0 {
		return 0, fmt.Errorf("%s declares no bundles — run `npm run facts` first", at)
	}
	return idx.BundleCount, nil
}

// ─── Verdict extraction ──────────────────────────────────────────────────────

// entrypointValue unwraps the `[{"result": <value>}]` result SET.
//
// STRICTNESS (mirroring the wasmtime arm): an EMPTY array means the entrypoint's
// `result` rule was UNDEFINED — for these policies that means `patterns_compile`
// or `facts_wellformed` failed. That is an error condition, never "no violations".
func entrypointValue(raw json.RawMessage) (json.RawMessage, error) {
	var set []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &set); err != nil {
		return nil, fmt.Errorf("entrypoint returned a non-array result set: %s", raw)
	}
	switch len(set) {
	case 0:
		return nil, fmt.Errorf("EMPTY RESULT SET — the entrypoint's `result` rule was UNDEFINED. " +
			"For these policies that means `patterns_compile` or `facts_wellformed` failed; it is NEVER a zero-violation verdict")
	case 1:
		v, ok := set[0]["result"]
		if !ok {
			return nil, fmt.Errorf("result set entry has no `result` key: %s", raw)
		}
		return v, nil
	default:
		return nil, fmt.Errorf("entrypoint returned %d result-set entries; exactly one was expected: %s", len(set), raw)
	}
}

// canonicalArray sorts an array by each element's canonical JSON serialisation,
// so a set Rego emitted in arbitrary order lands stably in the artifact. Go's
// encoding/json sorts object keys, so the serialisation is canonical the same way
// serde_json's BTreeMap-backed Value is on the wasmtime arm.
func canonicalArray(raw json.RawMessage) ([]json.RawMessage, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	type kv struct {
		key string
		val json.RawMessage
	}
	pairs := make([]kv, 0, len(items))
	for _, it := range items {
		var v any
		if err := json.Unmarshal(it, &v); err != nil {
			return nil, err
		}
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		pairs = append(pairs, kv{string(b), json.RawMessage(b)})
	}
	sort.SliceStable(pairs, func(i, j int) bool { return pairs[i].key < pairs[j].key })
	out := make([]json.RawMessage, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, p.val)
	}
	return out, nil
}

type verdict struct {
	Violations []json.RawMessage
	Events     []json.RawMessage
}

// readResult reads `result = {violations, events}`, FAILING LOUD on anything
// else. A missing key is an error, never an empty list: "absent = absent".
func readResult(v json.RawMessage) (*verdict, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(v, &obj); err != nil {
		return nil, fmt.Errorf("entrypoint result is not an object: %s", v)
	}
	out := &verdict{}
	for _, k := range []string{"violations", "events"} {
		raw, ok := obj[k]
		if !ok {
			return nil, fmt.Errorf("entrypoint result is missing `%s`: %s", k, v)
		}
		arr, err := canonicalArray(raw)
		if err != nil {
			return nil, fmt.Errorf("entrypoint result `%s` is not an array: %s", k, v)
		}
		if k == "violations" {
			out.Violations = arr
		} else {
			out.Events = arr
		}
	}
	return out, nil
}

// verdictRow is the artifact row shape, identical to the wasmtime arm's.
type verdictRow struct {
	RuleID     string            `json:"ruleId"`
	FixtureID  string            `json:"fixtureId"`
	Arm        string            `json:"arm"`
	Fired      *bool             `json:"fired"`
	MatchCount *int              `json:"matchCount"`
	Violations []json.RawMessage `json:"violations"`
	Events     []json.RawMessage `json:"events"`
	Specimen   string            `json:"specimen"`
	Engine     string            `json:"engine"`
	Error      *string           `json:"error"`
}

func okRow(rec loweredRecord, f factFile, v *verdict) verdictRow {
	fired := len(v.Violations) > 0
	n := len(v.Violations)
	return verdictRow{
		RuleID: rec.RuleID, FixtureID: f.FixtureID, Arm: "wazero",
		Fired: &fired, MatchCount: &n,
		Violations: v.Violations, Events: v.Events,
		Specimen: rec.Specimen, Engine: rec.Engine, Error: nil,
	}
}

func errRow(rec loweredRecord, f factFile, err error) verdictRow {
	msg := err.Error()
	return verdictRow{
		RuleID: rec.RuleID, FixtureID: f.FixtureID, Arm: "wazero",
		Fired: nil, MatchCount: nil, Violations: nil, Events: nil,
		Specimen: rec.Specimen, Engine: rec.Engine, Error: &msg,
	}
}

// ─── Host module ─────────────────────────────────────────────────────────────

type abortError struct{ msg string }

func (e abortError) Error() string { return "opa_abort: " + e.msg }

func memOf(in *instance, m api.Module) api.Memory {
	if in.mem != nil {
		return in.mem
	}
	return m.Memory()
}

// buildHostModule defines the six Go implementations the `env` shim relays.
//
// The five `opa_builtin*` stubs PANIC. The ABI census says they are never called
// for these seven policies (zero host-implemented builtins), and the probe's own
// reading of each module's `builtins` export re-measures that. A stub that
// returned a plausible value instead would let a silently-delegated builtin pass
// as a verdict, which is the one thing this arm must not do.
func buildHostModule(ctx context.Context, r wazero.Runtime, in *instance) (api.Module, error) {
	stub := func(n int) func(context.Context, api.Module, uint32, uint32, uint32, uint32, uint32, uint32) uint32 {
		return func(_ context.Context, _ api.Module, builtinID, _, _, _, _, _ uint32) uint32 {
			panic(fmt.Sprintf("opa_builtin%d was CALLED with builtin id %d — the ABI census says these "+
				"policies delegate NO builtin to the host, so this is either a stale census or a policy "+
				"outside the surveyed set. Refusing to fabricate a return value.", n, builtinID))
		}
	}
	b := r.NewHostModuleBuilder(hostModuleName)

	b.NewFunctionBuilder().
		WithFunc(func(_ context.Context, m api.Module, addr uint32) {
			msg, err := readCStringFrom(memOf(in, m), addr)
			if err != nil {
				msg = fmt.Sprintf("<unreadable abort message at %d: %v>", addr, err)
			}
			in.abortMsg = msg
			panic(abortError{msg})
		}).
		WithParameterNames("addr").Export("opa_abort")

	// Each opa_builtinN takes (builtin_id, ctx, arg...) and returns an opa_value
	// address. The arities are the ones wazero's own decoder read off the modules.
	arities := []int{2, 3, 4, 5, 6}
	for i, arity := range arities {
		s := stub(i)
		fb := b.NewFunctionBuilder()
		switch arity {
		case 2:
			fb = fb.WithFunc(func(c context.Context, m api.Module, a, bb uint32) uint32 { return s(c, m, a, bb, 0, 0, 0, 0) })
		case 3:
			fb = fb.WithFunc(func(c context.Context, m api.Module, a, bb, cc uint32) uint32 { return s(c, m, a, bb, cc, 0, 0, 0) })
		case 4:
			fb = fb.WithFunc(func(c context.Context, m api.Module, a, bb, cc, dd uint32) uint32 {
				return s(c, m, a, bb, cc, dd, 0, 0)
			})
		case 5:
			fb = fb.WithFunc(func(c context.Context, m api.Module, a, bb, cc, dd, ee uint32) uint32 {
				return s(c, m, a, bb, cc, dd, ee, 0)
			})
		case 6:
			fb = fb.WithFunc(func(c context.Context, m api.Module, a, bb, cc, dd, ee, ff uint32) uint32 {
				return s(c, m, a, bb, cc, dd, ee, ff)
			})
		}
		fb.Export(fmt.Sprintf("opa_builtin%d", i))
	}

	return b.Instantiate(ctx)
}

func readCStringFrom(mem api.Memory, addr uint32) (string, error) {
	tmp := &instance{mem: mem}
	return tmp.readCString(addr)
}

// ─── Per-specimen run ────────────────────────────────────────────────────────

type abiRow struct {
	Specimen         string         `json:"specimen"`
	WasmSha256       string         `json:"wasmSha256"`
	WasmBytes        int            `json:"wasmBytes"`
	ImportedFuncs    []string       `json:"importedFunctions"`
	ImportedMemories []string       `json:"importedMemories"`
	Exports          []string       `json:"exports"`
	Entrypoints      map[string]int `json:"entrypoints"`
	RequiredBuiltins map[string]int `json:"requiredBuiltinsPerModuleBuiltinsExport"`
	EntrypointUsed   string         `json:"entrypointUsed"`
	EntrypointID     int            `json:"entrypointId"`
	ShimMemoryMin    uint32         `json:"shimMemoryMinPages"`
	MemoryPagesAfter uint32         `json:"memoryPagesAfterEval"`
}

// timingRow reports BATCH means rather than per-call minima.
//
// The wasmtime arm reported a min over 50 individually-timed reps. That is not
// reproducible here: Go's monotonic clock on this host has ~500us granularity
// (measured at startup and recorded as `clockGranularityMicros`), while a single
// eval costs a few hundred microseconds — so every individual reading quantises
// to 0 or ~508. Timing a WHOLE BATCH and dividing pushes the measurement two
// orders of magnitude above the granularity, which is the only honest way to get
// a per-eval number off this clock. Reporting the quantised per-call minimum
// would have been reporting clock noise as data.
type timingRow struct {
	Specimen              string  `json:"specimen"`
	FixtureID             string  `json:"fixtureId"`
	CompileMicros         int64   `json:"compileMicros"`
	InstantiateMicros     int64   `json:"instantiateMicros"`
	ColdEvalMicrosMean    float64 `json:"coldEvalMicrosMean"`
	ColdReps              int     `json:"coldReps"`
	WarmEvalMicrosMean    float64 `json:"warmEvalMicrosMean"`
	WarmOneShotEvalMicros float64 `json:"warmOneShotEvalMicrosMean"`
	WarmReps              int     `json:"warmReps"`
}

type pathCheck struct {
	FixtureID string `json:"fixtureId"`
	Specimen  string `json:"specimen"`
	Agree     bool   `json:"classicAndOneShotAgree"`
	Classic   string `json:"classic,omitempty"`
	OneShot   string `json:"oneShot,omitempty"`
}

func sigOf(d api.FunctionDefinition) string {
	p := make([]string, 0, len(d.ParamTypes()))
	for _, t := range d.ParamTypes() {
		p = append(p, api.ValueTypeName(t))
	}
	res := make([]string, 0, len(d.ResultTypes()))
	for _, t := range d.ResultTypes() {
		res = append(res, api.ValueTypeName(t))
	}
	return "(" + strings.Join(p, ",") + ")->(" + strings.Join(res, ",") + ")"
}

type specimenResult struct {
	abi     abiRow
	rows    []verdictRow
	timings []timingRow
	paths   []pathCheck
}

// loadedPolicy is one fully-linked policy: its own runtime, the shim-provided
// memory, and the resolved ABI, ready to evaluate.
//
// The linkage is:
//
//	Go host module `opa_host` (the six ABI functions)
//	  <- synthesised wasm module `env` (DEFINES + exports the memory, re-exports the six)
//	    <- policy.wasm, byte-for-byte untouched
type loadedPolicy struct {
	rt       wazero.Runtime
	compiled wazero.CompiledModule
	in       *instance
	minPages uint32
}

func (p *loadedPolicy) Close(ctx context.Context) { _ = p.rt.Close(ctx) }

// loadPolicy compiles and links one policy.wasm, returning compile and
// instantiate timings alongside it. The compilation cache is shared across calls
// so that building many fresh instances for a cold-eval measurement does not pay
// the ~65ms compile each time.
func loadPolicy(ctx context.Context, cache wazero.CompilationCache, wasmBytes []byte) (*loadedPolicy, int64, int64, error) {
	r := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithCompilationCache(cache))
	fail := func(err error) (*loadedPolicy, int64, int64, error) {
		_ = r.Close(ctx)
		return nil, 0, 0, err
	}

	tCompile := time.Now()
	compiled, err := r.CompileModule(ctx, wasmBytes)
	if err != nil {
		return fail(fmt.Errorf("compiling under wazero: %w", err))
	}
	compileMicros := time.Since(tCompile).Microseconds()

	// The memory the policy demands, read off its own import declaration rather
	// than hardcoded, so the shim adapts if OPA ever changes the minimum.
	var minPages uint32 = 2
	for _, d := range compiled.ImportedMemories() {
		minPages = d.Min()
	}

	in := &instance{}
	tInst := time.Now()
	if _, err := buildHostModule(ctx, r, in); err != nil {
		return fail(fmt.Errorf("instantiating the Go host module: %w", err))
	}
	shimBytes := buildEnvShim(minPages)
	shimCompiled, err := r.CompileModule(ctx, shimBytes)
	if err != nil {
		return fail(fmt.Errorf("compiling the synthesised `env` shim (%d bytes): %w", len(shimBytes), err))
	}
	shim, err := r.InstantiateModule(ctx, shimCompiled, wazero.NewModuleConfig().WithName("env"))
	if err != nil {
		return fail(fmt.Errorf("instantiating the `env` shim: %w", err))
	}
	in.mem = shim.Memory()
	if in.mem == nil {
		return fail(fmt.Errorf("the `env` shim exported no memory"))
	}
	mod, err := r.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName("policy"))
	if err != nil {
		return fail(fmt.Errorf("instantiating the policy: %w", err))
	}
	in.mod = mod
	if err := in.setup(ctx); err != nil {
		return fail(fmt.Errorf("ABI setup: %w", err))
	}
	return &loadedPolicy{rt: r, compiled: compiled, in: in, minPages: minPages},
		compileMicros, time.Since(tInst).Microseconds(), nil
}

// policyWasmPath resolves a record's built module from the `dir` the lowering
// artifact declares. The directory is READ, never re-derived from the ruleId: the
// package-suffix rule that names it (the `_<language>` twins, the `_<specimen>`
// exemplar siblings) belongs to the TS lowering.
func policyWasmPath(root string, rec loweredRecord) string {
	dir := filepath.Join(append([]string{root}, strings.Split(rec.Dir, "/")...)...)
	return filepath.Join(dir, "policy.wasm")
}

func runSpecimen(ctx context.Context, root string, cache wazero.CompilationCache, rec loweredRecord, facts []factFile) (*specimenResult, error) {
	wasmPath := policyWasmPath(root, rec)
	wasmBytes, err := os.ReadFile(wasmPath)
	if err != nil {
		return nil, fmt.Errorf("reading %s — run `npm run lower && npm run build-wasm` first: %w", wasmPath, err)
	}

	p, compileMicros, instantiateMicros, err := loadPolicy(ctx, cache, wasmBytes)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", wasmPath, err)
	}
	defer p.Close(ctx)
	in, compiled, minPages := p.in, p.compiled, p.minPages

	// The import/export surface, read by wazero's OWN decoder rather than taken
	// from the census the wasmtime arm produced.
	var importedFuncs, importedMems, exports []string
	for _, d := range compiled.ImportedFunctions() {
		m, n, _ := d.Import()
		importedFuncs = append(importedFuncs, fmt.Sprintf("%s.%s:%s", m, n, sigOf(d)))
	}
	sort.Strings(importedFuncs)
	for _, d := range compiled.ImportedMemories() {
		m, n, _ := d.Import()
		max, hasMax := d.Max()
		importedMems = append(importedMems, fmt.Sprintf("%s.%s:memory{min=%d,max=%d,hasMax=%v}", m, n, d.Min(), max, hasMax))
	}
	sort.Strings(importedMems)
	for name, d := range compiled.ExportedFunctions() {
		exports = append(exports, fmt.Sprintf("%s:%s", name, sigOf(d)))
	}
	for name := range compiled.ExportedMemories() {
		exports = append(exports, "memory:"+name+"{memory}")
	}
	sort.Strings(exports)

	eps, err := in.entrypointIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading entrypoints for %s: %w", rec.Specimen, err)
	}
	epID, ok := eps[rec.Entrypoint]
	if !ok {
		return nil, fmt.Errorf("module %s has no entrypoint %q (has %v)", rec.Specimen, rec.Entrypoint, eps)
	}
	builtins, err := in.requiredBuiltins(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading builtins for %s: %w", rec.Specimen, err)
	}

	res := &specimenResult{
		abi: abiRow{
			Specimen: rec.Specimen, WasmBytes: len(wasmBytes), WasmSha256: sha256hex(wasmBytes),
			ImportedFuncs: importedFuncs, ImportedMemories: importedMems, Exports: exports,
			Entrypoints: eps, RequiredBuiltins: builtins,
			EntrypointUsed: rec.Entrypoint, EntrypointID: epID, ShimMemoryMin: minPages,
		},
	}

	for _, f := range facts {
		if !joinsTo(rec, f) {
			continue
		}
		if err := joinIsSound(rec, f); err != nil {
			return nil, err
		}
		input := []byte(f.FactBundle)

		classicText, evalErr := in.evalClassic(ctx, epID, input)

		var v *verdict
		if evalErr == nil {
			var val json.RawMessage
			val, evalErr = entrypointValue(json.RawMessage(classicText))
			if evalErr == nil {
				v, evalErr = readResult(val)
			}
		}

		tr := timingRow{
			Specimen: rec.Specimen, FixtureID: f.FixtureID,
			CompileMicros: compileMicros, InstantiateMicros: instantiateMicros,
			WarmReps: warmReps, ColdReps: coldReps,
		}

		if evalErr != nil {
			res.rows = append(res.rows, errRow(rec, f, evalErr))
			res.timings = append(res.timings, tr)
			continue
		}

		// ── Cross-check: the one-shot fast path must agree with the classic one ──
		oneShotText, osErr := in.evalOneShot(ctx, epID, input)
		pc := pathCheck{FixtureID: f.FixtureID, Specimen: rec.Specimen}
		if osErr != nil {
			pc.Agree = false
			pc.Classic = classicText
			pc.OneShot = "ERROR: " + osErr.Error()
		} else {
			agree, cn, on := jsonEqual(classicText, oneShotText)
			pc.Agree = agree
			if !agree {
				pc.Classic, pc.OneShot = cn, on
			}
		}
		res.paths = append(res.paths, pc)

		// ── Warm timings: one timer around the WHOLE batch (see timingRow) ──
		tWarm := time.Now()
		for i := 0; i < warmReps; i++ {
			if _, err := in.evalClassic(ctx, epID, input); err != nil {
				return nil, fmt.Errorf("warm re-evaluation of %s diverged from the cold one by failing: %w", f.FixtureID, err)
			}
		}
		tr.WarmEvalMicrosMean = perOp(time.Since(tWarm), warmReps)

		if osErr == nil {
			tOne := time.Now()
			for i := 0; i < warmReps; i++ {
				if _, err := in.evalOneShot(ctx, epID, input); err != nil {
					return nil, fmt.Errorf("warm one-shot re-evaluation of %s failed: %w", f.FixtureID, err)
				}
			}
			tr.WarmOneShotEvalMicros = perOp(time.Since(tOne), warmReps)
		}

		// ── Cold timing: coldReps FRESH instances, all built BEFORE the timer
		// starts, so the measurement covers first-eval-on-a-new-instance only and
		// not instantiation. ──
		cold, err := coldEvalMicros(ctx, cache, wasmBytes, epID, input)
		if err != nil {
			return nil, fmt.Errorf("cold-eval measurement for %s: %w", f.FixtureID, err)
		}
		tr.ColdEvalMicrosMean = cold

		res.rows = append(res.rows, okRow(rec, f, v))
		res.timings = append(res.timings, tr)
	}

	res.abi.MemoryPagesAfter = in.mem.Size() / 65536
	return res, nil
}

// perOp converts a batch duration into microseconds per operation, keeping the
// sub-microsecond precision the batch bought.
func perOp(d time.Duration, n int) float64 {
	return float64(d.Nanoseconds()) / float64(n) / 1000.0
}

// coldEvalMicros measures a FIRST eval on a freshly instantiated module.
//
// A single cold eval is far below this host's clock granularity, so instead of
// timing one, coldReps complete instances are built up front and the timer is
// wrapped around the batch of their first evaluations. Building them first is
// what keeps instantiation out of the number.
func coldEvalMicros(ctx context.Context, cache wazero.CompilationCache, wasmBytes []byte, epID int, input []byte) (float64, error) {
	instances := make([]*loadedPolicy, 0, coldReps)
	defer func() {
		for _, p := range instances {
			p.Close(ctx)
		}
	}()
	for i := 0; i < coldReps; i++ {
		p, _, _, err := loadPolicy(ctx, cache, wasmBytes)
		if err != nil {
			return 0, err
		}
		instances = append(instances, p)
	}

	t := time.Now()
	for _, p := range instances {
		if _, err := p.in.evalClassic(ctx, epID, input); err != nil {
			return 0, err
		}
	}
	return perOp(time.Since(t), len(instances)), nil
}

// jsonEqual compares two JSON texts structurally, returning normalised forms when
// they differ.
func jsonEqual(a, b string) (bool, string, string) {
	var va, vb any
	if err := json.Unmarshal([]byte(a), &va); err != nil {
		return false, a, b
	}
	if err := json.Unmarshal([]byte(b), &vb); err != nil {
		return false, a, b
	}
	na, _ := json.Marshal(va)
	nb, _ := json.Marshal(vb)
	return string(na) == string(nb), string(na), string(nb)
}

func main() {
	root := flag.String("spike-root", "..", "path to spikes/spine-adopt")
	conformance := flag.String("conformance", "",
		"run the certification conformance mode against this case spec instead of the full probe (spec § Actuator slice 5)")
	conformanceOut := flag.String("conformance-out", "artifacts/wazero-conformance.json",
		"where -conformance writes its rows")
	flag.Parse()
	// Conformance mode is a DIFFERENT question on DIFFERENT bundles (hand-authored
	// fixtures that are in neither the lowering index nor the fact corpus), so it
	// replaces the normal run rather than extending it. `go run .` with no flags is
	// byte-for-byte the run it always was.
	if *conformance != "" {
		if err := runConformance(*root, *conformance, *conformanceOut); err != nil {
			fmt.Fprintf(os.Stderr, "\nFATAL: %v\n", err)
			os.Exit(1)
		}
		return
	}
	if err := run(*root); err != nil {
		fmt.Fprintf(os.Stderr, "\nFATAL: %v\n", err)
		os.Exit(1)
	}
}

func wazeroVersion() string {
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, d := range bi.Deps {
			if d.Path == "github.com/tetratelabs/wazero" {
				return d.Version
			}
		}
	}
	return "unknown (read go.mod)"
}
