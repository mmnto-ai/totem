#!/bin/bash
set -e

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠ $1"; WARN=$((WARN + 1)); }

echo "═══════════════════════════════════════════"
echo "  Totem Clean Room Test — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Node: $(node --version) | npm: $(npm --version)"
echo "═══════════════════════════════════════════"
echo ""

# ─── Test 1: Install via npx (no global install) ────
echo "[1/7] Install via npx..."
if npx @mmnto/cli --version 2>/dev/null; then
  pass "npx @mmnto/cli --version"
else
  fail "npx @mmnto/cli --version"
fi
echo ""

# ─── Test 2: totem init (non-interactive) ────────────
echo "[2/7] totem init --bare..."
if npx @mmnto/cli init --bare 2>&1; then
  pass "totem init --bare"
else
  fail "totem init --bare"
fi
echo ""

# ─── Test 3: Config file created ─────────────────────
echo "[3/7] Config file exists..."
if [ -f "totem.config.ts" ] || [ -f "totem.config.js" ]; then
  pass "totem.config exists"
else
  fail "totem.config missing"
fi
echo ""

# ─── Test 4: .totem directory created ────────────────
echo "[4/7] .totem directory exists..."
if [ -d ".totem" ]; then
  pass ".totem/ directory created"
else
  fail ".totem/ directory missing"
fi
echo ""

# ─── Test 5: Baseline lessons installed ──────────────
echo "[5/7] Baseline lessons..."
LESSON_COUNT=$(find .totem/lessons -name '*.md' 2>/dev/null | wc -l)
if [ "$LESSON_COUNT" -gt 0 ]; then
  pass "Found $LESSON_COUNT baseline lesson(s)"
else
  warn "No baseline lessons found (may be expected for --bare)"
fi
echo ""

# ─── Test 6: totem lint runs without crash ───────────
echo "[6/7] totem lint..."
LINT_OUTPUT=$(npx @mmnto/cli lint 2>&1) || true
if echo "$LINT_OUTPUT" | grep -q "PASS\|No changes detected\|No totem.config"; then
  pass "totem lint runs cleanly"
else
  if echo "$LINT_OUTPUT" | grep -qi "error\|crash\|Cannot find"; then
    fail "totem lint crashed: $(echo "$LINT_OUTPUT" | head -3)"
  else
    warn "totem lint unexpected output: $(echo "$LINT_OUTPUT" | head -3)"
  fi
fi
echo ""

# ─── Test 7: totem hooks --check ─────────────────────
echo "[7/7] totem hooks --check..."
HOOKS_OUTPUT=$(npx @mmnto/cli hooks --check 2>&1) || true
if echo "$HOOKS_OUTPUT" | grep -qi "installed\|Missing hook\|not a git"; then
  pass "totem hooks --check runs"
else
  warn "totem hooks --check unexpected output"
fi
echo ""

# ─── Summary ─────────────────────────────────────────
echo "═══════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed, $WARN warnings"
echo "═══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
