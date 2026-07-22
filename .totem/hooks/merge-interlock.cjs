// [totem] auto-generated — Claude Code MergeInterlock hook (mmnto-ai/totem#1762 A-slice)
// Denies a raw `gh pr merge` / raw merge-API invocation at the harness boundary,
// rerouting to the sanctioned `totem pr merge` actuator (which asserts merge-config
// posture + auto-close safety via the ONE shared evaluator before merging squash-only
// with no body flags). Agent-only by construction — humans never transit PreToolUse.
//
// BOUNDED-SURFACE CLAIM (ADR-082 Amendment 1, condition 2): blocks RECOGNIZABLE
// raw-merge invocations in a Bash command string. It does not defeat an
// aliased/renamed gh, a shell function, or an injected spawn (mmnto-ai/totem#2460
// class); D1 (PR-time check) + D2 (post-merge reconciliation) are the loud backstop.
//
// Exit-code contract (LOAD-BEARING):
//   0 = allow (not a Bash tool call, no raw-merge match, OR unparseable stdin →
//       fail-soft: A guards ONE invocation shape; an unrecognizable payload is out
//       of its bounded claim, and B + D1 + D2 remain the layered gates)
//   2 = block (Claude Code blocking convention) — the stderr message branches on
//       the matched arm: a recognizable raw-merge invocation vs a deny-on-undecidable
//       gh subcommand (substitution/variable after `gh pr` / `gh api`)
'use strict';

const MERGE_COMMAND_REGEX_SOURCE = "(?<![\\w-])gh(?:\\.exe)?(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+(?:(pr\\b(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+merge)(?![\\w-])|(pr\\b(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`))|(api\\b(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`|%|!)))";
// The gh..api anchor + the single-pass merge-API path scanner, inlined verbatim from
// @mmnto/totem (API_ANCHOR_SOURCE + findApiMergePaths). Closes the padding bypass
// (codex delta-3 #3): a literal /pulls/{n}/merge, a variable REST merge, and the
// graphql mergePullRequest mutation are detected with NO length-based allow.
const MERGE_API_ANCHOR_SOURCE = "(?<![\\w-])gh(?:\\.exe)?(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+api\\b";
function isMergeWordChar(ch) {
  return (
    ch !== undefined &&
    ((ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-')
  );
}

// Classify one command SEGMENT's post-api region for a raw merge-API path. region /
// regionLower are folded.slice(apiEnd, segEnd) and its lowercase twin (continuations
// removed, no ;|& or newline inside). Source-ordered: literal /pulls/<n>/merge, else a
// variable segment then /merge (undecidable), else graphql mergePullRequest.
function classifyApiMergeRegion(region, regionLower) {
  for (let p = regionLower.indexOf('/pulls/'); p !== -1; p = regionLower.indexOf('/pulls/', p + 1)) {
    let q = p + 7;
    let sawDigit = false;
    while (q < regionLower.length && regionLower[q] >= '0' && regionLower[q] <= '9') {
      q++;
      sawDigit = true;
    }
    if (sawDigit && regionLower.slice(q, q + 6) === '/merge' && !isMergeWordChar(regionLower[q + 6])) {
      return 'gh-api-merge';
    }
  }
  for (let v = 0; v < region.length; v++) {
    const ch = region[v];
    if (ch === '$' || ch === '`' || ch === '%' || ch === '!') {
      const mIdx = regionLower.indexOf('/merge', v);
      if (mIdx !== -1 && !isMergeWordChar(regionLower[mIdx + 6])) return 'gh-api-undecidable';
      break;
    }
  }
  const gq = regionLower.indexOf('graphql');
  if (gq !== -1) {
    const mpr = regionLower.indexOf('mergepullrequest', gq + 7);
    if (mpr !== -1 && !isMergeWordChar(regionLower[mpr + 16])) return 'gh-api-merge';
  }
  return null;
}

// Single left-to-right pass for the raw merge-API paths. De-fold shell (backslash+LF)
// / cmd.exe (^+LF) continuations once, then per command segment scan the FIRST gh..api
// anchor and one bounded in-segment literal scan — NO length-based allow, NO O(k*n)
// rescan (mmnto-ai/totem#1762 delta-4).
function findApiMergePaths(command) {
  const out = [];
  if (typeof command !== 'string' || command.length === 0) return out;
  let folded = '';
  const map = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const d = command[i + 1];
    if ((c === '\\' || c === '^') && (d === '\n' || (d === '\r' && command[i + 2] === '\n'))) {
      i += d === '\r' ? 2 : 1;
      continue;
    }
    folded += c;
    map.push(i);
  }
  const lower = folded.toLowerCase();
  const anchor = new RegExp(MERGE_API_ANCHOR_SOURCE, 'gi');
  let a;
  while ((a = anchor.exec(folded)) !== null) {
    const apiEnd = a.index + a[0].length;
    let segEnd = apiEnd;
    while (segEnd < folded.length && ';|&\r\n'.indexOf(folded[segEnd]) === -1) segEnd++;
    const form = classifyApiMergeRegion(folded.slice(apiEnd, segEnd), lower.slice(apiEnd, segEnd));
    if (form !== null) out.push({ form: form, index: map[a.index] == null ? 0 : map[a.index] });
    anchor.lastIndex = segEnd;
  }
  return out;
}

// Every recognizable raw-merge invocation: the regex arms (gh pr merge / gh pr sub /
// gh api var-endpoint) plus the linear merge-API path scan. Empty => allow (bounded claim).
function findMergeInvocations(command) {
  if (typeof command !== 'string' || command.length === 0) return [];
  const out = [];
  const re = new RegExp(MERGE_COMMAND_REGEX_SOURCE, 'gi');
  for (const m of command.matchAll(re)) {
    let form;
    if (m[1] !== undefined) form = 'gh-pr-merge';
    else if (m[2] !== undefined) form = 'gh-pr-undecidable';
    else form = 'gh-api-undecidable';
    out.push({ form: form, index: m.index == null ? 0 : m.index });
  }
  const paths = findApiMergePaths(command);
  for (let j = 0; j < paths.length; j++) out.push(paths[j]);
  out.sort(function (x, y) { return x.index - y.index; });
  return out;
}

// True when at least one detected invocation is a RECOGNIZABLE raw merge (vs a
// deny-on-undecidable variable/substitution) — selects the block message.
function hasRecognizableMerge(invocations) {
  return invocations.some(function (i) {
    return i.form === 'gh-pr-merge' || i.form === 'gh-api-merge';
  });
}

let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  let parsed;
  try {
    parsed = stdin ? JSON.parse(stdin) : {};
  } catch (err) {
    process.stderr.write('[totem MergeInterlock] could not parse stdin JSON; allowing (fail-soft)\n');
    process.exit(0);
  }

  if (parsed === null || typeof parsed !== 'object' || parsed.tool_name !== 'Bash') {
    process.exit(0);
  }

  const input = (typeof parsed.tool_input === 'object' && parsed.tool_input !== null) ? parsed.tool_input : {};
  const command = typeof input.command === 'string' ? input.command : '';
  if (command.length === 0) {
    process.exit(0);
  }

  const invocations = findMergeInvocations(command);
  if (invocations.length === 0) {
    process.exit(0);
  }

  // Branch the message on the detected forms (no core import at cold start): all
  // deny-on-undecidable (a substitution/variable after `gh pr` / `gh api`) => ask
  // to rewrite plainly; any recognizable raw-merge invocation => reroute to the
  // sanctioned actuator (kimi NB-4 / codex NB-4).
  if (!hasRecognizableMerge(invocations)) {
    process.stderr.write(
      '[totem MergeInterlock] could not decide the gh subcommand ' +
      '(substitution/variable after `gh pr` / `gh api`); rewrite the command plainly ' +
      'or use `totem pr merge [number]`.\n' +
      'mmnto-ai/totem#1762.\n',
    );
  } else {
    process.stderr.write(
      '[totem MergeInterlock] raw `gh pr merge` / merge-API invocation blocked at the harness.\n' +
      'Merge through the sanctioned actuator instead: `totem pr merge [number]` (or `--check-only`).\n' +
      'It asserts the merge-config posture (E lever + squash-only) and refuses undeclared close-keyword ' +
      'refs via the totem-close marker before merging squash-only with no body flags.\n' +
      'mmnto-ai/totem#1762.\n',
    );
  }
  process.exit(2);
});
// [totem] end auto-generated
