//! The BINDING arm: the same obligation IR driven through the `z3` crate's C
//! API instead of the SMT-LIB process boundary.
//!
//! OBLIGATIONS.md § Binding notes names this the PRIMARY binding, built against
//! the pinned Z3 5.1.0 release libs rather than a from-source cmake build. Both
//! arms consume `crate::re::{Re, Form}`, so "the API agrees with the CLI" is a
//! statement about one question asked two ways — not about two encodings that
//! happen to share a verdict.

use crate::obligations::Obligation;
#[cfg(feature = "binding-z3")]
use crate::obligations::Expect;
#[cfg(feature = "binding-z3")]
use crate::runner::Status;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BindingOutcome {
    /// `expressed` or `inexpressible(<why>)`, per the deliverable contract.
    pub binding: String,
    pub statuses: Vec<String>,
    pub status_summary: String,
    pub evidence: String,
    pub time_ms: u128,
    /// Whether the API statuses equal the pinned CLI's statuses for the same
    /// obligation. `None` when the arm did not run.
    pub agrees_with_cli: Option<bool>,
}

impl BindingOutcome {
    /// Used only by the no-feature build; kept compiled in both so the two
    /// configurations cannot drift.
    #[cfg_attr(feature = "binding-z3", allow(dead_code))]
    pub fn unavailable(reason: &str) -> BindingOutcome {
        BindingOutcome {
            binding: format!("inexpressible({reason})"),
            statuses: Vec::new(),
            status_summary: "n/a".into(),
            evidence: String::new(),
            time_ms: 0,
            agrees_with_cli: None,
        }
    }
}

#[cfg(not(feature = "binding-z3"))]
pub fn run_all(obligations: &[Obligation]) -> Vec<BindingOutcome> {
    obligations
        .iter()
        .map(|_| BindingOutcome::unavailable("binding-z3 feature not enabled for this build"))
        .collect()
}

#[cfg(feature = "binding-z3")]
pub fn run_all(obligations: &[Obligation]) -> Vec<BindingOutcome> {
    obligations.iter().map(run_one).collect()
}

#[cfg(feature = "binding-z3")]
fn run_one(obligation: &Obligation) -> BindingOutcome {
    use std::time::Instant;

    let started = Instant::now();
    let mut statuses: Vec<Status> = Vec::new();
    let mut evidence: Vec<String> = Vec::new();

    for (index, check) in obligation.checks.iter().enumerate() {
        // A fresh solver per check mirrors the emitted script's push/pop
        // isolation exactly.
        let solver = z3::Solver::new();
        if let Some(seconds) = obligation.timeout_s {
            let mut params = z3::Params::new();
            params.set_u32("timeout", seconds * 1000);
            solver.set_params(&params);
        }

        let vars: Vec<(String, z3::ast::String)> = obligation
            .decls
            .iter()
            .map(|name| (name.clone(), z3::ast::String::new_const(name.as_str())))
            .collect();

        let wants_core = check.expect == Expect::Unsat;
        let mut trackers: Vec<(String, z3::ast::Bool)> = Vec::new();

        for assertion in &check.asserts {
            let formula = build_form(&assertion.form, &vars);
            match (&assertion.label, wants_core) {
                (Some(label), true) => {
                    let tracker = z3::ast::Bool::new_const(label.as_str());
                    solver.assert_and_track(formula, &tracker);
                    trackers.push((label.clone(), tracker));
                }
                _ => solver.assert(&formula),
            }
        }

        let result = solver.check();
        let status = match result {
            z3::SatResult::Sat => Status::Sat,
            z3::SatResult::Unsat => Status::Unsat,
            z3::SatResult::Unknown => {
                let reason = solver.get_reason_unknown().unwrap_or_default();
                if reason.to_lowercase().contains("timeout")
                    || reason.to_lowercase().contains("canceled")
                {
                    Status::Timeout
                } else {
                    Status::Unknown
                }
            }
        };
        statuses.push(status);

        let block = match status {
            Status::Sat => match solver.get_model() {
                Some(model) => {
                    let mut assignments: Vec<String> = Vec::new();
                    for (name, var) in &vars {
                        if let Some(value) = model.eval(var, true).and_then(|v| v.as_string()) {
                            // Rendered as an SMT literal so it is directly
                            // comparable with the CLI arm's normalized model.
                            assignments.push(format!(
                                "{name}={}",
                                crate::re::smt_string_literal(&value)
                            ));
                        }
                    }
                    assignments.sort();
                    assignments.join(" ")
                }
                None => String::new(),
            },
            Status::Unsat if wants_core => {
                let core = solver.get_unsat_core();
                let mut labels: Vec<String> = Vec::new();
                for (label, tracker) in &trackers {
                    if core.iter().any(|c| c == tracker) {
                        labels.push(label.clone());
                    }
                }
                labels.sort();
                labels.join(" ")
            }
            _ => String::new(),
        };
        evidence.push(format!("[{index}:{}] {block}", status.as_str()));
    }

    let status_summary = statuses
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join(";");

    BindingOutcome {
        binding: "expressed".into(),
        statuses: statuses.iter().map(|s| s.as_str().to_string()).collect(),
        status_summary,
        evidence: evidence.join("\n"),
        time_ms: started.elapsed().as_millis(),
        agrees_with_cli: None,
    }
}

#[cfg(feature = "binding-z3")]
fn build_re(re: &crate::re::Re) -> z3::ast::Regexp {
    use crate::re::Re;
    use z3::ast::Regexp;

    match re {
        Re::Str(s) => Regexp::literal(s),
        Re::Range(lo, hi) => Regexp::range(lo, hi),
        Re::Concat(parts) => nary(parts, NaryOp::Concat),
        Re::Union(parts) => nary(parts, NaryOp::Union),
        Re::Inter(parts) => nary(parts, NaryOp::Inter),
        Re::Comp(inner) => build_re(inner).complement(),
        Re::Star(inner) => build_re(inner).star(),
        Re::Plus(inner) => build_re(inner).plus(),
        Re::Loop(inner, lo, hi) => build_re(inner).r#loop(*lo, *hi),
    }
}

#[cfg(feature = "binding-z3")]
enum NaryOp {
    Concat,
    Union,
    Inter,
}

/// The n-ary combinators are generic (`fn concat<T: Into<Self> + Clone>(&[T])`),
/// so they cannot be passed as plain fn pointers; the operation is selected by
/// tag instead. Folding 0 and 1 operand mirrors `re.rs`'s printer exactly, so
/// both arms build the same shape.
#[cfg(feature = "binding-z3")]
fn nary(parts: &[crate::re::Re], op: NaryOp) -> z3::ast::Regexp {
    use z3::ast::Regexp;
    match parts.len() {
        0 => Regexp::literal(""),
        1 => build_re(&parts[0]),
        _ => {
            let built: Vec<Regexp> = parts.iter().map(build_re).collect();
            match op {
                NaryOp::Concat => Regexp::concat(&built),
                NaryOp::Union => Regexp::union(&built),
                NaryOp::Inter => Regexp::intersect(&built),
            }
        }
    }
}

#[cfg(feature = "binding-z3")]
fn build_form(
    form: &crate::re::Form,
    vars: &[(String, z3::ast::String)],
) -> z3::ast::Bool {
    use crate::re::Form;

    let lookup = |name: &str| -> &z3::ast::String {
        &vars
            .iter()
            .find(|(var_name, _)| var_name == name)
            .unwrap_or_else(|| panic!("undeclared variable {name} in obligation formula"))
            .1
    };

    match form {
        Form::InRe(var, re) => lookup(var).regex_matches(&build_re(re)),
        Form::EqLit(var, value) => lookup(var).eq(z3::ast::String::from(value.as_str())),
        Form::Not(inner) => build_form(inner, vars).not(),
        Form::Xor(a, b) => build_form(a, vars).xor(&build_form(b, vars)),
    }
}
