// Adversarial corpus: trap-bypassed for JSON.parse cast
// This code SHOULD NOT trigger a violation.
// Parses as unknown first, then validates with a schema.

import { z } from 'zod';

const ConfigSchema = z.object({
  name: z.string(),
  version: z.number(),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(raw: string): Config {
  const parsed: unknown = JSON.parse(raw);
  const config = ConfigSchema.parse(parsed);
  return config;
}

export { loadConfig };
