//! The egg language, the AST → search-language desugar (anchors, unanchored
//! padding, and the CAREFUL `\b` construction), and a self-contained SMT-LIB2
//! printer for the o09 subset.

use egg::{define_language, Id, RecExpr};

use crate::ast::{first_edge, last_edge, Ast, Unparsed};
use crate::charset::{Bounds, ClassSet, LitChar, NONWORD, WORD};

// ─── The egg language ───────────────────────────────────────────────────────
//
// REPRESENTATION CHOICES (recorded per DESIGN.md's guard rail):
//
//  1. `cat` and `alt` are BINARY. Every n-ary source construct is folded
//     right-associatively at build time, so DESIGN's named assoc/comm rules are
//     expressible as ordinary egg patterns. (An n-ary `Box<[Id]>` operator
//     would make "union assoc/comm" inexpressible as a rewrite.)
//  2. A multi-character literal is a CONCATENATION OF PER-CHARACTER `lit`
//     ATOMS. Whole-string literal atoms would make DESIGN's named
//     "single-char class ↔ literal" rule unable to see inside `\.git\/hooks`,
//     i.e. the representation, not the semantics, would decide the yield.
//  3. A character class is a canonical Σ-subset bitmask (see `charset.rs`), so
//     `['"]` and `["']` hash-cons to the SAME e-node.
//  4. `rep` carries its bounds in a `Bnd` LEAF child rather than as inline
//     enode data: `("rep" = Rep([body, bounds]))`. This keeps the language
//     inside the plain `define_language!` forms. `{n,}` never reaches here —
//     it is lowered to `X{n,n} · X*` during the desugar.
//  5. `opt` is primitive (not `alt eps X`), matching how DESIGN words
//     `a?·a* → a*`; the SMT printer spells it o09's way, as `(re.union
//     (str.to_re "") X)`.
//
// `inter` exists only for the general `\b` construction. `re.comp` is never
// generated: the non-word class is ENUMERATED, exactly as `lang.rs` does.

define_language! {
    pub enum ReLang {
        "cat"   = Cat([Id; 2]),
        "alt"   = Alt([Id; 2]),
        "inter" = Inter([Id; 2]),
        "star"  = Star([Id; 1]),
        "plus"  = Plus([Id; 1]),
        "opt"   = Opt([Id; 1]),
        "rep"   = Rep([Id; 2]),
        "eps"   = Eps,
        "empty" = Empty,
        Lit(LitChar),
        Cls(ClassSet),
        Bnd(Bounds),
    }
}

/// A build-time regex term, converted to a `RecExpr<ReLang>` in one pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Re {
    Eps,
    Empty,
    Lit(u8),
    Cls(ClassSet),
    Cat(Box<Re>, Box<Re>),
    Alt(Box<Re>, Box<Re>),
    Inter(Box<Re>, Box<Re>),
    Star(Box<Re>),
    Plus(Box<Re>),
    Opt(Box<Re>),
    Rep(Box<Re>, u32, u32),
}

impl Re {
    fn cat(a: Re, b: Re) -> Re {
        Re::Cat(Box::new(a), Box::new(b))
    }
    fn alt(a: Re, b: Re) -> Re {
        Re::Alt(Box::new(a), Box::new(b))
    }
    fn inter(a: Re, b: Re) -> Re {
        Re::Inter(Box::new(a), Box::new(b))
    }
    fn star(a: Re) -> Re {
        Re::Star(Box::new(a))
    }
    fn opt(a: Re) -> Re {
        Re::Opt(Box::new(a))
    }

    /// Right-associated concatenation of a sequence.
    fn cat_all(mut parts: Vec<Re>) -> Re {
        match parts.len() {
            0 => Re::Eps,
            1 => parts.pop().unwrap(),
            _ => {
                let head = parts.remove(0);
                Re::cat(head, Re::cat_all(parts))
            }
        }
    }

    /// Right-associated union of a sequence.
    fn alt_all(mut parts: Vec<Re>) -> Re {
        match parts.len() {
            0 => Re::Empty,
            1 => parts.pop().unwrap(),
            _ => {
                let head = parts.remove(0);
                Re::alt(head, Re::alt_all(parts))
            }
        }
    }

    pub fn to_recexpr(&self) -> RecExpr<ReLang> {
        let mut expr = RecExpr::default();
        self.build(&mut expr);
        expr
    }

    fn build(&self, expr: &mut RecExpr<ReLang>) -> Id {
        match self {
            Re::Eps => expr.add(ReLang::Eps),
            Re::Empty => expr.add(ReLang::Empty),
            Re::Lit(c) => expr.add(ReLang::Lit(LitChar(*c))),
            Re::Cls(s) => expr.add(ReLang::Cls(*s)),
            Re::Cat(a, b) => {
                let (x, y) = (a.build(expr), b.build(expr));
                expr.add(ReLang::Cat([x, y]))
            }
            Re::Alt(a, b) => {
                let (x, y) = (a.build(expr), b.build(expr));
                expr.add(ReLang::Alt([x, y]))
            }
            Re::Inter(a, b) => {
                let (x, y) = (a.build(expr), b.build(expr));
                expr.add(ReLang::Inter([x, y]))
            }
            Re::Star(a) => {
                let x = a.build(expr);
                expr.add(ReLang::Star([x]))
            }
            Re::Plus(a) => {
                let x = a.build(expr);
                expr.add(ReLang::Plus([x]))
            }
            Re::Opt(a) => {
                let x = a.build(expr);
                expr.add(ReLang::Opt([x]))
            }
            Re::Rep(a, lo, hi) => {
                let x = a.build(expr);
                let b = expr.add(ReLang::Bnd(Bounds { lo: *lo, hi: *hi }));
                expr.add(ReLang::Rep([x, b]))
            }
        }
    }
}

// ─── Σ shorthands, mirroring smt/src/lang.rs ────────────────────────────────

fn sigma() -> Re {
    Re::Cls(ClassSet::sigma())
}
fn sigma_star() -> Re {
    Re::star(sigma())
}
fn nonword() -> Re {
    Re::Cls(ClassSet::nonword())
}
fn word() -> Re {
    Re::Cls(ClassSet::word())
}

/// `lang.rs::boundary_prefix()` — "nothing at all, or anything ending in a
/// non-word character". The `nothing at all` branch is what makes a match at
/// position 0 legal; O9 check B measures what dropping it costs.
fn boundary_prefix_word_right() -> Re {
    Re::opt(Re::cat(sigma_star(), nonword()))
}

/// `lang.rs::boundary_suffix()` — the mirror image.
fn boundary_suffix_word_left() -> Re {
    Re::opt(Re::cat(nonword(), sigma_star()))
}

/// The OTHER polarity, which `lang.rs` does not need but this corpus does
/// (`\b#515\b` puts `\b` next to a NON-word character): when the pattern-side
/// character is non-word, the boundary requires the context character to BE a
/// word character and to be present — so there is no `ε` branch.
fn boundary_prefix_nonword_right() -> Re {
    Re::cat(sigma_star(), word())
}

fn boundary_suffix_nonword_left() -> Re {
    Re::cat(word(), sigma_star())
}

// ─── Desugar: AST → search language ─────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Pol {
    Word,
    NonWord,
    Unknown,
}

fn polarity(e: crate::ast::Edge) -> Pol {
    if e.nullable || e.set.is_empty() {
        return Pol::Unknown;
    }
    if e.set.subset_of(WORD) {
        Pol::Word
    } else if e.set.subset_of(NONWORD) {
        Pol::NonWord
    } else {
        Pol::Unknown
    }
}

/// Notes recorded per pattern about HOW it was modelled.
#[derive(Clone, Debug, Default)]
pub struct DesugarNotes {
    pub boundaries: usize,
    /// `\b` sites where BOTH sides were pattern-determined, so the assertion
    /// evaluated statically.
    pub boundaries_static: usize,
    /// `\b` sites needing an `re.inter` because the constrained side was not
    /// bare `Σ*`.
    pub boundaries_inter: usize,
    pub anchored_start: bool,
    pub anchored_end: bool,
    /// `{n,}` lowered to `X{n,n}·X*` (see `subsetNotes` in the report).
    pub open_repeats: usize,
}

/// Build the UNANCHORED SEARCH language of a pattern, which is the shipped
/// semantics: every corpus regex is a search over the added line, not a
/// full-line match (`lang.rs::search_unbounded` / `search_word_bounded`).
pub fn desugar(ast: &Ast) -> Result<(Re, DesugarNotes), Unparsed> {
    let mut notes = DesugarNotes::default();
    // A top-level alternation distributes over the padding:
    //   Σ*·(A|B)·Σ*  =  Σ*AΣ* ∪ Σ*BΣ*
    // so each branch carries its OWN anchors and `\b` sites. Anchors and
    // boundaries deeper than a top-level branch are refused.
    let branches: Vec<&Ast> = match ast {
        Ast::Alt(bs) => bs.iter().collect(),
        other => vec![other],
    };
    let mut out = Vec::with_capacity(branches.len());
    for b in branches {
        out.push(desugar_branch(b, &mut notes)?);
    }
    Ok((Re::alt_all(out), notes))
}

fn desugar_branch(ast: &Ast, notes: &mut DesugarNotes) -> Result<Re, Unparsed> {
    let items: Vec<Ast> = match ast {
        Ast::Concat(v) => v.clone(),
        other => vec![other.clone()],
    };

    // Anchors are legal only at the branch edges.
    let mut body: Vec<Ast> = items;
    let mut anchored_start = false;
    let mut anchored_end = false;
    if matches!(body.first(), Some(Ast::AnchorStart)) {
        anchored_start = true;
        body.remove(0);
    }
    if matches!(body.last(), Some(Ast::AnchorEnd)) {
        anchored_end = true;
        body.pop();
    }
    for it in &body {
        if contains_anchor(it) {
            return Err(Unparsed::new_pub(
                "anchor-not-at-branch-edge",
                "`^`/`$` occurs somewhere other than the start/end of a top-level branch; \
                 desugaring it would need a non-local rewrite",
            ));
        }
    }
    notes.anchored_start |= anchored_start;
    notes.anchored_end |= anchored_end;

    // Boundaries are handled only at a branch's TOP level.
    for it in &body {
        if !matches!(it, Ast::Boundary) && contains_boundary(it) {
            return Err(Unparsed::new_pub(
                "word-boundary-nested",
                "`\\b` occurs inside a group, alternation or quantifier; the careful desugar \
                 needs the adjacent pattern characters, which are not local there",
            ));
        }
    }

    // Split into segments separated by boundaries.
    let mut segs: Vec<Vec<Ast>> = vec![Vec::new()];
    for it in &body {
        if matches!(it, Ast::Boundary) {
            segs.push(Vec::new());
        } else {
            segs.last_mut().unwrap().push(it.clone());
        }
    }
    let n_boundaries = segs.len() - 1;
    notes.boundaries += n_boundaries;

    // Pad. `^`/`$` remove the padding on that side.
    let pad_start = if anchored_start { Re::Eps } else { sigma_star() };
    let pad_end = if anchored_end { Re::Eps } else { sigma_star() };

    let mut seg_res: Vec<Re> = Vec::with_capacity(segs.len());
    for (i, seg) in segs.iter().enumerate() {
        let mut parts: Vec<Re> = Vec::new();
        if i == 0 {
            parts.push(pad_start.clone());
        }
        for it in seg {
            parts.push(lower(it, notes)?);
        }
        if i == segs.len() - 1 {
            parts.push(pad_end.clone());
        }
        seg_res.push(Re::cat_all(parts));
    }

    // Decide each boundary.
    //
    // Polarity is read off the WHOLE SEGMENT on each side, not just the
    // adjacent item: in `\banchors?\b` the item next to the trailing `\b` is
    // the nullable `s?`, but every character that can END the segment
    // (`…r` or `…s`) is a word character, so the polarity IS determined. A
    // segment that can match empty leaves the neighbouring character to the
    // padding, and is correctly Unknown.
    let mut kinds: Vec<BoundaryKind> = Vec::with_capacity(n_boundaries);
    for i in 0..n_boundaries {
        let lpol = polarity(last_edge(&Ast::Concat(segs[i].clone())));
        let rpol = polarity(first_edge(&Ast::Concat(segs[i + 1].clone())));
        let kind = match (lpol, rpol) {
            (Pol::Unknown, Pol::Unknown) => {
                return Err(Unparsed::new_pub(
                    "word-boundary-ambiguous-polarity",
                    "neither side of a `\\b` has a pattern-determined word polarity (a nullable \
                     or mixed-polarity neighbour); case-splitting the neighbour would be a \
                     different construction from the O9-verified desugar",
                ))
            }
            // Both sides pattern-determined: the assertion is a STATIC
            // predicate — a boundary holds exactly when the two sides differ.
            (Pol::Word, Pol::Word) | (Pol::NonWord, Pol::NonWord) => {
                notes.boundaries_static += 1;
                BoundaryKind::Never
            }
            (Pol::Word, Pol::NonWord) | (Pol::NonWord, Pol::Word) => {
                notes.boundaries_static += 1;
                BoundaryKind::Always
            }
            // Only the RIGHT side is known: constrain the PREFIX.
            (Pol::Unknown, Pol::Word) => BoundaryKind::Prefix(boundary_prefix_word_right()),
            (Pol::Unknown, Pol::NonWord) => BoundaryKind::Prefix(boundary_prefix_nonword_right()),
            // Only the LEFT side is known: constrain the SUFFIX.
            (Pol::Word, Pol::Unknown) => BoundaryKind::Suffix(boundary_suffix_word_left()),
            (Pol::NonWord, Pol::Unknown) => BoundaryKind::Suffix(boundary_suffix_nonword_left()),
        };
        kinds.push(kind);
    }

    Ok(assemble(&seg_res, &kinds, notes))
}

enum BoundaryKind {
    Always,
    Never,
    Prefix(Re),
    Suffix(Re),
}

/// `segs[i]` and `segs[i+1]` are separated by `kinds[i]`.
///
/// A boundary whose RIGHT polarity is known constrains everything to its left;
/// one whose LEFT polarity is known constrains everything to its right. When
/// the constrained side is bare `Σ*` the intersection is dropped — `Σ* ∩
/// opt(Σ*·NW) = opt(Σ*·NW)` — which reproduces `lang.rs::boundary_prefix()` /
/// `boundary_suffix()` EXACTLY, i.e. the shape O9 verified.
fn assemble(segs: &[Re], kinds: &[BoundaryKind], notes: &mut DesugarNotes) -> Re {
    let mut left = segs[0].clone();
    for (i, kind) in kinds.iter().enumerate() {
        match kind {
            BoundaryKind::Always => {}
            BoundaryKind::Never => return Re::Empty,
            BoundaryKind::Prefix(ctx) => {
                left = if is_sigma_star(&left) {
                    ctx.clone()
                } else {
                    notes.boundaries_inter += 1;
                    Re::inter(left, ctx.clone())
                };
            }
            BoundaryKind::Suffix(ctx) => {
                let rest = assemble(&segs[i + 1..], &kinds[i + 1..], notes);
                let constrained = if is_sigma_star(&rest) {
                    ctx.clone()
                } else {
                    notes.boundaries_inter += 1;
                    Re::inter(rest, ctx.clone())
                };
                return Re::cat(left, constrained);
            }
        }
        left = Re::cat(left, segs[i + 1].clone());
    }
    left
}

fn is_sigma_star(r: &Re) -> bool {
    matches!(r, Re::Star(inner) if **inner == Re::Cls(ClassSet::sigma()))
}

fn contains_anchor(a: &Ast) -> bool {
    match a {
        Ast::AnchorStart | Ast::AnchorEnd => true,
        Ast::Group(i) | Ast::Star(i) | Ast::Plus(i) | Ast::Opt(i) | Ast::Repeat(i, _, _) => {
            contains_anchor(i)
        }
        Ast::Concat(v) | Ast::Alt(v) => v.iter().any(contains_anchor),
        _ => false,
    }
}

fn contains_boundary(a: &Ast) -> bool {
    match a {
        Ast::Boundary => true,
        Ast::Group(i) | Ast::Star(i) | Ast::Plus(i) | Ast::Opt(i) | Ast::Repeat(i, _, _) => {
            contains_boundary(i)
        }
        Ast::Concat(v) | Ast::Alt(v) => v.iter().any(contains_boundary),
        _ => false,
    }
}

fn lower(a: &Ast, notes: &mut DesugarNotes) -> Result<Re, Unparsed> {
    Ok(match a {
        Ast::Eps => Re::Eps,
        Ast::Lit(c) => Re::Lit(*c),
        Ast::Class(s) => {
            if s.is_empty() {
                Re::Empty
            } else {
                Re::Cls(*s)
            }
        }
        // Groups are STRUCTURE ONLY per the declared subset.
        Ast::Group(i) => lower(i, notes)?,
        Ast::Concat(v) => {
            let mut parts = Vec::with_capacity(v.len());
            for it in v {
                parts.push(lower(it, notes)?);
            }
            Re::cat_all(parts)
        }
        Ast::Alt(v) => {
            let mut parts = Vec::with_capacity(v.len());
            for it in v {
                parts.push(lower(it, notes)?);
            }
            Re::alt_all(parts)
        }
        Ast::Star(i) => Re::star(lower(i, notes)?),
        Ast::Plus(i) => Re::Plus(Box::new(lower(i, notes)?)),
        Ast::Opt(i) => Re::opt(lower(i, notes)?),
        Ast::Repeat(i, lo, hi) => {
            let inner = lower(i, notes)?;
            match hi {
                Some(h) => {
                    if *h == 0 {
                        Re::Eps
                    } else {
                        Re::Rep(Box::new(inner), *lo, *h)
                    }
                }
                None => {
                    // `{n,}` — see `subsetNotes` in egg-report.json.
                    notes.open_repeats += 1;
                    if *lo == 0 {
                        Re::star(inner)
                    } else {
                        Re::cat(
                            Re::Rep(Box::new(inner.clone()), *lo, *lo),
                            Re::star(inner),
                        )
                    }
                }
            }
        }
        Ast::AnchorStart | Ast::AnchorEnd => {
            return Err(Unparsed::new_pub(
                "anchor-not-at-branch-edge",
                "anchor reached the lowering pass",
            ))
        }
        Ast::Boundary => {
            return Err(Unparsed::new_pub(
                "word-boundary-nested",
                "`\\b` reached the lowering pass",
            ))
        }
    })
}

// ─── SMT-LIB2 printing (the o09 subset, self-contained) ─────────────────────
//
// Constructs used: str.in_re, re.++, re.union, re.inter, re.range, str.to_re,
// re.*, re.+, (_ re.loop n m). `re.comp` is IN the o09 subset but is never
// emitted (the non-word class is enumerated instead). `re.opt` is accepted by
// the pinned z3 (probed) but is NOT emitted: `?` is spelled o09's way, as a
// union with the empty word, so the emitted text stays inside what o09 uses.
//
// The EMPTY LANGUAGE has no spelling in the o09 subset (`re.none` is not used
// there), so it is written `(re.inter (str.to_re "") (str.to_re "a"))` —
// ε ∩ {"a"} = ∅ — which stays inside the subset.

const EMPTY_LANG: &str = "(re.inter (str.to_re \"\") (str.to_re \"a\"))";

/// SMT-LIB 2.6 string literal, escaped the way `smt/src/re.rs` escapes: a raw
/// control byte is accepted by z3 but REJECTED by cvc5, so every
/// non-printable character is emitted `\u{..}`. `"` is doubled.
pub fn smt_string_literal(s: &str) -> String {
    let backslash = char::from(92u8);
    let mut out = String::from("\"");
    for ch in s.chars() {
        if ch == '"' {
            out.push('"');
            out.push('"');
        } else if (' '..='~').contains(&ch) {
            out.push(ch);
        } else {
            out.push_str(&format!("{}u{{{:x}}}", backslash, ch as u32));
        }
    }
    out.push('"');
    out
}

fn char_lit(c: u8) -> String {
    smt_string_literal(&(c as char).to_string())
}

fn class_smt(s: ClassSet) -> String {
    if s.is_empty() {
        return EMPTY_LANG.to_string();
    }
    let ranges = s.ranges();
    let parts: Vec<String> = ranges
        .iter()
        .map(|(lo, hi)| {
            if lo == hi {
                format!("(str.to_re {})", char_lit(*lo))
            } else {
                format!("(re.range {} {})", char_lit(*lo), char_lit(*hi))
            }
        })
        .collect();
    if parts.len() == 1 {
        parts.into_iter().next().unwrap()
    } else {
        format!("(re.union {})", parts.join(" "))
    }
}

/// Render a `RecExpr<ReLang>` as SMT-LIB2.
///
/// Two PRINTER-LEVEL optimisations, both semantics-preserving, both there so
/// the emitted text looks like o09's and so z3 is not handed a needlessly deep
/// term: right-associated `cat`/`alt` chains are flattened to n-ary `re.++` /
/// `re.union`, and a run of adjacent single-character literals is coalesced
/// into one `str.to_re "…"`.
pub fn to_smt(expr: &RecExpr<ReLang>) -> String {
    let root = Id::from(expr.as_ref().len() - 1);
    node_smt(expr, root)
}

fn node_smt(expr: &RecExpr<ReLang>, id: Id) -> String {
    let nodes = expr.as_ref();
    match &nodes[usize::from(id)] {
        ReLang::Eps => "(str.to_re \"\")".to_string(),
        ReLang::Empty => EMPTY_LANG.to_string(),
        ReLang::Lit(LitChar(c)) => format!("(str.to_re {})", char_lit(*c)),
        ReLang::Cls(s) => class_smt(*s),
        ReLang::Bnd(_) => unreachable!("bounds leaf is never printed on its own"),
        ReLang::Star([a]) => format!("(re.* {})", node_smt(expr, *a)),
        ReLang::Plus([a]) => format!("(re.+ {})", node_smt(expr, *a)),
        ReLang::Opt([a]) => format!("(re.union (str.to_re \"\") {})", node_smt(expr, *a)),
        ReLang::Inter([a, b]) => format!(
            "(re.inter {} {})",
            node_smt(expr, *a),
            node_smt(expr, *b)
        ),
        ReLang::Rep([a, b]) => {
            let ReLang::Bnd(bounds) = &nodes[usize::from(*b)] else {
                unreachable!("rep's second child is always a bounds leaf")
            };
            format!(
                "((_ re.loop {} {}) {})",
                bounds.lo,
                bounds.hi,
                node_smt(expr, *a)
            )
        }
        ReLang::Alt(_) => {
            let mut flat = Vec::new();
            flatten_alt(expr, id, &mut flat);
            let parts: Vec<String> = flat.iter().map(|i| node_smt(expr, *i)).collect();
            format!("(re.union {})", parts.join(" "))
        }
        ReLang::Cat(_) => {
            let mut flat = Vec::new();
            flatten_cat(expr, id, &mut flat);
            let parts = coalesce_literals(expr, &flat);
            if parts.len() == 1 {
                parts.into_iter().next().unwrap()
            } else {
                format!("(re.++ {})", parts.join(" "))
            }
        }
    }
}

fn flatten_cat(expr: &RecExpr<ReLang>, id: Id, out: &mut Vec<Id>) {
    match &expr.as_ref()[usize::from(id)] {
        ReLang::Cat([a, b]) => {
            flatten_cat(expr, *a, out);
            flatten_cat(expr, *b, out);
        }
        _ => out.push(id),
    }
}

fn flatten_alt(expr: &RecExpr<ReLang>, id: Id, out: &mut Vec<Id>) {
    match &expr.as_ref()[usize::from(id)] {
        ReLang::Alt([a, b]) => {
            flatten_alt(expr, *a, out);
            flatten_alt(expr, *b, out);
        }
        _ => out.push(id),
    }
}

fn coalesce_literals(expr: &RecExpr<ReLang>, ids: &[Id]) -> Vec<String> {
    let nodes = expr.as_ref();
    let mut out: Vec<String> = Vec::new();
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut Vec<String>| {
        if !run.is_empty() {
            out.push(format!("(str.to_re {})", smt_string_literal(run)));
            run.clear();
        }
    };
    for id in ids {
        match &nodes[usize::from(*id)] {
            ReLang::Lit(LitChar(c)) => run.push(*c as char),
            // DELIBERATELY NOT coalesced: a singleton CLASS denotes the same
            // one-character language as a literal, so folding it into the run
            // would print `\.git[\/]hooks` and `\.git\/hooks` identically — and
            // the z3 check of exactly that merge would become a tautology. The
            // printer must not normalise away the equivalence under test.
            ReLang::Eps => {}
            _ => {
                flush(&mut run, &mut out);
                out.push(node_smt(expr, *id));
            }
        }
    }
    flush(&mut run, &mut out);
    if out.is_empty() {
        out.push("(str.to_re \"\")".to_string());
    }
    out
}

// ─── Human-readable rendering (report only) ─────────────────────────────────

pub fn pretty(expr: &RecExpr<ReLang>) -> String {
    let root = Id::from(expr.as_ref().len() - 1);
    pretty_node(expr, root)
}

fn pretty_node(expr: &RecExpr<ReLang>, id: Id) -> String {
    let nodes = expr.as_ref();
    match &nodes[usize::from(id)] {
        ReLang::Eps => "ε".to_string(),
        ReLang::Empty => "∅".to_string(),
        ReLang::Lit(LitChar(c)) => format!("'{}'", escape_vis(*c)),
        ReLang::Cls(s) => pretty_class(*s),
        ReLang::Bnd(b) => format!("{{{},{}}}", b.lo, b.hi),
        ReLang::Star([a]) => format!("({})*", pretty_node(expr, *a)),
        ReLang::Plus([a]) => format!("({})+", pretty_node(expr, *a)),
        ReLang::Opt([a]) => format!("({})?", pretty_node(expr, *a)),
        ReLang::Inter([a, b]) => format!(
            "({} ∩ {})",
            pretty_node(expr, *a),
            pretty_node(expr, *b)
        ),
        ReLang::Rep([a, b]) => {
            let ReLang::Bnd(bounds) = &nodes[usize::from(*b)] else {
                unreachable!()
            };
            format!("({}){{{},{}}}", pretty_node(expr, *a), bounds.lo, bounds.hi)
        }
        ReLang::Cat([a, b]) => format!(
            "{}·{}",
            pretty_node(expr, *a),
            pretty_node(expr, *b)
        ),
        ReLang::Alt([a, b]) => format!(
            "({}|{})",
            pretty_node(expr, *a),
            pretty_node(expr, *b)
        ),
    }
}

fn escape_vis(c: u8) -> String {
    if c == 0x09 {
        "\\t".to_string()
    } else {
        (c as char).to_string()
    }
}

pub fn pretty_class(s: ClassSet) -> String {
    if s == ClassSet::sigma() {
        return "Σ".to_string();
    }
    if s == ClassSet::word() {
        return "W".to_string();
    }
    if s == ClassSet::nonword() {
        return "NW".to_string();
    }
    if s.is_empty() {
        return "[]".to_string();
    }
    if let Some(c) = s.as_single() {
        return format!("[{}]", escape_vis(c));
    }
    let body: Vec<String> = s
        .ranges()
        .iter()
        .map(|(lo, hi)| {
            if lo == hi {
                escape_vis(*lo)
            } else {
                format!("{}-{}", escape_vis(*lo), escape_vis(*hi))
            }
        })
        .collect();
    format!("[{}]", body.join(""))
}

impl Unparsed {
    pub fn new_pub(kind: &'static str, detail: impl Into<String>) -> Self {
        Unparsed {
            kind,
            detail: detail.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::parse;

    fn sem(p: &str) -> Re {
        desugar(&parse(p).unwrap()).unwrap().0
    }

    #[test]
    fn leading_and_trailing_boundary_reproduce_lang_rs_shapes() {
        // `\bexit\s+0\b` must open with lang.rs::boundary_prefix() and close
        // with boundary_suffix() — the shapes O9 check A verified.
        let smt = to_smt(&sem(r"\bexit\s+0\b").to_recexpr());
        let prefix = to_smt(&boundary_prefix_word_right().to_recexpr());
        let suffix = to_smt(&boundary_suffix_word_left().to_recexpr());
        assert!(smt.contains(&prefix), "prefix shape missing:\n{smt}");
        assert!(smt.contains(&suffix), "suffix shape missing:\n{smt}");
    }

    #[test]
    fn boundary_next_to_a_nonword_char_uses_the_other_polarity() {
        // `\b#515\b`: the left `\b` abuts '#', a NON-word character, so the
        // preceding character must BE a word character — no ε branch. (The
        // printer flattens the chain, so the shape is checked componentwise.)
        let smt = to_smt(&sem(r"\b#515\b").to_recexpr());
        let head = format!(
            "(re.++ {} {} ",
            to_smt(&sigma_star().to_recexpr()),
            to_smt(&word().to_recexpr())
        );
        assert!(smt.starts_with(&head), "{smt}");
        // The ε-branch prefix (the WORD-polarity shape) must NOT be used here.
        assert!(
            !smt.contains(&to_smt(&boundary_prefix_word_right().to_recexpr())),
            "{smt}"
        );
    }

    #[test]
    fn anchors_remove_the_padding() {
        let smt = to_smt(&sem("^abc$").to_recexpr());
        assert_eq!(smt, "(str.to_re \"abc\")");
    }

    #[test]
    fn printer_does_not_normalise_away_the_equivalence_under_test() {
        // A singleton class must NOT print like the literal: if it did, the z3
        // check of the `[\/]` ↔ `/` merge would be a tautology instead of a
        // proof. The two forms must reach the solver structurally different.
        let a = to_smt(&sem(r"\.git[\/]hooks").to_recexpr());
        let b = to_smt(&sem(r"\.git\/hooks").to_recexpr());
        assert_ne!(a, b, "printer collapsed the merge under test");
        assert!(a.contains("(str.to_re \".git\") (str.to_re \"/\")"), "{a}");
        assert!(b.contains("(str.to_re \".git/hooks\")"), "{b}");
    }

    #[test]
    fn open_repeat_lowers_to_closed_loop_plus_star() {
        let smt = to_smt(&sem("^a{3,}$").to_recexpr());
        assert!(smt.contains("(_ re.loop 3 3)"), "{smt}");
        assert!(smt.contains("(re.* (str.to_re \"a\"))"), "{smt}");
    }

    #[test]
    fn tab_is_emitted_as_a_unicode_escape() {
        let smt = to_smt(&sem(r"^\s$").to_recexpr());
        assert!(smt.contains("u{9}"), "{smt}");
        assert!(!smt.contains('\t'), "raw tab byte leaked into SMT: {smt}");
    }

    #[test]
    fn nested_boundary_is_refused() {
        let ast = parse(r"\.git(?:/|\b)").unwrap();
        assert_eq!(desugar(&ast).unwrap_err().kind, "word-boundary-nested");
    }

    #[test]
    fn anchor_inside_a_group_is_refused() {
        let ast = parse(r"(^|[^a-z])#\d+").unwrap();
        assert_eq!(desugar(&ast).unwrap_err().kind, "anchor-not-at-branch-edge");
    }

    #[test]
    fn polarity_is_read_from_the_whole_segment_not_the_adjacent_item() {
        // `\banchors?\b`: the item next to the trailing `\b` is the NULLABLE
        // `s?`, but every character that can end the segment (r or s) is a word
        // character, so the boundary IS determined.
        let smt = to_smt(&sem(r"\banchors?\b").to_recexpr());
        assert!(
            smt.contains(&to_smt(&boundary_suffix_word_left().to_recexpr())),
            "{smt}"
        );
    }

    #[test]
    fn genuinely_mixed_polarity_is_still_refused() {
        // `git add\s+(-A|\.)\b`: the segment can end in `A` (word) or `.`
        // (non-word), so the boundary means different things per branch.
        let ast = parse(r"git add\s+(-A|\.)\b").unwrap();
        assert_eq!(
            desugar(&ast).unwrap_err().kind,
            "word-boundary-ambiguous-polarity"
        );
    }

    #[test]
    fn top_level_alternation_with_boundaries_distributes() {
        // Each branch carries its own padding + boundary desugar.
        assert!(desugar(&parse(r"\bfoo\b|bar").unwrap()).is_ok());
    }
}
