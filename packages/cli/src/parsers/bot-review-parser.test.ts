import { describe, expect, it } from 'vitest';

import type { CommentThread } from './bot-review-parser.js';
import {
  detectBot,
  extractPushbackFindings,
  extractResolvedBotFindings,
  extractReviewBodyFindings,
  extractSuggestion,
  isBotComment,
  isThreadResolved,
  parseCRSeverity,
  parseGCASeverity,
  stripHtmlWrappers,
} from './bot-review-parser.js';

// ─── detectBot ──────────────────────────────────────────

describe('detectBot', () => {
  it('identifies coderabbitai[bot]', () => {
    expect(detectBot('coderabbitai[bot]')).toBe('coderabbit');
  });

  it('identifies gemini-code-assist[bot]', () => {
    expect(detectBot('gemini-code-assist[bot]')).toBe('gca');
  });

  it('returns unknown for human authors', () => {
    expect(detectBot('octocat')).toBe('unknown');
    expect(detectBot('jmatt')).toBe('unknown');
  });
});

// ─── isBotComment ───────────────────────────────────────

describe('isBotComment', () => {
  it('returns true for coderabbit bot', () => {
    expect(isBotComment('coderabbitai[bot]')).toBe(true);
  });

  it('returns true for GCA bot', () => {
    expect(isBotComment('gemini-code-assist[bot]')).toBe(true);
  });

  it('returns false for human authors', () => {
    expect(isBotComment('octocat')).toBe(false);
  });
});

// ─── parseCRSeverity ────────────────────────────────────

describe('parseCRSeverity', () => {
  it('extracts critical from emoji', () => {
    expect(parseCRSeverity('\u{1F534} **Critical:** Buffer overflow risk')).toBe('critical');
  });

  it('extracts critical from text', () => {
    expect(parseCRSeverity('This is a critical issue')).toBe('critical');
  });

  it('extracts major from emoji', () => {
    expect(parseCRSeverity('\u{1F7E0} **Major:** Missing null check')).toBe('major');
  });

  it('extracts minor from emoji', () => {
    expect(parseCRSeverity('\u{1F7E1} **Minor:** Consider renaming')).toBe('minor');
  });

  it('returns info for plain text', () => {
    expect(parseCRSeverity('Just a comment about style')).toBe('info');
  });
});

// ─── parseGCASeverity ───────────────────────────────────

describe('parseGCASeverity', () => {
  it('extracts high from SVG reference', () => {
    expect(parseGCASeverity('![](https://example.com/high-priority.svg) Fix this')).toBe('high');
  });

  it('extracts high from security SVG reference', () => {
    expect(parseGCASeverity('![](https://example.com/security-high-priority.svg)')).toBe('high');
  });

  it('extracts medium from SVG reference', () => {
    expect(parseGCASeverity('![](https://example.com/medium-priority.svg) Rework this')).toBe(
      'medium',
    );
  });

  it('extracts low from SVG reference', () => {
    expect(parseGCASeverity('![](https://example.com/low-priority.svg) Nice to have')).toBe('low');
  });

  it('returns info when no SVG marker present', () => {
    expect(parseGCASeverity('Plain comment without severity')).toBe('info');
  });
});

// ─── stripHtmlWrappers ──────────────────────────────────

describe('stripHtmlWrappers', () => {
  it('removes details/summary/blockquote tags', () => {
    const html =
      '<details><summary>Click to expand</summary><blockquote>Content</blockquote></details>';
    expect(stripHtmlWrappers(html)).toBe('Content');
  });

  it('removes HTML comments', () => {
    const html = '<!-- fingerprint:abc123 -->Actual content<!-- end -->';
    expect(stripHtmlWrappers(html)).toBe('Actual content');
  });

  it('removes code tags', () => {
    const html = 'Use <code>const</code> instead';
    expect(stripHtmlWrappers(html)).toBe('Use const instead');
  });

  it('preserves inner text content', () => {
    expect(stripHtmlWrappers('No HTML here')).toBe('No HTML here');
  });
});

// ─── extractSuggestion ─────────────────────────────────

describe('extractSuggestion', () => {
  it('extracts code from suggestion blocks', () => {
    const body = 'Consider this:\n```suggestion\nconst x = 42;\n```\nEnd.';
    expect(extractSuggestion(body)).toBe('const x = 42;');
  });

  it('returns undefined when no suggestion', () => {
    expect(extractSuggestion('Just a plain comment')).toBeUndefined();
  });

  it('returns undefined for non-suggestion code blocks', () => {
    const body = '```typescript\nconst x = 42;\n```';
    expect(extractSuggestion(body)).toBeUndefined();
  });
});

// ─── isThreadResolved ───────────────────────────────────

describe('isThreadResolved', () => {
  const botAuthor = 'coderabbitai[bot]';
  const humanAuthor = 'dev-user';

  function makeThread(botBody: string, humanReplies: string[]): CommentThread {
    return {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [
        { author: botAuthor, body: botBody },
        ...humanReplies.map((body) => ({ author: humanAuthor, body })),
      ],
    };
  }

  it('returns true when human replied "Fixed"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Fixed in latest commit']))).toBe(true);
  });

  it('returns true when human replied "done"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Done']))).toBe(true);
  });

  it('returns true when human replied "addressed"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Addressed this']))).toBe(true);
  });

  it('returns true when human replied "applied"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Applied the suggestion']))).toBe(true);
  });

  it('returns false when human replied "intentional"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['This is intentional']))).toBe(false);
  });

  it('returns false when human replied "by design"', () => {
    expect(isThreadResolved(makeThread('Issue here', ['This is by design']))).toBe(false);
  });

  it('returns false when human replied "won\'t fix"', () => {
    expect(isThreadResolved(makeThread('Issue here', ["Won't fix this"]))).toBe(false);
  });

  it('returns false with no human replies', () => {
    const thread: CommentThread = {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [{ author: botAuthor, body: 'Issue here' }],
    };
    expect(isThreadResolved(thread)).toBe(false);
  });

  it('returns false when first comment is not from a bot', () => {
    const thread: CommentThread = {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [
        { author: humanAuthor, body: 'I have a question' },
        { author: botAuthor, body: 'Here is the answer' },
      ],
    };
    expect(isThreadResolved(thread)).toBe(false);
  });

  it('returns true when reply contains commit SHA', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Fixed in abc1234']))).toBe(true);
  });

  it('returns true when reply contains ticket reference', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Tracked in #456']))).toBe(true);
  });

  it('returns false when human reply has no signal', () => {
    expect(isThreadResolved(makeThread('Issue here', ['Thanks for the review']))).toBe(false);
  });

  it('returns false when empty thread', () => {
    const thread: CommentThread = {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [],
    };
    expect(isThreadResolved(thread)).toBe(false);
  });
});

// ─── extractResolvedBotFindings ─────────────────────────

describe('extractResolvedBotFindings', () => {
  it('filters to only resolved threads', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ hunk',
        comments: [
          { author: 'coderabbitai[bot]', body: '\u{1F7E1} Minor issue' },
          { author: 'dev', body: 'Fixed' },
        ],
      },
      {
        path: 'src/b.ts',
        diffHunk: '@@ hunk',
        comments: [
          { author: 'coderabbitai[bot]', body: 'Some issue' },
          // No human reply — not resolved
        ],
      },
      {
        path: 'src/c.ts',
        diffHunk: '@@ hunk',
        comments: [
          { author: 'coderabbitai[bot]', body: 'Another issue' },
          { author: 'dev', body: 'Intentional' },
        ],
      },
    ];

    const findings = extractResolvedBotFindings(threads);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('src/a.ts');
    expect(findings[0]!.severity).toBe('minor');
    expect(findings[0]!.resolutionSignal).toBe('reply');
  });

  it('normalizes CR and GCA findings', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/x.ts',
        diffHunk: '@@ cr-hunk',
        comments: [
          {
            author: 'coderabbitai[bot]',
            body: '\u{1F534} Critical: SQL injection risk\n```suggestion\nuse parameterized query\n```',
          },
          { author: 'dev', body: 'Applied' },
        ],
      },
      {
        path: 'src/y.ts',
        diffHunk: '@@ gca-hunk',
        comments: [
          {
            author: 'gemini-code-assist[bot]',
            body: '![](https://img/medium-priority.svg) Consider null check',
          },
          { author: 'dev', body: 'Done' },
        ],
      },
    ];

    const findings = extractResolvedBotFindings(threads);
    expect(findings).toHaveLength(2);

    // CodeRabbit finding
    expect(findings[0]!.tool).toBe('coderabbit');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.suggestion).toBe('use parameterized query');

    // GCA finding
    expect(findings[1]!.tool).toBe('gca');
    expect(findings[1]!.severity).toBe('medium');
    expect(findings[1]!.suggestion).toBeUndefined();
  });
});

// ─── extractPushbackFindings ──────────────────────────

describe('extractPushbackFindings', () => {
  it('extracts findings from threads where human pushed back', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ -1,3 +1,5 @@',
        comments: [
          { author: 'coderabbitai[bot]', body: '\u{1F7E0} Major: Add error handling' },
          { author: 'dev', body: 'This is intentional — we let it throw' },
        ],
      },
      {
        path: 'src/b.ts',
        diffHunk: '@@ -10,3 +10,5 @@',
        comments: [
          { author: 'coderabbitai[bot]', body: 'Missing null check' },
          { author: 'dev', body: 'Fixed' },
        ],
      },
    ];

    const findings = extractPushbackFindings(threads);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('src/a.ts');
    expect(findings[0]!.tool).toBe('coderabbit');
    expect(findings[0]!.resolutionSignal).toBe('none');
  });

  it('detects multiple pushback patterns', () => {
    const patterns = [
      "Won't fix this",
      'This is by design',
      'Not applicable here',
      'Ignoring this — test fixture',
      'Dismissed',
      'Just a nit',
    ];

    for (const reply of patterns) {
      const threads: CommentThread[] = [
        {
          path: 'src/test.ts',
          diffHunk: '@@ hunk',
          comments: [
            { author: 'coderabbitai[bot]', body: 'Some issue' },
            { author: 'dev', body: reply },
          ],
        },
      ];
      expect(extractPushbackFindings(threads)).toHaveLength(1);
    }
  });

  it('skips threads with no human replies', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ hunk',
        comments: [{ author: 'coderabbitai[bot]', body: 'Issue' }],
      },
    ];
    expect(extractPushbackFindings(threads)).toHaveLength(0);
  });

  it('skips threads starting with human comment', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ hunk',
        comments: [
          { author: 'dev', body: 'Question' },
          { author: 'coderabbitai[bot]', body: 'Answer' },
        ],
      },
    ];
    expect(extractPushbackFindings(threads)).toHaveLength(0);
  });

  it('extracts line numbers from diff hunk headers', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ -10,5 +42,7 @@',
        comments: [
          { author: 'coderabbitai[bot]', body: 'Issue here' },
          { author: 'dev', body: 'By design' },
        ],
      },
    ];

    const findings = extractPushbackFindings(threads);
    expect(findings[0]!.line).toBe(42);
  });

  it('handles GCA bot findings', () => {
    const threads: CommentThread[] = [
      {
        path: 'src/a.ts',
        diffHunk: '@@ hunk',
        comments: [
          {
            author: 'gemini-code-assist[bot]',
            body: '![](https://img/high-priority.svg) Security concern',
          },
          { author: 'dev', body: 'Not applicable — internal tool' },
        ],
      },
    ];

    const findings = extractPushbackFindings(threads);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tool).toBe('gca');
    expect(findings[0]!.severity).toBe('high');
  });
});

// ─── decline taxonomy / disposition (mmnto-ai/totem#2124, doctrine bot-protocols.md §8.1) ───

describe('decline taxonomy (mmnto-ai/totem#2124)', () => {
  const bot = 'coderabbitai[bot]';
  const human = 'dev-user';
  const thread = (botBody: string, reply: string): CommentThread => ({
    path: 'src/foo.ts',
    diffHunk: '@@ -1,3 +1,5 @@',
    comments: [
      { author: bot, body: botBody },
      { author: human, body: reply },
    ],
  });

  it('isThreadResolved: a bare "declined" reply is not resolved', () => {
    expect(isThreadResolved(thread('Issue', 'Declined — premise is false'))).toBe(false);
  });

  it('isThreadResolved: decline-* class tokens are not resolved', () => {
    expect(isThreadResolved(thread('Issue', 'decline-substantive: see lance-search.ts'))).toBe(
      false,
    );
    expect(isThreadResolved(thread('Issue', 'decline-hallucination'))).toBe(false);
  });

  it('isThreadResolved: a soft-decline with a positive word is NOT laundered (the #2124 vector)', () => {
    // "Addressed" is a positive signal, but the finding was declined. Pre-fix, the positive
    // pattern won and this laundered into extraction. The decline term must win.
    expect(
      isThreadResolved(thread('Issue', 'Addressed — declined, sourceRepo is constructor-injected')),
    ).toBe(false);
  });

  it('extractResolvedBotFindings: marks resolved findings disposition=accepted', () => {
    const findings = extractResolvedBotFindings([thread('Issue', 'Fixed in abc1234')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.disposition).toBe('accepted');
  });

  it('extractPushbackFindings: marks declines disposition=declined with the reply as rationale', () => {
    const findings = extractPushbackFindings([thread('Issue', 'Declined — false positive')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.disposition).toBe('declined');
    expect(findings[0]!.dispositionRationale).toBe('Declined — false positive');
  });

  it('extractPushbackFindings: detects a decline-* class token as pushback', () => {
    expect(extractPushbackFindings([thread('Issue', 'decline-stylistic')])).toHaveLength(1);
  });

  it('extractReviewBodyFindings: carries no disposition (no acceptance signal observed)', () => {
    const body = [
      '<details>',
      '<summary>🧹 Nitpick comments (1)</summary><blockquote>',
      '',
      '<details>',
      '<summary>src/foo.ts (1)</summary><blockquote>',
      '',
      '`10-12`: **Consider renaming the variable.**',
      '',
      'A clearer name would help.',
      '',
      '</blockquote></details>',
      '',
      '</blockquote></details>',
    ].join('\n');
    const findings = extractReviewBodyFindings([{ author: 'coderabbitai[bot]', body }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.disposition).toBeUndefined();
  });
});
