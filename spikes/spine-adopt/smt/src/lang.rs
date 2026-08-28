//! Alphabets, the glob→regex lowering, and the corpus patterns the obligations
//! are built from.
//!
//! Everything in this module is a MODELLING CHOICE, and each choice bounds what
//! the obligations prove. They are stated here, once, because OBLIGATIONS.md
//! § Binding notes requires the lowering to be "documented beside the encoding,
//! since its fidelity bounds what O5/O6 prove".

use crate::re::Re;

// ─── Alphabets ──────────────────────────────────────────────────────────────

/// The LINE alphabet: horizontal tab plus printable ASCII (0x20..=0x7E).
///
/// The record runtime evaluates every regex per ADDED LINE and flagless
/// (spec § "Census corrections"), so a line never contains `\n`. Tab is kept
/// because `\s+` appears in three of the four corpus patterns modelled here and
/// tab is a real inter-token separator in shell text.
///
/// RESTRICTION (bounds every obligation below): `\f` and `\v` — which JavaScript
/// `\s` also matches — are OUTSIDE this alphabet, as is every non-ASCII
/// character. A witness is therefore always a real line, but an ABSENCE of a
/// witness (an UNSAT) is only an absence over this alphabet.
pub fn line_any() -> Re {
    Re::union(vec![Re::lit("\t"), Re::range(' ', '~')])
}

pub fn line_star() -> Re {
    Re::star(line_any())
}

/// `[A-Za-z0-9_]` — the regex word class.
pub fn word_char() -> Re {
    Re::union(vec![
        Re::range('0', '9'),
        Re::range('A', 'Z'),
        Re::range('a', 'z'),
        Re::lit("_"),
    ])
}

/// The LINE alphabet minus the word class, enumerated as explicit ranges.
///
/// Spelled out rather than written `re.inter(LINE, re.comp(WORD))` because the
/// enumeration is what the solver reasons about fastest — and because O9's
/// check A independently PROVES this enumeration equals the complement form.
/// If the enumeration were wrong, O9 check A turns SAT and reports a witness.
pub fn nonword_char() -> Re {
    Re::union(vec![
        Re::lit("\t"),
        Re::range(' ', '/'),  // 0x20..0x2F
        Re::range(':', '@'),  // 0x3A..0x40
        Re::range('[', '^'),  // 0x5B..0x5E — 0x5F is '_', a WORD char
        Re::lit("`"),         // 0x60
        Re::range('{', '~'),  // 0x7B..0x7E
    ])
}

/// `\s` restricted to the LINE alphabet: space or tab.
pub fn ws_char() -> Re {
    Re::union(vec![Re::lit(" "), Re::lit("\t")])
}

// ─── `\b` desugaring ────────────────────────────────────────────────────────
//
// SMT-LIB regexes have no zero-width assertions, so `\b` must be desugared into
// explicit context. Each helper below is only valid when the character on the
// PATTERN side of the boundary is a word character — true for every `\b` in the
// patterns modelled here (each abuts `git`, `rm`, or an alternation whose every
// branch begins and ends with a word character).

/// The CORRECT leading-`\b` context: "nothing at all, or anything ending in a
/// non-word character". The `nothing at all` branch is what makes a match at
/// position 0 legal.
pub fn boundary_prefix() -> Re {
    Re::opt(Re::cat(vec![line_star(), nonword_char()]))
}

/// The correct trailing-`\b` context — the mirror image.
pub fn boundary_suffix() -> Re {
    Re::opt(Re::cat(vec![nonword_char(), line_star()]))
}

/// A structurally DIFFERENT but intendedly equivalent leading context, framed
/// with `re.comp`: strings over the alphabet that do not end in a word
/// character. Note the `re.inter` with `line_star()` — `re.comp` complements
/// over ALL strings, so without it this would admit non-alphabet characters.
/// O9 check A is the proof that this equals `boundary_prefix()`.
pub fn boundary_prefix_complement_framed() -> Re {
    Re::inter(vec![
        line_star(),
        Re::comp(Re::cat(vec![line_star(), word_char()])),
    ])
}

pub fn boundary_suffix_complement_framed() -> Re {
    Re::inter(vec![
        line_star(),
        Re::comp(Re::cat(vec![word_char(), line_star()])),
    ])
}

/// The NAIVE desugar a lowerer reaches for first: `\b` → "a non-word
/// character", dropping the string-edge case. O9 check B measures whether that
/// shortcut is language-preserving.
pub fn boundary_prefix_naive() -> Re {
    Re::cat(vec![line_star(), nonword_char()])
}

pub fn boundary_suffix_naive() -> Re {
    Re::cat(vec![nonword_char(), line_star()])
}

// ─── Corpus patterns ────────────────────────────────────────────────────────

/// Specimen (d) — `d-requires-line.rule.yaml` `target.pattern`:
/// `\bgit\s+(log|diff|status)\b`, body only (boundaries applied by the caller).
pub fn specimen_d_target_body() -> Re {
    Re::cat(vec![
        Re::lit("git"),
        Re::plus(ws_char()),
        Re::union(vec![Re::lit("log"), Re::lit("diff"), Re::lit("status")]),
    ])
}

/// Specimen (d) `requires.pattern`: the literal `LC_ALL=C`.
pub fn specimen_d_requires() -> Re {
    Re::lit("LC_ALL=C")
}

/// Specimen (a) — `a-regex-lessons-rm-guard.rule.yaml` `target.pattern`:
/// `\b(?:git\s+rm|rm)\s+[^\n]{0,40}\.totem/lessons\.md\b`, body only.
///
/// `[^\n]` is the whole LINE alphabet (a line holds no newline), and `{0,40}`
/// lowers to `re.loop`.
pub fn specimen_a_target_body() -> Re {
    Re::cat(vec![
        Re::union(vec![
            Re::cat(vec![Re::lit("git"), Re::plus(ws_char()), Re::lit("rm")]),
            Re::lit("rm"),
        ]),
        Re::plus(ws_char()),
        Re::loop_(line_any(), 0, 40),
        Re::lit(".totem/lessons.md"),
    ])
}

/// The O7 control — corpus rule `09ee37252a814a09`, RE2-EXPRESSIBLE PART ONLY.
///
/// The shipped pattern ends `\b(?![^'"\n]*LC_ALL=C)`. That negative lookahead
/// is dropped here: it is not expressible in this theory (nor in RE2), and
/// dropping it is exactly the census's "enumerable builtin-gap finding, not a
/// silent approximation" — recorded as such in the emitted header and in the
/// dialect rows. What remains is the alternation, which is the part O7 needs.
pub fn control_09ee_body() -> Re {
    Re::cat(vec![
        Re::lit("git"),
        Re::plus(ws_char()),
        Re::union(
            [
                "log",
                "diff",
                "status",
                "show",
                "branch",
                "tag",
                "rev-parse",
                "ls-files",
                "for-each-ref",
                "cat-file",
                "blame",
                "shortlog",
                "stash",
                "remote",
                "config",
            ]
            .into_iter()
            .map(Re::lit)
            .collect(),
        ),
    ])
}

/// Wrap a `\b`-delimited body as an UNANCHORED line search, which is the
/// shipped semantics: every corpus regex is a search over the added line, not a
/// full-line match. The boundary contexts already supply the surrounding `.*`.
pub fn search_word_bounded(body: Re) -> Re {
    Re::cat(vec![boundary_prefix(), body, boundary_suffix()])
}

/// An unanchored search for a pattern with NO word boundaries — plain
/// `.*` padding on both sides.
pub fn search_unbounded(body: Re) -> Re {
    Re::cat(vec![line_star(), body, line_star()])
}

/// The suppression-directive language of the mmnto-ai/totem#2680 class.
/// Engine-level suppression is a substring marker (spec § "Census
/// corrections": "Suppression is engine-level substring markers, never a record
/// field"), so the language is `.*totem-ignore.*`.
pub fn suppression_language() -> Re {
    search_unbounded(Re::lit("totem-ignore"))
}

// ─── Glob lowering (§ Design 7 profile) ─────────────────────────────────────

/// The PATH alphabet: printable ASCII minus NUL, per OBLIGATIONS.md § Binding
/// notes. `/` is the separator and is excluded from the single-segment classes.
pub fn path_char_no_slash() -> Re {
    Re::union(vec![Re::range(' ', '.'), Re::range('0', '~')])
}

/// Any path character INCLUDING the separator.
pub fn path_char_any() -> Re {
    Re::range(' ', '~')
}

#[derive(Debug, PartialEq, Eq)]
enum GlobToken {
    /// `**/` — zero or more whole segments.
    GlobstarSegments,
    /// a trailing/bare `**` — the cross-segment wildcard.
    Globstar,
    /// `*` — within one segment.
    Star,
    /// `?` — one non-separator character.
    Question,
    Literal(String),
}

/// Tokenize per `packages/core/src/sys/glob.ts` (the shipped tokenizer): `**/`
/// is its own token, a remaining `**` is the cross-segment wildcard, `*` and `?`
/// are single-segment wildcards, everything else is literal.
fn tokenize_glob(glob: &str) -> Vec<GlobToken> {
    let chars: Vec<char> = glob.chars().collect();
    let mut tokens = Vec::new();
    let mut literal = String::new();
    let mut i = 0usize;

    while i < chars.len() {
        let flush = |literal: &mut String, tokens: &mut Vec<GlobToken>| {
            if !literal.is_empty() {
                tokens.push(GlobToken::Literal(std::mem::take(literal)));
            }
        };

        if chars[i] == '*' {
            if chars.get(i + 1) == Some(&'*') {
                if chars.get(i + 2) == Some(&'/') {
                    flush(&mut literal, &mut tokens);
                    tokens.push(GlobToken::GlobstarSegments);
                    i += 3;
                } else {
                    flush(&mut literal, &mut tokens);
                    tokens.push(GlobToken::Globstar);
                    i += 2;
                }
            } else {
                flush(&mut literal, &mut tokens);
                tokens.push(GlobToken::Star);
                i += 1;
            }
        } else if chars[i] == '?' {
            flush(&mut literal, &mut tokens);
            tokens.push(GlobToken::Question);
            i += 1;
        } else {
            literal.push(chars[i]);
            i += 1;
        }
    }
    if !literal.is_empty() {
        tokens.push(GlobToken::Literal(literal));
    }
    tokens
}

/// Lower a record-grammar glob to a regex, reproducing the § Design 7 profile
/// (`RECORD_PROFILE` in `packages/core/src/sys/glob.ts`) clause for clause:
///
///   - `**/`  → `(?:[^/]+/)*`  (`globstar-segments`), so `**` + `/` is tree-wide
///             INCLUDING the root — `**/*.ts` matches `a.ts`.
///   - `**`   → `.*`           (`crossSegmentWildcard`), crossing separators.
///   - `*`    → `[^/]*`        (`starActivation: 'all'` — every star is a wildcard).
///   - `?`    → `[^/]`         (banned by the dialect at parse; carried for parity).
///   - literal → escaped verbatim.
///   - anchored `^…$`, with NO basename promotion
///     (`barePatternMatchesBasename: false` — § Design 7's "No silent promotion").
///
/// Anchoring is implicit here: `str.in_re` is a FULL-string membership test, so
/// the emitted regex is anchored by construction.
///
/// FIDELITY BOUND: this reproduces the profile's REGEX, not the host-separator
/// normalization `matchGlob` performs on the path side. Every witness path in
/// O5/O6 is therefore in already-normalized `/` form.
pub fn glob_to_re(glob: &str) -> Re {
    let parts = tokenize_glob(glob)
        .into_iter()
        .map(|token| match token {
            GlobToken::GlobstarSegments => Re::star(Re::cat(vec![
                Re::plus(path_char_no_slash()),
                Re::lit("/"),
            ])),
            GlobToken::Globstar => Re::star(path_char_any()),
            GlobToken::Star => Re::star(path_char_no_slash()),
            GlobToken::Question => path_char_no_slash(),
            GlobToken::Literal(text) => Re::Str(text),
        })
        .collect();
    Re::cat(parts)
}

/// The union of a glob LIST, which is how both scope arrays are evaluated
/// (§ Design 4: `positiveMatch && !excludeMatch`).
pub fn globs_to_re(globs: &[&str]) -> Re {
    Re::union(globs.iter().map(|g| glob_to_re(g)).collect())
}
