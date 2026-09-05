#!/usr/bin/env bash
# release-train-shape.sh — is HEAD's diff against <base-ref> exactly the release
# train's work? The legs-gate CI arm's one exemption (mmnto-ai/totem#2779; the
# caller is the `release-train check` step of .github/workflows/lint.yml, and the
# executed regression cases are packages/cli/src/commands/release-train-shape.test.ts).
#
# Writes `exempt=true` or `exempt=false` to $GITHUB_OUTPUT (stdout when unset),
# the reasons to stdout as plain log lines, and one static ::notice / ::warning
# annotation (no derived text rides the annotation). Exits non-zero only when the
# derivation itself fails (a bad ref, git absent): under `set -euo pipefail` that
# aborts the caller — fail-closed.
#
# Exempt only when ALL of these hold:
#   1. every changed path is a deleted .changeset/<name>.md, an added or modified
#      packages/<pkg>/CHANGELOG.md, or a modified packages/<pkg>/package.json —
#      what `changesets/action` writes (`packages/*` is the workspace glob), the
#      patterns anchored on the WHOLE name-status line so a path carrying
#      whitespace never matches;
#   2. the deleted changesets are EXACTLY the pending changesets at the merge
#      base (README excluded from pending, so deleting it is a mismatch) — the
#      train consumes all of them, never a subset, and it deletes nothing else;
#   3. when changesets were pending, at least one CHANGELOG was rendered; when
#      nothing was pending, the diff is empty — the train writes nothing when it
#      has nothing to consume.
# What is NOT checked, by design: the CONTENT of the rendered CHANGELOG.md and
# package.json. Neither is an owed path (hooks.legsOwed.globs), so the legs floor
# never judged them; their correctness is the cut sensor's remit at the cut word.
# What this script proves is that the OWED changes in the diff — the changeset
# deletions — are precisely the train's consumption of the pending set.
# An empty diff with no pending changesets is exempt: there is nothing to judge,
# and the gate itself derives not-owed on it. Every filter consumes its whole
# input (`grep`, never `grep -q`): a `-q` early exit SIGPIPEs the echo on a large
# diff under pipefail and the condition reads false. Rename detection is OFF so a
# deleted changeset whose text resembles an added CHANGELOG is never paired into
# an R line the shape would reject.
set -euo pipefail

base="${1:?usage: release-train-shape.sh <base-ref>}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

# The pending set is read at the MERGE BASE — the commit the diff is taken
# against — so a changeset merged to main after the action regenerated the
# branch cannot appear in one list and not the other.
# Derivations fail LOUD and filters fail QUIET, kept in separate stages: every
# git call and every sort/sed stage runs without a `|| true`, so an unexpected
# failure aborts under `set -euo pipefail`; a `|| true` sits only on a single
# grep stage, where exit 1 is the expected "no line matched" state and nothing
# else can fail. `printf '%s\n'`, never `echo`: the text is git output and must
# reach the filters byte-for-byte whatever the shell's echo does with escapes.
mergeBase=$(git merge-base "$base" HEAD)
diff=$(git diff --name-status --no-renames "$mergeBase" HEAD)
changesetTree=$(git ls-tree --name-only "$mergeBase" .changeset/)
pendingRaw=$(printf '%s\n' "$changesetTree" | grep -E '^[.]changeset/[^/]+[.]md$' || true)
pendingRaw=$(printf '%s\n' "$pendingRaw" | grep -v -E '^[.]changeset/README[.]md$' || true)
pending=$(printf '%s\n' "$pendingRaw" | sort)
deletedRaw=$(printf '%s\n' "$diff" | grep -E '^D[[:space:]]+[.]changeset/[^/]+[.]md$' || true)
deleted=$(printf '%s\n' "$deletedRaw" | sed -E 's/^D[[:space:]]+//' | sort)
otherRaw=$(printf '%s\n' "$diff" | grep -v -E '^D[[:space:]]+[.]changeset/[^/]+[.]md$|^[AM][[:space:]]+packages/[^/[:space:]]+/CHANGELOG[.]md$|^M[[:space:]]+packages/[^/[:space:]]+/package[.]json$' || true)
other=$(printf '%s\n' "$otherRaw" | grep -v -E '^[[:space:]]*$' || true)
changelogs=$(printf '%s\n' "$diff" | grep -c -E '^[AM][[:space:]]+packages/[^/[:space:]]+/CHANGELOG[.]md$' || true)

bad=0
if [ -n "$other" ]; then
  echo "release-train check: paths outside the shape (not what the release train writes):"
  echo "$other"
  bad=1
fi
if [ "$deleted" != "$pending" ]; then
  echo "release-train check: the deleted changesets are not exactly the pending set at the merge base $mergeBase"
  echo "  pending at the merge base: $(echo "$pending" | paste -sd ' ' -)"
  echo "  deleted in HEAD:           $(echo "$deleted" | paste -sd ' ' -)"
  bad=1
fi
if [ -n "$pending" ] && [ "$changelogs" -eq 0 ]; then
  echo "release-train check: changesets consumed but no CHANGELOG rendered"
  bad=1
fi
if [ -z "$pending" ] && [ -n "$diff" ]; then
  echo "release-train check: nothing pending at the merge base, yet the diff is not empty — the train writes nothing when it has nothing to consume"
  bad=1
fi

if [ "$bad" -eq 0 ]; then
  echo "::notice title=totem legs gate SKIPPED::changeset-release/main carries exactly the release train's work — every pending changeset consumed, CHANGELOG and package.json rendered, nothing else — so the review-leg floor does not apply (mmnto-ai/totem#2779). The totem lint step still runs."
  echo "exempt=true" >> "$out"
else
  echo "::warning title=totem legs gate NOT skipped::changeset-release/main does not carry exactly the release train's work, so the review-leg floor applies (mmnto-ai/totem#2779); the reasons are in this step's log."
  echo "exempt=false" >> "$out"
fi
