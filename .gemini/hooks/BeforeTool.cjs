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
// A-slice); inlined the same way. The raw-merge interlock's ONE detector.
const MERGE_COMMAND_REGEX_SOURCE = "(?<![\\w-])gh(?:\\.exe)?(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+(?:(pr\\b(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+merge)(?![\\w-])|(api\\b(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n]){0,2000}?/(?:(?:\\\\|\\^)\\r?\\n)*p(?:(?:\\\\|\\^)\\r?\\n)*u(?:(?:\\\\|\\^)\\r?\\n)*l(?:(?:\\\\|\\^)\\r?\\n)*l(?:(?:\\\\|\\^)\\r?\\n)*s(?:(?:\\\\|\\^)\\r?\\n)*/(?:(?:\\\\|\\^)\\r?\\n)*\\d+(?:(?:\\\\|\\^)\\r?\\n)*/(?:(?:\\\\|\\^)\\r?\\n)*m(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*r(?:(?:\\\\|\\^)\\r?\\n)*g(?:(?:\\\\|\\^)\\r?\\n)*e)(?![\\w-])|(pr\\b(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`))|(api\\b(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w][^\\s'\";|&=]*(?:=(?:'[^']*'|\"[^\"]*\"|[^\\s'\";|&]*)|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\";|&-][^\\s'\";|&]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`|%|!)|api\\b(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n]){0,2000}?(?:\\$|`|%|!)(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n]){0,2000}?/(?:(?:\\\\|\\^)\\r?\\n)*m(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*r(?:(?:\\\\|\\^)\\r?\\n)*g(?:(?:\\\\|\\^)\\r?\\n)*e\\b)|(api\\b(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n]){0,2000}?g(?:(?:\\\\|\\^)\\r?\\n)*r(?:(?:\\\\|\\^)\\r?\\n)*a(?:(?:\\\\|\\^)\\r?\\n)*p(?:(?:\\\\|\\^)\\r?\\n)*h(?:(?:\\\\|\\^)\\r?\\n)*q(?:(?:\\\\|\\^)\\r?\\n)*l(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n]){0,2000}?m(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*r(?:(?:\\\\|\\^)\\r?\\n)*g(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*P(?:(?:\\\\|\\^)\\r?\\n)*u(?:(?:\\\\|\\^)\\r?\\n)*l(?:(?:\\\\|\\^)\\r?\\n)*l(?:(?:\\\\|\\^)\\r?\\n)*R(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*q(?:(?:\\\\|\\^)\\r?\\n)*u(?:(?:\\\\|\\^)\\r?\\n)*e(?:(?:\\\\|\\^)\\r?\\n)*s(?:(?:\\\\|\\^)\\r?\\n)*t)(?![\\w-]))";
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
// the matched arm (groups 3/4 = deny-on-undecidable; else a recognizable raw merge)
// — the group indices live in the inlined pattern, no core import (kimi NB-4).
// Returns a block message (string) or null (allow).
function checkMergeInterlock(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return null;
  const command = shellCommandOf(toolInput);
  if (command.length === 0) return null;
  const re = new RegExp(MERGE_COMMAND_REGEX_SOURCE, 'gi');
  const m = re.exec(command);
  if (m === null) return null;
  if (m[3] !== undefined || m[4] !== undefined) {
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
