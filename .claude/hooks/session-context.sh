#!/bin/bash
# SessionStart hook — auto-inject relevant knowledge context.
# Reads the current branch, extracts a ticket number, and searches
# the totem knowledge index. Output goes directly into Claude's context.
# Budget: ~2-3k tokens max (ADR-013).

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$GIT_ROOT"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
TICKET=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)

# Build a search query from branch context
if [ -n "$TICKET" ]; then
  # Try to get ticket title from GitHub (fast, cached)
  TITLE=$(gh issue view "$TICKET" --json title --jq '.title' 2>/dev/null)
  if [ -n "$TITLE" ]; then
    QUERY="$TITLE"
  else
    QUERY="ticket $TICKET $(echo "$BRANCH" | tr '/-' ' ')"
  fi
else
  QUERY=$(echo "$BRANCH" | tr '/-' ' ')
fi

# Search knowledge index — capture results
if command -v totem >/dev/null 2>&1; then
  TOTEM_CMD="totem"
elif [ -f pnpm-workspace.yaml ] && pnpm exec totem --version >/dev/null 2>&1; then
  TOTEM_CMD="pnpm exec totem"
else
  TOTEM_CMD=""
fi

echo "── Session Context ──"
echo "Branch: $BRANCH"
[ -n "$TICKET" ] && echo "Ticket: #$TICKET"
echo ""

# Search both dev and strategy indexes via MCP isn't available in bash.
# Instead, output a reminder to use the tools.
echo "Totem knowledge indexes are available. Before starting work:"
echo "  - mcp__totem-dev__search_knowledge: lessons, specs, code context"
echo "  - mcp__totem-strategy__search_knowledge: ADRs, proposals, research"
echo ""

# Inject the most recent journal entry for continuity
JOURNAL_DIR="$GIT_ROOT/.strategy/.journal"
if [ -d "$JOURNAL_DIR" ]; then
  LATEST=$(ls -t "$JOURNAL_DIR"/*.md 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "Latest journal: $(basename "$LATEST")"
    # First 20 lines only (token budget)
    head -20 "$LATEST" 2>/dev/null
    echo "..."
    echo ""
  fi
fi

# If there's an active proposal, surface it
PROPOSALS_DIR="$GIT_ROOT/.strategy/proposals/active"
if [ -d "$PROPOSALS_DIR" ] && [ -n "$TICKET" ]; then
  MATCH=$(grep -rl "#$TICKET\|$TICKET" "$PROPOSALS_DIR" 2>/dev/null | head -1)
  if [ -n "$MATCH" ]; then
    echo "Active proposal: $(basename "$MATCH")"
    head -10 "$MATCH" 2>/dev/null
    echo "..."
    echo ""
  fi
fi

echo "── End Session Context ──"
