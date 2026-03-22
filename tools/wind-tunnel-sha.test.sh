#!/bin/sh
set -e

# wind-tunnel-sha.test.sh
# Integration test for update-wind-tunnel-sha.sh
# Creates a temp git repo, exercises generate + verify, then cleans up.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/update-wind-tunnel-sha.sh"
TMPDIR_BASE="${TMPDIR:-/tmp}"
WORK="$TMPDIR_BASE/wt-sha-test-$$"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

# ---- setup temp repo ----
mkdir -p "$WORK"
cd "$WORK"
git init -q
git config user.email "test@test.com"
git config user.name "Test"

mkdir -p .totem/tests
echo "rule-a content" > .totem/tests/test-rule-a.md
echo "rule-b content" > .totem/tests/test-rule-b.md
git add .totem/tests
git commit -q -m "initial fixtures"

# ---- test 1: verify fails when no .wind-tunnel-sha exists ----
if sh "$SCRIPT" --verify >/dev/null 2>&1; then
  fail "verify should fail when .wind-tunnel-sha is missing"
else
  pass "verify fails when .wind-tunnel-sha is missing"
fi

# ---- test 2: generate writes the SHA file ----
OUTPUT="$(sh "$SCRIPT" 2>&1)"
if [ -f ".wind-tunnel-sha" ]; then
  pass "generate creates .wind-tunnel-sha"
else
  fail "generate did not create .wind-tunnel-sha"
fi

# ---- test 3: SHA is a 40-char hex string ----
SHA="$(cat .wind-tunnel-sha | tr -d '[:space:]')"
if test "${#SHA}" -eq 40 && test -z "$(printf '%s' "$SHA" | tr -d '0-9a-f')"; then
  pass "SHA is 40-char hex ($SHA)"
else
  fail "SHA is not 40-char hex: '$SHA'"
fi

# ---- test 4: verify passes on unchanged fixtures ----
if sh "$SCRIPT" --verify >/dev/null 2>&1; then
  pass "verify passes on unchanged fixtures"
else
  fail "verify should pass on unchanged fixtures"
fi

# ---- test 5: modify a fixture, stage it, verify fails ----
echo "tampered content" > .totem/tests/test-rule-a.md
git add .totem/tests/test-rule-a.md
if sh "$SCRIPT" --verify >/dev/null 2>&1; then
  fail "verify should fail after fixture tamper"
else
  pass "verify fails after fixture tamper"
fi

# ---- test 6: re-generate after tamper produces a different hash ----
OLD_SHA="$SHA"
sh "$SCRIPT" >/dev/null 2>&1
NEW_SHA="$(cat .wind-tunnel-sha | tr -d '[:space:]')"
if [ "$OLD_SHA" != "$NEW_SHA" ]; then
  pass "regenerated SHA differs after tamper ($NEW_SHA)"
else
  fail "regenerated SHA should differ after tamper"
fi

# ---- test 7: verify passes again after regeneration ----
if sh "$SCRIPT" --verify >/dev/null 2>&1; then
  pass "verify passes after regeneration"
else
  fail "verify should pass after regeneration"
fi

# ---- summary ----
echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0 # totem-ignore — #840: standalone test script, not a git hook
