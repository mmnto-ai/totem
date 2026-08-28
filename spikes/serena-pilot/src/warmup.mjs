// Measures serena's INDEXING / language-server bring-up cost separately from
// per-task retrieval cost, per the pilot's measurement contract.
//
// Startup in serena is lazy: `initialize` returns before the TypeScript
// language server is spawned. The first symbol-level tool call is what pays
// for LSP launch + workspace indexing, so that call is timed on its own and
// reported as `indexing`, and a second identical call gives the warm cost.

import { McpStdioClient } from './client.mjs';
import { serverSpec } from './config.mjs';

const client = new McpStdioClient(serverSpec());
client.start();

try {
  const init = await client.initialize();
  console.log(`initialize: ${init.ms.toFixed(0)}ms`);

  const tools = await client.listTools();
  console.log(`tools/list: ${tools.ms.toFixed(0)}ms (${tools.result.tools.length} tools)`);

  console.log('\ncold find_symbol (pays for LSP bring-up + indexing)...');
  const cold = await client.callTool(
    'find_symbol',
    { name_path_pattern: 'compileRuleRecord', relative_path: '.' },
    { timeoutMs: 900000 },
  );
  console.log(`  cold: ${cold.ms.toFixed(0)}ms, ${cold.bytes} bytes, isError=${cold.isError}`);
  console.log('  ---- payload ----');
  console.log(cold.text.slice(0, 2500));

  console.log('\nwarm find_symbol (same call again)...');
  const warm = await client.callTool(
    'find_symbol',
    { name_path_pattern: 'compileRuleRecord', relative_path: '.' },
    { timeoutMs: 300000 },
  );
  console.log(`  warm: ${warm.ms.toFixed(0)}ms, ${warm.bytes} bytes, isError=${warm.isError}`);

  console.log(
    `\nINDEXING COST (cold - warm) = ${(cold.ms - warm.ms).toFixed(0)}ms; cold=${cold.ms.toFixed(0)}ms warm=${warm.ms.toFixed(0)}ms`,
  );
} catch (err) {
  console.error('\nWARMUP FAILED:', err.message);
  console.error('\n--- server stderr (tail) ---');
  console.error(client.stderr.slice(-8000));
  console.error('--- exit info ---', JSON.stringify(client.exitInfo));
  process.exitCode = 1;
} finally {
  await client.stop();
}
