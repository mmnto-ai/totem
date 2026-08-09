// [totem] auto-generated — Gemini CLI BeforeTool hook
// Intercepts (Gemini CLI write tools are write_file + replace — there is NO
// edit_file; docs.gemini file-system tools + gemini-cli#20321):
//   Guard 1: git push/commit → run `totem lint` before proceeding (shield-gate)
//   Rule 1:  write_file/replace → block bare cross-repo refs in substrate paths —
//            xrepo-qualify-refs, sealed in mmnto-ai/totem-strategy#145 (SHA c488888b).
//   Rule 2:  write_file/replace → block GitHub auto-close keywords adjacent to an
//            issue ref in **/*.md (EXEMPT .github/**, .totem/**) — design of
//            record mmnto-ai/totem#1762; sibling seal pending its own PR.
//   Rule 3:  write_file/replace → block unquoted ': ' in dispatch frontmatter
//            subject:/expected-action: values under .totem/orchestration/*/outbox/
//            (strict-YAML consumers reject the dispatch; mmnto-ai/totem-status#123).
const { execSync } = require('child_process');

const BARE_REF_REGEX_SOURCE = "(?<!\\b[\\w-]+/[\\w-]+)#(\\d+)(?![-\\w])";
// Single-sourced from @mmnto/totem's AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762);
// inlined for the rendered standalone hook the way BARE_REF_REGEX_SOURCE is.
const AUTO_CLOSE_REGEX_SOURCE = "\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b(?:\\s*:\\s*|\\s+)(?:https?://github\\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/(\\d+)|([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#(\\d+)|#(\\d+))";
const SCOPED_PATH_RE = /(\.handoff[\\\/]|\.journal[\\\/]|\.md$)/i;
const MD_PATH_RE = /\.md$/i;
// EXEMPT .github/** (intentional close keywords) and .totem/** (tool/agent-authored
// lessons etc. — never a GitHub auto-close surface). NOT .changeset/**: changeset
// prose is composed into the Version-Packages PR DESCRIPTION (an auto-close
// surface — verified on PR mmnto-ai/totem#2474); use totem-context there.
const GITHUB_EXEMPT_RE = /(^|[\\\/])\.(github|totem)[\\\/]/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\s*totem-context:/;
// ECL dispatch surface: .totem/orchestration/<seat>/outbox/*.md (either separator).
const OUTBOX_PATH_RE = /(^|[\\\/])\.totem[\\\/]orchestration[\\\/][^\\\/]+[\\\/]outbox[\\\/][^\\\/]+\.md$/i;
const DISPATCH_KEY_RE = /^(subject|expected-action):\s*(.*)$/;

// Sender-side subject-quoting guard (routed ask, mmnto-ai/totem-status#123): an
// unquoted ': ' (or trailing ':') inside a subject:/expected-action: value breaks
// strict-YAML frontmatter parsers ("mapping values are not allowed in this
// context") — the dispatch delivers only via lenient fallbacks, and sensor
// parity across consumers is lost. Kill the class at write time, at the source.
// Full-file writes scan the leading frontmatter block only (body prose about
// the schema stays writable); fragment edits scan every line but honor the
// totem-context escape.
function checkOutboxSubjectQuoting(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!OUTBOX_PATH_RE.test(filePath)) return;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return;

  const lines = content.split(/\r?\n/);
  // Mode is TOOL-determined (CR round 1 on the introducing PR): write_file is a
  // full-file write — scan ONLY a leading frontmatter block, and a
  // frontmatter-less full write has nothing in scope (schema completeness is
  // the mail consumer's concern, not this guard's). replace/edit_file are
  // fragments: scan all lines, honoring the totem-context escape.
  const fragment = toolName !== 'write_file';
  let start = 0;
  let end = lines.length;
  if (!fragment) {
    if (lines.length > 0 && lines[0].trim() === '---') {
      start = 1;
      end = start;
      while (end < lines.length && lines[end].trim() !== '---') end++;
    } else {
      end = 0;
    }
  }
  const offenders = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (fragment) {
      const prev = i > 0 ? lines[i - 1] : '';
      if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    }
    const m = DISPATCH_KEY_RE.exec(line);
    if (!m) continue;
    const value = m[2].trim();
    if (value === '') continue;
    const first = value.charAt(0);
    // A quoted scalar is exempt ONLY when well-terminated on THIS line with
    // YAML-legal escapes (optional trailing comment): unterminated quotes,
    // trailing junk, and invalid escapes like \q are all strict-YAML errors
    // (greptile P1 + CR round 2 on the introducing PR). Multi-line quoted
    // scalars are YAML-valid but BLOCKED BY POLICY: the cohort's lenient
    // line-oriented consumer (mmnto-ai/totem-status#123) cannot see them —
    // single-physical-line values are the dispatch contract. Block scalars are
    // exempt ONLY as a bare header (>, >-, |2, ...): a header with trailing
    // text (">note: x") is invalid YAML and falls through to the scan.
    if (first === '"' || first === "'") {
      if (first === '"' && /^"(?:[^"\\]|\\(?:[0abtnvfre "/\\N_LP\t]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}))*"(\s+#.*)?$/.test(value)) continue;
      if (first === "'" && /^'(?:[^']|'')*'(\s+#.*)?$/.test(value)) continue;
      offenders.push(m[1]);
      continue;
    }
    if ((first === '>' || first === '|') && /^[>|][+-]?[0-9]*$/.test(value)) continue;
    if (value.indexOf(': ') !== -1 || value.charAt(value.length - 1) === ':') offenders.push(m[1]);
  }
  if (offenders.length === 0) return;

  throw new Error(
    '[totem BeforeTool] Unquoted ":" in dispatch frontmatter value(s) [' + offenders.join(', ') + '] in write to ' + filePath + '. ' +
    'Strict-YAML mail consumers reject the whole dispatch ("mapping values are not allowed in this context"). ' +
    'Quote the value on ONE line with YAML-legal escapes only, e.g. subject: "Re: your round -- topic". ' +
    'Sender-side guard routed from mmnto-ai/totem-status#123 (lenient consumer parsing is the fallback, not the contract).',
  );
}

// mmnto-ai/totem#1762: any close-keyword (close/fix/resolve inflections) adjacent
// to an issue ref in narrative markdown can auto-close a linked issue when the
// text reaches a PR body / commit message — genuine OR negated. Presence
// invariant, zero semantics (no negation parser). Scoped to **/*.md, EXEMPT
// .github/** (PR/issue templates where close keywords are intentional).
function checkAutoCloseKeywords(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!MD_PATH_RE.test(filePath) || GITHUB_EXEMPT_RE.test(filePath)) return;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return;

  const lines = content.split(/\r?\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }
  const re = new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
  const matches = [...filtered.join('\n').matchAll(re)];
  if (matches.length === 0) return;

  // Group layout: 1+2 = URL owner/repo+N; 3+4 = qualified owner/repo+N; 5 = bare N.
  const refs = matches.slice(0, 5).map((m) => (m[1] ? m[1] + '#' + m[2] : m[3] ? m[3] + '#' + m[4] : '#' + m[5])).join(', ');
  throw new Error(
    '[totem BeforeTool] GitHub auto-close keyword adjacent to issue ref in write to ' + filePath + ': ' + refs + '\n' +
    'GitHub auto-closes linked issues from a PR body / commit message carrying this pattern (even under negation).\n' +
    'Rephrase to a non-keyword form (`references` / `see` / `tracks`).\n' +
    'For verbatim quotation, prefix with a `<!-- totem-context: <reason> -->` directive on the preceding line.\n' +
    'mmnto-ai/totem#1762.',
  );
}

function checkXrepoQualifyRefs(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!SCOPED_PATH_RE.test(filePath)) return;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return;

  const lines = content.split(/\r?\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }
  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...filtered.join('\n').matchAll(re)];
  if (matches.length === 0) return;

  const refs = matches.slice(0, 5).map((m) => '#' + m[1]).join(', ');
  throw new Error(
    '[totem BeforeTool] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '. ' +
    'Qualify each as <owner>/<repo>#NNN (e.g., mmnto-ai/totem#1234). ' +
    'For verbatim quotation, prefix with a <!-- totem-context: <reason> --> directive on the preceding line. ' +
    'Sealed in mmnto-ai/totem-strategy#145.',
  );
}

module.exports = function beforeTool(toolName, toolInput) {
  checkOutboxSubjectQuoting(toolName, toolInput);
  checkAutoCloseKeywords(toolName, toolInput);
  checkXrepoQualifyRefs(toolName, toolInput);

  if (toolName !== 'run_shell_command') return;
  const cmd = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
  if (!/git\s+(push|commit)/.test(cmd) && !/["']git["'].*["'](push|commit)["']/.test(cmd)) return;

  try {
    execSync('totem lint', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
  } catch (err) {
    throw new Error('[Totem Error] Shield check failed. Fix violations before pushing.\n' + err.message);
  }
};
// [totem] end auto-generated
