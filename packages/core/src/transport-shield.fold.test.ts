import { describe, expect, it } from 'vitest';

import {
  findHeredocs,
  tokenizeShell,
  transportShieldEvaluator,
  type TransportShieldPayload,
} from './transport-shield.js';

// The falsification-leg fold on mmnto-ai/totem#2799 (F1–F5, F8, F9) and the
// ADR-109 false-positive budget fixture (F6). Each row here is a shape the first
// build got wrong, pinned so it stays fixed.

const NO_DIR = '/nonexistent/.totem';
const run = (command: string, platform = 'linux', tool: TransportShieldPayload['tool'] = 'Bash') =>
  transportShieldEvaluator({ tool, command, platform }, NO_DIR);

describe('transport-shield fold — the tokenizer keeps POSIX double-quote semantics (F1)', () => {
  it('a backslash inside double quotes survives unless it escapes $, `, ", \\ or newline', () => {
    expect(tokenizeShell('sed -i "s/\\r//" f.txt')[0]?.tokens).toEqual([
      'sed',
      '-i',
      's/\\r//',
      'f.txt',
    ]);
    expect(tokenizeShell('echo "a\\$b \\"q\\" \\\\ x"')[0]?.tokens).toEqual([
      'echo',
      'a$b "q" \\ x',
    ]);
  });

  it('denies the double-quoted spelling of a sed -i escape and an inline body escape (the charter rows)', () => {
    expect(run('sed -i "s/\\r//" f.txt').provenance.ref).toBe('sed-i-escape');
    expect(run('node -e "console.log(\'a\\d\')"').provenance.ref).toBe('inline-body-escape');
  });
});

describe('transport-shield fold — -b is scoped to gh and reported as written (F2)', () => {
  it('denies gh -b /x and gh --body=/x on win32 Bash, naming the flag the user typed', () => {
    const short = run('gh pr comment 5 -b /x', 'win32');
    expect(short.disposition).toBe('deny');
    expect(short.provenance.matched).toBe('-b /x');
    const eq = run('gh pr comment 5 --body=/x', 'win32');
    expect(eq.provenance.matched).toBe('--body=/x');
  });

  it('allows -b on programs where it is not a body', () => {
    for (const cmd of [
      'diff -b /d/Dev/a.txt /d/Dev/b.txt',
      'curl -b /tmp/cookies.txt https://api.github.com',
      'cp -b /tmp/a /tmp/b',
      'sort -b /tmp/list.txt',
      'du -b /d/Dev/totem',
      'grep -b /usr/local notes.txt',
    ]) {
      expect(run(cmd, 'win32').disposition, cmd).toBe('allow');
    }
  });
});

describe('transport-shield fold — sed -i reads the expression operand, never a filename (F3)', () => {
  it('allows a Windows path as the sed file operand', () => {
    expect(run("sed -i 's/a/b/' 'C:\\temp\\f.txt'").disposition).toBe('allow');
    expect(run("sed -i 's/a/b/' 'a\\b.txt'").disposition).toBe('allow');
  });

  it('still denies a backslash in the expression, as -e and as the first operand', () => {
    expect(run("sed -i -e 's/\\t/ /' 'C:\\temp\\f.txt'").provenance.ref).toBe('sed-i-escape');
    expect(run("sed -i 's/\\t/ /' f.txt").provenance.matched).toBe('s/\\t/ /');
  });
});

describe('transport-shield fold — heredoc operators in quotes and here-strings are not heredocs (F4)', () => {
  it('ignores << inside a quoted argument and the <<< here-string operator', () => {
    expect(findHeredocs("grep '<<EOF' notes.md")).toEqual([]);
    expect(findHeredocs('bash <<< "hello"')).toEqual([]);
    expect(run("grep '<<EOF' notes.md\ngrep 'a\\d' other.md").disposition).toBe('allow');
    expect(run('bash <<< "hello"\nsed -n \'s/a\\/b/p\' f').disposition).toBe('allow');
  });
});

describe('transport-shield fold — the terminator is an exact line, tabs stripped only for <<- (F5)', () => {
  it('an indented delimiter word inside the body does not end a plain heredoc', () => {
    const cmd = "cat > f <<'EOF'\na\n  EOF\nx\\d\nEOF";
    expect(findHeredocs(cmd)[0]?.body).toBe('a\n  EOF\nx\\d\n');
    expect(run(cmd).provenance.ref).toBe('heredoc-escape');
  });

  it('a tab-indented delimiter ends a <<- heredoc; a CRLF or trailing-space terminator does not, as in bash', () => {
    expect(findHeredocs("cat <<-'EOF'\n\tbody\n\tEOF\nafter")[0]?.body).toBe('\tbody\n');
    expect(findHeredocs("cat <<'EOF'\r\nbody\r\nEOF\r\n")[0]?.unterminated).toBe(true);
    expect(findHeredocs("cat <<'EOF'\nbody\nEOF \nafter")[0]?.unterminated).toBe(true);
  });
});

describe('transport-shield fold pass 2 — quotes never span heredoc bodies; rows read the program position; the MSYS cure is honoured', () => {
  it('an apostrophe inside a heredoc body does not hide a later heredoc (P2-F14) or expose its text as a command (P2-F15)', () => {
    const two =
      "gh pr comment 2799 --body-file - <<PRBODY\nThe fold doesn't break it.\nPRBODY\ncat > .totem/note.md <<NOTE\npath C:\\Users\\me\nNOTE";
    expect(findHeredocs(two)).toHaveLength(2);
    expect(run(two, 'win32').provenance.ref).toBe('heredoc-escape');
    const hidden = "cat <<EOF\ndon't\nEOF\ncat <<EOF2\ngh pr comment 5 -b /some/path\nEOF2";
    expect(run(hidden, 'win32').disposition).toBe('allow');
  });

  it('a heredoc after a double-quoted argument carrying an apostrophe or an escaped quote is still found', () => {
    expect(findHeredocs('echo "it\'s fine" && cat <<EOF\nx\\d\nEOF')).toHaveLength(1);
    expect(findHeredocs('echo "a \\" b" && cat <<EOF\nx\\d\nEOF')).toHaveLength(1);
  });

  it('MSYS_NO_PATHCONV=1 is honoured by msys-body-slash, as its own cure says (P2-F16)', () => {
    expect(run('MSYS_NO_PATHCONV=1 gh pr comment 5 -b /x', 'win32').disposition).toBe('allow');
    expect(run('gh pr comment 5 -b /x', 'win32').disposition).toBe('deny');
  });

  it('a program name mentioned as an argument is not an invocation (P2-F17); wrappers and assignments are skipped', () => {
    expect(run('grep gh -b /usr/local n.txt', 'win32').disposition).toBe('allow');
    expect(run('echo gh -b /x', 'win32').disposition).toBe('allow');
    expect(run("git log --grep sed -i 's/a\\t/b/'").disposition).toBe('allow');
    expect(run("which node -e 'a\\d'").disposition).toBe('allow');
    expect(run('GH_TOKEN=x gh pr comment 5 -b /x', 'win32').provenance.ref).toBe('msys-body-slash');
    expect(run('sudo /usr/bin/gh pr comment 5 --body /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run("time sed -i 's/\\t/ /' f").provenance.ref).toBe('sed-i-escape');
  });

  it("BSD sed's empty backup-suffix operand is not the expression (P2-F21)", () => {
    expect(run("sed -i '' 's/a\\t/b/' f", 'darwin').provenance.ref).toBe('sed-i-escape');
  });

  it('a heredoc inside a bash -c operand is quoted text to the scanner — a disclosed corpus gap, not a row (P2-F19)', () => {
    expect(run('bash -c "cat <<EOF\nx\\\\d\nEOF"').disposition).toBe('allow');
  });
});

describe('transport-shield fold — --eval= and line continuations (F8, F9)', () => {
  it('denies the --eval= joined form and a line-continued --body', () => {
    expect(run('node --eval="console.log(\'a\\d\')"').provenance.ref).toBe('inline-body-escape');
    expect(run('gh pr comment 1 --body \\\n  "/gemini review"', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
  });
});

describe('transport-shield fold pass 3 — comments, arithmetic, backslash-quoted delimiters, continuations, every body flag', () => {
  it('a # comment carrying an apostrophe never hides a later heredoc or program (P3-F1)', () => {
    const lead = "# don't clobber the file\ncat > f.mjs <<'EOF'\nconst re = /\\d+/;\nEOF";
    expect(findHeredocs(lead)).toHaveLength(1);
    expect(run(lead).provenance.ref).toBe('heredoc-escape');
    expect(run("# don't forget\nsed -i 's/\\t/ /' f").provenance.ref).toBe('sed-i-escape');
    expect(run("# it's fine\ngh pr comment 5 --body /gemini", 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run("echo hi # don't\ncat > f <<'EOF'\nx\\d\nEOF").provenance.ref).toBe(
      'heredoc-escape',
    );
    expect(run("cat <<EOF # it's the body\nx\\d\nEOF").provenance.ref).toBe('heredoc-escape');
  });

  it('comment text is discarded, never tokenized as arguments (P3-F5); $# and a # inside a word are not comments', () => {
    expect(
      run('gh pr comment 5 --body-file notes.md # was --body /gemini review', 'win32').disposition,
    ).toBe('allow');
    expect(run("sed -i -e 's/a/b/' f.txt # -e 's/c/d/'").disposition).toBe('allow');
    expect(tokenizeShell('echo $# a#b # c')[0]?.tokens).toEqual(['echo', '$#', 'a#b']);
    expect(tokenizeShell('echo a # c\ngh pr view 1').map((s) => s.tokens)).toEqual([
      ['echo', 'a'],
      ['gh', 'pr', 'view', '1'],
    ]);
  });

  it('a backslash-continued sed -i is one line to bash and is allowed; a quoted newline still denies (P3-F2)', () => {
    expect(run("grep -q x f && \\\n  sed -i 's/foo/bar/' file.ts").disposition).toBe('allow');
    expect(run("sed -i 's/foo/bar/' \\\n  packages/core/src/file.ts").disposition).toBe('allow');
    expect(run("sed -i \\\n  's/foo/bar/' file.ts").disposition).toBe('allow');
    expect(run("sed -i 's/a/b\nc/' f").provenance.ref).toBe('sed-i-escape');
    expect(run("cd x\nsed -i 's/foo/bar/' f").disposition).toBe('allow');
  });

  it('<< inside $(( … )) or (( … )) is a shift, not a heredoc (P3-F3)', () => {
    expect(findHeredocs('mask=$((1 << n))\necho done')).toEqual([]);
    expect(findHeredocs('(( mask = 1 << n ))\necho done')).toEqual([]);
    expect(run('mask=$((1 << n))\ngh pr comment 5 -b /gemini', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run('(( mask = 1 << n ))\ngh pr comment 5 -b /gemini', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run("mask=$((1 << n))\nsed -i 's/a/b/' 'C:\\x\\y.txt'").disposition).toBe('allow');
    expect(findHeredocs('x=$((1 << n)) && cat <<EOF\nbody\nEOF')).toHaveLength(1);
  });

  it('a backslash-quoted delimiter (<<\\EOF) is a quoted heredoc (P3-F4)', () => {
    const span = findHeredocs('cat > f <<\\EOF\nconst re = /\\d+/;\nEOF')[0];
    expect(span?.quoted).toBe(true);
    expect(span?.delimiter).toBe('EOF');
    expect(span?.unterminated).toBe(false);
    expect(run('cat > f <<\\EOF\nconst re = /\\d+/;\nEOF').provenance.ref).toBe('heredoc-escape');
    expect(run('cat > f <<\\EOF\ngh pr comment 5 -b /some/path\nEOF', 'win32').disposition).toBe(
      'allow',
    );
    expect(run("cat > f <<\\EOF\nit's fine\nEOF\ncat > g <<EOF\nx\\d\nEOF").provenance.ref).toBe(
      'heredoc-escape',
    );
  });

  it('env VAR=x prog and a &-backgrounded first command still reach the program (P3-F7)', () => {
    expect(run('env GH_TOKEN=x gh pr comment 5 -b /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run('sleep 1 & gh pr comment 5 -b /x', 'win32').provenance.ref).toBe('msys-body-slash');
    expect(tokenizeShell('cmd 2>&1 | tee log; x &>/dev/null; y &').map((s) => s.tokens)).toEqual([
      ['cmd', '2>&1'],
      ['tee', 'log'],
      ['x', '&>/dev/null'],
      ['y'],
    ]);
  });

  it("a later real --body is read when an earlier -b was another option's value (P3-F8)", () => {
    expect(run('gh issue create --title -b --body /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run('gh issue create --title -b --body-file notes.md', 'win32').disposition).toBe(
      'allow',
    );
  });

  it('a literal $( inside single quotes is not a subshell to the warn row (P3-F11)', () => {
    expect(run("grep -n '$(git show origin/main:.totem/x.md)' notes.md", 'win32').disposition).toBe(
      'allow',
    );
    expect(run('echo $(git show origin/main:.totem/x.md)', 'win32').disposition).toBe('warn');
    expect(run('echo "$(git show origin/main:.totem/x.md)"', 'win32').disposition).toBe('warn');
  });
});

describe('transport-shield fold pass 3, re-armed — a # that continues a word, an escaped quote, a dotted delimiter', () => {
  it('a # right after a $( … ) continues the word and is not a comment (P3b-F1)', () => {
    const cmd = "cat $(echo f)#1 <<'EOF'\nconst re = /\\d+/;\nEOF";
    expect(findHeredocs(cmd)).toHaveLength(1);
    expect(run(cmd).provenance.ref).toBe('heredoc-escape');
    expect(tokenizeShell('echo $(true)#x; gh pr view 1').map((s) => s.tokens)).toEqual([
      ['echo', '$(true)#x'],
      ['gh', 'pr', 'view', '1'],
    ]);
  });

  it("an unquoted \\' opens no single-quoted region for the warn row (P3b-F3)", () => {
    expect(
      run("awk -F\\' '{print $2}' f; echo $(git show origin/main:x.md)", 'win32').disposition,
    ).toBe('warn');
    expect(run("echo \\' $(git show origin/main:x.md)", 'win32').disposition).toBe('warn');
    expect(run("echo 'a' $(git show origin/main:x.md)", 'win32').disposition).toBe('warn');
  });

  it('an operator ) begins a word and a substitution ) continues one, so a # after each reads as bash reads it (P3c-F1)', () => {
    // A `#` after a subshell's or a case pattern's `)` is a comment in bash (an
    // operator token precedes it); after `$( … )` or `<( … )` it continues the word.
    expect(run("(echo a)#it's a note\ncat <<'EOF'\nx\\d\nEOF").provenance.ref).toBe(
      'heredoc-escape',
    );
    expect(
      run("case $x in\na)#don't\n  echo hit;;\nesac\ncat <<'EOF'\ny\\d\nEOF").provenance.ref,
    ).toBe('heredoc-escape');
    expect(run("(echo a)#see <<'EOF'\nx\\d\nEOF").disposition).toBe('allow');
    expect(findHeredocs("$(a)# it's\ncat <<'EOF'\nx\\d\nEOF")).toEqual([]);
    expect(findHeredocs("diff <(echo a) <(echo b)#it's\ncat <<'EOF'\nx\\d\nEOF")).toEqual([]);
    expect(run("(cd x && ls)#don't forget\ngh pr comment 5 -b /x", 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(tokenizeShell('(echo a)#x\ndiff <(echo a) <(echo b)#y').map((s) => s.tokens)).toEqual([
      ['echo', 'a'],
      ['diff', '<(echo a)', '<(echo b)#y'],
    ]);
  });

  it('a delimiter word is read whole as bash delimits it — 1EOF, $X (literally), and a word ending at an operator (P3c-F2)', () => {
    const two = findHeredocs("cat <<1EOF\nit's\n1EOF\ncat <<'EOF'\nx\\d\nEOF");
    expect(two.map((s) => [s.delimiter, s.unterminated])).toEqual([
      ['1EOF', false],
      ['EOF', false],
    ]);
    expect(run("cat <<1EOF\nit's\n1EOF\ncat <<'EOF'\nx\\d\nEOF").provenance.ref).toBe(
      'heredoc-escape',
    );
    expect(run("cat <<1EOF\nit's\n1EOF\nsed -i 's/a/b/' 'C:\\x'").disposition).toBe('allow');
    expect(findHeredocs('cat <<$X\nbody\nEOF\n')[0]?.unterminated).toBe(true);
    expect(findHeredocs('x=$(cat <<EOF)\nplain\nEOF\n')[0]?.delimiter).toBe('EOF');
    expect(findHeredocs('cat <<EOF;\nplain\nEOF\n')[0]?.delimiter).toBe('EOF');
  });

  it('a delimiter word may carry . and - (EOF.TXT, EOF-1), so the body terminates where bash terminates it', () => {
    const spans = findHeredocs("cat <<EOF.TXT\nplain\nEOF.TXT\ncat <<'EOF-1'\nx\nEOF-1\nafter");
    expect(spans.map((s) => [s.delimiter, s.quoted, s.unterminated])).toEqual([
      ['EOF.TXT', false, false],
      ['EOF-1', true, false],
    ]);
    expect(run("cat <<EOF.TXT\nplain\nEOF.TXT\nsed -i 's/a/b/' 'C:\\x'").disposition).toBe('allow');
    expect(run('cat <<EOF.TXT\nx\\d\nEOF.TXT').provenance.ref).toBe('heredoc-escape');
  });
});

describe('transport-shield — the bot round on mmnto-ai/totem#2804 (Gemini, Greptile, CodeRabbit findings folded)', () => {
  it('a ) inside quotes never closes a substitution, so a later positive is still reached (Gemini, tokenizeShell)', () => {
    expect(tokenizeShell('x=$(echo ")") && gh pr view 1').map((s) => s.tokens)).toEqual([
      ['x=$(echo ")")'],
      ['gh', 'pr', 'view', '1'],
    ]);
    expect(run('x=$(echo ")") && gh pr comment 5 -b /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run("x=$(echo ')') && sed -i 's/\\t/ /' f").provenance.ref).toBe('sed-i-escape');
  });

  it('a ) inside quotes never closes the subshell the warn row scans (Gemini, msys-rev-path-subshell)', () => {
    expect(run('echo $(echo ")" && git show origin/main:x.md)', 'win32').disposition).toBe('warn');
    expect(run('echo $(echo ")") $(git show origin/main:x.md)', 'win32').disposition).toBe('warn');
  });

  it('a PowerShell block comment carrying a quote hides nothing (Greptile)', () => {
    expect(
      run("Write-Output <# \" #> ; sed -i 's/\\d/x/' file", 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(run("<# don't #>\nsed -i 's/\\t/ /' f", 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    expect(
      run("<# it's\nmulti-line #>\ncat <<'EOF'\nx\\d\nEOF", 'win32', 'PowerShell').provenance.ref,
    ).toBe('heredoc-escape');
    expect(run("Write-Output <# note #> 'plain'", 'win32', 'PowerShell').disposition).toBe('allow');
  });

  it('the MSYS opt-out is an assignment the shell applies to the judged segment, never a substring (CodeRabbit)', () => {
    expect(
      run('MSYS_NO_PATHCONV=1 echo hi && gh pr comment 5 -b /tmp/p', 'win32').provenance.ref,
    ).toBe('msys-body-slash');
    expect(run('# use MSYS_NO_PATHCONV=1\ngh pr comment 5 -b /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(
      run('cat <<EOF\nMSYS_NO_PATHCONV=1\nEOF\ngh pr comment 5 -b /x', 'win32').provenance.ref,
    ).toBe('msys-body-slash');
    // A bare assignment sets a shell variable a later program never sees.
    expect(run('MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
    expect(run('export MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32').disposition).toBe(
      'allow',
    );
    expect(
      run('export MSYS_NO_PATHCONV=1 && echo $(git show origin/main:x.md)', 'win32').disposition,
    ).toBe('allow');
    expect(run('MSYS_NO_PATHCONV=1 gh pr comment 5 -b /x', 'win32').disposition).toBe('allow');
    expect(run('env MSYS_NO_PATHCONV=1 gh pr comment 5 -b /x', 'win32').disposition).toBe('allow');
    expect(
      run('MSYS_NO_PATHCONV=1 echo hi && echo $(git show origin/main:x.md)', 'win32').disposition,
    ).toBe('warn');
  });

  it('a <# inside a PowerShell string literal is text and silences nothing; a real block beside it is still blanked (re-arm, BRb-F1)', () => {
    expect(
      run("Write-Output '<#' ; sed -i 's/a\\t/b/' f", 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(
      run('Write-Output "<#" ; cat > f <<\'EOF\'\nconst re = /\\d+/;\nEOF', 'win32', 'PowerShell')
        .provenance.ref,
    ).toBe('heredoc-escape');
    expect(
      run("Write-Output 'it''s <#' ; sed -i 's/a\\t/b/' f", 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(
      run('Write-Output "a`"<#" ; sed -i \'s/a\\t/b/\' f', 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(
      run("Write-Output '<#' <# it's #> ; sed -i 's/a\\t/b/' f", 'win32', 'PowerShell').provenance
        .ref,
    ).toBe('sed-i-escape');
    expect(run("Write-Output '<#' 'plain'", 'win32', 'PowerShell').disposition).toBe('allow');
  });

  it('the opt-out is honoured through every shell form that exports it, with any value, until an unset (re-arm, BRb-F4 / F8)', () => {
    expect(run('declare -x MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32').disposition).toBe(
      'allow',
    );
    expect(run('typeset -x MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32').disposition).toBe(
      'allow',
    );
    expect(
      run('set -a; MSYS_NO_PATHCONV=1; set +a; gh pr comment 5 -b /x', 'win32').disposition,
    ).toBe('allow');
    expect(
      run('MSYS_NO_PATHCONV=1; export MSYS_NO_PATHCONV; gh pr comment 5 -b /x', 'win32')
        .disposition,
    ).toBe('allow');
    expect(run('MSYS_NO_PATHCONV=0 gh pr comment 5 -b /x', 'win32').disposition).toBe('allow');
    expect(run('MSYS_NO_PATHCONV= gh pr comment 5 -b /x', 'win32').disposition).toBe('allow');
    expect(
      run('export MSYS_NO_PATHCONV=1; unset MSYS_NO_PATHCONV; gh pr comment 5 -b /x', 'win32')
        .provenance.ref,
    ).toBe('msys-body-slash');
    expect(run('declare MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32').provenance.ref).toBe(
      'msys-body-slash',
    );
  });

  it("a PowerShell # line comment carrying a quote leaves a later block blanked and a block's body unexposed (termination check, BRc-F1)", () => {
    const miss =
      "# don't edit generated files\n<# the reviewer's note #>\nsed -i 's/\\r$//' file.txt";
    expect(run(miss, 'win32', 'PowerShell').provenance.ref).toBe('sed-i-escape');
    expect(
      run(
        "# don't edit generated files\n<# reviewer's note #>\ncat > f <<'EOF'\nx\\y\nEOF",
        'win32',
        'PowerShell',
      ).provenance.ref,
    ).toBe('heredoc-escape');
    const benign =
      "# don't edit generated files\n<#\n  sed -i 's/\\r$//' file.txt\n#>\nWrite-Output ok";
    expect(run(benign, 'win32', 'PowerShell').disposition).toBe('allow');
    expect(
      run("Write-Output a#b ; <# it's #> ; sed -i 's/\\t/ /' f", 'win32', 'PowerShell').provenance
        .ref,
    ).toBe('sed-i-escape');
  });

  it('the scanners read PowerShell in one walk: a # after a substitution, a brace, a closing quote or an = (final check, BRd-F1 / F2)', () => {
    const sed = "\nsed -i 's/\\r$//' f";
    expect(run("Write-Output $(1)#c <# it's #>" + sed, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    expect(
      run("if ($true) { Write-Output x }#c <# it's #>" + sed, 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(
      run("Write-Output $(1)#c <# ; sed -i 's/\\r$//' f #>", 'win32', 'PowerShell').disposition,
    ).toBe('allow');
    // A string that BEGAN its token ends it, and the assignment operator ends one,
    // so the `#` that follows is a comment (PowerShell's own tokenizer).
    expect(
      run("Write-Output 'a'#don't\n<# note #>" + sed, 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    expect(run("$x=#don't\n<# note #>" + sed, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    // The same two shapes are word text to bash, where `'a'#b` is one word.
    expect(tokenizeShell("echo 'a'#b")[0]?.tokens).toEqual(['echo', 'a#b']);
    expect(tokenizeShell("echo 'a'#b", { powershell: true })[0]?.tokens).toEqual(['echo', 'a']);
  });

  it('a string that continues a token, and an = inside an argument, end nothing; a <# inside $( … ) is a comment there too (final check, BRe-F1 / F2 / F3)', () => {
    const tail = " ; sed -i 's/\\d/x/' f";
    // PSParser: Command(x=a#c) StatementSeparator(;) Command(sed) — the sed runs.
    expect(run("x='a'#c" + tail, 'win32', 'PowerShell').provenance.ref).toBe('sed-i-escape');
    // PSParser: CommandArgument(a=#b) — one token, the sed runs.
    expect(run('Write-Output a=#b' + tail, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    expect(run('Write-Output http://h/p?a=#t' + tail, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    expect(run('Write-Output --define=#fff' + tail, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    // PSParser: GroupStart Number Comment(<# ) #>) GroupEnd — the `)` inside the block closes nothing.
    expect(run('Write-Output $(1 <# ) #>)' + tail, 'win32', 'PowerShell').provenance.ref).toBe(
      'sed-i-escape',
    );
    expect(
      run('Write-Output $(Write-Output ")" <# ) #>)' + tail, 'win32', 'PowerShell').provenance.ref,
    ).toBe('sed-i-escape');
    // Controls: where PowerShell really does comment out the tail.
    expect(run('Write-Output "a"#c' + tail, 'win32', 'PowerShell').disposition).toBe('allow');
    expect(run('$x =#c' + tail, 'win32', 'PowerShell').disposition).toBe('allow');
    expect(run('$x=#c' + tail, 'win32', 'PowerShell').disposition).toBe('allow');
  });

  it('an operand after -- is a file sed edits, never a script (final check, BRd-F3)', () => {
    expect(run("sed -i -- 's/a\\t/b/' -nfile").provenance.ref).toBe('sed-i-escape');
    expect(run("sed -i -- 's/a\\t/b/' -file").provenance.ref).toBe('sed-i-escape');
  });

  it('a clustered -nf is a script file too (termination check, BRc-F5)', () => {
    expect(run("sed -i -nf 'C:\\t.sed' file").disposition).toBe('allow');
    expect(run("sed -i -Enf 'C:\\t.sed' file").disposition).toBe('allow');
    expect(run("sed -i -if 's/a\\t/b/' file").provenance.ref).toBe('sed-i-escape');
  });

  it("GNU's attached -fFILE and -f- are script files too (re-arm, BRb-F3)", () => {
    expect(run("sed -i -fscript.sed 'C:\\temp\\f.txt'").disposition).toBe('allow');
    expect(run("sed -i -f- 'C:\\temp\\f.txt'").disposition).toBe('allow');
  });

  it('a -f / --file script path is never the sed expression, and with a script file no positional operand is (CodeRabbit)', () => {
    // Quoted, so the backslashes reach the operand (unquoted ones are bash escapes).
    expect(run("sed -i -f 'C:\\tmp\\script.sed' file").disposition).toBe('allow');
    expect(run("sed -i --file=C:\\tmp\\script.sed 'C:\\temp\\f.txt'").disposition).toBe('allow');
    expect(run("sed -i -f script.sed -e 's/a\\t/b/' f").provenance.ref).toBe('sed-i-escape');
  });

  it('the newline arm reads the expression operand only, never a file operand (CodeRabbit)', () => {
    expect(run('sed -i \'s/a/b/\' "f\ng"').disposition).toBe('allow');
    expect(run("sed -i 's/a/b\nc/' f").provenance.ref).toBe('sed-i-escape');
    expect(run("sed -i -e 's/a/b\nc/' f").provenance.matched).toBe('s/a/b c/');
  });
});

describe('transport-shield — the false-positive budget fixture (ADR-109; F6)', () => {
  // Everyday commands that share a token with a row. Budget: ZERO denies. A deny
  // here is a defect in a row, never a reason to widen the corpus by hand.
  const BENIGN: ReadonlyArray<[string, string]> = [
    ['git status -sb', 'win32'],
    ['git log --oneline -5 origin/main', 'win32'],
    ['gh pr view 2802 --json state,mergeable', 'win32'],
    ['gh pr comment 5 --body-file notes.md', 'win32'],
    ['gh pr comment 5 --body "@coderabbitai review"', 'win32'],
    ["gh api repos/mmnto-ai/totem/pulls/1/files --jq '.[].filename'", 'win32'],
    ['diff -b /d/Dev/a.txt /d/Dev/b.txt', 'win32'],
    ['curl -b /tmp/cookies.txt https://api.github.com', 'win32'],
    ['cp -b /tmp/a /tmp/b', 'win32'],
    ['sort -b /tmp/list.txt', 'win32'],
    ['du -b /d/Dev/totem', 'win32'],
    ['grep -b /usr/local notes.txt', 'win32'],
    ['grep gh -b /usr/local n.txt', 'win32'],
    ['echo gh -b /x', 'win32'],
    ["git log --grep sed -i 's/a\\t/b/'", 'win32'],
    ["which node -e 'a\\d'", 'win32'],
    ['MSYS_NO_PATHCONV=1 gh pr comment 5 -b /x', 'win32'],
    ["cat <<EOF\ndon't\nEOF\ncat <<EOF2\ngh pr comment 5 -b /some/path\nEOF2", 'win32'],
    ["grep -rn 'gate-wrapper' packages/cli/src --include=*.ts", 'win32'],
    ["grep '<<EOF' notes.md", 'win32'],
    ['bash <<< "hello world"', 'win32'],
    ["sed -n '1,5p' file", 'win32'],
    ["sed -i 's/a/b/' file", 'win32'],
    ["sed -i 's/a/b/' 'C:\\temp\\f.txt'", 'win32'],
    ["printf '%s\\n' 'a line' >> file.txt", 'win32'],
    ['node -e "console.log(1 + 1)"', 'win32'],
    ['node scripts/patch.mjs --dry-run', 'win32'],
    ['python3 -c "print(2 ** 10)"', 'win32'],
    ["cat > notes.md <<'EOF'\nhello world\nsecond line\nEOF", 'win32'],
    ['cat <<EOF\nplain body\nEOF', 'win32'],
    ['pnpm --filter @mmnto/cli exec vitest run src/commands/gate.test.ts', 'win32'],
    ['pnpm build && pnpm test', 'win32'],
    ['ls -la D:/Dev/worktrees | head -5', 'win32'],
    ['MSYS_NO_PATHCONV=1 git show origin/main:.totem/x.md', 'win32'],
    ['git show origin/main:.totem/x.md', 'win32'],
    ['echo "path: C:\\Users\\me"', 'linux'],
    ["awk -F: '{print $1}' /etc/passwd", 'linux'],
    ['find . -name "*.ts" -exec wc -l {} +', 'linux'],
    ['xargs -0 rm -f < list.txt', 'linux'],
    ['tar -czf out.tgz -C /tmp dir', 'linux'],
    ['docker run --rm -v "$PWD:/w" img', 'linux'],
    ['gh pr comment 5 --body "/gemini review"', 'linux'],
    ['gh pr comment 5 --body "/gemini review"', 'darwin'],
    // Pass 3: comments, continuations, arithmetic, a backslash-quoted delimiter, & and 2>&1.
    ['gh pr comment 5 --body-file notes.md # was --body /gemini review', 'win32'],
    ["sed -i -e 's/a/b/' f.txt # -e 's/c/d/'", 'win32'],
    ["grep -q x f && \\\n  sed -i 's/foo/bar/' file.ts", 'win32'],
    ["sed -i 's/foo/bar/' \\\n  packages/core/src/file.ts", 'win32'],
    ["mask=$((1 << n))\nsed -i 's/a/b/' 'C:\\x\\y.txt'", 'win32'],
    ['cat > f <<\\EOF\ngh pr comment 5 -b /some/path\nEOF', 'win32'],
    ["grep -n '$(git show origin/main:.totem/x.md)' notes.md", 'win32'],
    ['cmd 2>&1 | tee log', 'win32'],
    ['gh issue create --title -b --body-file notes.md', 'win32'],
    ["cat <<EOF.TXT\nplain\nEOF.TXT\nsed -i 's/a/b/' 'C:\\x'", 'win32'],
    ["awk -F\\' '{print $2}' f", 'win32'],
    ["(echo a)#see <<'EOF'\nx\\d\nEOF", 'win32'],
    ["cat <<1EOF\nit's\n1EOF\nsed -i 's/a/b/' 'C:\\x'", 'win32'],
    ["(cd x && make) # it's done\ncat <<'EOF'\nplain\nEOF", 'win32'],
    // The bot round: quoted parens in a substitution, a sed script file, an opt-out on another segment.
    ['x=$(echo ")") && gh pr view 1', 'win32'],
    ["sed -i -f 'C:\\tmp\\script.sed' file", 'win32'],
    ['MSYS_NO_PATHCONV=1 echo hi && gh pr view 1', 'win32'],
    ["Write-Output <# note #> 'plain'", 'win32'],
    // The re-arm: a string-borne <#, the export forms, GNU's attached -f.
    ["Write-Output '<#' 'plain'", 'win32'],
    ['declare -x MSYS_NO_PATHCONV=1; gh pr comment 5 -b /x', 'win32'],
    ['MSYS_NO_PATHCONV=0 gh pr comment 5 -b /x', 'win32'],
    ["sed -i -fscript.sed 'C:\\temp\\f.txt'", 'win32'],
    ["sed -i -nf 'C:\\t.sed' file", 'win32'],
  ];

  it('denies none of the benign corpus (budget: 0)', () => {
    const denies = BENIGN.filter(
      ([cmd, platform]) => run(cmd, platform).disposition === 'deny',
    ).map(([cmd]) => cmd);
    expect(denies).toEqual([]);
  });

  it('the PowerShell tool sees the benign corpus the same way', () => {
    const denies = BENIGN.filter(
      ([cmd, platform]) => run(cmd, platform, 'PowerShell').disposition === 'deny',
    ).map(([cmd]) => cmd);
    expect(denies).toEqual([]);
  });
});
