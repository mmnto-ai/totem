#!/bin/bash
# SessionStart hook — inject branch context, journal, and proposals.
# Output goes directly into Claude's context window.
# Budget: ~2-3k tokens max (ADR-013).
#
# This hook provides filesystem-based context (journal, proposals).
# MCP-based search (search_knowledge) is reminded but not invoked
# from bash — the agent calls it via MCP tools.

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$GIT_ROOT"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

# Extract ticket number from branch name (first numeric sequence)
if [[ "$BRANCH" =~ ([0-9]+) ]]; then
  TICKET="${BASH_REMATCH[1]}"
else
  TICKET=""
fi

echo "── Session Context ──"
echo "Branch: $BRANCH"
[ -n "$TICKET" ] && echo "Ticket: #$TICKET"
echo ""

# Remind agent of knowledge tools (MCP, not callable from bash)
echo "Knowledge tools available via MCP:"
echo "  - mcp__totem-dev__search_knowledge: lessons, specs, code"
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

# Surface active proposal matching this ticket (word-boundary match)
PROPOSALS_DIR="$GIT_ROOT/.strategy/proposals/active"
if [ -d "$PROPOSALS_DIR" ] && [ -n "$TICKET" ]; then
  MATCH=$(grep -rl "\b${TICKET}\b" "$PROPOSALS_DIR" 2>/dev/null | head -1)
  if [ -n "$MATCH" ]; then
    echo "Active proposal: $(basename "$MATCH")"
    head -10 "$MATCH" 2>/dev/null
    echo "..."
    echo ""
  fi
fi

echo "── End Session Context ──"
