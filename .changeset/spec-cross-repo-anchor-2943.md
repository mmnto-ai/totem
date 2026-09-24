---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem spec <issue-url>` fetches the issue from the repository the URL names (mmnto-ai/totem#2943). A URL's owner and repository were dropped and the number resolved against the working directory's repository: when that repository had no issue of the number the run failed with an authentication hint, and when it had one the run silently anchored on the wrong issue, which the strict pre-commit tier then accepted as an anchored run. One parser, `parseIssueInput`, now reads the three forms: a bare number (this repository), `owner/repo#N`, and an issue URL (`github.com` gives `owner/repo`; another host gives `host/owner/repo`, the form `gh --repo` takes; a GitLab path is kept as written and fails at `gh` naming the repository). The fetch runs against the named repository, the log line says which repository the issue was fetched from, and the failure hint says the issue must exist in that repository before it points at `gh auth status`. The anchor's `ref` still keeps the input as typed, so the run artifact and the gate's evidence line name the URL.
