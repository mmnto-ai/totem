package main

// ─── The `env` shim module ───────────────────────────────────────────────────
//
// THE ONE REAL FRICTION THIS PROBE FOUND.
//
// The OPA-emitted policy modules IMPORT their linear memory:
//
//	(import "env" "memory" (memory 2))
//
// and re-export it as `memory`. Under wasmtime the host answers this with
// `Memory::new(...)` and hands the instance a host-created memory. wazero has no
// such affordance: `wazero.HostModuleBuilder` (v1.12.0) exposes exactly three
// methods — `NewFunctionBuilder`, `Compile`, `Instantiate`. A Go host module can
// define FUNCTIONS and nothing else. There is no `ExportMemory`, so the import
// `env.memory` cannot be satisfied by a host module at all.
//
// Two ways out were available, and only one keeps the probe honest:
//
//   - Patch `policy.wasm` to turn the memory IMPORT into a memory DEFINITION.
//     Rejected: it would mean the probe no longer evaluates "the exact wasm
//     artifacts our spike produced", which is the whole question.
//   - Supply `env` as a real WASM module rather than a host module. Taken here.
//
// So this file synthesises a minimal module that is instantiated under the name
// `env`. It DEFINES the memory and exports it, and it IMPORTS the six OPA ABI
// functions from a Go host module (`opa_host`) and RE-EXPORTS them under the
// names the policy expects. The policy binary is never touched; only the
// linkage around it changes.
//
// Encoded by hand because wazero ships no WAT assembler. The equivalent text is:
//
//	(module
//	  (import "opa_host" "opa_abort"    (func $abort (param i32)))
//	  (import "opa_host" "opa_builtin0" (func $b0 (param i32 i32) (result i32)))
//	  (import "opa_host" "opa_builtin1" (func $b1 (param i32 i32 i32) (result i32)))
//	  (import "opa_host" "opa_builtin2" (func $b2 (param i32 i32 i32 i32) (result i32)))
//	  (import "opa_host" "opa_builtin3" (func $b3 (param i32 i32 i32 i32 i32) (result i32)))
//	  (import "opa_host" "opa_builtin4" (func $b4 (param i32 i32 i32 i32 i32 i32) (result i32)))
//	  (memory (export "memory") <minPages>)
//	  (export "opa_abort" (func $abort))
//	  (export "opa_builtin0" (func $b0))
//	  ... )
//
// `minPages` is read off the POLICY's own import declaration rather than
// hardcoded, and the memory is declared with NO maximum so the guest keeps its
// ability to `memory.grow`.

import "encoding/binary"

const i32 byte = 0x7F

// uleb128 appends the unsigned LEB128 encoding of v.
func uleb128(dst []byte, v uint32) []byte {
	for {
		b := byte(v & 0x7F)
		v >>= 7
		if v != 0 {
			b |= 0x80
		}
		dst = append(dst, b)
		if v == 0 {
			return dst
		}
	}
}

// name appends a wasm name: length-prefixed UTF-8.
func name(dst []byte, s string) []byte {
	dst = uleb128(dst, uint32(len(s)))
	return append(dst, s...)
}

// section appends a section: id, byte length, payload.
func section(dst []byte, id byte, payload []byte) []byte {
	dst = append(dst, id)
	dst = uleb128(dst, uint32(len(payload)))
	return append(dst, payload...)
}

// funcType encodes a (param i32 * nParams) -> (result i32 * nResults) type.
func funcType(dst []byte, nParams, nResults int) []byte {
	dst = append(dst, 0x60)
	dst = uleb128(dst, uint32(nParams))
	for i := 0; i < nParams; i++ {
		dst = append(dst, i32)
	}
	dst = uleb128(dst, uint32(nResults))
	for i := 0; i < nResults; i++ {
		dst = append(dst, i32)
	}
	return dst
}

// envImport is one function the shim relays from the Go host module to the policy.
type envImport struct {
	name     string
	nParams  int
	nResults int
}

// envImports is the exact import set the ABI census names, in the arity the
// wazero decoder read off the policy modules themselves.
var envImports = []envImport{
	{"opa_abort", 1, 0},
	{"opa_builtin0", 2, 1},
	{"opa_builtin1", 3, 1},
	{"opa_builtin2", 4, 1},
	{"opa_builtin3", 5, 1},
	{"opa_builtin4", 6, 1},
}

// hostModuleName is the module the shim pulls the Go implementations from. It is
// deliberately NOT "env": `env` is the name the shim itself is instantiated
// under, and a wazero module namespace admits one module per name.
const hostModuleName = "opa_host"

// buildEnvShim encodes the `env` module described above, with a memory of
// minPages and no declared maximum.
func buildEnvShim(minPages uint32) []byte {
	out := make([]byte, 0, 256)
	out = append(out, 0x00, 0x61, 0x73, 0x6D) // "\0asm"
	out = binary.LittleEndian.AppendUint32(out, 1)

	// ── Type section (id 1) ──
	var types []byte
	types = uleb128(types, uint32(len(envImports)))
	for _, im := range envImports {
		types = funcType(types, im.nParams, im.nResults)
	}
	out = section(out, 1, types)

	// ── Import section (id 2) ──
	var imports []byte
	imports = uleb128(imports, uint32(len(envImports)))
	for i, im := range envImports {
		imports = name(imports, hostModuleName)
		imports = name(imports, im.name)
		imports = append(imports, 0x00) // kind: func
		imports = uleb128(imports, uint32(i))
	}
	out = section(out, 2, imports)

	// ── Memory section (id 5) ──
	// limits flag 0x00 = min only, no maximum, so `memory.grow` stays available.
	var mems []byte
	mems = uleb128(mems, 1)
	mems = append(mems, 0x00)
	mems = uleb128(mems, minPages)
	out = section(out, 5, mems)

	// ── Export section (id 7) ──
	var exports []byte
	exports = uleb128(exports, uint32(len(envImports)+1))
	exports = name(exports, "memory")
	exports = append(exports, 0x02) // kind: memory
	exports = uleb128(exports, 0)
	for i, im := range envImports {
		exports = name(exports, im.name)
		exports = append(exports, 0x00) // kind: func
		exports = uleb128(exports, uint32(i))
	}
	out = section(out, 7, exports)

	return out
}
