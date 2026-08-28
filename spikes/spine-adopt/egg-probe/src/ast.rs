//! The DECLARED SUBSET regex parser (DESIGN.md § Method 1).
//!
//! Subset, verbatim from DESIGN.md: "literals, character classes (incl.
//! ranges/negation), `.`, alternation, concatenation, `*`/`+`/`?`, bounded
//! `{n,m}`, non-capturing + capturing groups (structure-only), anchors, escaped
//! classes (`\s\d\w\S` etc.), `\b` via the CAREFUL desugar".
//!
//! Everything outside it is returned as an `Unparsed` reason and enumerated in
//! the report. The standing rule for this file: **a parse that silently
//! misreads a construct is worse than an unparsed row.** Where a construct is
//! ambiguous under the subset, it is REFUSED with a reason rather than guessed.

use crate::charset::{in_sigma, ClassSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ast {
    Eps,
    Lit(u8),
    Class(ClassSet),
    Concat(Vec<Ast>),
    Alt(Vec<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Opt(Box<Ast>),
    /// `{n,m}` and `{n}`; `hi == None` is `{n,}`.
    Repeat(Box<Ast>, u32, Option<u32>),
    /// A capturing or non-capturing group — STRUCTURE ONLY, per the subset.
    Group(Box<Ast>),
    AnchorStart,
    AnchorEnd,
    /// `\b`.
    Boundary,
}

/// Why a corpus pattern is not in the declared subset. Every variant is
/// reported verbatim in `egg-report.json` — this taxonomy IS the honest bound.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unparsed {
    pub kind: &'static str,
    pub detail: String,
}

impl Unparsed {
    fn new(kind: &'static str, detail: impl Into<String>) -> Self {
        Unparsed {
            kind,
            detail: detail.into(),
        }
    }
}

type PResult<T> = Result<T, Unparsed>;

pub fn parse(pattern: &str) -> PResult<Ast> {
    // Operate on Unicode scalar values so an out-of-Σ character is DETECTED
    // rather than split into bytes.
    let chars: Vec<char> = pattern.chars().collect();
    let mut p = Parser { s: &chars, i: 0 };
    let ast = p.parse_alt()?;
    if p.i != p.s.len() {
        return Err(Unparsed::new(
            "parse-error",
            format!("trailing input at offset {}", p.i),
        ));
    }
    Ok(ast)
}

struct Parser<'a> {
    s: &'a [char],
    i: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.s.get(self.i).copied()
    }
    fn at(&self, k: usize) -> Option<char> {
        self.s.get(self.i + k).copied()
    }
    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.i += 1;
        }
        c
    }

    fn parse_alt(&mut self) -> PResult<Ast> {
        let mut branches = vec![self.parse_concat()?];
        while self.peek() == Some('|') {
            self.bump();
            branches.push(self.parse_concat()?);
        }
        if branches.len() == 1 {
            Ok(branches.pop().unwrap())
        } else {
            Ok(Ast::Alt(branches))
        }
    }

    fn parse_concat(&mut self) -> PResult<Ast> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.parse_repeat()?);
        }
        match items.len() {
            0 => Ok(Ast::Eps),
            1 => Ok(items.pop().unwrap()),
            _ => Ok(Ast::Concat(items)),
        }
    }

    fn parse_repeat(&mut self) -> PResult<Ast> {
        let atom = self.parse_atom()?;

        let quantified = match self.peek() {
            Some('*') => {
                self.bump();
                Some(Ast::Star(Box::new(atom.clone())))
            }
            Some('+') => {
                self.bump();
                Some(Ast::Plus(Box::new(atom.clone())))
            }
            Some('?') => {
                self.bump();
                Some(Ast::Opt(Box::new(atom.clone())))
            }
            Some('{') => match self.try_counted()? {
                Some((lo, hi)) => Some(Ast::Repeat(Box::new(atom.clone()), lo, hi)),
                // Annex-B behaviour, which is what the shipped JS `RegExp`
                // engine does: a `{` that does not open a valid quantifier is a
                // LITERAL. Not a guess — this is the real engine's rule.
                None => None,
            },
            _ => None,
        };

        let Some(node) = quantified else {
            return Ok(atom);
        };

        // A quantifier may not be applied to a zero-width assertion, and the
        // lazy/possessive suffixes are outside the declared subset.
        match self.peek() {
            Some('?') => {
                return Err(Unparsed::new(
                    "lazy-quantifier",
                    "`*?`/`+?`/`??`/`{n,m}?` is outside the declared subset; it is \
                     language-equal to the greedy form under membership, but the \
                     subset does not name it and reading it as greedy would be a \
                     silent re-reading of match semantics",
                ))
            }
            Some('+') => {
                return Err(Unparsed::new(
                    "possessive-quantifier",
                    "possessive quantifier outside the declared subset",
                ))
            }
            _ => {}
        }
        if matches!(
            atom,
            Ast::AnchorStart | Ast::AnchorEnd | Ast::Boundary
        ) {
            return Err(Unparsed::new(
                "quantified-assertion",
                "a quantifier applied to an anchor or `\\b` is outside the subset",
            ));
        }
        Ok(node)
    }

    /// `{n}` / `{n,}` / `{n,m}`. Returns `Ok(None)` (rewinding) when the braces
    /// do not form a quantifier, so the caller can treat `{` as a literal, and
    /// `Err` when they form a quantifier the shipped engine REFUSES.
    fn try_counted(&mut self) -> PResult<Option<(u32, Option<u32>)>> {
        let start = self.i;
        self.bump(); // '{'
        let mut lo = String::new();
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            lo.push(self.bump().unwrap());
        }
        if lo.is_empty() {
            self.i = start;
            return Ok(None);
        }
        let hi = if self.peek() == Some(',') {
            self.bump();
            let mut h = String::new();
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                h.push(self.bump().unwrap());
            }
            if h.is_empty() {
                None
            } else {
                match h.parse::<u32>() {
                    Ok(v) => Some(v),
                    Err(_) => {
                        self.i = start;
                        return Ok(None);
                    }
                }
            }
        } else {
            match lo.parse::<u32>() {
                Ok(v) => Some(v),
                Err(_) => {
                    self.i = start;
                    return Ok(None);
                }
            }
        };
        if self.peek() != Some('}') {
            self.i = start;
            return Ok(None);
        }
        self.bump();
        let lo_v = match lo.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                self.i = start;
                return Ok(None);
            }
        };
        // A REVERSED bound (`a{3,1}`) is not a pattern the shipped engine
        // accepts: `{3,1}` matches QuantifierPrefix, so the Annex-B literal
        // reading does NOT apply, and ECMAScript's early error
        // (InvalidBracedQuantifier) makes the whole regex a SyntaxError —
        // V8: "numbers out of order in {} quantifier". Modelling it as
        // `re.loop 3 1` would give the probe a language the engine never
        // produces, and rewinding to a literal `{` would model a pattern the
        // engine rejects. Both are guesses, so this is REFUSED with a reason.
        if matches!(hi, Some(h) if h < lo_v) {
            return Err(Unparsed::new(
                "reversed-counted-bounds",
                format!(
                    "`{{{lo_v},{}}}` has its bounds out of order; the shipped RegExp \
                     engine rejects the pattern as a SyntaxError rather than matching \
                     anything",
                    hi.unwrap()
                ),
            ));
        }
        Ok(Some((lo_v, hi)))
    }

    fn parse_atom(&mut self) -> PResult<Ast> {
        let Some(c) = self.peek() else {
            return Ok(Ast::Eps);
        };
        match c {
            '(' => self.parse_group(),
            '[' => self.parse_class(),
            '.' => {
                self.bump();
                // Flagless (no `s` flag): `.` is "any character except a line
                // terminator". On the LINE alphabet that is exactly Σ — the same
                // treatment `lang.rs` gives `[^\n]`.
                Ok(Ast::Class(ClassSet::sigma()))
            }
            '^' => {
                self.bump();
                Ok(Ast::AnchorStart)
            }
            '$' => {
                self.bump();
                Ok(Ast::AnchorEnd)
            }
            '\\' => self.parse_escape_outside_class(),
            '*' | '+' | '?' => Err(Unparsed::new(
                "parse-error",
                format!("quantifier `{c}` with nothing to repeat"),
            )),
            _ => {
                self.bump();
                let cp = c as u32;
                if !in_sigma(cp) {
                    return Err(Unparsed::new(
                        "char-outside-line-alphabet",
                        format!(
                            "literal U+{cp:04X} is outside Σ = {{0x09}} ∪ [0x20..0x7E]"
                        ),
                    ));
                }
                Ok(Ast::Lit(cp as u8))
            }
        }
    }

    fn parse_group(&mut self) -> PResult<Ast> {
        self.bump(); // '('
        if self.peek() == Some('?') {
            match self.at(1) {
                Some(':') => {
                    self.bump();
                    self.bump();
                }
                Some('=') | Some('!') => {
                    return Err(Unparsed::new(
                        "lookaround",
                        "lookahead is not RE2-expressible and is outside the subset",
                    ))
                }
                Some('<') => {
                    return match self.at(2) {
                        Some('=') | Some('!') => Err(Unparsed::new(
                            "lookaround",
                            "lookbehind is not RE2-expressible and is outside the subset",
                        )),
                        _ => Err(Unparsed::new(
                            "named-group",
                            "named capture group is outside the declared subset",
                        )),
                    }
                }
                other => {
                    return Err(Unparsed::new(
                        "inline-flags-or-unknown-group",
                        format!("`(?{}` is outside the declared subset", other.unwrap_or('?')),
                    ))
                }
            }
        }
        let inner = self.parse_alt()?;
        if self.peek() != Some(')') {
            return Err(Unparsed::new("parse-error", "unclosed group"));
        }
        self.bump();
        Ok(Ast::Group(Box::new(inner)))
    }

    fn parse_class(&mut self) -> PResult<Ast> {
        self.bump(); // '['
        let negated = if self.peek() == Some('^') {
            self.bump();
            true
        } else {
            false
        };

        let mut set = ClassSet::empty();
        let mut saw_out_of_sigma = false;

        loop {
            let Some(c) = self.peek() else {
                return Err(Unparsed::new("parse-error", "unterminated character class"));
            };
            if c == ']' {
                self.bump();
                break;
            }

            let lhs = self.parse_class_atom()?;

            // A range needs `X - Y` where the `-` is followed by a real atom.
            // `[0-9-_]` therefore yields digits, `-`, `_`: after `0-9` is
            // consumed the cursor sits on `-`, whose FOLLOWING character is `_`
            // (not `-`), so no range forms. That is ECMAScript's rule.
            let is_range = self.peek() == Some('-') && self.at(1).is_some() && self.at(1) != Some(']');
            if is_range {
                self.bump(); // '-'
                let rhs = self.parse_class_atom()?;
                let (ClassAtom::Char(lo), ClassAtom::Char(hi)) = (&lhs, &rhs) else {
                    return Err(Unparsed::new(
                        "class-range-with-escape-class",
                        "an escape class (`\\w`, `\\s`, …) cannot be a range endpoint",
                    ));
                };
                if lo > hi {
                    return Err(Unparsed::new(
                        "parse-error",
                        format!("reversed class range U+{lo:04X}-U+{hi:04X}"),
                    ));
                }
                if !in_sigma(*lo) || !in_sigma(*hi) {
                    saw_out_of_sigma = true;
                }
                set = set.union(ClassSet::range(*lo, *hi));
            } else {
                match lhs {
                    ClassAtom::Char(cp) => {
                        if !in_sigma(cp) {
                            saw_out_of_sigma = true;
                        }
                        set = set.union(ClassSet::single(cp));
                    }
                    ClassAtom::Set(s) => set = set.union(s),
                }
            }
        }

        if negated {
            // Exact on Σ: an out-of-Σ member subtracts nothing from Σ, which is
            // precisely how `lang.rs` reads `[^\n]` as the whole LINE alphabet.
            Ok(Ast::Class(set.complement()))
        } else {
            if saw_out_of_sigma {
                // A POSITIVE class naming an out-of-Σ character would be
                // silently NARROWED by the model. Refuse instead.
                return Err(Unparsed::new(
                    "char-outside-line-alphabet",
                    "positive character class names a character outside Σ = {0x09} ∪ [0x20..0x7E]; \
                     intersecting it with Σ would silently narrow the class",
                ));
            }
            if set.is_empty() {
                return Err(Unparsed::new(
                    "empty-positive-class",
                    "positive character class is empty on Σ",
                ));
            }
            Ok(Ast::Class(set))
        }
    }

    fn parse_class_atom(&mut self) -> PResult<ClassAtom> {
        let c = self.bump().expect("caller checked");
        if c != '\\' {
            return Ok(ClassAtom::Char(c as u32));
        }
        let Some(e) = self.bump() else {
            return Err(Unparsed::new("parse-error", "trailing backslash in class"));
        };
        match e {
            'd' => Ok(ClassAtom::Set(ClassSet::digit())),
            'D' => Ok(ClassAtom::Set(ClassSet::digit().complement())),
            'w' => Ok(ClassAtom::Set(ClassSet::word())),
            'W' => Ok(ClassAtom::Set(ClassSet::nonword())),
            's' => Ok(ClassAtom::Set(ClassSet::ws())),
            'S' => Ok(ClassAtom::Set(ClassSet::ws().complement())),
            'n' => Ok(ClassAtom::Char(0x0A)),
            'r' => Ok(ClassAtom::Char(0x0D)),
            't' => Ok(ClassAtom::Char(0x09)),
            'f' => Ok(ClassAtom::Char(0x0C)),
            'v' => Ok(ClassAtom::Char(0x0B)),
            '0' => Ok(ClassAtom::Char(0x00)),
            'b' => Ok(ClassAtom::Char(0x08)), // backspace inside a class
            'x' => self.hex_escape(2).map(ClassAtom::Char),
            'u' => self.unicode_escape().map(ClassAtom::Char),
            'p' | 'P' => Err(Unparsed::new(
                "unicode-property-escape",
                "`\\p{…}` is outside the declared subset",
            )),
            'c' => Err(Unparsed::new(
                "control-escape",
                "`\\c<letter>` is outside the declared subset",
            )),
            _ => identity_escape(e).map(ClassAtom::Char),
        }
    }

    fn parse_escape_outside_class(&mut self) -> PResult<Ast> {
        self.bump(); // '\\'
        let Some(e) = self.bump() else {
            return Err(Unparsed::new("parse-error", "trailing backslash"));
        };
        match e {
            'd' => Ok(Ast::Class(ClassSet::digit())),
            'D' => Ok(Ast::Class(ClassSet::digit().complement())),
            'w' => Ok(Ast::Class(ClassSet::word())),
            'W' => Ok(Ast::Class(ClassSet::nonword())),
            's' => Ok(Ast::Class(ClassSet::ws())),
            'S' => Ok(Ast::Class(ClassSet::ws().complement())),
            'b' => Ok(Ast::Boundary),
            'B' => Err(Unparsed::new(
                "negated-word-boundary",
                "`\\B` is outside the declared subset (DESIGN names `\\b` only)",
            )),
            't' => Ok(Ast::Lit(0x09)),
            'n' | 'r' | 'f' | 'v' | '0' => Err(Unparsed::new(
                "char-outside-line-alphabet",
                format!("`\\{e}` denotes a character outside Σ"),
            )),
            'x' => self.hex_escape(2).and_then(lit_in_sigma),
            'u' => self.unicode_escape().and_then(lit_in_sigma),
            'k' => Err(Unparsed::new(
                "backreference",
                "`\\k<name>` is a backreference and is not RE2-expressible",
            )),
            'p' | 'P' => Err(Unparsed::new(
                "unicode-property-escape",
                "`\\p{…}` is outside the declared subset",
            )),
            'c' => Err(Unparsed::new(
                "control-escape",
                "`\\c<letter>` is outside the declared subset",
            )),
            '1'..='9' => Err(Unparsed::new(
                "backreference",
                format!("`\\{e}` is a backreference and is not RE2-expressible"),
            )),
            _ => identity_escape(e).and_then(lit_in_sigma),
        }
    }

    fn hex_escape(&mut self, n: usize) -> PResult<u32> {
        let mut v: u32 = 0;
        for _ in 0..n {
            let Some(c) = self.bump() else {
                return Err(Unparsed::new("parse-error", "truncated hex escape"));
            };
            let Some(d) = c.to_digit(16) else {
                return Err(Unparsed::new("parse-error", "bad hex escape digit"));
            };
            v = v * 16 + d;
        }
        Ok(v)
    }

    fn unicode_escape(&mut self) -> PResult<u32> {
        if self.peek() == Some('{') {
            self.bump();
            let mut v: u32 = 0;
            let mut any = false;
            while let Some(c) = self.peek() {
                if c == '}' {
                    break;
                }
                let Some(d) = c.to_digit(16) else {
                    return Err(Unparsed::new("parse-error", "bad `\\u{…}` digit"));
                };
                v = v.saturating_mul(16).saturating_add(d);
                any = true;
                self.bump();
            }
            if !any || self.peek() != Some('}') {
                return Err(Unparsed::new("parse-error", "malformed `\\u{…}`"));
            }
            self.bump();
            Ok(v)
        } else {
            self.hex_escape(4)
        }
    }
}

enum ClassAtom {
    Char(u32),
    Set(ClassSet),
}

/// An identity escape is legal for a NON-word character (`\.`, `\/`, `\$`, …).
/// An escaped word character that is not a named escape is refused rather than
/// guessed.
fn identity_escape(e: char) -> PResult<u32> {
    if e.is_ascii_alphanumeric() || e == '_' {
        Err(Unparsed::new(
            "unknown-escape",
            format!("`\\{e}` is not a named escape in the declared subset"),
        ))
    } else {
        Ok(e as u32)
    }
}

fn lit_in_sigma(cp: u32) -> PResult<Ast> {
    if in_sigma(cp) {
        Ok(Ast::Lit(cp as u8))
    } else {
        Err(Unparsed::new(
            "char-outside-line-alphabet",
            format!("escaped literal U+{cp:04X} is outside Σ"),
        ))
    }
}

// ─── first/last character analysis (input to the `\b` desugar) ──────────────

/// The set of characters that can begin (or end) a NON-EMPTY match, plus
/// whether the node can match the empty string.
#[derive(Clone, Copy, Debug)]
pub struct Edge {
    pub set: ClassSet,
    pub nullable: bool,
}

pub fn first_edge(a: &Ast) -> Edge {
    match a {
        Ast::Eps | Ast::AnchorStart | Ast::AnchorEnd | Ast::Boundary => Edge {
            set: ClassSet::empty(),
            nullable: true,
        },
        Ast::Lit(c) => Edge {
            set: ClassSet::single(*c as u32),
            nullable: false,
        },
        // An EMPTY set is the empty LANGUAGE, not epsilon: a class node matches
        // exactly one character or nothing at all, so it can never match the
        // empty string. (`ir::lower` agrees — it lowers an empty class to
        // `Re::Empty`.) Reporting it nullable would widen the `\b` desugar.
        Ast::Class(s) => Edge {
            set: *s,
            nullable: false,
        },
        Ast::Group(inner) => first_edge(inner),
        Ast::Star(_) | Ast::Opt(_) => Edge {
            set: inner_edge_set(a, true),
            nullable: true,
        },
        Ast::Plus(inner) => first_edge(inner),
        Ast::Repeat(inner, lo, _) => {
            let e = first_edge(inner);
            Edge {
                set: e.set,
                nullable: *lo == 0 || e.nullable,
            }
        }
        Ast::Alt(branches) => {
            let mut set = ClassSet::empty();
            let mut nullable = false;
            for b in branches {
                let e = first_edge(b);
                set = set.union(e.set);
                nullable |= e.nullable;
            }
            Edge { set, nullable }
        }
        Ast::Concat(items) => {
            let mut set = ClassSet::empty();
            for it in items {
                let e = first_edge(it);
                set = set.union(e.set);
                if !e.nullable {
                    return Edge {
                        set,
                        nullable: false,
                    };
                }
            }
            Edge {
                set,
                nullable: true,
            }
        }
    }
}

pub fn last_edge(a: &Ast) -> Edge {
    match a {
        Ast::Eps | Ast::AnchorStart | Ast::AnchorEnd | Ast::Boundary => Edge {
            set: ClassSet::empty(),
            nullable: true,
        },
        Ast::Lit(c) => Edge {
            set: ClassSet::single(*c as u32),
            nullable: false,
        },
        // Empty set = empty LANGUAGE, never epsilon — see `first_edge`.
        Ast::Class(s) => Edge {
            set: *s,
            nullable: false,
        },
        Ast::Group(inner) => last_edge(inner),
        Ast::Star(_) | Ast::Opt(_) => Edge {
            set: inner_edge_set(a, false),
            nullable: true,
        },
        Ast::Plus(inner) => last_edge(inner),
        Ast::Repeat(inner, lo, _) => {
            let e = last_edge(inner);
            Edge {
                set: e.set,
                nullable: *lo == 0 || e.nullable,
            }
        }
        Ast::Alt(branches) => {
            let mut set = ClassSet::empty();
            let mut nullable = false;
            for b in branches {
                let e = last_edge(b);
                set = set.union(e.set);
                nullable |= e.nullable;
            }
            Edge { set, nullable }
        }
        Ast::Concat(items) => {
            let mut set = ClassSet::empty();
            for it in items.iter().rev() {
                let e = last_edge(it);
                set = set.union(e.set);
                if !e.nullable {
                    return Edge {
                        set,
                        nullable: false,
                    };
                }
            }
            Edge {
                set,
                nullable: true,
            }
        }
    }
}

fn inner_edge_set(a: &Ast, first: bool) -> ClassSet {
    match a {
        Ast::Star(inner) | Ast::Opt(inner) => {
            if first {
                first_edge(inner).set
            } else {
                last_edge(inner).set
            }
        }
        _ => ClassSet::empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(p: &str) -> Ast {
        parse(p).unwrap_or_else(|e| panic!("{p} -> {}: {}", e.kind, e.detail))
    }

    #[test]
    fn class_dash_after_range_is_literal() {
        // `[a-zA-Z0-9-_./]` must contain `-`, not the range 0x2D..0x5F.
        let Ast::Class(s) = ok("[a-zA-Z0-9-_./]") else {
            panic!("not a class")
        };
        assert!(s.0 & (1u128 << b'-' as u32) != 0);
        assert!(s.0 & (1u128 << b'_' as u32) != 0);
        // ':' (0x3A) lies inside 0x2D..0x5F but must NOT be a member.
        assert!(s.0 & (1u128 << b':' as u32) == 0);
    }

    #[test]
    fn negated_class_with_escape_class_is_exact_on_sigma() {
        // `[^\S\r\n]` is whitespace-minus-CR/LF, which on Σ is {space, tab}.
        let Ast::Class(s) = ok(r"[^\S\r\n]") else {
            panic!("not a class")
        };
        assert_eq!(s, ClassSet::ws());
    }

    #[test]
    fn dot_and_not_newline_are_both_sigma() {
        assert_eq!(ok("."), Ast::Class(ClassSet::sigma()));
        assert_eq!(ok(r"[^\n]"), Ast::Class(ClassSet::sigma()));
    }

    #[test]
    fn equal_classes_written_differently_are_one_node() {
        assert_eq!(ok("['\"]"), ok("[\"']"));
    }

    #[test]
    fn double_backslash_b_is_a_literal_not_a_boundary() {
        let a = ok(r"\\b");
        assert_eq!(a, Ast::Concat(vec![Ast::Lit(b'\\'), Ast::Lit(b'b')]));
    }

    #[test]
    fn lazy_quantifier_is_refused() {
        assert_eq!(parse(".*?x").unwrap_err().kind, "lazy-quantifier");
    }

    #[test]
    fn lookaround_and_backreference_are_refused() {
        assert_eq!(parse("a(?=b)").unwrap_err().kind, "lookaround");
        assert_eq!(parse(r"(a)\1").unwrap_err().kind, "backreference");
    }

    #[test]
    fn out_of_alphabet_positive_class_is_refused() {
        assert_eq!(
            parse("[\u{2600}-\u{27bf}]").unwrap_err().kind,
            "char-outside-line-alphabet"
        );
    }

    #[test]
    fn brace_that_is_not_a_quantifier_is_a_literal() {
        // Annex-B / shipped-engine behaviour.
        assert_eq!(ok("a{x"), Ast::Concat(vec![Ast::Lit(b'a'), Ast::Lit(b'{'), Ast::Lit(b'x')]));
    }

    #[test]
    fn reversed_counted_bounds_are_refused() {
        // `a{3,1}` is a SyntaxError in the shipped engine (V8: "numbers out of
        // order in {} quantifier"), so it is neither `re.loop 3 1` nor a
        // literal `{`.
        assert_eq!(parse("a{3,1}").unwrap_err().kind, "reversed-counted-bounds");
        // The ordered forms still parse.
        assert_eq!(
            ok("a{1,3}"),
            Ast::Repeat(Box::new(Ast::Lit(b'a')), 1, Some(3))
        );
        assert_eq!(
            ok("a{2}"),
            Ast::Repeat(Box::new(Ast::Lit(b'a')), 2, Some(2))
        );
        assert_eq!(ok("a{2,}"), Ast::Repeat(Box::new(Ast::Lit(b'a')), 2, None));
    }

    #[test]
    fn empty_class_is_the_empty_language_not_epsilon() {
        // A negated class whose members cover Σ yields the EMPTY set, which
        // denotes the empty language — it must not be reported nullable.
        let a = ok(r"[^\s\S]");
        assert_eq!(a, Ast::Class(ClassSet::empty()));
        assert!(!first_edge(&a).nullable);
        assert!(!last_edge(&a).nullable);
        // The widening this guards: an alternation with an empty branch is
        // nullable only if a REAL branch is.
        let alt = Ast::Alt(vec![a.clone(), Ast::Lit(b'x')]);
        assert!(!first_edge(&alt).nullable);
        assert!(!last_edge(&alt).nullable);
    }

    #[test]
    fn edges_are_polarity_correct() {
        let a = ok("(git|npm|bash)");
        let e = first_edge(&a);
        assert!(!e.nullable);
        assert!(e.set.subset_of(crate::charset::WORD));
        let a2 = ok(r"\^?");
        assert!(first_edge(&a2).nullable);
    }
}
