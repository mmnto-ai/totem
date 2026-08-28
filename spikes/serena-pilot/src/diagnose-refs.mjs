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

const show = (label, r) => {
  console.log(`\n### ${label}: ${r.bytes} bytes, ${r.ms.toFixed(0)}ms, isError=${r.isError}`);
  const files = [
    ...new Set([...r.text.matchAll(/"([^"]*?\\\\[^"]*?\.[cm]?tsx?)"/g)].map((m) => m[1])),
  ];
  console.log(
    '   files mentioned:',
    files.length ? files.map((f) => f.replace(/\\\\/g, '/')) : '(none)',
  );
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

  console.log(
    `\nVERDICT: cold=${cold.bytes}B warm=${warm.bytes}B -> ` +
      (warm.bytes > cold.bytes
        ? 'explanation (B): results depend on what tsserver has loaded'
        : 'explanation (A): cross-file references genuinely not resolved'),
  );
} catch (err) {
  console.error('DIAGNOSTIC FAILED:', err.message);
  console.error(client.stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  await client.stop();
}
