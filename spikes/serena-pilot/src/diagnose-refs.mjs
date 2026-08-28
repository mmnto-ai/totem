// Falsification probe for the T4/T5/T7 pattern: find_referencing_symbols
// returned ONLY intra-file references, while T2 got full cross-file results.
//
// Competing explanations:
//   (A) serena/tsserver genuinely cannot resolve cross-file references here
//       -> a real capability finding, retirement-relevant
//   (B) tsserver only searches files it has already loaded into the active
//       project, so the answer depends on what was opened earlier in the
//       session -> an order-of-operations artifact, NOT a capability ceiling
//
// The probe: ask for references to `requiresSuppressesMatch` COLD, then open a
// known consumer file (get_symbols_overview), then ask again. If the second
// answer is richer, (B) holds and the first answer was warm-up dependent.

import { McpStdioClient } from './client.mjs';
import { serverSpec } from './config.mjs';

const SYMBOL = 'requiresSuppressesMatch';
const DEF_FILE = 'packages/core/src/spine/record-runtime.ts';
const CONSUMERS = [
  'packages/core/src/rule-engine.ts',
  'packages/core/src/compile-smoke-gate.ts',
  'packages/core/src/regex-safety/apply-rules-bounded.ts',
  'packages/core/src/index.ts',
  'packages/core/src/spine/record-runtime.test.ts',
];

const client = new McpStdioClient(serverSpec());
client.start();

/**
 * The IDENTITIES a reference result names: the set of files it mentions.
 *
 * Byte count alone cannot decide between (A) and (B). A reference result
 * carries a `content_around_reference` snippet per hit, so the same set of
 * references can come back larger or smaller run to run purely from snippet
 * size. Only a reference the second call names and the first did not is
 * evidence that the answer depended on what tsserver had loaded.
 */
const refFiles = (text) =>
  [
    ...new Set(
      [...text.matchAll(/"([^"]*?\\\\[^"]*?\.[cm]?tsx?)"/g)].map((m) => m[1].replace(/\\\\/g, '/')),
    ),
  ].sort();

const show = (label, r) => {
  console.log(`\n### ${label}: ${r.bytes} bytes, ${r.ms.toFixed(0)}ms, isError=${r.isError}`);
  const files = refFiles(r.text);
  console.log('   files mentioned:', files.length ? files : '(none)');
  if (r.bytes < 400) console.log('   raw:', r.text.slice(0, 400));
};

try {
  await client.initialize();
  await client.listTools();

  const found = await client.callTool('find_symbol', {
    name_path_pattern: SYMBOL,
    relative_path: '',
  });
  show('find_symbol (cold)', found);

  const cold = await client.callTool('find_referencing_symbols', {
    name_path: SYMBOL,
    relative_path: DEF_FILE,
  });
  show('find_referencing_symbols COLD', cold);

  console.log('\n--- opening consumer files via get_symbols_overview ---');
  for (const f of CONSUMERS) {
    const o = await client.callTool('get_symbols_overview', { relative_path: f, depth: 0 });
    console.log(`   opened ${f}: ${o.bytes} bytes, ${o.ms.toFixed(0)}ms, isError=${o.isError}`);
  }

  const warm = await client.callTool('find_referencing_symbols', {
    name_path: SYMBOL,
    relative_path: DEF_FILE,
  });
  show('find_referencing_symbols AFTER opening consumers', warm);

  // Decide on reference IDENTITIES, not bytes: (B) holds only if the second
  // call named a referencing file the first did not.
  const coldFiles = refFiles(cold.text);
  const warmFiles = refFiles(warm.text);
  const newFiles = warmFiles.filter((f) => !coldFiles.includes(f));

  console.log(
    `\nVERDICT: cold=${cold.bytes}B/${coldFiles.length} files, ` +
      `warm=${warm.bytes}B/${warmFiles.length} files -> ` +
      (newFiles.length > 0
        ? 'explanation (B): results depend on what tsserver has loaded; ' +
          `references only the warm call named: ${newFiles.join(', ')}`
        : 'explanation (A): cross-file references genuinely not resolved; ' +
          'opening the consumers named no reference the cold call had missed ' +
          `(byte delta ${warm.bytes - cold.bytes}B is snippet size, not new references)`),
  );
} catch (err) {
  console.error('DIAGNOSTIC FAILED:', err.message);
  console.error(client.stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  await client.stop();
}
