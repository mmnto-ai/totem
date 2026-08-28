//! The SMT-LIB process boundary: run a pinned solver CLI on an obligation and
//! parse its answer.
//!
//! This is simultaneously the replay path OBLIGATIONS.md § Evidence contract
//! asks for ("also replayable via the pinned CLI binaries — the process-boundary
//! fallback posture exercised for free") and, given the cvc5 binding outcome,
//! the challenger arm itself.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::obligations::{Expect, Obligation};

/// The wall budget every obligation without its own explicit one runs under.
///
/// Stated as a real per-solver timeout flag rather than left to the harness's
/// outer kill, so that a `timeout` cell is a REPRODUCIBLE property of the
/// solver at a documented budget and not an artifact of how long the harness
/// happened to wait. O10 overrides it with the contract-mandated 10s.
pub const DEFAULT_BUDGET_SECONDS: u32 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Sat,
    Unsat,
    Unknown,
    Timeout,
    Error,
}

impl Status {
    /// The fail-closed predicate. ONLY `sat` and `unsat` are answers; every
    /// other outcome — timeout, unknown, a solver error — is NOT-PROVEN and
    /// must never pass through as a verdict. O10 exists to test exactly this.
    pub fn is_proven(self) -> bool {
        matches!(self, Status::Sat | Status::Unsat)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Status::Sat => "sat",
            Status::Unsat => "unsat",
            Status::Unknown => "unknown",
            Status::Timeout => "timeout",
            Status::Error => "error",
        }
    }
}

/// Platform-aware pinned-solver resolution (day-14 "build matrix Windows+Linux").
///
/// Precedence: `$<env_var>` (absolute path to the binary, how CI points at its own
/// tools dir) → the per-platform default under `tools`. Both defaults name the
/// asset pinned in `toolchain.lock`; on Windows with no env set this resolves to
/// exactly the path that was previously hardcoded at the call site.
pub fn resolve_solver(env_var: &str, tools: &Path, windows_rel: &str, unix_rel: &str) -> PathBuf {
    match std::env::var(env_var) {
        Ok(value) if !value.is_empty() => PathBuf::from(value),
        _ => tools.join(if cfg!(windows) { windows_rel } else { unix_rel }),
    }
}

#[derive(Debug, Clone)]
pub struct SolverSpec {
    pub name: &'static str,
    pub exe: PathBuf,
    pub version: String,
}

impl SolverSpec {
    pub fn detect(name: &'static str, exe: PathBuf) -> Result<SolverSpec, String> {
        if !exe.exists() {
            return Err(format!("pinned {name} binary not found at {}", exe.display()));
        }
        let out = Command::new(&exe)
            .arg("--version")
            .output()
            .map_err(|e| format!("could not run {}: {e}", exe.display()))?;
        let text = String::from_utf8_lossy(&out.stdout);
        let version = text.lines().next().unwrap_or("<unknown>").trim().to_string();
        Ok(SolverSpec { name, exe, version })
    }

    /// Command-line arguments for one obligation.
    ///
    /// MEASURED dialect divergences encoded here:
    ///   - cvc5 refuses `push`/`pop` without `--incremental`
    ///     ("cannot push when not solving incrementally"); Z3 needs no flag.
    ///   - the timeout flags differ in both spelling and unit: Z3 `-T:<seconds>`,
    ///     cvc5 `--tlimit=<milliseconds>`.
    pub fn args_for(
        &self,
        obligation: &Obligation,
        file: &Path,
        budget_override: Option<u32>,
    ) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        let budget = budget_override
            .or(obligation.timeout_s)
            .unwrap_or(DEFAULT_BUDGET_SECONDS);
        match self.name {
            "z3" => {
                args.push("-smt2".into());
                args.push(format!("-T:{budget}"));
            }
            "cvc5" => {
                args.push("--lang".into());
                args.push("smt2".into());
                if obligation.is_multi_check() {
                    args.push("--incremental".into());
                }
                if obligation.wants_models() {
                    args.push("--produce-models".into());
                }
                if obligation.wants_cores() {
                    args.push("--produce-unsat-cores".into());
                }
                args.push(format!("--tlimit={}", budget * 1000));
            }
            other => panic!("unknown solver {other}"),
        }
        args.push(file.to_string_lossy().to_string());
        args
    }
}

#[derive(Debug, Clone)]
pub struct SolverRun {
    pub raw_output: String,
    pub statuses: Vec<Status>,
    pub evidence_blocks: Vec<String>,
    pub time_ms: u128,
    /// True when the harness's own outer bound had to kill the process — a
    /// solver that ignored its timeout flag. Still NOT-PROVEN.
    pub killed_by_harness: bool,
}

impl SolverRun {
    /// The report's single status cell: the per-check statuses joined in order.
    pub fn status_summary(&self) -> String {
        if self.statuses.is_empty() {
            return Status::Error.as_str().to_string();
        }
        self.statuses.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(";")
    }

    pub fn all_proven(&self) -> bool {
        !self.statuses.is_empty() && self.statuses.iter().all(|s| s.is_proven())
    }

    /// Normalized evidence: countermodels reduced to their string assignments,
    /// unsat cores to a sorted label set. Solver-independent, so it is
    /// comparable across runs (the stability check) without being defeated by
    /// the two solvers' different pretty-printers.
    pub fn normalized_evidence(&self) -> String {
        let mut out = Vec::new();
        for (index, block) in self.evidence_blocks.iter().enumerate() {
            let status = self.statuses.get(index).copied().unwrap_or(Status::Error);
            let normalized = match status {
                Status::Sat => normalize_model(block),
                Status::Unsat => normalize_core(block),
                _ => block.split_whitespace().collect::<Vec<_>>().join(" "),
            };
            out.push(format!("[{index}:{}] {normalized}", status.as_str()));
        }
        out.join("\n")
    }
}

/// Run one solver on one obligation file.
///
/// The outer bound is belt-and-braces over the solver's own timeout flag: the
/// child is killed if it outlives it, so a solver that ignores `-T:`/`--tlimit`
/// cannot wedge the harness or, worse, be silently skipped.
pub fn run(solver: &SolverSpec, obligation: &Obligation, file: &Path) -> SolverRun {
    run_with_budget(solver, obligation, file, None)
}

/// As `run`, with an explicit wall budget in seconds. Used by the capability
/// probe, which re-asks an undecided obligation at a much larger budget to tell
/// "the budget was too small" apart from "this solver cannot do it".
pub fn run_with_budget(
    solver: &SolverSpec,
    obligation: &Obligation,
    file: &Path,
    budget_override: Option<u32>,
) -> SolverRun {
    let args = solver.args_for(obligation, file, budget_override);
    let budget = budget_override
        .or(obligation.timeout_s)
        .unwrap_or(DEFAULT_BUDGET_SECONDS);
    let outer_bound = Duration::from_secs(u64::from(budget) + 20);

    let started = Instant::now();
    let spawned = Command::new(&solver.exe)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn();

    let mut child = match spawned {
        Ok(child) => child,
        Err(err) => {
            return SolverRun {
                raw_output: format!("harness: could not spawn {}: {err}", solver.exe.display()),
                statuses: vec![Status::Error],
                evidence_blocks: Vec::new(),
                time_ms: started.elapsed().as_millis(),
                killed_by_harness: false,
            };
        }
    };

    // Drain both pipes on their own threads: polling try_wait() while the child
    // fills a pipe buffer would deadlock.
    let mut stdout_pipe = child.stdout.take().expect("stdout piped");
    let mut stderr_pipe = child.stderr.take().expect("stderr piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf);
        buf
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    let mut killed_by_harness = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() > outer_bound {
                    let _ = child.kill();
                    let _ = child.wait();
                    killed_by_harness = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
    let time_ms = started.elapsed().as_millis();

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let raw_output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n; ── stderr ──\n{stderr}")
    };

    let (mut statuses, evidence_blocks) = parse_output(&raw_output);
    if killed_by_harness {
        statuses.push(Status::Timeout);
    }
    // A solver that answered fewer times than the file asked is itself a
    // not-proven outcome, never a silent short read.
    //
    // The padding value matters for honesty: a solver that aborted the whole
    // file on a timeout did not ERROR on the remaining checks, it never reached
    // them. Padding those with `error` would invent a defect; `timeout` says
    // what actually happened — undecided within budget.
    let expected_checks = obligation.checks.len();
    let timed_out = killed_by_harness || statuses.contains(&Status::Timeout);
    while statuses.len() < expected_checks {
        statuses.push(if timed_out { Status::Timeout } else { Status::Error });
    }

    SolverRun { raw_output, statuses, evidence_blocks, time_ms, killed_by_harness }
}

/// Parse solver output into the ordered status list and the evidence blocks.
pub fn parse_output(raw: &str) -> (Vec<Status>, Vec<String>) {
    // cvc5 announces a timeout in prose rather than as an SMT-LIB response.
    if raw.contains("interrupted by timeout") {
        return (vec![Status::Timeout], Vec::new());
    }

    let mut statuses = Vec::new();
    let mut evidence = Vec::new();
    for chunk in split_top_level(raw) {
        match chunk.as_str() {
            "sat" => statuses.push(Status::Sat),
            "unsat" => statuses.push(Status::Unsat),
            "unknown" => statuses.push(Status::Unknown),
            "timeout" => statuses.push(Status::Timeout),
            _ => {
                if chunk.starts_with('(') {
                    if chunk.starts_with("(error") {
                        statuses.push(Status::Error);
                    }
                    evidence.push(chunk);
                }
            }
        }
    }
    (statuses, evidence)
}

/// Split solver output into top-level s-expressions and bare tokens, honouring
/// SMT-LIB string literals (where `""` is an escaped quote) and `;` comments.
fn split_top_level(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }
        if ch == ';' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if ch == '(' {
            let start = i;
            let mut depth = 0usize;
            let mut in_string = false;
            while i < chars.len() {
                let c = chars[i];
                if in_string {
                    if c == '"' {
                        if chars.get(i + 1) == Some(&'"') {
                            i += 2;
                            continue;
                        }
                        in_string = false;
                    }
                    i += 1;
                    continue;
                }
                match c {
                    '"' => in_string = true,
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        i += 1;
                        if depth == 0 {
                            break;
                        }
                        continue;
                    }
                    _ => {}
                }
                i += 1;
            }
            chunks.push(chars[start..i.min(chars.len())].iter().collect());
            continue;
        }
        if ch == ')' {
            i += 1;
            continue;
        }
        // A bare token, or a quoted string standing alone.
        let start = i;
        if ch == '"' {
            i += 1;
            while i < chars.len() {
                if chars[i] == '"' {
                    if chars.get(i + 1) == Some(&'"') {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
        } else {
            while i < chars.len()
                && !chars[i].is_whitespace()
                && chars[i] != '('
                && chars[i] != ')'
            {
                i += 1;
            }
        }
        chunks.push(chars[start..i].iter().collect());
    }
    chunks
}

/// Reduce a `(get-model)` block to its String-sorted constant assignments.
///
/// MEASURED divergence this absorbs: with `:produce-unsat-cores` on, Z3's model
/// also carries a `(define-fun <label> () Bool …)` entry for every `:named`
/// assertion, which cvc5 omits. Filtering on the String sort makes the two
/// comparable and keeps the stability check meaningful.
pub fn normalize_model(block: &str) -> String {
    let interior = strip_outer_parens(block);
    let mut assignments: Vec<String> = Vec::new();
    for entry in split_top_level(&interior) {
        if !entry.starts_with('(') {
            continue;
        }
        let tokens = split_top_level(&strip_outer_parens(&entry));
        if tokens.len() >= 5 && tokens[0] == "define-fun" && tokens[3] == "String" {
            assignments.push(format!("{}={}", tokens[1], tokens[4]));
        }
    }
    assignments.sort();
    assignments.join(" ")
}

/// Reduce a `(get-unsat-core)` block to a sorted label set — Z3 prints the core
/// on one line, cvc5 one label per line.
pub fn normalize_core(block: &str) -> String {
    let mut labels: Vec<String> = split_top_level(&strip_outer_parens(block))
        .into_iter()
        .filter(|t| !t.is_empty())
        .collect();
    labels.sort();
    labels.join(" ")
}

fn strip_outer_parens(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.starts_with('(') && trimmed.ends_with(')') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

/// Whether a run's statuses match what the obligation's checks expect.
/// `Expect::Measured` accepts any PROVEN status but never a timeout or error.
pub fn matches_expectation(obligation: &Obligation, run: &SolverRun) -> bool {
    if run.statuses.len() != obligation.checks.len() {
        return false;
    }
    obligation
        .checks
        .iter()
        .zip(&run.statuses)
        .all(|(check, status)| match check.expect {
            Expect::Sat => *status == Status::Sat,
            Expect::Unsat => *status == Status::Unsat,
            Expect::Measured => status.is_proven(),
        })
}
