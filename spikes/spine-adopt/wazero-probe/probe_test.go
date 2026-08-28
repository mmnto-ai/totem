package main

// Tests that the probe's own machinery is not vacuous.
//
// The main run reports 24/24 MATCH. That number is worth nothing unless the
// probe CAN report something else, so each test here forces a path that a
// clean run never exercises.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tetratelabs/wazero"
)

const specimenA = "../rego/build/r61dcb058bd1df15d/policy.wasm"

func loadSpecimenA(t *testing.T) (*loadedPolicy, int) {
	t.Helper()
	wasm, err := os.ReadFile(filepath.FromSlash(specimenA))
	if err != nil {
		t.Skipf("%s is absent — run `npm run lower && npm run build-wasm` first: %v", specimenA, err)
	}
	ctx := context.Background()
	p, _, _, err := loadPolicy(ctx, wazero.NewCompilationCache(), wasm)
	if err != nil {
		t.Fatalf("loadPolicy: %v", err)
	}
	t.Cleanup(func() { p.Close(ctx) })

	eps, err := p.in.entrypointIDs(ctx)
	if err != nil {
		t.Fatalf("entrypointIDs: %v", err)
	}
	id, ok := eps["totem/spike/r61dcb058bd1df15d/result"]
	if !ok {
		t.Fatalf("specimen a has no expected entrypoint; got %v", eps)
	}
	return p, id
}

// TestEnvShimIsAValidModule proves the hand-encoded `env` shim is real wasm and
// not merely bytes that happen to satisfy the rest of the code.
func TestEnvShimIsAValidModule(t *testing.T) {
	ctx := context.Background()
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	c, err := r.CompileModule(ctx, buildEnvShim(2))
	if err != nil {
		t.Fatalf("the synthesised env shim does not decode: %v", err)
	}
	mems := c.ExportedMemories()
	m, ok := mems["memory"]
	if !ok {
		t.Fatalf("shim exports no `memory`; exports %v", mems)
	}
	if m.Min() != 2 {
		t.Errorf("shim memory min = %d, want 2", m.Min())
	}
	if _, hasMax := m.Max(); hasMax {
		t.Error("shim memory declares a maximum; it must not, so the guest keeps memory.grow")
	}
	if got := len(c.ImportedFunctions()); got != 6 {
		t.Errorf("shim imports %d functions, want 6", got)
	}
	for _, want := range []string{"opa_abort", "opa_builtin0", "opa_builtin1", "opa_builtin2", "opa_builtin3", "opa_builtin4"} {
		if _, ok := c.ExportedFunctions()[want]; !ok {
			t.Errorf("shim does not re-export %s", want)
		}
	}
}

// TestEmptyResultSetIsAnError pins the strictness contract at the unit level: an
// undefined `result` rule must NEVER read as a zero-violation verdict.
func TestEmptyResultSetIsAnError(t *testing.T) {
	if _, err := entrypointValue(json.RawMessage(`[]`)); err == nil {
		t.Fatal("an EMPTY RESULT SET was accepted; it must be an error row")
	} else if !strings.Contains(err.Error(), "EMPTY RESULT SET") {
		t.Fatalf("wrong error for an empty result set: %v", err)
	}
	v, err := entrypointValue(json.RawMessage(`[{"result":{"violations":[],"events":[]}}]`))
	if err != nil {
		t.Fatalf("a well-formed result set was rejected: %v", err)
	}
	if _, err := readResult(v); err != nil {
		t.Fatalf("a well-formed result was rejected: %v", err)
	}
	// A result missing `events` is an error, never "emits none".
	if _, err := readResult(json.RawMessage(`{"violations":[]}`)); err == nil {
		t.Fatal("a result missing `events` was accepted; absent must stay absent")
	}
}

// TestMalformedInputIsNotACleanZero is the one that matters: it drives the REAL
// wasm with an input that fails the policy's `facts_wellformed` guard and asserts
// the probe surfaces an error rather than inventing a silent, zero-violation
// verdict. Without this, a probe that mis-drove every eval would still report
// "nothing fired" and look like agreement on the negative fixtures.
func TestMalformedInputIsNotACleanZero(t *testing.T) {
	p, id := loadSpecimenA(t)
	ctx := context.Background()

	text, err := p.in.evalClassic(ctx, id, []byte(`{}`))
	if err != nil {
		t.Fatalf("eval with a malformed FactBundle trapped rather than returning: %v", err)
	}
	if _, err := entrypointValue(json.RawMessage(text)); err == nil {
		t.Fatalf("a malformed FactBundle produced an accepted verdict %q; it must be an error row", text)
	}
}

// fixtureBundle reads a FactBundle straight off disk. Hand-written bundles are
// avoided deliberately: the fixtures are the contract, and inventing one risks
// asserting against a rule the record does not actually state.
func fixtureBundle(t *testing.T, name string) []byte {
	t.Helper()
	var f factFile
	if err := readJSON(filepath.Join("..", "artifacts", "facts", name), &f); err != nil {
		t.Skipf("fixture %s unavailable: %v", name, err)
	}
	return f.FactBundle
}

// TestVerdictRespondsToInput proves the wasm is actually deciding: the same
// module must fire on the `bad` fixture and stay silent on the `good` one. If
// the ABI were mis-driven, both would come back the same — and a probe that
// returned "nothing fired" everywhere would still look like agreement on every
// negative row.
func TestVerdictRespondsToInput(t *testing.T) {
	p, id := loadSpecimenA(t)
	ctx := context.Background()

	eval := func(bundle []byte) *verdict {
		t.Helper()
		text, err := p.in.evalClassic(ctx, id, bundle)
		if err != nil {
			t.Fatalf("eval: %v", err)
		}
		val, err := entrypointValue(json.RawMessage(text))
		if err != nil {
			t.Fatalf("entrypointValue(%q): %v", text, err)
		}
		v, err := readResult(val)
		if err != nil {
			t.Fatalf("readResult: %v", err)
		}
		return v
	}

	if got := len(eval(fixtureBundle(t, "61dcb058bd1df15d-a-inline-bad.json")).Violations); got != 1 {
		t.Errorf("the `bad` fixture produced %d violations, want 1", got)
	}
	if got := len(eval(fixtureBundle(t, "61dcb058bd1df15d-a-inline-good.json")).Violations); got != 0 {
		t.Errorf("the `good` fixture produced %d violations, want 0", got)
	}
}

// TestOneShotAgreesWithClassic runs the cross-check as a unit test too, so a
// regression in either ABI path fails without a full probe run.
func TestOneShotAgreesWithClassic(t *testing.T) {
	p, id := loadSpecimenA(t)
	ctx := context.Background()
	bundle := fixtureBundle(t, "61dcb058bd1df15d-a-inline-bad.json")

	classic, err := p.in.evalClassic(ctx, id, bundle)
	if err != nil {
		t.Fatalf("classic: %v", err)
	}
	oneShot, err := p.in.evalOneShot(ctx, id, bundle)
	if err != nil {
		t.Fatalf("one-shot: %v", err)
	}
	if ok, a, b := jsonEqual(classic, oneShot); !ok {
		t.Fatalf("the two ABI paths disagree:\n  classic  %s\n  one-shot %s", a, b)
	}
}
