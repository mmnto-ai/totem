#!/usr/bin/env node
// R14 round (mmnto-ai/totem-strategy#288, 2026-08-22) — the respondent's falsifier
// probe over the scorer's tree-form alternatives for seed entries 11 (6b2b62eb)
// and 15 (b237bcf3), committed so the round's deposit replays from the tree.
//
// Uses the SHIPPED engine (@ast-grep/napi, resolved from packages/core's own
// dependency) through the shipped call shape:
//   parse(Lang.TypeScript, code).root().findAll(config)
// Deterministic, zero-LLM, no filesystem writes. Prints one row per
// (config, input) with the match count, or the engine's thrown message.
//
// What it measured (recorded in the deposit; re-run to check):
//   - `constraints:` on a MULTI meta-variable (`$$$ARGS`) is INERT — identical
//     counts to the bare pattern on every input, `record.good` included.
//   - the scorer's `all:` + `not:`/`regex:` tree forms reproduce bad 1 / good 0.
//   - the two V1 tree readings of each rule's INTENT diverge on realistic shapes
//     the legacy `message` prose never defined — `defective-source` evidence.
//   - 'passwd' does NOT contain 'pwd' (the respondent's own refuted hypothesis).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_PKG = path.resolve(HERE, '..', 'packages', 'core', 'package.json');
const require = createRequire(CORE_PKG);
const { parse, Lang } = require('@ast-grep/napi');
const ver = require('@ast-grep/napi/package.json').version;

const count = (config, code) => {
  try {
    return String(parse(Lang.TypeScript, code).root().findAll(config).length);
  } catch (err) {
    return `THROW: ${(err && err.message ? err.message : String(err)).split('\n')[0].slice(0, 110)}`;
  }
};

const run = (title, configs, inputs) => {
  console.log(`\n=== ${title} ===`);
  for (const [cname, config] of Object.entries(configs)) {
    console.log(`-- ${cname}: ${JSON.stringify(config)}`);
    for (const [iname, code] of Object.entries(inputs)) {
      console.log(`   ${iname.padEnd(28)} -> ${count(config, code)}`);
    }
  }
};

console.log(`@ast-grep/napi ${ver}`);

// ───────────────────────── 6b2b62eb — log.error must carry the 'Totem Error' tag
run(
  '6b2b62eb  (intent: must-contain the tag among the ARGUMENTS)',
  {
    legacyBare: { rule: { pattern: 'log.error($$$ARGS)' } },
    scorerTree_allNotRegex: {
      rule: { all: [{ pattern: 'log.error($$$ARGS)' }, { not: { regex: 'Totem Error' } }] },
    },
    constraintsOnMulti: {
      rule: { pattern: 'log.error($$$ARGS)' },
      constraints: { ARGS: { not: { regex: 'Totem Error' } } },
    },
    constraintsOnSingleFirstArg: {
      rule: { pattern: 'log.error($FIRST, $$$REST)' },
      constraints: { FIRST: { not: { regex: 'Totem Error' } } },
    },
    hasArgsRegex: {
      rule: {
        all: [
          { pattern: 'log.error($$$ARGS)' },
          { not: { has: { field: 'arguments', has: { kind: 'string', regex: 'Totem Error' } } } },
        ],
      },
    },
  },
  {
    'record.bad': "log.error('compile failed: ' + msg);",
    'record.good': "log.error('Totem Error', 'compile failed: ' + msg);",
    'tag-in-comment': 'log.error(/* Totem Error */ msg);',
    'tag-nested-in-call': "log.error(fmt('Totem Error'), msg);",
    'tag-as-second-arg': "log.error(msg, 'Totem Error');",
    'tag-in-template': 'log.error(`Totem Error: ${msg}`);',
    'no-args': 'log.error();',
  },
);

// ───────────────────────── b237bcf3 — 'pwd' must NOT appear in the credential regex
run(
  "b237bcf3  (intent: must-NOT-contain the token 'pwd' — note 'passwd' does NOT contain 'pwd')",
  {
    legacyBare: { rule: { pattern: 'new RegExp($$$ARGS)' } },
    scorerTree_allRegex_bare: {
      rule: { all: [{ pattern: 'new RegExp($$$ARGS)' }, { regex: 'pwd' }] },
    },
    scorerTree_allRegex_boundary: {
      rule: { all: [{ pattern: 'new RegExp($$$ARGS)' }, { regex: '\\bpwd\\b' }] },
    },
    constraintsOnMulti_bare: {
      rule: { pattern: 'new RegExp($$$ARGS)' },
      constraints: { ARGS: { regex: 'pwd' } },
    },
    constraintsOnSingle_boundary: {
      rule: { pattern: 'new RegExp($SRC, $$$REST)' },
      constraints: { SRC: { regex: '\\bpwd\\b' } },
    },
  },
  {
    'record.bad':
      "const CREDENTIAL_RE = new RegExp('(password|passwd|pwd|secret)\\\\s*[:=]', 'i');",
    'record.good': "const CREDENTIAL_RE = new RegExp('(password|passwd|secret)\\\\s*[:=]', 'i');",
    'pwd-only-in-comment': "const R = new RegExp('(password|secret)' /* pwd */, 'i');",
    'pwd-in-flags-var': "const pwdFlags = 'i'; const R = new RegExp('(password)', pwdFlags);",
    'single-arg-pwd': "const R = new RegExp('pwd');",
  },
);
