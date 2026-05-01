// @totem/pack-rust-architecture — ADR-097 § 10 registration entry.
//
// Synchronous CJS callback per ADR-097 § 5 Q5. Wires Rust into both engine
// language paths so ast-grep rules scoped to `.rs` files dispatch correctly:
//
//   1. Web-tree-sitter side via the official PackRegistrationAPI surface
//      (`api.registerLanguage`). Powers `loadGrammar`, `ast-query.ts`,
//      `ast-gate.ts`, and the lite-build wasm-shim path.
//
//   2. @ast-grep/napi side via direct `registerDynamicLanguage` invocation
//      (the side-channel). Powers the engine's hot path for ast-grep rule
//      matching (`matchAstGrepPattern`, `rule-engine.ts`). At
//      @ast-grep/napi@0.42.0 only Html / JavaScript / Tsx / Css / TypeScript
//      are built-in Lang variants, so non-built-in languages must be
//      registered via the napi-specific API which the substrate does not
//      yet expose.
//
// The dual registration is a v0.1 pattern — see "Substrate gap (v0.1)" in
// the README and mmnto-ai/totem#1774 for the planned lift into
// `PackRegistrationAPI.registerNapiLanguage` (gated on N≥2 pack consumers
// before the API shape locks).

'use strict';

const path = require('node:path');

/** @type {import('@mmnto/totem').PackRegisterCallback} */
function register(api) {
  // (1) Web-tree-sitter side via the substrate API (ADR-097 § 10).
  api.registerLanguage('.rs', 'rust', () => path.join(__dirname, 'tree-sitter-rust.wasm'));

  // (2) @ast-grep/napi side via the v0.1 side-channel. See mmnto-ai/totem#1774
  //     for the planned lift into PackRegistrationAPI.registerNapiLanguage.
  //
  //     Idempotent: registerDynamicLanguage no-ops on a name that's already
  //     registered, so re-running this callback (e.g., test fixtures, repeat
  //     boots) is safe.
  const rust = require('@ast-grep/lang-rust');
  const { registerDynamicLanguage } = require('@ast-grep/napi');
  registerDynamicLanguage({ rust });
}

module.exports = register;
module.exports.register = register;
module.exports.default = register;
