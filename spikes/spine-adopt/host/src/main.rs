//! The spike host — `spikes/spine-adopt/rego/LOWERING.md` § Host contract.
//!
//! Three arms, one binary:
//!
//!   `--arm opa`     `rust-opa-wasm` on wasmtime, loading each record's compiled
//!                   `policy.wasm`, setting `input` to a FactBundle, evaluating the
//!                   record's single entrypoint. Writes `artifacts/opa-verdicts.json`.
//!   `--arm regorus` `microsoft/regorus` reading the same lowered `policy.rego`
//!                   and the same input. Writes `artifacts/regorus-verdicts.json`.
//!                   REFERENCE DIFFERENTIAL ONLY — never a semantics replacement.
//!   `--arm certify` ONE bundle, ONE input, EVERY entrypoint — the single-eval mode
//!                   `src/certify.mts` drives (spec § Actuator slice: "certification
//!                   evaluates EVERY emitted entrypoint against a schema-valid
//!                   sentinel FactBundle BEFORE artifact publication"). It reports
//!                   the RAW outcome — load error, trap, result-set length, result
//!                   value — and classifies NOTHING: the five typed blocked reasons
//!                   are the certifier's judgement, made in one place, and a host
//!                   that pre-judged them would be a second opinion free to drift.
//!                   Emits its JSON object on stdout; writes no artifact unless
//!                   `--out` is given. The other two arms are untouched by it.
//!
//! Strictness (§ Lowering 2, and the § Host contract's "enforces strict
//! builtin-error surfacing"): an evaluation failure is an ERROR ROW, never an
//! empty result. Both arms are wired that way, and each needs its own mechanism:
//!
//!   opa/wasm  There is no `--strict-builtin-errors` for a wasm module — measured:
//!             a compile-failing `regex.match` makes the rule UNDEFINED and the
//!             entrypoint returns `[]` with no trap and no `opa_abort`. The
//!             lowering therefore guards `result` on a `patterns_compile` probe,
//!             and this host treats an EMPTY RESULT SET as an error.
//!   regorus   `set_strict_builtin_errors(true)` exists and is set; a `Value::Undefined`
//!             from `eval_rule` is likewise an error row.
//!
//! No network. No writes outside `spikes/spine-adopt/artifacts/`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use opa_wasm::wasmtime::{Config, Engine, Module, Store};
use opa_wasm::Runtime;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// Warm-path repetitions. The reported warm figure is the MINIMUM over these —
/// a minimum is the statistic least contaminated by scheduler noise on a laptop,
/// and the question here is "what does the evaluation cost", not "what does a
/// loaded Windows box cost".
const WARM_REPS: usize = 50;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/// One row of the lowerer's declared output (`artifacts/lowering-rejects.json`).
#[derive(Debug, Clone)]
struct LoweredRecord {
    specimen: String,
    rule_id: String,
    package: String,
    entrypoint: String,
    engine: String,
    dir: PathBuf,
}

/// One FactBundle file under `artifacts/facts/`.
#[derive(Debug, Clone)]
struct FactFile {
    file_name: String,
    fixture_id: String,
    specimen: String,
    rule_id: String,
    engine: String,
    bundle: Value,
}

fn read_json(path: &Path) -> Result<Value> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

/// C10 of `.totem/specs/seed20-apparatus-slice2.md`: `SPIKE_ARTIFACTS_SUBDIR=<name>`
/// redirects every artifact read and write under `artifacts/<name>/`, so the K4
/// swapped run and the K3 control-only build get their own homes instead of
/// overwriting the run of record. Unset ⇒ `artifacts/`, byte-for-byte today's
/// paths. The name is validated exactly as the TS arm (`src/lib/spike-env.mts`)
/// and the Go arm (`wazero-probe/paths.go`) validate it, so the three arms can
/// never disagree on where a run lives. The lowered rows' `dir` is NOT touched
/// here: `src/lower.mts` already writes it relative to the subdir'd build root.
fn artifacts_dir(spike_root: &Path) -> Result<PathBuf> {
    let base = spike_root.join("artifacts");
    match std::env::var("SPIKE_ARTIFACTS_SUBDIR") {
        Ok(name) if !name.is_empty() => {
            let valid = name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !valid {
                bail!(
                    "SPIKE_ARTIFACTS_SUBDIR={name:?} is not a valid subdir name (expected ^[a-z0-9-]+$)"
                );
            }
            Ok(base.join(name))
        }
        _ => Ok(base),
    }
}

fn load_lowering(spike_root: &Path) -> Result<Vec<LoweredRecord>> {
    let at = artifacts_dir(spike_root)?.join("lowering-rejects.json");
    let v = read_json(&at)?;
    let rows = v
        .get("lowered")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("{} carries no `lowered` array", at.display()))?;
    let mut out = Vec::new();
    for r in rows {
        let get = |k: &str| -> Result<String> {
            r.get(k)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| anyhow!("lowering row missing `{k}`: {r}"))
        };
        let dir_rel = get("dir")?;
        out.push(LoweredRecord {
            specimen: get("specimen")?,
            rule_id: get("ruleId")?,
            package: get("package")?,
            entrypoint: get("entrypoint")?,
            engine: get("engine")?,
            dir: dir_rel.split('/').fold(spike_root.to_path_buf(), |p, s| p.join(s)),
        });
    }
    if out.is_empty() {
        bail!("{} lowered no records — run src/lower.mts first", at.display());
    }
    Ok(out)
}

fn load_facts(spike_root: &Path) -> Result<Vec<FactFile>> {
    let dir = artifacts_dir(spike_root)?.join("facts");
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();

    let mut out = Vec::new();
    for name in names {
        let v = read_json(&dir.join(&name))?;
        let get = |k: &str| -> Result<String> {
            v.get(k)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| anyhow!("fact bundle {name} missing `{k}`"))
        };
        let bundle = v
            .get("factBundle")
            .cloned()
            .ok_or_else(|| anyhow!("fact bundle {name} missing `factBundle`"))?;
        out.push(FactFile {
            fixture_id: get("fixtureId")?,
            specimen: get("specimen")?,
            rule_id: get("ruleId")?,
            engine: get("engine")?,
            bundle,
            file_name: name,
        });
    }
    Ok(out)
}

// ─── The verdict row ─────────────────────────────────────────────────────────

/// `{rule_id, line_number, ordinal}` / `{kind, line_number, ordinal}`, sorted into
/// a canonical order so a set that Rego serialised in an arbitrary order compares
/// as a set. The comparator does its own keying; this only makes the ARTIFACT
/// stable run-to-run.
fn canonical_array(v: Option<&Value>) -> Vec<Value> {
    let mut items: Vec<Value> = v
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    items.sort_by_key(|x| serde_json::to_string(x).unwrap_or_default());
    items
}

struct Verdict {
    violations: Vec<Value>,
    events: Vec<Value>,
}

/// Read `result = {violations, events}` out of an arm's raw value, FAILING LOUD on
/// anything that is not exactly that shape. A missing key is an error, never an
/// empty list: "absent = absent" (spec § Data model deltas, "No reserved
/// keys/sentinels anywhere"), and a lowering that stopped emitting `events` must
/// not read as a record that emits none.
fn read_result(result: &Value) -> Result<Verdict> {
    let obj = result
        .as_object()
        .ok_or_else(|| anyhow!("entrypoint result is not an object: {result}"))?;
    for k in ["violations", "events"] {
        if !obj.contains_key(k) {
            bail!("entrypoint result is missing `{k}`: {result}");
        }
        if !obj[k].is_array() {
            bail!("entrypoint result `{k}` is not an array: {result}");
        }
    }
    Ok(Verdict {
        violations: canonical_array(obj.get("violations")),
        events: canonical_array(obj.get("events")),
    })
}

/// The host's OWN verdict on one evaluation, as reported data (spec § Actuator
/// slice — "every host retains the failure rule").
///
/// The certification arm records this beside the raw outcome so the certifier can
/// read a verdict the HOST reached, running the host's own `entrypoint_value` /
/// `read_result` / regorus-undefined checks, rather than re-deriving one from the
/// raw shape and then calling that "the host's failure rule". `error` is the
/// host's own message, verbatim — an empty string would mean the rule never ran.
fn failure_rule_verdict(outcome: Result<Verdict>) -> Value {
    match outcome {
        Ok(v) => json!({
            "ok": true,
            "error": Value::Null,
            "violations": v.violations.len(),
            "events": v.events.len(),
        }),
        Err(e) => json!({
            "ok": false,
            "error": format!("{e:#}"),
            "violations": Value::Null,
            "events": Value::Null,
        }),
    }
}

fn verdict_row(
    arm: &str,
    rec: &LoweredRecord,
    fact: &FactFile,
    outcome: Result<Verdict>,
) -> Value {
    match outcome {
        Ok(v) => json!({
            "ruleId": rec.rule_id,
            "fixtureId": fact.fixture_id,
            "arm": arm,
            "fired": !v.violations.is_empty(),
            "matchCount": v.violations.len(),
            "violations": v.violations,
            "events": v.events,
            "specimen": rec.specimen,
            "engine": rec.engine,
            "error": Value::Null,
        }),
        // STRICTNESS: an error is a ROW, never an empty result. `fired`/`matchCount`
        // are null rather than false/0 so a downstream reader cannot mistake a
        // failed evaluation for a clean one.
        Err(e) => json!({
            "ruleId": rec.rule_id,
            "fixtureId": fact.fixture_id,
            "arm": arm,
            "fired": Value::Null,
            "matchCount": Value::Null,
            "violations": Value::Null,
            "events": Value::Null,
            "specimen": rec.specimen,
            "engine": rec.engine,
            "error": format!("{e:#}"),
        }),
    }
}

// ─── Arm 1: rust-opa-wasm on wasmtime ────────────────────────────────────────

struct AbiRow {
    specimen: String,
    imports: Vec<String>,
    exports: Vec<String>,
    abi_version: String,
    entrypoints: Vec<String>,
    default_entrypoint: Option<String>,
}

async fn run_opa_arm(records: &[LoweredRecord], facts: &[FactFile]) -> Result<Value> {
    // `Runtime::new` uses `Memory::new_async` and `func_wrap_async`. In wasmtime 47
    // `Config::async_support` is DEPRECATED and "no longer has any effect" — async
    // support is unconditional — so the call is omitted rather than carried as a
    // dead knob that reads like a live one.
    let config = Config::new();
    // wasmtime 47 has its OWN `Error` type rather than re-exporting `anyhow::Error`,
    // so `anyhow::Context` does not apply directly; `From<wasmtime::Error> for
    // anyhow::Error` (wasmtime-internal-core error.rs:540) is the bridge.
    let engine = Engine::new(&config)
        .map_err(anyhow::Error::from)
        .context("creating the wasmtime engine")?;

    let mut rows: Vec<Value> = Vec::new();
    let mut timings: Vec<Value> = Vec::new();
    let mut abi: Vec<AbiRow> = Vec::new();
    let mut wasm_hashes: BTreeMap<String, String> = BTreeMap::new();

    for rec in records {
        let wasm_path = rec.dir.join("policy.wasm");
        let wasm = std::fs::read(&wasm_path)
            .with_context(|| format!("reading {} — run src/build-wasm.mts first", wasm_path.display()))?;
        wasm_hashes.insert(rec.specimen.clone(), hex(&Sha256::digest(&wasm)));

        let t_compile = Instant::now();
        let module = Module::new(&engine, &wasm)
            .map_err(anyhow::Error::from)
            .with_context(|| format!("compiling {}", wasm_path.display()))?;
        let compile_micros = t_compile.elapsed().as_micros();

        // EVERY import the instance requires, enumerated from the module itself —
        // the § Host contract's census deliverable, taken on the host side too so
        // it does not rest on the Node-side reading alone.
        let imports: Vec<String> = module
            .imports()
            .map(|i| format!("{}.{}:{}", i.module(), i.name(), kind_of(&i.ty())))
            .collect();
        let exports: Vec<String> = module.exports().map(|e| e.name().to_owned()).collect();

        let t_inst = Instant::now();
        let mut store = Store::new(&engine, ());
        // `Runtime::new` reads the module's `builtins` export and resolves EVERY
        // entry through `opa_wasm::builtins::resolve`, which has no public
        // extension point — an unresolvable builtin fails HERE, loudly, which is
        // exactly the "unsupported required builtin" FAIL row the spec names.
        let runtime = Runtime::new(&mut store, &module)
            .await
            .with_context(|| format!("loading {} — a builtin the host cannot resolve fails here", wasm_path.display()))?;
        let entrypoints: Vec<String> = {
            let mut v: Vec<String> = runtime.entrypoints().into_iter().map(str::to_owned).collect();
            v.sort();
            v
        };
        let abi_version = format!("{}", runtime.abi_version());
        let default_entrypoint = runtime.default_entrypoint().map(str::to_owned);
        let policy = runtime
            .without_data(&mut store)
            .await
            .context("instantiating the policy with an empty data document")?;
        let instantiate_micros = t_inst.elapsed().as_micros();

        abi.push(AbiRow {
            specimen: rec.specimen.clone(),
            imports,
            exports,
            abi_version,
            entrypoints,
            default_entrypoint,
        });

        for fact in facts.iter().filter(|f| f.specimen == rec.specimen) {
            join_is_sound(rec, fact)?;

            let t_cold = Instant::now();
            let cold: Result<Value> = policy
                .evaluate(&mut store, &rec.entrypoint, &fact.bundle)
                .await
                .map_err(|e| anyhow!("{e:#}"));
            let cold_micros = t_cold.elapsed().as_micros();

            let outcome = cold.and_then(|raw| entrypoint_value(&raw)).and_then(|v| read_result(&v));

            let mut warm_micros: Option<u128> = None;
            if outcome.is_ok() {
                let mut best = u128::MAX;
                for _ in 0..WARM_REPS {
                    let t = Instant::now();
                    let r: Result<Value, _> = policy
                        .evaluate::<_, Value, _>(&mut store, &rec.entrypoint, &fact.bundle)
                        .await;
                    let e = t.elapsed().as_micros();
                    r.map_err(|e| anyhow!("{e:#}"))
                        .context("warm re-evaluation diverged from the cold one by failing")?;
                    best = best.min(e);
                }
                warm_micros = Some(best);
            }

            timings.push(json!({
                "specimen": rec.specimen,
                "fixtureId": fact.fixture_id,
                "compileMicros": compile_micros,
                "instantiateMicros": instantiate_micros,
                "coldEvalMicros": cold_micros,
                "warmEvalMicrosMin": warm_micros,
                "warmReps": WARM_REPS,
            }));

            rows.push(verdict_row("opa", rec, fact, outcome));
        }
    }

    Ok(json!({
        "generatedBy": "spikes/spine-adopt/host/src/main.rs --arm opa",
        "host": {
            "crate": "opa-wasm 0.3.2 (matrix-org/rust-opa-wasm)",
            "runtime": format!("wasmtime {}", wasmtime_version()),
            "strictness": "An evaluation error, a non-object result, a missing `violations`/`events` key, or an EMPTY RESULT SET is an ERROR ROW. An empty result set means the entrypoint's `result` rule was UNDEFINED, which for these policies means `patterns_compile` or `facts_wellformed` failed — never a zero-violation verdict.",
        },
        "abi": abi.iter().map(|a| json!({
            "specimen": a.specimen,
            "abiVersion": a.abi_version,
            "imports": a.imports,
            "exportCount": a.exports.len(),
            "entrypoints": a.entrypoints,
            "defaultEntrypoint": a.default_entrypoint,
        })).collect::<Vec<_>>(),
        "wasmSha256": wasm_hashes,
        "verdictRows": rows,
        "timings": timings,
    }))
}

/// An OPA wasm entrypoint returns `[{"result": <value>}]`. An EMPTY array means the
/// rule was undefined — the fail-open the wasm ABI has no flag for, and the one
/// condition this host must never read as "no violations".
fn entrypoint_value(raw: &Value) -> Result<Value> {
    let arr = raw
        .as_array()
        .ok_or_else(|| anyhow!("entrypoint returned a non-array result set: {raw}"))?;
    match arr.len() {
        0 => bail!(
            "EMPTY RESULT SET — the entrypoint's `result` rule was UNDEFINED. \
             For these policies that means `patterns_compile` (an uncompilable emitted regex) \
             or `facts_wellformed` (a malformed FactBundle) failed. Surfaced as an error, \
             never as a zero-violation verdict (LOWERING.md § Lowering 2)."
        ),
        1 => arr[0]
            .get("result")
            .cloned()
            .ok_or_else(|| anyhow!("result set entry has no `result` key: {raw}")),
        n => bail!("entrypoint returned {n} result-set entries; exactly one was expected: {raw}"),
    }
}

// ─── Arm 2: regorus, the reference differential ──────────────────────────────

fn run_regorus_arm(records: &[LoweredRecord], facts: &[FactFile]) -> Result<Value> {
    let mut rows: Vec<Value> = Vec::new();
    let mut timings: Vec<Value> = Vec::new();

    for rec in records {
        let rego_path = rec.dir.join("policy.rego");
        let source = std::fs::read_to_string(&rego_path)
            .with_context(|| format!("reading {}", rego_path.display()))?;
        let rule_path = format!("data.{}.result", rec.package);

        for fact in facts.iter().filter(|f| f.specimen == rec.specimen) {
            join_is_sound(rec, fact)?;

            // A FRESH engine per (record, fixture): regorus caches aggressively,
            // and a shared engine would let one fixture's evaluation state colour
            // the next. The cost of that choice is that "cold" here includes the
            // parse, which is exactly what is reported.
            let build = |source: &str| -> Result<regorus::Engine> {
                let mut e = regorus::Engine::new();
                // The regorus half of § Lowering 2. Its own doc warns "not all
                // builtins honor this flag", which is itself worth recording.
                e.set_strict_builtin_errors(true);
                e.add_policy(
                    rego_path.to_string_lossy().into_owned(),
                    source.to_owned(),
                )
                .map_err(|e| anyhow!("regorus add_policy: {e:#}"))?;
                Ok(e)
            };

            let t_cold = Instant::now();
            let outcome = (|| -> Result<Verdict> {
                let mut engine = build(&source)?;
                engine
                    .set_input_json(&serde_json::to_string(&fact.bundle)?)
                    .map_err(|e| anyhow!("regorus set_input_json: {e:#}"))?;
                let v = engine
                    .eval_rule(rule_path.clone())
                    .map_err(|e| anyhow!("regorus eval_rule({rule_path}): {e:#}"))?;
                let json: Value = serde_json::to_value(&v)?;
                // regorus reports an undefined rule as the `Undefined` sentinel,
                // which serialises to a bare string. Treated as the same error
                // condition the OPA arm's empty result set is.
                if json.is_null() || json.as_str() == Some("<undefined>") || !json.is_object() {
                    bail!("regorus returned an UNDEFINED/non-object result for {rule_path}: {json}");
                }
                read_result(&json)
            })();
            let cold_micros = t_cold.elapsed().as_micros();

            let mut warm_micros: Option<u128> = None;
            if outcome.is_ok() {
                let mut engine = build(&source)?;
                engine
                    .set_input_json(&serde_json::to_string(&fact.bundle)?)
                    .map_err(|e| anyhow!("regorus set_input_json: {e:#}"))?;
                // One evaluation to prime, then the measured steady state.
                let _ = engine.eval_rule(rule_path.clone());
                let mut best = u128::MAX;
                for _ in 0..WARM_REPS {
                    let t = Instant::now();
                    engine
                        .eval_rule(rule_path.clone())
                        .map_err(|e| anyhow!("regorus warm eval: {e:#}"))?;
                    best = best.min(t.elapsed().as_micros());
                }
                warm_micros = Some(best);
            }

            timings.push(json!({
                "specimen": rec.specimen,
                "fixtureId": fact.fixture_id,
                "coldEvalMicros": cold_micros,
                "coldIncludes": "fresh Engine + add_policy (parse) + set_input + eval",
                "warmEvalMicrosMin": warm_micros,
                "warmReps": WARM_REPS,
            }));

            rows.push(verdict_row("regorus", rec, fact, outcome));
        }
    }

    Ok(json!({
        "generatedBy": "spikes/spine-adopt/host/src/main.rs --arm regorus",
        "host": {
            "crate": "regorus 0.11.0 (microsoft/regorus)",
            "role": "REFERENCE DIFFERENTIAL ONLY (spec § Spike 1). It reads the lowered .rego SOURCE, so it exercises the lowering rather than the compiled wasm. A regorus-vs-OPA divergence is a finding about regorus, adjudicated against OPA as the reference semantics (LOWERING.md § Host contract).",
            "strictness": "set_strict_builtin_errors(true). regorus's own docs note that not all builtins honour the flag. An UNDEFINED or non-object rule value is an error row.",
        },
        "buildFindings": [
            {
                "id": "regorus-msvc-spectre",
                "severity": "blocks the stock dependency",
                "finding": "`regorus = \"0.11.0\"` with DEFAULT features does not build on this Windows/MSVC toolchain. Its `std` feature (reached from the default `full-opa`) pulls `msvc_spectre_libs` with `features = [\"error\"]`, whose build script PANICS rather than warns when the Visual Studio installation carries no Spectre-mitigated libraries: `No spectre-mitigated libs were found. Please modify the VS Installation to add these.`",
                "resolution": "Built with `default-features = false, features = [\"arc\", \"regex\", \"rvm\"]`. Recorded as a build-matrix row (spec § Failure modes) rather than worked around silently. A Linux arm of the build matrix would not hit this.",
            },
            {
                "id": "regorus-regex-unicode-perl-gap",
                "severity": "silently disables a regex class the differential depends on",
                "finding": "regorus 0.11.0 declares its `regex` dependency `default-features = false` and NO regorus feature ever adds features to it. In a dependency graph where regorus is the only `regex` consumer, the Unicode-perl escape class (word-boundary, whitespace, word, digit) is therefore ABSENT, and `regex.match` fails at COMPILE with `error: invalid regex` on patterns pinned OPA/RE2 accepts.",
                "measurement": "CONTROLLED, both directions. Without a consumer-side `regex` feature declaration: 10 of 24 regorus rows are ERROR ROWS — precisely the 3 specimens carrying a regex target pattern (a, d-line, d-file) across their 10 fixtures; the 14 ast-grep rows are unaffected because their only regexes are the lowered globs, which use no Unicode-perl escapes. With `regex = { version = \"1\", default-features = false, features = [\"unicode-perl\"] }` declared by this crate (Cargo's feature unification is additive and global): 0 error rows.",
                "consequence": "As a differential arm, regorus's regex capability is a property of the CONSUMER's dependency graph, not of regorus's version. A consumer that happened to depend on `regex` with default features elsewhere would silently get the capability; one that did not would silently lose it. That is a real adoption hazard for using regorus as a reference oracle, and it was surfaced only because the lowering's `patterns_compile` guard turns an uncompilable pattern into a LOUD error instead of an empty violation set.",
            },
        ],
        "verdictRows": rows,
        "timings": timings,
    }))
}

// ─── Arm 3: certification single-eval (spec § Actuator slice) ────────────────

/// Evaluate ONE bundle against ONE input on EVERY entrypoint it declares, and
/// report the raw outcome.
///
/// The three outcomes this mode has to keep distinguishable — and which a
/// verdict-shaped return would collapse — are:
///
///   * the module would not LOAD (bad wasm, or a builtin the host cannot resolve),
///   * an entrypoint TRAPPED or errored during evaluation,
///   * an entrypoint returned a result SET, of some length, holding some value.
///
/// All three are reported structurally. The certifier maps them onto the ruled
/// blocked classes (empty result set / eval error or trap / non-object / missing
/// keys / extra-or-malformed keys); nothing here decides PASS or BLOCK.
///
/// What this mode DOES decide is its own `failureRuleVerdict`: the ruled text says
/// "every host retains the failure rule", and a rule the host does not EXECUTE is
/// not retained. So every evaluation additionally runs this host's normal-arm
/// chain — `entrypoint_value` then `read_result`, the same two functions
/// `run_opa_arm` uses — and records Ok/Err with the host's own error string. The
/// certifier reads that verdict rather than re-deriving one from the raw shape.
async fn run_certify_arm(
    wasm_path: &Path,
    requested_entrypoints: &[String],
    input: &Value,
    rego_path: Option<&Path>,
    rego_label: Option<&str>,
    rule_path: Option<&str>,
) -> Result<Value> {
    let wasm = std::fs::read(wasm_path)
        .with_context(|| format!("reading {}", wasm_path.display()))?;
    let wasm_sha = hex(&Sha256::digest(&wasm));

    let mut wasmtime_block = Map::new();
    wasmtime_block.insert("loaded".to_owned(), json!(false));
    wasmtime_block.insert("loadError".to_owned(), Value::Null);
    wasmtime_block.insert("evaluations".to_owned(), json!([]));

    // Everything up to and including instantiation is one fallible unit: a module
    // that will not load has no entrypoints to evaluate, and that IS the report.
    let loaded = (|| -> Result<(Engine, Module)> {
        let engine = Engine::new(&Config::new())
            .map_err(anyhow::Error::from)
            .context("creating the wasmtime engine")?;
        let module = Module::new(&engine, &wasm)
            .map_err(anyhow::Error::from)
            .with_context(|| format!("compiling {}", wasm_path.display()))?;
        Ok((engine, module))
    })();

    match loaded {
        Err(e) => {
            wasmtime_block.insert("loadError".to_owned(), json!(format!("{e:#}")));
        }
        Ok((engine, module)) => {
            let imports: Vec<String> = module
                .imports()
                .map(|i| format!("{}.{}:{}", i.module(), i.name(), kind_of(&i.ty())))
                .collect();
            let mut store = Store::new(&engine, ());
            match Runtime::new(&mut store, &module).await {
                Err(e) => {
                    wasmtime_block.insert("imports".to_owned(), json!(imports));
                    wasmtime_block.insert(
                        "loadError".to_owned(),
                        json!(format!(
                            "Runtime::new failed — a builtin this host cannot resolve: {e:#}"
                        )),
                    );
                }
                Ok(runtime) => {
                    let mut declared: Vec<String> =
                        runtime.entrypoints().into_iter().map(str::to_owned).collect();
                    declared.sort();
                    let abi_version = format!("{}", runtime.abi_version());
                    let default_entrypoint = runtime.default_entrypoint().map(str::to_owned);

                    let policy = runtime
                        .without_data(&mut store)
                        .await
                        .context("instantiating the policy with an empty data document")?;

                    // "EVERY emitted entrypoint": an explicit list is honoured so the
                    // certifier can prove it asked for what the module declares, and
                    // an empty list means every entrypoint the module itself declares.
                    let to_eval: Vec<String> = if requested_entrypoints.is_empty() {
                        declared.clone()
                    } else {
                        requested_entrypoints.to_vec()
                    };

                    let mut evaluations: Vec<Value> = Vec::new();
                    for ep in &to_eval {
                        let outcome: Result<Value> = policy
                            .evaluate::<_, Value, _>(&mut store, ep, input)
                            .await
                            .map_err(|e| anyhow!("{e:#}"));
                        evaluations.push(match outcome {
                            Ok(raw) => {
                                let len = raw.as_array().map(Vec::len);
                                let single = match raw.as_array() {
                                    Some(a) if a.len() == 1 => a[0].get("result").cloned(),
                                    _ => None,
                                };
                                // THE FAILURE RULE, EXECUTED HERE. The raw fields
                                // above are untouched; this is the host's own
                                // verdict, from the normal arm's own functions.
                                let verdict = entrypoint_value(&raw).and_then(|v| read_result(&v));
                                json!({
                                    "entrypoint": ep,
                                    "ok": true,
                                    "error": Value::Null,
                                    "resultSet": raw,
                                    "resultSetIsArray": len.is_some(),
                                    "resultSetLength": len,
                                    "result": single,
                                    "failureRuleVerdict": failure_rule_verdict(verdict),
                                })
                            }
                            Err(e) => {
                                let message = format!("{e:#}");
                                // An evaluation that never returned has no result
                                // to unwrap: the failure rule's verdict IS the
                                // evaluation error, carried through verbatim.
                                let verdict = failure_rule_verdict(Err(e));
                                json!({
                                    "entrypoint": ep,
                                    "ok": false,
                                    "error": message,
                                    "resultSet": Value::Null,
                                    "resultSetIsArray": Value::Null,
                                    "resultSetLength": Value::Null,
                                    "result": Value::Null,
                                    "failureRuleVerdict": verdict,
                                })
                            }
                        });
                    }

                    wasmtime_block.insert("loaded".to_owned(), json!(true));
                    wasmtime_block.insert("abiVersion".to_owned(), json!(abi_version));
                    wasmtime_block.insert("imports".to_owned(), json!(imports));
                    wasmtime_block.insert("declaredEntrypoints".to_owned(), json!(declared));
                    wasmtime_block
                        .insert("defaultEntrypoint".to_owned(), json!(default_entrypoint));
                    wasmtime_block.insert("evaluatedEntrypoints".to_owned(), json!(to_eval));
                    wasmtime_block.insert("evaluations".to_owned(), json!(evaluations));
                }
            }
        }
    }

    // The regorus companion row, for the "every host retains the failure rule"
    // half of the ruled text. It reads the .rego SOURCE, so it is a genuinely
    // independent host rather than the same module twice.
    //
    // Its `failureRuleVerdict` runs the NORMAL regorus arm's full check chain —
    // `run_regorus_arm`'s undefined/null/non-object rejection followed by
    // `read_result` — so the verdict recorded here is the same rule that arm
    // applies, not a weaker echo of it.
    let regorus_block = match (rego_path, rule_path) {
        (Some(p), Some(rule)) => {
            let outcome = (|| -> Result<Value> {
                let source = std::fs::read_to_string(p)
                    .with_context(|| format!("reading {}", p.display()))?;
                let mut e = regorus::Engine::new();
                e.set_strict_builtin_errors(true);
                // regorus prints this NAME verbatim in its diagnostics, and the
                // certifier copies that text into `artifacts/blocked/<pkg>.json`
                // and the certification report. Using the absolute path would
                // stamp the operator's worktree layout into committed evidence
                // and make the Windows and Linux matrix arms disagree
                // byte-for-byte on the same commit. The caller supplies the
                // repo-relative label; the SOURCE is still read from `p`.
                let policy_name = rego_label
                    .map(str::to_owned)
                    .unwrap_or_else(|| p.to_string_lossy().into_owned());
                e.add_policy(policy_name, source)
                    .map_err(|e| anyhow!("regorus add_policy: {e:#}"))?;
                e.set_input_json(&serde_json::to_string(input)?)
                    .map_err(|e| anyhow!("regorus set_input_json: {e:#}"))?;
                let v = e
                    .eval_rule(rule.to_owned())
                    .map_err(|e| anyhow!("regorus eval_rule({rule}): {e:#}"))?;
                Ok(serde_json::to_value(&v)?)
            })();
            match outcome {
                Ok(v) => {
                    // regorus reports an undefined rule as a bare `<undefined>`
                    // string rather than an Err, so the sentinel is surfaced
                    // explicitly instead of being mistaken for a value.
                    let undefined = v.as_str() == Some("<undefined>");
                    // `run_regorus_arm`'s own chain, verbatim: the
                    // undefined/null/non-object rejection, then `read_result`.
                    let verdict = (|| -> Result<Verdict> {
                        if v.is_null() || v.as_str() == Some("<undefined>") || !v.is_object() {
                            bail!(
                                "regorus returned an UNDEFINED/non-object result for {rule}: {v}"
                            );
                        }
                        read_result(&v)
                    })();
                    let failure_rule = failure_rule_verdict(verdict);
                    json!({
                        "ran": true, "rule": rule, "ok": !undefined,
                        "undefined": undefined,
                        "value": v, "error": Value::Null,
                        "failureRuleVerdict": failure_rule,
                    })
                }
                Err(e) => {
                    let message = format!("{e:#}");
                    let failure_rule = failure_rule_verdict(Err(e));
                    json!({
                        "ran": true, "rule": rule, "ok": false, "undefined": Value::Null,
                        "value": Value::Null, "error": message,
                        "failureRuleVerdict": failure_rule,
                    })
                }
            }
        }
        _ => json!({ "ran": false }),
    };

    Ok(json!({
        "generatedBy": "spikes/spine-adopt/host/src/main.rs --arm certify",
        "contract": "spec `.totem/specs/spine-spike.md` § Actuator slice — evaluate EVERY emitted entrypoint against the sentinel FactBundle before publication. Raw outcomes only; classification is the certifier's.",
        "wasm": wasm_path.to_string_lossy(),
        "wasmBytes": wasm.len(),
        "wasmSha256": wasm_sha,
        "wasmtime": Value::Object(wasmtime_block),
        "regorus": regorus_block,
    }))
}

// ─── Shared ──────────────────────────────────────────────────────────────────

/// The (record, fixture) join, asserted rather than assumed.
///
/// The join key is the bundle's own `specimen` field, which is exact. The
/// ruleId-prefix reading of the filename is checked to AGREE with it — three
/// records share the pinned id `0123456789abcdef`, so a ruleId-only join would
/// silently fan one fixture out across d-line, d-file and e.
fn join_is_sound(rec: &LoweredRecord, fact: &FactFile) -> Result<()> {
    if fact.rule_id != rec.rule_id {
        bail!(
            "join defect: bundle {} claims ruleId {} but record {} carries {}",
            fact.file_name, fact.rule_id, rec.specimen, rec.rule_id
        );
    }
    if fact.engine != rec.engine {
        bail!(
            "join defect: bundle {} claims engine {} but record {} lowered as {}",
            fact.file_name, fact.engine, rec.specimen, rec.engine
        );
    }
    let expected_prefix = format!("{}-{}-", rec.rule_id, rec.specimen);
    if !fact.file_name.starts_with(&expected_prefix) {
        bail!(
            "join defect: bundle {} does not carry the expected `{}` filename prefix",
            fact.file_name, expected_prefix
        );
    }
    Ok(())
}

fn kind_of(ty: &opa_wasm::wasmtime::ExternType) -> &'static str {
    use opa_wasm::wasmtime::ExternType;
    match ty {
        ExternType::Func(_) => "function",
        ExternType::Global(_) => "global",
        ExternType::Table(_) => "table",
        ExternType::Memory(_) => "memory",
        _ => "other",
    }
}

fn wasmtime_version() -> &'static str {
    // Cargo exposes the DEPENDENCY versions only through the lock; the crate's own
    // build metadata is the honest thing available at runtime, so the exact pin is
    // reported from Cargo.lock by the comparator instead. This is the family.
    "47.x (pinned exactly in host/Cargo.lock; opa-wasm 0.3.2 requires >=42, <48)"
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn write_artifact(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    std::fs::write(path, text).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

/// Wraps a non-object `Value` as `{"value": …}` so the caller always has a map.
///
/// This function sorts nothing. The artifact's byte stability comes from
/// `serde_json`'s insertion-ordered map plus deterministic producers: the arm
/// builders emit keys in a fixed order, and the row vectors follow the sorted
/// fact-file list.
fn ensure_object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        other => {
            let mut m = Map::new();
            m.insert("value".to_owned(), other);
            m
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut arm: Option<String> = None;
    let mut spike_root: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    // `--arm certify` only.
    let mut wasm: Option<PathBuf> = None;
    let mut input: Option<PathBuf> = None;
    let mut rego: Option<PathBuf> = None;
    // The NAME regorus should print in diagnostics for the policy read from
    // `--rego`. Supplied by the caller (which knows the repo root) so the error
    // text that lands in committed evidence is machine-independent.
    let mut rego_label: Option<String> = None;
    let mut rule: Option<String> = None;
    let mut entrypoints: Vec<String> = Vec::new();
    while let Some(a) = args.next() {
        match a.as_str() {
            "--arm" => arm = args.next(),
            "--spike-root" => spike_root = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--wasm" => wasm = args.next().map(PathBuf::from),
            "--input" => input = args.next().map(PathBuf::from),
            "--rego" => rego = args.next().map(PathBuf::from),
            "--rego-label" => rego_label = args.next(),
            "--rule" => rule = args.next(),
            "--entrypoint" => {
                if let Some(e) = args.next() {
                    entrypoints.push(e);
                }
            }
            other => bail!(
                "unknown argument {other}; usage: --arm opa|regorus [--spike-root <dir>] [--out <file>] \
                 | --arm certify --wasm <policy.wasm> --input <factbundle.json> \
                 [--entrypoint <ep> ...] [--rego <policy.rego> [--rego-label <repo-relative>] \
                 --rule <data.pkg.result>] [--out <file>]"
            ),
        }
    }
    let arm = arm.ok_or_else(|| anyhow!("--arm opa|regorus|certify is required"))?;

    // The certify arm reads ONE bundle and ONE input; it deliberately does not
    // load the lowering index or the fact corpus, so it can be pointed at a
    // hand-authored conformance fixture that is not in either.
    if arm == "certify" {
        let wasm = wasm.ok_or_else(|| anyhow!("--arm certify requires --wasm <policy.wasm>"))?;
        let input_path =
            input.ok_or_else(|| anyhow!("--arm certify requires --input <factbundle.json>"))?;
        let input_value = read_json(&input_path)?;
        let value = run_certify_arm(
            &wasm,
            &entrypoints,
            &input_value,
            rego.as_deref(),
            rego_label.as_deref(),
            rule.as_deref(),
        )
        .await?;
        if let Some(out) = &out {
            write_artifact(out, &value)?;
        }
        // stdout carries the JSON and NOTHING else, so the caller can parse it
        // without a delimiter convention.
        let mut text = serde_json::to_string_pretty(&value)?;
        text.push('\n');
        print!("{text}");
        return Ok(());
    }
    // Default: the crate lives at `<spike-root>/host`.
    let spike_root = spike_root.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    });

    let records = load_lowering(&spike_root)?;
    let facts = load_facts(&spike_root)?;

    // Every record must reach at least one fixture, and every fixture exactly one
    // record. A silently unpaired bundle would shrink the differential without
    // shrinking any count the report prints.
    for rec in &records {
        if !facts.iter().any(|f| f.specimen == rec.specimen) {
            bail!("record {} has no fact bundle — the differential would silently skip it", rec.specimen);
        }
    }
    for f in &facts {
        let n = records.iter().filter(|r| r.specimen == f.specimen).count();
        if n != 1 {
            bail!("fact bundle {} joins {n} records (expected exactly 1)", f.file_name);
        }
    }

    let (value, default_out) = match arm.as_str() {
        "opa" => (run_opa_arm(&records, &facts).await?, "opa-verdicts.json"),
        "regorus" => (run_regorus_arm(&records, &facts)?, "regorus-verdicts.json"),
        other => bail!("unknown arm {other}; expected `opa` or `regorus`"),
    };

    let mut obj = ensure_object(value);
    obj.insert(
        "contract".to_owned(),
        json!("spikes/spine-adopt/rego/LOWERING.md § Host contract"),
    );
    obj.insert("recordCount".to_owned(), json!(records.len()));
    obj.insert("fixtureCount".to_owned(), json!(facts.len()));

    let out = match out {
        Some(explicit) => explicit,
        None => artifacts_dir(&spike_root)?.join(default_out),
    };
    write_artifact(&out, &Value::Object(obj))?;

    let rows = read_json(&out)?;
    let n = rows.get("verdictRows").and_then(Value::as_array).map_or(0, Vec::len);
    let errs = rows
        .get("verdictRows")
        .and_then(Value::as_array)
        .map_or(0, |a| a.iter().filter(|r| !r["error"].is_null()).count());
    println!("arm={arm} rows={n} errorRows={errs} -> {}", out.display());
    if errs > 0 {
        // An error row is DATA the comparator must see, not a reason to abort —
        // but it must never be mistaken for a clean run at the shell.
        eprintln!("WARNING: {errs} evaluation error row(s) — see `error` on each row.");
    }
    Ok(())
}
