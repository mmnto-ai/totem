---
'@mmnto/cli': minor
---

Observability leg in the totem-status refresh-gh spawn blocks (mmnto-ai/totem#2570, routed from the status seat's observed silent no-write): every managed firing site — the Claude and Gemini SessionStart templates and the git post-merge hook — now stamps a workspace-root log (`<workspace>/.totem-status-refresh-hook.log`: ISO time, firing site, cwd, and the PATH/cwd-shadow diagnostics on the Node sites; the resolved binary path on the shell site) and hands the child the same file descriptor, so the verb's own success line lands after the stamp. A stamp with nothing after it means the child never finished — discriminating a hook-harness process-tree reap from a child failure, which were previously indistinguishable under `stdio: 'ignore'` plus the verb's exit-0-or-nothing contract. Log failures degrade to the previous blind firing; the stamp never blocks or gates the spawn.
