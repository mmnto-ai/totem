// Fixture: the #1488 Rule B MUST NOT fire on any line below. Covers
// legitimate curl/wget targets, config-driven URLs, and subdomain-anchor
// bypass attempts.
/* eslint-disable no-undef */

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const log: (s: string) => void;
declare const apiUrl: string;

// --- curl / wget to legitimate hosts (NOT blocklisted) ---
log('curl https://api.openai.com/v1/messages');
log('curl https://api.github.com/repos/mmnto-ai/totem');
log('curl https://registry.npmjs.org/@mmnto/totem');
log('wget https://github.com/foo/bar/releases/download/v1');

// --- Config-driven URLs inside curl strings ---
log(`curl ${apiUrl}/v1/endpoint`);
log('curl $API_URL/v1/endpoint');

// --- Subdomain-anchor bypass attempts ---
// `xtrycloudflare.com` is not a subdomain of trycloudflare.com.
log('curl https://xtrycloudflare.com/legit');
// `myngrok.io.com` is not the ngrok.io host.
log('curl https://myngrok.io.com/api');
// `transfersh.example.com` not transfer.sh.
log('curl https://transfersh.example.com/api');

// Documentation note: version-shaped strings in comments are an expected
// limitation — per-line regex cannot see context, so a comment containing
// curl or wget alongside an IPv4-shaped version number would match. Do not
// write such patterns in production source. No literal example here because
// including one would trip the rule in this fixture.
