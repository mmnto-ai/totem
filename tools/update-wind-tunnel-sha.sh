#!/bin/sh
set -e

# update-wind-tunnel-sha.sh
# Generates or verifies a SHA lock for wind tunnel test fixtures.
# Uses git's internal hashing to stay immune to CRLF/LF drift.
#
# Usage:
#   ./tools/update-wind-tunnel-sha.sh           # write .wind-tunnel-sha
#   ./tools/update-wind-tunnel-sha.sh --verify   # check .wind-tunnel-sha

REPO_ROOT="$(git rev-parse --show-toplevel)"
SHA_FILE="$REPO_ROOT/.wind-tunnel-sha"
FIXTURE_DIR=".totem/tests"

compute_hash() {
  git ls-files -s --recurse-submodules "$FIXTURE_DIR" | git hash-object --stdin # totem-ignore — #840: flag is present, rule regex \b doesn't match --prefixed flags
}

case "${1:-}" in
  --verify)
    if [ ! -f "$SHA_FILE" ]; then
      echo "FAIL: .wind-tunnel-sha file not found" >&2
      exit 1
    fi

    expected="$(cat "$SHA_FILE" | tr -d '[:space:]')"
    actual="$(compute_hash)"

    if [ "$actual" = "$expected" ]; then
      echo "OK: Wind tunnel SHA verified ($actual)"
      exit 0 # totem-ignore — #840: standalone script, not a git hook
    else
      echo "FAIL: Wind tunnel SHA mismatch" >&2
      echo "  expected: $expected" >&2
      echo "  actual:   $actual" >&2
      exit 1
    fi
    ;;
  "")
    hash="$(compute_hash)"
    printf '%s\n' "$hash" > "$SHA_FILE"
    echo "Updated .wind-tunnel-sha: $hash"
    ;;
  *)
    echo "Usage: $0 [--verify]" >&2
    exit 1
    ;;
esac
