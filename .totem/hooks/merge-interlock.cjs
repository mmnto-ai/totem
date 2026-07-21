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

const MERGE_COMMAND_REGEX_SOURCE = "(?<![\\w-])gh(?:\\.exe)?(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w-]+(?:=[^\\s'\"]+|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\"-][^\\s'\"]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+(?:(pr\\b(?:(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+-{1,2}[\\w-]+(?:=[^\\s'\"]+|(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+[^\\s'\"-][^\\s'\"]*)?)*(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)+merge)(?![\\w-])|(api\\b[^;|&\\r\\n]*?/pulls/\\d+/merge)(?![\\w-])|(pr\\b(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`))|(api\\b(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)*(?:\\$|`)|api\\b[^;|&\\r\\n]*?(?:\\$|`)[^;|&\\r\\n]*?/merge\\b)|(api\\b[^;|&\\r\\n]*?graphql[^;|&\\r\\n]*?mergePullRequest)(?![\\w-]))";

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

  const re = new RegExp(MERGE_COMMAND_REGEX_SOURCE, 'gi');
  const m = re.exec(command);
  if (m === null) {
    process.exit(0);
  }

  // Branch the message on which alternation matched — the group indices live in
  // the inlined pattern (no core import at cold start). Groups 3/4 are the
  // deny-on-undecidable arms (a substitution/variable after `gh pr` / `gh api`);
  // everything else is a recognizable raw-merge invocation (kimi NB-4 / codex NB-4).
  if (m[3] !== undefined || m[4] !== undefined) {
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
