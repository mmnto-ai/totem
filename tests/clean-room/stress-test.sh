#!/bin/bash
set -e

echo "═══════════════════════════════════════════"
echo "  Totem Stress Test — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Node: $(node --version)"
echo "═══════════════════════════════════════════"
echo ""

# ─── Setup: init totem in the test repo ──────────────
echo "[Setup] Initializing Totem..."
npx @mmnto/cli init --bare 2>&1 | tail -3
echo ""

# ─── Generate 100 files with 50 lines each (5,000 total) ────
echo "[Generate] Creating 100 files with 50 lines each..."
mkdir -p src/components src/utils src/hooks src/api src/lib

VIOLATIONS=0
FILE_COUNT=0

for dir in components utils hooks api lib; do
  for i in $(seq 1 20); do
    FILE_COUNT=$((FILE_COUNT + 1))
    FILE="src/${dir}/module-${i}.ts"
    {
      echo "import * as fs from 'node:fs';"
      echo "import * as path from 'node:path';"
      echo ""
      echo "export interface Config${i} {"
      echo "  name: string;"
      echo "  value: number;"
      echo "  enabled: boolean;"
      echo "}"
      echo ""
      echo "export function process${dir}${i}(input: string): string {"
      echo "  const result = input.trim().toLowerCase();"
      echo "  if (!result) {"
      echo "    return 'default';"
      echo "  }"
      echo "  return result;"
      echo "}"
      echo ""
      echo "export async function fetch${dir}${i}(url: string): Promise<string> {"
      echo "  const response = await fetch(url);"
      echo "  if (!response.ok) {"
      echo "    throw new Error('Request failed');"
      echo "  }"
      echo "  return response.text();"
      echo "}"
      echo ""

      # Inject violations every 5th file
      if [ $((i % 5)) -eq 0 ]; then
        # Violation: raw ${err} interpolation
        echo "function handleError(err: unknown): string {"
        echo "  return \`Operation failed: \${err}\`;"
        echo "}"
        VIOLATIONS=$((VIOLATIONS + 1))

        # Violation: console.log in non-CLI code
        echo "console.log('debug: module ${dir}-${i} loaded');"
        VIOLATIONS=$((VIOLATIONS + 1))
      fi

      # Pad to ~50 lines
      for j in $(seq 1 20); do
        echo "const _pad${j} = '${dir}-${i}-line-${j}';"
      done

      echo ""
      echo "export default { process${dir}${i}, fetch${dir}${i} };"
    } > "$FILE"
  done
done

echo "  Generated $FILE_COUNT files with $VIOLATIONS injected violations"
echo ""

# ─── Commit and create a branch diff ─────────────────
echo "[Git] Committing files to create branch diff..."
git checkout -b stress-test 2>/dev/null
git add -A
git commit -m "stress: 100 files with 5000 lines" --quiet
echo "  Committed on branch stress-test"
echo ""

# ─── Count total added lines ─────────────────────────
TOTAL_LINES=$(git diff main...HEAD --stat | tail -1)
echo "[Stats] $TOTAL_LINES"
echo ""

# ─── Run totem lint and measure time ─────────────────
echo "[Lint] Running 147 rules against the diff..."
echo ""

START_TIME=$(date +%s%N)
LINT_OUTPUT=$(npx @mmnto/cli lint 2>&1) || true
END_TIME=$(date +%s%N)

ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))
ELAPSED_S=$(echo "scale=2; $ELAPSED_MS / 1000" | bc)

echo "$LINT_OUTPUT"
echo ""
echo "═══════════════════════════════════════════"
echo "  PERFORMANCE RESULTS"
echo "  Files: $FILE_COUNT"
echo "  Injected violations: $VIOLATIONS"
echo "  Execution time: ${ELAPSED_S}s (${ELAPSED_MS}ms)"
echo "  Threshold: 10s"
if [ "$ELAPSED_MS" -lt 10000 ]; then
  echo "  Result: ✓ PASS — under 10s threshold"
else
  echo "  Result: ✗ FAIL — exceeded 10s threshold"
fi
echo "═══════════════════════════════════════════"
