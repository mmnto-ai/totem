//! The obligation IR: a small regex + formula AST with an SMT-LIB2 printer.
//!
//! WHY an IR rather than hand-written `.smt2` text: the spike has to run each
//! obligation through TWO backends (the pinned CLIs and the z3 C API) and then
//! assert that they agree. If each backend had its own hand-authored encoding,
//! an "agreement" would only prove that two hand-encodings of possibly
//! different questions happen to share a status. Building both from ONE IR
//! makes agreement mean what the spec says it means.
//!
//! The constructors are restricted to the subset OBLIGATIONS.md names —
//! `str.in_re`, `re.++`, `re.union`, `re.inter`, `re.comp`, `re.range`,
//! `str.to_re`, `re.*`, `re.+` — plus `re.loop`, which is measured on both
//! pinned solvers and recorded as a dialect row (see `DIALECT` in main.rs).

use std::fmt::Write as _;

/// A regular expression over the modelled alphabet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Re {
    /// `str.to_re "…"` — a literal word.
    Str(String),
    /// `re.range "a" "b"` — an inclusive single-character range.
    Range(char, char),
    /// `re.++` — concatenation.
    Concat(Vec<Re>),
    /// `re.union`.
    Union(Vec<Re>),
    /// `re.inter`.
    Inter(Vec<Re>),
    /// `re.comp` — complement over ALL strings, not over the modelled alphabet.
    /// Every use in this harness intersects the result back with the alphabet;
    /// forgetting that is the classic complement bug and O9 check A exists to
    /// keep it honest.
    Comp(Box<Re>),
    /// `re.*`.
    Star(Box<Re>),
    /// `re.+`.
    Plus(Box<Re>),
    /// `(_ re.loop lo hi)` — bounded repetition.
    Loop(Box<Re>, u32, u32),
}

impl Re {
    pub fn lit(s: &str) -> Re {
        Re::Str(s.to_string())
    }
    pub fn range(lo: char, hi: char) -> Re {
        Re::Range(lo, hi)
    }
    pub fn cat(parts: Vec<Re>) -> Re {
        Re::Concat(parts)
    }
    pub fn union(parts: Vec<Re>) -> Re {
        Re::Union(parts)
    }
    pub fn inter(parts: Vec<Re>) -> Re {
        Re::Inter(parts)
    }
    pub fn comp(inner: Re) -> Re {
        Re::Comp(Box::new(inner))
    }
    pub fn star(inner: Re) -> Re {
        Re::Star(Box::new(inner))
    }
    pub fn plus(inner: Re) -> Re {
        Re::Plus(Box::new(inner))
    }
    pub fn loop_(inner: Re, lo: u32, hi: u32) -> Re {
        Re::Loop(Box::new(inner), lo, hi)
    }
    /// The empty word, as a regex. `re.union` with this is the `?` operator.
    pub fn epsilon() -> Re {
        Re::Str(String::new())
    }
    /// `X?` — optional, spelled as a union with epsilon so the emitted text
    /// stays inside the named construct subset.
    pub fn opt(inner: Re) -> Re {
        Re::Union(vec![Re::epsilon(), inner])
    }

    pub fn to_smt(&self) -> String {
        let mut out = String::new();
        self.write_smt(&mut out);
        out
    }

    fn write_smt(&self, out: &mut String) {
        match self {
            Re::Str(s) => {
                let _ = write!(out, "(str.to_re {})", smt_string_literal(s));
            }
            Re::Range(lo, hi) => {
                let _ = write!(
                    out,
                    "(re.range {} {})",
                    smt_string_literal(&lo.to_string()),
                    smt_string_literal(&hi.to_string())
                );
            }
            Re::Concat(parts) => write_nary(out, "re.++", parts),
            Re::Union(parts) => write_nary(out, "re.union", parts),
            Re::Inter(parts) => write_nary(out, "re.inter", parts),
            Re::Comp(inner) => {
                out.push_str("(re.comp ");
                inner.write_smt(out);
                out.push(')');
            }
            Re::Star(inner) => {
                out.push_str("(re.* ");
                inner.write_smt(out);
                out.push(')');
            }
            Re::Plus(inner) => {
                out.push_str("(re.+ ");
                inner.write_smt(out);
                out.push(')');
            }
            Re::Loop(inner, lo, hi) => {
                let _ = write!(out, "((_ re.loop {lo} {hi}) ");
                inner.write_smt(out);
                out.push(')');
            }
        }
    }
}

/// N-ary application, folded to the single operand when there is exactly one
/// (`(re.++ X)` is legal but noisy, and a 0-ary `re.++` is not portable).
///
/// ZERO OPERANDS are handled PER OPERATOR, because the three do not share an
/// identity. Concatenation's is the empty word, so `re.++` over nothing folds to
/// `(str.to_re "")`. Union's identity is the EMPTY language and intersection's
/// is the UNIVERSAL one; emitting epsilon for either would silently ask a
/// different question. No obligation constructs a zero-operand union or
/// intersection (`globs_to_re` is the only caller that builds its operand list
/// from an argument, and every call site passes a non-empty list), so this
/// refuses loudly rather than guessing an identity — a wrong `re.none`/`re.all`
/// choice here would be indistinguishable from a correct proof downstream.
fn write_nary(out: &mut String, op: &str, parts: &[Re]) {
    match parts.len() {
        0 if op == "re.++" => out.push_str("(str.to_re \"\")"),
        0 => panic!(
            "zero-operand {op} has no epsilon identity and is outside this harness's supported \
             subset — build the operand list before printing it"
        ),
        1 => parts[0].write_smt(out),
        _ => {
            let _ = write!(out, "({op}");
            for part in parts {
                out.push(' ');
                part.write_smt(out);
            }
            out.push(')');
        }
    }
}

/// A quantifier-free formula over declared string constants.
#[derive(Debug, Clone)]
pub enum Form {
    /// `(str.in_re <var> <re>)`
    InRe(String, Re),
    /// `(= <var> "<literal>")`
    EqLit(String, String),
    /// `(not …)`
    Not(Box<Form>),
    /// `(xor … …)` — O9's equivalence test is a symmetric-difference emptiness
    /// check, which is exactly an unsatisfiable xor.
    Xor(Box<Form>, Box<Form>),
}

impl Form {
    pub fn in_re(var: &str, re: Re) -> Form {
        Form::InRe(var.to_string(), re)
    }
    pub fn eq_lit(var: &str, value: &str) -> Form {
        Form::EqLit(var.to_string(), value.to_string())
    }
    pub fn not(inner: Form) -> Form {
        Form::Not(Box::new(inner))
    }
    pub fn xor(a: Form, b: Form) -> Form {
        Form::Xor(Box::new(a), Box::new(b))
    }

    pub fn to_smt(&self) -> String {
        match self {
            Form::InRe(var, re) => format!("(str.in_re {} {})", var, re.to_smt()),
            Form::EqLit(var, value) => format!("(= {} {})", var, smt_string_literal(value)),
            Form::Not(inner) => format!("(not {})", inner.to_smt()),
            Form::Xor(a, b) => format!("(xor {} {})", a.to_smt(), b.to_smt()),
        }
    }
}

/// Render a Rust string as an SMT-LIB 2.6 string literal.
///
/// MEASURED dialect constraint (probe, 2026-08-27): a RAW control byte inside a
/// string literal is accepted by Z3 and REJECTED by cvc5 —
///   `Parse Error: Illegal string character: "<TAB>", must use escape sequence`
/// so every non-printable character MUST be emitted in `\u{…}` form. Printable
/// ASCII passes through; `"` is doubled, which is SMT-LIB's only other escape.
///
/// The backslash is built with `char::from(92)` rather than written as an
/// escape sequence, so no `\u`-shaped text is ever authored into this file.
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
            let _ = write!(out, "{}u{{{:x}}}", backslash, ch as u32);
        }
    }
    out.push('"');
    out
}
