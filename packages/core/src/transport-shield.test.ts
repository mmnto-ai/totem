import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemError } from './errors.js';
import { evaluateGate, gateMatcher, knownGateEvents, knownGates } from './gate-engine.js';
import {
  findHeredocs,
  HEREDOC_OVERSIZE_BYTES,
  MATCHED_FRAGMENT_MAX,
  parseTransportShieldPayload,
  tokenizeShell,
  TRANSPORT_PATTERNS,
  TRANSPORT_SHIELD_EVENT,
  TRANSPORT_SHIELD_SOURCE,
  type TransportPatternId,
  transportShieldEvaluator,
  type TransportShieldPayload,
} from './transport-shield.js';

const NO_DIR = '/nonexistent/.totem';

function run(command: string, platform = 'linux', tool: TransportShieldPayload['tool'] = 'Bash') {
  return transportShieldEvaluator({ tool, command, platform }, NO_DIR);
}

function expectDeny(
  command: string,
  id: TransportPatternId,
  platform = 'linux',
  tool: TransportShieldPayload['tool'] = 'Bash',
) {
  const v = run(command, platform, tool);
  expect(v.disposition, `expected deny(${id}) for: ${command}`).toBe('deny');
  expect(v.provenance.ref).toBe(id);
  expect(v.provenance.source).toBe(TRANSPORT_SHIELD_SOURCE);
  expect(v.provenance.matched).not.toBeNull();
  return v;
}

function expectAllow(
  command: string,
  platform = 'linux',
  tool: TransportShieldPayload['tool'] = 'Bash',
) {
  const v = run(command, platform, tool);
  expect(v.disposition, `expected allow for: ${command}`).toBe('allow');
  expect(v.provenance.ref).toBe('no-match');
  expect(v.provenance.matched).toBeNull();
  return v;
}

// A heredoc body carrying a regex-looking escape — the mmnto-ai/totem-strategy#1247 shape.
const HEREDOC_WITH_ESCAPE = "cat > scratch.mjs <<'EOF'\nconst re = /\\d+/;\nEOF";
const HEREDOC_CLEAN = "cat > notes.md <<'EOF'\nhello world\nsecond line\nEOF";

describe('transport-shield — the charter corpus (positive rows are refused)', () => {
  it('denies a heredoc body carrying a backslash (the #1247 shape), naming the Write cure', () => {
    const v = expectDeny(HEREDOC_WITH_ESCAPE, 'heredoc-escape');
    expect(v.reason).toContain('Write tool');
    expect(v.provenance.matched).toContain('const re');
  });

  it('denies a heredoc body carrying a backtick', () => {
    expectDeny("node - <<'JS'\nconsole.log(`hi`);\nJS", 'heredoc-escape');
  });

  it('denies an unterminated heredoc whose remaining text carries an escape', () => {
    const v = expectDeny("cat > f <<'EOF'\nline one\nsee \\d here", 'heredoc-escape');
    expect(v.reason).toContain('unterminated');
  });

  it('denies a bare-delimiter and a <<- heredoc alike', () => {
    expectDeny('cat > f <<EOF\n\\x\nEOF', 'heredoc-escape');
    expectDeny("cat > f <<-'EOF'\n\t\\x\n\tEOF", 'heredoc-escape');
  });

  it('denies a leading-slash --body on win32 from the Bash tool (the /gemini review that posted as a Program Files path)', () => {
    const v = expectDeny('gh pr comment 2797 --body "/gemini review"', 'msys-body-slash', 'win32');
    expect(v.reason).toContain('--body-file');
    expect(v.provenance.matched).toBe('--body /gemini review');
  });

  it('denies the --body= and -b forms of the same slash body on win32', () => {
    expectDeny('gh pr comment 5 --body=/gemini review', 'msys-body-slash', 'win32');
    expectDeny("gh pr comment 5 -b '/coderabbitai review'", 'msys-body-slash', 'win32');
  });

  it('denies the slash body inside a later segment of a chained command', () => {
    expectDeny(
      'git fetch origin && gh pr comment 5 --body "/gemini review"',
      'msys-body-slash',
      'win32',
    );
  });

  it('denies sed -i whose expression carries a backslash', () => {
    const v = expectDeny("sed -i 's/\\(a\\)/x/' file.txt", 'sed-i-escape');
    expect(v.reason).toContain('Edit tool');
  });

  it('denies sed -i with more than one -e expression', () => {
    expectDeny('sed -i -e "s/a/b/g" -e "s/c/d/g" file', 'sed-i-escape');
  });

  it('denies sed -i whose invocation spans a newline inside quotes', () => {
    expectDeny("sed -i 's/a/b\nc/' file", 'sed-i-escape');
  });

  it('denies sed -i.bak and --in-place spellings the same way', () => {
    expectDeny("sed -i.bak 's/\\t/ /' file", 'sed-i-escape');
    expectDeny("sed --in-place 's/\\t/ /' file", 'sed-i-escape');
  });

  it('denies an inline node -e body carrying a backtick', () => {
    const v = expectDeny('node -e "console.log(`x`)"', 'inline-body-escape');
    expect(v.reason).toContain('Write tool');
  });

  it('denies inline node --eval, python -c and python3 -c bodies carrying a backslash', () => {
    expectDeny('node --eval \'process.stdout.write("a\\n")\'', 'inline-body-escape');
    expectDeny('python -c \'print("a\\tb")\'', 'inline-body-escape');
    expectDeny('python3 -c \'import re; re.compile("\\\\d")\'', 'inline-body-escape');
  });

  it('the first deny in table order wins when two rows fire', () => {
    const v = expectDeny(
      HEREDOC_WITH_ESCAPE + ' && gh pr comment 5 --body "/x"',
      'heredoc-escape',
      'win32',
    );
    expect(v.provenance.ref).toBe('heredoc-escape');
  });
});

describe('transport-shield — the charter corpus (negative rows are allowed)', () => {
  it('allows a heredoc with no backslash or backtick', () => {
    expectAllow(HEREDOC_CLEAN);
    expectAllow(HEREDOC_CLEAN, 'win32');
  });

  it('allows --body-file, which is a different flag from --body', () => {
    expectAllow('gh pr comment 5 --body-file notes.md', 'win32');
    expectAllow('gh pr comment 5 --body-file=/tmp/notes.md', 'win32');
  });

  it('allows an @-prefixed body on win32 (an @ body is safe)', () => {
    expectAllow('gh pr comment 5 --body "@coderabbitai review"', 'win32');
  });

  it('allows the slash body from the PowerShell tool (no MSYS in that shell)', () => {
    expectAllow('gh pr comment 5 --body "/gemini review"', 'win32', 'PowerShell');
  });

  it('allows the slash body from the Bash tool off win32', () => {
    expectAllow('gh pr comment 5 --body "/gemini review"', 'linux');
    expectAllow('gh pr comment 5 --body "/gemini review"', 'darwin');
  });

  it('allows sed -n (not in place) and a plain in-place substitution', () => {
    expectAllow("sed -n '1,5p' file");
    expectAllow("sed -i 's/a/b/' file");
  });

  it("allows printf '%s\\n' … >> file (a backslash in a plain argument is not a heredoc)", () => {
    expectAllow("printf '%s\\n' 'a line' >> file.txt");
  });

  it('allows a node -e body with no escape and a node script run by path', () => {
    expectAllow('node -e "console.log(1 + 1)"');
    expectAllow('node scripts/patch.mjs');
  });

  it('allows a --body value that lives inside a heredoc body (bodies are blanked before tokenizing)', () => {
    expectAllow('cat > f <<\'EOF\'\ngh pr comment 5 --body "/x"\nEOF', 'win32');
  });

  it('allows a URL-shaped colon token in a subshell', () => {
    expectAllow('echo $(curl -s https://example.com/x)', 'win32');
  });
});

describe('transport-shield — the PowerShell tool (the tool-agnostic rows pinned; the Bash-only rows inert)', () => {
  it('denies a heredoc escape and a sed -i escape, and warns on an oversize heredoc, from PowerShell too', () => {
    expectDeny(HEREDOC_WITH_ESCAPE, 'heredoc-escape', 'win32', 'PowerShell');
    expectDeny("sed -i 's/\\t/ /' f", 'sed-i-escape', 'win32', 'PowerShell');
    const v = run(
      `cat > f <<'EOF'\n${'x'.repeat(HEREDOC_OVERSIZE_BYTES)}\nEOF`,
      'win32',
      'PowerShell',
    );
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('heredoc-oversize');
  });

  it('the Bash-only rows never fire from PowerShell', () => {
    expectAllow('gh pr comment 5 --body /x', 'win32', 'PowerShell');
    expectAllow('echo $(git show origin/main:x.md)', 'win32', 'PowerShell');
    expectAllow("node -e 'a\\d'", 'win32', 'PowerShell');
  });
});

describe('transport-shield — the warn rows (allow + advisory)', () => {
  it('warns on a <rev>:<path> inside $( … ) on win32 without MSYS_NO_PATHCONV=1, and allows it with the prefix', () => {
    const v = run('echo $(git show origin/main:.totem/x.md)', 'win32');
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('msys-rev-path-subshell');
    expect(v.provenance.matched).toBe('origin/main:.totem/x.md');
    expect(v.reason).toContain('MSYS_NO_PATHCONV=1');
    expectAllow('MSYS_NO_PATHCONV=1 echo $(git show origin/main:.totem/x.md)', 'win32');
  });

  it('does not warn on the rev:path shape off win32 or outside a subshell', () => {
    expectAllow('echo $(git show origin/main:.totem/x.md)', 'linux');
    expectAllow('git show origin/main:.totem/x.md', 'win32');
  });

  it('warns on a heredoc body of exactly the oversize threshold and allows one byte below it', () => {
    // The body includes its trailing newline: HEREDOC_OVERSIZE_BYTES - 1 x's + "\n"
    // is exactly the threshold, so the comparison operator (>=) is pinned.
    const atThreshold = 'x'.repeat(HEREDOC_OVERSIZE_BYTES - 1);
    const v = run(`cat > f <<'EOF'\n${atThreshold}\nEOF`);
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('heredoc-oversize');
    expect(v.reason).toContain(`is ${HEREDOC_OVERSIZE_BYTES} bytes`);
    expect(v.reason).toContain('heuristic');
    expectAllow(`cat > f <<'EOF'\n${'x'.repeat(HEREDOC_OVERSIZE_BYTES - 2)}\nEOF`);
  });

  it('a deny wins over a warn on the same command', () => {
    const big = 'x'.repeat(HEREDOC_OVERSIZE_BYTES);
    const v = run(`cat > f <<'EOF'\n${big}\\d\nEOF`);
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('heredoc-escape');
  });
});

describe('transport-shield — payload, purity, provenance', () => {
  it('throws GATE_INVALID on a missing command, an empty command, a tool outside the pair, or a missing platform — never default-allows', () => {
    for (const bad of [
      { tool: 'Bash', platform: 'win32' },
      { tool: 'Bash', command: '   ', platform: 'win32' },
      { tool: 'Write', command: 'x', platform: 'win32' },
      { tool: 'Bash', command: 'x' },
      null,
      'gh pr merge',
    ]) {
      expect(() => transportShieldEvaluator(bad, NO_DIR)).toThrow(TotemError);
      let code: string | undefined;
      try {
        transportShieldEvaluator(bad, NO_DIR);
      } catch (err) {
        code = (err as TotemError).code;
      }
      expect(code).toBe('GATE_INVALID');
    }
  });

  it('parseTransportShieldPayload trims the platform and keeps the command verbatim', () => {
    const p = parseTransportShieldPayload({
      tool: 'PowerShell',
      command: ' gh pr merge 1 ',
      platform: ' win32 ',
    });
    expect(p).toEqual({ tool: 'PowerShell', command: ' gh pr merge 1 ', platform: 'win32' });
  });

  it('is pure over the payload: the verdict follows the payload platform, never the runner', () => {
    const cmd = 'gh pr comment 5 --body "/gemini review"';
    expect(run(cmd, 'win32').disposition).toBe('deny');
    expect(run(cmd, 'linux').disposition).toBe('allow');
    // Whatever this runner is, the opposite platform yields the opposite verdict.
    const opposite = process.platform === 'win32' ? 'linux' : 'win32';
    expect(run(cmd, opposite).disposition).toBe(opposite === 'win32' ? 'deny' : 'allow');
  });

  it('bounds provenance.matched to MATCHED_FRAGMENT_MAX characters and strips control characters', () => {
    const long = 'a'.repeat(300);
    const v = run(`cat > f <<'EOF'\n\t${long}\\d\nEOF`);
    expect(v.disposition).toBe('deny');
    const matched = v.provenance.matched as string;
    // 300 characters truncate deterministically to the cap: 79 kept plus the ellipsis.
    expect(matched.length).toBe(MATCHED_FRAGMENT_MAX);
    expect(matched.endsWith('…')).toBe(true);
    expect(/[\x00-\x1f\x7f]/.test(matched)).toBe(false);
  });

  it('always carries provenance with the table source and an ISO checkedAt', () => {
    for (const v of [
      run(HEREDOC_CLEAN),
      run(HEREDOC_WITH_ESCAPE),
      run('echo $(git show a/b:c)', 'win32'),
    ]) {
      expect(v.provenance.source).toBe(TRANSPORT_SHIELD_SOURCE);
      expect(() => new Date(v.provenance.checkedAt).toISOString()).not.toThrow();
      expect(v.provenance.checkedAt).toBe(new Date(v.provenance.checkedAt).toISOString());
      expect(
        TRANSPORT_PATTERNS.some((p) => p.id === v.provenance.ref) ||
          v.provenance.ref === 'no-match',
      ).toBe(true);
    }
  });

  it("every row's reason ends with its cure — one sample per row, so a new row without a sample fails here", () => {
    const sample: Record<TransportPatternId, [command: string, platform: string]> = {
      'heredoc-escape': [HEREDOC_WITH_ESCAPE, 'linux'],
      'msys-body-slash': ['gh pr comment 5 --body /x', 'win32'],
      'sed-i-escape': ["sed -i 's/\\(a\\)/x/' f", 'linux'],
      'inline-body-escape': ["node -e 'a\\d'", 'linux'],
      'heredoc-oversize': [`cat <<EOF\n${'x'.repeat(HEREDOC_OVERSIZE_BYTES)}\nEOF`, 'linux'],
      'msys-rev-path-subshell': ['echo $(git show a/b:c)', 'win32'],
    };
    for (const pattern of TRANSPORT_PATTERNS) {
      expect(pattern.cure.length, pattern.id).toBeGreaterThan(0);
      const [command, platform] = sample[pattern.id];
      const v = run(command, platform);
      expect(v.provenance.ref, pattern.id).toBe(pattern.id);
      expect(v.disposition, pattern.id).toBe(pattern.disposition);
      expect(v.reason.endsWith(`${pattern.cure}.`), `${pattern.id}: ${v.reason}`).toBe(true);
    }
  });
});

describe('transport-shield — side-effect-free and registered', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-transport-'));
    fs.writeFileSync(path.join(tmpRoot, 'marker.txt'), 'untouched');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('never writes or mutates state when evaluated against a totemDir', () => {
    const before = fs.readdirSync(tmpRoot).sort();
    const bytes = fs.readFileSync(path.join(tmpRoot, 'marker.txt'));
    evaluateGate(
      TRANSPORT_SHIELD_EVENT,
      { tool: 'Bash', command: HEREDOC_WITH_ESCAPE, platform: 'win32' },
      tmpRoot,
    );
    evaluateGate(
      TRANSPORT_SHIELD_EVENT,
      { tool: 'Bash', command: HEREDOC_CLEAN, platform: 'win32' },
      tmpRoot,
    );
    expect(fs.readdirSync(tmpRoot).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(tmpRoot, 'marker.txt')).equals(bytes)).toBe(true);
  });

  it('is dispatched by the engine under its event name', () => {
    const v = evaluateGate(
      TRANSPORT_SHIELD_EVENT,
      { tool: 'Bash', command: 'gh pr comment 5 --body "/x"', platform: 'win32' },
      tmpRoot,
    );
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('msys-body-slash');
  });

  it('the registry lists both gates with their matchers, and gateMatcher throws on an unknown event', () => {
    expect(knownGateEvents()).toEqual(['freeze-check', TRANSPORT_SHIELD_EVENT]);
    expect(knownGates()).toEqual([
      { event: 'freeze-check', matcher: 'Write|Edit' },
      { event: TRANSPORT_SHIELD_EVENT, matcher: 'Bash|PowerShell' },
    ]);
    expect(gateMatcher('freeze-check')).toBe('Write|Edit');
    expect(gateMatcher(TRANSPORT_SHIELD_EVENT)).toBe('Bash|PowerShell');
    expect(() => gateMatcher('nope')).toThrow(TotemError);
  });
});

describe('transport-shield — the helpers', () => {
  it('findHeredocs reads quoted, bare and <<- delimiters and reports the terminator state', () => {
    const spans = findHeredocs("a <<'X'\nbody\nX\nb <<Y\nmore\n");
    expect(spans.map((s) => [s.delimiter, s.quoted, s.body, s.unterminated])).toEqual([
      ['X', true, 'body\n', false],
      ['Y', false, 'more\n', true],
    ]);
  });

  it('tokenizeShell resolves quotes, keeps $( … ) whole, and splits at control operators', () => {
    const segs = tokenizeShell("gh pr comment 5 --body '/x y' && echo $(git show a:b) | cat");
    expect(segs.map((s) => s.tokens)).toEqual([
      ['gh', 'pr', 'comment', '5', '--body', '/x y'],
      ['echo', '$(git show a:b)'],
      ['cat'],
    ]);
  });
});
