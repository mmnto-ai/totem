//! Character sets over the LINE alphabet.
//!
//! REPRESENTATION CHOICE (DESIGN.md guard rail — "If egg's API fights the
//! language definition (e.g. char-class representation), simplify the IR
//! representation rather than the semantics, and record the representation
//! choice"):
//!
//! A character class is a 128-bit mask over code points 0..=127, canonicalised
//! by construction to a subset of Σ. Two classes written differently in source
//! (`['"]` vs `["']`) therefore become the SAME e-node — equality of classes is
//! decided by the representation, never by a rewrite rule. Set union,
//! complement-within-Σ and subset are single machine words. This is a
//! representation simplification, not a semantic one: every operation below is
//! exact ON Σ.
//!
//! ALPHABET (mirrors `smt/src/lang.rs::line_any`, the O9-verified choice):
//!   Σ = {0x09 (tab)} ∪ [0x20 ..= 0x7E]   — 96 characters.
//! The record runtime evaluates every regex per ADDED LINE and flagless, so a
//! line never contains `\n`. `\f`, `\v`, and every non-ASCII character are
//! OUTSIDE Σ; the bound that places on this probe is stated in the report.

use std::fmt;
use std::str::FromStr;

const fn build_sigma() -> u128 {
    let mut mask: u128 = 1u128 << 9; // horizontal tab
    let mut c: u32 = 0x20;
    while c <= 0x7E {
        mask |= 1u128 << c;
        c += 1;
    }
    mask
}

/// Σ — the LINE alphabet.
pub const SIGMA: u128 = build_sigma();

const fn build_word() -> u128 {
    let mut mask: u128 = 1u128 << b'_' as u32;
    let mut c: u32 = b'0' as u32;
    while c <= b'9' as u32 {
        mask |= 1u128 << c;
        c += 1;
    }
    c = b'A' as u32;
    while c <= b'Z' as u32 {
        mask |= 1u128 << c;
        c += 1;
    }
    c = b'a' as u32;
    while c <= b'z' as u32 {
        mask |= 1u128 << c;
        c += 1;
    }
    mask
}

/// `[A-Za-z0-9_]` — the regex word class (mirrors `lang.rs::word_char`).
pub const WORD: u128 = build_word();

/// Σ minus the word class (mirrors `lang.rs::nonword_char`'s enumeration).
pub const NONWORD: u128 = SIGMA & !WORD;

/// `\s` restricted to Σ: space or tab (mirrors `lang.rs::ws_char`).
pub const WS: u128 = (1u128 << 9) | (1u128 << 0x20);

const fn build_digit() -> u128 {
    let mut mask: u128 = 0;
    let mut c: u32 = b'0' as u32;
    while c <= b'9' as u32 {
        mask |= 1u128 << c;
        c += 1;
    }
    mask
}

/// `\d` — `[0-9]`.
pub const DIGIT: u128 = build_digit();

/// A set of characters, canonically a subset of Σ.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
pub struct ClassSet(pub u128);

impl ClassSet {
    pub const fn empty() -> Self {
        ClassSet(0)
    }
    /// Σ itself — what `.` and `[^\n]` denote on a line.
    pub const fn sigma() -> Self {
        ClassSet(SIGMA)
    }
    pub const fn word() -> Self {
        ClassSet(WORD)
    }
    pub const fn nonword() -> Self {
        ClassSet(NONWORD)
    }
    pub const fn ws() -> Self {
        ClassSet(WS)
    }
    pub const fn digit() -> Self {
        ClassSet(DIGIT)
    }

    /// A single character, silently clipped to Σ. Callers that must reject an
    /// out-of-Σ character check `in_sigma` FIRST; this never widens Σ.
    pub fn single(c: u32) -> Self {
        if c < 128 && (SIGMA >> c) & 1 == 1 {
            ClassSet(1u128 << c)
        } else {
            ClassSet(0)
        }
    }

    /// An inclusive range, intersected with Σ.
    pub fn range(lo: u32, hi: u32) -> Self {
        if lo > hi {
            return ClassSet(0);
        }
        let mut mask: u128 = 0;
        let top = hi.min(127);
        let mut c = lo;
        while c <= top {
            mask |= 1u128 << c;
            c += 1;
        }
        ClassSet(mask & SIGMA)
    }

    pub fn union(self, other: Self) -> Self {
        ClassSet(self.0 | other.0)
    }
    /// Complement WITHIN Σ — never over all strings (the classic complement bug
    /// `smt/src/re.rs` warns about).
    pub fn complement(self) -> Self {
        ClassSet(!self.0 & SIGMA)
    }
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
    pub fn len(self) -> u32 {
        self.0.count_ones()
    }
    pub fn subset_of(self, mask: u128) -> bool {
        self.0 & !mask == 0
    }
    /// The single member, when there is exactly one.
    pub fn as_single(self) -> Option<u8> {
        if self.0.count_ones() == 1 {
            Some(self.0.trailing_zeros() as u8)
        } else {
            None
        }
    }

    /// Maximal contiguous runs, ascending — the form the SMT printer emits.
    pub fn ranges(self) -> Vec<(u8, u8)> {
        let mut out = Vec::new();
        let mut c: u32 = 0;
        while c < 128 {
            if (self.0 >> c) & 1 == 1 {
                let start = c;
                while c + 1 < 128 && (self.0 >> (c + 1)) & 1 == 1 {
                    c += 1;
                }
                out.push((start as u8, c as u8));
            }
            c += 1;
        }
        out
    }
}

/// Is this code point inside Σ?
pub fn in_sigma(c: u32) -> bool {
    c < 128 && (SIGMA >> c) & 1 == 1
}

// ─── egg leaf-data plumbing ─────────────────────────────────────────────────
//
// `define_language!` needs every data-carrying leaf to round-trip through
// Display/FromStr. The encodings below are OPAQUE HEX on purpose: a literal or
// a class may contain spaces, quotes and parentheses, and egg's s-expression
// reader splits on whitespace. Nothing in this probe ever parses a RecExpr back
// from text — the encodings exist so the derived trait bounds are satisfiable
// and so `RecExpr::to_string()` (used as the canonical-form GROUPING KEY) is
// injective. Human-readable rendering lives in `ir::pretty`.

impl fmt::Display for ClassSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "cls:{:032x}", self.0)
    }
}

impl FromStr for ClassSet {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let hex = s
            .strip_prefix("cls:")
            .ok_or_else(|| format!("not a class token: {s}"))?;
        u128::from_str_radix(hex, 16)
            .map(ClassSet)
            .map_err(|e| e.to_string())
    }
}

/// A single literal character (always in Σ).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct LitChar(pub u8);

impl fmt::Display for LitChar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "lit:{:02x}", self.0)
    }
}

impl FromStr for LitChar {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let hex = s
            .strip_prefix("lit:")
            .ok_or_else(|| format!("not a literal token: {s}"))?;
        u8::from_str_radix(hex, 16)
            .map(LitChar)
            .map_err(|e| e.to_string())
    }
}

/// Counted-repetition bounds, always closed (`{n,}` is lowered at parse time to
/// `X{n,n} · X*`, so `hi` is never open here).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Bounds {
    pub lo: u32,
    pub hi: u32,
}

impl fmt::Display for Bounds {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "bnd:{}_{}", self.lo, self.hi)
    }
}

impl FromStr for Bounds {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let body = s
            .strip_prefix("bnd:")
            .ok_or_else(|| format!("not a bounds token: {s}"))?;
        let (lo, hi) = body
            .split_once('_')
            .ok_or_else(|| format!("malformed bounds: {s}"))?;
        Ok(Bounds {
            lo: lo.parse::<u32>().map_err(|e| e.to_string())?,
            hi: hi.parse::<u32>().map_err(|e| e.to_string())?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sigma_is_96_chars() {
        assert_eq!(ClassSet::sigma().len(), 96);
        assert!(in_sigma(0x09));
        assert!(!in_sigma(0x0a));
        assert!(in_sigma(0x20));
        assert!(in_sigma(0x7e));
        assert!(!in_sigma(0x7f));
    }

    #[test]
    fn nonword_matches_lang_rs_enumeration() {
        // lang.rs::nonword_char(): \t, 0x20..0x2F, 0x3A..0x40, 0x5B..0x5E, 0x60,
        // 0x7B..0x7E.
        let enumerated = ClassSet::single(0x09)
            .union(ClassSet::range(0x20, 0x2F))
            .union(ClassSet::range(0x3A, 0x40))
            .union(ClassSet::range(0x5B, 0x5E))
            .union(ClassSet::single(0x60))
            .union(ClassSet::range(0x7B, 0x7E));
        assert_eq!(enumerated, ClassSet::nonword());
    }

    #[test]
    fn class_ranges_round_trip() {
        let c = ClassSet::range(b'a' as u32, b'z' as u32).union(ClassSet::single(b'_' as u32));
        assert_eq!(c.ranges(), vec![(b'_', b'_'), (b'a', b'z')]);
    }

    #[test]
    fn leaf_tokens_round_trip() {
        let c = ClassSet::sigma();
        assert_eq!(ClassSet::from_str(&c.to_string()).unwrap(), c);
        let l = LitChar(b'x');
        assert_eq!(LitChar::from_str(&l.to_string()).unwrap(), l);
        let b = Bounds { lo: 0, hi: 40 };
        assert_eq!(Bounds::from_str(&b.to_string()).unwrap(), b);
    }
}
