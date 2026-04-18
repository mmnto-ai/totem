// Fixture: the #1488 Rule A MUST NOT fire on any call below. Covers
// config-driven URLs, legitimate API hosts, and subdomain-anchor bypass
// attempts the regex must decline.
/* eslint-disable no-undef */

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const fetch: (...a: unknown[]) => unknown;
declare const axios: {
  get: (...a: unknown[]) => unknown;
};
declare const config: { API_URL: string };
declare const base: string;
declare const path: string;

// --- Config-driven URLs (variable references, not string literals) ---
fetch(config.API_URL);
fetch(`${base}${path}`);
fetch(process.env.API_URL!);

// --- Legitimate API hosts (NOT on the blocklist) ---
fetch('https://api.openai.com/v1/messages');
fetch('https://api.anthropic.com/v1/messages');
fetch('https://generativelanguage.googleapis.com/v1/models');
fetch('http://localhost:11434/api/generate');
fetch('https://registry.npmjs.org/@mmnto/totem');
axios.get('https://api.github.com/repos/mmnto-ai/totem');

// --- Subdomain-anchor bypass attempts (MUST NOT match) ---
// `xtrycloudflare.com` — NOT a subdomain of trycloudflare.com.
fetch('https://xtrycloudflare.com/legit');
// `myngrok.io.com` has `ngrok.io` as a substring but is not the host.
fetch('https://myngrok.io.com/api');
// `transfersh.example.com` — preceded by `s`, not a separator.
fetch('https://transfersh.example.com/ok');
// `anonfilescom.attacker.com` — no literal `.com` after `anonfiles`.
fetch('https://anonfilescom.attacker.com/api');
