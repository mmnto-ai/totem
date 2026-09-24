---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The managed `.claude/hooks/gate-wrapper.cjs` (rendered by `totem gate install` from the template in `init-templates.ts`) now passes `killSignal: 'SIGKILL'` on both of its synchronous spawns, the `git` read and the node checker (mmnto-ai/totem#2932). Each spawn already carried a `timeout` derived from the wrapper's deadline, but Node's default kill signal is SIGTERM, which a wedged child can ignore, so on a POSIX seat (the macOS and Linux CI runners, liquid-city, the strategy seat) the deadline did not bound the hook. On win32 the kill is TerminateProcess whatever signal is named, so nothing changes there. The committed wrapper on this repository is regenerated from the template so the two stay byte-identical; a template test pins the option on both spawns. No skill text or hook behaviour changes.
