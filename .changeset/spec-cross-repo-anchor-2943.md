---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem spec <issue-url>` fetches the issue from the repository the URL names (mmnto-ai/totem#2943). A URL's owner and repository were dropped and the number resolved against the working directory's repository: when that repository had no issue of the number the run failed with an authentication hint, and when it had one the run silently anchored on the wrong issue, which the strict pre-commit tier then accepted as an anchored run. One parser, `parseIssueInput`, now reads the three forms: a bare number (this repository, or every repository under `config.repositories`), `owner/repo#N`, and an issue URL (`github.com` gives `owner/repo`; another host gives `host/owner/repo`, the form `gh --repo` takes). The fetch runs against the named repository and never falls back to the working directory's, the log line says which repository the issue was fetched from, and an issue fetch's failure hint puts a wrong repository before authentication (other `gh` callers keep the generic hint; the hint is measured at the adapter). The anchor's `ref` still keeps the input as typed, so the run artifact and the gate's evidence line name the URL; the resolved repository is not written into the artifact separately.

The URL rule is exact (the review round on mmnto-ai/totem#2965): the path before `/issues/` is exactly `owner/repo`, the number ends its path segment (a query, a fragment or a slash may follow; `/issues/7abc` is not issue 7), the host is lower-cased and github.com's `www.` alias is folded so `gh --repo` never sees `www.github.com/owner/repo`, and GitLab's `/-/issues/<n>` form is refused by name rather than handed to `gh` as a host it cannot read. Every `http(s)://` input is an issue URL or an explicit refusal naming the reason and the accepted forms — never a free-text topic, which was an unanchored draft wearing an issue's clothes; the refusal is judged over every input before the first fetch. The default draft path keys on the repository the input named — `.totem/specs/<owner>-<repo>-<number>.md` for `owner/repo#N` or a URL, `<number>.md` for a bare number as before — so the same issue number in two repositories never shares a draft.
