// Copies tree-sitter-rust.wasm from @vscode/tree-sitter-wasm into the
// package root so register.cjs's wasmLoader can resolve it via
// `path.join(__dirname, 'tree-sitter-rust.wasm')`.
//
// Runs at `prepare` (post-install + pre-publish) and via the explicit
// `build` script. Idempotent: skips the copy when the destination already
// has the same byte content as the source.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm');
const DEST = path.join(__dirname, '..', 'tree-sitter-rust.wasm');

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.equals(b);
}

const sourceBytes = fs.readFileSync(SOURCE);
if (fs.existsSync(DEST) && bytesEqual(fs.readFileSync(DEST), sourceBytes)) {
  process.exit(0);
}
fs.writeFileSync(DEST, sourceBytes);
