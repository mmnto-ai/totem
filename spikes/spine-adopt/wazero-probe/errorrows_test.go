package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// wazRow builds one normalised wazero row for the accounting: an error row when
// `msg` is non-empty, a verdict row otherwise.
func wazRow(fixture, msg string) normalRow {
	r := normalRow{Arm: armWazero, RuleID: "87aff037d7de47a7", FixtureID: fixture, Specimen: "c-supp", Engine: "ast-grep"}
	if msg != "" {
		r.Error = msg
		return r
	}
	r.Violations = []violation{}
	r.Events = []event{}
	return r
}

// TestErrorRowAccountingSeparatesTheControl is the falsifier for a bare error-row
// COUNT (mmnto-ai/totem#2694 C7). The claim the apparatus makes is "0 outside
// K5b", and a count of 1 cannot tell "the control errored as designed" from "a
// real record errored" — the two readings are opposite verdicts on the run.
func TestErrorRowAccountingSeparatesTheControl(t *testing.T) {
	control := []string{malformedFactsControlFixture}

	t.Run("one control error row is accounted to the control", func(t *testing.T) {
		a := accountErrorRows(control, []armRowSet{{Arm: armWazero, Rows: []normalRow{
			wazRow("c-supp-corpus-fail", ""),
			wazRow(malformedFactsControlFixture, "EMPTY RESULT SET — the entrypoint's `result` rule was UNDEFINED"),
		}}})
		got := a.PerArm[armWazero]
		if got.Total != 1 || got.FromK5bControl != 1 || got.OutsideK5b != 0 {
			t.Errorf("perArm[%s] = %+v; want {total:1 fromK5bControl:1 outsideK5b:0}", armWazero, got)
		}
		if len(got.OutsideK5bFixtureIDs) != 0 {
			t.Errorf("outsideK5bFixtureIds = %v; the only error row IS the control", got.OutsideK5bFixtureIDs)
		}
		if len(a.K5bControlFixtureIDs) != 1 || a.K5bControlFixtureIDs[0] != malformedFactsControlFixture {
			t.Errorf("k5bControlFixtureIds = %v; want the control fixture present in the corpus", a.K5bControlFixtureIDs)
		}

		ck := &checks{}
		appendErrorRowChecks(ck, a)
		if len(ck.Rows) != 2 {
			t.Fatalf("appendErrorRowChecks recorded %d checks; both C7 checks must be recorded when the control is present", len(ck.Rows))
		}
		if f := ck.failed(); len(f) != 0 {
			t.Errorf("a corpus whose ONLY error row is the designed control failed a check: %+v", f)
		}
	})

	t.Run("an error row outside the control is named and FAILS the zero-outside check", func(t *testing.T) {
		a := accountErrorRows(control, []armRowSet{{Arm: armWazero, Rows: []normalRow{
			wazRow(malformedFactsControlFixture, "EMPTY RESULT SET — undefined"),
			wazRow("c-supp-corpus-fail", "boom"),
		}}})
		got := a.PerArm[armWazero]
		if got.Total != 2 || got.FromK5bControl != 1 || got.OutsideK5b != 1 {
			t.Errorf("perArm[%s] = %+v; want {total:2 fromK5bControl:1 outsideK5b:1}", armWazero, got)
		}
		if len(got.OutsideK5bFixtureIDs) != 1 || got.OutsideK5bFixtureIDs[0] != "c-supp-corpus-fail" {
			t.Errorf("outsideK5bFixtureIds = %v; the undesigned error row must be NAMED, not merely counted",
				got.OutsideK5bFixtureIDs)
		}

		ck := &checks{}
		appendErrorRowChecks(ck, a)
		f := ck.failed()
		if len(f) != 1 {
			t.Fatalf("%d checks failed; exactly the zero-outside check must fail: %+v", len(f), ck.Rows)
		}
		if !strings.Contains(f[0].Name, "zero outside") {
			t.Errorf("the failing check is %q; expected the zero-outside-K5b one", f[0].Name)
		}
		if !strings.Contains(f[0].Detail, "c-supp-corpus-fail") {
			t.Errorf("the failure detail does not name the offending row: %q", f[0].Detail)
		}
	})

	t.Run("a control that produced NO error row fails the exactly-one check", func(t *testing.T) {
		// The control exists to make the arm error. A clean run over it is the
		// control failing, not the run passing.
		a := accountErrorRows(control, []armRowSet{{Arm: armWazero, Rows: []normalRow{
			wazRow(malformedFactsControlFixture, ""),
		}}})
		ck := &checks{}
		appendErrorRowChecks(ck, a)
		f := ck.failed()
		if len(f) != 1 || !strings.Contains(f[0].Name, "EXACTLY ONE") {
			t.Fatalf("a silent control was accepted; failures = %+v", f)
		}
	})

	t.Run("no control in the corpus gates the second check off", func(t *testing.T) {
		// On `specimens` there is no control bundle, so `k5bControlFixtureIds` is
		// empty and the exactly-one check must not fire — a permanent failure for
		// a control the set never had would make the check meaningless.
		a := accountErrorRows(nil, []armRowSet{{Arm: armWazero, Rows: []normalRow{wazRow("f1", "")}}})
		if len(a.K5bControlFixtureIDs) != 0 {
			t.Errorf("k5bControlFixtureIds = %v over a corpus with no control", a.K5bControlFixtureIDs)
		}
		ck := &checks{}
		appendErrorRowChecks(ck, a)
		if len(ck.Rows) != 1 {
			t.Errorf("recorded %d checks with no control present; only the zero-outside check applies", len(ck.Rows))
		}
		if f := ck.failed(); len(f) != 0 {
			t.Errorf("a clean specimens-shaped corpus failed a check: %+v", f)
		}
	})
}

// TestErrorRowAccountingGrammarMatchesTheTsShape pins the KEYS, because C7's
// requirement is that a scorer reads ONE shape across `differential-report.json`
// and `wazero-report.json` (`src/compare.mts:935-957`). A renamed key here is
// invisible to every test that goes through the Go structs.
func TestErrorRowAccountingGrammarMatchesTheTsShape(t *testing.T) {
	a := accountErrorRows([]string{malformedFactsControlFixture}, []armRowSet{
		{Arm: armWazero, Rows: []normalRow{wazRow(malformedFactsControlFixture, "EMPTY RESULT SET")}},
	})
	b, err := json.Marshal(a)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	text := string(b)
	for _, key := range []string{
		`"contract":`, `"k5bControlFixtureIds":`, `"perArm":`,
		`"total":`, `"fromK5bControl":`, `"outsideK5b":`, `"outsideK5bFixtureIds":`,
	} {
		if !strings.Contains(text, key) {
			t.Errorf("errorRows is missing the key %s — the TS comparator publishes it: %s", key, text)
		}
	}
	if !strings.Contains(text, `"`+armWazero+`":`) {
		t.Errorf("perArm does not key on the arm name %q: %s", armWazero, text)
	}
	// Empty lists must be `[]`, never `null`: a reader counting error rows reads
	// `null` as "not computed".
	empty := accountErrorRows(nil, []armRowSet{{Arm: armWazero}})
	eb, err := json.Marshal(empty)
	if err != nil {
		t.Fatalf("marshal(empty): %v", err)
	}
	if strings.Contains(string(eb), "null") {
		t.Errorf("an empty accounting serialised a `null`: %s", eb)
	}
}
