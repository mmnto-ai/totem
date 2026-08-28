//! Spike 2 harness — solver-neutral proof obligations (spec § "Spike 2").
//!
//! Emits the ten obligations of OBLIGATIONS.md as SMT-LIB2, runs them through
//! BOTH pinned solver CLIs and (when built with `--features binding-z3`) the Z3
//! C API, and writes the evidence, chain and verdict artifacts.
//!
//! Exit code contract: NON-ZERO only on harness defects (missing pinned binary,
//! unwritable artifact directory, unparseable output). An obligation whose
//! measured status differs from the OBLIGATIONS.md table is a FINDING — recorded
//! with its witness, `finding: true`, exit 0. The spike exists to measure, and a
//! harness that exits non-zero on its own findings cannot report them.

mod binding;
mod lang;
mod obligations;
mod re;
mod runner;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use obligations::Expect;
use runner::{SolverRun, SolverSpec, Status};

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Write one evidence file and return the sha256 OF THE BYTES ON DISK.
///
/// The chain's claim is "this hash names that file", so the hash is taken by
/// reading the file back rather than by hashing the in-memory string. Anything
/// that transformed the bytes between the two — a text-mode write, a rewrite by
/// something else — then surfaces as a harness defect instead of producing a
/// plausible-looking chain entry that no one can re-derive.
fn write_evidence(path: &Path, text: &str) -> Result<String, String> {
    fs::write(path, text.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", path.display()))?;
    let on_disk =
        fs::read(path).map_err(|e| format!("could not read back {}: {e}", path.display()))?;
    if on_disk != text.as_bytes() {
        return Err(format!(
            "evidence file {} does not hold the bytes that were written to it; its recorded \
             sha256 would not name its own evidence",
            path.display()
        ));
    }
    Ok(sha256_hex(&on_disk))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SolverCell {
    status: String,
    time_ms: u128,
    evidence_sha256: String,
    evidence_file: String,
    /// Fail-closed flag: true only when every check returned sat or unsat.
    proven: bool,
    killed_by_harness: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObligationRow {
    id: String,
    class: String,
    expected: String,
    expected_holds: bool,
    z3: SolverCell,
    cvc5: SolverCell,
    /// True when the two solvers returned the SAME status sequence.
    agreement: bool,
    /// How the two solvers differ, when they do:
    ///   - `none`          — identical statuses.
    ///   - `capability`    — one solver DECIDED the obligation and the other ran
    ///                       out of budget. Not a semantic conflict: no two
    ///                       answers contradict, one solver simply has no answer.
    ///   - `contradiction` — both decided and the answers CONFLICT. This is the
    ///                       spec's "unexplained solver disagreement" and the
    ///                       only kind that forbids adoption.
    divergence: String,
    /// Whether BOTH solvers decided every check — the precondition for the
    /// agreement criterion, which OBLIGATIONS.md scopes to "every DECIDABLE
    /// obligation".
    decided_by_both: bool,
    binding: String,
    binding_status: String,
    binding_agrees_with_cli: Option<bool>,
    /// The harness's verdict on whether this obligation was DECIDED at all.
    proven: bool,
    /// True for an obligation whose PASS condition is NOT being decided (O10,
    /// the deliberate timeout). Published as a field so downstream filters read
    /// the property instead of re-deriving the intent from the id literal — a
    /// second timeout obligation would silently break every such filter.
    deliberate_timeout: bool,
    finding: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    finding_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    witness: Option<String>,
    smtlib_file: String,
    smtlib_sha256: String,
    obligation_source_sha256: String,
    question: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChainRow {
    id: String,
    solver: String,
    obligation_source_sha256: String,
    smtlib_sha256: String,
    evidence_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StabilityRow {
    id: String,
    solver: String,
    run1_sha256: String,
    run2_sha256: String,
    normalized_run1: String,
    normalized_run2: String,
    stable: bool,
}

/// An obligation one solver could not decide, re-asked at a much larger budget.
///
/// This is what separates "the budget was too small" from "this solver cannot
/// decide this shape". Without it, a `timeout` cell is uninterpretable and the
/// adopt decision would be resting on an arbitrary constant.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityProbe {
    id: String,
    solver: String,
    standard_budget_s: u32,
    extended_budget_s: u32,
    status_at_extended_budget: String,
    time_ms: u128,
    evidence_file: String,
    interpretation: String,
}

/// The binding-maturity record OBLIGATIONS.md § Binding notes asks for:
/// whether each solver's Rust binding builds on Windows against the PINNED
/// libraries, and what the process boundary has to carry when it does not.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BindingMaturityRow {
    solver: String,
    crate_name: String,
    crate_version: String,
    windows_msvc_build: String,
    detail: String,
    consequence: String,
}

fn binding_maturity() -> Vec<BindingMaturityRow> {
    vec![
        BindingMaturityRow {
            solver: "z3".into(),
            crate_name: "z3 (prove-rs), over z3-sys".into(),
            crate_version: "z3 0.20.2 / z3-sys 0.11.0 (Cargo.lock)".into(),
            windows_msvc_build: "BUILDS AND LINKS".into(),
            detail: "Built against the pinned Z3 5.1.0 Windows release with NO from-source cmake \
                     build, exactly as § Binding notes requires: Z3_SYS_Z3_HEADER points at the \
                     release's include/z3.h, and build.rs stages the release's import library into \
                     OUT_DIR under both `libz3.lib` and `z3.lib` (z3-sys 0.11.0 asks the linker \
                     for `libz3.lib`; getting this wrong yields LNK1181). All ten obligations are \
                     expressible through the API — concat/union/intersect/complement/star/plus/ \
                     loop/range/literal all exist on ast::Regexp, assert_and_track + get_unsat_core \
                     supply the core material, and Params `timeout` supplies O10's budget."
                .into(),
            consequence: "The primary binding is viable on Windows. RUNTIME NOTE: libz3.dll must \
                          be on PATH for the built binary — a bare run yields STATUS_DLL_NOT_FOUND \
                          (0xc0000135), which is a packaging obligation, not a build failure."
                .into(),
        },
        BindingMaturityRow {
            solver: "cvc5".into(),
            crate_name: "cvc5 (over cvc5-sys)".into(),
            crate_version: "cvc5 0.4.1 / cvc5-sys 0.4.0 (published, attempted)".into(),
            windows_msvc_build: "DOES NOT BUILD".into(),
            detail: "A published crate exists, so it was attempted. It fails on \
                     x86_64-pc-windows-msvc for TWO INDEPENDENT reasons. (1) cvc5-sys generates \
                     its FFI with bindgen, which aborts: `Unable to find libclang: \"couldn't find \
                     any valid shared libraries matching: ['clang.dll', 'libclang.dll'], set the \
                     LIBCLANG_PATH environment variable...\"`. (2) Even with libclang present, the \
                     crate emits `cargo:rustc-link-lib=dylib=cvc5`, while the PINNED cvc5 1.3.4 \
                     Windows distribution ships only GCC/Clang static archives (lib/libcvc5.a, \
                     libcvc5parser.a, libcadical.a, libgmp.a, libpicpoly*.a) and no MSVC-linkable \
                     import library — a toolchain-format mismatch the crate cannot bridge."
                .into(),
            consequence: "Recorded as the binding-maturity finding § Binding notes anticipates. \
                          The challenger runs through the SMT-LIB process boundary against the \
                          pinned CLI, which is a legitimate spike outcome and is the arm every \
                          cvc5 result in this report came from."
                .into(),
        },
    ]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DialectRow {
    id: String,
    finding: String,
    z3: String,
    cvc5: String,
    portable_encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Assertions {
    /// The spec § Spike 2 criterion, scoped as OBLIGATIONS.md words it: over
    /// obligations BOTH solvers decided, do their answers match?
    solvers_agree_on_every_decidable_obligation: bool,
    /// Obligations where both solvers answered and the answers CONFLICT. A
    /// non-empty list is the spec's FAIL condition ("unexplained solver
    /// disagreement ⇒ no solver adoption").
    contradicting_obligations: Vec<String>,
    /// Obligations exactly one solver could decide within budget. Recorded, not
    /// counted as disagreement — see `verdict_under_strict_reading`.
    capability_divergences: Vec<String>,
    expected_statuses_hold_where_decided: bool,
    obligations_with_findings: Vec<String>,
    o10_not_proven_on_at_least_one_solver: bool,
    o10_treated_as_not_proven_by_harness: bool,
    countermodels_stable_across_two_runs: bool,
    unstable_rows: Vec<String>,
    binding_arm_built: bool,
    /// `None` when the binding arm did not run. A gate reading this field must
    /// not be able to pass on nothing: with no arm there is no agreement to
    /// assert, and `true` would claim evidence the run never produced. Mirrors
    /// each row's `bindingAgreesWithCli`, which is already null for the same
    /// reason.
    binding_arm_agrees_with_cli: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    harness: BTreeMap<String, String>,
    solvers: BTreeMap<String, String>,
    binding_maturity: Vec<BindingMaturityRow>,
    dialect_findings: Vec<DialectRow>,
    obligations: Vec<ObligationRow>,
    capability_probes: Vec<CapabilityProbe>,
    stability: Vec<StabilityRow>,
    assertions: Assertions,
    verdict: String,
    /// The same evidence under the STRICTER reading of the criterion, in which
    /// any status mismatch — a capability divergence included — counts as
    /// disagreement. Surfaced rather than resolved: which reading governs
    /// adoption is a contract question for the dispatching seat, not the
    /// harness's to settle.
    verdict_under_strict_reading: String,
    verdict_notes: Vec<String>,
}

fn main() {
    match run() {
        Ok(()) => {}
        Err(err) => {
            eprintln!("HARNESS DEFECT: {err}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<(), String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let tools = manifest
        .parent()
        .ok_or("crate has no parent directory")?
        .join("tools");
    let obligations_dir = manifest.join("obligations");
    let artifacts_dir = manifest.join("artifacts");
    let evidence_dir = artifacts_dir.join("evidence");
    let probes_dir = artifacts_dir.join("dialect-probes");

    for dir in [&obligations_dir, &artifacts_dir, &evidence_dir, &probes_dir] {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }

    let z3 = SolverSpec::detect(
        "z3",
        runner::resolve_solver(
            "SPIKE_Z3_BIN",
            &tools,
            "z3-5.1.0-x64-win/bin/z3.exe",
            "z3-5.1.0-x64-glibc-2.39/bin/z3",
        ),
    )?;
    let cvc5 = SolverSpec::detect(
        "cvc5",
        runner::resolve_solver(
            "SPIKE_CVC5_BIN",
            &tools,
            "cvc5-Win64-x86_64-static/bin/cvc5.exe",
            "cvc5-Linux-x86_64-static/bin/cvc5",
        ),
    )?;
    println!("z3   : {}", z3.version);
    println!("cvc5 : {}", cvc5.version);
    println!();

    let dialect_findings = probe_dialect(&z3, &cvc5, &probes_dir)?;

    let all = obligations::all();

    // ── Emit ────────────────────────────────────────────────────────────────
    let mut smtlib_paths: Vec<PathBuf> = Vec::new();
    for (index, obligation) in all.iter().enumerate() {
        let path = obligations_dir.join(format!("o{:02}.smt2", index + 1));
        let text = obligation.to_smtlib();
        fs::write(&path, text.as_bytes())
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        smtlib_paths.push(path);
    }
    println!("emitted {} obligations to {}", all.len(), obligations_dir.display());

    // `--emit-only` exists so the DETERMINISM claim is cheap to check: emit,
    // hash, emit again, compare. Emission reads nothing but the obligation
    // definitions — no clock, no environment, no unordered iteration — so two
    // emissions must be byte-identical.
    if std::env::args().any(|a| a == "--emit-only") {
        for (index, path) in smtlib_paths.iter().enumerate() {
            let bytes = fs::read(path).map_err(|e| format!("re-read {}: {e}", path.display()))?;
            println!("o{:02}.smt2 sha256={}", index + 1, sha256_hex(&bytes));
        }
        return Ok(());
    }
    println!();

    // ── Run both CLIs ───────────────────────────────────────────────────────
    let binding_outcomes = binding::run_all(&all);

    let mut rows: Vec<ObligationRow> = Vec::new();
    let mut chains: Vec<ChainRow> = Vec::new();
    let mut stability: Vec<StabilityRow> = Vec::new();
    let mut capability_probes: Vec<CapabilityProbe> = Vec::new();
    // Large enough that "still undecided" is a statement about the solver
    // rather than about the budget.
    const EXTENDED_BUDGET_S: u32 = 120;

    for (index, obligation) in all.iter().enumerate() {
        let smt_path = &smtlib_paths[index];
        let smt_bytes = fs::read(smt_path).map_err(|e| format!("re-read {}: {e}", smt_path.display()))?;
        let smtlib_sha = sha256_hex(&smt_bytes);
        let source_sha = sha256_hex(obligation.canonical_source().as_bytes());

        let mut cells: BTreeMap<&str, (SolverCell, SolverRun)> = BTreeMap::new();
        for solver in [&z3, &cvc5] {
            let run = runner::run(solver, obligation, smt_path);
            let file_name = format!("o{:02}.{}.out", index + 1, solver.name);
            let evidence_path = evidence_dir.join(&file_name);
            let evidence_sha256 = write_evidence(&evidence_path, &run.raw_output)?;
            let cell = SolverCell {
                status: run.status_summary(),
                time_ms: run.time_ms,
                evidence_sha256,
                evidence_file: format!("evidence/{file_name}"),
                proven: run.all_proven(),
                killed_by_harness: run.killed_by_harness,
            };
            chains.push(ChainRow {
                id: obligation.id.clone(),
                solver: solver.name.to_string(),
                obligation_source_sha256: source_sha.clone(),
                smtlib_sha256: smtlib_sha.clone(),
                evidence_sha256: cell.evidence_sha256.clone(),
            });
            cells.insert(solver.name, (cell, run));
        }

        let (z3_cell, z3_run) = cells.remove("z3").expect("z3 cell");
        let (cvc5_cell, cvc5_run) = cells.remove("cvc5").expect("cvc5 cell");

        // ── Stability: two runs, same countermodel ──────────────────────────
        //
        // Scoped PER SOLVER to the runs that actually produced a countermodel:
        // "the countermodel is identical across runs" has no content for a
        // solver that returned none, and re-running a timeout only spends the
        // budget again.
        let sat_expected = obligation.checks.iter().any(|c| c.expect == Expect::Sat);
        for (solver, first) in [(&z3, &z3_run), (&cvc5, &cvc5_run)] {
            let produced_countermodel = first.statuses.contains(&Status::Sat);
            if produced_countermodel || (sat_expected && first.all_proven()) {
                let second = runner::run(solver, obligation, smt_path);
                let file_name = format!("o{:02}.{}.run2.out", index + 1, solver.name);
                let run2_sha256 =
                    write_evidence(&evidence_dir.join(&file_name), &second.raw_output)?;
                let n1 = first.normalized_evidence();
                let n2 = second.normalized_evidence();
                stability.push(StabilityRow {
                    id: obligation.id.clone(),
                    solver: solver.name.to_string(),
                    run1_sha256: sha256_hex(first.raw_output.as_bytes()),
                    run2_sha256,
                    normalized_run1: n1.clone(),
                    normalized_run2: n2.clone(),
                    stable: n1 == n2,
                });
            }
        }

        // ── Classification ──────────────────────────────────────────────────
        let agreement = z3_cell.status == cvc5_cell.status;
        let z3_holds = runner::matches_expectation(obligation, &z3_run);
        let cvc5_holds = runner::matches_expectation(obligation, &cvc5_run);
        let decided_by_both = z3_run.all_proven() && cvc5_run.all_proven();
        let proven = decided_by_both;
        let expected_holds = z3_holds && cvc5_holds;

        // Separate a SEMANTIC conflict from a CAPABILITY limit. Two solvers that
        // answer sat and unsat contradict each other; a solver that answers and
        // one that runs out of budget do not — there is only one answer on the
        // table. The spec forbids adoption on "unexplained solver disagreement",
        // which is the first case.
        let divergence = if agreement {
            "none"
        } else if decided_by_both {
            "contradiction"
        } else {
            "capability"
        };

        // O10 is the deliberate timeout: NOT being decided is its pass
        // condition, so a not-proven O10 is not a finding.
        let is_timeout_obligation = obligation.timeout_s.is_some();
        let finding = if is_timeout_obligation {
            // A finding here means the engineered instance was NOT hard enough.
            decided_by_both
        } else {
            !(z3_holds && cvc5_holds) || !agreement
        };

        let finding_note = if finding && is_timeout_obligation {
            Some(
                "the deliberate-timeout instance was DECIDED by both solvers within budget; \
                 the engineered chain is not past the budget on this hardware"
                    .to_string(),
            )
        } else if finding {
            let mut parts = Vec::new();
            match divergence {
                "contradiction" => parts.push(format!(
                    "SEMANTIC CONTRADICTION — both solvers decided and the answers conflict: \
                     z3={} cvc5={}. This is the spec's no-adoption condition.",
                    z3_cell.status, cvc5_cell.status
                )),
                "capability" => parts.push(format!(
                    "CAPABILITY DIVERGENCE — z3={} cvc5={} at a {}s budget. No two answers \
                     conflict; one solver simply did not decide within budget, so this is not a \
                     semantic disagreement.",
                    z3_cell.status,
                    cvc5_cell.status,
                    obligation.timeout_s.unwrap_or(runner::DEFAULT_BUDGET_SECONDS)
                )),
                _ => {}
            }
            if !z3_holds || !cvc5_holds {
                parts.push(format!(
                    "measured status differs from the OBLIGATIONS.md expectation ({}): z3={} cvc5={}",
                    obligation.expected_summary, z3_cell.status, cvc5_cell.status
                ));
            }
            Some(parts.join(" "))
        } else {
            None
        };

        // ── Capability probe ────────────────────────────────────────────────
        // O10's timeout is deliberate and needs no explanation; every other
        // undecided obligation gets re-asked at the extended budget.
        if divergence == "capability" && !is_timeout_obligation {
            for (solver, run) in [(&z3, &z3_run), (&cvc5, &cvc5_run)] {
                if run.all_proven() {
                    continue;
                }
                let probe =
                    runner::run_with_budget(solver, obligation, smt_path, Some(EXTENDED_BUDGET_S));
                let file_name =
                    format!("o{:02}.{}.extended-{}s.out", index + 1, solver.name, EXTENDED_BUDGET_S);
                write_evidence(&evidence_dir.join(&file_name), &probe.raw_output)?;
                let decided = probe.all_proven();
                capability_probes.push(CapabilityProbe {
                    id: obligation.id.clone(),
                    solver: solver.name.to_string(),
                    standard_budget_s: runner::DEFAULT_BUDGET_SECONDS,
                    extended_budget_s: EXTENDED_BUDGET_S,
                    status_at_extended_budget: probe.status_summary(),
                    time_ms: probe.time_ms,
                    evidence_file: format!("evidence/{file_name}"),
                    interpretation: if decided {
                        "BUDGET-BOUND: the solver decides this obligation given more time, so the \
                         standard budget — not the solver — produced the divergence."
                            .into()
                    } else {
                        "CAPABILITY-BOUND: still undecided at the extended budget, so the \
                         divergence is a property of this solver on this encoding, not of the \
                         budget."
                            .into()
                    },
                });
                println!(
                    "     capability probe {} {} @{}s -> {}",
                    obligation.id,
                    solver.name,
                    EXTENDED_BUDGET_S,
                    probe.status_summary()
                );
            }
        }

        // Only a `sat` answer carries a WITNESS. A timeout or an error block is
        // still evidence — it is on disk and in the chain — but it is not a
        // countermodel, and `normalized_evidence()` renders it as whitespace-
        // joined solver prose, which a non-empty check happily publishes under a
        // field named `witness`. Gating on a proven Sat also stops the row from
        // dropping a countermodel that only the challenger produced.
        let witness = [&z3_run, &cvc5_run]
            .into_iter()
            .filter(|run| run.statuses.contains(&Status::Sat))
            .map(|run| run.normalized_evidence())
            .find(|text| !text.trim().is_empty());

        let binding_outcome = &binding_outcomes[index];
        let binding_agrees = if binding_outcome.binding == "expressed" {
            Some(binding_outcome.status_summary == z3_cell.status)
        } else {
            None
        };

        println!(
            "{:<4} {:<24} z3={:<30} cvc5={:<30} divergence={:<14} {}",
            obligation.id,
            obligation.class,
            format!("{} ({}ms)", z3_cell.status, z3_cell.time_ms),
            format!("{} ({}ms)", cvc5_cell.status, cvc5_cell.time_ms),
            divergence,
            if finding { "FINDING" } else { "" }
        );

        rows.push(ObligationRow {
            id: obligation.id.clone(),
            class: obligation.class.clone(),
            expected: obligation.expected_summary.clone(),
            expected_holds,
            z3: z3_cell,
            cvc5: cvc5_cell,
            agreement,
            divergence: divergence.to_string(),
            decided_by_both,
            binding: binding_outcome.binding.clone(),
            binding_status: binding_outcome.status_summary.clone(),
            binding_agrees_with_cli: binding_agrees,
            proven,
            deliberate_timeout: is_timeout_obligation,
            finding,
            finding_note,
            witness,
            smtlib_file: format!("../obligations/o{:02}.smt2", index + 1),
            smtlib_sha256: smtlib_sha,
            obligation_source_sha256: source_sha,
            question: obligation.question.clone(),
        });
    }

    // ── Assertions ──────────────────────────────────────────────────────────
    let o10 = rows.iter().find(|r| r.id == "O10").ok_or("O10 row missing")?;
    let o10_not_proven_somewhere = !o10.z3.proven || !o10.cvc5.proven;

    let contradicting: Vec<String> = rows
        .iter()
        .filter(|r| r.divergence == "contradiction")
        .map(|r| r.id.clone())
        .collect();
    let capability: Vec<String> = rows
        .iter()
        .filter(|r| r.divergence == "capability" && !r.deliberate_timeout)
        .map(|r| format!("{} (z3={} cvc5={})", r.id, r.z3.status, r.cvc5.status))
        .collect();
    let with_findings: Vec<String> = rows
        .iter()
        .filter(|r| r.finding)
        .map(|r| r.id.clone())
        .collect();
    let unstable: Vec<String> = stability
        .iter()
        .filter(|s| !s.stable)
        .map(|s| format!("{}/{}", s.id, s.solver))
        .collect();

    let binding_built = rows.iter().all(|r| r.binding == "expressed");
    let rows_agree = rows
        .iter()
        .all(|r| r.binding_agrees_with_cli.unwrap_or(true));
    let binding_agrees: Option<bool> = if binding_built {
        Some(rows_agree)
    } else {
        // No arm ran, so there is no agreement to report — and reporting one
        // would let a gate pass on evidence that does not exist.
        None
    };

    let assertions = Assertions {
        solvers_agree_on_every_decidable_obligation: contradicting.is_empty(),
        contradicting_obligations: contradicting.clone(),
        capability_divergences: capability.clone(),
        expected_statuses_hold_where_decided: rows
            .iter()
            .all(|r| r.expected_holds || r.deliberate_timeout || !r.decided_by_both),
        obligations_with_findings: with_findings.clone(),
        o10_not_proven_on_at_least_one_solver: o10_not_proven_somewhere,
        o10_treated_as_not_proven_by_harness: !o10.proven,
        countermodels_stable_across_two_runs: unstable.is_empty(),
        unstable_rows: unstable.clone(),
        binding_arm_built: binding_built,
        binding_arm_agrees_with_cli: binding_agrees,
    };

    let pass = assertions.solvers_agree_on_every_decidable_obligation
        && assertions.o10_not_proven_on_at_least_one_solver
        && assertions.o10_treated_as_not_proven_by_harness
        && assertions.countermodels_stable_across_two_runs
        // An arm that did not run cannot fail the criterion, so `None` is not a
        // failure here — but it is not an assertion of agreement either, which
        // is why the published field stays null.
        && binding_agrees.unwrap_or(true);

    // Under the strict reading, any status mismatch counts against the
    // criterion, capability divergences included.
    let pass_strict = pass && capability.is_empty();

    let mut verdict_notes = Vec::new();
    if !with_findings.is_empty() {
        verdict_notes.push(format!(
            "findings recorded on: {} — see each row's findingNote",
            with_findings.join(", ")
        ));
    }
    if !capability.is_empty() {
        verdict_notes.push(format!(
            "CONTRACT QUESTION for the dispatching seat: {} obligation(s) were decided by exactly \
             one solver — {}. OBLIGATIONS.md scopes the criterion to \"every DECIDABLE \
             obligation\" and the spec's FAIL is \"unexplained solver DISAGREEMENT\", so the \
             harness records these as capability divergences rather than disagreements and the \
             headline verdict follows that reading. Under the stricter reading (any status \
             mismatch counts) the verdict is {}. The harness does not settle which reading \
             governs adoption.",
            capability.len(),
            capability.join(", "),
            if pass_strict { "PASS" } else { "FAIL" }
        ));
    }
    for probe in &capability_probes {
        verdict_notes.push(format!(
            "capability probe — {} on {} at {}s: {} ({})",
            probe.id,
            probe.solver,
            probe.extended_budget_s,
            probe.status_at_extended_budget,
            probe.interpretation.split(':').next().unwrap_or("").trim()
        ));
    }
    if !binding_built {
        verdict_notes.push(
            "the z3 binding arm did not run in this build; re-run with --features binding-z3"
                .to_string(),
        );
    }
    verdict_notes.push(
        "PASS/FAIL is the spec § Spike 2 criterion set, not a judgement on adoption: a pass \
         adopts nothing by itself."
            .to_string(),
    );

    let mut harness = BTreeMap::new();
    harness.insert("crate".into(), env!("CARGO_PKG_NAME").to_string());
    harness.insert("crateVersion".into(), env!("CARGO_PKG_VERSION").to_string());
    harness.insert(
        "bindingFeature".into(),
        if cfg!(feature = "binding-z3") { "enabled".into() } else { "disabled".into() },
    );

    let mut solvers = BTreeMap::new();
    solvers.insert("z3".to_string(), z3.version.clone());
    solvers.insert("cvc5".to_string(), cvc5.version.clone());

    let report = Report {
        harness,
        solvers,
        binding_maturity: binding_maturity(),
        dialect_findings,
        obligations: rows,
        capability_probes,
        stability,
        assertions,
        verdict: if pass { "PASS".into() } else { "FAIL".into() },
        verdict_under_strict_reading: if pass_strict { "PASS".into() } else { "FAIL".into() },
        verdict_notes,
    };

    verify_evidence_chain(&artifacts_dir, &report.obligations, &chains)?;

    write_json(&artifacts_dir.join("obligations-report.json"), &report)?;
    write_json(&artifacts_dir.join("chains.json"), &chains)?;

    println!();
    println!("verdict: {}", report.verdict);
    for note in &report.verdict_notes {
        println!("  - {note}");
    }
    println!();
    println!("artifacts: {}", artifacts_dir.display());
    Ok(())
}

/// Re-derive every recorded evidence hash from the file it names.
///
/// The report's claim is that `evidenceSha256` is the sha256 of `evidenceFile`.
/// This checks that claim against the bytes on disk at the end of the run, so a
/// chain nobody can re-derive is a HARNESS DEFECT (exit non-zero) rather than a
/// plausible-looking artifact. Two hashes coinciding is NOT a defect and is not
/// flagged here: two runs that produced byte-identical output legitimately share
/// an evidence hash — what must never happen is a hash that names no file.
fn verify_evidence_chain(
    artifacts_dir: &Path,
    rows: &[ObligationRow],
    chains: &[ChainRow],
) -> Result<(), String> {
    let mut recorded: Vec<(String, String, String)> = Vec::new();
    for row in rows {
        for (solver, cell) in [("z3", &row.z3), ("cvc5", &row.cvc5)] {
            recorded.push((
                format!("{}/{solver}", row.id),
                cell.evidence_file.clone(),
                cell.evidence_sha256.clone(),
            ));
        }
    }

    for (label, file, expected) in &recorded {
        let path = artifacts_dir.join(file);
        let bytes = fs::read(&path).map_err(|e| format!("{label}: cannot read {file}: {e}"))?;
        let actual = sha256_hex(&bytes);
        if &actual != expected {
            return Err(format!(
                "{label}: recorded evidenceSha256 {expected} does not name {} (sha256 {actual})",
                path.display()
            ));
        }
    }

    // The chain artifact copies those hashes; check it did not drift from them.
    for chain in chains {
        let label = format!("{}/{}", chain.id, chain.solver);
        let matched = recorded
            .iter()
            .any(|(row_label, _, sha)| row_label == &label && sha == &chain.evidence_sha256);
        if !matched {
            return Err(format!(
                "{label}: chains.json evidenceSha256 {} does not match the report row",
                chain.evidence_sha256
            ));
        }
    }

    let count = recorded.len();
    println!("evidence chain: {count} hashes re-derived from disk");
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("could not serialize {}: {e}", path.display()))?;
    fs::write(path, format!("{text}\n"))
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Live dialect probes.
///
/// These are MEASURED at harness time rather than asserted from memory: each
/// probe is a real `.smt2` file run through both pinned CLIs, and its artifacts
/// stay on disk for replay. The encodings in `re.rs`/`runner.rs` are shaped by
/// exactly these results.
fn probe_dialect(
    z3: &SolverSpec,
    cvc5: &SolverSpec,
    dir: &Path,
) -> Result<Vec<DialectRow>, String> {
    // Wall budget for a dialect probe. The probe scripts are three lines each,
    // so this is an outer bound, not a working budget.
    const PROBE_BUDGET_S: u32 = 10;

    let tab = char::from(9u8);

    // Probe 1 — a RAW control byte inside a string literal.
    let raw_tab = format!(
        "(set-logic QF_SLIA)\n(declare-const s String)\n(assert (= s \"a{tab}b\"))\n(check-sat)\n"
    );
    // Probe 2 — the same string via the \u{9} escape (backslash built from its
    // code point so no escape-shaped text is authored into this file).
    let escaped = format!(
        "(set-logic QF_SLIA)\n(declare-const s String)\n(assert (= s \"a{}u{{9}}b\"))\n(check-sat)\n",
        char::from(92u8)
    );
    // Probe 3 — push/pop without any incrementality flag.
    let push_pop = "(set-logic QF_SLIA)\n(declare-const s String)\n(push 1)\n(assert (= s \"a\"))\n(check-sat)\n(pop 1)\n(check-sat)\n".to_string();

    // MACHINE-PATH REDACTION, applied at the CAPTURE point so every recorded
    // string is covered by construction: cvc5 echoes the absolute script path in
    // its parse errors, and that text becomes both a `.out` replay file and a
    // D-row cell in the committed report. Redacting downstream would mean
    // remembering to do it at each recorder; redacting here means a new recorder
    // cannot reintroduce the leak.
    //
    // `dir` is `<root>/spikes/spine-adopt/smt/artifacts/dialect-probes`, so its
    // 5th ancestor is the worktree root. A missing ancestor is a HARNESS DEFECT
    // rather than a silent pass-through — silence there would publish the
    // author's directory layout into a committed artifact.
    let worktree_root = dir
        .ancestors()
        .nth(5)
        .ok_or_else(|| {
            format!(
                "cannot derive the worktree root from the probes directory {} — refusing to \
                 record solver output that may carry an absolute path",
                dir.display()
            )
        })?
        .to_string_lossy()
        .to_string();
    // Both separator spellings: the solver echoes the path in the form it was
    // given (native), but nothing guarantees a future solver prints it that way.
    let worktree_root_slashed = worktree_root.replace('\\', "/");
    let redact = |text: &str| -> String {
        let mut out = text.replace(&worktree_root, "<worktree>");
        if worktree_root_slashed != worktree_root {
            out = out.replace(&worktree_root_slashed, "<worktree>");
        }
        out
    };

    let mut results: BTreeMap<&str, (String, String)> = BTreeMap::new();
    for (name, body) in [
        ("raw-control-byte", &raw_tab),
        ("unicode-escape", &escaped),
        ("push-pop-no-flags", &push_pop),
    ] {
        let path = dir.join(format!("{name}.smt2"));
        fs::write(&path, body).map_err(|e| format!("write probe {name}: {e}"))?;
        let mut answers = Vec::new();
        for solver in [z3, cvc5] {
            // The probes run BEFORE any obligation and call `.output()`, which
            // blocks until the child exits — so unlike `runner::run_with_budget`
            // there is no outer kill behind them. They therefore carry the
            // solver's own timeout flag: a probe that did not terminate would
            // otherwise wedge the whole harness with no artifacts written.
            let out = std::process::Command::new(&solver.exe)
                .args(match solver.name {
                    "z3" => vec![
                        "-smt2".to_string(),
                        format!("-T:{PROBE_BUDGET_S}"),
                        path.to_string_lossy().to_string(),
                    ],
                    _ => vec![
                        "--lang".to_string(),
                        "smt2".to_string(),
                        format!("--tlimit={}", PROBE_BUDGET_S * 1000),
                        path.to_string_lossy().to_string(),
                    ],
                })
                .output()
                .map_err(|e| format!("probe {name} on {}: {e}", solver.name))?;
            let text = redact(&runner::normalize_line_endings(&format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )));
            let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("<no output>");
            answers.push(first.trim().to_string());
            fs::write(dir.join(format!("{name}.{}.out", solver.name)), text.as_bytes())
                .map_err(|e| format!("write probe output: {e}"))?;
        }
        results.insert(name, (answers[0].clone(), answers[1].clone()));
    }

    let (raw_z3, raw_cvc5) = results["raw-control-byte"].clone();
    let (esc_z3, esc_cvc5) = results["unicode-escape"].clone();
    let (pp_z3, pp_cvc5) = results["push-pop-no-flags"].clone();

    // D1 and D2 report on the two probes whose cells are MEASURED, so their
    // prose is DERIVED from those same two answers rather than asserted beside
    // them. Fixed text would let a pinned-solver update publish a claim the
    // cells next to it contradict — the exact failure the module doc rules out.
    //
    // The prose reports the CLASSIFICATION of each answer, not the answer
    // verbatim: the raw text is already in the cell beside it, and a solver's
    // parse error carries the script path (redacted to `<worktree>` above, but
    // still noise), which has no business being duplicated into the finding.
    let verdict = |answer: &str| {
        if answer.starts_with("(error") {
            "REJECTED it"
        } else if matches!(answer, "sat" | "unsat" | "unknown") {
            "ACCEPTED it"
        } else {
            "gave an unclassified answer"
        }
    };
    let agreement = |a: &str, b: &str| {
        if verdict(a) == verdict(b) {
            "AGREE"
        } else {
            "DIVERGE"
        }
    };
    let d1_finding = format!(
        "probe — is a RAW control byte inside an SMT-LIB string literal accepted? MEASURED: z3 {}, \
         cvc5 {}; the two solvers {} (raw answers in the cells beside this one).",
        verdict(&raw_z3),
        verdict(&raw_cvc5),
        agreement(&raw_z3, &raw_cvc5)
    );
    let d2_finding = format!(
        "probe — is push/pop accepted with NO incrementality flag? MEASURED: z3 {}, cvc5 {}; the \
         two solvers {} (raw answers in the cells beside this one).",
        verdict(&pp_z3),
        verdict(&pp_cvc5),
        agreement(&pp_z3, &pp_cvc5)
    );

    let mut rows = vec![
        DialectRow {
            id: "D1".into(),
            finding: d1_finding,
            z3: raw_z3,
            cvc5: raw_cvc5,
            portable_encoding: format!(
                "emit every non-printable character in {}u{{...}} form (re.rs::smt_string_literal); \
                 measured portable: z3={esc_z3} cvc5={esc_cvc5}",
                char::from(92u8)
            ),
        },
        DialectRow {
            id: "D2".into(),
            finding: d2_finding,
            z3: pp_z3,
            cvc5: pp_cvc5,
            portable_encoding: "the harness passes --incremental to cvc5 whenever an obligation \
                                emits more than one check-sat (runner.rs::args_for)"
                .into(),
        },
        DialectRow {
            id: "D3".into(),
            finding: "timeout is expressed and REPORTED differently: z3 -T:<seconds> answers with \
                      the token `timeout`; cvc5 --tlimit=<ms> answers with the prose line \
                      `cvc5 interrupted by timeout.`"
                .into(),
            z3: "-T:<seconds>, prints `timeout`".into(),
            cvc5: "--tlimit=<milliseconds>, prints `cvc5 interrupted by timeout.`".into(),
            portable_encoding: "runner.rs::parse_output normalizes both to Status::Timeout, which \
                                is NOT-PROVEN under Status::is_proven"
                .into(),
        },
        DialectRow {
            id: "D4".into(),
            finding: "evidence layout differs: with :produce-unsat-cores enabled z3's (get-model) \
                      also defines a Bool for every :named assertion, which cvc5 omits; unsat \
                      cores print on one line (z3) versus one label per line (cvc5)"
                .into(),
            z3: "model carries `(define-fun <label> () Bool ...)`; core on a single line".into(),
            cvc5: "model carries only the declared constants; core one label per line".into(),
            portable_encoding: "runner.rs::normalize_model keeps only String-sorted assignments \
                                and normalize_core sorts the label set"
                .into(),
        },
        DialectRow {
            id: "D6".into(),
            finding: "ENCODING SENSITIVITY, not a syntax divergence — and the sharpest result of \
                      this arm. Adding a LOGICALLY REDUNDANT assertion (a line-alphabet membership \
                      already implied by the pattern membership beside it) changes no model, yet \
                      moves cvc5 from deciding O7 in ~34ms to NOT deciding it at a 300-second \
                      budget. z3 is indifferent to the same edit."
                .into(),
            z3: "~23ms sat with or without the redundant assertion".into(),
            cvc5: "~34ms sat without it; undecided at 300s with it".into(),
            portable_encoding: "obligations.rs enforces the REDUNDANT-ASSERTION rule: never emit \
                                an assertion implied by another in the same check. O9 is the \
                                control — the same removal does NOT rescue cvc5 there, so that \
                                obligation's cost is intrinsic, not encoding-induced."
                .into(),
        },
        DialectRow {
            id: "D5".into(),
            finding: "(_ re.loop lo hi) sits OUTSIDE the construct subset OBLIGATIONS.md names, \
                      but is accepted by BOTH pinned solvers — measured, not assumed. It is used \
                      for the {0,40} bound in specimen (a) and for O10's length ladders."
                .into(),
            z3: "accepted".into(),
            cvc5: "accepted".into(),
            portable_encoding: "no adaptation needed; recorded so the subset claim stays honest"
                .into(),
        },
    ];
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}
