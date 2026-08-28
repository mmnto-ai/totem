// Conformance mode — the wazero arm of the ruled "every host retains the failure
// rule" clause (spec `.totem/specs/spine-spike.md` § Actuator slice 5).
//
// The probe's normal run answers "does wazero reproduce the differential's
// verdicts on the seven specimen bundles". This mode answers a narrower and
// sharper question: given an ARBITRARY wasm bundle and an arbitrary input —
// specifically, the hand-authored negative conformance fixtures whose patterns
// `opa build` accepted and RE2 cannot execute — does the Go runtime produce an
// ERROR ROW, or does it hand back a clean zero?
//
// It shares the probe's real machinery (`loadPolicy`, `evalClassic`, the panicking
// builtin stubs) rather than a simplified copy, so what it measures is the same
// host the enrichment probe measured — INCLUDING the failure rule: the unwrap is
// `entrypointValue` FOLLOWED BY `readResult`, both from main.go and both the same
// functions the normal differential run uses, so the empty-result-set AND the
// result-shape error rows ORIGINATE here, in Go, and are not verdicts the
// certifier reconstructed from a shape.
// Rows still carry the raw outcome alongside it (result set, its length), and
// `src/certify.mts` maps the host-produced error into the five typed reasons for
// all three hosts in one place.
//
// Run: go run . -conformance <spec.json> -conformance-out <rows.json>
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/tetratelabs/wazero"
)

// conformanceCase is one bundle+input to drive. `Entrypoints` may be empty, in
// which case EVERY entrypoint the module declares is evaluated — the ruled
// "evaluates EVERY emitted entrypoint" applied to this host too.
type conformanceCase struct {
	ID          string          `json:"id"`
	Wasm        string          `json:"wasm"`
	Entrypoints []string        `json:"entrypoints"`
	Input       json.RawMessage `json:"input"`
}

type conformanceSpec struct {
	Cases []conformanceCase `json:"cases"`
}

// conformanceEval is one (case, entrypoint) outcome. `Error` and `ResultSetLength`
// are pointers so that "errored" and "returned an empty set" stay distinguishable
// from each other and from "returned nothing because we never asked".
type conformanceEval struct {
	Entrypoint      string          `json:"entrypoint"`
	OK              bool            `json:"ok"`
	Error           *string         `json:"error"`
	ResultSet       json.RawMessage `json:"resultSet"`
	ResultSetLength *int            `json:"resultSetLength"`
	Result          json.RawMessage `json:"result"`
}

type conformanceRow struct {
	ID                  string            `json:"id"`
	Wasm                string            `json:"wasm"`
	WasmSha256          string            `json:"wasmSha256"`
	WasmBytes           int               `json:"wasmBytes"`
	Loaded              bool              `json:"loaded"`
	LoadError           *string           `json:"loadError"`
	DeclaredEntrypoints []string          `json:"declaredEntrypoints"`
	RequiredBuiltins    map[string]int    `json:"requiredBuiltins"`
	Evaluations         []conformanceEval `json:"evaluations"`
}

// evalGuarded runs one classic evaluation with a panic barrier.
//
// The probe's `opa_builtin*` stubs PANIC by design (they refuse to fabricate a
// return value for a builtin the census says is never called), and `opa_abort`
// panics with an abortError. In the normal run those panics are meant to abort
// the process — an unexpected host-builtin call there IS a stale census. Here a
// fixture that trips one is DATA: the failure rule under test is precisely
// "every host produces an error row", and a process that died would produce no
// row at all.
func evalGuarded(ctx context.Context, p *loadedPolicy, epID int, input []byte) (text string, err error) {
	defer func() {
		if r := recover(); r != nil {
			if ae, ok := r.(abortError); ok {
				err = ae
				return
			}
			err = fmt.Errorf("host panic during evaluation: %v", r)
		}
	}()
	return p.in.evalClassic(ctx, epID, input)
}

func runConformanceCase(ctx context.Context, cache wazero.CompilationCache, root string, c conformanceCase) conformanceRow {
	path := c.Wasm
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, filepath.FromSlash(c.Wasm))
	}
	row := conformanceRow{ID: c.ID, Wasm: filepath.ToSlash(path)}

	fail := func(err error) conformanceRow {
		msg := err.Error()
		row.LoadError = &msg
		return row
	}

	wasmBytes, err := os.ReadFile(path)
	if err != nil {
		return fail(fmt.Errorf("reading %s: %w", path, err))
	}
	row.WasmBytes = len(wasmBytes)
	row.WasmSha256 = sha256hex(wasmBytes)

	p, _, _, err := loadPolicy(ctx, cache, wasmBytes)
	if err != nil {
		return fail(fmt.Errorf("loading under wazero: %w", err))
	}
	defer p.Close(ctx)

	eps, err := p.in.entrypointIDs(ctx)
	if err != nil {
		return fail(fmt.Errorf("reading entrypoints: %w", err))
	}
	for name := range eps {
		row.DeclaredEntrypoints = append(row.DeclaredEntrypoints, name)
	}
	sort.Strings(row.DeclaredEntrypoints)
	if b, err := p.in.requiredBuiltins(ctx); err == nil {
		row.RequiredBuiltins = b
	}
	row.Loaded = true

	want := c.Entrypoints
	if len(want) == 0 {
		want = row.DeclaredEntrypoints
	}
	for _, ep := range want {
		e := conformanceEval{Entrypoint: ep}
		epID, ok := eps[ep]
		if !ok {
			msg := fmt.Sprintf("module declares no entrypoint %q (has %v)", ep, row.DeclaredEntrypoints)
			e.Error = &msg
			row.Evaluations = append(row.Evaluations, e)
			continue
		}
		text, err := evalGuarded(ctx, p, epID, []byte(c.Input))
		if err != nil {
			msg := err.Error()
			e.Error = &msg
			row.Evaluations = append(row.Evaluations, e)
			continue
		}
		e.ResultSet = json.RawMessage(text)

		// The RAW shape, reported for the certifier's benefit and nothing else:
		// how many entries the result set carried. A set that will not parse as an
		// array leaves this null and is caught by the failure rule below.
		var set []map[string]json.RawMessage
		if err := json.Unmarshal([]byte(text), &set); err == nil {
			n := len(set)
			e.ResultSetLength = &n
		}

		// THE FAILURE RULE, EXECUTED BY THIS HOST (spec § Actuator slice — "every
		// host retains the failure rule"). `entrypointValue` is the probe's own
		// unwrap (main.go), the same function the normal differential run uses: an
		// empty result set is an ERROR here, in Go, raised by Go, never a
		// zero-violation verdict. The certifier reads this error string; it does
		// not re-derive the verdict from a shape it classified itself.
		v, err := entrypointValue(json.RawMessage(text))
		if err != nil {
			msg := err.Error()
			e.Error = &msg
			row.Evaluations = append(row.Evaluations, e)
			continue
		}

		// THE RESULT-SHAPE RULE, ALSO EXECUTED BY THIS HOST. `entrypointValue`
		// only unwraps the result SET; it says nothing about what was inside it.
		// `readResult` (main.go, again the normal run's own function) is what
		// refuses a non-object result, a missing `violations`/`events` key, and a
		// field that is not an array. Without it a bundle that returns a bare
		// string — or half a verdict — landed here as `ok: true` with a
		// `resultSetLength` of 1, which is precisely the fail-open the classifier
		// controls exist to catch. The unwrapped value is NOT recorded on a
		// rejected row: `ok` and `result` stay in step, and the raw evidence
		// survives twice over — verbatim inside the error string readResult
		// raises, and whole in `resultSet`.
		if _, err := readResult(v); err != nil {
			msg := err.Error()
			e.Error = &msg
			row.Evaluations = append(row.Evaluations, e)
			continue
		}
		e.OK = true
		e.Result = v
		row.Evaluations = append(row.Evaluations, e)
	}
	return row
}

func runConformance(root, specPath, outPath string) error {
	ctx := context.Background()
	var spec conformanceSpec
	if err := readJSON(specPath, &spec); err != nil {
		return err
	}
	if len(spec.Cases) == 0 {
		return fmt.Errorf("%s carries no `cases` — refusing to report a vacuous conformance pass", specPath)
	}

	cache := wazero.NewCompilationCache()
	defer func() { _ = cache.Close(ctx) }()

	rows := make([]conformanceRow, 0, len(spec.Cases))
	for _, c := range spec.Cases {
		row := runConformanceCase(ctx, cache, root, c)
		rows = append(rows, row)
		status := "loaded"
		if !row.Loaded {
			status = "LOAD FAILED"
		}
		fmt.Printf("  %-28s %-12s %d evaluation(s)\n", c.ID, status, len(row.Evaluations))
	}

	doc := map[string]any{
		"generatedBy": "spikes/spine-adopt/wazero-probe (-conformance)",
		"contract": "spec `.totem/specs/spine-spike.md` § Actuator slice 5 — negative conformance fixtures must produce an error row on ALL hosts, never a clean zero. " +
			"Raw outcomes only; classification is src/certify.mts's, in one place for all three hosts.",
		"wazeroVersion": wazeroVersion(),
		"go":            goVersion(),
		"rows":          rows,
	}
	at, err := writeArtifact(filepath.Dir(outPath), filepath.Base(outPath), doc)
	if err != nil {
		return err
	}
	fmt.Printf("%d conformance row(s) -> %s\n", len(rows), at)
	return nil
}
