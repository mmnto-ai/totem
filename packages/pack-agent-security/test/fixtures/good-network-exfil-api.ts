// Fixture for rule 79353234aa907cd9 — legitimate network calls that MUST NOT
// fire the rule. Covers config-driven URLs, known legitimate API hosts, and
// subdomain-anchor bypass attempts the rule's regex must decline.

// ─── Config-driven URLs (variable references, not string literals) ────
export async function ok_config_fetch(config: { API_URL: string }) {
  return fetch(config.API_URL);
}

export async function ok_template_fetch(base: string, path: string) {
  return fetch(`${base}${path}`);
}

export async function ok_env_fetch() {
  return fetch(process.env.API_URL!);
}

// ─── Legitimate API hosts (NOT on the blocklist) ──────────────────────
export async function ok_openai_fetch() {
  return fetch('https://api.openai.com/v1/messages');
}

export async function ok_anthropic_fetch() {
  return fetch('https://api.anthropic.com/v1/messages');
}

export async function ok_gemini_fetch() {
  return fetch('https://generativelanguage.googleapis.com/v1/models');
}

export async function ok_ollama_local() {
  // Localhost with named-host form — no IPv4 literal.
  return fetch('http://localhost:11434/api/generate');
}

export async function ok_npm_registry_fetch() {
  return fetch('https://registry.npmjs.org/@mmnto/totem');
}

export async function ok_github_api_axios() {
  const axios: any = null as any;
  return axios.get('https://api.github.com/repos/mmnto-ai/totem');
}

// ─── Subdomain-anchor bypass attempts (MUST NOT match) ────────────────
export async function ok_not_trycloudflare() {
  // `xtrycloudflare.com` — NOT a subdomain of trycloudflare.com. Anchor
  // must require a leading `.` before `trycloudflare.com`.
  return fetch('https://xtrycloudflare.com/legit');
}

export async function ok_not_ngrok() {
  // `myngrok.io.com` has `ngrok.io` as a substring but is not the host.
  // Anchor must require a non-word char before `ngrok.io`.
  return fetch('https://myngrok.io.com/api');
}

export async function ok_not_transfer_sh() {
  // `transfersh.example.com` does not match `transfer.sh` — preceded by
  // `s`, not a separator.
  return fetch('https://transfersh.example.com/ok');
}

export async function ok_not_anonfiles() {
  // `anonfilescom.attacker.com` would match if the anchor is weak. The
  // rule requires the literal `.com` after `anonfiles`.
  return fetch('https://anonfilescom.attacker.com/api');
}
