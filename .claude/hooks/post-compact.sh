#!/bin/bash
# Re-inject critical rules + capability manifest after context compaction (ADR-063)
echo ""
echo "⚠️  CONTEXT COMPACTED — Critical rules:"
echo "  1. Run /preflight <issue> before starting ticket work"
echo "  2. Run /prepush BEFORE pushing (lint + shield)"
echo "  3. Use Closes #NNN in PR bodies"
echo "  4. Call mcp__totem-dev__search_knowledge before writing code"

cat << 'EOF'

📋 Capability Manifest:
  Commands: init, sync, lint, compile, shield, spec, extract, docs, link, lint-lessons, drift
  MCP Tools: search_knowledge (+ boundary param), add_lesson, verify_execution
  Partitions: core (packages/core/), cli (packages/cli/), mcp (packages/mcp/)
  Skills: /preflight, /prepush, /postmerge, /signoff
  Hooks: PreToolUse (blocks push without shield), PostCompact (this manifest)
  Engines: regex, ast (Tree-sitter), ast-grep
  Docs: .claude/docs/contributing.md, .claude/docs/architecture.md, .claude/docs/agent-workflow.md
  ⚡ AGENT DISCIPLINE: Delegate code+test tasks to background agents. You are the controller, not the implementer.

EOF
