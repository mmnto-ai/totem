package main

// Tests that the probe's own machinery is not vacuous.
//
// A clean main run reports every row MATCHing. That number is worth nothing
// unless the probe CAN report something else, so each test here forces a path a
// clean run never exercises.
//
// Nothing here names a fixture count or a specimen list. Both are properties of
// the SELECTED record set (`SPIKE_RECORD_SET`), and a test pinned to the seven
// specimens would have to be rewritten for the seed set — at which point it would
// stop testing the generalisation it was rewritten to accommodate. The
// corpus-driven tests read whatever set is on disk and skip, with a named reason,
// when it is not built.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tetratelabs/wazero"
)

// spikeRoot is where `go test` sits relative to the spike: the probe lives in
// `spikes/spine-adopt/wazero-probe`.
const spikeRoot = ".."

// ─── Corpus helpers (record-set agnostic) ────────────────────────────────────

// builtRecord is one lowered record whose policy.wasm exists, already linked.
type builtRecord struct {
	rec        loweredRecord
	policy     *loadedPolicy
	entrypoint int
}

// loadCorpus reads the CURRENT record set's lowering index and fact corpus.
func loadCorpus(t *testing.T) ([]loweredRecord, []factFile) {
	t.Helper()
	recs, err := loadLowering(spikeRoot)
	if err != nil {
		t.Skipf("no lowering index — run `npm run lower` first: %v", err)
	}
	facts, err := loadFacts(spikeRoot)
	if err != nil {
		t.Skipf("no fact corpus — run `npm run facts` first: %v", err)
	}
	return recs, facts
}

// openPolicy links one record's module, taking the entrypoint NAME from the
// lowering artifact rather than reconstructing it from the ruleId — the naming
// rule (the `_<language>` twin suffix among them) is the TS lowering's to state.
func openPolicy(t *testing.T, rec loweredRecord) (*builtRecord, bool) {
	t.Helper()
	wasm, err := os.ReadFile(policyWasmPath(spikeRoot, rec))
	if err != nil {
		return nil, false
	}
	ctx := context.Background()
	p, _, _, err := loadPolicy(ctx, wazero.NewCompilationCache(), wasm)
	if err != nil {
		t.Fatalf("loadPolicy(%s): %v", rec.Specimen, err)
	}
	t.Cleanup(func() { p.Close(ctx) })

	eps, err := p.in.entrypointIDs(ctx)
	if err != nil {
		t.Fatalf("entrypointIDs(%s): %v", rec.Specimen, err)
	}
	id, ok := eps[rec.Entrypoint]
	if !ok {
		t.Fatalf("record %s declares entrypoint %q but its module exports %v", rec.Specimen, rec.Entrypoint, eps)
	}
	return &builtRecord{rec: rec, policy: p, entrypoint: id}, true
}

// firstBuiltRecord returns the first record of the current set with a built
// module, so the ABI-level tests run on whichever set is on disk.
func firstBuiltRecord(t *testing.T) (*builtRecord, []factFile) {
	t.Helper()
	recs, facts := loadCorpus(t)
	for _, rec := range recs {
		if br, ok := openPolicy(t, rec); ok {
			return br, facts
		}
	}
	t.Skip("no lowered record has a built policy.wasm — run `npm run lower && npm run build-wasm` first")
	return nil, nil
}

func (b *builtRecord) bundles(facts []factFile) []factFile {
	var out []factFile
	for _, f := range facts {
		if joinsTo(b.rec, f) {
			out = append(out, f)
		}
	}
	return out
}

func (b *builtRecord) eval(t *testing.T, bundle []byte) *verdict {
	t.Helper()
	text, err := b.policy.in.evalClassic(context.Background(), b.entrypoint, bundle)
	if err != nil {
		t.Fatalf("eval(%s): %v", b.rec.Specimen, err)
	}
	val, err := entrypointValue(json.RawMessage(text))
	if err != nil {
		t.Fatalf("entrypointValue(%s, %q): %v", b.rec.Specimen, text, err)
	}
	v, err := readResult(val)
	if err != nil {
		t.Fatalf("readResult(%s): %v", b.rec.Specimen, err)
	}
	return v
}

func writeJSONFile(t *testing.T, path string, v any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// ─── Cardinality derivation (G10 — never a literal) ──────────────────────────

// TestExpectedRowCountDerivesFromTheCorpus is the falsifier for the hardcoded
// `24`. The count must follow the corpus: two runs over differently-sized fact
// sets must produce different expectations, which a literal cannot do.
func TestExpectedRowCountDerivesFromTheCorpus(t *testing.T) {
	for _, n := range []int{3, 7, 24, 61} {
		root := t.TempDir()
		writeJSONFile(t, filepath.Join(root, "artifacts", "facts-index.json"), map[string]any{"bundleCount": n})
		got, err := expectedRowCount(root, make([]factFile, n))
		if err != nil {
			t.Fatalf("expectedRowCount over %d bundles: %v", n, err)
		}
		if got != n {
			t.Errorf("expectedRowCount over %d bundles = %d; the count must DERIVE from the corpus, not from a literal", n, got)
		}
	}
}

// TestExpectedRowCountRejectsADisagreeingIndex pins the cross-check: a count is
// only worth its source, so an index that disagrees with the directory it indexes
// must stop the run rather than pick a winner.
func TestExpectedRowCountRejectsADisagreeingIndex(t *testing.T) {
	root := t.TempDir()
	writeJSONFile(t, filepath.Join(root, "artifacts", "facts-index.json"), map[string]any{"bundleCount": 24})
	if _, err := expectedRowCount(root, make([]factFile, 23)); err == nil {
		t.Fatal("an index declaring 24 bundles over a 23-bundle corpus was accepted; the disagreement must be an error")
	}
	if _, err := expectedRowCount(root, nil); err == nil {
		t.Fatal("an empty corpus was accepted")
	}

	empty := t.TempDir()
	writeJSONFile(t, filepath.Join(empty, "artifacts", "facts-index.json"), map[string]any{"bundleCount": 0})
	if _, err := expectedRowCount(empty, nil); err == nil {
		t.Fatal("a zero-bundle index was accepted; there is nothing to hold an arm to")
	}
}

// TestExpectedRowCountMatchesTheLiveCorpus checks the derivation against whatever
// set is actually on disk, so the unit-level tests above cannot pass while the
// real index is shaped differently.
func TestExpectedRowCountMatchesTheLiveCorpus(t *testing.T) {
	_, facts := loadCorpus(t)
	got, err := expectedRowCount(spikeRoot, facts)
	if err != nil {
		t.Fatalf("expectedRowCount on the live corpus: %v", err)
	}
	if got != len(facts) {
		t.Errorf("expectedRowCount = %d but the corpus holds %d bundles", got, len(facts))
	}
}

// ─── Record set selector ─────────────────────────────────────────────────────

func TestLoadRecordSetReadsTheSharedSelector(t *testing.T) {
	t.Setenv(recordSetEnvVar, "")
	if got, err := loadRecordSet(); err != nil || got != recordSetSpecimens {
		t.Errorf("unset %s = (%q, %v); want (%q, nil)", recordSetEnvVar, got, err, recordSetSpecimens)
	}
	for _, want := range []string{recordSetSpecimens, recordSetSeed20} {
		t.Setenv(recordSetEnvVar, want)
		if got, err := loadRecordSet(); err != nil || got != want {
			t.Errorf("%s=%q = (%q, %v); want (%q, nil)", recordSetEnvVar, want, got, err, want)
		}
	}
	// A typo must not silently run the wrong set's semantics over the corpus.
	t.Setenv(recordSetEnvVar, "seed-20")
	if got, err := loadRecordSet(); err == nil {
		t.Errorf("%s=%q was accepted as %q; an unknown set must be an error", recordSetEnvVar, "seed-20", got)
	}
}

// TestIsRequiredFollowsTheRecordSet pins both arms of the required subset: the
// two named rows on `specimens`, EVERY record on `seed20`.
func TestIsRequiredFollowsTheRecordSet(t *testing.T) {
	// Specimen names are listed here only as INPUTS to the predicate under test;
	// no assertion below depends on the current set containing them.
	specimensRequired := map[string]bool{
		"a": true, "d-file": true,
		"b": false, "c": false, "c-supp": false, "d-line": false, "e": false,
	}
	for specimen, want := range specimensRequired {
		if got := isRequired(recordSetSpecimens, specimen); got != want {
			t.Errorf("isRequired(%q, %q) = %v, want %v", recordSetSpecimens, specimen, got, want)
		}
	}

	// On seed20 every record is required — including specimens the `specimens`
	// set excludes, and including the seed-shaped ids and their language twins.
	for _, specimen := range []string{
		"b", "c", "e", "6b1890e2-empty-string-in-whitelist", "6b1890e2-empty-string-in-whitelist-js",
		"87aff037-supersede-chain", "", "anything-at-all",
	} {
		if !isRequired(recordSetSeed20, specimen) {
			t.Errorf("isRequired(%q, %q) = false; every record in the seed set is required", recordSetSeed20, specimen)
		}
	}

	// The two sets must genuinely differ, or the generalisation is vacuous.
	if isRequired(recordSetSpecimens, "b") == isRequired(recordSetSeed20, "b") {
		t.Error("isRequired answers the same for both record sets; the required subset is not set-dependent")
	}
}

// TestRequiredSubsetDescriptionTracksTheSet keeps the report's gloss honest: the
// seven-specimen sentence must not survive a change of set.
func TestRequiredSubsetDescriptionTracksTheSet(t *testing.T) {
	recs := []loweredRecord{{Specimen: "x"}, {Specimen: "y"}, {Specimen: "z"}}
	seed := requiredSubsetDescription(recordSetSeed20, recs)
	if strings.Contains(seed, "specimen-a") || strings.Contains(seed, "d-file") {
		t.Errorf("the seed20 required-subset gloss still names the specimens set's rows: %q", seed)
	}
	if !strings.Contains(seed, "3") {
		t.Errorf("the seed20 gloss does not report the record count it describes: %q", seed)
	}
	if got := requiredSubsetDescription(recordSetSpecimens, recs); !strings.Contains(got, "specimen-a") {
		t.Errorf("the specimens gloss lost the rows it names: %q", got)
	}
}

// ─── The twin join (G10 — sound on (ruleId, specimen), never ruleId alone) ───

// twinCorpus is the shape G1 produces for a rule with a `language: javascript`
// twin: ONE lessonHash, TWO records differing only in specimen, and a
// `_<language>` package suffix. The names mirror the seed's `6b1890e2` twin —
// the specimen is the record-file stem (`<hash8>-<slug>`, with `-js` on the twin),
// so one twin's specimen is a strict PREFIX of the other's.
func twinCorpus() (ts, js loweredRecord, tsBundle, jsBundle factFile) {
	const id = "6b1890e2c4d51f07"
	ts = loweredRecord{
		Specimen: "6b1890e2-empty-string-in-whitelist", SeedEntry: "6b1890e2", RuleID: id,
		Package: "totem.spike.r" + id + "_typescript", Entrypoint: "totem/spike/r" + id + "_typescript/result",
		Engine: "ast-grep", Dir: "rego/build/r" + id + "_typescript",
	}
	js = loweredRecord{
		Specimen: "6b1890e2-empty-string-in-whitelist-js", SeedEntry: "6b1890e2", RuleID: id,
		Package: "totem.spike.r" + id + "_javascript", Entrypoint: "totem/spike/r" + id + "_javascript/result",
		Engine: "ast-grep", Dir: "rego/build/r" + id + "_javascript",
	}
	tsBundle = factFile{
		FileName:  id + "-" + ts.Specimen + "-inline-bad.json",
		FixtureID: ts.Specimen + "-inline-bad", Specimen: ts.Specimen,
		RuleID: id, Engine: "ast-grep",
	}
	jsBundle = factFile{
		FileName:  id + "-" + js.Specimen + "-inline-bad.json",
		FixtureID: js.Specimen + "-inline-bad", Specimen: js.Specimen,
		RuleID: id, Engine: "ast-grep",
	}
	return
}

// TestTwinJoinIsSoundOnRuleIdAndSpecimen is the falsifier for a ruleId-only join.
// Two records share a lessonHash; each must take ITS OWN bundles and no others.
func TestTwinJoinIsSoundOnRuleIdAndSpecimen(t *testing.T) {
	ts, js, tsBundle, jsBundle := twinCorpus()

	if ts.RuleID != js.RuleID {
		t.Fatal("the twin fixture is malformed: the two records must SHARE a ruleId for this test to mean anything")
	}
	if ts.Specimen == js.Specimen {
		t.Fatal("the twin fixture is malformed: the two records must differ in specimen")
	}

	for _, c := range []struct {
		name string
		rec  loweredRecord
		f    factFile
		want bool
	}{
		{"typescript record takes its own bundle", ts, tsBundle, true},
		{"typescript record REFUSES the javascript twin's bundle", ts, jsBundle, false},
		{"javascript record takes its own bundle", js, jsBundle, true},
		{"javascript record REFUSES the typescript twin's bundle", js, tsBundle, false},
	} {
		if got := joinsTo(c.rec, c.f); got != c.want {
			t.Errorf("%s: joinsTo(%s, %s) = %v, want %v", c.name, c.rec.Specimen, c.f.FileName, got, c.want)
		}
	}

	if err := joinIsSound(ts, tsBundle); err != nil {
		t.Errorf("a correctly joined typescript pair was rejected: %v", err)
	}
	if err := joinIsSound(js, jsBundle); err != nil {
		t.Errorf("a correctly joined javascript pair was rejected: %v", err)
	}
	if err := joinIsSound(ts, jsBundle); err == nil {
		t.Error("the guard accepted the javascript twin's bundle against the typescript record; the join key is the PAIR, not the ruleId")
	}

	// The reason the guard cannot be a filename-prefix test built from the RECORD:
	// one twin's prefix is a prefix of the other twin's filenames. This assertion
	// is what makes the previous one non-obvious — the old guard passed here.
	oldPrefix := ts.RuleID + "-" + ts.Specimen + "-"
	if !strings.HasPrefix(jsBundle.FileName, oldPrefix) {
		t.Fatalf("the twin fixture no longer exercises the prefix trap: %q is not a prefix of %q", oldPrefix, jsBundle.FileName)
	}

	// A bundle whose filename contradicts its own declared fields is a corpus
	// defect, not something to score.
	mislabelled := tsBundle
	mislabelled.FileName = "deadbeefdeadbeef-something-else-inline-bad.json"
	if err := joinIsSound(ts, mislabelled); err == nil {
		t.Error("a bundle whose filename contradicts its declared (ruleId, specimen) was accepted")
	}

	// An engine disagreement stays an error (unchanged behaviour, re-pinned here
	// because the guard was rewritten around it).
	wrongEngine := tsBundle
	wrongEngine.Engine = "regex"
	if err := joinIsSound(ts, wrongEngine); err == nil {
		t.Error("a bundle claiming a different engine than the record lowered as was accepted")
	}
}

// TestLoweredRecordIgnoresAdditiveFields pins the artifact contract: the seed run
// adds fields (`seedEntry`, `manifestSha256`, …) and the Go arm must keep reading
// what it models and ignoring the rest, so an additive change on the TS side
// cannot break this half.
func TestLoweredRecordIgnoresAdditiveFields(t *testing.T) {
	raw := `{"specimen":"x","seedEntry":"6b1890e2","ruleId":"aa","package":"p","entrypoint":"e",
	         "engine":"regex","dir":"rego/build/p","manifestSha256":"deadbeef","somethingNewIn2027":{"a":1}}`
	var rec loweredRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		t.Fatalf("an additive field broke the decode: %v", err)
	}
	if rec.SeedEntry != "6b1890e2" {
		t.Errorf("seedEntry = %q, want %q", rec.SeedEntry, "6b1890e2")
	}
	if rec.Entrypoint != "e" || rec.Dir != "rego/build/p" {
		t.Errorf("the modelled naming fields were not read from the artifact: %+v", rec)
	}
}

// ─── Pair classification ─────────────────────────────────────────────────────

func rowFor(arm, fixture string, violations []violation, events []event) normalRow {
	fired := len(violations) > 0
	n := len(violations)
	return normalRow{
		Arm: arm, RuleID: "87aff037d7de47a7", FixtureID: fixture,
		Specimen: "c-supp", Engine: "ast-grep",
		Violations: violations, Events: events,
		Fired: &fired, MatchCount: &n,
	}
}

func errorRowFor(arm, fixture, msg string) normalRow {
	return normalRow{
		Arm: arm, RuleID: "87aff037d7de47a7", FixtureID: fixture,
		Specimen: "c-supp", Engine: "ast-grep", Error: msg,
	}
}

const emptyResultSetError = "EMPTY RESULT SET — the entrypoint's `result` rule was UNDEFINED"

// TestPairsClassification covers the three statuses the pairs artifact can carry,
// including the narrow malformed-facts carve-out and every way it must DECLINE.
func TestPairsClassification(t *testing.T) {
	vs := []violation{{"87aff037d7de47a7", 4, 0}}
	es := []event{{"trigger", 4}}

	t.Run("identical rows MATCH", func(t *testing.T) {
		got := comparePair(rowFor("opa", "c-supp-corpus-fail", vs, es), rowFor("wazero", "c-supp-corpus-fail", vs, es))
		if got.Status != statusMatch {
			t.Fatalf("status = %s, want %s (detail %v)", got.Status, statusMatch, got.Detail)
		}
		if got.Left != "opa" || got.Right != "wazero" {
			t.Errorf("pair is labelled %s vs %s", got.Left, got.Right)
		}
	})

	t.Run("an error row on an ordinary fixture is UNEXPLAINED", func(t *testing.T) {
		got := comparePair(rowFor("opa", "c-supp-corpus-fail", vs, es), errorRowFor("wazero", "c-supp-corpus-fail", "boom"))
		if got.Status != statusUnexplained {
			t.Fatalf("status = %s, want %s", got.Status, statusUnexplained)
		}
		if got.Detail["reason"] != "ERROR ROW — an arm failed to produce a verdict" {
			t.Errorf("reason = %v", got.Detail["reason"])
		}
	})

	t.Run("both arms erroring on the malformed-facts control is EXPLAINED", func(t *testing.T) {
		got := comparePair(
			errorRowFor("opa", malformedFactsControlFixture, emptyResultSetError),
			errorRowFor("wazero", malformedFactsControlFixture, emptyResultSetError))
		if got.Status != statusExplained {
			t.Fatalf("status = %s, want %s", got.Status, statusExplained)
		}
		if got.Detail["reason"] != "MALFORMED-FACTS-CONTROL" {
			t.Errorf("reason = %v, want MALFORMED-FACTS-CONTROL", got.Detail["reason"])
		}
		if got.Explanation == nil || !strings.Contains(*got.Explanation, "MALFORMED-FACTS-CONTROL") {
			t.Errorf("explanation = %v", got.Explanation)
		}
	})

	// Three ways the carve-out must decline. Each is a case where treating the
	// control as explained would launder a real finding.
	t.Run("the carve-out declines when one arm returned a clean verdict", func(t *testing.T) {
		for _, c := range []struct {
			name        string
			left, right normalRow
		}{
			{"left clean, right errored",
				rowFor("opa", malformedFactsControlFixture, nil, nil),
				errorRowFor("wazero", malformedFactsControlFixture, emptyResultSetError)},
			{"left errored, right clean",
				errorRowFor("opa", malformedFactsControlFixture, emptyResultSetError),
				rowFor("wazero", malformedFactsControlFixture, nil, nil)},
			{"BOTH arms clean — identical, and still not a control",
				rowFor("opa", malformedFactsControlFixture, nil, nil),
				rowFor("wazero", malformedFactsControlFixture, nil, nil)},
		} {
			got := comparePair(c.left, c.right)
			if got.Status != statusUnexplained {
				t.Errorf("%s: status = %s, want %s", c.name, got.Status, statusUnexplained)
			}
			if got.Explanation != nil {
				t.Errorf("%s: the control was explained away: %v", c.name, *got.Explanation)
			}
		}
	})

	t.Run("an ABSENT row never satisfies the control", func(t *testing.T) {
		absent := normalRow{Arm: "wazero", RuleID: "87aff037d7de47a7", FixtureID: malformedFactsControlFixture, Absent: true}
		got := comparePair(errorRowFor("opa", malformedFactsControlFixture, emptyResultSetError), absent)
		if got.Status != statusUnexplained {
			t.Fatalf("status = %s, want %s", got.Status, statusUnexplained)
		}
		if got.Explanation != nil {
			t.Errorf("a missing row was accepted as the control erroring: %v", *got.Explanation)
		}
	})

	t.Run("an ABSENT row on an ordinary fixture is UNEXPLAINED and named", func(t *testing.T) {
		absent := normalRow{Arm: "wazero", RuleID: "87aff037d7de47a7", FixtureID: "c-supp-corpus-fail",
			Specimen: "c-supp", Engine: "ast-grep", Absent: true}
		got := comparePair(rowFor("opa", "c-supp-corpus-fail", vs, es), absent)
		if got.Status != statusUnexplained {
			t.Fatalf("status = %s, want %s", got.Status, statusUnexplained)
		}
		if r, _ := got.Detail["reason"].(string); !strings.HasPrefix(r, "ABSENT ROW") {
			t.Errorf("reason = %v; an absent row must be named as absent, not as an error row", got.Detail["reason"])
		}
		// Identity must survive: a pair filed under the empty specimen is unusable.
		if got.Specimen != "c-supp" || got.FixtureID != "c-supp-corpus-fail" {
			t.Errorf("the pair lost its identity: %+v", got)
		}
	})
}

// TestWritePairsArtifactShape pins the deliverable's shape: the row keys G10 names
// and a summary whose counts derive from the rows it ships.
func TestWritePairsArtifactShape(t *testing.T) {
	pairs := []pairResult{
		{RuleID: "b", FixtureID: "f2", Specimen: "s2", SeedEntry: "6b1890e2", Engine: "regex",
			Left: "opa", Right: "wazero", Status: statusMatch},
		{RuleID: "a", FixtureID: "f1", Specimen: "s1", SeedEntry: "71935fe9", Engine: "ast-grep",
			Left: "opa", Right: "wazero", Status: statusUnexplained,
			Detail: map[string]any{"reason": "ERROR ROW — an arm failed to produce a verdict"}},
		{RuleID: "a", FixtureID: malformedFactsControlFixture, Specimen: "s1", SeedEntry: "71935fe9", Engine: "ast-grep",
			Left: "opa", Right: "wazero", Status: statusExplained},
	}
	dir := t.TempDir()
	at, err := writePairsArtifact(dir, recordSetSeed20, pairs)
	if err != nil {
		t.Fatalf("writePairsArtifact: %v", err)
	}

	var doc struct {
		GeneratedBy string         `json:"generatedBy"`
		RecordSet   string         `json:"recordSet"`
		Summary     map[string]int `json:"summary"`
		Pairs       []struct {
			Specimen  string  `json:"specimen"`
			SeedEntry string  `json:"seedEntry"`
			FixtureID string  `json:"fixtureId"`
			Left      string  `json:"left"`
			Right     string  `json:"right"`
			Status    string  `json:"status"`
			Detail    *string `json:"-"`
		} `json:"pairs"`
	}
	if err := readJSON(at, &doc); err != nil {
		t.Fatalf("re-reading the artifact: %v", err)
	}
	if doc.GeneratedBy == "" {
		t.Error("the artifact carries no `generatedBy`")
	}
	if doc.RecordSet != recordSetSeed20 {
		t.Errorf("recordSet = %q, want %q", doc.RecordSet, recordSetSeed20)
	}
	want := map[string]int{"MATCH": 1, "EXPLAINED-DIVERGENCE": 1, "UNEXPLAINED-DIVERGENCE": 1, "total": 3}
	for k, v := range want {
		if doc.Summary[k] != v {
			t.Errorf("summary[%q] = %d, want %d", k, doc.Summary[k], v)
		}
	}
	if len(doc.Pairs) != 3 {
		t.Fatalf("artifact carries %d pairs, want 3", len(doc.Pairs))
	}
	// Sorted by (ruleId, fixtureId), so the two `a` rows come first.
	if doc.Pairs[0].FixtureID != "f1" || doc.Pairs[2].FixtureID != "f2" {
		t.Errorf("pairs are not ordered by (ruleId, fixtureId): %v", doc.Pairs)
	}
	for _, p := range doc.Pairs {
		if p.Left != "opa" || p.Right != "wazero" {
			t.Errorf("pair %s is labelled %s vs %s", p.FixtureID, p.Left, p.Right)
		}
		if p.SeedEntry == "" || p.Specimen == "" || p.Status == "" {
			t.Errorf("pair %s is missing a key of the (specimen, seedEntry, fixtureId, status) tuple: %+v", p.FixtureID, p)
		}
	}

	// An empty set must serialise as `[]`, never `null`: this artifact exists to
	// be counted, and `null` reads as "not computed".
	emptyAt, err := writePairsArtifact(t.TempDir(), recordSetSpecimens, nil)
	if err != nil {
		t.Fatalf("writePairsArtifact(empty): %v", err)
	}
	b, err := os.ReadFile(emptyAt)
	if err != nil {
		t.Fatalf("reading the empty artifact: %v", err)
	}
	if !strings.Contains(string(b), `"pairs": []`) {
		t.Error("an empty pair set did not serialise as `[]`")
	}
}

// ─── ABI-level tests (drive the real wasm) ───────────────────────────────────

// TestEnvShimIsAValidModule proves the hand-encoded `env` shim is real wasm and
// not merely bytes that happen to satisfy the rest of the code.
func TestEnvShimIsAValidModule(t *testing.T) {
	ctx := context.Background()
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	c, err := r.CompileModule(ctx, buildEnvShim(2))
	if err != nil {
		t.Fatalf("the synthesised env shim does not decode: %v", err)
	}
	mems := c.ExportedMemories()
	m, ok := mems["memory"]
	if !ok {
		t.Fatalf("shim exports no `memory`; exports %v", mems)
	}
	if m.Min() != 2 {
		t.Errorf("shim memory min = %d, want 2", m.Min())
	}
	if _, hasMax := m.Max(); hasMax {
		t.Error("shim memory declares a maximum; it must not, so the guest keeps memory.grow")
	}
	if got := len(c.ImportedFunctions()); got != 6 {
		t.Errorf("shim imports %d functions, want 6", got)
	}
	for _, want := range []string{"opa_abort", "opa_builtin0", "opa_builtin1", "opa_builtin2", "opa_builtin3", "opa_builtin4"} {
		if _, ok := c.ExportedFunctions()[want]; !ok {
			t.Errorf("shim does not re-export %s", want)
		}
	}
}

// TestEmptyResultSetIsAnError pins the strictness contract at the unit level: an
// undefined `result` rule must NEVER read as a zero-violation verdict. G10 keeps
// this exactly as it was — the K5b control is built on it.
func TestEmptyResultSetIsAnError(t *testing.T) {
	if _, err := entrypointValue(json.RawMessage(`[]`)); err == nil {
		t.Fatal("an EMPTY RESULT SET was accepted; it must be an error row")
	} else if !strings.Contains(err.Error(), "EMPTY RESULT SET") {
		t.Fatalf("wrong error for an empty result set: %v", err)
	}
	v, err := entrypointValue(json.RawMessage(`[{"result":{"violations":[],"events":[]}}]`))
	if err != nil {
		t.Fatalf("a well-formed result set was rejected: %v", err)
	}
	if _, err := readResult(v); err != nil {
		t.Fatalf("a well-formed result was rejected: %v", err)
	}
	// A result missing `events` is an error, never "emits none".
	if _, err := readResult(json.RawMessage(`{"violations":[]}`)); err == nil {
		t.Fatal("a result missing `events` was accepted; absent must stay absent")
	}
}

// TestMalformedInputIsNotACleanZero is the one that matters: it drives the REAL
// wasm with an input that fails the policy's `facts_wellformed` guard and asserts
// the probe surfaces an error rather than inventing a silent, zero-violation
// verdict. Without this, a probe that mis-drove every eval would still report
// "nothing fired" and look like agreement on the negative fixtures.
//
// This is the unit-level form of the K5b control: the same undefined `result`,
// reached through the same policy the run evaluates.
func TestMalformedInputIsNotACleanZero(t *testing.T) {
	br, _ := firstBuiltRecord(t)
	text, err := br.policy.in.evalClassic(context.Background(), br.entrypoint, []byte(`{}`))
	if err != nil {
		t.Fatalf("eval with a malformed FactBundle trapped rather than returning: %v", err)
	}
	if _, err := entrypointValue(json.RawMessage(text)); err == nil {
		t.Fatalf("a malformed FactBundle produced an accepted verdict %q; it must be an error row", text)
	}
}

// TestVerdictRespondsToInput proves the wasm is actually DECIDING rather than
// returning a constant: the same module must agree with the shipped oracle on a
// fixture that FIRED and on one that stayed SILENT.
//
// The discriminating pair is chosen by consulting `shipped-verdicts.json` for
// whichever record set is on disk — nothing about specimen `a` is assumed, and
// nothing is hand-written: the fixtures are the contract, and inventing one risks
// asserting against a rule the record does not state.
func TestVerdictRespondsToInput(t *testing.T) {
	recs, facts := loadCorpus(t)
	var shippedDoc struct {
		VerdictRows []shippedRow `json:"verdictRows"`
	}
	if err := readJSON(filepath.Join(spikeRoot, "artifacts", "shipped-verdicts.json"), &shippedDoc); err != nil {
		t.Skipf("no shipped oracle to discriminate against: %v", err)
	}
	oracle := map[string]shippedRow{}
	for _, r := range shippedDoc.VerdictRows {
		oracle[r.FixtureID] = r
	}

	for _, rec := range recs {
		var fired, silent *factFile
		for i := range facts {
			f := &facts[i]
			if !joinsTo(rec, *f) {
				continue
			}
			s, ok := oracle[f.FixtureID]
			if !ok {
				continue
			}
			if s.Fired && fired == nil {
				fired = f
			}
			if !s.Fired && silent == nil {
				silent = f
			}
		}
		if fired == nil || silent == nil {
			continue
		}
		br, ok := openPolicy(t, rec)
		if !ok {
			continue
		}
		for _, f := range []*factFile{fired, silent} {
			want := oracle[f.FixtureID].MatchCount
			if got := len(br.eval(t, f.FactBundle).Violations); got != want {
				t.Errorf("%s / %s: wazero produced %d violations, the shipped oracle says %d",
					rec.Specimen, f.FixtureID, got, want)
			}
		}
		if oracle[fired.FixtureID].MatchCount == 0 {
			t.Fatalf("the oracle's `fired` row %s reports 0 matches; the pair is not discriminating", fired.FixtureID)
		}
		return
	}
	t.Skip("no record in the current set has a built module with both a fired and a silent shipped row — nothing to discriminate against")
}

// TestOneShotAgreesWithClassic runs the cross-check as a unit test too, so a
// regression in either ABI path fails without a full probe run.
func TestOneShotAgreesWithClassic(t *testing.T) {
	br, facts := firstBuiltRecord(t)
	bundles := br.bundles(facts)
	if len(bundles) == 0 {
		t.Skipf("record %s has no fact bundle to evaluate", br.rec.Specimen)
	}
	ctx := context.Background()
	for _, f := range bundles {
		classic, err := br.policy.in.evalClassic(ctx, br.entrypoint, f.FactBundle)
		if err != nil {
			t.Fatalf("classic (%s): %v", f.FixtureID, err)
		}
		oneShot, err := br.policy.in.evalOneShot(ctx, br.entrypoint, f.FactBundle)
		if err != nil {
			t.Fatalf("one-shot (%s): %v", f.FixtureID, err)
		}
		if ok, a, b := jsonEqual(classic, oneShot); !ok {
			t.Fatalf("the two ABI paths disagree on %s:\n  classic  %s\n  one-shot %s", f.FixtureID, a, b)
		}
	}
}
