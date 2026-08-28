// ─── The OPA bundle/module census, lifted so two callers share ONE code path ──
//
// Originally private to `src/build-wasm.mts`. The certification actuator
// (`src/certify.mts`, spec § Actuator slice) has to enumerate the SAME
// entrypoints / imports / builtins in order to hash the entrypoint-import
// manifest into the certificate chain, and a second implementation of "what does
// this module declare" would be free to drift from the one the ABI census
// deliverable was measured with. Lifted verbatim rather than re-derived:
// `build-wasm.mts` now imports these, so the census artifact and the certificate
// manifest are provably the same reading.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Deterministic JSON: object keys sorted at every depth, no insignificant
 * whitespace. Array order is PRESERVED — an array's order is data, and the
 * manifest's own arrays are sorted by their producer before they get here.
 *
 * This is the preimage form for `manifestSha256`, so it must be a pure function
 * of the value: two runs that read the same module must produce the same bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Read one member out of an OPA bundle tarball, in-process.
 *
 * GNU `tar` is available here but unusable on these paths: without
 * `--force-local` it reads a leading `C:` as a REMOTE HOST spec ("Cannot connect
 * to C: resolve failed"), and WITH it the `-C <windows path>` argument is mangled
 * instead. Rather than fight the quoting, the gzip+ustar read is done directly —
 * zero dependencies, no shell, and no temp directory to leak.
 *
 * OPA bundle members are plain files with `/`-prefixed names (`/policy.wasm`,
 * `/.manifest`, `/data.json`, `/<source>.rego`).
 */
export function readBundleMember(tarball: string, member: string): Buffer {
  const tar = zlib.gunzipSync(fs.readFileSync(tarball));
  const seen: string[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8);
    if (!Number.isFinite(size))
      throw new Error(`bad tar size field ${JSON.stringify(sizeField)} in ${tarball}`);
    const dataAt = off + 512;
    const normalized = name.replace(/^\.?\//, '');
    seen.push(normalized);
    if (normalized === member) return tar.subarray(dataAt, dataAt + size);
    off = dataAt + Math.ceil(size / 512) * 512;
  }
  throw new Error(`bundle ${tarball} has no member ${member} (members: ${seen.join(', ')})`);
}

export interface WasmCensus {
  imports: {
    module: string;
    name: string;
    kind: string;
    memory?: { minimum: number; maximum: number | null; shared: boolean };
  }[];
  exports: { name: string; kind: string }[];
  abiVersion: number | null;
  abiMinorVersion: number | null;
  /** The module's own `builtins` export: name → builtin id. NON-EMPTY means the HOST must implement these. */
  hostBuiltins: Record<string, number>;
  entrypoints: Record<string, number>;
}

/**
 * Instantiate the module against the documented OPA ABI import set and read its
 * `builtins` / `entrypoints` exports back out of linear memory. Every host
 * function is wired to THROW, so a module that actually needed one would fail
 * loudly here rather than returning a plausible zero.
 */
export function censusWasm(bytes: Buffer): WasmCensus {
  const mod = new WebAssembly.Module(bytes);

  const imports = WebAssembly.Module.imports(mod).map((i) => {
    const row: WasmCensus['imports'][number] = { module: i.module, name: i.name, kind: i.kind };
    if (i.kind === 'memory') {
      const t = (i as unknown as { type?: { minimum: number; maximum?: number; shared?: boolean } })
        .type;
      if (t)
        row.memory = { minimum: t.minimum, maximum: t.maximum ?? null, shared: t.shared ?? false };
    }
    return row;
  });
  const exportsList = WebAssembly.Module.exports(mod).map((e) => ({ name: e.name, kind: e.kind }));

  const memory = new WebAssembly.Memory({ initial: 32 });
  const boom = (what: string) => () => {
    throw new Error(`module required an unexpected host import: ${what}`);
  };
  const env = {
    memory,
    opa_abort: (addr: number) => {
      throw new Error(`opa_abort: ${readCStr(memory, addr)}`);
    },
    opa_println: () => {},
    opa_builtin0: boom('opa_builtin0'),
    opa_builtin1: boom('opa_builtin1'),
    opa_builtin2: boom('opa_builtin2'),
    opa_builtin3: boom('opa_builtin3'),
    opa_builtin4: boom('opa_builtin4'),
  };
  const inst = new WebAssembly.Instance(mod, { env });
  const x = inst.exports as Record<string, any>;

  return {
    imports,
    exports: exportsList,
    abiVersion: x.opa_wasm_abi_version?.value ?? null,
    abiMinorVersion: x.opa_wasm_abi_minor_version?.value ?? null,
    hostBuiltins: JSON.parse(readCStr(memory, x.opa_json_dump(x.builtins()))),
    entrypoints: JSON.parse(readCStr(memory, x.opa_json_dump(x.entrypoints()))),
  };
}

export function readCStr(memory: WebAssembly.Memory, addr: number): string {
  const u8 = new Uint8Array(memory.buffer);
  let end = addr;
  while (u8[end] !== 0) end += 1;
  return new TextDecoder().decode(u8.subarray(addr, end));
}

// ─── The entrypoint/import manifest (spec § Actuator slice 3) ────────────────

/**
 * `{entrypoints[], imports[], builtins{}}` — the third member of the extended
 * certificate chain, verbatim from the ruled text. Derived from the MODULE, never
 * from the lowering's declaration of what it intended to emit: the whole point of
 * binding it into the chain is that it attests what the artifact actually
 * exposes.
 *
 * - `entrypoints` is the sorted list of exported entrypoint NAMES. The ids the
 *   module assigns them are a build-internal numbering, not part of the contract.
 * - `imports` is the sorted `module.name:kind` list, the same spelling the ABI
 *   census artifact and the Rust host both use.
 * - `builtins` is the module's own `builtins` export (name → id), `{}` when the
 *   module delegates nothing to the host.
 */
export interface EntrypointManifest {
  entrypoints: string[];
  imports: string[];
  builtins: Record<string, number>;
}

export function entrypointManifest(c: WasmCensus): EntrypointManifest {
  return {
    entrypoints: Object.keys(c.entrypoints).sort(),
    imports: c.imports.map((i) => `${i.module}.${i.name}:${i.kind}`).sort(),
    builtins: Object.fromEntries(
      Object.entries(c.hostBuiltins).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}
