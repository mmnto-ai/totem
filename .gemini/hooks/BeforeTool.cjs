// [totem] auto-generated — Gemini CLI BeforeTool hook (command-style, reads JSON on stdin)
// Official Gemini hook contract (google-gemini/gemini-cli docs/hooks/writing-hooks.md):
// a BeforeTool hook is a COMMAND subprocess registered in .gemini/settings.json under
// hooks.BeforeTool; it reads the tool-call JSON on stdin ({ tool_name, tool_input }),
// BLOCKS by writing a diagnostic to stderr and exiting 2 (the doc's "Emergency Brake"),
// and ALLOWS by exiting 0. Mirrors the Claude-side .cjs hooks (mmnto-ai/totem#1762 A-slice).
// Gemini CLI write tools are write_file + replace — there is NO edit_file (docs.gemini
// file-system tools + gemini-cli#20321); edit_file is kept for backward-safety.
//   Guard 1: run_shell_command → block a raw `gh pr merge` / merge-API invocation
//            and reroute to `totem pr merge` — auto-close enforcement seam A-slice
//            (mmnto-ai/totem#1762). Bounded surface (condition 2): recognizable
//            shell invocations only; D1/D2 are the loud backstop.
//   Guard 2: run_shell_command → run `totem lint` before a git push/commit (shield-gate).
//   Rule 1:  write_file/replace → block bare cross-repo refs in substrate paths —
//            xrepo-qualify-refs, sealed in mmnto-ai/totem-strategy#145 (SHA c488888b).
//   Rule 2:  write_file/replace → block GitHub auto-close keywords adjacent to an
//            issue ref in **/*.md (EXEMPT .github/**, .totem/**) — design of
//            record mmnto-ai/totem#1762; sibling seal pending its own PR.
//
// BOUNDED-SURFACE / RECORDED GAPS (condition 2 honesty, parity with core's matcher):
//   - a VISIBLE-TOKEN splice a shell concatenates back into the keyword
//     (`gh pr me''rge`, `bash -c "gh \\"pr\\" merge"`), and
//   - a command SUBSTITUTION replacing the subcommand word (`gh $(echo pr) merge`,
//     `gh "$SUB" merge`) — the pr/api token is produced by expansion the hook cannot
//     see; note `$GH pr merge` DOES block and `gh pr $(…)` is denied-on-undecidable —
//     remain unclaimed; D1 (PR-time check) + D2 (post-merge) are the loud backstop.
//
// NOTE: this hook ships as `.cjs` (NOT `.js`) so a consumer repo whose package.json
// is `"type": "module"` still execs it as CommonJS. A bare `node BeforeTool.js` in a
// module-type repo resolves as ESM and throws `ReferenceError: require is not defined`
// BEFORE reading stdin; Gemini treats a non-0/non-2 exit as a warning and lets the
// merge THROUGH (a crash-open). The `.cjs` extension makes the interlock fail-CLOSED
// regardless of the consumer's package `type` (codex round-2 BLOCKING-4a). Its sibling
// .gemini/hooks/SessionStart.js is still `.js` (advisory briefing, not a safety gate).
'use strict';
const { execSync } = require('child_process');

const BARE_REF_REGEX_SOURCE = "(?<!\\b[\\w-]+/[\\w-]+)#(\\d+)(?![-\\w])";
// Single-sourced from @mmnto/totem's AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762);
// inlined for the rendered standalone hook the way BARE_REF_REGEX_SOURCE is.
const AUTO_CLOSE_REGEX_SOURCE = "\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b(?:\\s*:\\s*|\\s+)(?:https?://github\\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/(\\d+)|([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#(\\d+)|#(\\d+))";
// Single-sourced from @mmnto/totem's MERGE_COMMAND_REGEX_SOURCE (mmnto-ai/totem#1762
// A-slice); inlined the same way — the regex arms (gh pr merge / gh pr $sub / gh api
// $endpoint). The raw merge-API PATHS are the single-pass scanner below.
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
const SCOPED_PATH_RE = /(\.handoff[\\\/]|\.journal[\\\/]|\.md$)/i;
const MD_PATH_RE = /\.md$/i;
// EXEMPT .github/** (intentional close keywords) and .totem/** (tool/agent-authored
// lessons etc. — never a GitHub auto-close surface). NOT .changeset/**: changeset
// prose is composed into the Version-Packages PR DESCRIPTION (an auto-close
// surface — verified on PR mmnto-ai/totem#2474); use totem-context there.
const GITHUB_EXEMPT_RE = /(^|[\\\/])\.(github|totem)[\\\/]/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\s*totem-context:/;

// Extract the shell command from a run_shell_command tool_input. Gemini delivers
// tool_input as a PARSED OBJECT (`{ command }`) on stdin — extract `.command` the
// same way the Claude arm reads the `Bash` tool_input.command; NEVER JSON.stringify
// the object (JSON escaping rewrites `"` to `\\"`, defeating the separator class so
// every double-quoted `gh "pr" merge` form slips through — mmnto-ai/totem#1762
// re-review, kimi B-1). A raw string tool_input (some deliveries) is used verbatim.
function shellCommandOf(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput && typeof toolInput === 'object' && typeof toolInput.command === 'string') {
    return toolInput.command;
  }
  return '';
}

// Drop lines carrying a totem-context suppression directive (line + preceding-line
// window) before scanning, mirroring rule-engine.ts isSuppressed.
function withoutSuppressed(content) {
  const lines = content.split(/\r?\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }
  return filtered.join('\n');
}

// mmnto-ai/totem#1762: any close-keyword (close/fix/resolve inflections) adjacent
// to an issue ref in narrative markdown can auto-close a linked issue when the
// text reaches a PR body / commit message — genuine OR negated. Presence
// invariant, zero semantics (no negation parser). Scoped to **/*.md, EXEMPT
// .github/** (PR/issue templates where close keywords are intentional). Returns a
// block message (string) or null (allow).
function checkAutoCloseKeywords(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return null;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!MD_PATH_RE.test(filePath) || GITHUB_EXEMPT_RE.test(filePath)) return null;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return null;

  const re = new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
  const matches = [...withoutSuppressed(content).matchAll(re)];
  if (matches.length === 0) return null;

  // Group layout: 1+2 = URL owner/repo+N; 3+4 = qualified owner/repo+N; 5 = bare N.
  const refs = matches.slice(0, 5).map((m) => (m[1] ? m[1] + '#' + m[2] : m[3] ? m[3] + '#' + m[4] : '#' + m[5])).join(', ');
  return (
    '[totem BeforeTool] GitHub auto-close keyword adjacent to issue ref in write to ' + filePath + ': ' + refs + '\n' +
    'GitHub auto-closes linked issues from a PR body / commit message carrying this pattern (even under negation).\n' +
    'Rephrase to a non-keyword form (`references` / `see` / `tracks`).\n' +
    'For verbatim quotation, prefix with a `<!-- totem-context: <reason> -->` directive on the preceding line.\n' +
    'mmnto-ai/totem#1762.'
  );
}

function checkXrepoQualifyRefs(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return null;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!SCOPED_PATH_RE.test(filePath)) return null;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return null;

  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...withoutSuppressed(content).matchAll(re)];
  if (matches.length === 0) return null;

  const refs = matches.slice(0, 5).map((m) => '#' + m[1]).join(', ');
  return (
    '[totem BeforeTool] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '. ' +
    'Qualify each as <owner>/<repo>#NNN (e.g., mmnto-ai/totem#1234). ' +
    'For verbatim quotation, prefix with a <!-- totem-context: <reason> --> directive on the preceding line. ' +
    'Sealed in mmnto-ai/totem-strategy#145.'
  );
}

// mmnto-ai/totem#1762 A-slice: a raw `gh pr merge` / merge-API invocation in a
// run_shell_command bypasses the sanctioned `totem pr merge` actuator (which asserts
// merge-config posture + auto-close safety before merging squash-only, no body
// flags). Presence-invariant, deny-on-undecidable. The stderr message branches on
// the detected forms (all deny-on-undecidable => rewrite plainly; any recognizable
// raw merge => reroute), no core import (kimi NB-4). Returns a block message or null.
function checkMergeInterlock(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return null;
  const command = shellCommandOf(toolInput);
  if (command.length === 0) return null;
  const invocations = findMergeInvocations(command);
  if (invocations.length === 0) return null;
  if (!hasRecognizableMerge(invocations)) {
    return (
      '[totem BeforeTool] could not decide the gh subcommand ' +
      '(substitution/variable after `gh pr` / `gh api`); rewrite the command plainly ' +
      'or use `totem pr merge [number]`.\n' +
      'mmnto-ai/totem#1762.'
    );
  }
  return (
    '[totem BeforeTool] raw `gh pr merge` / merge-API invocation blocked at the harness.\n' +
    'Merge through the sanctioned actuator instead: `totem pr merge [number]` (or `--check-only`).\n' +
    'It asserts the merge-config posture (E lever + squash-only) and refuses undeclared close-keyword ' +
    'refs via the totem-close marker before merging squash-only with no body flags.\n' +
    'mmnto-ai/totem#1762.'
  );
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
    // Fail-soft on an unparseable envelope: an unrecognizable payload is out of
    // the bounded claim; B + D1 + D2 remain the layered gates (mirrors the Claude arm).
    process.stderr.write('[totem BeforeTool] could not parse stdin JSON; allowing (fail-soft)\n');
    process.exit(0);
  }
  if (parsed === null || typeof parsed !== 'object') {
    process.exit(0);
  }

  const toolName = parsed.tool_name;
  const toolInput = parsed.tool_input;

  // Block on the first rule that fires (exit 2 = Emergency Brake, stderr diagnostic).
  const blocked =
    checkMergeInterlock(toolName, toolInput) ||
    checkAutoCloseKeywords(toolName, toolInput) ||
    checkXrepoQualifyRefs(toolName, toolInput);
  if (blocked) {
    process.stderr.write(blocked + '\n');
    process.exit(2);
  }

  // Guard 2: run `totem lint` before a git push/commit; block on failure.
  if (toolName === 'run_shell_command') {
    const cmd = shellCommandOf(toolInput);
    if (/git\s+(push|commit)/.test(cmd) || /["']git["'].*["'](push|commit)["']/.test(cmd)) {
      try {
        execSync('totem lint', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
      } catch (err) {
        process.stderr.write(
          '[Totem Error] Shield check failed. Fix violations before pushing.\n' +
            (err && err.message ? err.message : String(err)) + '\n',
        );
        process.exit(2);
      }
    }
  }

  process.exit(0);
});
// [totem] end auto-generated
