#!/bin/bash
# Content Hash Utility — computes a deterministic hash of tracked source files.
# Used by both totem review (to stamp) and the PreToolUse hook (to verify).
# Hashes file CONTENTS, not Git metadata. Immune to commit/amend/rebase.
# MUST produce identical output to writeReviewedContentHash() in shield.ts.

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$GIT_ROOT"

# Use --stdin-paths (same as Node implementation) to ensure identical output
git ls-files -z '*.ts' '*.tsx' '*.js' '*.jsx' \
  | tr '\0' '\n' \
  | grep -v '^$' \
  | git hash-object --stdin-paths 2>/dev/null \
  | sha256sum \
  | cut -d' ' -f1
