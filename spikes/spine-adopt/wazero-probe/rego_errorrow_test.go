package main

import "testing"

// C3 on the wasm arms (round-1 falsification leg, M1): an `error: ""` rego row is
// a VERDICT row — its violations and events must survive normalisation, and the
// row must not be classified as an error row. Before this pin, `normaliseRego`
// branched on `Error != nil` alone, so an empty error string dropped the
// violations and produced an UNEXPLAINED-DIVERGENCE the TS comparator (which
// applies the same non-empty rule) would have classified as MATCH.
func TestRegoEmptyErrorStringIsAVerdictRow(t *testing.T) {
	empty := ""
	fired := true
	count := 2
	rows := []regoRow{{
		RuleID: "61dcb058bd1df15d", FixtureID: "a-inline-bad", Specimen: "a", Engine: "regex",
		Fired: &fired, MatchCount: &count, Error: &empty,
		Violations: []violation{{RuleID: "61dcb058bd1df15d", LineNumber: 1, Ordinal: 0}, {RuleID: "61dcb058bd1df15d", LineNumber: 3, Ordinal: 0}},
		Events:     []regoEvent{{Kind: "trigger", LineNumber: 1}, {Kind: "trigger", LineNumber: 3}},
	}}
	out := normaliseRego("opa", rows)
	if len(out) != 1 {
		t.Fatalf("expected 1 row, got %d", len(out))
	}
	n := out[0]
	if n.Error != "" {
		t.Fatalf("an empty error string must not become an error row, got Error=%q", n.Error)
	}
	if len(n.Violations) != 2 || len(n.Events) != 2 {
		t.Fatalf("the verdict fields must survive: violations=%d events=%d (want 2/2)", len(n.Violations), len(n.Events))
	}
	if n.Fired == nil || !*n.Fired || n.MatchCount == nil || *n.MatchCount != 2 {
		t.Fatalf("fired/matchCount must carry through: %+v", n)
	}
}

func TestRegoNonEmptyErrorIsAnErrorRow(t *testing.T) {
	msg := "EMPTY RESULT SET — the entrypoint's `result` rule was UNDEFINED"
	rows := []regoRow{{RuleID: "r", FixtureID: "m3-malformed-lines", Specimen: "s", Engine: "ast-grep", Error: &msg}}
	n := normaliseRego("wazero", rows)[0]
	if n.Error != msg || n.Violations != nil || n.Events != nil {
		t.Fatalf("a non-empty error must be an error row with nil verdict fields, got %+v", n)
	}
}
