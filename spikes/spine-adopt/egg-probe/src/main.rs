//! egg e-graph probe driver — "egg proposes, Z3 disposes".
//!
//! Contract: `spikes/spine-adopt/egg-probe/DESIGN.md`. Everything this binary
//! writes lands under `egg-probe/artifacts/`. It reads the census artifact, the
//! four rule corpora (integrity cross-check only), and the PINNED z3 CLI.
//! It never touches `smt/`, `host/`, `src/`, or the spike-root `artifacts/`.
//!
//! The three-criteria verdict is COMPUTED from the measurements at the bottom
//! of `main`, never asserted.

mod ast;
mod charset;
mod ir;
mod rules;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use egg::{AstSize, CostFunction, EGraph, Extractor, Id, RecExpr, Runner};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use ir::{desugar, pretty, to_smt, DesugarNotes, ReLang};

const TARGET_CLASSES: [&str; 2] = ["re2-clean", "word-boundary"];
const EXPECTED_ROWS: usize = 177;
const SATURATION_BUDGET: Duration = Duration::from_secs(60);
const Z3_TIMEOUT_SECS: u64 = 30;
const SAMPLE_SIZE: usize = 20;
/// Per-platform pinned-z3 assets, both from `spikes/spine-adopt/toolchain.lock`
/// (`[z3]` and `[z3.linux]`), relative to `spikes/spine-adopt/tools/`.
const Z3_REL_WINDOWS: &str = "z3-5.1.0-x64-win/bin/z3.exe";
const Z3_REL_UNIX: &str = "z3-5.1.0-x64-glibc-2.39/bin/z3";
const Z3_BIN_ENV: &str = "SPIKE_Z3_BIN";

/// Resolve the PINNED z3 CLI for the host platform.
///
/// Precedence, mirroring the sibling `smt/src/runner.rs::resolve_solver`:
/// `$SPIKE_Z3_BIN` (an absolute path — how CI points at its own tools dir) →
/// the per-platform default under `spikes/spine-adopt/tools/`. The precedence
/// is REIMPLEMENTED here rather than imported because DESIGN § Boundaries says
/// this crate does not depend on `smt/`. On Windows with no env set this
/// resolves to exactly the path that used to be hardcoded at the call site.
///
/// Returns `(path to run, path as recorded in the report, how it resolved)`.
fn resolve_z3() -> (PathBuf, String, String) {
    let rel = if cfg!(windows) {
        Z3_REL_WINDOWS
    } else {
        Z3_REL_UNIX
    };
    match std::env::var(Z3_BIN_ENV) {
        Ok(value) if !value.is_empty() => (
            PathBuf::from(&value),
            value,
            format!("${Z3_BIN_ENV} (explicit override)"),
        ),
        _ => (
            spike_root().join("tools").join(rel),
            format!("spikes/spine-adopt/tools/{rel}"),
            format!(
                "per-platform default under spikes/spine-adopt/tools ({} host, ${Z3_BIN_ENV} unset)",
                std::env::consts::OS
            ),
        ),
    }
}

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}
fn spike_root() -> PathBuf {
    crate_root().parent().expect("spike root").to_path_buf()
}
fn repo_root() -> PathBuf {
    spike_root()
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

struct Row {
    index: usize,
    rule_hash: String,
    corpus: String,
    class: String,
    pattern: String,
    pattern_sha256: String,
}

struct Parsed {
    row: usize,
    original: RecExpr<ReLang>,
    notes: DesugarNotes,
}

struct Saturated {
    canonical: RecExpr<ReLang>,
    canonical_key: String,
    cost: usize,
    stop_reason: String,
    iterations: usize,
    wall_ms: u128,
    nodes: usize,
    classes: usize,
    applied: BTreeMap<String, usize>,
}

fn main() {
    let out_dir = crate_root().join("artifacts");
    let verif_dir = out_dir.join("verification");
    fs::create_dir_all(&verif_dir).expect("create artifacts/verification");

    // ── inputs ──────────────────────────────────────────────────────────────
    let census_path = spike_root().join("artifacts/expressibility-census.json");
    let census_raw =
        fs::read_to_string(&census_path).expect("read expressibility-census.json");
    let (census_text, replaced) = sanitize_lone_surrogates(&census_raw);
    let census: Value = serde_json::from_str(&census_text).expect("parse census");

    let rows = load_rows(&census);
    assert_eq!(
        rows.len(),
        EXPECTED_ROWS,
        "census target rows must be the 177 RE2-expressible patterns"
    );

    let integrity = corpora_integrity(&census, &rows);

    let (z3_path, z3_path_recorded, z3_resolved_from) = resolve_z3();
    assert!(
        z3_path.exists(),
        "pinned z3 not found at {} — resolved from {z3_resolved_from}; provision the \
         asset pinned in spikes/spine-adopt/toolchain.lock or point ${Z3_BIN_ENV} at it",
        z3_path.display()
    );

    let egg_version = locked_version("egg").expect("egg version from Cargo.lock");

    // ── dialect probe (guard rail: probe before using re.opt / re.loop) ─────
    let dialect = dialect_probe(&z3_path, &verif_dir);

    // ── 1. parse ────────────────────────────────────────────────────────────
    let mut parsed: Vec<Parsed> = Vec::new();
    let mut unparsed: Vec<Value> = Vec::new();
    for row in &rows {
        match ast::parse(&row.pattern).and_then(|a| desugar(&a)) {
            Ok((re, notes)) => parsed.push(Parsed {
                row: row.index,
                original: re.to_recexpr(),
                notes,
            }),
            Err(e) => unparsed.push(json!({
                "ruleHash": row.rule_hash,
                "corpus": row.corpus,
                "class": row.class,
                "pattern": row.pattern,
                "reason": e.kind,
                "detail": e.detail,
            })),
        }
    }
    assert_eq!(
        parsed.len() + unparsed.len(),
        EXPECTED_ROWS,
        "DESIGN § Method 1: parsed + unparsed must equal 177"
    );

    let mut unparsed_by_kind: BTreeMap<String, usize> = BTreeMap::new();
    for u in &unparsed {
        *unparsed_by_kind
            .entry(u["reason"].as_str().unwrap().to_string())
            .or_default() += 1;
    }

    // ── 2/3. saturate ───────────────────────────────────────────────────────
    let (rw, docs) = rules::ruleset();
    write_ruleset(&out_dir, &docs);

    // (a) per-pattern saturation — DESIGN § Method 3 ("Saturate per pattern").
    let per_pattern_start = Instant::now();
    let mut sats: Vec<Saturated> = Vec::with_capacity(parsed.len());
    for p in &parsed {
        let t0 = Instant::now();
        let runner = Runner::<ReLang, ()>::default()
            .with_time_limit(SATURATION_BUDGET)
            .with_expr(&p.original)
            .run(&rw);
        let wall_ms = t0.elapsed().as_millis();
        let extractor = Extractor::new(&runner.egraph, AstSize);
        let (cost, canonical) = extractor.find_best(runner.roots[0]);
        let mut applied: BTreeMap<String, usize> = BTreeMap::new();
        for it in &runner.iterations {
            for (name, n) in it.applied.iter().map(|(k, v)| (k, *v)) {
                *applied.entry(name.to_string()).or_default() += n;
            }
        }
        sats.push(Saturated {
            canonical_key: canonical.to_string(),
            canonical,
            cost,
            stop_reason: format!("{:?}", runner.stop_reason),
            iterations: runner.iterations.len(),
            wall_ms,
            nodes: runner.egraph.total_number_of_nodes(),
            classes: runner.egraph.number_of_classes(),
            applied,
        });
    }
    let per_pattern_wall_ms = per_pattern_start.elapsed().as_millis();

    // (b) congruence-only grouping: hash-consing + the canonical class
    // representation, with NO rewrite applied. This is the control that says
    // which merges egg's REWRITING earned and which a plain typed IR with
    // canonical char-sets would already have.
    let mut cong = EGraph::<ReLang, ()>::default();
    let cong_ids: Vec<Id> = parsed.iter().map(|p| cong.add_expr(&p.original)).collect();
    cong.rebuild();
    let cong_class: Vec<Id> = cong_ids.iter().map(|i| cong.find(*i)).collect();

    // (c) supplementary: ONE shared e-graph over the whole corpus.
    let shared_start = Instant::now();
    let mut shared_runner = Runner::<ReLang, ()>::default().with_time_limit(SATURATION_BUDGET);
    for p in &parsed {
        shared_runner = shared_runner.with_expr(&p.original);
    }
    let shared_runner = shared_runner.run(&rw);
    let shared_wall_ms = shared_start.elapsed().as_millis();
    let shared_class: Vec<Id> = shared_runner
        .roots
        .iter()
        .map(|i| shared_runner.egraph.find(*i))
        .collect();
    let mut shared_applied: BTreeMap<String, usize> = BTreeMap::new();
    for it in &shared_runner.iterations {
        for (name, n) in it.applied.iter() {
            *shared_applied.entry(name.to_string()).or_default() += n;
        }
    }

    // ── syntactic baseline (DESIGN criterion 2) ─────────────────────────────
    // "naive syntactic dedup (exact string match after whitespace
    // normalization)": collapse every run of ASCII whitespace in the pattern
    // SOURCE to one space and trim.
    let norm = |s: &str| -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") };
    let mut syn_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for row in &rows {
        syn_groups.entry(norm(&row.pattern)).or_default().push(row.index);
    }
    let syntactic_distinct_all = syn_groups.len();
    let mut syn_of_row: BTreeMap<usize, String> = BTreeMap::new();
    for (k, v) in &syn_groups {
        for r in v {
            syn_of_row.insert(*r, k.clone());
        }
    }
    let syntactic_distinct_parsed: usize = parsed
        .iter()
        .map(|p| syn_of_row[&p.row].clone())
        .collect::<BTreeSet<_>>()
        .len();

    // ── grouping ────────────────────────────────────────────────────────────
    let mut canon_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, s) in sats.iter().enumerate() {
        canon_groups.entry(s.canonical_key.clone()).or_default().push(i);
    }
    let mut shared_groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, c) in shared_class.iter().enumerate() {
        shared_groups.entry(usize::from(*c)).or_default().push(i);
    }
    let mut cong_groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, c) in cong_class.iter().enumerate() {
        cong_groups.entry(usize::from(*c)).or_default().push(i);
    }

    // ── merge set: every cross-pattern pair either grouping claims equal ────
    let mut pairs: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut source_of: BTreeMap<(usize, usize), BTreeSet<&'static str>> = BTreeMap::new();
    let add_pairs = |members: &Vec<usize>,
                         tag: &'static str,
                         pairs: &mut BTreeSet<(usize, usize)>,
                         source_of: &mut BTreeMap<(usize, usize), BTreeSet<&'static str>>| {
        for a in 0..members.len() {
            for b in (a + 1)..members.len() {
                let key = (members[a].min(members[b]), members[a].max(members[b]));
                pairs.insert(key);
                source_of.entry(key).or_default().insert(tag);
            }
        }
    };
    for m in canon_groups.values() {
        if m.len() > 1 {
            add_pairs(m, "per-pattern-canonical-form", &mut pairs, &mut source_of);
        }
    }
    for m in shared_groups.values() {
        if m.len() > 1 {
            add_pairs(m, "shared-egraph-eclass", &mut pairs, &mut source_of);
        }
    }

    // ── deterministic 20-pair sample, seeded from pattern hashes ────────────
    // Ordering key: sha256 of the pattern text, ascending. Selection is then by
    // EVIDENCE CLASS, strongest first, because a pair whose two sides SERIALIZE
    // identically makes the emitted query `xor(R, R)` — a tautology whose UNSAT
    // says nothing about the rewriting:
    //   1. `rewrite-evidence`    — canonical differs from the original AND the
    //      two sides serialize differently, so z3 is asked a real question;
    //   2. `representation-only` — the canonical differs as an e-graph TERM but
    //      serializes byte-identically (the equality was decided by the IR
    //      representation — canonical char-class sets, printer flattening —
    //      not by a rewrite);
    //   3. `no-rewrite`          — the extracted canonical IS the original.
    // Within each class, the same hash order. No RNG, no timestamps.
    let mut order: Vec<usize> = (0..parsed.len()).collect();
    order.sort_by(|a, b| {
        rows[parsed[*a].row]
            .pattern_sha256
            .cmp(&rows[parsed[*b].row].pattern_sha256)
    });
    let differs = |i: usize| sats[i].canonical_key != parsed[i].original.to_string();
    let evidence_class = |i: usize| -> &'static str {
        if !differs(i) {
            "no-rewrite"
        } else if to_smt(&parsed[i].original) == to_smt(&sats[i].canonical) {
            "representation-only"
        } else {
            "rewrite-evidence"
        }
    };
    const EVIDENCE_CLASSES: [&str; 3] = ["rewrite-evidence", "representation-only", "no-rewrite"];
    let mut by_evidence_class: BTreeMap<&'static str, Vec<usize>> = BTreeMap::new();
    for i in order.iter().copied() {
        by_evidence_class
            .entry(evidence_class(i))
            .or_default()
            .push(i);
    }
    let available = |class: &str| by_evidence_class.get(class).map_or(0, Vec::len);
    let rewritten_available = available("rewrite-evidence") + available("representation-only");
    let mut sample: Vec<usize> = Vec::with_capacity(SAMPLE_SIZE);
    for class in EVIDENCE_CLASSES {
        for i in by_evidence_class.get(class).into_iter().flatten().copied() {
            if sample.len() >= SAMPLE_SIZE {
                break;
            }
            sample.push(i);
        }
    }

    // ── verification pass ───────────────────────────────────────────────────
    let mut merge_reports: Vec<Value> = Vec::new();
    let mut all_verdicts: Vec<String> = Vec::new();
    // A query whose two sides print byte-identically is a TAUTOLOGY: its UNSAT
    // carries no evidential weight. Counted so criterion 1 can be read honestly.
    let mut trivial_queries = 0usize;

    let mut ordered_pairs: Vec<(usize, usize)> = pairs.iter().copied().collect();
    ordered_pairs.sort_by(|x, y| {
        let kx = (
            &rows[parsed[x.0].row].pattern_sha256,
            &rows[parsed[x.1].row].pattern_sha256,
        );
        let ky = (
            &rows[parsed[y.0].row].pattern_sha256,
            &rows[parsed[y.1].row].pattern_sha256,
        );
        kx.cmp(&ky)
    });

    for (n, (a, b)) in ordered_pairs.iter().enumerate() {
        let ra = &rows[parsed[*a].row];
        let rb = &rows[parsed[*b].row];
        let name = format!(
            "merge-{:03}-{}-{}",
            n,
            &ra.pattern_sha256[..8],
            &rb.pattern_sha256[..8]
        );
        let header = format!(
            "; MERGE CHECK — two corpus patterns egg placed in one equivalence class.\n\
             ;   A = {}   ({})\n\
             ;   B = {}   ({})\n\
             ; UNSAT = the symmetric difference is empty = the languages are equal.\n\
             ; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).",
            ra.rule_hash, ra.pattern, rb.rule_hash, rb.pattern
        );
        let (smt_a, smt_b) = (to_smt(&parsed[*a].original), to_smt(&parsed[*b].original));
        let sides_identical = smt_a == smt_b;
        let (verdict, elapsed_ms, raw, witness) =
            verify_pair(&z3_path, &verif_dir, &name, &header, &smt_a, &smt_b);
        all_verdicts.push(verdict.clone());
        if sides_identical {
            trivial_queries += 1;
        }

        let syntactically_distinct = syn_of_row[&parsed[*a].row] != syn_of_row[&parsed[*b].row];
        let congruence_only = cong_class[*a] == cong_class[*b];
        merge_reports.push(json!({
            "id": name,
            "a": { "ruleHash": ra.rule_hash, "class": ra.class, "pattern": ra.pattern },
            "b": { "ruleHash": rb.rule_hash, "class": rb.class, "pattern": rb.pattern },
            "foundBy": source_of[&(*a, *b)].iter().collect::<Vec<_>>(),
            "syntacticallyDistinct": syntactically_distinct,
            "smtSidesIdentical": sides_identical,
            "attributableTo": if congruence_only {
                "congruence-only (hash-consing + canonical char-class sets; no rewrite needed)"
            } else {
                "rewrites (the named ruleset fired)"
            },
            "canonicalForm": pretty(&sats[*a].canonical),
            "z3": { "verdict": verdict, "elapsedMs": elapsed_ms, "output": raw, "witness": witness },
            "smt2": format!("artifacts/verification/{name}.smt2"),
        }));
    }

    let mut sample_reports: Vec<Value> = Vec::new();
    for (n, i) in sample.iter().enumerate() {
        let r = &rows[parsed[*i].row];
        let name = format!("sample-{:02}-{}", n, &r.pattern_sha256[..8]);
        let header = format!(
            "; REWRITE CHECK — a corpus pattern's desugared original vs the form egg\n\
             ; extracted from its saturated e-class (AstSize cost).\n\
             ;   pattern = {}   ({})\n\
             ; UNSAT = the rewriting preserved the language.",
            r.rule_hash, r.pattern
        );
        let (smt_o, smt_c) = (to_smt(&parsed[*i].original), to_smt(&sats[*i].canonical));
        let sides_identical = smt_o == smt_c;
        let (verdict, elapsed_ms, raw, witness) =
            verify_pair(&z3_path, &verif_dir, &name, &header, &smt_o, &smt_c);
        all_verdicts.push(verdict.clone());
        if sides_identical {
            trivial_queries += 1;
        }
        sample_reports.push(json!({
            "id": name,
            "ruleHash": r.rule_hash,
            "pattern": r.pattern,
            "patternSha256": r.pattern_sha256,
            "canonicalDiffersFromOriginal": differs(*i),
            "smtSidesIdentical": sides_identical,
            "evidenceClass": evidence_class(*i),
            "originalCost": ast_size(&parsed[*i].original),
            "canonicalCost": sats[*i].cost,
            "canonicalForm": pretty(&sats[*i].canonical),
            "z3": { "verdict": verdict, "elapsedMs": elapsed_ms, "output": raw, "witness": witness },
            "smt2": format!("artifacts/verification/{name}.smt2"),
        }));
    }

    // ── encoding controls ───────────────────────────────────────────────────
    //
    // 27 of 27 UNSAT is only evidence if the encoding can produce a SAT at all.
    // These pairs are NOT criterion-1 evidence (their verdicts stay out of
    // `all_verdicts`); they check that the xor construction discriminates, and
    // they record one equivalence the named ruleset MISSED.
    let controls: [(&str, &str, &str, &str); 2] = [
        (
            "e1046c772a6bb6f9",
            "fe55021637d003d4",
            "sat",
            "`pnpm\\s+bin\\b` vs `\\bpnpm\\s+bin\\b` differ only by a LEADING \\b, so the second \
             rejects a line like `xpnpm bin` that the first accepts. A SAT here (with a witness) \
             is what proves the construction discriminates rather than proving everything equal.",
        ),
        (
            "7056157a6bf72fa8",
            "d2f88c8528441069",
            "unsat",
            "`[\\/'\"`]?\\.git[\\/]hooks` vs `\\.git[\\/]hooks` ARE equal under unanchored search \
             (Σ*·C? = Σ*), but egg did NOT merge them: the absorbing law Σ*·C? → Σ* is not in the \
             ruleset DESIGN names. A recorded FALSE NEGATIVE of the named ruleset, not of egg.",
        ),
    ];
    let idx_by_hash: BTreeMap<&str, usize> = parsed
        .iter()
        .enumerate()
        .map(|(i, p)| (rows[p.row].rule_hash.as_str(), i))
        .collect();
    let mut control_reports: Vec<Value> = Vec::new();
    let mut controls_as_expected = true;
    for (n, (ha, hb, expected, why)) in controls.iter().enumerate() {
        let (Some(ia), Some(ib)) = (idx_by_hash.get(ha), idx_by_hash.get(hb)) else {
            controls_as_expected = false;
            control_reports.push(json!({
                "control": n, "error": "control pattern is not in the parsed set",
                "a": ha, "b": hb,
            }));
            continue;
        };
        let name = format!("control-{n}-{ha}-{hb}");
        let header = format!("; ENCODING CONTROL — expected {expected}.\n; {why}");
        let (verdict, ms, raw, witness) = verify_pair(
            &z3_path,
            &verif_dir,
            &name,
            &header,
            &to_smt(&parsed[*ia].original),
            &to_smt(&parsed[*ib].original),
        );
        controls_as_expected &= verdict == *expected;
        control_reports.push(json!({
            "id": name,
            "a": rows[parsed[*ia].row].pattern,
            "b": rows[parsed[*ib].row].pattern,
            "expected": expected,
            "why": why,
            "eggMergedThem": pairs.contains(&(*ia.min(ib), *ia.max(ib))),
            "z3": { "verdict": verdict, "elapsedMs": ms, "output": raw, "witness": witness },
        }));
    }

    // ── the three criteria, computed ────────────────────────────────────────
    let unsat = all_verdicts.iter().filter(|v| *v == "unsat").count();
    let sat = all_verdicts.iter().filter(|v| *v == "sat").count();
    let unverified = all_verdicts.len() - unsat - sat;
    let soundness_pass = !all_verdicts.is_empty() && unsat == all_verdicts.len();

    let mut nonsyntactic_classes: Vec<Value> = Vec::new();
    for (key, members) in &canon_groups {
        if members.len() < 2 {
            continue;
        }
        let syn: BTreeSet<String> = members
            .iter()
            .map(|m| syn_of_row[&parsed[*m].row].clone())
            .collect();
        if syn.len() > 1 {
            nonsyntactic_classes.push(json!({
                "canonicalForm": pretty(&sats[members[0]].canonical),
                "canonicalKey": key,
                "patterns": members.iter().map(|m| json!({
                    "ruleHash": rows[parsed[*m].row].rule_hash,
                    "pattern": rows[parsed[*m].row].pattern,
                })).collect::<Vec<_>>(),
                "allCongruenceOnly": members.windows(2).all(|w| cong_class[w[0]] == cong_class[w[1]]),
            }));
        }
    }
    let yield_pass = !nonsyntactic_classes.is_empty();

    let all_saturated = sats.iter().all(|s| s.stop_reason == "Some(Saturated)");
    let per_pattern_within_budget = per_pattern_wall_ms <= SATURATION_BUDGET.as_millis();
    let cost_pass = all_saturated && per_pattern_within_budget;

    // What saturation actually CHANGED. A canonical form can differ from the
    // original as a TERM while denoting an identical flattened language
    // expression — that is what 250k concat-assoc firings buy: re-association,
    // which the printer (and any n-ary IR) collapses anyway.
    let mut differs_as_term = 0usize;
    let mut differs_after_flattening = 0usize;
    for (i, s) in sats.iter().enumerate() {
        if s.canonical_key != parsed[i].original.to_string() {
            differs_as_term += 1;
        }
        if to_smt(&s.canonical) != to_smt(&parsed[i].original) {
            differs_after_flattening += 1;
        }
    }

    // What saturation actually bought, in extractor cost.
    let mut smaller = 0usize;
    let mut equal = 0usize;
    let mut larger = 0usize;
    let mut orig_total = 0usize;
    let mut canon_total = 0usize;
    for (i, s) in sats.iter().enumerate() {
        let o = ast_size(&parsed[i].original);
        orig_total += o;
        canon_total += s.cost;
        match s.cost.cmp(&o) {
            std::cmp::Ordering::Less => smaller += 1,
            std::cmp::Ordering::Equal => equal += 1,
            std::cmp::Ordering::Greater => larger += 1,
        }
    }

    // Which patterns blew the node budget, and whether the sample reaches them.
    let in_sample: BTreeSet<usize> = sample.iter().copied().collect();
    let node_limited: Vec<Value> = sats
        .iter()
        .enumerate()
        .filter(|(_, s)| s.stop_reason.starts_with("Some(NodeLimit"))
        .map(|(i, s)| {
            json!({
                "pattern": rows[parsed[i].row].pattern,
                "ruleHash": rows[parsed[i].row].rule_hash,
                "stopReason": s.stop_reason,
                "eNodes": s.nodes,
                "eClasses": s.classes,
                "iterations": s.iterations,
                "wallMs": s.wall_ms,
                "coveredByRewriteSample": in_sample.contains(&i),
            })
        })
        .collect();

    let mut per_pattern_applied: BTreeMap<String, usize> = BTreeMap::new();
    for s in &sats {
        for (k, v) in &s.applied {
            *per_pattern_applied.entry(k.clone()).or_default() += v;
        }
    }
    let never_fired: Vec<&str> = docs
        .iter()
        .map(|d| d.name)
        .filter(|n| !per_pattern_applied.contains_key(*n))
        .collect();

    let verdict = if soundness_pass && yield_pass && cost_pass {
        "ADOPT-for-study"
    } else {
        "REJECT — plain typed IR structures win"
    };

    // ── report ──────────────────────────────────────────────────────────────
    let mut stop_reasons: BTreeMap<String, usize> = BTreeMap::new();
    for s in &sats {
        *stop_reasons.entry(s.stop_reason.clone()).or_default() += 1;
    }
    let mut slowest: Vec<(u128, usize)> = sats.iter().enumerate().map(|(i, s)| (s.wall_ms, i)).collect();
    slowest.sort_by(|a, b| b.0.cmp(&a.0));

    let boundaries: usize = parsed.iter().map(|p| p.notes.boundaries).sum();
    let boundaries_static: usize = parsed.iter().map(|p| p.notes.boundaries_static).sum();
    let boundaries_inter: usize = parsed.iter().map(|p| p.notes.boundaries_inter).sum();
    let open_repeats: usize = parsed.iter().map(|p| p.notes.open_repeats).sum();

    let sample_evidence_bearing = sample
        .iter()
        .filter(|i| evidence_class(**i) == "rewrite-evidence")
        .count();

    let report = json!({
        "probe": "egg e-graph probe — spec § Enrichment row 1 (\"egg proposes, Z3 disposes\")",
        "contract": "spikes/spine-adopt/egg-probe/DESIGN.md",
        "verdict": verdict,
        "verdictComputedFrom": "criteria.{soundness,yield,cost}.pass — all three must hold",

        "pins": {
            "egg": egg_version,
            "eggPinKind": "`=` requirement in Cargo.toml + committed Cargo.lock",
            "z3": "5.1.0 (spike toolchain.lock)",
            "z3Path": z3_path_recorded,
            "z3PathResolvedFrom": z3_resolved_from,
            "z3PathResolution": format!(
                "${Z3_BIN_ENV} when set, else the per-platform default under \
                 spikes/spine-adopt/tools/ — {Z3_WIN} on Windows, {Z3_UNIX} elsewhere. Both \
                 assets are pinned in spikes/spine-adopt/toolchain.lock ([z3] / [z3.linux]); \
                 the precedence is smt/src/runner.rs::resolve_solver's, reimplemented here \
                 because DESIGN § Boundaries forbids depending on that crate.",
                Z3_BIN_ENV = Z3_BIN_ENV, Z3_WIN = Z3_REL_WINDOWS, Z3_UNIX = Z3_REL_UNIX
            ),
            "z3TimeoutSeconds": Z3_TIMEOUT_SECS,
            "saturationBudgetSeconds": SATURATION_BUDGET.as_secs(),
        },

        "alphabet": {
            "name": "LINE alphabet Σ",
            "definition": "{0x09 (tab)} ∪ [0x20..0x7E] — 96 characters",
            "mirrors": "spikes/spine-adopt/smt/src/lang.rs::line_any()",
            "why": "the record runtime evaluates every regex per ADDED LINE and flagless, so a line never contains \\n; `.` and `[^\\n]` therefore both denote Σ",
            "bound": "\\f, \\v and every non-ASCII character are OUTSIDE Σ. A z3 witness is always a real line, but an UNSAT is an absence only over Σ — the same bound lang.rs states for the O-series obligations.",
            "wordClass": "[A-Za-z0-9_] (lang.rs::word_char)",
            "nonWordClass": "Σ minus the word class, ENUMERATED as ranges — never re.comp (lang.rs::nonword_char; O9 check A is the proof that the enumeration equals the complement form)",
        },

        "representationChoices": [
            "cat and alt are BINARY, right-associated at build time, so DESIGN's named union/concat assoc + comm rules are expressible as egg patterns (an n-ary operator would make them inexpressible as rewrites).",
            "A multi-character literal is a CONCATENATION OF PER-CHARACTER atoms. Whole-string literal atoms would hide `\\.git\\/hooks` from the named single-char-class ↔ literal rule, letting the representation rather than the semantics decide the yield.",
            "A character class is a canonical 128-bit Σ-subset mask, so ['\"] and [\"'] hash-cons to the SAME e-node and class equality is decided by the representation, not by a rewrite. Union / complement-within-Σ / subset are single machine words.",
            "`rep` carries its bounds in a Bnd LEAF child (`(rep body bounds)`), keeping the language inside plain define_language! forms.",
            "`opt` is a primitive node (matching how DESIGN words a?·a* → a*), printed o09's way as (re.union (str.to_re \"\") X).",
            "The e-graph holds the SEARCH LANGUAGE (padding + anchors + desugared \\b), not the raw parse — so a merge is a claim about the shipped semantics, which is exactly what the z3 pass checks.",
        ],

        "subsetNotes": [
            "DESIGN § Method 1 names 'bounded {n,m}'. `{n}` and `{n,}` are the same counted-repetition family and are parsed here: `{n}` → (_ re.loop n n), `{n,}` → (_ re.loop n n) · re.* — an exact rewriting, not an approximation. Flagged for the dispatching seat because it is an extension of the words DESIGN uses.",
            "Lazy quantifiers (`*?`, `+?`, `??`) are NOT in the declared subset and are recorded unparsed, even though they are language-equal to the greedy form under membership: reading them as greedy would silently re-read match semantics.",
            "A `{` that does not open a valid quantifier is a LITERAL — the shipped JS RegExp (Annex B) rule, so this is fidelity, not a guess. A `{n,m}` with REVERSED bounds (`a{3,1}`) is the one brace form that is neither: it matches QuantifierPrefix, so the Annex-B literal reading does not apply, and ECMAScript's InvalidBracedQuantifier early error makes the whole pattern a SyntaxError (V8: \"numbers out of order in {} quantifier\"). It is recorded unparsed under `reversed-counted-bounds` rather than modelled as `(_ re.loop 3 1)`, which would be a language the shipped engine never produces.",
            "A POSITIVE character class naming an out-of-Σ character is refused rather than intersected with Σ, which would silently narrow it. A NEGATED class naming out-of-Σ characters is exact on Σ and is kept — this is lang.rs's own reading of [^\\n].",
        ],

        "wordBoundaryDesugar": {
            "base": "lang.rs's CAREFUL desugar: a leading \\b abutting a WORD character becomes opt(Σ*·NW) (the ε branch is what makes a match at position 0 legal); the trailing mirror is opt(NW·Σ*). O9 check A verified these shapes; check B measured what the naive 'a non-word character' shortcut costs.",
            "generalisation": "This corpus also puts \\b next to NON-word characters (e.g. \\b#515\\b), which lang.rs never needed. There the assertion requires the context character to BE a word character and to be present, so the ε branch is dropped: Σ*·W / W·Σ*. When BOTH sides are pattern-determined the assertion is static — a boundary holds iff the two polarities differ — yielding ε or ∅.",
            "nonLocalCase": "When the constrained side is not bare Σ* the context is applied with re.inter (in the o09 subset) rather than by substitution. When it IS bare Σ*, Σ* ∩ opt(Σ*·NW) = opt(Σ*·NW), so the emitted text is byte-identical to lang.rs's shape.",
            "refusals": "\\b inside a group/alternation/quantifier, and \\b whose neighbours are both nullable or mixed-polarity, are recorded unparsed rather than case-split — a case-split would be a DIFFERENT construction from the O9-verified one.",
            "sites": boundaries,
            "staticallyDecided": boundaries_static,
            "needingReInter": boundaries_inter,
        },

        "smtDialect": {
            "constructsEmitted": ["str.in_re", "re.++", "re.union", "re.inter", "re.range", "str.to_re", "re.*", "re.+", "(_ re.loop n m)"],
            "notEmitted": {
                "re.comp": "in the o09 subset but unnecessary here — the non-word class is enumerated, as lang.rs does",
                "re.opt": "accepted by the pinned z3 (see dialectProbe) but NOT emitted; `?` is spelled o09's way as a union with the empty word",
                "re.none": "not used by o09, so the empty language is spelled (re.inter (str.to_re \"\") (str.to_re \"a\")) — ε ∩ {\"a\"} = ∅ — which stays inside the subset",
            },
            "stringEscaping": "smt/src/re.rs's rule: printable ASCII passes through, `\"` is doubled, every other character is emitted \\u{..}. A raw control byte is accepted by z3 and REJECTED by cvc5, so tab is always \\u{9}.",
            "printerOptimisations": "right-associated cat/alt chains are flattened to n-ary re.++ / re.union and runs of adjacent LITERAL atoms are coalesced into one str.to_re — semantics-preserving, and it makes the emitted text look like o09's rather than handing z3 a needlessly deep term. A singleton CLASS is deliberately NOT folded into a literal run: doing so would print `\\.git[\\/]hooks` and `\\.git\\/hooks` identically and turn the z3 check of that very merge into a tautology.",
            "dialectProbe": dialect,
        },

        "corpus": {
            "censusArtifact": "spikes/spine-adopt/artifacts/expressibility-census.json",
            "targetClasses": TARGET_CLASSES,
            "rows": rows.len(),
            "byClass": {
                "re2-clean": rows.iter().filter(|r| r.class == "re2-clean").count(),
                "word-boundary": rows.iter().filter(|r| r.class == "word-boundary").count(),
            },
            "distinctPatternStrings": rows.iter().map(|r| &r.pattern).collect::<BTreeSet<_>>().len(),
            "inputRepair": {
                "what": "the census artifact (and the corpora it names) contain LONE surrogate escapes, which strict JSON forbids and serde_json refuses; each was replaced with \\ufffd so the artifact could be read at all",
                "replacements": replaced,
                "effect": "U+FFFD is outside Σ, so the affected row is refused under `char-outside-line-alphabet` exactly as the original ill-formed pattern would be — recorded here rather than repaired silently",
            },
            "integrityCrossCheck": integrity,
        },

        "parse": {
            "parsed": parsed.len(),
            "unparsed": unparsed.len(),
            "partitionAssertion": format!("parsed {} + unparsed {} = {} ✓", parsed.len(), unparsed.len(), EXPECTED_ROWS),
            "openRepeatsLowered": open_repeats,
            "unparsedByReason": unparsed_by_kind,
            "unparsedRows": unparsed,
        },

        "syntacticBaseline": {
            "normalization": "collapse every run of ASCII whitespace in the pattern SOURCE to one space, then trim; group by exact string equality",
            "distinctOverAll177": syntactic_distinct_all,
            "distinctOverParsed": syntactic_distinct_parsed,
        },

        "saturation": {
            "perPattern": {
                "note": "DESIGN § Method 3 — 'Saturate per pattern (canonical form + cost via ast-size extractor)'. This arm is what criteria.cost measures.",
                "patterns": sats.len(),
                "totalWallMs": per_pattern_wall_ms,
                "stopReasons": stop_reasons,
                "allSaturated": all_saturated,
                "totalENodes": sats.iter().map(|s| s.nodes).sum::<usize>(),
                "totalEClasses": sats.iter().map(|s| s.classes).sum::<usize>(),
                "ruleApplications": per_pattern_applied,
                "rulesThatNeverFired": never_fired,
                "nodeLimited": {
                    "count": node_limited.len(),
                    "note": "these runs stopped at egg's DEFAULT node limit (10 000) — a blowup under DESIGN criterion 3, not a timeout: the whole per-pattern arm used 2% of the 60s wall budget",
                    "patterns": node_limited,
                },
                "canonicalChange": {
                    "measure": "how the extracted canonical differs from the desugared original, per parsed pattern",
                    "differsAsTerm": differs_as_term,
                    "differsAfterFlattening": differs_after_flattening,
                    "note": "`differsAsTerm` counts any structural difference; `differsAfterFlattening` counts those that survive n-ary flattening of cat/alt chains. The gap is pure RE-ASSOCIATION — what the 250k concat-assoc firings produce, and what any n-ary IR collapses for free.",
                },
                "costReduction": {
                    "measure": "AstSize of the desugared original vs the extracted canonical, per pattern",
                    "patternsWithSmallerCanonical": smaller,
                    "patternsWithEqualCost": equal,
                    "patternsWithLargerCanonical": larger,
                    "totalOriginalCost": orig_total,
                    "totalCanonicalCost": canon_total,
                },
                "slowest": slowest.iter().take(10).map(|(ms, i)| json!({
                    "pattern": rows[parsed[*i].row].pattern,
                    "wallMs": ms,
                    "stopReason": sats[*i].stop_reason,
                    "eNodes": sats[*i].nodes,
                    "eClasses": sats[*i].classes,
                    "iterations": sats[*i].iterations,
                })).collect::<Vec<_>>(),
                "distinctCanonicalForms": canon_groups.len(),
            },
            "sharedEGraph": {
                "note": "SUPPLEMENTARY. DESIGN criterion 3 says 'full-corpus saturation' while § Method 3 says 'saturate per pattern'; both readings are measured rather than adjudicated here.",
                "wallMs": shared_wall_ms,
                "stopReason": format!("{:?}", shared_runner.stop_reason),
                "iterations": shared_runner.iterations.len(),
                "eNodes": shared_runner.egraph.total_number_of_nodes(),
                "eClasses": shared_runner.egraph.number_of_classes(),
                "distinctRootEClasses": shared_class.iter().collect::<BTreeSet<_>>().len(),
                "ruleApplications": shared_applied,
            },
            "congruenceOnlyControl": {
                "note": "hash-consing + the canonical char-class representation, NO rewrite applied — what a plain typed IR would already give. Merges beyond this are what egg's rewriting earned.",
                "distinctRootEClasses": cong_class.iter().collect::<BTreeSet<_>>().len(),
                "groupsWithMoreThanOne": cong_groups.values().filter(|v| v.len() > 1).count(),
            },
        },

        "grouping": {
            "syntacticDistinctOverParsed": syntactic_distinct_parsed,
            "eClassCountPerPattern": canon_groups.len(),
            "eClassCountSharedEGraph": shared_class.iter().collect::<BTreeSet<_>>().len(),
            "crossPatternMergeGroups": canon_groups.values().filter(|v| v.len() > 1).count(),
        },

        "merges": merge_reports,
        "rewriteSample": {
            "selectionRule": "order all parsed patterns by sha256(pattern-text) ascending, then take by EVIDENCE CLASS strongest first: `rewrite-evidence` (canonical differs from the desugared original AND the two sides serialize differently, so the xor query is a real question), then `representation-only` (the canonical differs as an e-graph term but serializes byte-identically, making xor(R, R) a tautology), then `no-rewrite` (canonical == original, which proves nothing about rewriting). Within each class, the same hash order. No RNG, no timestamps.",
            "size": sample.len(),
            "rewrittenPairsAvailable": rewritten_available,
            "evidenceClasses": {
                "meaning": {
                    "rewrite-evidence": "canonical differs from the original AND the emitted SMT operands differ — the z3 UNSAT is a real proof that the rewriting preserved the language",
                    "representation-only": "canonical differs only as an e-graph TERM; the two sides print byte-identically, so the emitted query is xor(R, R) and its UNSAT is a tautology carrying NO rewrite evidence. Labelled, not hidden: the equality was decided by the IR representation (canonical char-class sets, printer flattening), which is itself a measured result.",
                    "no-rewrite": "the extracted canonical IS the desugared original",
                },
                "availableInCorpus": EVIDENCE_CLASSES.iter().map(|c| (c.to_string(), json!(available(c)))).collect::<Map<String, Value>>(),
                "inSample": EVIDENCE_CLASSES.iter().map(|c| {
                    (c.to_string(), json!(sample.iter().filter(|i| evidence_class(**i) == *c).count()))
                }).collect::<Map<String, Value>>(),
            },
            "pairs": sample_reports,
        },

        "verification": {
            "construction": "O9's xor-emptiness: (assert (xor (str.in_re s A) (str.in_re s B))); UNSAT = the symmetric difference is empty = the languages are equal. Both sides are subsets of Σ, so a string outside Σ lies in NEITHER and cannot be a witness — equivalence proved here holds on the LINE alphabet exactly as O9 words it.",
            "solver": "pinned z3 5.1.0 CLI, -T:30 per query",
            "failClosed": "a timeout or `unknown` is recorded UNVERIFIED and criterion 1 treats it as NOT PROVEN — the same posture as O10",
            "queries": all_verdicts.len(),
            "unsat": unsat,
            "sat": sat,
            "unverified": unverified,
            "encodingControls": {
                "why": "an all-UNSAT verification pass is only evidence if the encoding can produce a SAT at all; these are NOT criterion-1 evidence and their verdicts are excluded from the counts above",
                "allAsExpected": controls_as_expected,
                "controls": control_reports,
            },
        },

        "criteria": {
            "soundness": {
                "statement": "DESIGN 1 — every equivalence egg claims is verified UNSAT; ONE unsound merge ⇒ REJECT",
                "measure": "all emitted xor-emptiness queries returned unsat",
                "queries": all_verdicts.len(),
                "unsat": unsat,
                "sat": sat,
                "unverified": unverified,
                "pass": soundness_pass,
                "tautologicalQueries": {
                    "count": trivial_queries,
                    "of": all_verdicts.len(),
                    "meaning": "queries whose two sides print BYTE-IDENTICALLY. Their UNSAT is a tautology and carries no evidential weight: it happens when the claimed equality is decided by the IR REPRESENTATION (canonical char-class sets making ['\"] and [\"'] one node) rather than by a rewrite. The remaining queries are real proofs.",
                    "nonTautological": all_verdicts.len() - trivial_queries,
                },
                "coverage": {
                    "crossPatternMerges": format!("{} of {} — EXHAUSTIVE (every unordered pair inside every multi-pattern class, from both groupings)", merge_reports.len(), pairs.len()),
                    "rewrittenVsOriginal": format!("{} of {} parsed patterns — a SAMPLE, as DESIGN § Method 4 specifies; the other {} extracted canonical forms are NOT externally verified", sample.len(), parsed.len(), parsed.len().saturating_sub(sample.len())),
                    "rewrittenVsOriginalEvidenceBearing": format!("{} of the {} sampled pairs are `rewrite-evidence` — the two sides serialize DIFFERENTLY, so the query is not a tautology; the remaining {} are `representation-only` (xor(R, R)) and carry no rewrite evidence. The corpus offers {} rewrite-evidence pairs in total; selection takes them first, in hash order.", sample_evidence_bearing, sample.len(), sample.len().saturating_sub(sample_evidence_bearing), available("rewrite-evidence")),
                    "nodeLimitedPatternsInSample": node_limited.iter().filter(|p| p["coveredByRewriteSample"] == json!(true)).count(),
                },
            },
            "yield": {
                "statement": "DESIGN 2 — at least one equivalence class naive syntactic dedup does not find",
                "measure": "canonical-form groups with ≥2 patterns whose whitespace-normalized SOURCES are not all identical",
                "nonSyntacticClasses": nonsyntactic_classes.len(),
                "classes": nonsyntactic_classes,
                "pass": yield_pass,
            },
            "cost": {
                "statement": "DESIGN 3 — full-corpus saturation completes under 60s wall with egg's default iteration limits; a blowup is a REJECT row with the measurement",
                "measure": "every per-pattern run reached StopReason::Saturated AND the total wall time is within the 60s budget",
                "allSaturated": all_saturated,
                "totalWallMs": per_pattern_wall_ms,
                "budgetMs": SATURATION_BUDGET.as_millis(),
                "withinBudget": per_pattern_within_budget,
                "stopReasons": stop_reasons,
                "failedSubCondition": if cost_pass {
                    Value::Null
                } else if !all_saturated {
                    json!(format!(
                        "{} of {} per-pattern runs stopped at egg's DEFAULT node limit (10 000) instead of reaching a fixpoint. Wall time was NOT the binding constraint ({} ms of the 60 000 ms budget). The node growth is AC churn from the named laws: concat-assoc and union-assoc/comm dominate the application counts.",
                        node_limited.len(), sats.len(), per_pattern_wall_ms
                    ))
                } else {
                    json!("wall time exceeded the 60s budget")
                },
                "pass": cost_pass,
            },
        },
    });

    let path = out_dir.join("egg-report.json");
    fs::write(&path, format!("{:#}\n", report)).expect("write egg-report.json");

    println!("parsed {} / unparsed {}", parsed.len(), unparsed.len());
    println!(
        "syntactic-distinct(parsed) {} vs e-classes(per-pattern) {} / shared {}",
        syntactic_distinct_parsed,
        canon_groups.len(),
        shared_class.iter().collect::<BTreeSet<_>>().len()
    );
    println!(
        "z3 queries {} — unsat {} sat {} unverified {}",
        all_verdicts.len(),
        unsat,
        sat,
        unverified
    );
    println!(
        "criteria: soundness={soundness_pass} yield={yield_pass} cost={cost_pass}  =>  {verdict}"
    );
    println!("report: {}", path.display());
}

// ─── inputs ─────────────────────────────────────────────────────────────────

/// The census artifact contains two LONE surrogate escapes (`\ud83c` and
/// `\udfff`, in the emoji character class of rule `5afaf8d03f059a41`), which
/// strict JSON forbids and `serde_json` therefore refuses. Each lone surrogate
/// is replaced with `�` so the artifact can be read AT ALL; U+FFFD is
/// outside Σ, so the affected row lands in `unparsed` under
/// `char-outside-line-alphabet` exactly as the original ill-formed pattern
/// would. Every replacement is counted and reported — this is a recorded
/// repair of the input, not a silent one.
fn sanitize_lone_surrogates(text: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut replaced = Vec::new();
    let mut i = 0usize;
    let unit_at = |k: usize| -> Option<u32> {
        if chars.get(k) != Some(&'\\') || chars.get(k + 1) != Some(&'u') {
            return None;
        }
        let hex: String = chars.get(k + 2..k + 6)?.iter().collect();
        u32::from_str_radix(&hex, 16).ok()
    };
    while i < chars.len() {
        match unit_at(i) {
            Some(v) if (0xD800..=0xDBFF).contains(&v) => {
                let paired = matches!(unit_at(i + 6), Some(lo) if (0xDC00..=0xDFFF).contains(&lo));
                if paired {
                    out.push_str(&chars[i..i + 12].iter().collect::<String>());
                    i += 12;
                } else {
                    replaced.push(format!("{}u{:04x}", char::from(92u8), v));
                    out.push_str("\\ufffd");
                    i += 6;
                }
            }
            Some(v) if (0xDC00..=0xDFFF).contains(&v) => {
                replaced.push(format!("{}u{:04x}", char::from(92u8), v));
                out.push_str("\\ufffd");
                i += 6;
            }
            _ => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    (out, replaced)
}

fn load_rows(census: &Value) -> Vec<Row> {
    let mut out = Vec::new();
    for r in census["rules"].as_array().expect("census.rules") {
        let class = r["class"].as_str().unwrap_or_default().to_string();
        if !TARGET_CLASSES.contains(&class.as_str()) {
            continue;
        }
        let pattern = r["pattern"].as_str().expect("row.pattern").to_string();
        let mut h = Sha256::new();
        h.update(pattern.as_bytes());
        out.push(Row {
            index: out.len(),
            rule_hash: r["ruleHash"].as_str().unwrap_or_default().to_string(),
            corpus: r["corpus"].as_str().unwrap_or_default().to_string(),
            class,
            pattern,
            pattern_sha256: format!("{:x}", h.finalize()),
        });
    }
    out
}

/// Dereference the census against the four rule corpora it names, so the probe
/// is not building on a derived summary.
fn corpora_integrity(census: &Value, rows: &[Row]) -> Value {
    let mut files: BTreeMap<String, String> = BTreeMap::new();
    for c in census["corpora"].as_array().expect("census.corpora") {
        files.insert(
            c["id"].as_str().unwrap().to_string(),
            c["file"].as_str().unwrap().replace('\\', "/"),
        );
    }
    let mut by_corpus: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for (id, rel) in &files {
        let path = repo_root().join(rel);
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let v: Value = serde_json::from_str(&sanitize_lone_surrogates(&text).0)
            .expect("parse compiled-rules.json");
        let mut map = BTreeMap::new();
        for rule in v["rules"].as_array().into_iter().flatten() {
            if let (Some(h), Some(p)) = (rule["lessonHash"].as_str(), rule["pattern"].as_str()) {
                map.insert(h.to_string(), p.to_string());
            }
        }
        by_corpus.insert(id.clone(), map);
    }
    let mut matched = 0usize;
    let mut mismatched: Vec<Value> = Vec::new();
    for r in rows {
        match by_corpus.get(&r.corpus).and_then(|m| m.get(&r.rule_hash)) {
            Some(p) if *p == r.pattern => matched += 1,
            other => mismatched.push(json!({
                "ruleHash": r.rule_hash,
                "corpus": r.corpus,
                "censusPattern": r.pattern,
                "corpusPattern": other,
            })),
        }
    }
    json!({
        "method": "each census row's (corpus, ruleHash) is looked up in that corpus's compiled-rules.json and its `pattern` compared byte-for-byte",
        "files": files,
        "matched": matched,
        "mismatched": mismatched,
    })
}

fn ast_size(expr: &RecExpr<ReLang>) -> usize {
    let mut cf = AstSize;
    cf.cost_rec(expr)
}

/// `artifacts/ruleset.json` — DESIGN § Method 2 makes the ruleset part of the
/// deliverable, so every rule ships with the DESIGN clause it implements and
/// its one-line local proof.
fn write_ruleset(out_dir: &Path, docs: &[rules::RuleDoc]) {
    let body = json!({
        "contract": "spikes/spine-adopt/egg-probe/DESIGN.md § Method 2",
        "designClause": "union assoc/comm/idempotence, concat assoc + ε-identity, `∅` annihilator/identity laws, `(a*)* → a*`, `a?·a* → a*`, `a·a* ↔ a+`, char-class union merging, single-char class ↔ literal. NO rule that is not locally provable",
        "closure": "Nothing beyond that list is implemented. Where DESIGN writes `↔` the rule ships as a named pair. In particular NO rule such as `Σ*·C? → Σ*` was added, even though it is locally provable and would have raised the yield — extending the ruleset would be re-writing the contract.",
        "count": docs.len(),
        "rules": docs.iter().map(|d| json!({
            "name": d.name,
            "designClause": d.design_clause,
            "statement": d.statement,
            "localProof": d.local_proof,
        })).collect::<Vec<_>>(),
    });
    fs::write(out_dir.join("ruleset.json"), format!("{:#}\n", body)).expect("write ruleset.json");
}

fn locked_version(name: &str) -> Option<String> {
    let text = fs::read_to_string(crate_root().join("Cargo.lock")).ok()?;
    let mut current: Option<String> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("name = ") {
            current = Some(v.trim_matches('"').to_string());
        }
        if let Some(v) = line.strip_prefix("version = ") {
            if current.as_deref() == Some(name) {
                return Some(v.trim_matches('"').to_string());
            }
        }
    }
    None
}

// ─── z3 ─────────────────────────────────────────────────────────────────────

fn xor_query(header: &str, a: &str, b: &str, want_model: bool) -> String {
    let (opt, tail) = if want_model {
        ("(set-option :produce-models true)\n", "(get-model)\n")
    } else {
        ("", "")
    };
    format!(
        "{header}\n(set-logic QF_SLIA)\n{opt}\n\
         (declare-const s String)\n\n\
         (assert (! (xor (str.in_re s {a}) (str.in_re s {b})) :named symmetric-difference))\n\
         (check-sat)\n{tail}"
    )
}

/// One xor-emptiness check. On SAT a companion query is re-run with
/// `:produce-models` so the distinguishing witness is captured — the same shape
/// as O9's check B, which reports a witness rather than only a status.
fn verify_pair(
    z3: &Path,
    dir: &Path,
    name: &str,
    header: &str,
    a: &str,
    b: &str,
) -> (String, u128, String, Option<String>) {
    let (verdict, ms, raw) = run_z3(z3, dir, name, &xor_query(header, a, b, false));
    let witness = if verdict == "sat" {
        let (_v, _m, wraw) = run_z3(
            z3,
            dir,
            &format!("{name}-witness"),
            &xor_query(header, a, b, true),
        );
        Some(wraw)
    } else {
        None
    };
    (verdict, ms, raw, witness)
}

/// Run the PINNED z3 on one query. Returns (verdict, elapsed ms, raw output).
/// A timeout or `unknown` is a verdict of "unverified" — fail closed.
fn run_z3(z3: &Path, dir: &Path, name: &str, smt: &str) -> (String, u128, String) {
    let smt_path = dir.join(format!("{name}.smt2"));
    fs::write(&smt_path, smt).expect("write .smt2");
    let t0 = Instant::now();
    let out = Command::new(z3)
        .arg("-smt2")
        .arg(format!("-T:{Z3_TIMEOUT_SECS}"))
        .arg(&smt_path)
        .output()
        .expect("run pinned z3");
    let elapsed = t0.elapsed().as_millis();
    let mut raw = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    if !err.trim().is_empty() {
        raw.push_str("\n[stderr] ");
        raw.push_str(err.trim());
    }
    let raw = raw.trim().to_string();
    let first = raw.lines().next().unwrap_or("").trim().to_string();
    let verdict = match first.as_str() {
        "unsat" => "unsat",
        "sat" => "sat",
        "unknown" | "timeout" => "unverified",
        _ => "unverified",
    }
    .to_string();
    fs::write(
        dir.join(format!("{name}.out")),
        format!("{raw}\n; verdict={verdict} elapsedMs={elapsed}\n"),
    )
    .expect("write z3 output");
    (verdict, elapsed, raw)
}

/// Probe the pinned z3 for the constructs the guard rail says to check BEFORE
/// relying on them.
fn dialect_probe(z3: &Path, dir: &Path) -> Value {
    let mut results = Map::new();
    for (name, re) in [
        ("re.opt", "(re.opt (str.to_re \"ab\"))"),
        ("re.loop", "((_ re.loop 0 3) (str.to_re \"x\"))"),
        ("re.comp", "(re.comp (re.range \"a\" \"z\"))"),
        ("re.inter", "(re.inter (str.to_re \"\") (str.to_re \"a\"))"),
    ] {
        let smt = format!(
            "; dialect probe — does the pinned z3 accept this construct?\n\
             (set-logic QF_SLIA)\n(declare-const s String)\n\
             (assert (str.in_re s {re}))\n(check-sat)\n"
        );
        let file = format!("dialect-{}", name.replace('.', "-"));
        let (verdict, _ms, raw) = run_z3(z3, dir, &file, &smt);
        results.insert(
            name.to_string(),
            json!({
                "accepted": verdict == "sat" || verdict == "unsat",
                "z3Output": raw,
            }),
        );
    }
    Value::Object(results)
}
