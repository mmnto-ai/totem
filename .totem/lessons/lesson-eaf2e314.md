## Lesson — AI agent hook/lifecycle events by provider (as

**Tags:** hooks, lifecycle, claude-code, gemini-cli, copilot, junie, agent-config, reference

AI agent hook/lifecycle events by provider (as of 2026-03-15):

## Claude Code (17+ events)

Config: Claude Code settings JSON → `hooks` object. Scripts in project hooks directories.

- **SessionStart** — session begins or resumes
- **UserPromptSubmit** — before Claude processes a user message (can block, can inject additionalContext)
- **PreToolUse** — before a tool call; can deny/allow via `permissionDecision` (matcher filters by tool name)
- **PermissionRequest** — when a permission dialog appears; can auto-allow/deny
- **PostToolUse** — after tool succeeds (informational)
- **PostToolUseFailure** — after tool fails (informational)
- **Stop** — when Claude finishes responding (can block to force more work)
- **SessionEnd** — session terminates
- **SubagentStart** / **SubagentStop** — subagent lifecycle
- **PreCompact** — before context compaction
- **Notification** — system alerts
- **WorktreeCreate** — worktree operations
- Plus additional events for tasks, config changes, etc.

Communication: JSON on stdin, JSON on stdout. Exit 0 = allow, Exit 2 = block (for blocking events).

## Gemini CLI (11 events)

Config: Gemini settings JSON → `hooks` object. Scripts in project hooks directories.

- **SessionStart** / **SessionEnd** — session lifecycle
- **BeforeAgent** — after user prompt, before agent planning
- **AfterAgent** — after agent loop ends per turn
- **BeforeModel** / **AfterModel** — before/after LLM request
- **BeforeToolSelection** — before LLM selects tools
- **BeforeTool** / **AfterTool** — before/after tool invocation (BeforeTool can block)
- **PreCompress** — before history summarization
- **Notification** — system alerts

Communication: JSON on stdin/stdout. Synchronous execution.

## GitHub Copilot (8 events)

Config: `.github/hooks/*.json` (committed to repo).

- **SessionStart** — first prompt of session
- **UserPromptSubmit** — user sends a prompt
- **PreToolUse** / **PostToolUse** — before/after tool calls (PreToolUse can deny)
- **PreCompact** — before context compaction
- **SubagentStart** / **SubagentStop** — subagent lifecycle
- **Stop** — session ends

## JetBrains Junie

No hook system yet. Feature request tracked as JUNIE-1961 on YouTrack.
