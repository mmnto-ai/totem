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

  it('a tab-indented delimiter ends a <<- heredoc and a CRLF terminator is read', () => {
    expect(findHeredocs("cat <<-'EOF'\n\tbody\n\tEOF\nafter")[0]?.body).toBe('\tbody\n');
    expect(findHeredocs("cat <<'EOF'\r\nbody\r\nEOF\r\n")[0]?.unterminated).toBe(false);
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
