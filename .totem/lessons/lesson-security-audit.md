## Lesson — Key security audit findings and acceptable risks

**Tags:** security, mcp, audit

The v1.3.1 security audit of the MCP server and shell orchestrator found no critical vulnerabilities. Key findings and mitigations:

1. Unbounded `max_results` in MCP search could cause memory exhaustion. Fix: capped to 100 via Zod `.max()`.
2. `taskkill` on Windows used string interpolation via `execSync`. Fix: switched to `execFileSync` with array args.
3. `child.kill()` with `shell: true` on Unix doesn't kill the process tree. Fix: `detached: true` + `process.kill(-pid)` for process group termination.
4. Model name injection via shell orchestrator is blocked by `MODEL_NAME_RE = /^[\w./:_-]+$/` — all shell metacharacters are excluded.
5. Cross-repo `totem link` exposes linked knowledge to AI agents via MCP. Mitigated with a security warning; full RBAC deferred to cloud control plane.
6. Lesson content in LLM prompts is a prompt injection vector, but lessons are trusted content from the same user who controls the config — acceptable risk.
