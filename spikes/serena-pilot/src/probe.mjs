// Bring-up probe: start the pinned serena MCP server, handshake, and dump the
// exposed tool list. This is the step that VERIFIES the retrieval-only bound
// rather than assuming it.

import { McpStdioClient } from './client.mjs';
import { serverSpec, EDITING_TOOLS, SHELL_TOOLS, MEMORY_TOOLS } from './config.mjs';

const spec = serverSpec();
console.log('command:', spec.command);
console.log('args:', JSON.stringify(spec.args, null, 2));
console.log('cwd:', spec.cwd);
console.log('SERENA_HOME:', spec.env.SERENA_HOME);

const client = new McpStdioClient(spec);
client.start();

const t0 = Date.now();
try {
  const init = await client.initialize();
  console.log(`\ninitialize OK in ${init.ms.toFixed(0)}ms`);
  console.log('serverInfo:', JSON.stringify(init.result?.serverInfo));

  const tools = await client.listTools();
  const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
  console.log(`\ntools/list OK in ${tools.ms.toFixed(0)}ms -- ${names.length} tools exposed:`);
  for (const n of names) console.log('  -', n);

  const leaked = {
    editing: names.filter((n) => EDITING_TOOLS.includes(n)),
    shell: names.filter((n) => SHELL_TOOLS.includes(n)),
    memory: names.filter((n) => MEMORY_TOOLS.includes(n)),
  };
  console.log('\nRETRIEVAL-ONLY CHECK:');
  console.log('  editing verbs exposed:', leaked.editing.length ? leaked.editing : 'NONE (pass)');
  console.log('  shell verbs exposed  :', leaked.shell.length ? leaked.shell : 'NONE (pass)');
  console.log('  memory verbs exposed :', leaked.memory.length ? leaked.memory : 'NONE (pass)');

  // Fail CLOSED. A config regression that re-exposes an editing, shell or
  // memory verb must not leave this probe reporting success.
  const prohibited = [...leaked.editing, ...leaked.shell, ...leaked.memory];
  if (prohibited.length > 0) {
    throw new Error(
      `retrieval-only bound VIOLATED -- prohibited tools exposed: ${prohibited.join(', ')}`,
    );
  }

  // In-band check of the ACTIVE set (exposed != active in serena; see
  // config/totem-pilot.yml for why).
  if (names.includes('get_current_config')) {
    const cfg = await client.callTool('get_current_config', {});
    console.log(`\n--- get_current_config (${cfg.bytes} bytes, ${cfg.ms.toFixed(0)}ms) ---`);
    console.log(cfg.text.slice(0, 4000));
  }
} catch (err) {
  console.error('\nPROBE FAILED:', err.message);
  console.error('\n--- server stderr (tail) ---');
  console.error(client.stderr.slice(-6000));
  console.error('--- exit info ---', JSON.stringify(client.exitInfo));
  process.exitCode = 1;
} finally {
  console.log(`\ntotal probe wall: ${Date.now() - t0}ms`);
  await client.stop();
}
