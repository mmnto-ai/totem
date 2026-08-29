package main

import (
	"strings"
	"testing"
)

// The seam between the TS pipeline and this probe (mmnto-ai/totem-strategy#1154
// G8/G10): the shipped arm's K5b error row for `m3-malformed-lines` carries
// `error` and NO arms, because no dispatcher ran. Found by the first seed20
// integration run — the probe refused the whole run with "carries no arms".
// These pin both halves: an error row normalises like the wasmtime/wazero
// error rows, and a row that claims a verdict without arms is still fatal.
func TestShippedErrorRowNormalisesWithoutArms(t *testing.T) {
	msg := "MALFORMED FACTS — lines[1] is number; the shipped harness produced no verdict for this bundle"
	rows := []shippedRow{{
		RuleID: "87aff037d7de47a7", FixtureID: "m3-malformed-lines", Specimen: "87aff037-fail-open-catch-ban",
		Engine: "ast-grep", Error: &msg,
	}}
	bundles := map[string][]astMatch{"m3-malformed-lines": nil}
	out, err := normaliseShipped(rows, bundles)
	if err != nil {
		t.Fatalf("a shipped ERROR row must normalise, got: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 normalised row, got %d", len(out))
	}
	n := out[0]
	if n.Error != msg || n.Violations != nil || n.Events != nil || n.Fired != nil || n.MatchCount != nil || n.Absent {
		t.Fatalf("expected an error row (nil verdict fields, Absent=false), got %+v", n)
	}
	if n.Arm != "shipped" || n.FixtureID != "m3-malformed-lines" {
		t.Fatalf("identity must carry through: %+v", n)
	}
}

func TestShippedRowClaimingAVerdictWithoutArmsIsStillFatal(t *testing.T) {
	rows := []shippedRow{{
		RuleID: "61dcb058bd1df15d", FixtureID: "a-inline-bad", Specimen: "a", Engine: "regex",
	}}
	bundles := map[string][]astMatch{"a-inline-bad": nil}
	_, err := normaliseShipped(rows, bundles)
	if err == nil || !strings.Contains(err.Error(), "carries no arms") {
		t.Fatalf("a verdict-claiming row without arms must stay fatal, got: %v", err)
	}
}

func TestShippedEmptyErrorStringIsNotAnErrorRow(t *testing.T) {
	empty := ""
	rows := []shippedRow{{
		RuleID: "61dcb058bd1df15d", FixtureID: "a-inline-bad", Specimen: "a", Engine: "regex", Error: &empty,
	}}
	bundles := map[string][]astMatch{"a-inline-bad": nil}
	_, err := normaliseShipped(rows, bundles)
	if err == nil || !strings.Contains(err.Error(), "carries no arms") {
		t.Fatalf("an empty error string must not launder a verdict-less row into an error row, got: %v", err)
	}
}
