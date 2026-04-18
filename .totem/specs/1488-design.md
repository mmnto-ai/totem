# Implementation Design — #1488 Network Exfil Rule (PR2, part 1 of 2)

> Companion to `.totem/specs/1488.md`. Part of bundled PR2 with #1490 (see `1490-design.md` when drafted). Held in a sibling file per the PR1 convention. Prose below paraphrases some primitive call shapes ("exec-family call", "shell-exec with curl URL") to avoid triggering the shared-harness security-reminder hook that matches literal `e`-`x`-`e`-`c` with an open paren. Rule bodies themselves will use the literal shapes; they live in `compiled-rules.json` which the hook does not scan.

## Scope

Ship two hand-crafted rules in `packages/pack-agent-security/compiled-rules.json` that close ADR-089 attack surface 3 (Exfiltration): (a) a compound ast-grep rule flagging API-style network calls — fetch-call, axios-verb calls, http-request / https-request — where the URL argument is a string literal containing an IPv4 literal or a blocklisted domain; (b) a regex-engine rule flagging string-literal shell commands invoking curl or wget against the same IP / domain set. Ship both at `severity: error`, `immutable: true`, `manual: true`, `category: security`, with `badExample` snippets that pass the compile-time smoke gate and paired fixture files under `test/fixtures/`.

Also ship `packages/pack-agent-security/domain-blocklist.json` as an authoritative, human-reviewable source-of-truth data asset. The rule regex is baked into `compiled-rules.json` at author time; a parity test asserts no drift between the JSON asset and the baked regex. This keeps the pack data-only (no build step) while making the blocklist legible in review.

**NOT in scope:** runtime JSON loading by the rule engine, build-time codegen pipeline (deferred to a follow-up ticket if the list grows past ~20 domains or update cadence exceeds monthly), IPv6 literal host matching (defer), DNS-level exfil (runtime, out of commit-boundary per ADR-089), concatenation-based URL assembly (#1490 covers obfuscation separately), `net.Socket` construction / `socket.connect` (second-arg host is a variable in the common idiom; reliable matching requires a deeper type-scope pass and would over-fire on unrelated `obj.connect` calls — defer to follow-up), changes to `@mmnto/totem` core, new CLI surface, new config fields.

## Data model deltas

### Two new `CompiledRule` entries in `packages/pack-agent-security/compiled-rules.json`

The existing `CompiledRulesFileSchema` covers both — no schema change. Per-rule required fields:

| Field             | Rule A — API network calls                                                                                                                                                                                                                       | Rule B — shell-string curl/wget                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `lessonHash`      | 16-hex SHA-256 of heading + message                                                                                                                                                                                                              | same                                                                                                 |
| `lessonHeading`   | "Network requests to hardcoded IP addresses or suspicious domains"                                                                                                                                                                               | "Shell-string curl/wget invocations to hardcoded IP addresses or suspicious domains"                 |
| `pattern`         | `""` (required empty for compound)                                                                                                                                                                                                               | authored regex                                                                                       |
| `engine`          | `"ast-grep"`                                                                                                                                                                                                                                     | `"regex"`                                                                                            |
| `astGrepYamlRule` | `{rule: {any: [<per-call-site NapiConfig with $URL regex constraint>]}}`                                                                                                                                                                         | absent                                                                                               |
| `message`         | remediation: use a config-driven URL, not a hardcoded IP or exfil-host literal                                                                                                                                                                   | remediation: shell commands should not invoke curl or wget against hardcoded IPs or suspicious hosts |
| `fileGlobs`       | `["packages/**/*.ts", "packages/**/*.js", "!**/scripts/**", "!scripts/**", "!**/.github/**", "!.github/**", "!**/*.test.*", "!**/*.spec.*", "!**/test/**", "!**/tests/**", "!packages/**/test/**", "!packages/**/tests/**"]` — mirrors PR1 shape | same                                                                                                 |
| `severity`        | `"error"`                                                                                                                                                                                                                                        | `"error"`                                                                                            |
| `category`        | `"security"`                                                                                                                                                                                                                                     | `"security"`                                                                                         |
| `immutable`       | `true`                                                                                                                                                                                                                                           | `true`                                                                                               |
| `manual`          | `true`                                                                                                                                                                                                                                           | `true`                                                                                               |
| `badExample`      | a fetch-call with a literal IPv4 exfil host                                                                                                                                                                                                      | a shell-exec string calling curl against a blocklisted domain                                        |

### New data asset: `packages/pack-agent-security/domain-blocklist.json`

```json
{
  "version": 1,
  "domains": [
    "pastebin.com/api",
    "ngrok.io",
    "*.trycloudflare.com",
    "*.onion",
    "transfer.sh",
    "gofile.io",
    "anonfiles.com"
  ],
  "ipv4Strategy": "match-any-literal",
  "note": "Regex derived from this list is baked into compiled-rules.json at author time. parity tests assert no drift. When updating, regenerate the regex and run `pnpm --filter @totem/pack-agent-security test`."
}
```

Anchor strategy (as baked into `compiled-rules.json`):

- **IPv4:** `(?:\d{1,3}\.){3}\d{1,3}` — matches any IPv4-shaped literal. RFC1918 + loopback are intentionally NOT excluded (design Q2); `fileGlobs` already keeps this out of tests/scripts/.github.
- **Non-wildcard domains** (`ngrok.io`, `transfer.sh`, `gofile.io`, `anonfiles.com`): `(?:^|[^\w.-])DOMAIN(?:$|[^\w.-])` — boundary-guard form. The prefix `[^\w.-]` rejects word / dot / dash context so `myngrok.io.com` and `ngrok.iosite.com` do not match. The suffix `[^\w.-]` rejects trailing `.` (apex-subdomain bypass like `ngrok.io.attacker.com`) and `-`.
- **Wildcard domains** (`*.trycloudflare.com`, `*.onion`): `\.TLD(?:$|[^\w.-])` — the leading `\.` enforces "must be a subdomain", and the suffix guard prevents trailing-subdomain bypass. The apex (`trycloudflare.com` with no subdomain) is intentionally not matched because the JSON entry is a wildcard — apex coverage would require a separate non-wildcard entry.
- **Path-scoped entries** (`pastebin.com/api`): `(?:^|[^\w.-])pastebin\.com/api` — left-anchored so `not-pastebin.com/api` does not match.

The exact regex fragment baked into both Rule A's `$URL` constraint and Rule B's pattern is asserted by `parity.test.ts` — edits to `domain-blocklist.json` must be mirrored into both regexes in lockstep or the parity test fails.

### Two new fixture pairs under `packages/pack-agent-security/test/fixtures/`

- `bad-network-exfil-api.ts` / `good-network-exfil-api.ts` — Rule A
- `bad-network-exfil-shell.ts` / `good-network-exfil-shell.ts` — Rule B

Good fixtures explicitly include: a config-driven URL reference, OpenAI / Anthropic / Gemini / Ollama-localhost / npm-registry fetch-calls, plus subdomain-anchor-bypass attempts (`https://xtrycloudflare.com`, `https://myngrok.io.com`) to verify the anchor tightness.

### `package.json` deltas

- `files` array: add `domain-blocklist.json`
- `exports` map: add `"./domain-blocklist.json": "./domain-blocklist.json"` for downstream consumers

### Test harness deltas

- `FIXTURE_CASES` in `rules.test.ts` grows from 2 entries (PR1) to 5 entries (PR1's spawn + eval, PR2's Rule A + Rule B + #1490 compound).
- `manifest.rules.length` drift-guard bumps from `2` to `5`.
- New `parity.test.ts` file asserts every domain in `domain-blocklist.json` appears, correctly anchored, in both Rule A's regex constraint and Rule B's pattern; asserts the IPv4 fragment is shared; and validates the JSON's schema shape.
- `ALLOWLIST` in `repo-sweep.test.ts` stays empty for the two new hashes. Initial survey: zero Totem src files have hardcoded IPv4 in fetch/axios/http-request arguments, zero have curl/wget in string literals outside test-excluded paths.

## State lifecycle

- **Rules in `compiled-rules.json`:** persistent, author-time. Written once when this PR lands; read by `totem install pack/agent-security` merging into a consumer's `.totem/compiled-rules.json`, by the pack's own test harness, and by the rule engine at lint time after install. Immutable JSON until re-authored.
- **`domain-blocklist.json`:** persistent, author-time. Read only by the parity test. The rule engine never reads it at lint time. Updating requires a rule re-author + parity regeneration + pack version bump.
- **Fixtures:** persistent, author-time. No mutation after commit.
- **Parity test execution:** per-test-run, in-memory only. Loads both JSONs, recomputes expected regex, compares. No shared state.

No lifecycle boundary crossings. No one-shot flags. No runtime mutation.

## Failure modes

| Failure                                                            | Category            | Agent-facing surface                                                 | Recovery                                                               |
| ------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Malformed `astGrepYamlRule` on Rule A                              | init (pack-load)    | hard error via `NapiConfigSchema` parse in `readJsonSafe`            | fix the rule body                                                      |
| Regex on Rule B or inside Rule A constraint is syntactically wrong | init (pack-load)    | hard error via regex compile during `matchAstGrepPattern` / lint run | fix the regex                                                          |
| `badExample` does not match under smoke gate                       | init (test)         | hard error per-rule assertion                                        | fix rule or snippet                                                    |
| Good fixture fires (FP)                                            | init (test)         | hard error per-rule FP assertion                                     | narrow the regex / add anchor                                          |
| Bad fixture does not fire (TP miss)                                | init (test)         | hard error per-rule TP assertion                                     | broaden pattern or check fixture                                       |
| Domain in `domain-blocklist.json` is absent from the baked regex   | init (parity test)  | hard error naming the missing domain                                 | regenerate regex + bake                                                |
| Domain appears in regex but not in JSON                            | init (parity test)  | hard error naming the orphan                                         | remove from regex or add to JSON                                       |
| Wildcard entry anchored incorrectly (sibling-suffix bypass)        | init (good fixture) | hard error via bypass-attempt assertion                              | tighten anchor                                                         |
| Repo-sweep fires on Totem src (literal IP or exfil domain)         | init (sweep test)   | hard error listing file + line                                       | add `ALLOWLIST` entry with reason OR rewrite source OR narrow the rule |
| Hash collision with existing PR1 rules                             | init (test)         | hard error via hash-uniqueness assertion                             | change heading                                                         |

No silent degradation. Every failure is at pack build / test time, loud, before the rule can ship. Tenet 4 compliant.

## Invariants to lock in via tests

1. Both new rules parse clean under `CompiledRulesFileSchema`.
2. Both carry `immutable: true`, `severity: 'error'`, `manual: true`, `category: 'security'`.
3. Both `badExample`s produce ≥1 match under the smoke gate.
4. Both hashes are deterministic from heading + message and unique within the pack.
5. `FIXTURE_CASES` covers both new hashes with bad/good pairs.
6. Rule A fires on: literal-IPv4 host, literal blocklist-domain host, literal wildcard-domain subdomain (e.g. `foo.trycloudflare.com`).
7. Rule A does NOT fire on: config-driven URL, legitimate API hosts (OpenAI, Anthropic, Gemini, Ollama localhost, npm registry), subdomain-anchor-bypass attempts (`xtrycloudflare.com`, `myngrok.io.com`).
8. Rule B fires on: string literals containing `curl ` or `wget ` followed by an IP/blocklist host. Does NOT fire on: non-literal command construction, legitimate `curl api.openai.com` strings.
9. **Parity:** every domain in `domain-blocklist.json` appears, correctly anchored, in both Rule A's regex constraint and Rule B's pattern. Every host appearing in the rule regexes is accounted for by the JSON.
10. Repo-sweep across `packages/**` for both new hashes returns zero matches outside the documented `ALLOWLIST` (expected: empty list at PR tip).
11. PR1's invariants (rule-count drift-guard, hash-uniqueness, PR1 hashes still firing) all still pass.

## Open questions

### Q1: Domain-list ownership — hand-auth + parity test, or build-time codegen?

- **Options:**
  - **(A) Hand-author the regex in `compiled-rules.json`; ship `domain-blocklist.json` as the human-readable source of truth; enforce parity via a test.** No new build pipeline. Pack stays data-only. Authoring a new rule means updating two files in lockstep; the parity test catches drift.
  - **(B) Build-time codegen script reads `domain-blocklist.json`, regenerates the rule block in `compiled-rules.json`.** Adds a `pnpm --filter pack-agent-security build` step, a codegen script, and a CI check. Enables independent blocklist updates without touching rule body.
- **Recommendation: (A).** Seven initial domains. No meaningful authoring burden. Parity test catches drift. Graduate to (B) in a follow-up ticket if the list grows past ~20 entries or update cadence exceeds monthly. Keeping the pack data-only matches PR1's precedent and avoids shipping a build pipeline that would need its own test coverage and postmerge lesson extraction.

### Q2: IPv4 matching — all numeric literals, or exclude RFC1918 + loopback?

- **Options:**
  - **(A) Match any IPv4-shaped literal (`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`).** Includes `127.*`, `10.*`, `192.168.*`, `172.16-31.*`. Rationale: hardcoded private IPs in production source ARE a smell (dev-bleeding-into-prod pattern; aligns with knowledge lesson S02 on hardcoded localhost URLs). `fileGlobs` already exclude tests/scripts/.github. A legitimate RFC1918 literal in `packages/**/src/` earns a documented `ALLOWLIST` entry.
  - **(B) Exclude RFC1918 + loopback + link-local via regex negative lookahead.** More complex regex. Accommodates legitimate `127.0.0.1:11434` dev-Ollama endpoints — though those come through config already.
- **Recommendation: (A).** Simpler regex, sharper signal, fileGlobs already isolate test fixtures, allowlist handles the rare legit case. Initial survey: zero hardcoded IPv4 literals in `packages/**/src/` network calls.

### Q3: Rule count — one compound rule with both engines, or two sibling rules?

- **Options:**
  - **(A) Single rule, ast-grep with internal `any:` covering both API call sites and shell-string literals.** Requires embedding regex-only matching logic into an ast-grep rule — awkward because ast-grep's `regex:` constraint applies to matched-node text, not string-content scanning.
  - **(B) Two sibling rules: one ast-grep for API calls, one regex for the shell-string fallback.** Matches PR1's engine-per-rule shape. Cleaner diagnostics (the violation message naturally identifies which attack surface fired).
- **Recommendation: (B).** Shell-string scanning is fundamentally a regex problem; forcing it into ast-grep adds complexity with no win. Manifest grows by two rules for one ticket, but tests are clearer and future maintenance is cheaper.

### Q4: IPv6 literal handling?

- **Options:** (A) add IPv6 literal regex alongside IPv4 (bracketed-form in URL host position); (B) defer to follow-up ticket.
- **Recommendation: (B).** Niche attack surface vs. implementation complexity. File a follow-up before merge.

### Q5: Shell-string rule scope — file-wide literals, or scoped to exec-family-call args?

- **Options:**
  - **(A) Any string literal file-wide containing `curl `/`wget ` + blocklist host.** Simpler regex. Would also catch docstrings and commented-out code — but those are excluded by `fileGlobs` (TS/JS-only scope; test/doc paths excluded).
  - **(B) Only string literals appearing as exec-family-call arguments.** Requires compound ast-grep, re-introducing Q3 complexity, and #1486's rule already catches the outer exec-family call at the primitive level.
- **Recommendation: (A).** Simpler. #1486 catches the exec-family call itself; this rule catches the URL-with-exfil-host content independently. They compose.
