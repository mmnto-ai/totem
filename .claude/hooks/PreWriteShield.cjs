// [totem] auto-generated — Claude Code PreWriteShield hook
// Rule 1: xrepo-qualify-refs (bare cross-repo refs) —
//         sealed in mmnto-ai/totem-strategy#145 (seal SHA c488888b).
// Rule 2: GitHub auto-close keyword guard —
//         design of record mmnto-ai/totem#1762; sibling seal pending its own PR.
// Rule 3: ECL dispatch frontmatter-quoting guard (outbox subject:/expected-action:
//         values must be strict-YAML-safe) — routed from mmnto-ai/totem-status#123.
//
// Mirrors the compiled rule pattern at lessonHash "xrepo-qualify-refs"
// in mmnto-ai/totem-strategy:.totem/compiled-rules.json.
//
// Exit-code contract (LOAD-BEARING — preserves the rule encoded as numbers):
//   0 = allow (no violation, out of scope, or hook-internal failure → fail-soft)
//   1 = hook-internal error (distinguish from intentional block)
//   2 = block (Claude Code blocking convention; bare ref detected in scoped path)
//
// Fail-soft on parse errors / non-string content: `totem lint` at
// commit-time remains the hard gate. The hook tightens the loop where
// it can; it does not weaken the existing commit-time guarantee.
'use strict';

const BARE_REF_REGEX_SOURCE = "(?<!\\b[\\w-]+/[\\w-]+)#(\\d+)(?![-\\w])";
// Single-sourced from @mmnto/totem's AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762);
// inlined for the rendered standalone .cjs the way BARE_REF_REGEX_SOURCE is.
const AUTO_CLOSE_REGEX_SOURCE = "\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b(?:\\s*:\\s*|\\s+)(?:https?://github\\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/(\\d+)|([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#(\\d+)|#(\\d+))";
const SCOPED_PATH_RE = /(\.handoff[\\\/]|\.journal[\\\/]|\.md$)/i;
const AUTO_CLOSE_MD_RE = /\.md$/i;
// EXEMPT .github/** (intentional close keywords) and .totem/** (tool/agent-authored
// content — never a GitHub auto-close surface). NOT .changeset/**: changeset prose
// is composed into the Version-Packages PR DESCRIPTION (an auto-close surface —
// verified on PR mmnto-ai/totem#2474); the totem-context directive is the escape.
const AUTO_CLOSE_GITHUB_RE = /(^|[\\\/])\.(github|totem)[\\\/]/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\s*totem-context:/;
// ECL dispatch surface: .totem/orchestration/<seat>/outbox/*.md (either separator).
const OUTBOX_PATH_RE = /(^|[\\\/])\.totem[\\\/]orchestration[\\\/][^\\\/]+[\\\/]outbox[\\\/][^\\\/]+\.md$/i;
const DISPATCH_KEY_RE = /^(subject|expected-action):\s*(.*)$/;

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
    process.stderr.write('[totem PreWriteShield] could not parse stdin JSON; allowing\n');
    process.exit(0);
  }

  const toolName = parsed.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0);
  }

  const input = (typeof parsed.tool_input === 'object' && parsed.tool_input !== null) ? parsed.tool_input : {};
  const filePath = String(input.file_path || '');
  if (!SCOPED_PATH_RE.test(filePath)) {
    process.exit(0);
  }

  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') {
    process.stderr.write('[totem PreWriteShield] non-string content; allowing\n');
    process.exit(0);
  }

  // ── Rule 3: dispatch frontmatter quoting (mmnto-ai/totem-status#123) ──
  // Unquoted ': ' (or trailing ':') in a subject:/expected-action: value breaks
  // strict-YAML frontmatter parsers; the dispatch then delivers only via lenient
  // fallbacks and consumer sensor parity is lost. Full-file writes scan the
  // leading frontmatter block only (body prose about the schema stays writable);
  // fragment edits scan every line but honor the totem-context escape. Checked
  // first: a malformed dispatch is unreadable regardless of what its body says.
  if (OUTBOX_PATH_RE.test(filePath)) {
    const dLines = content.split(/\r?\n/);
    // Mode is TOOL-determined (CR round 1 on the introducing PR): Write is a
    // full-file write — scan ONLY a leading frontmatter block, and a
    // frontmatter-less full write has nothing in scope (schema completeness is
    // the mail consumer's concern, not this guard's). Edit is a fragment:
    // scan all lines, honoring the totem-context escape.
    const dFragment = toolName === 'Edit';
    let dStart = 0;
    let dEnd = dLines.length;
    if (!dFragment) {
      if (dLines.length > 0 && dLines[0].trim() === '---') {
        dStart = 1;
        dEnd = dStart;
        while (dEnd < dLines.length && dLines[dEnd].trim() !== '---') dEnd++;
      } else {
        dEnd = 0;
      }
    }
    const offenders = [];
    for (let i = dStart; i < dEnd; i++) {
      const dLine = dLines[i];
      if (dFragment) {
        const dPrev = i > 0 ? dLines[i - 1] : '';
        if (SUPPRESS_DIRECTIVE_RE.test(dLine) || SUPPRESS_DIRECTIVE_RE.test(dPrev)) continue;
      }
      const m = DISPATCH_KEY_RE.exec(dLine);
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
    if (offenders.length > 0) {
      process.stderr.write(
        '[totem PreWriteShield] Unquoted ":" in dispatch frontmatter value(s) [' + offenders.join(', ') + '] in write to ' + filePath + '\n' +
        'Strict-YAML mail consumers reject the whole dispatch ("mapping values are not allowed in this context").\n' +
        'Quote the value on ONE line with YAML-legal escapes only, e.g. subject: "Re: your round -- topic".\n' +
        'Sender-side guard routed from mmnto-ai/totem-status#123 (lenient consumer parsing is the fallback, not the contract).\n',
      );
      process.exit(2);
    }
  }

  // Suppression-directive bypass mirrors rule-engine.ts isSuppressed
  // (line + preceding-line window).
  const lines = content.split(/\r?\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }

  const joined = filtered.join('\n');

  // ── Auto-close keyword guard (mmnto-ai/totem#1762): **/*.md, EXEMPT .github/**, .totem/** ──
  // Presence invariant, zero semantics: any close-keyword adjacent to an issue
  // ref (genuine OR negated) is blocked. Checked before the bare-ref arm because
  // accidental upstream-issue closure is the higher-blast-radius failure.
  if (AUTO_CLOSE_MD_RE.test(filePath) && !AUTO_CLOSE_GITHUB_RE.test(filePath)) {
    const acRe = new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
    const acMatches = [...joined.matchAll(acRe)];
    if (acMatches.length > 0) {
      // Group layout: 1+2 = URL owner/repo+N; 3+4 = qualified owner/repo+N; 5 = bare N.
      const acRefs = acMatches.slice(0, 5).map((m) => (m[1] ? m[1] + '#' + m[2] : m[3] ? m[3] + '#' + m[4] : '#' + m[5])).join(', ');
      process.stderr.write(
        '[totem PreWriteShield] GitHub auto-close keyword adjacent to issue ref in write to ' + filePath + ': ' + acRefs + '\n' +
        'GitHub auto-closes linked issues from a PR body / commit message carrying this pattern (even under negation).\n' +
        'Rephrase to a non-keyword form (`references` / `see` / `tracks`).\n' +
        'For verbatim quotation, prefix with a `<!-- totem-context: <reason> -->` directive on the preceding line.\n' +
        'mmnto-ai/totem#1762.\n',
      );
      process.exit(2);
    }
  }

  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...joined.matchAll(re)];
  if (matches.length === 0) {
    process.exit(0);
  }

  const refs = matches.slice(0, 5).map((m) => '#' + m[1]).join(', ');
  process.stderr.write(
    '[totem PreWriteShield] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '\n' +
    'Qualify each as `<owner>/<repo>#NNN` before writing (e.g., `mmnto-ai/totem#1234`).\n' +
    'For verbatim quotation, prefix with a `<!-- totem-context: <reason> -->` directive on the preceding line.\n' +
    'Sealed in mmnto-ai/totem-strategy#145.\n',
  );
  process.exit(2);
});
// [totem] end auto-generated
