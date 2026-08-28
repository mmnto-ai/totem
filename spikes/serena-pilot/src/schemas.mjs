// Dumps the input schemas of the exposed serena tools, so the pilot's call
// sequences use real parameter names rather than guessed ones.

import { McpStdioClient } from './client.mjs';
import { serverSpec } from './config.mjs';

const client = new McpStdioClient(serverSpec());
client.start();
try {
  await client.initialize();
  const tools = await client.listTools();
  for (const t of tools.result.tools) {
    const props = t.inputSchema?.properties ?? {};
    const required = t.inputSchema?.required ?? [];
    console.log(`\n### ${t.name}`);
    console.log(`    required: ${JSON.stringify(required)}`);
    for (const [k, v] of Object.entries(props)) {
      const type = v.type ?? v.anyOf?.map((a) => a.type).join('|') ?? '?';
      const dflt = v.default !== undefined ? ` default=${JSON.stringify(v.default)}` : '';
      console.log(`      - ${k}: ${type}${dflt}`);
    }
  }
} finally {
  await client.stop();
}
