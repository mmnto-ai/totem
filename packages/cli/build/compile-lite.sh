#!/bin/bash
# Cross-compile the Totem Lite binary for all target platforms.
# Requires: bun installed, esbuild bundle already built.
#
# Usage: ./compile-lite.sh [target]
#   No argument = build all platforms
#   target = one of: linux-x64, darwin-arm64, win32-x64

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE="$CLI_ROOT/dist/lite/totem-lite.mjs"
WASM_DIR="$CLI_ROOT/dist/lite/wasm"
OUT_DIR="$CLI_ROOT/dist/lite/bin"

if [ ! -f "$BUNDLE" ]; then
  echo "[Lite Compile] Bundle not found. Run esbuild first:"
  echo "  node packages/cli/build/esbuild-lite.mjs"
  exit 1
fi

mkdir -p "$OUT_DIR"

compile_target() {
  local target="$1"
  local outfile="$2"

  echo "[Lite Compile] Building $target → $outfile"
  bun build --compile \
    --target="bun-$target" \
    "$BUNDLE" \
    --outfile "$outfile"

  if [ -f "$outfile" ] || [ -f "$outfile.exe" ]; then
    # Size thresholds calibrated to Bun 1.2.x standalone runtime (~60 MB baseline).
    # Our TS+WASM payload is ~7.7 MB; the rest is Bun's embedded runtime.
    # A separate 15 MB granular gate in release-binary.yml catches bundle leaks
    # directly (e.g. an LLM SDK accidentally un-externalized). These final-binary
    # caps are the end-to-end ceiling. See strategy proposal 214.
    local warn_limit=$((75 * 1024 * 1024))
    local hard_limit=$((90 * 1024 * 1024))
    local size
    if [ -f "$outfile.exe" ]; then
      size=$(stat -c%s "$outfile.exe" 2>/dev/null || stat -f%z "$outfile.exe" 2>/dev/null)
    else
      size=$(stat -c%s "$outfile" 2>/dev/null || stat -f%z "$outfile" 2>/dev/null)
    fi
    local mb=$((size / 1024 / 1024))
    echo "[Lite Compile] $target: ${mb}MB"

    if [ "$size" -gt "$hard_limit" ]; then
      echo "[Lite Compile] WARNING: Binary exceeds 90MB hard limit!"
      exit 1
    elif [ "$size" -gt "$warn_limit" ]; then
      echo "[Lite Compile] WARNING: Binary exceeds 75MB target (but under 90MB cap)"
    fi
  fi
}

if [ $# -eq 0 ]; then
  # Build all targets
  compile_target "linux-x64" "$OUT_DIR/totem-lite-linux-x64"
  compile_target "darwin-arm64" "$OUT_DIR/totem-lite-darwin-arm64"
  compile_target "windows-x64" "$OUT_DIR/totem-lite-win32-x64"
else
  case "$1" in
    linux-x64)
      compile_target "linux-x64" "$OUT_DIR/totem-lite-linux-x64"
      ;;
    darwin-arm64)
      compile_target "darwin-arm64" "$OUT_DIR/totem-lite-darwin-arm64"
      ;;
    win32-x64)
      compile_target "windows-x64" "$OUT_DIR/totem-lite-win32-x64"
      ;;
    *)
      echo "Unknown target: $1"
      echo "Valid targets: linux-x64, darwin-arm64, win32-x64"
      exit 1
      ;;
  esac
fi

echo "[Lite Compile] Done."
