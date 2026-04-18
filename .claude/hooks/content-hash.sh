#!/bin/bash
# Content Hash Utility — computes a deterministic hash of tracked source files.
# Used by both totem review (to stamp) and the PreToolUse hook (to verify).
# Hashes file CONTENTS, not Git metadata. Immune to commit/amend/rebase.
# MUST produce identical output to writeReviewedContentHash() in shield.ts.

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$GIT_ROOT"

DEFAULT_EXTS=('.ts' '.tsx' '.js' '.jsx')

EXTS_FILE=".totem/review-extensions.txt"
EXTS=()
if [ -f "$EXTS_FILE" ] && [ -s "$EXTS_FILE" ]; then
  REJECTED=0
  CANDIDATE=()
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    if ! echo "$line" | grep -qE '^\.[A-Za-z0-9.-]+$'; then
      REJECTED=1
      break
    fi
    CANDIDATE+=("$line")
  done < "$EXTS_FILE"
  if [ "$REJECTED" = "0" ] && [ "${#CANDIDATE[@]}" -gt 0 ]; then
    EXTS=("${CANDIDATE[@]}")
  else
    if [ "${TOTEM_DEBUG:-0}" = "1" ]; then
      echo "[Review] review-extensions.txt rejected; falling back to defaults" 1>&2
    fi
    EXTS=("${DEFAULT_EXTS[@]}")
  fi
else
  EXTS=("${DEFAULT_EXTS[@]}")
fi

LS_ARGS=()
for EXT in "${EXTS[@]}"; do
  LS_ARGS+=("*${EXT}")
done

git ls-files -z "${LS_ARGS[@]}" \
  | tr '\0' '\n' \
  | grep -v '^$' \
  | git hash-object --stdin-paths 2>/dev/null \
  | sha256sum \
  | cut -d' ' -f1
