package main

// ─── The OPA wasm ABI, driven directly ───────────────────────────────────────
//
// No OPA SDK exists for wazero, so this drives the exported ABI by hand. Two
// independent paths are implemented and BOTH are run for every fixture:
//
//   - CLASSIC   opa_heap_ptr_set / opa_malloc / opa_json_parse / opa_eval_ctx_new /
//               opa_eval_ctx_set_input / opa_eval_ctx_set_data /
//               opa_eval_ctx_set_entrypoint / eval / opa_eval_ctx_get_result /
//               opa_json_dump
//   - ONE-SHOT  opa_eval(reserved, entrypoint, data, input_ptr, input_len,
//               heap_ptr, format) — the ABI 1.2+ fast path, present here
//               (the modules declare abi 1.3).
//
// Running both is the probe's own falsifier. A hand-driven ABI that produces a
// plausible-looking verdict through ONE path could be silently mis-driving the
// heap; two paths with different allocation discipline agreeing byte-for-byte on
// the dumped JSON is much harder to fake. A disagreement is reported, never
// averaged.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/tetratelabs/wazero/api"
)

// instance is one instantiated policy plus the shared memory and the resolved
// ABI exports.
type instance struct {
	mod api.Module
	mem api.Memory

	malloc         api.Function
	jsonParse      api.Function
	jsonDump       api.Function
	heapPtrGet     api.Function
	heapPtrSet     api.Function
	ctxNew         api.Function
	ctxSetInput    api.Function
	ctxSetData     api.Function
	ctxSetEntrypnt api.Function
	ctxGetResult   api.Function
	evalFn         api.Function
	opaEval        api.Function // nil if this ABI version lacks the fast path
	builtinsFn     api.Function
	entrypointsFn  api.Function

	dataAddr uint32 // parsed `{}` data document, allocated BELOW baseHeap
	baseHeap uint32

	// abortMsg carries whatever `opa_abort` was last called with, so the reason
	// survives the panic/recover round trip.
	abortMsg string
}

func mustExport(mod api.Module, name string) (api.Function, error) {
	f := mod.ExportedFunction(name)
	if f == nil {
		return nil, fmt.Errorf("policy module does not export %q", name)
	}
	return f, nil
}

// resolve binds every ABI export the eval sequences need.
func (in *instance) resolve() error {
	type binding struct {
		name string
		dst  *api.Function
	}
	required := []binding{
		{"opa_malloc", &in.malloc},
		{"opa_json_parse", &in.jsonParse},
		{"opa_json_dump", &in.jsonDump},
		{"opa_heap_ptr_get", &in.heapPtrGet},
		{"opa_heap_ptr_set", &in.heapPtrSet},
		{"opa_eval_ctx_new", &in.ctxNew},
		{"opa_eval_ctx_set_input", &in.ctxSetInput},
		{"opa_eval_ctx_set_data", &in.ctxSetData},
		{"opa_eval_ctx_set_entrypoint", &in.ctxSetEntrypnt},
		{"opa_eval_ctx_get_result", &in.ctxGetResult},
		{"eval", &in.evalFn},
		{"builtins", &in.builtinsFn},
		{"entrypoints", &in.entrypointsFn},
	}
	for _, b := range required {
		f, err := mustExport(in.mod, b.name)
		if err != nil {
			return err
		}
		*b.dst = f
	}
	// Optional: only present from ABI 1.2.
	in.opaEval = in.mod.ExportedFunction("opa_eval")
	return nil
}

// call invokes an ABI export, turning an `opa_abort` panic back into an error
// that names the abort message.
func (in *instance) call(ctx context.Context, f api.Function, what string, args ...uint64) ([]uint64, error) {
	in.abortMsg = ""
	res, err := f.Call(ctx, args...)
	if err != nil {
		if in.abortMsg != "" {
			return nil, fmt.Errorf("%s: opa_abort(%q): %w", what, in.abortMsg, err)
		}
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	return res, nil
}

func (in *instance) call1(ctx context.Context, f api.Function, what string, args ...uint64) (uint32, error) {
	res, err := in.call(ctx, f, what, args...)
	if err != nil {
		return 0, err
	}
	if len(res) != 1 {
		return 0, fmt.Errorf("%s returned %d results, expected 1", what, len(res))
	}
	return uint32(res[0]), nil
}

// alloc copies b into guest memory via opa_malloc and returns its address.
func (in *instance) alloc(ctx context.Context, b []byte) (uint32, error) {
	addr, err := in.call1(ctx, in.malloc, "opa_malloc", uint64(len(b)))
	if err != nil {
		return 0, err
	}
	if !in.mem.Write(addr, b) {
		return 0, fmt.Errorf("opa_malloc returned %d but a %d-byte write there is out of range (memory size %d)",
			addr, len(b), in.mem.Size())
	}
	return addr, nil
}

// readCString reads the NUL-terminated string at addr.
//
// wazero's Memory.Read hands back a sub-slice of the CURRENT backing buffer, so
// this stays correct across a `memory.grow` as long as it is called after the
// guest call that produced the address (which it always is).
func (in *instance) readCString(addr uint32) (string, error) {
	size := in.mem.Size()
	if addr >= size {
		return "", fmt.Errorf("string address %d is past the end of memory (%d)", addr, size)
	}
	buf, ok := in.mem.Read(addr, size-addr)
	if !ok {
		return "", fmt.Errorf("reading memory at %d failed", addr)
	}
	n := bytes.IndexByte(buf, 0)
	if n < 0 {
		return "", fmt.Errorf("no NUL terminator after address %d", addr)
	}
	return string(buf[:n]), nil
}

// dumpValue serialises an opa_value to JSON text.
func (in *instance) dumpValue(ctx context.Context, valueAddr uint32) (string, error) {
	strAddr, err := in.call1(ctx, in.jsonDump, "opa_json_dump", uint64(valueAddr))
	if err != nil {
		return "", err
	}
	return in.readCString(strAddr)
}

// setup parses the empty data document and records the heap watermark.
//
// ORDER IS LOAD-BEARING: data is parsed FIRST so it lives below the saved heap
// pointer, and therefore survives every per-eval `opa_heap_ptr_set(baseHeap)`.
// Saving the watermark first would let the next eval reclaim the data document
// out from under itself.
//
// `{}` matches the wasmtime arm, which instantiates with
// `Runtime::without_data` — an empty data document.
func (in *instance) setup(ctx context.Context) error {
	if err := in.resolve(); err != nil {
		return err
	}
	data := []byte("{}")
	ptr, err := in.alloc(ctx, data)
	if err != nil {
		return err
	}
	in.dataAddr, err = in.call1(ctx, in.jsonParse, "opa_json_parse(data)", uint64(ptr), uint64(len(data)))
	if err != nil {
		return err
	}
	in.baseHeap, err = in.call1(ctx, in.heapPtrGet, "opa_heap_ptr_get")
	return err
}

// entrypointIDs reads the module's own entrypoint table (name -> id).
func (in *instance) entrypointIDs(ctx context.Context) (map[string]int, error) {
	v, err := in.call1(ctx, in.entrypointsFn, "entrypoints")
	if err != nil {
		return nil, err
	}
	text, err := in.dumpValue(ctx, v)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("parsing entrypoints %q: %w", text, err)
	}
	return out, nil
}

// requiredBuiltins reads the module's own host-builtin table (name -> id).
//
// This is the census's headline claim measured a third way: if this map is
// empty, the module asks the host to implement NOTHING, and the `opa_builtin0..4`
// stubs are provably dead weight rather than assumed to be.
func (in *instance) requiredBuiltins(ctx context.Context) (map[string]int, error) {
	v, err := in.call1(ctx, in.builtinsFn, "builtins")
	if err != nil {
		return nil, err
	}
	text, err := in.dumpValue(ctx, v)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("parsing builtins %q: %w", text, err)
	}
	return out, nil
}

// evalClassic runs the long-hand eval-context sequence and returns the dumped
// result set as JSON text.
func (in *instance) evalClassic(ctx context.Context, entrypointID int, input []byte) (string, error) {
	if _, err := in.call(ctx, in.heapPtrSet, "opa_heap_ptr_set", uint64(in.baseHeap)); err != nil {
		return "", err
	}
	inputPtr, err := in.alloc(ctx, input)
	if err != nil {
		return "", err
	}
	inputVal, err := in.call1(ctx, in.jsonParse, "opa_json_parse(input)", uint64(inputPtr), uint64(len(input)))
	if err != nil {
		return "", err
	}
	if inputVal == 0 {
		return "", fmt.Errorf("opa_json_parse returned NULL for the input FactBundle")
	}
	evalCtx, err := in.call1(ctx, in.ctxNew, "opa_eval_ctx_new")
	if err != nil {
		return "", err
	}
	if _, err := in.call(ctx, in.ctxSetInput, "opa_eval_ctx_set_input", uint64(evalCtx), uint64(inputVal)); err != nil {
		return "", err
	}
	if _, err := in.call(ctx, in.ctxSetData, "opa_eval_ctx_set_data", uint64(evalCtx), uint64(in.dataAddr)); err != nil {
		return "", err
	}
	if _, err := in.call(ctx, in.ctxSetEntrypnt, "opa_eval_ctx_set_entrypoint", uint64(evalCtx), uint64(uint32(entrypointID))); err != nil {
		return "", err
	}
	rc, err := in.call1(ctx, in.evalFn, "eval", uint64(evalCtx))
	if err != nil {
		return "", err
	}
	if rc != 0 {
		return "", fmt.Errorf("eval returned non-zero status %d", rc)
	}
	resultVal, err := in.call1(ctx, in.ctxGetResult, "opa_eval_ctx_get_result", uint64(evalCtx))
	if err != nil {
		return "", err
	}
	return in.dumpValue(ctx, resultVal)
}

// evalOneShot runs the ABI 1.2+ `opa_eval` fast path.
//
//	opa_eval(reserved, entrypoint_id, data, input_ptr, input_len, heap_ptr, format)
//
// `format` 0 asks for a NUL-terminated JSON string, so the return address is
// read directly rather than dumped. Unlike the classic path this takes the RAW
// input bytes, not a parsed opa_value — a genuinely different allocation
// discipline, which is what makes it worth running as a cross-check.
func (in *instance) evalOneShot(ctx context.Context, entrypointID int, input []byte) (string, error) {
	if in.opaEval == nil {
		return "", fmt.Errorf("module does not export opa_eval (ABI < 1.2)")
	}
	if _, err := in.call(ctx, in.heapPtrSet, "opa_heap_ptr_set", uint64(in.baseHeap)); err != nil {
		return "", err
	}
	inputPtr, err := in.alloc(ctx, input)
	if err != nil {
		return "", err
	}
	// The heap pointer handed to opa_eval is the watermark ABOVE the input we
	// just wrote, so the call does not reclaim its own argument.
	heapPtr, err := in.call1(ctx, in.heapPtrGet, "opa_heap_ptr_get")
	if err != nil {
		return "", err
	}
	addr, err := in.call1(ctx, in.opaEval, "opa_eval",
		0,
		uint64(uint32(entrypointID)),
		uint64(in.dataAddr),
		uint64(inputPtr),
		uint64(len(input)),
		uint64(heapPtr),
		0, // format: JSON
	)
	if err != nil {
		return "", err
	}
	return in.readCString(addr)
}
