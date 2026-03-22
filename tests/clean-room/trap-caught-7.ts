// Adversarial corpus: trap-caught for JSON.parse cast
// This code SHOULD trigger a violation.
// Rule: JSON.parse($A) as $B
// Bug: `as` cast provides zero runtime safety. Malformed or unexpected
// JSON silently passes. Use a schema validator (e.g., zod) instead.

interface Config {
  name: string;
  version: number;
}

function loadConfig(raw: string): Config {
  const config = JSON.parse(raw) as Config;
  return config;
}

export { loadConfig };
