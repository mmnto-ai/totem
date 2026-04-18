// Fixture for rule 6fa15756b8a004ef — legitimate shell-string curl/wget
// usages that MUST NOT fire. Covers benign hosts, config-driven URLs, and
// subdomain-anchor bypass attempts.

// ─── curl to legitimate hosts (NOT blocklisted) ─────
const ok_curl_openai = 'curl https://api.openai.com/v1/messages';
const ok_curl_github = 'curl https://api.github.com/repos/mmnto-ai/totem';
const ok_curl_npm = 'curl https://registry.npmjs.org/@mmnto/totem';

// ─── wget to legitimate hosts ──────────────────────
const ok_wget_github = 'wget https://github.com/foo/bar/releases/download/v1';

// ─── Config-driven URLs inside curl strings ────────
const apiUrl = 'https://api.example.com';
const ok_curl_templated = `curl ${apiUrl}/v1/endpoint`;
const ok_curl_envvar = 'curl $API_URL/v1/endpoint';

// ─── Comments that mention curl but no exfil URL ───
// The rule's regex requires curl/wget + a blocklisted host on the same line.
// Mentions alone should not fire.
// curl down with a good book.
// Consider wget over HTTP/2 for performance.

// ─── Subdomain-anchor bypass attempts ──────────────
// `xtrycloudflare.com` is not a subdomain of trycloudflare.com.
const ok_curl_xtrycloudflare = 'curl https://xtrycloudflare.com/legit';
// `myngrok.io.com` is not the ngrok.io host.
const ok_curl_myngrok = 'curl https://myngrok.io.com/api';
// `transfersh.example.com` not transfer.sh.
const ok_curl_transfersh = 'curl https://transfersh.example.com/api';

// Version-shaped strings in comments are an expected limitation: the
// per-line regex cannot see context, so a comment containing curl or wget
// alongside an IPv4-shaped version would match. Keep the rule narrow by not
// writing such patterns in production source. No literal example is provided
// here because including one would trip the rule in this fixture.
