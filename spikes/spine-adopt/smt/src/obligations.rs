//! The ten proof obligations of OBLIGATIONS.md, as data.
//!
//! Each obligation is a list of CHECKS. A check is a set of assertions plus the
//! status the table expects. Multi-check obligations (O3, O8, O9) are emitted
//! with `push`/`pop` so one `.smt2` file still corresponds to one obligation,
//! as the deliverable requires.
//!
//! ## The REDUNDANT-ASSERTION rule
//!
//! No obligation emits an assertion that is logically implied by another
//! assertion in the same check. In practice this means no free-standing
//! "the witness is over the line alphabet" membership: every pattern language
//! here is built from alphabet characters, so membership in the pattern already
//! confines the witness, and the extra assertion adds no constraint and removes
//! no model.
//!
//! This is not tidiness. MEASURED on the pinned solvers (dialect finding D6):
//! carrying that redundant assertion in O7 took cvc5 from a ~34ms `sat` to
//! UNDECIDED at a 300-second budget, while z3 answered in ~23ms either way. An
//! encoding that a lowerer would consider semantically identical is the
//! difference between the challenger working and the challenger being useless.
//! O9 is the control on that conclusion: removing the same redundancy there
//! does NOT rescue cvc5, so its difficulty is intrinsic rather than encoding-
//! induced.

use crate::lang::*;
use crate::re::{Form, Re};

/// What the OBLIGATIONS.md table expects of a check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expect {
    Sat,
    Unsat,
    /// O7's "measured (either), agreement required". A result that is not the
    /// guessed one is DATA, not a defect.
    Measured,
    /// The deliberate-timeout expectation: NOT being decided is the PASS
    /// condition. Typed rather than left as `Measured`, because `Measured`
    /// cannot express it and every consumer would otherwise have to recover the
    /// intent from the `O10` id literal — which a second timeout obligation
    /// would then be misreported by.
    NotProven,
}

impl Expect {
    pub fn as_str(self) -> &'static str {
        match self {
            Expect::Sat => "sat",
            Expect::Unsat => "unsat",
            Expect::Measured => "measured",
            Expect::NotProven => "not-proven",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Assertion {
    /// `Some` ⇒ emitted as `(! … :named label)` so it can appear in an unsat
    /// core. Only UNSAT-expected checks name their assertions: a `:named`
    /// assertion also shows up in Z3's `(get-model)` output as a Bool
    /// definition, which would pollute the countermodel evidence.
    pub label: Option<String>,
    pub form: Form,
}

impl Assertion {
    pub fn plain(form: Form) -> Assertion {
        Assertion { label: None, form }
    }
    pub fn named(label: &str, form: Form) -> Assertion {
        Assertion { label: Some(label.to_string()), form }
    }
}

#[derive(Debug, Clone)]
pub struct Check {
    pub name: String,
    pub expect: Expect,
    pub asserts: Vec<Assertion>,
}

#[derive(Debug, Clone)]
pub struct Obligation {
    pub id: String,
    pub class: String,
    pub question: String,
    pub notes: Vec<String>,
    /// String constants to declare, in order.
    pub decls: Vec<String>,
    pub checks: Vec<Check>,
    /// Seconds. Only O10 carries one.
    pub timeout_s: Option<u32>,
    /// The OBLIGATIONS.md "Expected" cell, verbatim-ish, for the report.
    pub expected_summary: String,
}

impl Obligation {
    pub fn wants_models(&self) -> bool {
        self.checks.iter().any(|c| c.expect != Expect::Unsat)
    }
    pub fn wants_cores(&self) -> bool {
        self.checks.iter().any(|c| c.expect == Expect::Unsat)
    }
    pub fn is_multi_check(&self) -> bool {
        self.checks.len() > 1
    }

    /// The chain's SOURCE artifact: a deterministic rendering of the obligation
    /// DEFINITION (what is being proved), distinct from the emitted SMT-LIB
    /// script (how it is asked). `sha256(this) → sha256(.smt2) → sha256(evidence)`
    /// is the R2-shaped chain OBLIGATIONS.md § Evidence contract requires.
    pub fn canonical_source(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("id={}\n", self.id));
        out.push_str(&format!("class={}\n", self.class));
        out.push_str(&format!("question={}\n", self.question));
        out.push_str(&format!("expected={}\n", self.expected_summary));
        for note in &self.notes {
            out.push_str(&format!("note={note}\n"));
        }
        for decl in &self.decls {
            out.push_str(&format!("decl={decl}:String\n"));
        }
        if let Some(seconds) = self.timeout_s {
            out.push_str(&format!("timeout_s={seconds}\n"));
        }
        for check in &self.checks {
            out.push_str(&format!("check={} expect={}\n", check.name, check.expect.as_str()));
            for assertion in &check.asserts {
                let label = assertion.label.as_deref().unwrap_or("-");
                out.push_str(&format!("  assert[{}]={}\n", label, assertion.form.to_smt()));
            }
        }
        out
    }

    /// Emit the SMT-LIB2 script. Deterministic: no timestamps, no paths, no
    /// iteration over unordered collections.
    pub fn to_smtlib(&self) -> String {
        let mut out = String::new();
        let rule = "; ".to_string() + &"─".repeat(74);

        out.push_str(&rule);
        out.push('\n');
        out.push_str(&format!("; {} — {}\n", self.id, self.class));
        out.push_str(";\n");
        for line in wrap_comment(&self.question) {
            out.push_str(&format!("; {line}\n"));
        }
        if !self.notes.is_empty() {
            out.push_str(";\n");
            for note in &self.notes {
                for (index, line) in wrap_comment(note).into_iter().enumerate() {
                    out.push_str(&format!("; {}{}\n", if index == 0 { "- " } else { "  " }, line));
                }
            }
        }
        out.push_str(&format!("; Expected (OBLIGATIONS.md): {}\n", self.expected_summary));
        out.push_str(&rule);
        out.push('\n');

        out.push_str("(set-logic QF_SLIA)\n");
        if self.wants_models() {
            out.push_str("(set-option :produce-models true)\n");
        }
        if self.wants_cores() {
            out.push_str("(set-option :produce-unsat-cores true)\n");
        }
        out.push('\n');
        for decl in &self.decls {
            out.push_str(&format!("(declare-const {decl} String)\n"));
        }
        out.push('\n');

        let multi = self.is_multi_check();
        for check in &self.checks {
            out.push_str(&format!(
                "; ── check: {} (expect {}) ─────────────────────────────────\n",
                check.name,
                check.expect.as_str()
            ));
            if multi {
                out.push_str("(push 1)\n");
            }
            for assertion in &check.asserts {
                match &assertion.label {
                    Some(label) => {
                        out.push_str(&format!("(assert (! {} :named {}))\n", assertion.form.to_smt(), label))
                    }
                    None => out.push_str(&format!("(assert {})\n", assertion.form.to_smt())),
                }
            }
            out.push_str("(check-sat)\n");
            match check.expect {
                Expect::Unsat => out.push_str("(get-unsat-core)\n"),
                _ => out.push_str("(get-model)\n"),
            }
            if multi {
                out.push_str("(pop 1)\n");
            }
            out.push('\n');
        }
        out
    }
}

fn wrap_comment(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() && current.len() + 1 + word.len() > 74 {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

// ─── The ten ───────────────────────────────────────────────────────────────

pub fn all() -> Vec<Obligation> {
    vec![o01(), o02(), o03(), o04(), o05(), o06(), o07(), o08(), o09(), o10()]
}

/// O1 — Requires-vacuity (mmnto-ai/totem#2678 class).
fn o01() -> Obligation {
    let target = search_word_bounded(specimen_d_target_body());
    let requires = search_unbounded(specimen_d_requires());
    Obligation {
        id: "O1".into(),
        class: "contradiction".into(),
        question: "Requires-vacuity: does requires.pattern match every line that target.pattern \
                   matches — i.e. can the rule EVER fire? SAT = the rule can fire and the witness \
                   IS the firing line; UNSAT = the rule is vacuous."
            .into(),
        notes: vec![
            "Source: specimen (d) d-requires-line.rule.yaml — target \\bgit\\s+(log|diff|status)\\b, \
             requires LC_ALL=C, requires.scope: line."
                .into(),
            "requires: is a MATCH PREDICATE (satisfied ⇒ no violation), so vacuity is exactly \
             L(target) ⊆ L(requires)."
                .into(),
            "No separate line-alphabet assertion is emitted: L(target) is built entirely over the \
             line alphabet, so membership in it already confines the witness to a real line. See \
             the REDUNDANT-ASSERTION rule in the module header."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![Check {
            name: "target-matches-without-requirement".into(),
            expect: Expect::Sat,
            asserts: vec![
                Assertion::plain(Form::in_re("s", target)),
                Assertion::plain(Form::not(Form::in_re("s", requires))),
            ],
        }],
        timeout_s: None,
        expected_summary: "SAT, stable witness".into(),
    }
}

/// O2 — Dead matcher.
fn o02() -> Obligation {
    let a = search_word_bounded(specimen_a_target_body());
    let dead = Re::inter(vec![a.clone(), Re::comp(a)]);
    Obligation {
        id: "O2".into(),
        class: "contradiction".into(),
        question: "Dead matcher: is L(pattern) empty for a contradictory construction \
                   p = re.inter(A, re.comp(A))? UNSAT proves the matcher can never fire."
            .into(),
        notes: vec![
            "A is specimen (a)'s target language, so the contradiction is built over a REAL corpus \
             matcher rather than a toy."
                .into(),
            "The core is single-element by construction: the one named assertion IS the \
             contradiction. That is the honest core for this shape, not a harness limitation."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![Check {
            name: "dead-matcher-has-no-member".into(),
            expect: Expect::Unsat,
            asserts: vec![Assertion::named("dead-matcher-membership", Form::in_re("s", dead))],
        }],
        timeout_s: None,
        expected_summary: "UNSAT + unsat core".into(),
    }
}

/// O3 — Severity vocabulary exhaustiveness.
fn o03() -> Obligation {
    let vocabulary = Re::union(vec![Re::lit("error"), Re::lit("warning")]);
    // The five specimens' severities, read from the record sources.
    let specimens = [
        ("a-regex-lessons-rm-guard", "error"),
        ("b-astgrep-flat-empty-catch", "warning"),
        ("c-astgrep-compound-spawn-shell", "error"),
        ("d-requires-line", "warning"),
        ("e-exception-excludeglobs", "error"),
    ];

    let mut checks: Vec<Check> = specimens
        .iter()
        .map(|(name, severity)| Check {
            name: format!("severity-in-vocabulary:{name}"),
            expect: Expect::Sat,
            asserts: vec![
                Assertion::plain(Form::eq_lit("sev", severity)),
                Assertion::plain(Form::in_re("sev", vocabulary.clone())),
            ],
        })
        .collect();

    checks.push(Check {
        name: "negative-control:info-is-not-in-vocabulary".into(),
        expect: Expect::Unsat,
        asserts: vec![
            Assertion::named("sev-is-info", Form::eq_lit("sev", "info")),
            Assertion::named("sev-in-vocabulary", Form::in_re("sev", vocabulary)),
        ],
    });

    Obligation {
        id: "O3".into(),
        class: "exhaustiveness".into(),
        question: "Severity vocabulary exhaustiveness: is every record severity in the closed set \
                   {error, warning}? Five specimen severities must be members; the negative \
                   control \"info\" must not be."
            .into(),
        notes: vec![
            "Severities read from the five specimen records under spikes/spine-adopt/records/."
                .into(),
            "The negative control is what gives the check its teeth: without it, a vocabulary \
             regex of re.all would also pass all five."
                .into(),
        ],
        decls: vec!["sev".into()],
        checks,
        timeout_s: None,
        expected_summary: "SAT x5, UNSAT control".into(),
    }
}

/// O4 — Fixture differential (the C4 obligation).
fn o04() -> Obligation {
    let pattern = search_word_bounded(specimen_a_target_body());
    Obligation {
        id: "O4".into(),
        class: "exhaustiveness".into(),
        question: "Fixture differential: for specimen (a)'s inline example pair, is the bad line in \
                   L(pattern) AND the good line outside it? SAT means the authored pair actually \
                   discriminates."
            .into(),
        notes: vec![
            "Pair from a-regex-lessons-rm-guard.rule.yaml examples[0]: bad \
             'git rm .totem/lessons.md', good 'rm .totem/lessons/lesson-cd27a5b0.md'."
                .into(),
            "Both operands are ground, so SAT here is a PROOF about the two authored lines, not \
             the discovery of some other witness."
                .into(),
            "Line-anchored per the table: each example is one added line, and the regex is an \
             unanchored search WITHIN that line — the shipped per-added-line semantics."
                .into(),
        ],
        decls: vec!["bad".into(), "good".into()],
        checks: vec![Check {
            name: "bad-matches-and-good-does-not".into(),
            expect: Expect::Sat,
            asserts: vec![
                Assertion::plain(Form::eq_lit("bad", "git rm .totem/lessons.md")),
                Assertion::plain(Form::in_re("bad", pattern.clone())),
                Assertion::plain(Form::eq_lit("good", "rm .totem/lessons/lesson-cd27a5b0.md")),
                Assertion::plain(Form::not(Form::in_re("good", pattern))),
            ],
        }],
        timeout_s: None,
        expected_summary: "SAT (both conjuncts)".into(),
    }
}

/// O5 — Scope emptiness, specimen (e)'s scope.
fn o05() -> Obligation {
    let positive = globs_to_re(&["packages/**/*.ts"]);
    let negative = globs_to_re(&["**/*.test.ts"]);
    Obligation {
        id: "O5".into(),
        class: "set membership".into(),
        question: "Scope emptiness: does ANY path match fileGlobs and not excludeGlobs? SAT means \
                   the rule has a live scope; the witness is an in-scope path."
            .into(),
        notes: vec![
            "Scope from specimen (e) e-exception-excludeglobs.rule.yaml: fileGlobs \
             ['packages/**/*.ts'], excludeGlobs ['**/*.test.ts']."
                .into(),
            "Globs lowered by the § Design 7 profile (see lang.rs::glob_to_re); membership in \
             str.in_re is a FULL-string test, which supplies the profile's ^…$ anchoring."
                .into(),
        ],
        decls: vec!["p".into()],
        checks: vec![Check {
            name: "in-scope-path-exists".into(),
            expect: Expect::Sat,
            asserts: vec![
                Assertion::plain(Form::in_re("p", positive)),
                Assertion::plain(Form::not(Form::in_re("p", negative))),
            ],
        }],
        timeout_s: None,
        expected_summary: "SAT, witness path".into(),
    }
}

/// O6 — Exclusion subsumption (dead rule by scope).
fn o06() -> Obligation {
    let positive = globs_to_re(&["packages/**/*.test.ts"]);
    let negative = globs_to_re(&["**/*.test.ts"]);
    Obligation {
        id: "O6".into(),
        class: "set membership".into(),
        question: "Exclusion subsumption: is L(fileGlobs) a subset of L(excludeGlobs) — i.e. is \
                   every in-scope file excluded, making the rule dead by scope? UNSAT proves the \
                   subsumption."
            .into(),
        notes: vec![
            "CONSTRUCTED subsuming pair, per the table: fileGlobs ['packages/**/*.test.ts'] \
             against excludeGlobs ['**/*.test.ts']. 'packages/' is itself a legal (?:[^/]+/) \
             segment, so the positive language is contained in the negative one."
                .into(),
            "Both assertions are named so the core names the two scope arrays that jointly kill \
             the rule — the material a curation probe would surface."
                .into(),
        ],
        decls: vec!["p".into()],
        checks: vec![Check {
            name: "no-path-escapes-the-exclusion".into(),
            expect: Expect::Unsat,
            asserts: vec![
                Assertion::named("in-positive-scope", Form::in_re("p", positive)),
                Assertion::named("not-in-exclusion", Form::not(Form::in_re("p", negative))),
            ],
        }],
        timeout_s: None,
        expected_summary: "UNSAT + core".into(),
    }
}

/// O7 — Rule subsumption / redundancy.
fn o07() -> Obligation {
    let wide = search_word_bounded(control_09ee_body());
    let narrow = search_word_bounded(specimen_d_target_body());
    Obligation {
        id: "O7".into(),
        class: "regex/string constraints".into(),
        question: "Rule subsumption/redundancy: is L(p_A) a subset of L(p_B) for two corpus \
                   patterns with known overlap? Asked over the WIDENED p_A (see the dropped-\
                   lookahead note), so UNSAT would prove the SOURCE pattern subsumed, while a SAT \
                   witness is evidence for the widened approximation only."
            .into(),
        notes: vec![
            "p_A = corpus rule 09ee37252a814a09 (the lookahead-vs-requires control), \
             RE2-EXPRESSIBLE PARTS ONLY — its trailing (?![^'\"\\n]*LC_ALL=C) negative lookahead is \
             dropped."
                .into(),
            "EVIDENCE BOUNDARY. Dropping that lookahead WIDENS p_A: L(p_A_source) is a SUBSET of \
             L(p_A_widened). The containment makes the two answers asymmetric. UNSAT proves \
             L(p_A_widened) is a subset of L(p_B), hence L(p_A_source) is too — source-pattern \
             SUBSUMPTION is established. SAT only produces a witness in L(p_A_widened) minus \
             L(p_B); the dropped lookahead may exclude that very witness from the source pattern, \
             so it is evidence for the WIDENED APPROXIMATION and does NOT establish non-subsumption \
             of the source pattern. The drop is an enumerable builtin-gap finding, not a silent \
             approximation, and this is the boundary it carries."
                .into(),
            "p_B = specimen (d)'s target \\bgit\\s+(log|diff|status)\\b — a strict sub-alternation \
             of p_A's fifteen branches."
                .into(),
            "MEASURED (dialect finding D6): this obligation originally also asserted the redundant \
             line-alphabet membership. That assertion changes no model — L(p_A) is already inside \
             the alphabet — but cvc5 could not decide the obligation with it present even at 300s, \
             and decides it in ~34ms without it. z3 was unaffected either way."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![Check {
            name: "wide-pattern-catches-what-narrow-misses".into(),
            expect: Expect::Measured,
            asserts: vec![
                Assertion::plain(Form::in_re("s", wide)),
                Assertion::plain(Form::not(Form::in_re("s", narrow))),
            ],
        }],
        timeout_s: None,
        expected_summary: "measured (either), agreement required".into(),
    }
}

/// O8 — Self-suppressing pattern (mmnto-ai/totem#2680 class).
fn o08() -> Obligation {
    // FULL-MATCH semantics: the question is whether the text the pattern
    // MATCHES can itself contain the suppression directive — i.e. whether the
    // rule flags its own suppression comment. Under unanchored-search semantics
    // the question would be vacuous (any line can be extended to contain the
    // marker), which is why the span, not the line, is the subject here.
    let offender = Re::cat(vec![
        Re::lit("//"),
        Re::star(ws_char()),
        Re::lit("totem-"),
        Re::plus(Re::union(vec![Re::range('a', 'z'), Re::lit("-")])),
    ]);
    let control = Re::lit("console.log(");
    Obligation {
        id: "O8".into(),
        class: "regex/string constraints".into(),
        question: "Self-suppressing pattern: does L(pattern) intersect the suppression-directive \
                   language .*totem-ignore.*? SAT on the offender means the rule matches its own \
                   suppression comment; UNSAT on the control means a clean pattern cannot."
            .into(),
        notes: vec![
            "CONSTRUCTED pair. Offender //\\s*totem-[a-z-]+ is the #2680 shape: a comment-directive \
             matcher whose language swallows '// totem-ignore'."
                .into(),
            "Control console\\.log\\( is a matcher whose every member is a fixed twelve-character \
             span that cannot contain the marker."
                .into(),
            "The subject is the MATCHED SPAN, not the whole line — see the code comment; under \
             line semantics both halves would be trivially SAT and the obligation would prove \
             nothing."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![
            Check {
                name: "offender-span-can-be-a-suppression-directive".into(),
                expect: Expect::Sat,
                asserts: vec![
                    Assertion::plain(Form::in_re("s", offender)),
                    Assertion::plain(Form::in_re("s", suppression_language())),
                ],
            },
            Check {
                name: "control-span-cannot".into(),
                expect: Expect::Unsat,
                asserts: vec![
                    Assertion::named("control-pattern-membership", Form::in_re("s", control)),
                    Assertion::named("suppression-directive-membership", Form::in_re("s", suppression_language())),
                ],
            },
        ],
        timeout_s: None,
        expected_summary: "SAT offender, UNSAT control".into(),
    }
}

/// O9 — Word-boundary desugar equivalence (feeds the census).
fn o09() -> Obligation {
    let body = specimen_a_target_body();

    // The intended language: `\b` desugared with the string-edge case included.
    let intended = Re::cat(vec![boundary_prefix(), body.clone(), boundary_suffix()]);
    // Same language, framed with re.comp instead of a union with epsilon.
    let complement_framed = Re::cat(vec![
        boundary_prefix_complement_framed(),
        body.clone(),
        boundary_suffix_complement_framed(),
    ]);
    // The naive desugar: `\b` → "a non-word character", losing the edges.
    let naive = Re::cat(vec![boundary_prefix_naive(), body, boundary_suffix_naive()]);

    Obligation {
        id: "O9".into(),
        class: "regex/string constraints".into(),
        question: "Word-boundary desugar equivalence: is a \\b-desugared RE2 form equivalent to the \
                   intended language on the line alphabet? The test is symmetric-difference \
                   emptiness — UNSAT means equivalent, SAT hands back a distinguishing witness."
            .into(),
        notes: vec![
            "Subject pattern: specimen (a)'s target \
             \\b(?:git\\s+rm|rm)\\s+[^\\n]{0,40}\\.totem/lessons\\.md\\b."
                .into(),
            "Check A compares the intended desugar against a structurally different \
             re.comp-framed form. It is a genuine equivalence proof, and it doubles as the check \
             that lang.rs's hand-enumerated non-word ranges really are the complement of the word \
             class within the alphabet."
                .into(),
            "Check B compares the intended desugar against the NAIVE one that maps \\b to 'a \
             non-word character'. A witness here is the census finding: the shortcut is not \
             language-preserving at line edges."
                .into(),
            "Both checks omit an explicit line-alphabet assertion: every language compared is a \
             subset of the alphabet already, so a string outside it lies in NEITHER side of the \
             xor and cannot be a witness. Equivalence proved here therefore holds on the line \
             alphabet exactly as the table words it."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![
            Check {
                name: "A:intended-equals-complement-framed".into(),
                expect: Expect::Unsat,
                asserts: vec![Assertion::named(
                    "symmetric-difference",
                    Form::xor(
                        Form::in_re("s", intended.clone()),
                        Form::in_re("s", complement_framed),
                    ),
                )],
            },
            Check {
                name: "B:intended-versus-naive-desugar".into(),
                expect: Expect::Measured,
                asserts: vec![Assertion::plain(Form::xor(
                    Form::in_re("s", intended),
                    Form::in_re("s", naive),
                ))],
            },
        ],
        timeout_s: None,
        expected_summary: "UNSAT (equivalent) or witness".into(),
    }
}

/// O10 — Deliberate timeout, fail closed.
fn o10() -> Obligation {
    // Strings over a-z whose length is a multiple of `k`.
    let length_multiple_of = |k: u32| Re::star(Re::loop_(Re::range('a', 'z'), k, k));
    // Strings over a-z of length >= n, spelled without the integer theory so
    // the whole obligation stays inside the regex fragment both arms share.
    let at_least = |n: u32| {
        Re::cat(vec![
            Re::loop_(Re::range('a', 'z'), n, n),
            Re::star(Re::range('a', 'z')),
        ])
    };

    let chain = Re::inter(vec![
        length_multiple_of(3),
        length_multiple_of(7),
        Re::comp(length_multiple_of(5)),
        length_multiple_of(11),
        Re::comp(length_multiple_of(13)),
        at_least(150),
    ]);

    Obligation {
        id: "O10".into(),
        class: "deliberate timeout".into(),
        question: "Deliberate timeout, fail closed: a nested re.inter chain over long ranges \
                   engineered past the budget. The ASSERTION is not about the answer — it is that \
                   the harness reports timeout/unknown and treats the obligation as NOT-PROVEN, \
                   with no pass-through."
            .into(),
        notes: vec![
            "The chain forces a witness whose length is a multiple of 3, 7 and 11 (so of 231), not \
             a multiple of 5 or 13, and at least 150 — a length no string solver reaches by \
             enumeration."
                .into(),
            "Satisfiable in principle at length 231; that is deliberate. A trivially UNSAT \
             instance could be refuted structurally and would not exercise the budget."
                .into(),
            "Per-solver wall budget 10s (z3 -T:10, cvc5 --tlimit=10000). The harness additionally \
             kills the process at a hard outer bound so a solver that ignores its own flag still \
             fails closed."
                .into(),
        ],
        decls: vec!["s".into()],
        checks: vec![Check {
            name: "engineered-past-the-budget".into(),
            expect: Expect::NotProven,
            asserts: vec![Assertion::plain(Form::in_re("s", chain))],
        }],
        timeout_s: Some(10),
        expected_summary: "timeout on >=1 solver".into(),
    }
}
